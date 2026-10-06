//! TM-7 (torii#25): torii's tenant-scoped stores keep the gateway's store conformance suite
//! (gateway TM-3) — the contract that makes them interchangeable with the gateway's in-memory
//! stores as far as the executor can tell. Each suite gets a fresh tenant, which is the "fresh,
//! isolated store" the suite requires.
mod common;
use common::{Tenant, pool};

macro_rules! db_test {
    ($name:ident, $body:expr) => {
        #[cfg_attr(
            not(have_database_url),
            ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied"
        )]
        #[tokio::test]
        async fn $name() {
            let Some(pool) = pool().await else { return };
            let t = Tenant::new(&pool).await;
            #[allow(clippy::redundant_closure_call)]
            ($body)(&t).await;
            t.drop_tenant().await;
        }
    };
}

db_test!(the_journal_keeps_the_conformance_suite, |t: &Tenant| {
    let s = t.journal();
    async move { orchestrator_testkit::journal(&s).await }
});
db_test!(the_content_store_keeps_the_conformance_suite, |t: &Tenant| {
    let s = t.content();
    async move { orchestrator_testkit::content(&s).await }
});
db_test!(the_context_store_keeps_the_conformance_suite, |t: &Tenant| {
    let s = t.context();
    async move { orchestrator_testkit::context(&s).await }
});
db_test!(the_scheduler_store_keeps_the_conformance_suite, |t: &Tenant| {
    let s = t.scheduler();
    async move { orchestrator_testkit::scheduler(&s).await }
});
db_test!(the_config_store_keeps_the_conformance_suite, |t: &Tenant| {
    let s = t.config();
    async move { orchestrator_testkit::config_store(&s).await }
});
