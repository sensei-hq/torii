use std::process::Command;

// Bake build identity into the binary so `/health` can identify the BUILD, not just the
// version. `CARGO_PKG_VERSION` is identical for every binary compiled between two bumps, so
// on its own it cannot tell a fresh process from one running a fortnight-old binary — which
// is how a stale launchd-supervised gateway served a schema it predated while happily
// reporting `status: ok`.
//
// NOTE ON RERUN RULES: this script deliberately emits NO `cargo:rerun-if-changed`. That is
// not an oversight. With no rerun directives Cargo re-runs the build script whenever any
// file in the package changes — which is precisely when the binary is rebuilt, so BUILD_DATE
// tracks the actual build. Pinning `rerun-if-changed=.git/HEAD` (the usual reflex) would
// freeze the timestamp across ordinary source edits and make it lie in exactly the situation
// it exists to detect.
fn main() {
    let built_at = iso8601_utc_now();
    println!("cargo:rustc-env=TORII_BUILT_AT={built_at}");

    // Short SHA, with a `-dirty` marker for uncommitted work. Falls back to "unknown" when
    // git is unavailable or there is no .git (a Docker build that does not COPY it) — an
    // honest "we asked and could not tell", which an empty string would not convey.
    println!("cargo:rustc-env=TORII_COMMIT={}", git_describe());
}

/// `SystemTime` → RFC3339 UTC, via the civil-from-days algorithm (Howard Hinnant's
/// `civil_from_days`). Done by hand to keep the build dependency-free: pulling chrono into
/// `[build-dependencies]` would compile it twice, once for the build script and once for the
/// crate, for one timestamp.
fn iso8601_utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    // Shift the epoch to 0000-03-01 so leap days land at the end of the cycle.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn git_describe() -> String {
    let sha = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let Some(sha) = sha else {
        return "unknown".into();
    };

    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .is_some_and(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty());

    if dirty {
        format!("{sha}-dirty")
    } else {
        sha
    }
}
