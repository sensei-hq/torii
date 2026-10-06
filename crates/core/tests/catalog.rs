//! The loader against torii's real catalog (seeded scratch Supabase). Expectations are
//! re-derived with SQL here rather than hard-coded, so the test holds for any seed.

use std::collections::BTreeSet;

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn the_gateway_config_is_built_from_the_platform_catalog() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        return;
    };
    let pool = sqlx::PgPool::connect(&url).await.expect("connect");
    // The seed's routers are all active, so add an INACTIVE one: without it, a loader that
    // dropped its is_active filter would pass. Uniquely named, removed below.
    let inactive = format!("tm8-inactive-{}", std::process::id());
    sqlx::query(
        "insert into catalog.routers (name, router_type, is_active, modified_by) \
         values ($1, 'aggregator', false, 'tm8-test')",
    )
    .bind(&inactive)
    .execute(&pool)
    .await
    .expect("seed an inactive router");
    let loaded = torii_core::load_gateway_config(&pool).await;
    sqlx::query("delete from catalog.routers where name = $1")
        .bind(&inactive)
        .execute(&pool)
        .await
        .expect("remove the inactive router");
    let cfg = loaded.expect("the platform catalog loads");
    assert!(
        !cfg.routers.contains_key(&inactive),
        "an inactive router is not loaded"
    );

    // Routers: exactly the active ones.
    let active: Vec<(String,)> = sqlx::query_as("select name from catalog.routers where is_active")
        .fetch_all(&pool)
        .await
        .unwrap();
    let want: BTreeSet<String> = active.into_iter().map(|(n,)| n).collect();
    let got: BTreeSet<String> = cfg.routers.keys().cloned().collect();
    assert_eq!(got, want, "routers = the active catalog routers");
    assert!(
        !got.is_empty(),
        "the seed has routers — an empty set proves nothing"
    );

    // Chains: the seeded platform `chat` chain is there, with entries.
    let chat = cfg
        .chains
        .get("chat")
        .expect("the platform `chat` chain loads");
    assert!(!chat.models.is_empty(), "the `chat` chain has entries");

    // Closure: every chain entry names a model the config defines, routed by a known router.
    for (name, chain) in &cfg.chains {
        for e in &chain.models {
            assert!(
                cfg.models.contains_key(&e.model),
                "chain {name:?} names model {:?} the config does not define",
                e.model
            );
        }
    }
    for (id, m) in &cfg.models {
        assert!(
            cfg.routers.contains_key(&m.provider),
            "model {id:?} routes through {:?}, which is not an active router",
            m.provider
        );
    }
}
