//! TM-7 (torii#25): two tenants cannot see each other's runs, journal, content, blackboard,
//! schedule or registry config — even when they use the SAME run id, the same content and the
//! same names. The conformance suite proves each store against one tenant; this proves the
//! tenant is part of every key and predicate — each test puts the OTHER tenant's row in exactly
//! the state the acting statement would change, so a dropped `tenant_id` predicate is visible.
mod common;
use chrono::{DateTime, Utc};
use common::{Tenant, pool};
use orchestrator_core::{
    ChainBinding, ConfigSource, ConfigStore, ContentStore, ContextKey, ContextStore,
    ExecutionJournal, Graph, JournalEvent, NodeId, OrchestratorError, RegistryConfig, RunId,
    RunStatus, SchedulerStore, Scope, SkillDef, Snapshot,
};

fn started() -> JournalEvent {
    JournalEvent::RunStarted {
        version: "v1".into(),
        budget: None,
    }
}

fn ts(secs: i64) -> DateTime<Utc> {
    DateTime::<Utc>::from_timestamp(secs, 0).unwrap()
}

fn skill(name: &str) -> SkillDef {
    SkillDef {
        name: name.into(),
        description: None,
        body: format!("body of {name}"),
        activation: Default::default(),
    }
}

fn cfg(skill_name: &str, chain: &str) -> RegistryConfig {
    RegistryConfig {
        agents: vec![],
        skills: vec![skill(skill_name)],
        tools: vec![],
        chain_bindings: vec![ChainBinding {
            area: "research".into(),
            kind: "lead".into(),
            chain: chain.into(),
        }],
    }
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_tenant_cannot_read_another_tenants_journal_even_for_the_same_run_id() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let run = RunId(uuid::Uuid::new_v4());
    let (ja, jb) = (a.journal(), b.journal());

    ja.append(run, started()).await.unwrap();
    ja.append(
        run,
        JournalEvent::NodeStarted {
            node: NodeId("a-only".into()),
        },
    )
    .await
    .unwrap();
    ja.snapshot(
        run,
        Snapshot {
            seq: 2,
            completed: vec![NodeId("a-only".into())],
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(
        jb.load(run).await.unwrap().is_empty(),
        "B sees none of A's events"
    );
    assert!(jb.load_since(run, 0).await.unwrap().is_empty());
    assert!(
        jb.latest_snapshot(run).await.unwrap().is_none(),
        "B sees none of A's snapshots"
    );

    // B starts the SAME run id independently: its own format stamp, its own events.
    jb.append(run, started()).await.unwrap();
    assert_eq!(jb.load(run).await.unwrap().len(), 1, "B's run is only B's");
    assert_eq!(ja.load(run).await.unwrap().len(), 2, "A's run is untouched");

    // B compacting "its" seqs cannot delete A's events, even naming A's seqs directly.
    let a_seqs: Vec<_> = ja
        .load(run)
        .await
        .unwrap()
        .into_iter()
        .map(|(s, _)| s)
        .collect();
    jb.compact(run, &a_seqs, started()).await.unwrap();
    assert_eq!(
        ja.load(run).await.unwrap().len(),
        2,
        "B's compaction never reaches A"
    );

    a.drop_tenant().await;
    b.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn content_is_per_tenant_even_for_identical_bytes() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let bytes = format!("secret of {}", a.id).into_bytes();

    let d = a.content().put(&bytes).await.unwrap();
    match b.content().get(&d).await {
        Err(OrchestratorError::ContentDigestMiss(_)) => {}
        other => panic!("B must miss A's digest loudly, got {other:?}"),
    }
    // B storing the same bytes gets its own row; dropping A leaves B's intact.
    assert_eq!(b.content().put(&bytes).await.unwrap(), d);
    a.drop_tenant().await;
    assert_eq!(b.content().get(&d).await.unwrap(), bytes);
    b.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn the_blackboard_is_per_tenant_for_the_same_run_scope_and_key() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let run = RunId(uuid::Uuid::new_v4());
    let key = || ContextKey("k".into());

    let ra = a
        .context()
        .put(run, Scope::Run, key(), serde_json::json!("a"))
        .await
        .unwrap();
    assert!(
        b.context()
            .get(run, Scope::Node(NodeId("n".into())), key())
            .await
            .unwrap()
            .is_none(),
        "B resolves nothing from A's run scope"
    );
    // Not a collision: B's (run, scope, key) is a different row.
    b.context()
        .put(run, Scope::Run, key(), serde_json::json!("b"))
        .await
        .expect("the same (run, scope, key) in another tenant is not a collision");
    // B cannot load A's value through A's ref — the bytes live in A's CAS.
    assert!(
        b.context().load(&ra).await.is_err(),
        "a ref copied across tenants must not resolve"
    );
    assert_eq!(a.context().load(&ra).await.unwrap(), serde_json::json!("a"));

    a.drop_tenant().await;
    b.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn the_schedule_is_per_tenant() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let (sa, sb) = (a.scheduler(), b.scheduler());
    let run = RunId(uuid::Uuid::new_v4());
    let now = ts(3_000_000);
    let g = Graph { nodes: vec![] };

    sa.enqueue(run, &g, now).await.unwrap();
    sa.record_paused(run, Some(now), "gated").await.unwrap();

    assert!(sb.status(run).await.unwrap().is_none(), "B sees no status");
    assert!(
        sb.list_paused().await.unwrap().is_empty(),
        "B lists none of A's pauses"
    );
    assert!(
        sb.claim_due(now, chrono::Duration::seconds(60), 10)
            .await
            .unwrap()
            .is_empty(),
        "B's sweep never claims A's due run"
    );
    sb.cancel(run).await.unwrap();
    sb.force_wake(run, now).await.unwrap();
    assert_eq!(
        sa.status(run).await.unwrap().unwrap().status,
        RunStatus::Paused,
        "B cannot cancel A's run"
    );
    // The same run id in B is a separate schedule entry, not a duplicate submit.
    sb.enqueue(run, &g, now)
        .await
        .expect("B's own submit of the same run id");
    // Pruning in B never reaches A's terminal rows.
    sa.claim_due(now, chrono::Duration::seconds(60), 10)
        .await
        .unwrap();
    sa.record_terminal(run, RunStatus::Completed, None)
        .await
        .unwrap();
    let far = ts(4_000_000_000);
    assert_eq!(sb.count_terminal_before(far).await.unwrap(), 0);
    assert_eq!(sb.prune_terminal(far).await.unwrap(), 0);
    assert!(
        sa.status(run).await.unwrap().is_some(),
        "A's terminal row survives B's prune"
    );

    a.drop_tenant().await;
    b.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn the_same_run_id_locks_independently_per_tenant() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let run = RunId(uuid::Uuid::new_v4());
    let held = a
        .scheduler()
        .try_lock_run(run)
        .await
        .unwrap()
        .expect("A locks");
    let other =
        b.scheduler().try_lock_run(run).await.unwrap().expect(
            "B's run with the same id is a different run — its drive is not blocked by A's",
        );
    other.release().await.unwrap();
    held.release().await.unwrap();
    a.drop_tenant().await;
    b.drop_tenant().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn registry_config_and_generation_are_per_tenant() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let (ca, cb) = (a.config(), b.config());

    let ga = ca
        .store_and_bump_if(&cfg("shared-name", "a-chain"), 0)
        .await
        .unwrap();
    assert_eq!(ga, Some(1));
    // B's first push is ALSO at 0 — A's publish did not move B's generation.
    assert_eq!(cb.version().await.unwrap(), Some(0));
    assert_eq!(
        cb.store_and_bump_if(&cfg("shared-name", "b-chain"), 0)
            .await
            .unwrap(),
        Some(1),
        "the same skill name in another tenant is not a conflict"
    );

    let (cfg_a, gen_a) = ca.load_versioned().await.unwrap();
    assert_eq!(gen_a, Some(1));
    assert_eq!(
        cfg_a.chain_bindings[0].chain, "a-chain",
        "A's binding is A's"
    );
    assert_eq!(cfg_a.skills.len(), 1, "A sees only its own skill row");

    // B's replace-all (to empty) must not delete A's rows.
    cb.store_and_bump(&RegistryConfig::default()).await.unwrap();
    let (cfg_a, gen_a) = ca.load_versioned().await.unwrap();
    assert_eq!(cfg_a.skills.len(), 1, "B's replace-all never reaches A");
    assert_eq!(gen_a, Some(1), "nor A's generation");
    let cfg_b = cb.load().await.unwrap();
    assert!(
        cfg_b.skills.is_empty() && cfg_b.chain_bindings.is_empty(),
        "B's own rows are gone"
    );
    assert_eq!(
        cfg_a.chain_bindings.len(),
        1,
        "A's binding survives B's replace-all"
    );

    a.drop_tenant().await;
    b.drop_tenant().await;
}

/// Every scheduler WRITE is tenant-bound: with B holding the same run id in exactly the state
/// A's statement would change, A's `record_paused` / `force_wake` / `record_terminal` leave B's
/// row untouched.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn scheduler_transitions_never_reach_another_tenants_row() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let (sa, sb) = (a.scheduler(), b.scheduler());
    let run = RunId(uuid::Uuid::new_v4());
    let now = ts(3_100_000);
    let g = Graph { nodes: vec![] };

    // B: waking (in flight). A pauses / terminates "its" run of the same id — B stays waking.
    sb.enqueue(run, &g, now).await.unwrap();
    sa.record_paused(run, Some(now), "a").await.unwrap();
    sa.record_terminal(run, RunStatus::Failed, Some("a"))
        .await
        .unwrap();
    let st = sb.status(run).await.unwrap().unwrap();
    assert_eq!(
        st.status,
        RunStatus::Waking,
        "A's transitions never reach B's in-flight run"
    );
    assert_eq!(st.reason, None);

    // B: paused with NO deadline (in doubt). A force-wakes — B's deadline stays None.
    sb.record_paused(run, None, "in doubt").await.unwrap();
    sa.force_wake(run, now).await.unwrap();
    assert_eq!(
        sb.status(run).await.unwrap().unwrap().next_wake,
        None,
        "A's force_wake never re-times B's pause"
    );
    a.drop_tenant().await;
    b.drop_tenant().await;
}

/// The format fence is per tenant: A's run carrying an incompatible format_version never
/// fences B's run of the same id.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn the_format_fence_is_per_tenant() {
    let Some(pool) = pool().await else { return };
    let (a, b) = (Tenant::new(&pool).await, Tenant::new(&pool).await);
    let run = RunId(uuid::Uuid::new_v4());
    a.journal().append(run, started()).await.unwrap();
    b.journal().append(run, started()).await.unwrap();
    sqlx::query("update runs.runs set format_version = -999 where tenant_id = $1 and run_id = $2")
        .bind(a.id)
        .bind(run.0)
        .execute(&pool)
        .await
        .unwrap();
    assert!(a.journal().load(run).await.is_err(), "A's run is fenced");
    assert_eq!(
        b.journal()
            .load(run)
            .await
            .expect("B's run is not fenced by A's")
            .len(),
        1
    );
    a.drop_tenant().await;
    b.drop_tenant().await;
}
