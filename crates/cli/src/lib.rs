//! `torii` — the operator control plane for the sensei orchestrator.
//!
//! The crate is a lib+bin pair: `src/main.rs` is only the clap surface plus
//! `dispatch`, and everything it calls lives here. The split exists so an
//! integration test can drive the REAL command implementations — notably
//! [`cmd::worker::serve`], whose single-tick contract the cross-process e2e
//! asserts — instead of re-implementing them and asserting on the copy.

pub mod boot;
pub mod cmd;
pub mod diff;
pub mod errors;
pub mod render;

/// Test-only: the `DATABASE_URL` skip notice every DB-gated unit test goes through. (Isolation
/// is a fresh tenant per test — `test_tenant` — not a lock.)
#[cfg(test)]
pub(crate) mod test_guard {
    /// The single choke point for every DB-gated unit test in this crate: `Some(url)` to
    /// run, `None` — plus a VISIBLE skip notice naming the test — to skip.
    ///
    /// **The SECOND layer, since the conditional-ignore gate.** The first is
    /// `#[cfg_attr(not(have_database_url), ignore = "...")]` on every test below, driven by
    /// this package's `build.rs` — that is what makes a database-less run report these as
    /// `ignored` rather than as PASSED, which is what the runtime early-return made them.
    /// This helper still runs, and still announces, for the case the cfg cannot see: the
    /// variable present at BUILD time and gone at run time.
    ///
    /// WHOLE-SLICE FIX 6: a silent early return made a skipped DB suite indistinguishable
    /// from a green one (same test count, same "ok"), so a CI job that loses the variable
    /// reported a fully-passing database suite that touched nothing.
    ///
    /// Written to the process's REAL stderr rather than through `eprintln!`: libtest
    /// captures the print macros and replays them only for a FAILING test, so an
    /// `eprintln!` notice would be invisible in exactly the green run it exists to
    /// annotate. `std::io::stderr()` writes fd 2 directly, bypassing that capture.
    ///
    /// Under libtest the current thread's name IS the test's path, which is what lets one
    /// helper at the choke point still name the test that skipped.
    pub(crate) fn db_url() -> Option<String> {
        let url = database_url_raw();
        if url.is_none() {
            use std::io::Write;
            let name = std::thread::current()
                .name()
                .unwrap_or("<unnamed test>")
                .to_string();
            // Formatted first, then ONE `write_all`: `Stderr` is unbuffered, so a
            // `writeln!` emits a separate syscall per format fragment and a parallel
            // test's output interleaves mid-line.
            let line = format!("SKIP {name}: {} not set\n", crate::boot::ENV_DATABASE_URL);
            let _ = std::io::stderr().write_all(line.as_bytes());
        }
        url
    }

    /// The raw lookup with no side effects; `db_url()` above is the single place that
    /// ANNOUNCES a skip.
    fn database_url_raw() -> Option<String> {
        std::env::var(crate::boot::ENV_DATABASE_URL)
            .ok()
            .filter(|s| !s.trim().is_empty())
    }
}

/// Test-only: a fresh tenant per DB test (TM-8c). torii's stores are tenant-scoped, so a
/// tenant of its own isolates a test completely — store-wide sweeps and the registry
/// generation included — with no shared lock and no table truncation.
#[cfg(test)]
pub(crate) mod test_tenant {
    pub(crate) struct TestTenant {
        pub(crate) id: uuid::Uuid,
        pub(crate) pool: sqlx::PgPool,
        url: String,
    }

    impl TestTenant {
        pub(crate) async fn new(database_url: &str) -> Self {
            let pool = torii_core::connect(database_url, 4).await.expect("connect");
            let id = uuid::Uuid::new_v4();
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, $2, $2, 'torii-cli-test')",
            )
            .bind(id)
            .bind(format!("torii-cli-test-{id}"))
            .execute(&pool)
            .await
            .expect("create the test tenant");
            Self {
                id,
                pool,
                url: database_url.to_string(),
            }
        }

        pub(crate) fn stores(&self) -> torii_core::TenantStores {
            torii_core::TenantStores::open(&self.pool, self.id)
        }
    }

    /// Cascades every row the tenant owns away — also when the test panicked. Over a FRESH
    /// connection on its own thread: the pool belongs to the test's runtime, which `Drop`
    /// cannot drive.
    impl Drop for TestTenant {
        fn drop(&mut self) {
            let (url, id) = (self.url.clone(), self.id);
            let _ = std::thread::spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("runtime");
                rt.block_on(async move {
                    use sqlx::Connection;
                    if let Ok(mut c) = sqlx::PgConnection::connect(&url).await {
                        let _ = sqlx::query("delete from core.tenants where id = $1")
                            .bind(id)
                            .execute(&mut c)
                            .await;
                    }
                });
            })
            .join();
        }
    }
}
