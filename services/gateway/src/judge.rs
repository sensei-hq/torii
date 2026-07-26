//! C6 LLM-as-judge (P6). An **opt-in, metered** quality signal: after a chat response
//! is persisted, if the `quality-judge` feature is enabled for the tenant, a background
//! task asks a cheap local reasoning model (the `judge` chain → gemma4 via ollama, $0)
//! to score the response 0..1. The judge is itself inference (C6-a): it reserves +
//! commits its own budget hold and writes its own `inference_calls` row (`tier='judge'`).
//! The score is recorded as an `implicit` `judge_score` `quality_signals` row keyed to
//! the JUDGED call. Ships **default-off**; runs async so it never adds latency to the
//! user's response, and it can never fail or delay that response.

use gateway::store::{CallStatus, GatewayStore, InferenceCall};
use gateway::types::{
    capability::Capability,
    request::{InferenceRequest, Message, MessageRole, Payload},
};
use uuid::Uuid;

use crate::{state::SharedState, store::PgGatewayStore};

/// Is the `quality-judge` feature enabled for this tenant? Default-off: on only when a
/// workspace-scoped `feature_policies` row sets `default-on` or `user-overridable`.
pub async fn judge_enabled(state: &SharedState, tenant: Uuid) -> bool {
    let st: Option<String> = sqlx::query_scalar(
        "select state from public.feature_policies \
          where tenant_id = $1 and feature_key = 'quality-judge' and scope_type = 'workspace' \
          order by modified_at desc limit 1",
    )
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    matches!(st.as_deref(), Some("default-on") | Some("user-overridable"))
}

/// Extract the first `0..1` float from the judge output; clamp to `[0,1]`.
fn parse_score(s: &str) -> Option<f64> {
    let mut num = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' {
            num.push(c);
        } else if !num.is_empty() {
            break;
        }
    }
    num.parse::<f64>().ok().map(|v| v.clamp(0.0, 1.0))
}

/// Run the judge for a completed call (spawned; best-effort). Reserves budget → runs
/// the judge inference on the `judge` chain → commits → persists the judge's own
/// `inference_calls` row → records the `judge_score` signal on the judged call.
pub async fn judge_response(
    state: SharedState,
    tenant: Uuid,
    node: Uuid,
    judged_call_id: Uuid,
    question: String,
    answer: String,
) {
    // Nothing to score if the answer came back empty (a flaky local model can do this).
    if answer.trim().is_empty() {
        return;
    }

    // 1. Budget reserve for the judge call (metered; $0 on local, still flows through C3).
    //    gemma4 is a REASONING model — it needs enough output budget to finish its
    //    chain-of-thought and emit the final score, else `content` comes back empty
    //    (ollama puts the CoT in `reasoning`, `content` only fills once it concludes).
    let est = crate::budgets::estimate(200, 512);
    let hold = match crate::budgets::reserve(&state.pool, tenant, node, est, None).await {
        Ok(h) => h,
        // over budget / no node → skip judging (never block, never overspend).
        Err(_) => return,
    };

    // 2. Judge inference on the `judge` chain (local gemma4). Truncate inputs so a huge
    //    conversation can't blow the judge prompt.
    // Single-line prompt — gemma4-via-ollama returns empty completions for multi-line
    // evaluation prompts but answers the single-line form (verified empirically).
    let prompt = format!(
        "Rate the quality of the assistant's answer from 0.0 to 1.0. Reply with ONLY the number. User: {} Assistant: {} Score:",
        question.chars().take(1200).collect::<String>().replace('\n', " "),
        answer.chars().take(1200).collect::<String>().replace('\n', " "),
    );
    let ireq = InferenceRequest {
        capability: Capability::TextChat,
        model: None,
        router: None,
        chain: Some("judge".to_string()),
        payload: Payload::Chat {
            messages: vec![Message::text(MessageRole::User, &prompt)],
            system: None,
            // enough for a reasoning model (gemma4) to think + emit the final score.
            max_tokens: Some(512),
            temperature: None,
            tools: Vec::new(),
        },
        budget: None,
        auth: None,
        panel: None,
        consensus: None,
    };

    let start = std::time::Instant::now();
    // Small local models occasionally return an empty completion — retry once on an
    // empty/unparseable score before giving up (cheap on the local plane).
    let mut resp_opt = None;
    let mut cost = 0.0;
    let mut raw = String::new();
    let mut score = None;
    for _ in 0..2 {
        match state.gateway.execute(&ireq).await {
            Ok(r) => {
                cost += r
                    .actual_cost
                    .as_ref()
                    .map(|c| c.total_cost)
                    .or_else(|| r.estimated_cost.as_ref().map(|e| e.estimated))
                    .unwrap_or(0.0);
                raw = r.content.clone().unwrap_or_default();
                score = parse_score(&raw);
                resp_opt = Some(r);
                if score.is_some() {
                    break;
                }
            }
            Err(e) => {
                tracing::warn!("judge: execute failed: {e}");
                break;
            }
        }
    }
    let duration_ms = start.elapsed().as_millis() as u64;
    let resp = match resp_opt {
        Some(r) => r,
        None => {
            let _ = crate::budgets::release(&state.pool, tenant, hold).await;
            return;
        }
    };
    let _ = crate::budgets::commit(&state.pool, tenant, hold, cost).await;

    // 3. Persist the judge's own inference_calls row (the judge IS inference).
    let judge_call = InferenceCall {
        id: Uuid::new_v4(),
        session_id: None,
        project_id: None,
        subject_id: Some(node),
        tier: Some("judge".to_string()),
        capability: Capability::TextChat,
        chain_id: Some("judge".to_string()),
        adapter: resp
            .attempts
            .last()
            .map(|a| a.adapter.clone())
            .unwrap_or_else(|| "unknown".to_string()),
        model: resp.model.clone().unwrap_or_default(),
        api_model_id: resp.attempts.last().map(|a| a.api_model_id.clone()),
        input_tokens: resp.usage.as_ref().map(|u| u.input_tokens),
        output_tokens: resp.usage.as_ref().map(|u| u.output_tokens),
        cost_usd: cost,
        duration_ms,
        status: if resp.success {
            CallStatus::Success
        } else {
            CallStatus::Failed
        },
        error_type: None,
        fallback_sequence: resp.attempts.len() as u8,
        recorded_at: chrono::Utc::now(),
    };
    let store = PgGatewayStore {
        pool: state.pool.clone(),
        tenant_id: tenant,
    };
    let _ = store.insert_inference_call(&judge_call).await;

    // 4. Record the judge_score signal on the JUDGED call.
    match score {
        Some(s) => {
            let meta = serde_json::json!({
                "judge_model": judge_call.model,
                "judge_call_id": judge_call.id,
                "raw": raw.chars().take(120).collect::<String>(),
            });
            let _ = sqlx::query(
                "insert into public.quality_signals \
                   (tenant_id, id, inference_call_id, signal_key, signal_class, \
                    value_num, value_json, unit, source, actor_id, schema_version) \
                 values ($1, gen_random_uuid(), $2, 'judge_score', 'implicit', \
                         $3::numeric, $4::jsonb, 'score', 'judge', $5, 1)",
            )
            .bind(tenant)
            .bind(judged_call_id)
            .bind(s)
            .bind(meta.to_string())
            .bind(node)
            .execute(&state.pool)
            .await;
        }
        None => tracing::warn!(
            "judge: unparseable score from {:?}",
            raw.chars().take(60).collect::<String>()
        ),
    }
}
