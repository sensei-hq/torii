//! TM-7 (torii#25): the Postgres-only properties the conformance suite cannot express —
//! concurrency, locks, the format fence, prune safety. Ported from the gateway's
//! `orchestrator-store/src/postgres.rs` tests (SP-DATA-1..4.1, SP-OPS-1.4), retargeted at the
//! tenant-scoped schema. Each test owns a fresh tenant, which replaces the gateway's shared
//! `config_guard`/`scheduler_guard` locks and table truncation.
mod common;
use chrono::{DateTime, Duration, Utc};
use common::{Tenant, pool};
use orchestrator_core::{
    AgentBacking, AgentDefinition, ConfigSource, ConfigStore, ContentStore, EffectClass,
    ExecutionJournal, Graph, JournalError, JournalEvent, NetworkPolicy, Permissions,
    RegistryConfig, RunId, RunStatus, SchedulerStore, SkillDef, ToolSpec,
};
use sqlx::PgPool;
use std::collections::HashMap;

fn run() -> RunId {
    RunId(uuid::Uuid::new_v4())
}

fn started() -> JournalEvent {
    JournalEvent::RunStarted {
        version: "v1".into(),
        budget: None,
        money_budget: None,
    }
}

fn skill(name: &str) -> SkillDef {
    SkillDef {
        name: name.into(),
        description: None,
        body: format!("body of {name}"),
        activation: Default::default(),
    }
}

fn cfg_with_skill(name: &str) -> RegistryConfig {
    RegistryConfig {
        skills: vec![skill(name)],
        ..Default::default()
    }
}

fn cfg_tool(name: &str) -> ToolSpec {
    ToolSpec {
        name: name.into(),
        description: Some("d".into()),
        input_schema: serde_json::json!({"type": "object"}),
        effect_class: EffectClass::Pure,
        ttl_secs: None,
        source: None,
        permissions: Default::default(),
        activation: Default::default(),
        credentials: Default::default(),
    }
}

fn sg() -> Graph {
    Graph { nodes: vec![] }
}

fn ts(secs: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(secs, 0).unwrap()
}

async fn backend_pid(conn: &mut sqlx::PgConnection) -> i32 {
    let (pid,): (i32,) = sqlx::query_as("select pg_backend_pid()")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    pid
}

/// Block until some backend is waiting specifically on `holder_pid` — deterministic
/// interleaving, not sleep-and-hope. `pg_blocking_pids`, not `pg_locks where not granted`
/// (instance-global: an unrelated waiter would return early and turn a red into a green).
async fn wait_until_blocked_by(pool: &PgPool, holder_pid: i32) {
    for _ in 0..200 {
        let (n,): (i64,) = sqlx::query_as(
            "select count(*) from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
        )
        .bind(holder_pid)
        .fetch_one(pool)
        .await
        .unwrap();
        if n > 0 {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    panic!("no backend ever blocked on connection {holder_pid} — the interleaving never happened");
}

/// The four registry tables, in the store's replace-all order.
const REGISTRY_TABLES: [&str; 4] = [
    "registry.agents",
    "registry.skills",
    "registry.tools",
    "registry.chain_bindings",
];

// ---- journal ------------------------------------------------------------------------------

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn an_incompatible_format_version_fences_load_and_load_since() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let j = t.journal();
    let r = run();
    j.append(r, started()).await.unwrap();
    // Simulate a journal written by an older scheme.
    sqlx::query("update runs.runs set format_version = -999 where tenant_id = $1 and run_id = $2")
        .bind(t.id)
        .bind(r.0)
        .execute(&pool)
        .await
        .unwrap();
    let err = j.load(r).await.unwrap_err();
    assert!(
        matches!(err, JournalError::IncompatibleFormat { stored: -999, .. }),
        "must fence loudly, got {err:?}"
    );
    assert!(matches!(
        j.load_since(r, 0).await.unwrap_err(),
        JournalError::IncompatibleFormat { .. }
    ));
    t.drop_tenant().await;
}

// ---- drive lock ---------------------------------------------------------------------------

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_run_drive_lock_excludes_another_session_and_is_retakeable() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let (a, b) = (
        t.scheduler(),
        Tenant {
            id: t.id,
            pool: common::pool().await.unwrap(),
        }
        .scheduler(),
    );
    let r = run();
    let held = a
        .try_lock_run(r)
        .await
        .unwrap()
        .expect("uncontended run locks");
    assert!(
        b.try_lock_run(r).await.unwrap().is_none(),
        "a second session must NOT get the same run's drive lock"
    );
    assert!(
        b.try_lock_run(run()).await.unwrap().is_some(),
        "locks are per-run"
    );
    held.release().await.unwrap();
    assert!(
        b.try_lock_run(r).await.unwrap().is_some(),
        "released ⇒ re-takeable; a pooled (non-detached) connection would leak it here"
    );
    t.drop_tenant().await;
}

/// The property that forces a detached connection: a lock DROPPED without `release` (a
/// panicking drive) still frees the run. `release` unlocks explicitly, so only this path
/// distinguishes detached from pooled.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_dropped_run_lock_is_released_without_an_explicit_release() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let a = t.scheduler();
    let b = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .scheduler();
    let r = run();
    drop(a.try_lock_run(r).await.unwrap().expect("locks"));
    let mut freed = false;
    for _ in 0..50 {
        if b.try_lock_run(r).await.unwrap().is_some() {
            freed = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(
        freed,
        "a dropped lock must free the run; a pooled connection strands it"
    );
    t.drop_tenant().await;
}

// ---- scheduler ----------------------------------------------------------------------------

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn claim_due_is_exactly_once_under_concurrent_claims() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let s = t.scheduler();
    let r = run();
    let now = ts(2_000_000);
    s.enqueue(r, &sg(), now).await.unwrap();
    s.record_paused(r, Some(now), "gated").await.unwrap();
    let (a, b) = tokio::join!(
        s.claim_due(now, Duration::seconds(60), 10),
        s.claim_due(now, Duration::seconds(60), 10),
    );
    let got = a
        .unwrap()
        .iter()
        .chain(b.unwrap().iter())
        .filter(|(x, _)| *x == r)
        .count();
    assert_eq!(
        got, 1,
        "a due run is claimed by exactly one of two concurrent claimers"
    );
    t.drop_tenant().await;
}

/// `claim_due` claims at most `limit`, whatever plan Postgres picks. `UPDATE … WHERE run_id IN
/// (SELECT … LIMIT n FOR UPDATE SKIP LOCKED)` is planned as a nested-loop semi join when this
/// tenant has a few rows in a table populated by others, and that RE-RUNS the limited subquery
/// per outer row — one claim took 3 of 3 due runs at `limit = 2`, handing a worker drives it
/// never asked for. The other tenants' rows (and fresh statistics) make that plan the likely one.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn claim_due_never_claims_more_than_its_limit_in_a_populated_table() {
    let Some(pool) = pool().await else { return };
    let others = Tenant::new(&pool).await;
    let filler = others.scheduler();
    for _ in 0..80 {
        filler.enqueue(run(), &sg(), ts(2_300_000)).await.unwrap();
    }
    sqlx::query("analyze runs.scheduled_runs")
        .execute(&pool)
        .await
        .unwrap();

    let t = Tenant::new(&pool).await;
    let s = t.scheduler();
    let now = ts(2_300_000);
    for _ in 0..3 {
        let r = run();
        s.enqueue(r, &sg(), now).await.unwrap();
        s.record_paused(r, Some(now), "batch").await.unwrap();
    }
    assert_eq!(
        s.claim_due(now, Duration::seconds(60), 2)
            .await
            .unwrap()
            .len(),
        2,
        "claim_due must claim at most `limit` — never every due run"
    );
    assert_eq!(
        s.claim_due(now, Duration::seconds(60), 2)
            .await
            .unwrap()
            .len(),
        1,
        "the remaining due run is claimed by the next sweep"
    );
    t.drop_tenant().await;
    others.drop_tenant().await;
}

/// The exactly-once gate needs the claimers to actually OVERLAP: a row another claimer holds
/// must be SKIPPED, not waited on and not claimed again. An open transaction holds the row lock
/// exactly as a concurrent `claim_due` does between its select and its commit. Without
/// `FOR UPDATE SKIP LOCKED` this claim blocks on the lock and then double-claims the run.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn claim_due_skips_a_row_another_claimer_holds() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let s = t.scheduler();
    let r = run();
    let now = ts(2_400_000);
    s.enqueue(r, &sg(), now).await.unwrap();
    s.record_paused(r, Some(now), "gated").await.unwrap();

    let mut other = pool.begin().await.unwrap();
    sqlx::query(
        "select run_id from runs.scheduled_runs where tenant_id = $1 and run_id = $2 for update",
    )
    .bind(t.id)
    .bind(r.0)
    .fetch_one(&mut *other)
    .await
    .unwrap();
    let got = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        s.claim_due(now, Duration::seconds(60), 10),
    )
    .await
    .expect("a held row must be SKIPPED, not waited on")
    .unwrap();
    assert!(
        got.is_empty(),
        "a row another claimer holds is not claimed again: {got:?}"
    );
    other.rollback().await.unwrap();
    assert_eq!(
        s.claim_due(now, Duration::seconds(60), 10)
            .await
            .unwrap()
            .len(),
        1,
        "released ⇒ claimable"
    );
    t.drop_tenant().await;
}

/// The CAS stores arbitrary bytes exactly — binary tool output is not UTF-8.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn the_content_store_round_trips_arbitrary_binary_bytes() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let raw: Vec<u8> = vec![
        0x00, 0xFF, 0xDE, 0xAD, 0xBE, 0xEF, 0x80, 0xC3, 0x28, 0x00, 0x7F,
    ];
    let d = t.content().put(&raw).await.unwrap();
    assert_eq!(t.content().get(&d).await.unwrap(), raw);
    t.drop_tenant().await;
}

/// Agents and tools carry NESTED structure (a grants map of `Permissions`, an input schema,
/// credentials); the jsonb round-trip must preserve it exactly, not just a row with the name.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn agents_and_tools_round_trip_through_jsonb_including_nested_fields() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let mut grants = HashMap::new();
    grants.insert(
        "fetch".to_string(),
        Permissions {
            paths: vec!["/w".into()],
            commands: vec![],
            network: NetworkPolicy::Hosts(vec!["x.example.com".into()]),
            caps: Default::default(),
        },
    );
    let agent = AgentDefinition {
        default_planner: false,
        name: "researcher".into(),
        area: "research".into(),
        kind: "reasoning".into(),
        chain: Some("c".into()),
        chains: HashMap::new(),
        grants,
        tools: vec!["fetch".into()],
        skills: vec!["concise".into()],
        system_prompt: "be careful".into(),
        backed_by: AgentBacking::Model,
        tool_limits: HashMap::new(),
        confirm_tools: vec![],
        confirm_timeout: None,
        escalate_to: None,
    };
    let input_schema = serde_json::json!({"type":"object","properties":{"q":{"type":"string"}}});
    let tool = ToolSpec {
        name: "fetch".into(),
        description: Some("does a thing".into()),
        input_schema: input_schema.clone(),
        effect_class: EffectClass::Observation,
        ttl_secs: Some(60),
        source: Some("web".into()),
        permissions: Permissions {
            paths: vec!["/w".into()],
            commands: vec!["ls".into()],
            network: NetworkPolicy::Deny,
            caps: Default::default(),
        },
        activation: Default::default(),
        credentials: vec!["api-key".into()],
    };
    t.config()
        .store_and_bump(&RegistryConfig {
            agents: vec![agent],
            tools: vec![tool],
            ..Default::default()
        })
        .await
        .unwrap();

    let got = t.config().load().await.unwrap();
    let a = got
        .agents
        .iter()
        .find(|a| a.name == "researcher")
        .expect("agent round-trips");
    assert_eq!(a.tools, vec!["fetch".to_string()]);
    assert_eq!(a.skills, vec!["concise".to_string()]);
    assert_eq!(a.system_prompt, "be careful");
    let grant = a.grants.get("fetch").expect("grants map entry survives");
    assert_eq!(grant.paths, vec!["/w".to_string()]);
    assert_eq!(
        grant.network,
        NetworkPolicy::Hosts(vec!["x.example.com".into()])
    );
    let tl = got
        .tools
        .iter()
        .find(|x| x.name == "fetch")
        .expect("tool round-trips");
    assert_eq!(tl.input_schema, input_schema);
    assert_eq!(tl.credentials, vec!["api-key".to_string()]);
    assert_eq!(tl.permissions.commands, vec!["ls".to_string()]);
    assert_eq!(tl.effect_class, EffectClass::Observation);
    assert_eq!(tl.ttl_secs, Some(60));
    t.drop_tenant().await;
}

/// Replace-all means ALL four tables: a publish that retires a tool, a binding or an agent
/// removes it — a leftover tool stays available to agents.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_publish_replaces_every_registry_table_not_just_skills() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let full = RegistryConfig {
        agents: vec![AgentDefinition {
            default_planner: false,
            name: "gone-agent".into(),
            area: "a".into(),
            kind: "k".into(),
            chain: None,
            chains: HashMap::new(),
            grants: HashMap::new(),
            tools: vec![],
            skills: vec![],
            system_prompt: String::new(),
            backed_by: AgentBacking::Model,
            tool_limits: HashMap::new(),
            confirm_tools: vec![],
            confirm_timeout: None,
            escalate_to: None,
        }],
        skills: vec![skill("gone-skill")],
        tools: vec![cfg_tool("gone-tool")],
        chain_bindings: vec![orchestrator_core::ChainBinding {
            area: "a".into(),
            kind: "k".into(),
            chain: "gone-chain".into(),
        }],
    };
    t.config().store_and_bump(&full).await.unwrap();
    let before = t.config().load().await.unwrap();
    assert_eq!(
        (
            before.agents.len(),
            before.skills.len(),
            before.tools.len(),
            before.chain_bindings.len()
        ),
        (1, 1, 1, 1),
        "the seed landed in all four tables"
    );
    t.config()
        .store_and_bump(&RegistryConfig::default())
        .await
        .unwrap();
    let after = t.config().load().await.unwrap();
    assert!(after.agents.is_empty(), "a retired agent is removed");
    assert!(after.skills.is_empty(), "a retired skill is removed");
    assert!(after.tools.is_empty(), "a retired tool is removed");
    assert!(
        after.chain_bindings.is_empty(),
        "a retired binding is removed"
    );
    t.drop_tenant().await;
}

/// THE prune safety property: ancient `paused` (timed AND NULL-deadline) and `waking` rows
/// survive a cutoff decades past them; only aged terminal rows go, and the preview matches.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn prune_terminal_deletes_old_terminal_rows_and_never_a_live_one() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let s = t.scheduler();
    let (old, cutoff, recent) = (ts(45_000_000), ts(45_100_000), ts(45_200_000));
    let (done, failed, cancelled, fresh) = (run(), run(), run(), run());
    let (timed, in_doubt, waking) = (run(), run(), run());
    for r in [done, failed, cancelled, fresh, timed, in_doubt, waking] {
        s.enqueue(r, &sg(), old).await.unwrap();
    }
    s.record_terminal(done, RunStatus::Completed, None)
        .await
        .unwrap();
    s.record_terminal(failed, RunStatus::Failed, Some("boom"))
        .await
        .unwrap();
    s.cancel(cancelled).await.unwrap();
    s.record_terminal(fresh, RunStatus::Completed, None)
        .await
        .unwrap();
    s.record_paused(timed, Some(old), "quota").await.unwrap();
    s.record_paused(in_doubt, None, "in-doubt mutation")
        .await
        .unwrap();
    let age = |r: RunId, at: DateTime<Utc>| {
        let pool = pool.clone();
        let tenant = t.id;
        async move {
            sqlx::query(
                "update runs.scheduled_runs set updated_at = $3 where tenant_id = $1 and run_id = $2",
            )
            .bind(tenant)
            .bind(r.0)
            .bind(at)
            .execute(&pool)
            .await
            .unwrap();
        }
    };
    for r in [done, failed, cancelled, timed, in_doubt, waking] {
        age(r, old).await;
    }
    age(fresh, recent).await;

    let counted = s.count_terminal_before(cutoff).await.unwrap();
    assert_eq!(
        counted, 3,
        "exactly the three aged terminal rows are previewed"
    );
    assert_eq!(
        s.prune_terminal(cutoff).await.unwrap(),
        counted,
        "preview == effect"
    );
    for r in [done, failed, cancelled] {
        assert!(
            s.status(r).await.unwrap().is_none(),
            "an aged terminal row is gone"
        );
    }
    assert_eq!(
        s.status(fresh).await.unwrap().unwrap().status,
        RunStatus::Completed
    );
    assert_eq!(
        s.status(timed).await.unwrap().unwrap().status,
        RunStatus::Paused
    );
    let survivor = s.status(in_doubt).await.unwrap().unwrap();
    assert_eq!(
        survivor.status,
        RunStatus::Paused,
        "deleting an in-doubt pause is data loss"
    );
    assert_eq!(survivor.next_wake, None);
    assert_eq!(
        s.status(waking).await.unwrap().unwrap().status,
        RunStatus::Waking
    );
    assert_eq!(s.count_terminal_before(cutoff).await.unwrap(), 0);
    t.drop_tenant().await;
}

/// AG-3 (torii#53): `run status` reports a run's consecutive wake attempts, which the
/// `SchedulerStore` trait does not expose — `wake_attempts` reads the counter the trait's
/// methods keep, for THIS tenant only. Pinned through the trait's own transitions (enqueue =
/// 1, begin_wake_attempt + 1, record_wake_failed unchanged, record_paused resets to 0) rather
/// than a hand-written row, so the reader cannot drift from the writers.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn wake_attempts_reads_the_counter_the_scheduler_keeps_for_this_tenant_only() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let other = Tenant::new(&pool).await;
    let s = t.scheduler();
    let r = run();
    assert_eq!(
        s.wake_attempts(r).await.unwrap(),
        None,
        "an unknown run has no count"
    );
    s.enqueue(r, &sg(), ts(0)).await.unwrap();
    assert_eq!(
        s.wake_attempts(r).await.unwrap(),
        Some(1),
        "submit's inline drive is attempt 1"
    );
    let retry = |_: u32| ts(100);
    s.begin_wake_attempt(r, &retry).await.unwrap();
    s.record_wake_failed(r, ts(100), "boom").await.unwrap();
    assert_eq!(
        s.wake_attempts(r).await.unwrap(),
        Some(2),
        "a counted attempt that failed stays counted"
    );
    assert_eq!(
        other.scheduler().wake_attempts(r).await.unwrap(),
        None,
        "another tenant never sees this tenant's run"
    );
    s.claim_due(ts(100), Duration::seconds(60), 10)
        .await
        .unwrap();
    s.begin_wake_attempt(r, &retry).await.unwrap();
    s.record_paused(r, None, "gated").await.unwrap();
    assert_eq!(
        s.wake_attempts(r).await.unwrap(),
        Some(0),
        "a successful drive resets the count"
    );
    other.drop_tenant().await;
    t.drop_tenant().await;
}

// ---- registry config: atomicity + CAS -----------------------------------------------------

/// Two concurrent `store_and_bump`s must never MERGE their content: both writers bump FIRST
/// (the per-tenant generation lock), so the loser's replace-all `DELETE` runs after the winner
/// commits and removes its rows — true last-writer-wins.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn concurrent_store_and_bumps_do_not_merge_their_content() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    let v0 = src
        .store_and_bump(&RegistryConfig::default())
        .await
        .unwrap();

    // Writer A: a transaction shaped exactly like `store_and_bump`, held open.
    let mut a = pool.begin().await.unwrap();
    let a_pid = backend_pid(&mut a).await;
    let (va,): (i64,) = sqlx::query_as("select registry.bump_generation($1, null)")
        .bind(t.id)
        .fetch_one(&mut *a)
        .await
        .unwrap();
    for tbl in REGISTRY_TABLES {
        sqlx::query(&format!("delete from {tbl} where tenant_id = $1"))
            .bind(t.id)
            .execute(&mut *a)
            .await
            .unwrap();
    }
    sqlx::query("insert into registry.skills (tenant_id, name, def) values ($1, $2, $3)")
        .bind(t.id)
        .bind("a1")
        .bind(serde_json::to_value(skill("a1")).unwrap())
        .execute(&mut *a)
        .await
        .unwrap();

    // Writer B: a real `store_and_bump` on its own connection — must block until A commits.
    let writer = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let b = tokio::spawn(async move { writer.store_and_bump(&cfg_with_skill("b1")).await });
    wait_until_blocked_by(&pool, a_pid).await;
    assert!(!b.is_finished(), "B must not commit before A does");
    a.commit().await.unwrap();
    let vb = b
        .await
        .unwrap()
        .expect("the losing writer still reports success");

    let (cfg, generation) = src.load_versioned().await.unwrap();
    let names: Vec<&str> = cfg.skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["b1"],
        "last-writer-wins, never the union of both"
    );
    assert_eq!(va as u64, v0 + 1);
    assert_eq!(vb, v0 + 2, "B's bump serialized after A's");
    assert_eq!(generation, Some(v0 + 2));
    t.drop_tenant().await;
}

/// Two shared names in opposite insert order is the deadlock shape (`40P01`) when writers do
/// not serialize first; a distinct name each makes a merge visible.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_writers_with_overlapping_names_neither_deadlock_nor_merge() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    src.store_and_bump(&RegistryConfig::default())
        .await
        .unwrap();
    let cfg_of = |own: &str, reversed: bool| RegistryConfig {
        skills: if reversed {
            vec![skill("s_2"), skill("s_1"), skill(own)]
        } else {
            vec![skill("s_1"), skill("s_2"), skill(own)]
        },
        ..Default::default()
    };
    let (one, two) = (cfg_of("a_x", false), cfg_of("b_y", true));
    let wa = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let wb = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    for round in 0..10 {
        let (a, b) = (wa.clone(), wb.clone());
        let (o, tw) = (one.clone(), two.clone());
        let ha = tokio::spawn(async move { a.store_and_bump(&o).await });
        let hb = tokio::spawn(async move { b.store_and_bump(&tw).await });
        ha.await
            .unwrap()
            .unwrap_or_else(|e| panic!("round {round}: A failed: {e:?}"));
        hb.await
            .unwrap()
            .unwrap_or_else(|e| panic!("round {round}: B failed: {e:?}"));
        let (cfg, _) = src.load_versioned().await.unwrap();
        let mut names: Vec<&str> = cfg.skills.iter().map(|s| s.name.as_str()).collect();
        names.sort_unstable();
        assert!(
            names == ["a_x", "s_1", "s_2"] || names == ["b_y", "s_1", "s_2"],
            "round {round}: content must be exactly one writer's config, got {names:?}"
        );
    }
    t.drop_tenant().await;
}

/// `load_versioned` ITSELF returns a consistent pair with a writer committing in the middle
/// of its read. Holding `access exclusive` on `registry.tools` (the third table read) lets
/// the reader snapshot on its first read and block on its third; under REPEATABLE READ it
/// must still return the entirely old world. Asserts on `load_versioned`'s own return.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn load_versioned_returns_a_consistent_pair_despite_a_writer_committing_mid_read() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    let seed = RegistryConfig {
        skills: vec![skill("old")],
        tools: vec![cfg_tool("t_old")],
        ..Default::default()
    };
    let v0 = src.store_and_bump(&seed).await.unwrap();

    let gate_pool = common::pool().await.unwrap();
    let mut w = gate_pool.begin().await.unwrap();
    let w_pid = backend_pid(&mut w).await;
    sqlx::query("lock table registry.tools in access exclusive mode")
        .execute(&mut *w)
        .await
        .unwrap();

    let reader = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let r = tokio::spawn(async move { reader.load_versioned().await });
    wait_until_blocked_by(&pool, w_pid).await;
    assert!(
        !r.is_finished(),
        "the reader must still be mid-read when the writer commits"
    );

    let (vw,): (i64,) = sqlx::query_as("select registry.bump_generation($1, null)")
        .bind(t.id)
        .fetch_one(&mut *w)
        .await
        .unwrap();
    for tbl in REGISTRY_TABLES {
        sqlx::query(&format!("delete from {tbl} where tenant_id = $1"))
            .bind(t.id)
            .execute(&mut *w)
            .await
            .unwrap();
    }
    sqlx::query("insert into registry.skills (tenant_id, name, def) values ($1, 'new', $2)")
        .bind(t.id)
        .bind(serde_json::to_value(skill("new")).unwrap())
        .execute(&mut *w)
        .await
        .unwrap();
    sqlx::query("insert into registry.tools (tenant_id, name, spec) values ($1, 't_new', $2)")
        .bind(t.id)
        .bind(serde_json::to_value(cfg_tool("t_new")).unwrap())
        .execute(&mut *w)
        .await
        .unwrap();
    w.commit().await.unwrap();

    let (cfg, ver) = r.await.unwrap().expect("the read itself must succeed");
    assert_eq!(
        ver,
        Some(v0),
        "the generation matches the content read, not the writer's"
    );
    let tools: Vec<&str> = cfg.tools.iter().map(|x| x.name.as_str()).collect();
    let skills: Vec<&str> = cfg.skills.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(
        tools,
        vec!["t_old"],
        "tools read AFTER the commit come from the snapshot"
    );
    assert_eq!(
        skills,
        vec!["old"],
        "and agree with the skills read before it"
    );
    assert_eq!(vw as u64, v0 + 1, "the writer really did advance the world");
    t.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_failed_store_and_bump_leaves_content_and_generation_untouched() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    src.store_and_bump(&cfg_with_skill("stable")).await.unwrap();
    let (before_cfg, before_v) = src.load_versioned().await.unwrap();
    let mut bad = cfg_with_skill("stable");
    bad.tools = vec![cfg_tool("dup"), cfg_tool("dup")]; // duplicate PK → the txn aborts
    assert!(src.store_and_bump(&bad).await.is_err());
    let (after_cfg, after_v) = src.load_versioned().await.unwrap();
    assert_eq!(
        after_v, before_v,
        "generation must not advance on a failed write"
    );
    assert_eq!(after_cfg.skills.len(), before_cfg.skills.len());
    assert!(after_cfg.tools.is_empty());
    t.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn store_and_bump_if_refuses_at_an_unexpected_generation() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    let v = src.store_and_bump(&cfg_with_skill("base")).await.unwrap();
    let refused = src
        .store_and_bump_if(&cfg_with_skill("should-not-land"), v - 1)
        .await
        .unwrap();
    assert!(refused.is_none(), "a stale expectation must not apply");
    let (cfg, now) = src.load_versioned().await.unwrap();
    assert_eq!(now, Some(v));
    assert!(
        cfg.skills.iter().any(|s| s.name == "base"),
        "content unchanged on refusal"
    );
    let applied = src
        .store_and_bump_if(&cfg_with_skill("landed"), v)
        .await
        .unwrap()
        .expect("the matching expectation must apply");
    assert_eq!(applied, v + 1);
    let (cfg, now) = src.load_versioned().await.unwrap();
    assert_eq!(now, Some(v + 1));
    assert!(cfg.skills.iter().any(|s| s.name == "landed"));
    t.drop_tenant().await;
}

/// A tenant whose `config_versions` row already exists because ANOTHER component bumped it
/// (catalog, routing…) is still at registry generation 0, and its first push at 0 lands.
/// Also: the publish advances the tenant's overall config version, so torii's config
/// snapshot sees it.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_first_push_lands_when_another_component_already_created_the_version_row() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let src = t.config();
    sqlx::query("select config.bump_config_version($1, 'catalog')")
        .bind(t.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        src.version().await.unwrap(),
        Some(0),
        "the row is present; registry gen is 0"
    );
    let overall = |pool: PgPool, id| async move {
        let (v,): (i64,) =
            sqlx::query_as("select version from config.config_versions where tenant_id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        v
    };
    let before = overall(pool.clone(), t.id).await;
    assert_eq!(
        src.store_and_bump_if(&cfg_with_skill("first"), 0)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        overall(pool.clone(), t.id).await,
        before + 1,
        "the overall version moved too"
    );
    t.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn concurrent_first_pushes_do_not_both_land() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let a = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let b = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let (ba, bb) = (barrier.clone(), barrier.clone());
    let ha = tokio::spawn(async move {
        ba.wait().await;
        a.store_and_bump_if(&cfg_with_skill("racer-a"), 0).await
    });
    let hb = tokio::spawn(async move {
        bb.wait().await;
        b.store_and_bump_if(&cfg_with_skill("racer-b"), 0).await
    });
    let (ra, rb) = (ha.await.unwrap().unwrap(), hb.await.unwrap().unwrap());
    assert_eq!(
        [ra, rb].iter().filter(|r| r.is_some()).count(),
        1,
        "exactly one concurrent first push may land: a={ra:?} b={rb:?}"
    );
    let (cfg, now) = t.config().load_versioned().await.unwrap();
    assert_eq!(now, Some(1), "the generation advances exactly once");
    let winner = if ra.is_some() { "racer-a" } else { "racer-b" };
    let names: Vec<&str> = cfg.skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        vec![winner],
        "the durable content is the winner's alone"
    );
    t.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn concurrent_pushes_at_the_same_nonzero_generation_do_not_both_land() {
    let Some(pool) = pool().await else { return };
    let t = Tenant::new(&pool).await;
    let v0 = t
        .config()
        .store_and_bump(&cfg_with_skill("seed"))
        .await
        .unwrap();
    let a = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let b = Tenant {
        id: t.id,
        pool: common::pool().await.unwrap(),
    }
    .config();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let (ba, bb) = (barrier.clone(), barrier.clone());
    let ha = tokio::spawn(async move {
        ba.wait().await;
        a.store_and_bump_if(&cfg_with_skill("nz-a"), v0).await
    });
    let hb = tokio::spawn(async move {
        bb.wait().await;
        b.store_and_bump_if(&cfg_with_skill("nz-b"), v0).await
    });
    let (ra, rb) = (ha.await.unwrap().unwrap(), hb.await.unwrap().unwrap());
    assert_eq!(
        [ra, rb].iter().filter(|r| r.is_some()).count(),
        1,
        "exactly one push at the same generation may land: a={ra:?} b={rb:?}"
    );
    let (cfg, now) = t.config().load_versioned().await.unwrap();
    assert_eq!(now, Some(v0 + 1));
    let winner = if ra.is_some() { "nz-a" } else { "nz-b" };
    let names: Vec<&str> = cfg.skills.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec![winner]);
    t.drop_tenant().await;
}
