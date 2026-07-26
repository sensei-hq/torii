//! C6 synchronous judge — `POST /v1/judge`. Scores one or more candidate answers to a
//! question with the local quality judge, returning the scores inline. This is the
//! desktop Compare screen's ranking source.
//!
//! Unlike the background auto-judge (which fires after a persisted chat call only when the
//! `quality-judge` feature is enabled), this endpoint is EXPLICIT and user-initiated, so
//! it runs when called — governed by budget, not the auto-judge feature flag. Each answer
//! is metered like any inference (reserve → judge → commit). An answer that can't be
//! judged (over budget, empty, or an unparseable score) comes back with `score: null`
//! rather than failing the whole batch, so the caller degrades gracefully.

use axum::{extract::State, http::StatusCode, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{auth::Claims, state::SharedState};

#[derive(Deserialize)]
pub struct JudgeAnswer {
    /// Caller-chosen id echoed back in the score (e.g. the Compare column's model id).
    pub id: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct JudgeRequest {
    pub question: String,
    pub answers: Vec<JudgeAnswer>,
}

#[derive(Serialize)]
pub struct JudgeScore {
    pub id: String,
    /// 0..1 quality score, or null when the answer couldn't be judged.
    pub score: Option<f64>,
}

/// Cap the batch so one call can't trigger hundreds of judge inferences.
const MAX_ANSWERS: usize = 8;

pub async fn post_judge(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<JudgeRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Same fail-closed gate as chat: a token with no tenant / no resolvable budget node
    // is denied (the judge is metered inference, not a free read).
    let tenant = claims.tenant_id.ok_or((
        StatusCode::PAYMENT_REQUIRED,
        "budgeted access required: token carries no tenant".to_string(),
    ))?;
    let subject = Uuid::parse_str(&claims.sub).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            "invalid subject in token".to_string(),
        )
    })?;
    let node = crate::budgets::resolve_node(&state.pool, tenant, subject)
        .await
        .map_err(|_| {
            (
                StatusCode::PAYMENT_REQUIRED,
                "no budget node for caller — access denied".to_string(),
            )
        })?;

    let mut scores = Vec::with_capacity(body.answers.len().min(MAX_ANSWERS));
    for a in body.answers.into_iter().take(MAX_ANSWERS) {
        let est = crate::budgets::estimate(200, 512);
        let score = match crate::budgets::reserve(&state.pool, tenant, node, est, None).await {
            Ok(hold) => match crate::judge::execute_judge(&state, &body.question, &a.content).await
            {
                Some(run) => {
                    let _ = crate::budgets::commit(&state.pool, tenant, hold, run.cost).await;
                    run.score
                }
                None => {
                    let _ = crate::budgets::release(&state.pool, tenant, hold).await;
                    None
                }
            },
            // Over the hard cap — skip judging this answer (null), never overspend.
            Err(_) => None,
        };
        scores.push(JudgeScore { id: a.id, score });
    }

    Ok(Json(json!({ "scores": scores })))
}
