//! Shared fixtures for the Postgres-backed tests. Every test gets its OWN tenant, which is what
//! isolates it: the stores are tenant-scoped, so a store-wide sweep (`claim_due`, `list_paused`,
//! pruning, the registry generation) only ever sees that test's rows. No shared locks, no table
//! truncation, parallel-safe.
#![allow(dead_code)]

use orchestrator_store::{
    PgConfigStore, PgContentStore, PgContextStore, PgJournal, PgSchedulerStore, connect,
};
use sqlx::PgPool;
use uuid::Uuid;

/// `$DATABASE_URL`, or `None` with an announced skip. The `have_database_url` cfg (build.rs) is
/// the first layer; this covers the variable present at build time and gone at run time. The
/// notice goes to the REAL stderr — libtest captures `eprintln!` for passing tests.
pub fn db_url() -> Option<String> {
    let url = std::env::var("DATABASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty());
    if url.is_none() {
        use std::io::Write;
        let name = std::thread::current()
            .name()
            .unwrap_or("<unnamed test>")
            .to_string();
        let line = format!("SKIP {name}: DATABASE_URL not set\n");
        let _ = std::io::stderr().write_all(line.as_bytes());
    }
    url
}

/// A tenant created for one test. `drop_tenant` cascades every row it owns away; a test that
/// panics first leaves its rows behind, under a `tm7-test-` slug, harmless to other tests.
pub struct Tenant {
    pub id: Uuid,
    pub pool: PgPool,
}

impl Tenant {
    pub async fn new(pool: &PgPool) -> Tenant {
        let id = Uuid::new_v4();
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $3, 'tm7-test')",
        )
        .bind(id)
        .bind(format!("tm7 test {id}"))
        .bind(format!("tm7-test-{id}"))
        .execute(pool)
        .await
        .expect("create the test tenant");
        Tenant {
            id,
            pool: pool.clone(),
        }
    }

    pub fn journal(&self) -> PgJournal {
        PgJournal::new(self.pool.clone(), self.id)
    }
    pub fn content(&self) -> PgContentStore {
        PgContentStore::new(self.pool.clone(), self.id)
    }
    pub fn context(&self) -> PgContextStore {
        PgContextStore::new(self.pool.clone(), self.id)
    }
    pub fn scheduler(&self) -> PgSchedulerStore {
        PgSchedulerStore::new(self.pool.clone(), self.id)
    }
    pub fn config(&self) -> PgConfigStore {
        PgConfigStore::new(self.pool.clone(), self.id)
    }

    pub async fn drop_tenant(self) {
        sqlx::query("delete from core.tenants where id = $1")
            .bind(self.id)
            .execute(&self.pool)
            .await
            .expect("drop the test tenant");
    }
}

/// A pool on `$DATABASE_URL`, or `None` (skip).
pub async fn pool() -> Option<PgPool> {
    let url = db_url()?;
    Some(connect(&url).await.expect("connect"))
}
