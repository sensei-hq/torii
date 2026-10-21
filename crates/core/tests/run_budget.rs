//! AG-13 (torii#49, decision C5 #41): a run's money limit from its issuer's caps, and its spend
//! recorded back on them — against torii's real budget tables, per tenant.
//!
//! Every test builds its own tenant with this org tree (caps in dollars, all `hard` unless noted):
//!
//! ```text
//! Org (L0)  cap 100
//! ├── Team A (L2)  cap 10, spent 6                 → headroom 4
//! │   └── Personal U (L3, personal)  cap 8, spent 1 → headroom 7
//! ├── Group G (L2)  cap 1, SOFT                    → never limits
//! └── Group H (L1)  cap 2.5, reserved 0.5          → headroom 2
//! ```

use orchestrator_core::{
    EffectClass, EffectId, EffectOutput, ExecutionJournal, Graph, JournalEvent, MoneyBudget,
    NodeId, RunId, RunStatus, SchedulerStore, TokenUsage,
};
use sqlx::PgPool;
use torii_core::run_budget::{ChargeError, RunCharges, UNBOUNDED_MICRO_USD};
use torii_core::stores::{PgJournal, PgSchedulerStore};
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    Some(torii_core::connect(&url, 4).await.expect("connect"))
}

/// A tenant with the tree above, and its users. Removed by [`Org::drop_all`].
struct Org {
    pool: PgPool,
    tenant: Uuid,
    org: Uuid,
    team_a: Uuid,
    personal_u: Uuid,
    group_g: Uuid,
    group_h: Uuid,
    profiles: Vec<Uuid>,
}

impl Org {
    async fn new(pool: &PgPool) -> Org {
        let tenant = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'ag13-test')",
        )
        .bind(tenant)
        .bind(format!("ag13-{tenant}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into core.unit_levels (tenant_id, level, label) \
             select $1, l, 'L' || l from generate_series(0, 4) l",
        )
        .bind(tenant)
        .execute(pool)
        .await
        .unwrap();
        let mut org = Org {
            pool: pool.clone(),
            tenant,
            org: Uuid::new_v4(),
            team_a: Uuid::new_v4(),
            personal_u: Uuid::new_v4(),
            group_g: Uuid::new_v4(),
            group_h: Uuid::new_v4(),
            profiles: vec![],
        };
        let o = org.org;
        org.unit(o, None, 0, "Org", false, Some("100"), "hard", "0", "0")
            .await;
        org.unit(
            org.team_a,
            Some(o),
            2,
            "Team A",
            false,
            Some("10"),
            "hard",
            "6",
            "0",
        )
        .await;
        org.unit(
            org.personal_u,
            Some(org.team_a),
            3,
            "Personal U",
            true,
            Some("8"),
            "hard",
            "1",
            "0",
        )
        .await;
        org.unit(
            org.group_g,
            Some(o),
            2,
            "Group G",
            false,
            Some("1"),
            "soft",
            "0",
            "0",
        )
        .await;
        org.unit(
            org.group_h,
            Some(o),
            1,
            "Group H",
            false,
            Some("2.5"),
            "hard",
            "0",
            "0.5",
        )
        .await;
        org
    }

    #[allow(clippy::too_many_arguments)]
    async fn unit(
        &mut self,
        id: Uuid,
        parent: Option<Uuid>,
        level: i32,
        name: &str,
        personal: bool,
        cap: Option<&str>,
        enforcement: &str,
        spent: &str,
        reserved: &str,
    ) {
        sqlx::query(
            "insert into core.org_units (tenant_id, id, parent_id, level, name, is_personal) \
             values ($1, $2, $3, $4, $5, $6)",
        )
        .bind(self.tenant)
        .bind(id)
        .bind(parent)
        .bind(level)
        .bind(name)
        .bind(personal)
        .execute(&self.pool)
        .await
        .unwrap();
        sqlx::query(
            "insert into governance.nodes (tenant_id, id, org_unit_id, cap_amount, enforcement, \
             spent_amount, reserved_amount, modified_by) \
             values ($1, $2, $2, $3::numeric, $4::governance.enforcement, $5::numeric, \
             $6::numeric, 'ag13-test')",
        )
        .bind(self.tenant)
        .bind(id)
        .bind(cap)
        .bind(enforcement)
        .bind(spent)
        .bind(reserved)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    /// A user of this tenant, a member of `units`.
    async fn user(&mut self, units: &[Uuid]) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("insert into core.profiles (id, display_name) values ($1, 'ag13 user')")
            .bind(id)
            .execute(&self.pool)
            .await
            .unwrap();
        sqlx::query(
            "insert into core.memberships (profile_id, tenant_id, assigned_by) \
             values ($1, $2, 'ag13-test')",
        )
        .bind(id)
        .bind(self.tenant)
        .execute(&self.pool)
        .await
        .unwrap();
        for u in units {
            sqlx::query(
                "insert into core.unit_members (tenant_id, unit_id, profile_id) values ($1, $2, $3)",
            )
            .bind(self.tenant)
            .bind(u)
            .bind(id)
            .execute(&self.pool)
            .await
            .unwrap();
        }
        self.profiles.push(id);
        id
    }

    async fn spent(&self, node: Uuid) -> String {
        sqlx::query_scalar::<_, String>(
            "select spent_amount::text from governance.nodes where tenant_id = $1 and id = $2",
        )
        .bind(self.tenant)
        .bind(node)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    fn charges(&self) -> RunCharges {
        RunCharges::new(self.pool.clone(), self.tenant)
    }

    fn journal(&self) -> PgJournal {
        PgJournal::new(self.pool.clone(), self.tenant)
    }

    async fn drop_all(self) {
        for p in &self.profiles {
            sqlx::query("delete from core.profiles where id = $1")
                .bind(p)
                .execute(&self.pool)
                .await
                .unwrap();
        }
        sqlx::query("delete from core.tenants where id = $1")
            .bind(self.tenant)
            .execute(&self.pool)
            .await
            .unwrap();
    }
}

/// A run that STARTED under a money cap, with priced calls costing `costs` micro-dollars each.
async fn priced_run(journal: &PgJournal, run: RunId, cap: u64, costs: &[u64]) {
    journal
        .append(
            run,
            JournalEvent::RunStarted {
                version: "v1".into(),
                budget: None,
                money_budget: Some(MoneyBudget {
                    total_micro_usd: cap,
                }),
            },
        )
        .await
        .unwrap();
    for c in costs {
        spend(journal, run, *c).await;
    }
}

async fn spend(journal: &PgJournal, run: RunId, cost: u64) {
    let id = Uuid::new_v4().to_string();
    journal
        .append(
            run,
            JournalEvent::EffectRecorded {
                node: NodeId(id.clone()),
                effect_id: EffectId(id),
                class: EffectClass::Pure,
                input_hash: "h".into(),
                seq: 0,
                output: EffectOutput::Inline(serde_json::Value::Null),
                observation: None,
                usage: Some(TokenUsage {
                    input_tokens: 10,
                    output_tokens: 10,
                    total_tokens: 20,
                    cost_micro_usd: Some(cost),
                }),
            },
        )
        .await
        .unwrap();
}

const DOLLAR: u64 = 1_000_000;

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn headroom_is_the_tightest_hard_cap_over_the_issuers_units_and_every_ancestor() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    // Individual (U: 7) under a group (Team A: 4) under the org (100), plus a second group (H: 2,
    // its reservation counted) and a soft one (G) that never limits: H is the tightest.
    let both = o.user(&[o.personal_u, o.group_h, o.group_g]).await;
    // Only the personal unit: the hierarchy above it binds — Team A, not U.
    let solo = o.user(&[o.personal_u]).await;
    let c = o.charges();

    let h = c.headroom(both).await.unwrap();
    assert_eq!(h.micro_usd, Some(2 * DOLLAR), "{h:?}");
    assert_eq!(h.tightest.as_deref(), Some("Group H"), "{h:?}");
    let mut nodes = h.nodes.clone();
    nodes.sort();
    let mut want = vec![o.org, o.team_a, o.personal_u, o.group_g, o.group_h];
    want.sort();
    assert_eq!(nodes, want, "every unit and ancestor, each once");

    let h = c.headroom(solo).await.unwrap();
    assert_eq!(
        (h.micro_usd, h.tightest.as_deref()),
        (Some(4 * DOLLAR), Some("Team A"))
    );
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn an_issuer_resolves_only_within_the_tenant_and_with_no_unit_falls_back_to_the_root() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let other = Org::new(&pool).await;
    let member = o.user(&[]).await;
    let c = o.charges();

    assert_eq!(c.resolve_issuer(&member.to_string()).await.unwrap(), member);
    let ghost = Uuid::new_v4().to_string();
    let err = c.resolve_issuer(&ghost).await.unwrap_err();
    assert!(
        matches!(&err, ChargeError::UnknownIssuer(who) if who == &ghost),
        "{err}"
    );
    // A user of this tenant is unknown to another one.
    let err = other.charges().resolve_issuer(&member.to_string()).await;
    assert!(matches!(err, Err(ChargeError::UnknownIssuer(_))), "{err:?}");
    assert!(matches!(
        c.resolve_issuer("not-a-uuid").await,
        Err(ChargeError::UnknownIssuer(_))
    ));

    // No unit at all: the tenant's root, as a question falls back to it.
    let h = c.headroom(member).await.unwrap();
    assert_eq!(
        (h.micro_usd, h.nodes.clone()),
        (Some(100 * DOLLAR), vec![o.org])
    );
    other.drop_all().await;
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn no_budget_node_refuses_and_no_hard_cap_admits_an_unbounded_but_ledgered_limit() {
    let Some(pool) = pool().await else { return };
    // A tenant with no budget node at all: fail-closed.
    let mut bare = Org::new(&pool).await;
    sqlx::query("delete from governance.nodes where tenant_id = $1")
        .bind(bare.tenant)
        .execute(&pool)
        .await
        .unwrap();
    let u = bare.user(&[bare.personal_u]).await;
    let run = RunId(Uuid::new_v4());
    let err = bare.charges().admit(run, u, None).await;
    assert!(matches!(err, Err(ChargeError::NoBudgetNode)), "{err:?}");

    // Every cap soft or absent: no limit binds, yet a money limit is set so spend is ledgered.
    let mut open = Org::new(&pool).await;
    sqlx::query(
        "update governance.nodes set enforcement = 'soft' where tenant_id = $1 and id <> $2",
    )
    .bind(open.tenant)
    .bind(open.org)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("update governance.nodes set cap_amount = null where tenant_id = $1 and id = $2")
        .bind(open.tenant)
        .bind(open.org)
        .execute(&pool)
        .await
        .unwrap();
    let u = open.user(&[open.personal_u]).await;
    let h = open.charges().headroom(u).await.unwrap();
    assert_eq!(h.micro_usd, None);
    let run = RunId(Uuid::new_v4());
    let m = open.charges().admit(run, u, None).await.unwrap();
    assert_eq!(m.total_micro_usd, UNBOUNDED_MICRO_USD);
    // An explicit limit is the limit when nothing caps it.
    let run = RunId(Uuid::new_v4());
    let m = open
        .charges()
        .admit(run, u, Some(5 * DOLLAR))
        .await
        .unwrap();
    assert_eq!(m.total_micro_usd, 5 * DOLLAR);
    bare.drop_all().await;
    open.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn admit_takes_the_headroom_and_an_explicit_limit_may_only_lower_it() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();

    // Above the headroom: refused, naming it, and nothing is written (nor reserved).
    let over = RunId(Uuid::new_v4());
    let err = c.admit(over, u, Some(4 * DOLLAR + 1)).await.unwrap_err();
    assert!(
        matches!(
            &err,
            ChargeError::OverHeadroom { headroom_micro_usd, node, .. }
                if *headroom_micro_usd == 4 * DOLLAR && node == "Team A"
        ),
        "{err}"
    );
    assert!(err.to_string().contains("headroom of $4.00 "), "{err}");
    let written: i64 = sqlx::query_scalar(
        "select count(*) from runs.run_charges where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(over.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(written, 0, "a refused admission writes nothing");
    assert_eq!(o.reserved(o.team_a).await, "0.000000");

    let lower = RunId(Uuid::new_v4());
    assert_eq!(
        c.admit(lower, u, Some(DOLLAR))
            .await
            .unwrap()
            .total_micro_usd,
        DOLLAR
    );

    // No explicit limit: the headroom — what the $1 run's reservation left of the $4.
    let run = RunId(Uuid::new_v4());
    assert_eq!(
        c.admit(run, u, None).await.unwrap().total_micro_usd,
        3 * DOLLAR
    );
    let row: (Uuid, i64, Vec<Uuid>, i64) = sqlx::query_as(
        "select issuer_profile_id, limit_micro_usd, node_ids, reserved_micro_usd \
           from runs.run_charges where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(run.0)
    .fetch_one(&pool)
    .await
    .expect("admit records the run's charge");
    assert_eq!(
        (row.0, row.1, row.2.len(), row.3),
        (u, 3 * DOLLAR as i64, 3, 3 * DOLLAR as i64)
    );

    // A run id that is already scheduled is never charged to this issuer.
    let taken = RunId(Uuid::new_v4());
    PgSchedulerStore::new(pool.clone(), o.tenant)
        .enqueue(taken, &Graph { nodes: vec![] }, chrono::Utc::now())
        .await
        .unwrap();
    let err = c.admit(taken, u, None).await;
    assert!(
        matches!(err, Err(ChargeError::AlreadyScheduled(r)) if r == taken),
        "{err:?}"
    );
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn settle_records_the_runs_journal_spend_on_every_charged_node_exactly_once() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u, o.group_h]).await;
    let c = o.charges();
    let j = o.journal();
    let run = RunId(Uuid::new_v4());
    let limit = c.admit(run, u, None).await.unwrap().total_micro_usd;
    priced_run(&j, run, limit, &[1_500_000]).await;

    assert_eq!(c.settle(&j, run).await.unwrap(), 1_500_000);
    for (node, want) in [
        (o.personal_u, "2.500000"),
        (o.team_a, "7.500000"),
        (o.org, "1.500000"),
        (o.group_h, "1.500000"),
    ] {
        assert_eq!(o.spent(node).await, want, "node {node}");
    }
    assert_eq!(o.spent(o.group_g).await, "0.000000", "not charged");

    // A repeated settle (a re-drive, a second worker) records nothing more.
    assert_eq!(c.settle(&j, run).await.unwrap(), 0);
    assert_eq!(o.spent(o.org).await, "1.500000");

    // New spend: only the difference.
    spend(&j, run, 250_000).await;
    assert_eq!(c.settle(&j, run).await.unwrap(), 250_000);
    assert_eq!(o.spent(o.org).await, "1.750000");
    assert_eq!(o.spent(o.personal_u).await, "2.750000");

    // The run's spend — and the $0.25 of its $2 limit still reserved — count against the
    // issuer's headroom: H 2.0 − 1.75 − 0.25.
    assert_eq!(c.headroom(u).await.unwrap().micro_usd, Some(0));
    assert_eq!(
        o.reserved(o.group_h).await,
        "0.750000",
        "0.50 + the run's 0.25"
    );

    // A run with no charge (submitted before caps applied to runs) records nothing.
    let stray = RunId(Uuid::new_v4());
    priced_run(&j, stray, DOLLAR, &[DOLLAR]).await;
    assert_eq!(c.settle(&j, stray).await.unwrap(), 0);
    assert_eq!(o.spent(o.org).await, "1.750000");
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_worker_clock_ahead_of_the_database_never_hides_a_terminal_run_from_settle_pending() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await;
    let c = o.charges();
    let j = o.journal();
    let sched = PgSchedulerStore::new(pool.clone(), o.tenant);
    let run = RunId(Uuid::new_v4());
    let limit = c.admit(run, u, None).await.unwrap().total_micro_usd;
    // The submitting process's clock runs a minute ahead of the database's: every
    // `updated_at` the schedule records must still move forward on the DB's own clock.
    sched
        .enqueue(
            run,
            &Graph { nodes: vec![] },
            chrono::Utc::now() + chrono::Duration::seconds(60),
        )
        .await
        .unwrap();
    priced_run(&j, run, limit, &[DOLLAR]).await;
    assert_eq!(c.settle_pending(&j).await.unwrap(), 1);

    spend(&j, run, 500_000).await;
    sched
        .record_terminal(run, RunStatus::Completed, None)
        .await
        .expect("the run completes");
    assert_eq!(
        c.settle_pending(&j).await.unwrap(),
        1,
        "the terminal update moved the schedule, whatever the submitter's clock said"
    );
    assert_eq!(o.spent(o.org).await, "1.500000");
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn settle_pending_records_runs_whose_schedule_moved_and_closes_terminal_ones() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await;
    let c = o.charges();
    let j = o.journal();
    let sched = PgSchedulerStore::new(pool.clone(), o.tenant);
    let run = RunId(Uuid::new_v4());
    let limit = c.admit(run, u, None).await.unwrap().total_micro_usd;
    sched
        .enqueue(run, &Graph { nodes: vec![] }, chrono::Utc::now())
        .await
        .unwrap();
    priced_run(&j, run, limit, &[DOLLAR]).await;

    assert_eq!(c.settle_pending(&j).await.unwrap(), 1);
    assert_eq!(o.spent(o.org).await, "1.000000");
    // Nothing moved since: nothing to settle.
    assert_eq!(c.settle_pending(&j).await.unwrap(), 0);

    // The run finishes with more spend: the next sweep records it and closes the charge.
    spend(&j, run, 500_000).await;
    sched
        .record_terminal(run, RunStatus::Completed, None)
        .await
        .expect("the run completes");
    assert_eq!(c.settle_pending(&j).await.unwrap(), 1);
    assert_eq!(o.spent(o.org).await, "1.500000");
    let settled: bool = sqlx::query_scalar(
        "select settled from runs.run_charges where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(run.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(settled, "a terminal run's charge is closed");
    assert_eq!(c.settle_pending(&j).await.unwrap(), 0);
    o.drop_all().await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_raise_is_admitted_only_within_the_charged_nodes_headroom() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();
    let j = o.journal();
    let run = RunId(Uuid::new_v4());
    c.admit(run, u, Some(DOLLAR)).await.unwrap();
    priced_run(&j, run, DOLLAR, &[1_500_000]).await; // paused past its $1 limit

    // check_raise settles first: the $1.50 lands on the nodes, leaving Team A $2.50 — so the
    // run may go to at most $1.50 + $2.50 = $4.
    c.check_raise(&j, run, 4 * DOLLAR)
        .await
        .expect("within headroom");
    commit_cap(&c, &j, run, 4 * DOLLAR).await;
    assert_eq!(o.spent(o.team_a).await, "7.500000");
    let err = c.check_raise(&j, run, 4 * DOLLAR + 1).await.unwrap_err();
    assert!(
        matches!(
            &err,
            ChargeError::OverHeadroom { headroom_micro_usd, node, .. }
                if *headroom_micro_usd == 2_500_000 && node == "Team A"
        ),
        "{err}"
    );
    // The $4 raise reserved Team A's last $2.50; lowering the run back to its spend releases it
    // — once the lower cap is committed (G2-4), not when it is checked.
    assert_eq!(o.reserved(o.team_a).await, "2.500000");
    c.check_raise(&j, run, 3 * DOLLAR / 2)
        .await
        .expect("a lowering");
    assert_eq!(
        o.reserved(o.team_a).await,
        "2.500000",
        "nothing is released before the lower cap is committed"
    );
    commit_cap(&c, &j, run, 3 * DOLLAR / 2).await;
    assert_eq!(o.reserved(o.team_a).await, "0.000000");
    // Lowering is always admitted — even with no headroom left at all.
    let low = RunId(Uuid::new_v4());
    c.admit(low, u, Some(2 * DOLLAR)).await.unwrap();
    priced_run(&j, low, 2 * DOLLAR, &[DOLLAR / 2]).await;
    sqlx::query(
        "update governance.nodes set spent_amount = cap_amount where tenant_id = $1 and id = $2",
    )
    .bind(o.tenant)
    .bind(o.team_a)
    .execute(&pool)
    .await
    .unwrap();
    c.check_raise(&j, low, 3 * DOLLAR / 2)
        .await
        .expect("a lower limit needs no headroom");
    let err = c.check_raise(&j, low, 2 * DOLLAR + 1).await;
    assert!(
        matches!(err, Err(ChargeError::OverHeadroom { .. })),
        "{err:?}"
    );

    let uncharged = RunId(Uuid::new_v4());
    priced_run(&j, uncharged, DOLLAR, &[]).await;
    let err = c.check_raise(&j, uncharged, 2 * DOLLAR).await;
    assert!(
        matches!(err, Err(ChargeError::NotCharged(r)) if r == uncharged),
        "{err:?}"
    );
    o.drop_all().await;
}

impl Org {
    /// A node's `reserved_amount`, as text.
    async fn reserved(&self, node: Uuid) -> String {
        sqlx::query_scalar::<_, String>(
            "select reserved_amount::text from governance.nodes where tenant_id = $1 and id = $2",
        )
        .bind(self.tenant)
        .bind(node)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

/// G1-1 (wave B review): an admitted limit RESERVES the headroom it was given, so a second run
/// admitted for the same issuer gets only what the first left — never the same headroom again.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn back_to_back_admits_reserve_so_their_limits_never_sum_past_the_headroom() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();

    let a = c
        .admit(RunId(Uuid::new_v4()), u, Some(3 * DOLLAR))
        .await
        .unwrap();
    assert_eq!(a.total_micro_usd, 3 * DOLLAR);
    let b = c.admit(RunId(Uuid::new_v4()), u, None).await.unwrap();
    assert_eq!(
        b.total_micro_usd, DOLLAR,
        "the second run gets only the $1 the first left"
    );
    let err = c
        .admit(RunId(Uuid::new_v4()), u, Some(DOLLAR / 2))
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            ChargeError::OverHeadroom { headroom_micro_usd, node, .. }
                if *headroom_micro_usd == 0 && node == "Team A"
        ),
        "{err}"
    );
    // The reservation is held on every hard-capped node the runs are charged to.
    for node in [o.team_a, o.personal_u, o.org] {
        assert_eq!(o.reserved(node).await, "4.000000", "node {node}");
    }
    o.drop_all().await;
}

/// G1-1: concurrent admissions for one issuer serialize on the node locks — the admitted limits
/// together never exceed the headroom.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn concurrent_admits_never_admit_more_than_the_headroom_between_them() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
                                           // Hold Team A's row so every admission is in flight at once: each must then wait for the
                                           // node lock BEFORE it reads the headroom, or all of them read the same $4.
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("select 1 from governance.nodes where tenant_id = $1 and id = $2 for update")
        .bind(o.tenant)
        .bind(o.team_a)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let racers = torii_core::connect(&std::env::var("DATABASE_URL").unwrap(), 8)
        .await
        .expect("connect");
    let mut tasks = Vec::new();
    for _ in 0..4 {
        let c = RunCharges::new(racers.clone(), o.tenant);
        tasks.push(tokio::spawn(async move {
            c.admit(RunId(Uuid::new_v4()), u, Some(3 * DOLLAR / 2))
                .await
        }));
    }
    // Every racer is blocked on a lock before the blocker lets go.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        let waiting: i64 = sqlx::query_scalar(
            "select count(*) from pg_stat_activity \
              where wait_event_type = 'Lock' and query like '%governance.nodes%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if waiting >= 4 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the racers never blocked"
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    blocker.rollback().await.unwrap();
    let mut admitted = 0u64;
    for t in tasks {
        match t.await.unwrap() {
            Ok(m) => admitted += m.total_micro_usd,
            Err(ChargeError::OverHeadroom { .. }) => {}
            Err(e) => panic!("unexpected refusal: {e}"),
        }
    }
    assert_eq!(admitted, 3 * DOLLAR, "two of four $1.50 runs fit $4");
    assert_eq!(o.reserved(o.team_a).await, "3.000000");
    o.drop_all().await;
}

/// G1-1: settling converts the reservation into spend, and a terminal settle releases what is
/// left — the node ends with exactly the run's spend and no reservation.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn settle_converts_the_reservation_to_spend_and_a_terminal_settle_releases_the_rest() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();
    let j = o.journal();
    let sched = PgSchedulerStore::new(pool.clone(), o.tenant);
    let run = RunId(Uuid::new_v4());
    c.admit(run, u, Some(3 * DOLLAR)).await.unwrap();
    sched
        .enqueue(run, &Graph { nodes: vec![] }, chrono::Utc::now())
        .await
        .unwrap();
    priced_run(&j, run, 3 * DOLLAR, &[DOLLAR]).await;

    assert_eq!(c.settle(&j, run).await.unwrap(), DOLLAR);
    assert_eq!(o.spent(o.team_a).await, "7.000000");
    assert_eq!(o.reserved(o.team_a).await, "2.000000", "$1 of $3 converted");

    spend(&j, run, DOLLAR / 2).await;
    sched
        .record_terminal(run, RunStatus::Completed, None)
        .await
        .unwrap();
    assert_eq!(c.settle(&j, run).await.unwrap(), DOLLAR / 2);
    for node in [o.team_a, o.personal_u, o.org] {
        assert_eq!(
            o.reserved(node).await,
            "0.000000",
            "released at node {node}"
        );
    }
    assert_eq!(
        o.spent(o.team_a).await,
        "7.500000",
        "spent == the run's $1.50"
    );

    // A run that overshoots its limit (the call that crosses it is ledgered) never drives the
    // reservation negative.
    let over = RunId(Uuid::new_v4());
    c.admit(over, u, Some(DOLLAR)).await.unwrap();
    priced_run(&j, over, DOLLAR, &[3 * DOLLAR / 2]).await;
    assert_eq!(c.settle(&j, over).await.unwrap(), 3 * DOLLAR / 2);
    assert_eq!(o.reserved(o.team_a).await, "0.000000");
    assert_eq!(o.spent(o.team_a).await, "9.000000");
    o.drop_all().await;
}

/// What `run wake --budget-usd` does once `check_raise` admitted a move: journal the new cap, then
/// bring the reservation down to what the cap in force needs.
async fn commit_cap(c: &RunCharges, j: &PgJournal, run: RunId, total: u64) {
    j.append(
        run,
        JournalEvent::MoneyBudgetRaised {
            new_total_micro_usd: total,
        },
    )
    .await
    .unwrap();
    c.release_to_cap(j, run).await.expect("release_to_cap");
}

/// G1-1: a raise reserves only its increment, and only out of the headroom other runs'
/// reservations leave; a lowering releases the difference.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_raise_reserves_its_increment_out_of_what_other_runs_reservations_leave() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();
    let j = o.journal();
    let a = RunId(Uuid::new_v4());
    let b = RunId(Uuid::new_v4());
    c.admit(a, u, Some(DOLLAR)).await.unwrap();
    c.admit(b, u, Some(2 * DOLLAR)).await.unwrap();
    priced_run(&j, a, DOLLAR, &[3 * DOLLAR / 2]).await; // a paused past its $1
    priced_run(&j, b, 2 * DOLLAR, &[]).await;

    // Team A: cap 10 − spent 7.5 − b's $2 reserved = $0.50 for a's raise.
    let err = c.check_raise(&j, a, 4 * DOLLAR).await.unwrap_err();
    assert!(
        matches!(
            &err,
            ChargeError::OverHeadroom { headroom_micro_usd, node, .. }
                if *headroom_micro_usd == DOLLAR / 2 && node == "Team A"
        ),
        "{err}"
    );
    c.check_raise(&j, a, 2 * DOLLAR)
        .await
        .expect("$1.50 spent + $0.50 fits");
    assert_eq!(o.reserved(o.team_a).await, "2.500000");

    commit_cap(&c, &j, a, 2 * DOLLAR).await;
    assert_eq!(
        o.reserved(o.team_a).await,
        "2.500000",
        "a committed raise keeps it"
    );

    // Lowering b to $1 releases $1 — once it is committed.
    c.check_raise(&j, b, DOLLAR).await.expect("a lowering");
    assert_eq!(o.reserved(o.team_a).await, "2.500000");
    commit_cap(&c, &j, b, DOLLAR).await;
    assert_eq!(o.reserved(o.team_a).await, "1.500000");
    o.drop_all().await;
}

/// G1-4 (wave B review): an issuer with no headroom left is refused — a $0 limit would pause the
/// run on its first priced call with nothing that could ever raise it — and nothing is written.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn zero_headroom_refuses_the_run_and_writes_nothing() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await;
    sqlx::query(
        "update governance.nodes set spent_amount = cap_amount where tenant_id = $1 and id = $2",
    )
    .bind(o.tenant)
    .bind(o.team_a)
    .execute(&pool)
    .await
    .unwrap();
    let run = RunId(Uuid::new_v4());
    let got = o.charges().admit(run, u, None).await;
    let err = got.expect_err("a run with no headroom must be refused, not admitted at $0");
    assert!(
        err.to_string().contains("no headroom") && err.to_string().contains("Team A"),
        "{err}"
    );
    let written: i64 = sqlx::query_scalar(
        "select count(*) from runs.run_charges where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(run.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(written, 0, "a refused admission writes nothing");
    o.drop_all().await;
}

/// G1-2 (wave B review): a charge whose submit never reached `enqueue` (a store fault, Ctrl-C)
/// is an orphan — no schedule row exists — and must not poison its run id: the same issuer's
/// retry re-admits over it, releasing the orphan's reservation first, so nothing is counted twice.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_retry_of_a_run_whose_enqueue_never_happened_re_admits_over_the_orphan_charge() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let other = o.user(&[o.personal_u]).await;
    let c = o.charges();
    let run = RunId(Uuid::new_v4());
    c.admit(run, u, Some(3 * DOLLAR)).await.unwrap();
    // … the submit dies before `enqueue`; the operator retries the same --run-id.
    let again = c.admit(run, u, Some(2 * DOLLAR)).await;
    assert_eq!(
        again
            .expect("an orphan charge must not poison its run id")
            .total_micro_usd,
        2 * DOLLAR
    );
    assert_eq!(
        o.reserved(o.team_a).await,
        "2.000000",
        "the orphan's $3 was released, not double-counted"
    );
    // Someone else's orphan is not theirs to take over.
    let err = c.admit(run, other, None).await;
    assert!(
        matches!(err, Err(ChargeError::AlreadyScheduled(r)) if r == run),
        "{err:?}"
    );
    assert_eq!(o.reserved(o.team_a).await, "2.000000");
    o.drop_all().await;
}

/// G1-3 (wave B review): `cancel` can flip a run that is still being driven (`waking`), and that
/// drive keeps spending until it ends. Its charge must not be closed while the drive may still
/// run: the spend it makes after the cancel is recorded, and the reservation is released only
/// once the run truly is final.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn spend_a_cancelled_runs_live_drive_makes_after_the_cancel_is_still_recorded() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();
    let j = o.journal();
    let sched = PgSchedulerStore::new(pool.clone(), o.tenant);
    let run = RunId(Uuid::new_v4());
    let limit = c.admit(run, u, None).await.unwrap().total_micro_usd;
    sched
        .enqueue(run, &Graph { nodes: vec![] }, chrono::Utc::now())
        .await
        .unwrap();
    priced_run(&j, run, limit, &[DOLLAR]).await;
    sched.cancel(run).await.unwrap(); // … while the drive is still running

    assert_eq!(c.settle_pending(&j).await.unwrap(), 1);
    assert_eq!(o.spent(o.org).await, "1.000000");
    assert_eq!(
        o.reserved(o.team_a).await,
        "3.000000",
        "the drive may still spend: its reservation is held"
    );

    // The drive spends once more, then ends — its record is a no-op on a cancelled row.
    spend(&j, run, DOLLAR).await;
    sched
        .record_terminal(run, RunStatus::Completed, None)
        .await
        .unwrap();
    c.settle_pending(&j).await.unwrap();
    assert_eq!(
        o.spent(o.org).await,
        "2.000000",
        "the org's spend equals the run's journal spend"
    );
    assert_eq!(
        o.reserved(o.team_a).await,
        "0.000000",
        "released once final"
    );
    assert_eq!(c.settle_pending(&j).await.unwrap(), 0, "and closed");
    o.drop_all().await;
}

/// G1-3: a cancelled run whose drive's claim never cleared (its worker died mid-drive) is closed
/// once the claim is long abandoned AND no drive holds the run's lock — never while one does.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_cancelled_run_with_an_abandoned_claim_is_closed_only_once_no_drive_holds_it() {
    let Some(pool) = pool().await else { return };
    let mut o = Org::new(&pool).await;
    let u = o.user(&[o.personal_u]).await; // headroom $4 (Team A)
    let c = o.charges();
    let j = o.journal();
    let sched = PgSchedulerStore::new(pool.clone(), o.tenant);
    let run = RunId(Uuid::new_v4());
    let limit = c.admit(run, u, None).await.unwrap().total_micro_usd;
    sched
        .enqueue(run, &Graph { nodes: vec![] }, chrono::Utc::now())
        .await
        .unwrap();
    priced_run(&j, run, limit, &[DOLLAR]).await;
    sched.cancel(run).await.unwrap();
    sqlx::query(
        "update runs.scheduled_runs set claimed_at = now() - interval '2 hours' \
          where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(run.0)
    .execute(&pool)
    .await
    .unwrap();
    let settled = || async {
        sqlx::query_scalar::<_, bool>(
            "select settled from runs.run_charges where tenant_id = $1 and run_id = $2",
        )
        .bind(o.tenant)
        .bind(run.0)
        .fetch_one(&pool)
        .await
        .unwrap()
    };

    // A drive still holds the run: its spend may still grow, so the charge stays open.
    let lock = sched
        .try_lock_run(run)
        .await
        .unwrap()
        .expect("the run's lock");
    c.settle_pending(&j).await.unwrap();
    assert!(!settled().await, "a held drive lock keeps the charge open");
    assert_eq!(o.reserved(o.team_a).await, "3.000000");
    lock.release().await.unwrap();

    // Nothing holds it and the claim is long abandoned: final.
    assert_eq!(c.settle_pending(&j).await.unwrap(), 1);
    assert!(settled().await);
    assert_eq!(o.reserved(o.team_a).await, "0.000000");
    assert_eq!(o.spent(o.org).await, "1.000000");
    o.drop_all().await;
}
