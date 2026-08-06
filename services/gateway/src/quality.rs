//! C6 quality-signal capture (contract, P6). The gateway records **one implicit
//! signal batch per inference call**, keyed to `inference_calls.id`, in
//! `metering.quality_signals`. This is the contract sink; C5 (RAG grounding) and the
//! opt-in LLM-as-judge emit additional signals into the same table in later phases.
//!
//! Capture is best-effort: a failure here never fails the inference request (the
//! call already ran + was budgeted + ledgered). `signal_class='implicit'`,
//! `source='gateway'`.

use sqlx::PgPool;
use uuid::Uuid;

/// Implicit per-call metrics the gateway observes with no extra model call.
pub struct CallSignals {
    pub inference_call_id: Uuid,
    /// The budget node / subject the call is attributed to (mirrors `subject_id`).
    pub actor_id: Option<Uuid>,
    pub latency_ms: u64,
    pub cost_usd: f64,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    /// Number of secret/PII redactions applied before egress (C4 governance signal).
    pub redactions: u32,
    /// `local` (in-process engine) or `cloud` (provider).
    pub execution_location: String,
    pub success: bool,
}

/// Record one implicit `quality_signals` row for the call. `value_num` carries the
/// headline cost; `value_json` carries the full metric batch (latency/tokens/
/// redactions/plane/success) for the live-meter read model + analytics.
pub async fn record_call_signals(pool: &PgPool, tenant: Uuid, s: &CallSignals) {
    let value_json = serde_json::json!({
        "latency_ms": s.latency_ms,
        "cost_usd": s.cost_usd,
        "input_tokens": s.input_tokens,
        "output_tokens": s.output_tokens,
        "redactions": s.redactions,
        "execution_location": s.execution_location,
        "success": s.success,
    });

    let res = sqlx::query(
        "insert into metering.quality_signals \
           (tenant_id, id, subject_type, inference_call_id, signal_key, signal_class, \
            value_num, value_json, unit, source, actor_id, schema_version) \
         values ($1, gen_random_uuid(), 'call', $2, 'call_metrics', 'implicit', \
                 $3::numeric, $4::jsonb, 'usd', 'gateway', $5, 1)",
    )
    .bind(tenant)
    .bind(s.inference_call_id)
    .bind(s.cost_usd)
    .bind(value_json.to_string())
    .bind(s.actor_id)
    .execute(pool)
    .await;

    if let Err(e) = res {
        tracing::warn!("quality: record_call_signals failed (best-effort): {}", e);
    }
}
