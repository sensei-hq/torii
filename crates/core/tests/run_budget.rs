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

    let run = RunId(Uuid::new_v4());
    assert_eq!(
        c.admit(run, u, None).await.unwrap().total_micro_usd,
        4 * DOLLAR
    );
    let row: (Uuid, i64, Vec<Uuid>) = sqlx::query_as(
        "select issuer_profile_id, limit_micro_usd, node_ids from runs.run_charges \
         where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(run.0)
    .fetch_one(&pool)
    .await
    .expect("admit records the run's charge");
    assert_eq!((row.0, row.1, row.2.len()), (u, 4 * DOLLAR as i64, 3));

    let lower = RunId(Uuid::new_v4());
    assert_eq!(
        c.admit(lower, u, Some(DOLLAR))
            .await
            .unwrap()
            .total_micro_usd,
        DOLLAR
    );

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
    assert!(err.to_string().contains("$4.000000"), "{err}");
    let written: i64 = sqlx::query_scalar(
        "select count(*) from runs.run_charges where tenant_id = $1 and run_id = $2",
    )
    .bind(o.tenant)
    .bind(over.0)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(written, 0, "a refused admission writes nothing");

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

    // The run's spend now counts against the issuer's headroom: H 2.0 − 1.75.
    assert_eq!(c.headroom(u).await.unwrap().micro_usd, Some(250_000));

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
