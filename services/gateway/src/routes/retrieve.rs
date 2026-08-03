//! C5 · retrieval HTTP surface (`/v1/spaces/{space_id}/…`, spec §4.1).
//!
//! `POST …/retrieve` embeds the query and calls the frozen `HybridRetriever` (dense pgvector + BM25
//! fused by RRF). The tenant / classification / space isolation lives INSIDE `hybrid_search` (the
//! gateway is `service_role` → RLS-bypassing), keyed on the caller's `profile_id` — so a caller only
//! ever sees chunks from documents they may read (cross-tenant recall = 0, classification enforced
//! in SQL). `GET …/retrieval-config` returns the resolved config; v1 serves
//! `RetrievalConfig::default()` (per-space `settings` resolution is a tracked seam).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::Claims,
    rag::retrieve::RetrieveQuery,
    routes::rpc::authorize,
    state::SharedState,
};

#[derive(Deserialize)]
pub struct RetrieveBody {
    pub query: String,
    #[serde(default)]
    pub top_k: Option<i32>,
    /// Accepted for API stability. v1 serves `RetrievalConfig::default()`; per-request override
    /// merge is a tracked seam (see below) and is NEVER persisted here.
    #[serde(default)]
    pub config_override: Option<serde_json::Value>,
    #[serde(default)]
    pub inspect: Option<bool>,
    /// A session-scoped config override — accepted but **NEVER persisted** (persisting a space
    /// default is `POST /rpc/retrieval/set-config`, gated on `retrieval.manage`). v1 ignores it.
    #[serde(default)]
    pub session_only: Option<serde_json::Value>,
}

/// `POST /v1/spaces/{space_id}/retrieve` — capability `doc.read`. Runs hybrid retrieval scoped to
/// the space. Space membership + classification are enforced INSIDE `hybrid_search` on the caller's
/// `profile_id`, so a non-member simply gets no confidential/restricted chunks (no separate gate,
/// no existence leak). Returns the full `RetrieveResult` (per-chunk dense/bm25/fused scores +
/// per-stage stats when `inspect`).
pub async fn retrieve(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(space_id): Path<Uuid>,
    Json(body): Json<RetrieveBody>,
) -> Response {
    let (tenant, actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    // no-hardcoded-ops: resolve the per-space RetrievalConfig from public.settings over the fallback
    // defaults. (Merging a `session_only` override for THIS request only — never persisted — is a
    // tracked follow-up; today session_only is accepted and ignored.)
    let cfg = crate::rag::resolve_retrieval_config(&state.pool, tenant, Some(space_id)).await;
    let q = RetrieveQuery {
        text: body.query,
        profile_id: actor,
        top_k: body.top_k,
        doc_ids: None,
        inspect: body.inspect.unwrap_or(false),
    };

    match state
        .retriever
        .retrieve(tenant, Some(space_id), &q, &cfg)
        .await
    {
        Ok(result) => (StatusCode::OK, Json(result)).into_response(),
        Err(e) => {
            tracing::error!("retrieve (space {space_id}): {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "retrieval failed").into_response()
        }
    }
}

/// `GET /v1/spaces/{space_id}/retrieval-config` — capability `doc.read`. Returns the resolved
/// retrieval configuration for the space. v1 returns `RetrievalConfig::default()`; per-space
/// `settings` resolution is the tracked seam (writes already land via
/// `POST /rpc/retrieval/set-config`).
pub async fn retrieval_config(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Path(space_id): Path<Uuid>,
) -> Response {
    let (tenant, _actor) = match authorize(&state, &claims, "doc.read").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let cfg = crate::rag::resolve_retrieval_config(&state.pool, tenant, Some(space_id)).await;
    (StatusCode::OK, Json(cfg)).into_response()
}
