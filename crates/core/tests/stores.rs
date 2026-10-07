//! The shared store bundle (TM-8c): resolving an operator's tenant, and opening every store
//! for exactly that tenant.

use orchestrator_core::{
    ConfigSource, ConfigStore, ContentStore, ExecutionJournal, JournalEvent, OrchestratorError,
    RegistryConfig, RunId, SchedulerStore,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn pool() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    Some(torii_core::connect(&url, 4).await.expect("connect"))
}

async fn tenant(pool: &PgPool) -> (Uuid, String) {
    let id = Uuid::new_v4();
    let slug = format!("tm8c-{id}");
    sqlx::query(
        "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'tm8c-test')",
    )
    .bind(id)
    .bind(&slug)
    .execute(pool)
    .await
    .unwrap();
    (id, slug)
}

async fn drop_tenant(pool: &PgPool, id: Uuid) {
    sqlx::query("delete from core.tenants where id = $1")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_tenant_resolves_by_slug_or_uuid_and_an_unknown_one_is_named() {
    let Some(pool) = pool().await else { return };
    let (id, slug) = tenant(&pool).await;
    assert_eq!(torii_core::resolve_tenant(&pool, &slug).await.unwrap(), id);
    assert_eq!(
        torii_core::resolve_tenant(&pool, &id.to_string())
            .await
            .unwrap(),
        id
    );
    let ghost = Uuid::new_v4().to_string();
    let err = torii_core::resolve_tenant(&pool, &ghost).await.unwrap_err();
    assert!(
        err.to_string().contains(&ghost),
        "names the unknown tenant: {err}"
    );
    let err = torii_core::resolve_tenant(&pool, "no-such-tenant-slug")
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no-such-tenant-slug"), "{err}");
    drop_tenant(&pool, id).await;
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn every_store_in_the_bundle_belongs_to_its_tenant() {
    let Some(pool) = pool().await else { return };
    let ((a, _), (b, _)) = (tenant(&pool).await, tenant(&pool).await);
    let (sa, sb) = (
        torii_core::TenantStores::open(&pool, a),
        torii_core::TenantStores::open(&pool, b),
    );
    let run = RunId(Uuid::new_v4());

    sa.journal
        .append(
            run,
            JournalEvent::RunStarted {
                version: "v1".into(),
                budget: None,
                money_budget: None,
            },
        )
        .await
        .unwrap();
    assert!(
        sb.journal.load(run).await.unwrap().is_empty(),
        "journal is per tenant"
    );

    let d = sa.content.put(b"a-only").await.unwrap();
    assert!(
        matches!(
            sb.content.get(&d).await,
            Err(OrchestratorError::ContentDigestMiss(_))
        ),
        "content is per tenant"
    );

    sa.scheduler
        .enqueue(
            run,
            &orchestrator_core::Graph { nodes: vec![] },
            chrono::Utc::now(),
        )
        .await
        .unwrap();
    assert!(
        sb.scheduler.status(run).await.unwrap().is_none(),
        "schedule is per tenant"
    );

    sa.config
        .store_and_bump(&RegistryConfig::default())
        .await
        .unwrap();
    assert_eq!(sa.config.version().await.unwrap(), Some(1));
    assert_eq!(
        sb.config.version().await.unwrap(),
        Some(0),
        "generation is per tenant"
    );

    // The blackboard reads through the same tenant's CAS.
    let r = sa
        .context
        .put(
            run,
            orchestrator_core::Scope::Run,
            orchestrator_core::ContextKey("k".into()),
            serde_json::json!(1),
        )
        .await
        .unwrap();
    use orchestrator_core::ContextStore;
    assert!(
        sb.context.load(&r).await.is_err(),
        "blackboard is per tenant"
    );

    drop_tenant(&pool, a).await;
    drop_tenant(&pool, b).await;
}

/// A slug can never look like a UUID (AG-7, #36): `core.tenants.slug` carries the CHECK
/// `tenants_slug_not_uuid`, so no tenant can be NAMED after another tenant's id — the platform
/// tenant's all-zeros id included — and an id handed to `resolve_tenant` can only ever match
/// the tenant that owns it. Every spelling either `uuid::Uuid` or Postgres' `uuid` input
/// accepts is refused; a near miss (31 hex digits) is an ordinary slug.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
)]
#[tokio::test]
async fn a_uuid_shaped_slug_is_refused_so_an_id_resolves_only_to_its_tenant() {
    let Some(pool) = pool().await else { return };
    let (a, _) = tenant(&pool).await;
    let id = a.to_string();
    let spellings = [
        id.clone(),
        id.replace('-', ""),
        id.to_uppercase(),
        format!("{{{id}}}"),
        format!("urn:uuid:{id}"),
        "00000000-0000-0000-0000-000000000000".to_string(),
        "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11".to_string(),
    ];
    for slug in &spellings {
        let b = Uuid::new_v4();
        let err = sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'tm8c-test')",
        )
        .bind(b)
        .bind(slug)
        .execute(&pool)
        .await
        .map(|_| ())
        .expect_err(&format!("a UUID-shaped slug {slug:?} must be refused"));
        let db = err.as_database_error().expect("a database error");
        assert_eq!(db.code().as_deref(), Some("23514"), "{slug:?}: {db}");
        assert_eq!(db.constraint(), Some("tenants_slug_not_uuid"), "{slug:?}");
    }
    assert_eq!(
        torii_core::resolve_tenant(&pool, &id).await.unwrap(),
        a,
        "a tenant id resolves to its own tenant"
    );

    // A near miss is not an id, and stays a legal slug.
    let near = Uuid::new_v4();
    let near_slug = format!("tm8c-{}", &near.simple().to_string()[..31]);
    sqlx::query(
        "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'tm8c-test')",
    )
    .bind(near)
    .bind(&near_slug)
    .execute(&pool)
    .await
    .expect("a slug that is not UUID-shaped is accepted");
    let bare = &near.simple().to_string()[..31];
    sqlx::query("update core.tenants set slug = $2 where id = $1")
        .bind(near)
        .bind(bare)
        .execute(&pool)
        .await
        .expect("31 hex digits is not UUID-shaped");

    drop_tenant(&pool, near).await;
    drop_tenant(&pool, a).await;
}
