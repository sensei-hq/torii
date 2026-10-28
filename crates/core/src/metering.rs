//! The ledger write — `metering.inference_calls` and `metering.execution_traces` — in ONE place.
//!
//! System One §9.2 moved this here from the API so both writers use it: the HTTP service
//! (`services/gateway`, chat/ask/judge) and the operator CLI's run executor, which had no
//! ledger writer at all until the run metering stance was decided. A second INSERT in the CLI
//! would have been a second definition of what a ledger row is, free to drift from the
//! catalog-FK lateral below — exactly what DECISIONS' "one authoritative ledger" forbids.
//!
//! The store is tenant-scoped at construction (torii is one tenant per process) and needs
//! `DATABASE_URL` + the pool `connect` already owns.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::Row;
use uuid::Uuid;

use gateway::store::{CallStatus, GatewayStore, InferenceCall, StoredTrace, UsageTotals};
use gateway::types::capability::Capability;
use gateway::types::error::GatewayError;
use gateway::types::trace::ExecutionTrace;

// ---------------------------------------------------------------------------
// PgGatewayStore
// ---------------------------------------------------------------------------

/// The tenant-scoped `GatewayStore`: the ledger write for every model call torii records —
/// chat, ask and the judge in the API, and now the operator CLI's run executor, which
/// reaches it through the same type (System One §9.2).
///
/// It also owns the run attribution: a call made inside a run is stamped with that run's
/// id and charged unit here, because nothing above it can (see
/// [`insert_inference_call`](GatewayStore::insert_inference_call)).
pub struct PgGatewayStore {
    pub pool: sqlx::PgPool,
    pub tenant_id: Uuid,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map a sqlx error to GatewayError via ProviderError (no Storage variant exists).
fn db_err(e: sqlx::Error) -> GatewayError {
    GatewayError::ProviderError {
        adapter: "postgres".into(),
        message: e.to_string(),
        status: None,
    }
}

/// Serialize a `Capability` to its serde snake_case string (e.g. "text_chat").
fn capability_to_str(cap: &Capability) -> Result<String, GatewayError> {
    let v = serde_json::to_value(cap)?;
    Ok(v.as_str().unwrap_or("unknown").to_owned())
}

fn status_str(s: &CallStatus) -> &'static str {
    match s {
        CallStatus::Success => "success",
        CallStatus::Failed => "failed",
    }
}

// ---------------------------------------------------------------------------
// GatewayStore impl
// ---------------------------------------------------------------------------

#[async_trait]
impl GatewayStore for PgGatewayStore {
    // -----------------------------------------------------------------------
    // inference_calls
    // -----------------------------------------------------------------------

    async fn insert_inference_call(&self, call: &InferenceCall) -> Result<Uuid, GatewayError> {
        // System One §9.2 — attribute the call to the run it was made inside, and to that
        // run's charged unit. It happens HERE because only the store can: the gateway and
        // its store are built once and shared by every run the process drives, so run
        // identity is per TASK, not per store (`orchestrator::metering`). A call with no
        // run — chat, the judge, a test — is recorded exactly as before.
        //
        // The clone is unconditional on purpose: a handful of strings against a Postgres
        // round trip, and it keeps one `call` binding for both the stamping and the INSERT.
        let mut resolved = call.clone();
        if resolved.run_id.is_none() {
            resolved.run_id = orchestrator::metering::current_run().map(|run| run.0);
        }
        // Nested rather than a let-chain: this crate is edition 2021, and `default` fields
        // make the two conditions a plain tuple match anyway.
        if let (None, Some(run_id)) = (resolved.subject_id, resolved.run_id) {
            resolved.subject_id = match run_subject(&self.pool, self.tenant_id, run_id).await {
                Ok(node) => node,
                Err(e) => {
                    // Attribution is advisory: a lookup miss must never drop the row, for the
                    // same reason a catalog-FK miss does not — record what ran. An unattributed
                    // row rolls up to nobody, exactly like a chat call with no subject.
                    tracing::warn!(
                        %run_id,
                        error = %e,
                        "run attribution lookup failed; recording the call unattributed"
                    );
                    None
                }
            };
        }
        let call = &resolved;
        let capability = capability_to_str(&call.capability)?;
        let status = status_str(&call.status);
        let input_tokens = call.input_tokens.map(|v| v as i32);
        let output_tokens = call.output_tokens.map(|v| v as i32);
        let duration_ms = call.duration_ms as i64;
        let fallback_sequence = call.fallback_sequence as i16;

        // C3: execution location (local engine vs cloud provider) for the
        // local-vs-cloud savings rollup (O2). Derived from the winning adapter.
        let execution_location = if call.adapter.contains("embedded")
            || call.adapter.contains("ollama")
            || call.adapter.contains("llama")
        {
            "local"
        } else {
            "cloud"
        };

        // Budget attribution (§D LN-3c-2b): `subject_id` ($16) is the resolved cap-bearing unit →
        // `org_unit_id` directly. §D LN-4b dropped the vestigial session_id/project_id (→ conversation_id,
        // nullable, not written until the content.conversations writer lands in P7). cost_actual ($10) is
        // the crate's InferenceCall.cost_usd (renamed cost_usd→cost_actual on the ledger); cost_estimated
        // ($18) is the gateway pre-call estimate.
        //
        // §D LN-3b: FK-normalize the routing identity at write. The `ep` LATERAL resolves the winning
        // catalog endpoint from (adapter=$5 → routers.name, api_model_id=$7 → model_endpoints.router_model_id)
        // using the is_default desc / priority asc tiebreak — the SAME lateral torii_core::config uses to *derive*
        // api_model_id, so a recorded api_model_id resolves back to the identical endpoint by construction.
        // LEFT JOIN LATERAL over a 1-row source ⇒ a no-match still inserts the call with NULL endpoint/model/
        // router_id (fail-soft — a resolution miss NEVER blocks a call). adapter/model/chain_id free-text are
        // KEPT as the point-in-time snapshot (LN-3b keep-snapshot decision).
        sqlx::query(
            r#"
            INSERT INTO metering.inference_calls
                (tenant_id, id, capability, chain_id,
                 adapter, model, api_model_id,
                 endpoint_id, model_id, router_id,
                 input_tokens, output_tokens, cost_actual, duration_ms,
                 status, error_type, fallback_sequence, recorded_at,
                 org_unit_id, execution_location, cost_estimated, run_id)
            SELECT
                $1, $2, $3, $4,
                $5, $6, $7,
                ep.id, ep.model_id, ep.router_id,
                $8, $9, $10, $11,
                $12::metering.call_status, $13, $14, $15,
                $16, $17::core.execution_location, $18, $19
            FROM (SELECT 1) one
            LEFT JOIN LATERAL (
                SELECT me.id, me.model_id, me.router_id
                FROM catalog.model_endpoints me
                JOIN catalog.routers r ON r.id = me.router_id
                WHERE r.name = $5 AND me.router_model_id = $7 AND me.is_active = true
                ORDER BY me.is_default DESC, me.priority ASC
                LIMIT 1
            ) ep ON true
            "#,
        )
        .bind(self.tenant_id)
        .bind(call.id)
        .bind(&capability)
        .bind(&call.chain_id)
        .bind(&call.adapter)
        .bind(&call.model)
        .bind(&call.api_model_id)
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(call.cost_usd)
        .bind(duration_ms)
        .bind(status)
        .bind(&call.error_type)
        .bind(fallback_sequence)
        .bind(call.recorded_at)
        .bind(call.subject_id)
        .bind(execution_location)
        .bind(call.cost_estimated)
        .bind(call.run_id)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;

        Ok(call.id)
    }

    async fn get_inference_calls_by_session(
        &self,
        _session_id: Uuid,
    ) -> Result<Vec<InferenceCall>, GatewayError> {
        // §D LN-3a/LN-4b: sessions retired and inference_calls.session_id dropped. Torii never calls this
        // (crate-trait method exercised only in the crate's own tests); the session concept moves to
        // content.conversations (P7). Returns empty rather than query a column that no longer exists.
        Ok(Vec::new())
    }

    // -----------------------------------------------------------------------
    // Spend aggregates
    // -----------------------------------------------------------------------

    async fn get_spend_since(&self, since: DateTime<Utc>) -> Result<f64, GatewayError> {
        let row = sqlx::query(
            r#"
            SELECT COALESCE(SUM(cost_actual), 0)::float8 AS total
            FROM metering.inference_calls
            WHERE tenant_id = $1 AND recorded_at >= $2
            "#,
        )
        .bind(self.tenant_id)
        .bind(since)
        .fetch_one(&self.pool)
        .await
        .map_err(db_err)?;

        let total: f64 = row.try_get("total").map_err(db_err)?;
        Ok(total)
    }

    /// MIG-2 (v0.4.6): required by the crate for AUTH rolling-window quota.
    /// Torii does NOT use the crate's soft quota — budgets are enforced by
    /// C3's hard synchronous reserve→commit (DECISIONS §2 W2). Returning zeros
    /// keeps the crate quota inert by design (no per-subject attribution exists
    /// until F1-rework RW7 anyway). C3 supersedes this path.
    async fn get_usage_since(
        &self,
        _subject_id: Uuid,
        _since: DateTime<Utc>,
    ) -> Result<UsageTotals, GatewayError> {
        Ok(UsageTotals::default())
    }

    async fn get_spend_by_model_since(
        &self,
        since: DateTime<Utc>,
    ) -> Result<Vec<(String, f64)>, GatewayError> {
        let rows = sqlx::query(
            r#"
            SELECT model, COALESCE(SUM(cost_actual), 0)::float8 AS total
            FROM metering.inference_calls
            WHERE tenant_id = $1 AND recorded_at >= $2
            GROUP BY model
            ORDER BY model ASC
            "#,
        )
        .bind(self.tenant_id)
        .bind(since)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        rows.iter()
            .map(|row| {
                let model: String = row.try_get("model").map_err(db_err)?;
                let total: f64 = row.try_get("total").map_err(db_err)?;
                Ok((model, total))
            })
            .collect()
    }

    // -----------------------------------------------------------------------
    // execution_traces
    // -----------------------------------------------------------------------

    async fn insert_execution_trace(&self, trace: &StoredTrace) -> Result<Uuid, GatewayError> {
        let trace_json = serde_json::to_value(&trace.trace)?;

        sqlx::query(
            r#"
            INSERT INTO metering.execution_traces
                (tenant_id, id, inference_call_id, trace, recorded_at)
            VALUES
                ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(self.tenant_id)
        .bind(trace.id)
        .bind(trace.inference_call_id)
        .bind(sqlx::types::Json(&trace_json))
        .bind(trace.created_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;

        Ok(trace.id)
    }

    async fn get_execution_trace(&self, id: Uuid) -> Result<Option<StoredTrace>, GatewayError> {
        let row = sqlx::query(
            r#"
            SELECT id, inference_call_id, trace, recorded_at
            FROM metering.execution_traces
            WHERE tenant_id = $1 AND id = $2
            "#,
        )
        .bind(self.tenant_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;

        match row {
            None => Ok(None),
            Some(row) => Ok(Some(row_to_stored_trace(&row)?)),
        }
    }

    async fn get_traces_by_call(
        &self,
        inference_call_id: Uuid,
    ) -> Result<Vec<StoredTrace>, GatewayError> {
        let rows = sqlx::query(
            r#"
            SELECT id, inference_call_id, trace, recorded_at
            FROM metering.execution_traces
            WHERE tenant_id = $1 AND inference_call_id = $2
            ORDER BY recorded_at ASC
            "#,
        )
        .bind(self.tenant_id)
        .bind(inference_call_id)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        rows.iter().map(row_to_stored_trace).collect()
    }
}

/// The most specific budget node a run is charged to — the unit its calls are attributed to
/// on the ledger (`subject_id` → `org_unit_id`).
///
/// `run_charges.node_ids` is the issuer's units plus every ancestor, so the DEEPEST node is
/// the specific bucket; `usage_daily` walks up from it (`core.org_unit_ancestor_at_level`),
/// which is what makes a parent's total include its children's run spend. No charge row, or
/// an empty `node_ids` (the fixture charge the CLI tests build), yields `None`.
async fn run_subject(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    run_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT ou.id
        FROM runs.run_charges c
        JOIN core.org_units ou
          ON ou.tenant_id = c.tenant_id AND ou.id = ANY (c.node_ids)
        WHERE c.tenant_id = $1 AND c.run_id = $2
        ORDER BY ou.level DESC, ou.id
        LIMIT 1
        "#,
    )
    .bind(tenant)
    .bind(run_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("id")))
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

fn row_to_stored_trace(row: &sqlx::postgres::PgRow) -> Result<StoredTrace, GatewayError> {
    let trace_json: serde_json::Value = row.try_get("trace").map_err(db_err)?;
    let trace: ExecutionTrace =
        serde_json::from_value(trace_json).map_err(GatewayError::Serialization)?;

    Ok(StoredTrace {
        id: row.try_get("id").map_err(db_err)?,
        inference_call_id: row.try_get("inference_call_id").map_err(db_err)?,
        trace,
        created_at: row.try_get("recorded_at").map_err(db_err)?,
    })
}
