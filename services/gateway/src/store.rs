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

/// Deserialize a `Capability` from its serde snake_case string.
fn str_to_capability(s: &str) -> Result<Capability, GatewayError> {
    serde_json::from_value(serde_json::Value::String(s.to_owned()))
        .map_err(GatewayError::Serialization)
}

fn status_str(s: &CallStatus) -> &'static str {
    match s {
        CallStatus::Success => "success",
        CallStatus::Failed => "failed",
    }
}

fn str_to_status(s: &str) -> CallStatus {
    match s {
        "failed" => CallStatus::Failed,
        _ => CallStatus::Success,
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

        // GH-5 attribution (§D Phase 5): `subject_id` is the resolved node id → `budget_node_id`,
        // which == its `org_unit_id` (DC-1). The recursive CTE walks that unit's ancestor path over
        // `core.org_units.parent_id` and denormalizes it into `{org,dept,team,user}_node_id` (by tier
        // `level`: 0=org, 1=dept, 2=team, 3/4=user/service) so the per-scope spend rollups (P12) need no
        // recursive join. The stored ids are org_unit ids (== node ids), so historical ledger rows stay
        // valid — no data migration; P6 renames the column to org_unit_id. NULL subject → empty CTE →
        // NULL path columns (aggregate over 0 rows).
        sqlx::query(
            r#"
            WITH RECURSIVE anc AS (
                SELECT id, parent_id, level
                  FROM core.org_units
                 WHERE tenant_id = $1 AND id = $18
                UNION ALL
                SELECT b.id, b.parent_id, b.level
                  FROM core.org_units b
                  JOIN anc ON b.id = anc.parent_id
                 WHERE b.tenant_id = $1
            )
            INSERT INTO public.inference_calls
                (tenant_id, id, session_id, project_id, capability, chain_id,
                 adapter, model, api_model_id,
                 input_tokens, output_tokens, cost_usd, duration_ms,
                 status, error_type, fallback_sequence, recorded_at,
                 budget_node_id, org_node_id, dept_node_id, team_node_id, user_node_id,
                 execution_location)
            SELECT
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9,
                $10, $11, $12, $13,
                $14::metering.call_status, $15, $16, $17,
                $18,
                (SELECT id FROM anc WHERE level = 0 LIMIT 1),
                (SELECT id FROM anc WHERE level = 1 LIMIT 1),
                (SELECT id FROM anc WHERE level = 2 LIMIT 1),
                (SELECT id FROM anc WHERE level IN (3, 4) LIMIT 1),
                $19::core.execution_location
            "#,
        )
        .bind(self.tenant_id)
        .bind(call.id)
        .bind(call.session_id)
        .bind(call.project_id)
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
        .execute(&self.pool)
        .await
        .map_err(db_err)?;

        Ok(call.id)
    }

    async fn get_inference_calls_by_session(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<InferenceCall>, GatewayError> {
        let rows = sqlx::query(
            r#"
            SELECT id, session_id, project_id, capability, chain_id,
                   adapter, model, api_model_id,
                   input_tokens, output_tokens,
                   cost_usd::float8 AS cost_usd,
                   duration_ms, status::text AS status, error_type,
                   fallback_sequence, recorded_at
            FROM public.inference_calls
            WHERE tenant_id = $1 AND session_id = $2
            ORDER BY recorded_at ASC
            "#,
        )
        .bind(self.tenant_id)
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;

        rows.iter().map(row_to_inference_call).collect()
    }

    // -----------------------------------------------------------------------
    // Spend aggregates
    // -----------------------------------------------------------------------

    async fn get_spend_since(&self, since: DateTime<Utc>) -> Result<f64, GatewayError> {
        let row = sqlx::query(
            r#"
            SELECT COALESCE(SUM(cost_usd), 0)::float8 AS total
            FROM public.inference_calls
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
            SELECT model, COALESCE(SUM(cost_usd), 0)::float8 AS total
            FROM public.inference_calls
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
            INSERT INTO public.execution_traces
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
            FROM public.execution_traces
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
            FROM public.execution_traces
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

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

fn row_to_inference_call(row: &sqlx::postgres::PgRow) -> Result<InferenceCall, GatewayError> {
    let capability_str: String = row.try_get("capability").map_err(db_err)?;
    let status_str_val: String = row.try_get("status").map_err(db_err)?;

    let input_tokens: Option<i32> = row.try_get("input_tokens").map_err(db_err)?;
    let output_tokens: Option<i32> = row.try_get("output_tokens").map_err(db_err)?;
    let duration_ms: i64 = row.try_get("duration_ms").map_err(db_err)?;
    let fallback_sequence: i16 = row.try_get("fallback_sequence").map_err(db_err)?;

    Ok(InferenceCall {
        id: row.try_get("id").map_err(db_err)?,
        session_id: row.try_get("session_id").map_err(db_err)?,
        project_id: row.try_get("project_id").map_err(db_err)?,
        // MIG-2 (v0.4.6): budget/quota attribution columns land in F1-rework RW7;
        // until then the row-reader yields None (no crate-side subject attribution).
        subject_id: None,
        tier: None,
        capability: str_to_capability(&capability_str)?,
        chain_id: row.try_get("chain_id").map_err(db_err)?,
        adapter: row.try_get("adapter").map_err(db_err)?,
        model: row.try_get("model").map_err(db_err)?,
        api_model_id: row.try_get("api_model_id").map_err(db_err)?,
        input_tokens: input_tokens.map(|v| v as u32),
        output_tokens: output_tokens.map(|v| v as u32),
        cost_usd: row.try_get("cost_usd").map_err(db_err)?,
        duration_ms: duration_ms as u64,
        status: str_to_status(&status_str_val),
        error_type: row.try_get("error_type").map_err(db_err)?,
        fallback_sequence: fallback_sequence as u8,
        recorded_at: row.try_get("recorded_at").map_err(db_err)?,
    })
}

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
