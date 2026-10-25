//! Turns the presence of `DATABASE_URL` into a `cfg`, so the Postgres-backed tests run whenever
//! there is a database and are `#[ignore]`d when there is none. They were a static `#[ignore]`
//! before, so even CI's database job (which sets `DATABASE_URL`) skipped them. Same mechanism as
//! `crates/core/build.rs` and `crates/cli/build.rs`, which carry the full reasoning.
fn main() {
    println!("cargo::rerun-if-env-changed=DATABASE_URL");
    println!("cargo::rustc-check-cfg=cfg(have_database_url)");
    if std::env::var("DATABASE_URL").is_ok_and(|v| !v.trim().is_empty()) {
        println!("cargo::rustc-cfg=have_database_url");
    }
}
