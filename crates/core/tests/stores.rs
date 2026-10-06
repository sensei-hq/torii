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
