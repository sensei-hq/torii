//! C1/C4 · grounded Ask — retrieval-augmented generation with citations.
//!
//! `GET  /v1/spaces`               — the spaces the caller can ground against (picker).
//! `POST /v1/spaces/{id}/ask`      — retrieve → grounded prompt → generate → persist the turn
//!                                    as an RW5 Ask thread (conversation + user/assistant
//!                                    messages) with per-source `message_citations`, and return
//!                                    the answer + its sources.
//!
//! The generation reuses the chat hot-path preamble (budget reserve→commit, DLP masking, BYOK
//! credentials) via `pub(crate)` helpers in [`super::chat`]; retrieval reuses the frozen
//! `HybridRetriever` (space + classification isolation lives inside `hybrid_search`, keyed on
//! the caller's `profile_id`). Document excerpts are already redacted-at-rest (C5), so the
//! grounding context is safe to inject.

use std::time::Instant;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use gateway::{
    store::{CallStatus, GatewayStore, InferenceCall},
    types::{
        capability::Capability,
        request::{InferenceRequest, Message, MessageRole, Payload},
    },
};

use crate::{
    auth::Claims,
    rag::retrieve::{RetrieveQuery, ScoredChunk},
    routes::{
        chat::{auto_fallback_enabled, build_trace, inject_tenant_credentials, masking_enabled, reserve_budget},
        rpc::authorize,
    },
    state::SharedState,
    store::PgGatewayStore,
};

/// Cap on the number of grounding excerpts injected into the prompt (and persisted as
/// citations), regardless of the retriever's top_k — bounds prompt size + the sources list.
const MAX_GROUNDING: usize = 8;
/// Character cap for a citation's preview snippet in the response.
const SNIPPET_CHARS: usize = 240;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AskBody {
    pub query: String,
    /// Append to an existing Ask thread the caller owns; a new thread is created when absent.
    #[serde(default)]
    pub conversation_id: Option<Uuid>,
    #[serde(default)]
    pub top_k: Option<i32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct Citation {
    /// 1-based ordinal matching the `[n]` marker the model was asked to cite.
    pub index: usize,
    pub document_id: Uuid,
    pub chunk_id: Uuid,
    pub section_path: Option<String>,
    pub page_ref: Option<i32>,
    pub score: f64,
    /// A short preview of the grounding excerpt (the full text is not returned).
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct AskResponse {
    pub conversation_id: Uuid,
    pub content: String,
    pub model: Option<String>,
    pub cost_usd: f64,
    /// Were any source excerpts found to ground the answer?
    pub grounded: bool,
    pub citations: Vec<Citation>,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/// The grounded system prompt: an instruction to answer ONLY from the numbered excerpts and
/// cite each claim as `[n]`, followed by the excerpts. With no sources, it instructs the model
/// to say it has nothing to ground on rather than inventing citations.
pub(crate) fn build_grounded_system(sources: &[ScoredChunk]) -> String {
    if sources.is_empty() {
        return "You are a workspace assistant. No workspace documents matched this question \
                in the selected space, so you have no sources to ground an answer on. Tell the \
                user that plainly; do not fabricate citations or facts."
            .to_string();
    }
    let mut s = String::from(
        "You are answering strictly from the workspace document excerpts below. Use ONLY this \
         context — do not rely on outside knowledge. Cite every claim inline with its source \
         number in square brackets, e.g. [1]. If the context does not contain the answer, say \
         you don't know rather than guessing.\n\nContext:\n",
    );
    for (i, c) in sources.iter().enumerate() {
        let where_ = c.section_path.as_deref().unwrap_or("").trim();
        if where_.is_empty() {
            s.push_str(&format!("[{}]\n", i + 1));
        } else {
            s.push_str(&format!("[{}] {}\n", i + 1, where_));
        }
        s.push_str(c.text.trim());
        s.push_str("\n\n");
    }
    s
}

/// A short, char-bounded preview of an excerpt (never splits a UTF-8 codepoint).
pub(crate) fn snippet(text: &str, max: usize) -> String {
    let t = text.trim();
    let chars: Vec<char> = t.chars().collect();
    if chars.len() <= max {
        return t.to_string();
    }
    let mut out: String = chars[..max].iter().collect();
    out.push('…');
    out
}

// ---------------------------------------------------------------------------
// GET /v1/spaces
// ---------------------------------------------------------------------------

/// `GET /v1/spaces` — the spaces the caller can ground against: spaces they own or are a
/// member of, each with a document count. Capability `doc.read` (any member). Tenant-scoped.
pub async fn list_spaces(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let rows: Result<Value, _> = sqlx::query_scalar(
        "select coalesce(json_agg(t order by t.name), '[]'::json) from ( \
           select s.id, s.name, s.description, s.classification, \
                  (select count(*) from public.documents d \
                     where d.tenant_id = s.tenant_id and d.space_id = s.id) as document_count \
             from public.spaces s \
            where s.tenant_id = $1 \
              and (s.owner_id = $2 \
                   or exists(select 1 from public.space_members m \
                              where m.tenant_id = s.tenant_id and m.space_id = s.id \
                                and m.profile_id = $2))) t",
    )
    .bind(tenant)
    .bind(actor)
    .fetch_one(&state.pool)
    .await;
    match rows {
        Ok(spaces) => (StatusCode::OK, Json(json!({ "spaces": spaces }))).into_response(),
        Err(e) => {
            tracing::error!("list_spaces: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "read failed").into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// POST /v1/spaces/{space_id}/ask
// ---------------------------------------------------------------------------

/// `POST /v1/spaces/{space_id}/ask` — grounded, cited answer over a space's documents.
/// Capability `doc.read` (retrieval) + a resolved budget node (generation is metered like any
/// inference). Retrieval isolation (space + classification) is enforced inside `hybrid_search`
/// on the caller's `profile_id`, so a non-member gets no restricted excerpts.
pub async fn ask(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(space_id): Path<Uuid>,
    Json(body): Json<AskBody>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let query = body.query.trim().to_string();
    if query.is_empty() {
        return (StatusCode::BAD_REQUEST, "query is required").into_response();
    }

    // 1. Retrieve grounding excerpts (space + classification scoped inside hybrid_search).
    let cfg = crate::rag::resolve_retrieval_config(&state.pool, tenant, Some(space_id)).await;
    let rq = RetrieveQuery {
        text: query.clone(),
        profile_id: actor,
        top_k: body.top_k,
        doc_ids: None,
        inspect: false,
    };
    let retrieved = match state.retriever.retrieve(tenant, Some(space_id), &rq, &cfg).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("ask: retrieve (space {space_id}): {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "retrieval failed").into_response();
        }
    };
    // The grounding set: the kept (non-dropped) chunks, capped for prompt size.
    let sources: Vec<ScoredChunk> = retrieved
        .chunks
        .into_iter()
        .filter(|c| !c.dropped)
        .take(MAX_GROUNDING)
        .collect();

    // 2. Build the grounded request (reuse the chat DLP/fallback/BYOK posture).
    let mask = masking_enabled(&state, Some(tenant)).await;
    let allow_fallback = auto_fallback_enabled(&state, Some(tenant)).await;
    let system = build_grounded_system(&sources);
    // Redact the user's query before egress (excerpts are already redacted-at-rest by C5).
    let clean_query = if mask {
        crate::redact::Redactor.redact(&query).0
    } else {
        query.clone()
    };
    let max_tokens = body.max_tokens.unwrap_or(1024);
    let input_est = ((clean_query.chars().count() + system.chars().count()) / 4)
        .min(u32::MAX as usize) as u32;

    let mut ireq = InferenceRequest {
        capability: Capability::TextChat,
        model: None,
        router: None,
        chain: Some("chat".to_string()),
        payload: Payload::Chat {
            messages: vec![Message::text(MessageRole::User, clean_query)],
            system: Some(system),
            max_tokens: Some(max_tokens),
            temperature: None,
            tools: Vec::new(),
        },
        budget: None,
        auth: None,
        panel: None,
        consensus: None,
        allow_fallback,
        credentials: Default::default(),
    };
    inject_tenant_credentials(&state, Some(tenant), &mut ireq).await;

    // 3. Budget reserve → generate → commit (fail-closed reserve; release on error).
    let (_t, node, hold) = match reserve_budget(&state, &claims, input_est, max_tokens).await {
        Ok(v) => v,
        Err((code, msg)) => return (code, msg).into_response(),
    };
    let start = Instant::now();
    let exec = state.gateway.execute(&ireq).await;
    let duration_ms = start.elapsed().as_millis() as u64;
    let resp = match exec {
        Ok(r) => r,
        Err(e) => {
            let _ = crate::budgets::release(&state.pool, tenant, hold).await;
            tracing::error!("ask: gateway execute error: {e}");
            return (StatusCode::BAD_GATEWAY, "upstream provider error").into_response();
        }
    };

    let content = {
        let raw = resp.content.clone().unwrap_or_default();
        if mask {
            crate::redact::Redactor.redact(&raw).0
        } else {
            raw
        }
    };
    let model = resp.model.clone();
    let cost_usd = resp
        .actual_cost
        .as_ref()
        .map(|c| c.total_cost)
        .or_else(|| resp.estimated_cost.as_ref().map(|e| e.estimated))
        .unwrap_or(0.0);
    let input_tokens = resp.usage.as_ref().map(|u| u.input_tokens);
    let output_tokens = resp.usage.as_ref().map(|u| u.output_tokens);

    if let Err(e) = crate::budgets::commit(&state.pool, tenant, hold, cost_usd).await {
        tracing::warn!("ask: budget commit failed (spend not recorded on node): {e}");
    }

    // 4. Persist the RW5 Ask thread + citations (best-effort — never fails the answer).
    let store = PgGatewayStore {
        pool: state.pool.clone(),
        tenant_id: tenant,
    };
    let conversation_id = match ensure_conversation(
        &state.pool,
        tenant,
        actor,
        space_id,
        body.conversation_id,
        &query,
    )
    .await
    {
        Ok(id) => id,
        Err(ConvError::Forbidden) => {
            return (
                StatusCode::FORBIDDEN,
                "conversation not found for this member",
            )
                .into_response();
        }
        Err(ConvError::Db(e)) => {
            // The answer succeeded + spend is committed; surface it even if the thread write
            // failed, but log so the persistence gap is visible.
            tracing::warn!("ask: ensure_conversation failed (answer returned anyway): {e}");
            return (
                StatusCode::OK,
                Json(build_response(Uuid::nil(), content, model, cost_usd, &sources)),
            )
                .into_response();
        }
    };

    // user turn, then the grounded assistant turn.
    let _ = insert_message(&state.pool, tenant, conversation_id, "user", &query, None, None, None)
        .await;
    let plane = execution_location(resp.attempts.last().map(|a| a.adapter.as_str()));
    match insert_message(
        &state.pool,
        tenant,
        conversation_id,
        "assistant",
        &content,
        model.as_deref(),
        Some(cost_usd),
        Some(plane),
    )
    .await
    {
        Ok(asst_msg_id) => {
            for c in &sources {
                if let Err(e) = insert_citation(
                    &state.pool,
                    tenant,
                    asst_msg_id,
                    c.document_id,
                    c.chunk_id,
                    c.scores.fused,
                )
                .await
                {
                    tracing::warn!("ask: persist message_citation failed (best-effort): {e}");
                }
            }
        }
        Err(e) => tracing::warn!("ask: persist assistant message failed (best-effort): {e}"),
    }

    // 5. Ledger row + routing trace, so the grounded ask shows in Activity like any inference.
    let call = InferenceCall {
        id: Uuid::new_v4(),
        session_id: None,
        project_id: None,
        subject_id: Some(node),
        tier: None,
        capability: Capability::TextChat,
        chain_id: Some("chat".to_string()),
        adapter: resp
            .attempts
            .last()
            .map(|a| a.adapter.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        model: model.clone().unwrap_or_default(),
        api_model_id: resp.attempts.last().map(|a| a.api_model_id.clone()),
        input_tokens,
        output_tokens,
        cost_usd,
        cost_estimated: resp.estimated_cost.as_ref().map(|e| e.estimated), // §D LN-4
        duration_ms,
        status: if resp.success {
            CallStatus::Success
        } else {
            CallStatus::Failed
        },
        error_type: None,
        fallback_sequence: resp.attempts.len() as u8,
        recorded_at: Utc::now(),
    };
    if let Err(e) = store.insert_inference_call(&call).await {
        tracing::warn!("ask: persist inference_call failed (best-effort): {e}");
    } else {
        let stored_trace =
            build_trace(call.id, call.capability.clone(), &resp, duration_ms, call.recorded_at);
        if let Err(e) = store.insert_execution_trace(&stored_trace).await {
            tracing::warn!("ask: persist execution_trace failed (best-effort): {e}");
        }
    }

    (
        StatusCode::OK,
        Json(build_response(conversation_id, content, model, cost_usd, &sources)),
    )
        .into_response()
}

/// The winning adapter's execution plane label ('local' for the embedded engine, else 'cloud').
fn execution_location(adapter: Option<&str>) -> &'static str {
    match adapter {
        Some(a) if a.contains("embedded") || a.contains("ollama") || a.contains("llama") => "local",
        _ => "cloud",
    }
}

fn build_response(
    conversation_id: Uuid,
    content: String,
    model: Option<String>,
    cost_usd: f64,
    sources: &[ScoredChunk],
) -> AskResponse {
    let citations = sources
        .iter()
        .enumerate()
        .map(|(i, c)| Citation {
            index: i + 1,
            document_id: c.document_id,
            chunk_id: c.chunk_id,
            section_path: c.section_path.clone(),
            page_ref: c.page_ref,
            score: c.scores.fused,
            snippet: snippet(&c.text, SNIPPET_CHARS),
        })
        .collect();
    AskResponse {
        conversation_id,
        content,
        model,
        cost_usd,
        grounded: !sources.is_empty(),
        citations,
    }
}

// ---------------------------------------------------------------------------
// RW5 persistence (raw sqlx — the Ask thread tables aren't in the gateway crate store)
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum ConvError {
    /// A conversation_id was supplied but isn't the caller's — refuse to append to it.
    Forbidden,
    Db(sqlx::Error),
}

/// Create a new Ask thread, or validate ownership of the supplied one. When creating, the
/// title seeds from the first query (trimmed to fit `conversations.title`).
async fn ensure_conversation(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    owner: Uuid,
    space_id: Uuid,
    existing: Option<Uuid>,
    title_seed: &str,
) -> Result<Uuid, ConvError> {
    if let Some(id) = existing {
        let owner_of: Option<Uuid> = sqlx::query_scalar(
            "select owner_id from public.conversations where tenant_id = $1 and id = $2",
        )
        .bind(tenant)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(ConvError::Db)?;
        return match owner_of {
            Some(o) if o == owner => Ok(id),
            // Not found, or owned by someone else → never append to another member's thread.
            _ => Err(ConvError::Forbidden),
        };
    }
    let title: String = title_seed.chars().take(120).collect();
    let id: Uuid = sqlx::query_scalar(
        "insert into public.conversations (tenant_id, owner_id, space_id, title) \
         values ($1, $2, $3, $4) returning id",
    )
    .bind(tenant)
    .bind(owner)
    .bind(space_id)
    .bind(title)
    .fetch_one(pool)
    .await
    .map_err(ConvError::Db)?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
async fn insert_message(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    conversation_id: Uuid,
    role: &str,
    content: &str,
    model: Option<&str>,
    cost_usd: Option<f64>,
    execution_location: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "insert into public.messages \
           (tenant_id, conversation_id, role, content, model, cost_usd, execution_location) \
         values ($1, $2, $3::content.message_role, $4, $5, $6, $7::core.execution_location) returning id",
    )
    .bind(tenant)
    .bind(conversation_id)
    .bind(role)
    .bind(content)
    .bind(model)
    .bind(cost_usd)
    .bind(execution_location)
    .fetch_one(pool)
    .await
}

async fn insert_citation(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    message_id: Uuid,
    document_id: Uuid,
    chunk_id: Uuid,
    score: f64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into public.message_citations \
           (tenant_id, message_id, document_id, chunk_id, score) \
         values ($1, $2, $3, $4, $5)",
    )
    .bind(tenant)
    .bind(message_id)
    .bind(document_id)
    .bind(chunk_id)
    .bind(score)
    .execute(pool)
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::retrieve::Scores;

    fn chunk(text: &str, section: Option<&str>) -> ScoredChunk {
        ScoredChunk {
            chunk_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            text: text.to_string(),
            section_path: section.map(|s| s.to_string()),
            page_ref: None,
            scores: Scores {
                dense: None,
                bm25: None,
                fused: 0.5,
                rerank: None,
            },
            dropped: false,
        }
    }

    #[test]
    fn grounded_system_numbers_sources_and_demands_citations() {
        let sys = build_grounded_system(&[
            chunk("The sky is blue.", Some("Ch 1 › Colors")),
            chunk("Water is wet.", None),
        ]);
        assert!(sys.contains("[1] Ch 1 › Colors"));
        assert!(sys.contains("The sky is blue."));
        assert!(sys.contains("[2]"));
        assert!(sys.contains("Water is wet."));
        // it must instruct the model to cite + not invent beyond the context.
        assert!(sys.to_lowercase().contains("cite"));
        assert!(sys.to_lowercase().contains("only"));
    }

    #[test]
    fn grounded_system_with_no_sources_forbids_fabrication() {
        let sys = build_grounded_system(&[]);
        assert!(sys.to_lowercase().contains("no "));
        assert!(sys.to_lowercase().contains("fabricate"));
        assert!(!sys.contains("[1]"));
    }

    #[test]
    fn snippet_bounds_length_without_splitting_codepoints() {
        assert_eq!(snippet("short", 240), "short");
        let long = "a".repeat(300);
        let s = snippet(&long, 240);
        assert_eq!(s.chars().count(), 241); // 240 + the ellipsis
        assert!(s.ends_with('…'));
        // multi-byte input must not panic mid-codepoint.
        let emoji = "🙂".repeat(300);
        let se = snippet(&emoji, 10);
        assert_eq!(se.chars().count(), 11);
    }

    // ── live-DB (55322) persistence round-trip. Ignored by default:
    //    `cargo test -- --ignored ask_thread_persists` ──
    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    /// The Ask thread persists as conversation → messages → message_citations against the live
    /// FK chain; a conversation is reused for its owner but refused for anyone else; and the
    /// rows are tenant-isolated (tenant B sees none of tenant A's thread).
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn ask_thread_persists_conversation_message_citation_and_isolates_tenants() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'ask-test', $2, 'ask-test')",
            )
            .bind(t)
            .bind(format!("ask-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let owner = Uuid::new_v4();
        let space = Uuid::new_v4(); // conversations.space_id has no FK — arbitrary is fine.

        // create a thread; the same owner reuses it, a different owner is refused.
        let conv = ensure_conversation(&pool, a, owner, space, None, "What is our refund policy?")
            .await
            .expect("create conversation");
        let same = ensure_conversation(&pool, a, owner, space, Some(conv), "again")
            .await
            .expect("owner reuses");
        assert_eq!(same, conv, "owner reuses the same thread");
        let other = Uuid::new_v4();
        assert!(
            matches!(
                ensure_conversation(&pool, a, other, space, Some(conv), "x").await,
                Err(ConvError::Forbidden)
            ),
            "a non-owner must not append to the thread"
        );

        // user + assistant turns, then a citation on the assistant turn.
        let _u = insert_message(&pool, a, conv, "user", "What is our refund policy?", None, None, None)
            .await
            .expect("user msg");
        let asst = insert_message(
            &pool,
            a,
            conv,
            "assistant",
            "Refunds within 30 days [1].",
            Some("gemma2:2b"),
            Some(0.0),
            Some("local"),
        )
        .await
        .expect("assistant msg");
        insert_citation(&pool, a, asst, Uuid::new_v4(), Uuid::new_v4(), 0.87)
            .await
            .expect("citation");

        // read back: two messages under the thread, one citation on the assistant turn.
        let msgs: i64 = sqlx::query_scalar(
            "select count(*) from public.messages where tenant_id = $1 and conversation_id = $2",
        )
        .bind(a)
        .bind(conv)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(msgs, 2);
        let score: f64 = sqlx::query_scalar(
            "select score::float8 from public.message_citations \
             where tenant_id = $1 and message_id = $2",
        )
        .bind(a)
        .bind(asst)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!((score - 0.87).abs() < 1e-6, "citation score round-trips");

        // tenant B sees none of tenant A's thread.
        let b_msgs: i64 = sqlx::query_scalar(
            "select count(*) from public.messages where tenant_id = $1 and conversation_id = $2",
        )
        .bind(b)
        .bind(conv)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(b_msgs, 0, "tenant B must not read tenant A's messages");

        // cleanup — cascade clears conversations → messages → message_citations.
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}
