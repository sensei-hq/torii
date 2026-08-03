//! C5 · quality-signal emitters (§3b) — one row per retrieve and per ingest-redaction batch.
//!
//! Mirrors `quality.rs` house style: writes `public.quality_signals` as `service_role`, best-effort
//! (a signal write NEVER fails the request — it logs and moves on). Redaction signals carry per-kind
//! COUNTS + an active-secret flag only — NEVER the matched text (spec §5, "redaction/audit logs are
//! themselves scrubbed").

use sqlx::PgPool;
use uuid::Uuid;

use crate::redact::Redaction;

const SCHEMA_VERSION: i32 = 1;

/// One retrieval signal: fused-top score + per-stage hit counts + latency.
pub struct RetrievalSignal {
    pub space_id: Option<Uuid>,
    pub actor_id: Uuid,
    pub k_in: i32,
    pub k_out: i32,
    pub dense_hits: i32,
    pub bm25_hits: i32,
    pub fused_top: f64,
    pub latency_ms: u64,
}

/// Emit a `retrieval` quality signal (best-effort). `value_num` = the top fused score.
pub async fn record_retrieval_signal(pool: &PgPool, tenant: Uuid, s: RetrievalSignal) {
    let value_json = serde_json::json!({
        "space_id": s.space_id,
        "k_in": s.k_in,
        "k_out": s.k_out,
        "dense_hits": s.dense_hits,
        "bm25_hits": s.bm25_hits,
        "latency_ms": s.latency_ms,
    });
    let res = sqlx::query(
        "insert into public.quality_signals \
           (tenant_id, id, signal_key, signal_class, value_num, value_json, unit, source, actor_id, schema_version) \
         values ($1, gen_random_uuid(), 'retrieval', 'implicit', $2, $3::jsonb, 'rrf_score', 'c5.retrieve', $4, $5)",
    )
    .bind(tenant)
    .bind(s.fused_top)
    .bind(value_json.to_string())
    .bind(s.actor_id)
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!("c5: retrieval quality signal write failed: {e}");
    }
}

/// Emit a `redaction` quality signal at ingest (best-effort). Records per-kind COUNTS + the
/// active-secret flag + the document id — NEVER the matched text.
pub async fn record_redaction_signal(
    pool: &PgPool,
    tenant: Uuid,
    document_id: Uuid,
    summary: &[Redaction],
    active_secret: bool,
    actor: Uuid,
) {
    let total: i64 = summary.iter().map(|r| r.count as i64).sum();
    if total == 0 {
        return; // nothing redacted → no signal
    }
    let by_kind: serde_json::Map<String, serde_json::Value> = summary
        .iter()
        .map(|r| (r.kind.to_string(), serde_json::json!(r.count)))
        .collect();
    let value_json = serde_json::json!({
        "document_id": document_id,
        "active_secret": active_secret,
        "by_kind": by_kind,
    });
    let res = sqlx::query(
        "insert into public.quality_signals \
           (tenant_id, id, signal_key, signal_class, value_num, value_json, unit, source, actor_id, schema_version) \
         values ($1, gen_random_uuid(), 'redaction', 'implicit', $2, $3::jsonb, 'count', 'c5.ingest', $4, $5)",
    )
    .bind(tenant)
    .bind(total as f64)
    .bind(value_json.to_string())
    .bind(actor)
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!("c5: redaction quality signal write failed: {e}");
    }
}
