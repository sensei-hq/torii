//! Turns the presence of `DATABASE_URL` into a `cfg`, so the Postgres-backed tests are
//! `#[ignore]`d when there is no database instead of silently returning early — a runtime guard
//! makes libtest count a skipped database test as a PASS. Ported from the gateway's
//! `crates/torii/build.rs`, which carries the full reasoning.
fn main() {
    println!("cargo::rerun-if-env-changed=DATABASE_URL");
    println!("cargo::rustc-check-cfg=cfg(have_database_url)");
    if std::env::var("DATABASE_URL").is_ok_and(|v| !v.trim().is_empty()) {
        println!("cargo::rustc-cfg=have_database_url");
    }
}
