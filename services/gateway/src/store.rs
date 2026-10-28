//! `PgGatewayStore` — the Postgres `GatewayStore`.
//!
//! **Moved to `torii_core::metering` (System One §9.2)**, not deleted: the operator CLI's run
//! executor needs the same ledger write, and a second implementation there would drift from
//! this one. It is re-exported here so `crate::store::PgGatewayStore` keeps resolving for
//! every route, and so the DB test below still exercises the real write through the real
//! type.

pub use torii_core::metering::PgGatewayStore;

#[cfg(test)]
mod tests {
    use super::PgGatewayStore;
    use chrono::Utc;
    use gateway::store::{CallStatus, GatewayStore, InferenceCall};
    use gateway::types::capability::Capability;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    fn call(adapter: &str, model: &str, api_model_id: Option<&str>) -> InferenceCall {
        InferenceCall {
            id: Uuid::new_v4(),
            session_id: None,
            project_id: None,
            subject_id: None,
            tier: None,
            capability: Capability::TextChat,
            chain_id: Some("chat".into()),
            adapter: adapter.into(),
            model: model.into(),
            api_model_id: api_model_id.map(Into::into),
            input_tokens: Some(10),
            output_tokens: Some(20),
            cost_usd: 0.01,
            cost_estimated: None,
            duration_ms: 100,
            status: CallStatus::Success,
            error_type: None,
            fallback_sequence: 0,
            recorded_at: Utc::now(),
            run_id: None,
        }
    }

    /// §D LN-3b: `insert_inference_call` resolves (adapter, api_model_id) → the winning catalog
    /// endpoint/model/router FK ids at write (the is_default desc / priority asc lateral), and fails
    /// SOFT — NULL FKs but the call is STILL stored — when the pair matches no active endpoint or the
    /// api_model_id is NULL. A resolution miss must never block a call (billing integrity: record what ran).
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn insert_resolves_catalog_fks_and_fails_soft_on_miss() {
        let pool = pool().await;
        let t = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id,name,slug,modified_by) values ($1,'ln3b',$2,'test')",
        )
        .bind(t)
        .bind(format!("ln3b-{t}"))
        .execute(&pool)
        .await
        .unwrap();
        let store = PgGatewayStore {
            pool: pool.clone(),
            tenant_id: t,
        };

        // The resolution target: the winning seeded anthropic endpoint (+ its model/router).
        let (exp_ep, exp_model, exp_router): (Uuid, Uuid, Uuid) = sqlx::query_as(
            "select me.id, me.model_id, me.router_id from catalog.model_endpoints me \
             join catalog.routers r on r.id=me.router_id \
             where r.name='anthropic' and me.router_model_id='claude-3-5-sonnet-20241022' and me.is_active \
             order by me.is_default desc, me.priority asc limit 1",
        )
        .fetch_one(&pool)
        .await
        .expect("a seeded anthropic endpoint");

        // (1) resolvable → FK ids populated to that endpoint.
        let hit = call("anthropic", "claude", Some("claude-3-5-sonnet-20241022"));
        store.insert_inference_call(&hit).await.expect("insert hit");
        let (ep, m, r): (Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
            "select endpoint_id, model_id, router_id from metering.inference_calls where tenant_id=$1 and id=$2",
        )
        .bind(t)
        .bind(hit.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ep,
            Some(exp_ep),
            "endpoint_id resolves to the winning seeded endpoint"
        );
        assert_eq!(m, Some(exp_model), "model_id resolves from that endpoint");
        assert_eq!(r, Some(exp_router), "router_id resolves from that endpoint");

        // (2) unresolvable api_model_id → FK ids NULL, but the call IS still stored.
        let miss = call("anthropic", "claude", Some("no-such-api-model-zzz"));
        store
            .insert_inference_call(&miss)
            .await
            .expect("insert miss must not block");
        let (present, ep2, m2, r2): (bool, Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
            "select true, endpoint_id, model_id, router_id from metering.inference_calls where tenant_id=$1 and id=$2",
        )
        .bind(t)
        .bind(miss.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(present, "the unresolved call is still recorded (fail-soft)");
        assert_eq!(
            (ep2, m2, r2),
            (None, None, None),
            "a resolution miss leaves the FK cols NULL"
        );

        // (3) NULL api_model_id → also fail-soft NULL (the null-eq predicate matches nothing, no crash).
        let null_amid = call("anthropic", "claude", None);
        store
            .insert_inference_call(&null_amid)
            .await
            .expect("insert null api_model_id");
        let (ep3,): (Option<Uuid>,) = sqlx::query_as(
            "select endpoint_id from metering.inference_calls where tenant_id=$1 and id=$2",
        )
        .bind(t)
        .bind(null_amid.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ep3, None,
            "NULL api_model_id resolves to NULL endpoint (fail-soft)"
        );

        // §D LN-4: cost_estimated snapshots the gateway's pre-call estimate alongside actual cost_usd.
        let mut est = call("anthropic", "claude", Some("claude-3-5-sonnet-20241022"));
        est.cost_estimated = Some(0.042);
        store
            .insert_inference_call(&est)
            .await
            .expect("insert with estimate");
        let (ce,): (Option<f64>,) = sqlx::query_as(
            "select cost_estimated::float8 from metering.inference_calls where tenant_id=$1 and id=$2",
        )
        .bind(t)
        .bind(est.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ce,
            Some(0.042),
            "cost_estimated persists the gateway pre-call estimate"
        );

        sqlx::query("delete from core.tenants where id=$1")
            .bind(t)
            .execute(&pool)
            .await
            .unwrap();
    }
}
