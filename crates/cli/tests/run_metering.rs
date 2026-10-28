//! System One §9.2 and §9.6: a RUN's model calls land in the ledger AND carry a trace.
//!
//! Before §9.2, the executor's gateway had no `GatewayStore`, so a run's calls existed only as
//! `runs.journal_events` — `/v1/requests` showed nothing, `metering.usage_daily` counted
//! nothing, and no row could say which run a call belonged to. Before §9.6 the engine built no
//! `ExecutionTrace` at all, so the ordering explanation — the ranking's category and revision
//! for a decision call — was durable nowhere once the boot log was gone. The claim under test is
//! therefore about ROWS in two tables, which only a real Postgres can make: `DATABASE_URL`-guarded
//! (a conditional `#[ignore]`, see build.rs), and it asserts on the tables, not on a mock.
//!
//! The store is the production `torii_core::metering::PgGatewayStore` the CLI boots with, and
//! the gateway is the engine's own canned double on chain `"c"` — so the path exercised is
//! `executor → gateway → store → ledger + traces`, with only the model faked.

use std::sync::Arc;

use orchestrator::test_support::metered_gateway;
use orchestrator::Executor;
use orchestrator_core::{Graph, Node, NodeId, NodeKind, RunId};
use orchestrator_store::InMemoryJournal;
use torii_core::metering::PgGatewayStore;
use uuid::Uuid;

/// The four columns this test reads back: `(run_id, org_unit_id, input_tokens, output_tokens)`.
/// A `Vec` of them is wider than clippy will spell inline.
type LedgerRow = (Option<Uuid>, Option<Uuid>, Option<i32>, Option<i32>);

fn db_url() -> Option<String> {
    std::env::var("DATABASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

/// The smallest graph that spends a token: one `ModelCall` on the double's chain.
fn one_node_graph() -> Graph {
    Graph {
        nodes: vec![Node {
            id: NodeId("n1".into()),
            kind: NodeKind::ModelCall {
                chain: "c".into(),
                payload: serde_json::json!({ "prompt": "spend one call" }),
            },
            deps: vec![],
        }],
    }
}

/// A tenant with one org root. Removed on drop, so a failing assertion does not leak it into
/// every later run of the suite.
struct Tenant {
    url: String,
    id: Uuid,
    root: Uuid,
}

impl Tenant {
    async fn new(url: &str, pool: &sqlx::PgPool) -> Tenant {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'run-metering')",
        )
        .bind(id)
        .bind(format!("run-metering-{id}"))
        .execute(pool)
        .await
        .expect("create the test tenant");
        sqlx::query(
            "insert into core.unit_levels (tenant_id, level, label) \
             select $1, l, 'L' || l from generate_series(0, 4) l",
        )
        .bind(id)
        .execute(pool)
        .await
        .expect("the test tenant's unit levels");
        let root = Uuid::new_v4();
        sqlx::query(
            "insert into core.org_units (tenant_id, id, parent_id, level, name) \
             values ($1, $2, null, 0, 'Org')",
        )
        .bind(id)
        .bind(root)
        .execute(pool)
        .await
        .expect("the test tenant's org root");
        Tenant {
            url: url.to_string(),
            id,
            root,
        }
    }
}

impl Drop for Tenant {
    fn drop(&mut self) {
        // Best-effort, and off the async runtime: this test may be panicking. The ledger rows
        // and the charge cascade with the tenant (both FKs are ON DELETE CASCADE), so there is
        // nothing else to unpick.
        let (url, tenant) = (self.url.clone(), self.id);
        let _ = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            rt.block_on(async move {
                let Ok(pool) = sqlx::PgPool::connect(&url).await else {
                    return;
                };
                // Its users first (AG-13 issuers): a membership holds the tenant.
                let _ = sqlx::query(
                    "delete from core.profiles where id in \
                       (select profile_id from core.memberships where tenant_id = $1)",
                )
                .bind(tenant)
                .execute(&pool)
                .await;
                let _ = sqlx::query("delete from core.tenants where id = $1")
                    .bind(tenant)
                    .execute(&pool)
                    .await;
            });
        })
        .join();
    }
}

#[tokio::test]
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL; see README, Postgres-backed tests"
)]
async fn a_runs_model_call_lands_in_the_ledger_attributed_to_its_run() {
    let Some(url) = db_url() else {
        // The second guard: built WITH a database, run without one.
        eprintln!(
            "SKIP a_runs_model_call_lands_in_the_ledger_attributed_to_its_run: no DATABASE_URL"
        );
        return;
    };
    let pool = sqlx::PgPool::connect(&url)
        .await
        .expect("connect the test database");
    let tenant = Tenant::new(&url, &pool).await;

    // The charge admission writes at submit: the run is charged to the org root, and that is
    // the unit the ledger row must name. `node_ids` is what attribution reads, so the run's
    // row is inserted before the drive, exactly as `run submit` does.
    let run = RunId(Uuid::new_v4());
    sqlx::query(
        "insert into runs.run_charges \
           (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd) \
         values ($1, $2, $3, array[$4]::uuid[], 1000000)",
    )
    .bind(tenant.id)
    .bind(run.0)
    .bind(Uuid::new_v4())
    .bind(tenant.root)
    .execute(&pool)
    .await
    .expect("the run's charge");

    // The store the CLI boots with — the same type, same pool, same tenant.
    let (gateway, calls) = metered_gateway(Some(kernel::types::cost::TokenUsage {
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15,
    }))
    .await;
    let gateway = Arc::new(gateway.with_store(Arc::new(PgGatewayStore {
        pool: pool.clone(),
        tenant_id: tenant.id,
    })));

    let executor = Executor::new(gateway, Arc::new(InMemoryJournal::new()), "v1");
    let outcome = executor
        .run(run, &one_node_graph())
        .await
        .expect("the run completes");
    assert!(
        outcome.failed.is_none(),
        "the canned gateway cannot fail the run: {:?}",
        outcome.failed
    );
    assert_eq!(calls.lock().unwrap().len(), 1, "exactly one model call");

    let rows: Vec<LedgerRow> = sqlx::query_as(
        "select run_id, org_unit_id, input_tokens, output_tokens \
         from metering.inference_calls where tenant_id = $1",
    )
    .bind(tenant.id)
    .fetch_all(&pool)
    .await
    .expect("read the ledger");

    assert_eq!(
        rows.len(),
        1,
        "one model call must be exactly one ledger row"
    );
    let (row_run, row_unit, input, output) = rows[0];
    assert_eq!(
        row_run,
        Some(run.0),
        "the row names the run that made the call — the whole point of §9.2"
    );
    assert_eq!(
        row_unit,
        Some(tenant.root),
        "and it is attributed to the unit the run's charge is on"
    );
    assert_eq!(
        (input, output),
        (Some(12), Some(3)),
        "the reported usage is the row's, not a placeholder"
    );

    // §9.6: the SAME call's trace. Built by the engine (`execute` is the only place that holds
    // both the routing decision and the candidate lists), persisted through the same store, and
    // linked to the row above — which is what makes a run's decision call explain itself after
    // the fact. The category/revision CONTENT belongs to the engine's own tests (a run's graph
    // builds its requests with no ranking, so nothing here claims a measurement); what a
    // database can prove is that the trace is durable, linked and descriptive.
    let traces: Vec<(Option<Uuid>, serde_json::Value)> = sqlx::query_as(
        "select inference_call_id, trace from metering.execution_traces where tenant_id = $1",
    )
    .bind(tenant.id)
    .fetch_all(&pool)
    .await
    .expect("read the traces");

    assert_eq!(traces.len(), 1, "one model call must be exactly one trace");
    let (linked, trace) = &traces[0];
    let call_id: Uuid =
        sqlx::query_scalar("select id from metering.inference_calls where tenant_id = $1")
            .bind(tenant.id)
            .fetch_one(&pool)
            .await
            .expect("the call's id");

    assert_eq!(
        *linked,
        Some(call_id),
        "the trace names the ledger row it describes, so a run's calls and their traces are \
         one join apart"
    );
    assert_eq!(trace["request_id"], call_id.to_string());
    assert_eq!(
        trace["capability"], "text_chat",
        "the capability is the call's: {trace}"
    );
    assert_eq!(trace["status"], "success", "{trace}");
    assert!(
        trace["duration_ms"].is_number(),
        "the call's own figure, not a second measurement: {trace}"
    );
    assert!(
        !trace["routing"].is_null(),
        "the ordering explanation rides the trace, so 'why this model' is answerable from the \
         run's own record: {trace}"
    );
}
