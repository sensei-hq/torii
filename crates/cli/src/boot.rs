//! Wiring: environment and files -> live dependencies. This is torii's ONLY
//! Postgres/env/config-file-aware module: `Executor` takes every backend as an injected
//! `Arc<dyn ...>` precisely so the orchestrator library knows nothing about any of them,
//! and every `cmd` here takes its dependencies as arguments so none of them needs this
//! module either. Concentrating the wiring in one place is what keeps the commands
//! unit-testable against in-memory doubles.

use crate::cmd::run::{NoWakeAttemptCounts, WakeAttemptCounts};
use crate::errors::{CliError, redact_url};
use orchestrator::agent::tools::{
    FsReadTool, FsWriteReconciler, FsWriteTool, ReconcileRegistry, ShellTool, ToolRegistry,
};
use orchestrator::{Executor, Scheduler, WakeRetryPolicy};
use orchestrator_core::{
    Clock, ConfigSource, ConfigStore, ContentStore, ContextStore, ExecutionJournal,
    OrchestratorError, PatternRedactor, RegistryHandle, RulePlannerSelector, RunId, SchedulerStore,
    SystemClock,
};
use orchestrator_store::{
    FilesystemConfigSource, InMemoryConfigStore, InMemoryContentStore, InMemoryContextStore,
    InMemoryJournal, InMemorySchedulerStore,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use torii_core::events::{DEFAULT_EVENT_BUFFER, RunEventSink, RunEvents};
use torii_core::registry::RegistryReloader;

pub const ENV_DATABASE_URL: &str = "DATABASE_URL";
pub const ENV_FENCE_VERSION: &str = "TORII_FENCE_VERSION";
pub const ENV_POOL_SIZE: &str = "TORII_POOL_SIZE";
pub const ENV_BACKEND: &str = "TORII_BACKEND";
pub const ENV_REGISTRY_DIR: &str = "TORII_REGISTRY_DIR";
pub const ENV_TENANT: &str = "TORII_TENANT";
/// AG-3: the scheduler's wake-retry policy ([`WakeRetryPolicy`]) — both heavy-tier drivers
/// (`worker serve`, and `run submit`'s inline drive) build their `Scheduler` from these, so one
/// fleet shares one policy. Unset ⇒ the gateway's defaults.
pub const ENV_WAKE_MAX_ATTEMPTS: &str = "TORII_WAKE_MAX_ATTEMPTS";
pub const ENV_WAKE_BASE_BACKOFF: &str = "TORII_WAKE_BASE_BACKOFF";
pub const ENV_WAKE_MAX_BACKOFF: &str = "TORII_WAKE_MAX_BACKOFF";
/// AG-5: the executor/scheduler seams the heavy tier tunes ([`DrivePolicy`]). Like
/// `TORII_WAKE_*`, parsed here and checked only by [`require_drive_policy`], so only the two
/// commands that drive read them.
pub const ENV_WAKE_LEASE: &str = "TORII_WAKE_LEASE";
pub const ENV_MAP_CONCURRENCY: &str = "TORII_MAP_CONCURRENCY";
pub const ENV_TRANSIENT_ATTEMPTS: &str = "TORII_TRANSIENT_ATTEMPTS";

/// The pool cap when `TORII_POOL_SIZE` is unset: one pool serves every store of a worker, so
/// this is the worker's whole connection budget (`torii_core::connect`).
const DEFAULT_POOL_SIZE: u32 = 8;

/// A sanity ceiling on `TORII_POOL_SIZE`, not an operational policy. Postgres's own
/// out-of-the-box `max_connections` is 100 (roughly 97 usable once superuser/replication
/// reservations are subtracted — see `boot::heavy`'s pool-sharing comment); no single
/// worker process legitimately needs a pool anywhere near that on its own, let alone
/// past it. This exists purely to catch a fat-fingered value (an extra digit, a copy-paste
/// of the wrong env var) at boot instead of at a confusing connection-limit error deep in
/// a run. It is deliberately generous — high enough that it never second-guesses a real
/// operator's tuning of a fleet against a beefier Postgres — so it rejects that class of
/// certain-mistake without trying to enforce a capacity policy this code cannot know.
const MAX_POOL_SIZE: u32 = 1000;

/// Where every store lives (TM-5, gateway#81). Chosen by `TORII_BACKEND`.
#[derive(PartialEq)]
pub enum Backend {
    /// The default: torii's database, one pool behind every store, scoped to ONE tenant.
    /// Needs `DATABASE_URL` and `TORII_TENANT` (a tenant id or slug).
    Postgres {
        database_url: String,
        tenant: String,
    },
    /// Every store in this process's memory — no database at all. For development and
    /// tests: nothing survives the process, so a run submitted here can be observed or
    /// woken only by the same process. The registry is seeded at boot from
    /// `TORII_REGISTRY_DIR` (the same `agents/ skills/ tools/` layout `config push` reads).
    Memory { registry_dir: Option<PathBuf> },
}

/// The validated environment. `fence_version` and `wake_retry` are only required by the heavy
/// tier; `pool_size` only by the Postgres backend.
#[derive(PartialEq)]
pub struct EnvConfig {
    pub backend: Backend,
    pub fence_version: Option<String>,
    pub pool_size: u32,
    /// AG-3: how the heavy tier's `Scheduler` backs off a failing wake, and when it gives up.
    /// Parsed here but CHECKED only by [`require_wake_retry`], exactly as `fence_version` is by
    /// [`require_fence`]: only the commands that drive read it, so a bad value must not break
    /// `run status`, `run list-paused` or `run cancel` — the verbs an operator reaches for while
    /// fixing it.
    pub wake_retry: Result<WakeRetryPolicy, String>,
    /// AG-5: the executor/scheduler seams (`TORII_WAKE_LEASE`, …). Checked only by
    /// [`require_drive_policy`], for the same reason as `wake_retry`.
    pub drive: Result<DrivePolicy, String>,
}

/// AG-5: how the heavy tier's `Executor` and `Scheduler` drive, beyond the wake-retry policy.
/// Every field is set on every boot from an explicit torii default — the gateway's own
/// defaults are private constants torii cannot name, so relying on them would leave the
/// documented default one gateway bump away from silently changing.
#[derive(Debug, Clone, PartialEq)]
pub struct DrivePolicy {
    /// `Scheduler::with_lease`: how old a `waking` claim must be before `tick` treats its
    /// worker as lost and reclaims the run. Default [`DEFAULT_WAKE_LEASE_SECS`].
    pub wake_lease: chrono::Duration,
    /// `Executor::with_concurrency`: the global ceiling on how many children of one `Map`
    /// node are in flight at once (each `Map` asks for its own `concurrency`; the lower of the
    /// two wins). Default [`DEFAULT_MAP_CONCURRENCY`].
    pub map_concurrency: usize,
    /// `Executor::with_max_transient_attempts`: total attempts a node gets at a model call the
    /// gateway reports as retryable before the failure is terminal; `1` turns retry off.
    /// Default [`DEFAULT_TRANSIENT_ATTEMPTS`] — ON, where the gateway's default is off (#34).
    pub transient_attempts: u32,
}

/// The wake lease when `TORII_WAKE_LEASE` is unset — the gateway's own default (60s).
pub const DEFAULT_WAKE_LEASE_SECS: i64 = 60;

/// The `Map` fan-out ceiling when `TORII_MAP_CONCURRENCY` is unset — the gateway's own default.
pub const DEFAULT_MAP_CONCURRENCY: usize = 8;

/// A typo ceiling on `TORII_MAP_CONCURRENCY`, not a capacity policy (see [`MAX_POOL_SIZE`]):
/// every in-flight child journals over the one `TORII_POOL_SIZE` pool, so a value far past it
/// only queues children on connections.
const MAX_MAP_CONCURRENCY: usize = 256;

/// Transient-failure attempts when `TORII_TRANSIENT_ATTEMPTS` is unset. The gateway defaults to
/// 1 (off) because enabling it retries essentially EVERY provider failure the gateway does not
/// classify as needing a person — auth and credit exhaustion pause for an operator instead and
/// never reach this path — which costs latency and, against a permanently broken provider, a
/// few wasted calls. torii decides that trade for its operators (#34): a single provider 500
/// failing a whole run is the worse default, and 3 attempts bounds the waste.
pub const DEFAULT_TRANSIENT_ATTEMPTS: u32 = 3;

/// A typo ceiling on `TORII_TRANSIENT_ATTEMPTS`. The gateway's backoff between attempts is 2s,
/// doubling, capped at 60s, so 20 attempts already waits out a provider for ~15 minutes.
const MAX_TRANSIENT_ATTEMPTS: u32 = 20;

impl Default for DrivePolicy {
    fn default() -> Self {
        Self {
            wake_lease: chrono::Duration::seconds(DEFAULT_WAKE_LEASE_SECS),
            map_concurrency: DEFAULT_MAP_CONCURRENCY,
            transient_attempts: DEFAULT_TRANSIENT_ATTEMPTS,
        }
    }
}

/// Manual, NOT derived: `#[derive(Debug)]` would put the plaintext database
/// password one `{:?}` away, in the module whose entire error discipline is
/// routing that string through `redact_url`. `Debug` is still load-bearing (the
/// tests below use `expect`/`expect_err`, which require it) — this just makes
/// sure it never prints the secret.
impl std::fmt::Debug for EnvConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let backend = match &self.backend {
            Backend::Postgres {
                database_url,
                tenant,
            } => format!("postgres({}, tenant {tenant:?})", redact_url(database_url)),
            Backend::Memory { registry_dir } => format!("memory({registry_dir:?})"),
        };
        f.debug_struct("EnvConfig")
            .field("backend", &backend)
            .field("fence_version", &self.fence_version)
            .field("pool_size", &self.pool_size)
            .field("wake_retry", &self.wake_retry)
            .field("drive", &self.drive)
            .finish()
    }
}

/// Parse `TORII_POOL_SIZE`, mirroring `cmd::worker::parse_interval`'s discipline: reject
/// anything that isn't a plain positive integer, loudly and with the offending value
/// echoed back. A zero-size pool cannot serve any connection, and anything past
/// [`MAX_POOL_SIZE`] is treated as a typo rather than an intentional value — see its doc
/// comment.
fn parse_pool_size(s: &str) -> Result<u32, String> {
    let s = s.trim();
    let v: u32 = s
        .parse()
        .map_err(|_| format!("invalid {ENV_POOL_SIZE} {s:?}: {s:?} is not a whole number"))?;
    if v == 0 {
        return Err(format!(
            "invalid {ENV_POOL_SIZE} {s:?}: a zero-size pool cannot serve any connection"
        ));
    }
    if v > MAX_POOL_SIZE {
        return Err(format!(
            "invalid {ENV_POOL_SIZE} {s:?}: exceeds the sanity ceiling of {MAX_POOL_SIZE} \
             (almost certainly a typo) — Postgres's own default max_connections is 100, so a \
             single worker process asking for a pool anywhere near {MAX_POOL_SIZE} is not a \
             realistic tuning value"
        ));
    }
    Ok(v)
}

/// Validate the environment through an injected getter, so tests never mutate
/// process env (which is `unsafe` in edition 2024 and racy across parallel tests).
pub fn env_config_from(get: impl Fn(&str) -> Option<String>) -> Result<EnvConfig, CliError> {
    let non_empty = |k: &str| get(k).filter(|s| !s.trim().is_empty());
    let backend = match non_empty(ENV_BACKEND).map(|s| s.trim().to_ascii_lowercase()) {
        None => postgres_backend(&non_empty)?,
        Some(b) if b == "postgres" => postgres_backend(&non_empty)?,
        Some(b) if b == "memory" => Backend::Memory {
            registry_dir: non_empty(ENV_REGISTRY_DIR).map(PathBuf::from),
        },
        Some(other) => {
            return Err(CliError::error(format!(
                "unknown {ENV_BACKEND} {other:?}: expected `postgres` (the default) or `memory`"
            )));
        }
    };
    let fence_version = get(ENV_FENCE_VERSION).filter(|s| !s.trim().is_empty());
    let pool_size = match get(ENV_POOL_SIZE).filter(|s| !s.trim().is_empty()) {
        Some(raw) => parse_pool_size(&raw).map_err(CliError::error)?,
        None => DEFAULT_POOL_SIZE,
    };
    let wake_retry = wake_retry_from(&non_empty);
    let drive = drive_policy_from(&non_empty);
    Ok(EnvConfig {
        backend,
        fence_version,
        pool_size,
        wake_retry,
        drive,
    })
}

/// AG-5: the `TORII_*` drive overrides on top of [`DrivePolicy::default`]. Each unset (or
/// blank) variable keeps its default; a set one is parsed loudly, naming the variable and
/// echoing the value. Durations take `worker serve --interval`'s units (`500ms`, `30s`, `15m`).
fn drive_policy_from(non_empty: &impl Fn(&str) -> Option<String>) -> Result<DrivePolicy, String> {
    let mut policy = DrivePolicy::default();
    if let Some(raw) = non_empty(ENV_WAKE_LEASE) {
        // `parse_interval` already refuses zero: a zero lease would treat every claim as
        // abandoned the moment it was taken.
        let d = crate::cmd::worker::parse_interval(&raw)
            .map_err(|e| format!("{ENV_WAKE_LEASE}: {e}"))?;
        policy.wake_lease = chrono::Duration::from_std(d)
            .map_err(|_| format!("{ENV_WAKE_LEASE}: {:?} is out of range", raw.trim()))?;
    }
    if let Some(raw) = non_empty(ENV_MAP_CONCURRENCY) {
        let s = raw.trim();
        policy.map_concurrency = match s.parse::<usize>() {
            Ok(0) => {
                return Err(format!(
                    "invalid {ENV_MAP_CONCURRENCY} {s:?}: a Map needs at least one child in \
                     flight (1 runs them one at a time)"
                ));
            }
            Ok(n) if n > MAX_MAP_CONCURRENCY => {
                return Err(format!(
                    "invalid {ENV_MAP_CONCURRENCY} {s:?}: exceeds the sanity ceiling of \
                     {MAX_MAP_CONCURRENCY} (almost certainly a typo) — every in-flight child \
                     journals over the {ENV_POOL_SIZE} pool"
                ));
            }
            Ok(n) => n,
            Err(_) => {
                return Err(format!(
                    "invalid {ENV_MAP_CONCURRENCY} {s:?}: {s:?} is not a positive whole number"
                ));
            }
        };
    }
    if let Some(raw) = non_empty(ENV_TRANSIENT_ATTEMPTS) {
        let s = raw.trim();
        policy.transient_attempts = match s.parse::<u32>() {
            // The gateway reads 0 as 1; an operator who wrote 0 may have meant "unlimited",
            // which does not exist — so it is refused rather than silently read as "off".
            Ok(0) => {
                return Err(format!(
                    "invalid {ENV_TRANSIENT_ATTEMPTS} {s:?}: a node needs at least one attempt \
                     (1 turns retry off; there is no \"unlimited\")"
                ));
            }
            Ok(n) if n > MAX_TRANSIENT_ATTEMPTS => {
                return Err(format!(
                    "invalid {ENV_TRANSIENT_ATTEMPTS} {s:?}: exceeds the sanity ceiling of \
                     {MAX_TRANSIENT_ATTEMPTS} (almost certainly a typo)"
                ));
            }
            Ok(n) => n,
            Err(_) => {
                return Err(format!(
                    "invalid {ENV_TRANSIENT_ATTEMPTS} {s:?}: {s:?} is not a positive whole number"
                ));
            }
        };
    }
    Ok(policy)
}

/// AG-3: the `TORII_WAKE_*` overrides on top of the gateway's [`WakeRetryPolicy`] default.
/// Each unset (or blank) variable keeps the default; a set one is parsed with the same
/// discipline as `TORII_POOL_SIZE` — loud, naming the variable and echoing the value.
/// Backoffs take `worker serve --interval`'s units (`500ms`, `30s`, `15m`).
fn wake_retry_from(non_empty: &impl Fn(&str) -> Option<String>) -> Result<WakeRetryPolicy, String> {
    let mut policy = WakeRetryPolicy::default();
    if let Some(raw) = non_empty(ENV_WAKE_MAX_ATTEMPTS) {
        let s = raw.trim();
        policy.max_attempts = match s.parse::<u32>() {
            Ok(0) => {
                return Err(format!(
                    "invalid {ENV_WAKE_MAX_ATTEMPTS} {s:?}: a run needs at least one wake \
                     attempt (there is no \"unlimited\" — a capless retry is the crash loop \
                     this cap exists to end)"
                ));
            }
            Ok(n) => n,
            Err(_) => {
                return Err(format!(
                    "invalid {ENV_WAKE_MAX_ATTEMPTS} {s:?}: {s:?} is not a positive whole number"
                ));
            }
        };
    }
    let backoff = |var: &str| -> Result<Option<chrono::Duration>, String> {
        let Some(raw) = non_empty(var) else {
            return Ok(None);
        };
        let d = crate::cmd::worker::parse_interval(&raw).map_err(|e| format!("{var}: {e}"))?;
        chrono::Duration::from_std(d)
            .map(Some)
            .map_err(|_| format!("{var}: {:?} is out of range", raw.trim()))
    };
    if let Some(d) = backoff(ENV_WAKE_BASE_BACKOFF)? {
        policy.base_backoff = d;
    }
    if let Some(d) = backoff(ENV_WAKE_MAX_BACKOFF)? {
        policy.max_backoff = d;
    }
    if policy.base_backoff > policy.max_backoff {
        return Err(format!(
            "{ENV_WAKE_BASE_BACKOFF} ({}s) exceeds {ENV_WAKE_MAX_BACKOFF} ({}s): every retry \
             would wait the ceiling and the backoff would never grow — lower the base or raise \
             the ceiling (unset, they are 30s and 60m)",
            policy.base_backoff.num_seconds(),
            policy.max_backoff.num_seconds()
        ));
    }
    Ok(policy)
}

fn postgres_backend(non_empty: &impl Fn(&str) -> Option<String>) -> Result<Backend, CliError> {
    let database_url = non_empty(ENV_DATABASE_URL).ok_or_else(|| {
        CliError::error(format!(
            "{ENV_DATABASE_URL} is not set.\n\
             torii reads the Postgres connection string from the environment only — a flag \
             would put the password in `ps` output and shell history. (For a run with no \
             database at all, set {ENV_BACKEND}=memory.)"
        ))
    })?;
    let tenant = non_empty(ENV_TENANT)
        .map(|t| t.trim().to_string())
        .ok_or_else(|| {
            CliError::error(format!(
                "{ENV_TENANT} is not set.\n\
                 torii's database holds many tenants, and every run, journal and registry \
                 belongs to one of them — set {ENV_TENANT} to a tenant id or slug. (For a run \
                 with no database at all, set {ENV_BACKEND}=memory.)"
            ))
        })?;
    Ok(Backend::Postgres {
        database_url,
        tenant,
    })
}

pub fn env_config() -> Result<EnvConfig, CliError> {
    env_config_from(|k| std::env::var(k).ok())
}

/// What replaces credential material scrubbed out of text torii did not compose.
const REDACTED: &str = "<redacted>";

/// The credential material in a connection string, so it can be scrubbed out of an
/// error message torii did NOT compose (see [`connect_failure`]).
///
/// The username is deliberately NOT a needle. It is not a secret, `redact_url` drops it
/// from the part torii composes anyway, and scrubbing it would mangle every legitimate
/// error for the overwhelmingly common `postgres://postgres@host/postgres` — where the
/// scheme, the user and the database name are all the same token.
fn credential_needles(url: &str) -> Vec<&str> {
    let mut out = vec![url];
    // No `://` means a scheme-less URL, which is exactly the shape that leaks: `Url::parse`
    // reads `operator:s3cret@host:5433/db` as scheme `operator` + an opaque path, so sqlx
    // takes the whole password-onward tail as the DATABASE NAME and the server echoes it
    // back in `database "…" does not exist`. Treating the whole string as the post-scheme
    // remainder is what finds the userinfo in that case.
    let after_scheme = url.split_once("://").map_or(url, |(_scheme, rest)| rest);
    if let Some((userinfo, _host_and_path)) = after_scheme.rsplit_once('@')
        && let Some((_user, password)) = userinfo.split_once(':')
    {
        out.push(userinfo);
        out.push(password);
    }
    out
}

/// Replace every occurrence of `url`'s credential material in `text`.
///
/// Deliberately fail-closed: a one-character password is scrubbed too, which can mangle an
/// unrelated word in the message. An over-scrubbed error message is a cosmetic annoyance;
/// an under-scrubbed one is a credential in journald and CI logs. (Known limit: a
/// percent-encoded password that some layer decodes before printing would not match. No
/// shipped sqlx error does that — it echoes the string it was given.)
fn scrub_credentials(text: &str, url: &str) -> String {
    let mut needles = credential_needles(url);
    // Longest first: replacing a nested needle (the password) before the string that
    // contains it (the whole URL) would leave the outer match broken and its remaining
    // fragments in place.
    needles.sort_unstable_by_key(|n| std::cmp::Reverse(n.len()));
    let mut out = text.to_string();
    for n in needles {
        // `str::replace` with an empty pattern splices the replacement between every
        // character — a URL with no password must not shred the message.
        if !n.is_empty() {
            out = out.replace(n, REDACTED);
        }
    }
    out
}

/// Compose a connect failure without echoing the connection string.
///
/// `redact_url` covers the half torii interpolates itself, but it CANNOT cover the sqlx
/// error's own text, which carries the raw input: for a scheme-less `DATABASE_URL` (an
/// ordinary secret-store mistake) `redact_url` correctly returns its placeholder and the
/// adjacent `{e}` then prints `database "s3cret@127.0.0.1:5433/postgres" does not exist`,
/// defeating it entirely. Both connect sites go through here so neither can regress.
fn connect_failure(database_url: &str, err: &str) -> String {
    format!(
        "cannot connect to {}: {}",
        redact_url(database_url),
        scrub_credentials(err, database_url)
    )
}

/// Where the heavy tier gets its [`GatewayConfig`](kernel::types::config::GatewayConfig) — the
/// routers, models and chains (TM-4, gateway#80). Boot consumes this seam instead of reading a
/// file itself, so the same boot runs against a JSON file (the gateway CLI's
/// `--gateway-config`) or, after the move to torii, torii's own `catalog` schema.
#[async_trait::async_trait]
pub trait GatewayConfigSource: Send + Sync {
    /// Load and parse the whole config. Errors must never echo its contents: it holds
    /// provider API keys.
    async fn load(&self) -> Result<kernel::types::config::GatewayConfig, CliError>;
    /// Names the source in operator messages (a path, a database) — never its contents.
    fn describe(&self) -> String;
}

/// The `--gateway-config <file>` source: a JSON `GatewayConfig`.
pub struct FileGatewayConfigSource {
    path: PathBuf,
}

impl FileGatewayConfigSource {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

#[async_trait::async_trait]
impl GatewayConfigSource for FileGatewayConfigSource {
    async fn load(&self) -> Result<kernel::types::config::GatewayConfig, CliError> {
        // The file holds provider API keys: report its PATH on failure, never its contents.
        let raw = std::fs::read_to_string(&self.path)
            .map_err(|e| CliError::error(format!("cannot read {}: {e}", self.path.display())))?;
        serde_json::from_str(&raw).map_err(|e| gateway_config_parse_error(&self.path, &e))
    }
    fn describe(&self) -> String {
        self.path.display().to_string()
    }
}

/// torii's catalog (`catalog.routers / models / chains`, platform tenant) — the SAME loader the
/// API uses (`torii_core::load_gateway_config`), so the CLI and the API cannot disagree about
/// which chains exist. The only gateway-config source on the Postgres backend.
pub struct CatalogGatewayConfigSource {
    pool: sqlx::PgPool,
}

impl CatalogGatewayConfigSource {
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl GatewayConfigSource for CatalogGatewayConfigSource {
    async fn load(&self) -> Result<kernel::types::config::GatewayConfig, CliError> {
        torii_core::load_gateway_config(&self.pool)
            .await
            .map_err(|e| {
                CliError::error(format!(
                    "cannot load the gateway config from torii's catalog: {e:#}"
                ))
            })
    }
    fn describe(&self) -> String {
        "torii's catalog".to_string()
    }
}

/// Every chain id the registry references — agent `chain`, per-phase `chains`, `(area, kind)`
/// bindings — that the gateway config does not define, attributed to who referenced it.
/// Shared by `config push --gateway-config` (push time) and the heavy tier (boot time).
pub(crate) fn unresolved_chain_refs<'a>(
    agents: impl Iterator<Item = &'a orchestrator_core::AgentDefinition>,
    bindings: impl Iterator<Item = (&'a str, &'a str, &'a str)>,
    chains: &std::collections::HashMap<String, kernel::types::config::FallbackChainConfig>,
) -> Vec<(String, String)> {
    let mut out = std::collections::BTreeSet::new();
    for a in agents {
        if let Some(c) = &a.chain
            && !chains.contains_key(c)
        {
            out.insert((format!("agent {:?}", a.name), c.clone()));
        }
        // Per-phase overrides too: a check that walks only `agent.chain` passes every obvious
        // test while missing the collection a real config is most likely to drift in.
        for (phase, c) in &a.chains {
            if !chains.contains_key(c) {
                out.insert((format!("agent {:?} phase {:?}", a.name, phase), c.clone()));
            }
        }
    }
    for (area, kind, c) in bindings {
        if !chains.contains_key(c) {
            out.insert((format!("chain binding {area:?}/{kind:?}"), c.to_string()));
        }
    }
    out.into_iter().collect()
}

/// The always-on boot check (TM-4): a registry bound to a chain the gateway config does not
/// define refuses to boot, naming every missing id and who referenced it. Without it the
/// mismatch surfaces only at run time, as an empty candidate set and a terminal `NodeFailed`
/// naming neither the cause nor the remedy.
pub(crate) fn require_chains_resolve(
    registry: &orchestrator_core::Registry,
    gw: &kernel::types::config::GatewayConfig,
    source: &str,
) -> Result<(), CliError> {
    let missing = unresolved_chain_refs(registry.agents(), registry.chain_bindings(), &gw.chains);
    if missing.is_empty() {
        return Ok(());
    }
    let list = missing
        .iter()
        .map(|(who, chain)| format!("{who} → chain {chain:?}"))
        .collect::<Vec<_>>()
        .join("; ");
    Err(CliError::error(format!(
        "the registry references chains the gateway config ({source}) does not define: {list}. \
         Every run reaching one of them would fail with no candidates. Add the chains to the \
         gateway config, or push a registry that uses ones it defines."
    )))
}

/// A gateway-config parse failure reports the serde error's LOCATION ONLY — never its
/// `Display`, which echoes the offending VALUE (`invalid type: string "sk-live-…",
/// expected struct RouterConfig`). This file is the one that holds provider API keys, and
/// the single most likely first-run typo is pasting a key where a struct belongs — which
/// would put a live credential in a worker's stderr and thus in journald/CI logs.
/// `RouterConfig` already has a redacting `Debug` for exactly this reason; the serde error
/// is the hole that bypasses it. Line/column/category is enough to find the problem.
pub(crate) fn gateway_config_parse_error(path: &Path, e: &serde_json::Error) -> CliError {
    CliError::error(format!(
        "{} is not a valid gateway config: {:?} error at line {} column {}. \
         The offending value is deliberately not echoed — this file holds provider API keys.",
        path.display(),
        e.classify(),
        e.line(),
        e.column()
    ))
}

/// The heavy tier additionally requires the fence base.
pub fn require_fence(env: &EnvConfig) -> Result<&str, CliError> {
    env.fence_version.as_deref().ok_or_else(|| {
        CliError::error(format!(
            "{ENV_FENCE_VERSION} is not set.\n\
             The fence base is recorded in every run and checked on resume, so a fleet must \
             agree on it. Set it explicitly (e.g. {ENV_FENCE_VERSION}=v1) — deriving it from \
             the build version would strand every paused run on a routine deploy."
        ))
    })
}

/// The heavy tier additionally requires a valid wake-retry policy (`TORII_WAKE_*`, the
/// gateway's defaults when unset) — refused loudly, naming the variable and its value.
pub fn require_wake_retry(env: &EnvConfig) -> Result<WakeRetryPolicy, CliError> {
    env.wake_retry.clone().map_err(CliError::error)
}

/// AG-5: the heavy tier additionally requires a valid [`DrivePolicy`] (`TORII_WAKE_LEASE`, …,
/// torii's explicit defaults when unset) — refused loudly, naming the variable and its value.
pub fn require_drive_policy(env: &EnvConfig) -> Result<DrivePolicy, CliError> {
    env.drive.clone().map_err(CliError::error)
}

/// Install a `tracing` subscriber reading `RUST_LOG` (default `info`). Writes to
/// STDERR specifically — never stdout — so `--json` command output stays
/// machine-parseable. `try_init` (not `init`) so a double call (e.g. a test, or
/// two entry points in one process) never panics; it just keeps the first
/// subscriber installed.
pub fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

/// `FacadeBuilder::build` is infallible by design (facade.rs: an unrecognised or
/// failing router is logged and skipped, never surfaced as an `Err`) — so this is
/// the ONLY place a completely broken gateway config is caught, before a worker
/// boots happily and then terminally fails every run it wakes with zero signal.
///
/// The message names the routers that WERE present but produced no adapter (not
/// just "check your config"): a generic "check the router names and API keys"
/// misdirects an operator whose config is otherwise correct but names an
/// unsupported/skipped router (e.g. `bedrock`, which `register_cloud_from_config`
/// deliberately never registers from config alone) — they would re-verify valid
/// values and stay stuck. Naming the actual routers makes any future skipped-router
/// case self-diagnosing instead of needing its own bespoke message.
// Guards `heavy()`; tested directly below without a live provider.
fn require_adapters(
    registered: &[String],
    configured_routers: &[String],
    gateway_config: &str,
) -> Result<(), CliError> {
    if registered.is_empty() {
        let detail = if configured_routers.is_empty() {
            "it has no routers configured at all".to_string()
        } else {
            format!(
                "it configured {} but none produced a working adapter — an unsupported or \
                 not-yet-wired router (e.g. `bedrock`, which requires explicit AWS SDK setup \
                 and is never registered from config alone) is silently skipped, not reported \
                 as an error",
                configured_routers.join(", ")
            )
        };
        return Err(CliError::error(format!(
            "{gateway_config} registered no provider adapters: {detail}. Every model call would \
             fail, and a worker would terminally fail every run it wakes."
        )));
    }
    Ok(())
}

/// `RegistryHandle::from_source` succeeds on an EMPTY registry (a fresh database,
/// or one nobody has pushed config to yet, is a perfectly valid — if useless —
/// registry). A worker with zero agents cannot do useful work; refusing loud at
/// boot is far cheaper than an operator discovering it one burned run at a time.
// Guards `heavy()`; tested directly below without a live database.
fn require_agents(
    agents: usize,
    skills: usize,
    tools: usize,
    generation: u64,
) -> Result<(), CliError> {
    if agents == 0 {
        return Err(CliError::error(format!(
            "the registry at generation {generation} has zero agents (skills={skills}, \
             tools={tools}). A worker with no agents cannot do useful work — run `torii config \
             push` first, or check that DATABASE_URL and TORII_TENANT point at the intended database \
             and tenant."
        )));
    }
    Ok(())
}

/// The `--gateway-config` file this backend takes, if any (TM-8c): none on Postgres — its gateway
/// config is torii's catalog, and a file there is refused rather than silently preferred or
/// ignored — and exactly one on memory, which has no catalog.
pub fn gateway_config_file_for(
    backend: &Backend,
    file: Option<&Path>,
) -> Result<Option<FileGatewayConfigSource>, CliError> {
    match (backend, file) {
        (Backend::Postgres { .. }, None) => Ok(None),
        (Backend::Postgres { .. }, Some(_)) => Err(CliError::error(format!(
            "--gateway-config is not accepted with {ENV_BACKEND}=postgres: the gateway config is \
             torii's catalog — the same one the API routes with — so a file here would be a \
             second source the API never sees. It is only for {ENV_BACKEND}=memory."
        ))),
        (Backend::Memory { .. }, Some(path)) => Ok(Some(FileGatewayConfigSource::new(path))),
        (Backend::Memory { .. }, None) => Err(CliError::error(format!(
            "--gateway-config is required with {ENV_BACKEND}=memory: there is no catalog to read \
             the routers, models and chains from."
        ))),
    }
}

/// Light tier: everything reachable with just a database. No gateway, no model
/// credentials, no fence — so an operator can cancel a runaway run or inspect the
/// wake queue on a box that has none of those.
///
/// SP-DATA-5 Task 5 adds `journal`: a run's token spend lives in the JOURNAL
/// (`EffectRecorded.usage`), not the `scheduled_runs` row, so both `torii run
/// status` (fold spent/budget for display) and `torii run wake --budget-tokens`
/// (append `BudgetRaised` before waking) need one. Adding it here costs nothing —
/// it is just another adapter over the SAME pool this tier already opens
/// (`light_from_pool` clones it) — and keeping it on the light tier matters: an
/// operator must be able to inspect AND raise a run's budget on a box with no
/// model credentials.
pub struct LightDeps {
    pub scheduler_store: Arc<dyn SchedulerStore>,
    pub journal: Arc<dyn ExecutionJournal>,
    pub config_source: Arc<dyn ConfigStore>,
    /// The backend's own gateway config: torii's catalog on Postgres; `None` on the memory
    /// backend, which has no catalog and takes `--gateway-config` instead.
    pub gateway_config: Option<Arc<dyn GatewayConfigSource>>,
    /// AG-3: the scheduler's per-run wake-attempt counter, for `run status`.
    pub wake_attempts: Arc<dyn WakeAttemptCounts>,
    /// AG-4: the tenant's CAS, so `run results` can resolve an output stored as a ref. The SAME
    /// store the heavy tier hands the executor — a ref the executor wrote is readable here.
    pub content: Arc<dyn ContentStore>,
}

/// AG-3: torii's Postgres scheduler keeps the counter in `runs.scheduled_runs.attempts`.
#[async_trait::async_trait]
impl WakeAttemptCounts for torii_core::stores::PgSchedulerStore {
    async fn wake_attempts(&self, run: RunId) -> Result<Option<u32>, OrchestratorError> {
        torii_core::stores::PgSchedulerStore::wake_attempts(self, run).await
    }
}

/// Every store one backend provides — the light tier's (the CAS among them, for `run results`)
/// plus the heavy tier's blackboard — built in ONE place, so no tier names a backend type (TM-5).
struct Stores {
    light: LightDeps,
    context: Arc<dyn ContextStore>,
}

async fn open_stores(env: &EnvConfig) -> Result<Stores, CliError> {
    match &env.backend {
        Backend::Postgres {
            database_url,
            tenant,
        } => {
            // torii's database, through torii-core — the same layer the API reads it through.
            // ONE pool for every store and the catalog: cloning a `PgPool` is an `Arc::clone`,
            // so the whole process is capped at `TORII_POOL_SIZE` connections.
            let pool = torii_core::connect(database_url, env.pool_size)
                .await
                .map_err(|e| CliError::error(connect_failure(database_url, &e.to_string())))?;
            let tenant_id = torii_core::resolve_tenant(&pool, tenant)
                .await
                .map_err(|e| CliError::error(format!("{ENV_TENANT}: {e}")))?;
            let stores = torii_core::TenantStores::open(&pool, tenant_id);
            // ONE store object behind both the trait and the attempt-counter reader.
            let scheduler = Arc::new(stores.scheduler);
            Ok(Stores {
                light: LightDeps {
                    scheduler_store: scheduler.clone(),
                    journal: Arc::new(stores.journal),
                    config_source: Arc::new(stores.config),
                    gateway_config: Some(Arc::new(CatalogGatewayConfigSource::new(pool))),
                    wake_attempts: scheduler,
                    content: Arc::new(stores.content),
                },
                context: Arc::new(stores.context),
            })
        }
        Backend::Memory { registry_dir } => {
            let config = InMemoryConfigStore::new();
            if let Some(dir) = registry_dir {
                let cfg = FilesystemConfigSource::new(dir).load().await.map_err(|e| {
                    CliError::error(format!(
                        "{ENV_REGISTRY_DIR}={}: cannot load the registry: {e}",
                        dir.display()
                    ))
                })?;
                config.store_and_bump(&cfg).await?;
            }
            let content: Arc<dyn ContentStore> = Arc::new(InMemoryContentStore::new());
            Ok(Stores {
                light: LightDeps {
                    scheduler_store: Arc::new(InMemorySchedulerStore::new()),
                    journal: Arc::new(InMemoryJournal::default()),
                    config_source: Arc::new(config),
                    gateway_config: None,
                    wake_attempts: Arc::new(NoWakeAttemptCounts),
                    content: content.clone(),
                },
                context: Arc::new(InMemoryContextStore::new(content)),
            })
        }
    }
}

pub async fn light(env: &EnvConfig) -> Result<LightDeps, CliError> {
    Ok(open_stores(env).await?.light)
}

/// Heavy tier: a full Executor behind a Scheduler. Adds the gateway config file
/// and the fence base.
pub struct HeavyDeps {
    // Not read by the current dispatch (only `.scheduler` is): kept for a future
    // heavy-tier command that needs the shared pool's config source directly, or a
    // test that wants to fast-forward the injected clock.
    #[allow(dead_code)]
    pub light: LightDeps,
    pub scheduler: Scheduler,
    #[allow(dead_code)]
    pub clock: Arc<dyn Clock>,
    /// AG-18: the run events the scheduler's drives report (torii-core's `RunEventSink`).
    pub events: RunEvents,
    /// AG-5: the registry handle the executor pins each run from, following the tenant's
    /// durable config — `worker serve` refreshes it before every tick.
    pub registry: RegistryReloader,
    /// The chains this boot's gateway serves. A reloaded registry is checked against them:
    /// the catalog is read once, at boot, so a chain added there since is unknown here.
    pub gateway_chains: HashMap<String, kernel::types::config::FallbackChainConfig>,
}

impl HeavyDeps {
    /// What `worker serve` ticks: the scheduler, behind a registry refresh (AG-5).
    pub fn ticker(&self) -> crate::cmd::worker::Reloading<'_> {
        crate::cmd::worker::Reloading {
            inner: &self.scheduler,
            registry: &self.registry,
            gateway_chains: &self.gateway_chains,
        }
    }
}

pub async fn heavy(
    env: &EnvConfig,
    gateway_config_file: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Result<HeavyDeps, CliError> {
    let fence = require_fence(env)?.to_string();
    let wake_retry = require_wake_retry(env)?;
    let drive = require_drive_policy(env)?;
    // ONE gateway-config source per backend (TM-8c), decided before any connection: the
    // catalog on Postgres (a file there would be a second source the API never sees), the
    // file on memory (there is no catalog).
    let file = gateway_config_file_for(&env.backend, gateway_config_file)?;
    // A file loads FIRST: it is offline, so a bad `--gateway-config` path is caught before any
    // store opens.
    let file_config = match &file {
        Some(f) => Some(f.load().await?),
        None => None,
    };

    // Every store from ONE backend (TM-5): for Postgres, one shared pool; for memory, this
    // process's heap. The journal the Executor writes is the SAME one the Scheduler reads, so
    // `tick`'s pause-deadline read sees what `run` wrote.
    let Stores { light, context } = open_stores(env).await?;
    let (gw_config, gw_source) = match (file_config, &file, &light.gateway_config) {
        (Some(cfg), Some(f), _) => (cfg, f.describe()),
        (_, _, Some(catalog)) => (catalog.load().await?, catalog.describe()),
        _ => {
            unreachable!("gateway_config_file_for returns a file exactly when there is no catalog")
        }
    };

    // One atomic (config, generation) read — the fence generation must match the
    // config it was computed from.
    let handle =
        RegistryHandle::from_source(light.config_source.as_ref() as &dyn ConfigSource).await?;
    // `snapshot()`, not `.current()` + `.generation()` as two separate lock
    // acquisitions: those release the lock in between, which is exactly the torn
    // -read shape SP-DATA-2 eliminated — and since AG-5 `worker serve` does `reload()` this
    // handle (`RegistryReloader`), so a torn pair is a real hazard, not a hypothetical one.
    let (registry, generation) = handle.snapshot();
    let agents_n = registry.agents().count();
    let skills_n = registry.skills().count();
    let tools_n = registry.tools().count();
    tracing::info!(
        generation,
        agents = agents_n,
        skills = skills_n,
        tools = tools_n,
        "registry loaded"
    );
    require_agents(agents_n, skills_n, tools_n, generation)?;
    // TM-4: always on — a registry bound to a chain this gateway config lacks refuses to
    // boot, rather than failing every run that reaches the chain.
    require_chains_resolve(&registry, &gw_config, &gw_source)?;

    // `Gateway::new` is the low-level, hand-wired constructor (an empty adapter
    // registry). `FacadeBuilder` is the composition root that actually registers a
    // provider adapter per router in the config — the point of reading this file at
    // all — so it is what boots a gateway that can reach a real model. Its `build()`
    // is infallible by design (a bad router is logged and skipped), so `registered`
    // is captured from the shared, Arc-backed registry BEFORE `build()` consumes the
    // builder, and checked right after.
    let configured_routers: Vec<String> = gw_config.routers.keys().cloned().collect();
    let gateway_chains = gw_config.chains.clone();
    let builder = gateway::FacadeBuilder::new(gw_config);
    let registered = builder.registry().clone();
    let facade = builder.build().await;
    require_adapters(&registered.list().await, &configured_routers, &gw_source)?;
    let gateway = Arc::new(facade.gateway);

    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    // AG-18: hooks on EVERY drive. This executor is the only one the binary builds, and both
    // drivers (`worker serve`, `run submit`'s inline drive) take it from here — the light-tier
    // verbs (`signal`, `gate`, `agent`, `tool`, `wake`) only append and `force_wake`, they
    // never drive. A drive WITHOUT hooks that honoured a decision would leave no
    // `DecisionHookFired` marker, so the next hooked drive would report that decision late.
    let (sink, events) = RunEventSink::bounded(DEFAULT_EVENT_BUFFER);
    let mut executor = Executor::new(gateway, light.journal.clone(), fence)
        .with_hooks(sink)
        // AG-5: the global `Map` fan-out ceiling (TORII_MAP_CONCURRENCY, default 8).
        .with_concurrency(drive.map_concurrency)
        // AG-5: retry a transient provider failure (TORII_TRANSIENT_ATTEMPTS, default 3 — ON;
        // see `DEFAULT_TRANSIENT_ATTEMPTS` for why torii overrides the gateway's off).
        .with_max_transient_attempts(drive.transient_attempts)
        .with_content_store(light.content.clone())
        .with_context_store(context)
        .with_registry_handle(handle.clone())
        // A production binary defaults SECURE: s2 leaves the redactor off in the
        // library to stay byte-identical, but here it is unconditional and there is
        // deliberately no --no-redact flag.
        .with_redactor(Arc::new(PatternRedactor::default()))
        .with_clock(clock.clone())
        // The built-in tools the config-declared ToolSpecs promise the model (fs
        // read/write + shell). Safe unconditionally: `fs_read`/`fs_write` refuse
        // loud without `ToolContext.workspace_root`, and `shell` refuses loud
        // without a wired sandbox (both below) — registering them never widens
        // what a run can actually do. Without this, an agent that emits a
        // config-declared `fs_write` call passes the s1 permission gate (an
        // unknown executable tool has empty `Permissions`, which trivially
        // "covers" anything) and then hard-fails `UnknownTool` — a burned turn,
        // not a graceful refusal.
        .with_tools(Arc::new(
            ToolRegistry::default()
                .with_tool(Arc::new(FsReadTool))
                .with_tool(Arc::new(FsWriteTool))
                .with_tool(Arc::new(ShellTool)),
        ))
        // SP-OPS-1.5. Without this the binary shipped two Mutation tools and ZERO
        // reconcilers, so a crash between an `fs_write`'s intent and its record left the
        // run in doubt forever: `reconcile_in_doubt` fell to `Indeterminate`, the pause
        // carried a NULL `next_wake` so no timer woke it, and `force_wake` only
        // re-reconciled to `Indeterminate` again. `fs_write` is idempotent (truncate-and-
        // replace), so the correct verdict is simply to let it re-run.
        //
        // `shell` is deliberately absent: an arbitrary command is not idempotent and
        // nothing generic can decide whether it applied, so it still parks for a human.
        // That is a real remaining gap, not an oversight.
        .with_reconcilers(Arc::new(
            ReconcileRegistry::default().with_provider("fs_write", Arc::new(FsWriteReconciler)),
        ))
        // SP-REG-0. Without this, `PlannerRef::Select` is DEAD in the shipped binary:
        // `expand.rs` refuses a second time on `self.selector == None`, immediately
        // after the empty-candidates refusal, so no amount of registry content can
        // make a `Select` node work. Every `with_planner_selector` call in the
        // workspace was in `executor/tests.rs` — the suite was entirely green while
        // the feature could not run.
        //
        // `RulePlannerSelector::new(None)` and not `LlmPlannerSelector`: it is pure and
        // spends no tokens (it prefers a configured default when that default is among
        // the candidates, else takes `candidates.first()` over the order
        // `Executor::planner_candidates` produced — marked first, then by name),
        // whereas the LLM selector costs a model call per expand. Choosing to spend
        // tokens on planner selection is the implementer's call, not a default.
        //
        // `None` here is now deliberate rather than a gap. SP-REG-3 supplies the
        // designation from the REGISTRY instead: an agent authored `default_planner:
        // true` is ordered FIRST by `Executor::planner_candidates`, so this selector's
        // `candidates.first()` picks it without a constructor argument. Reading it there
        // rather than here is the point — `with_planner_selector` is set-once and
        // `pinned` never touches `self.selector`, so a marker resolved at boot would be
        // a process-scoped snapshot OUTSIDE the config fence, and a `config push` could
        // never move it.
        .with_planner_selector(Arc::new(RulePlannerSelector::new(None)));

    if let Some(root) = workspace_root {
        executor = executor.with_workspace_root(root);
        #[cfg(target_os = "macos")]
        {
            executor = executor.with_sandbox(Arc::new(orchestrator::agent::sandbox::MacosSandbox));
        }
        #[cfg(target_os = "linux")]
        {
            executor = executor.with_sandbox(Arc::new(orchestrator::agent::sandbox::LinuxSandbox));
        }
    }

    // AG-3: the operator's wake-retry policy (TORII_WAKE_*, gateway defaults when unset).
    // AG-5: and the lease after which a `waking` claim's worker counts as lost.
    let scheduler = Scheduler::new(
        light.scheduler_store.clone(),
        executor,
        light.journal.clone(),
        clock.clone(),
    )
    .with_wake_retry(wake_retry)
    .with_lease(drive.wake_lease);
    // AG-5: the SAME handle the executor holds (clones share one lock), following the same
    // store `config push` writes — so a reload is what the next drive pins.
    let source: Arc<dyn ConfigSource> = light.config_source.clone();
    let registry = RegistryReloader::new(handle, source);
    Ok(HeavyDeps {
        light,
        scheduler,
        clock,
        events,
        registry,
        gateway_chains,
    })
}

/// AG-18: the CLI's consumer of [`HeavyDeps::events`] — every run event as one structured log
/// line (target `torii::run_event`, the event's JSON in `event`), on stderr with the rest of
/// the log. It drains as fast as the log writes, so the drive's bounded channel stays empty;
/// the API's SSE stream (torii#51) is a second consumer of the same `RunEvent`s.
pub fn log_run_events(mut events: RunEvents) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(e) = events.recv().await {
            match serde_json::to_string(&e) {
                Ok(json) => tracing::info!(target: "torii::run_event", event = %json, "run event"),
                Err(err) => tracing::warn!(run = %e.run, "run event not serializable: {err}"),
            }
        }
    })
}

/// Let [`log_run_events`] finish once the drives are done: the caller drops the `Scheduler`
/// (closing the channel) first, then this waits — bounded, so a sender still alive somewhere
/// can delay the exit by at most two seconds, never hang it.
pub async fn flush_run_events(log: tokio::task::JoinHandle<()>) {
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), log).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchestrator_core::ConfigStore;

    fn pg_url(e: &EnvConfig) -> &str {
        match &e.backend {
            Backend::Postgres { database_url, .. } => database_url,
            Backend::Memory { .. } => panic!("expected the postgres backend"),
        }
    }

    /// The environment exactly as given — see `the_postgres_backend_needs_a_tenant`.
    fn raw_getter<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| {
            pairs
                .iter()
                .find(|(key, _)| *key == k)
                .map(|(_, v)| v.to_string())
        }
    }

    /// As given, plus `TORII_TENANT=acme` unless the pairs set it: the tests below are about
    /// other variables, and the tenant requirement has its own test.
    fn getter<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| raw_getter(pairs)(k).or_else(|| (k == ENV_TENANT).then(|| "acme".to_string()))
    }

    /// TM-8c: the Postgres backend is torii's database, which is multi-tenant — every store
    /// is one tenant's, so the tenant is required, and named when missing.
    #[test]
    fn the_postgres_backend_needs_a_tenant() {
        let err = env_config_from(raw_getter(&[(ENV_DATABASE_URL, "postgres://h/db")]))
            .expect_err("no tenant");
        assert!(err.message.contains(ENV_TENANT), "{}", err.message);
        let e = env_config_from(raw_getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_TENANT, " acme "),
        ]))
        .expect("ok");
        assert!(
            matches!(&e.backend, Backend::Postgres { tenant, .. } if tenant == "acme"),
            "trimmed tenant"
        );
        // The memory backend has no tenants.
        env_config_from(raw_getter(&[(ENV_BACKEND, "memory")])).expect("memory needs no tenant");
    }

    /// TM-8c: on the Postgres backend the gateway config IS torii's catalog — the same loader
    /// the API uses. A `--gateway-config` file there would be a second source the API never
    /// sees, so it is refused (before any connection is attempted).
    #[tokio::test]
    async fn heavy_refuses_a_gateway_config_file_on_the_postgres_backend() {
        let env = EnvConfig {
            backend: Backend::Postgres {
                database_url: "postgres://127.0.0.1:1/unreachable".into(),
                tenant: "acme".into(),
            },
            fence_version: Some("v1".into()),
            pool_size: DEFAULT_POOL_SIZE,
            wake_retry: Ok(WakeRetryPolicy::default()),
            drive: Ok(DrivePolicy::default()),
        };
        let err = match heavy(&env, Some(Path::new("/tmp/gateway.json")), None).await {
            Ok(_) => panic!("must refuse a file on the postgres backend"),
            Err(e) => e,
        };
        assert!(
            err.message.contains("--gateway-config") && err.message.contains("catalog"),
            "{}",
            err.message
        );
    }

    /// The memory backend has no catalog: its gateway config is the `--gateway-config` file,
    /// and a missing one is named.
    #[tokio::test]
    async fn heavy_on_the_memory_backend_requires_a_gateway_config_file() {
        let env = EnvConfig {
            backend: Backend::Memory { registry_dir: None },
            fence_version: Some("v1".into()),
            pool_size: DEFAULT_POOL_SIZE,
            wake_retry: Ok(WakeRetryPolicy::default()),
            drive: Ok(DrivePolicy::default()),
        };
        let err = match heavy(&env, None, None).await {
            Ok(_) => panic!("must require a file on the memory backend"),
            Err(e) => e,
        };
        assert!(
            err.message.contains("--gateway-config") && err.message.contains("memory"),
            "{}",
            err.message
        );
    }

    /// TM-5: the memory backend needs no DATABASE_URL, and takes its registry dir.
    #[test]
    fn the_memory_backend_needs_no_database_url_and_reads_its_registry_dir() {
        let e = env_config_from(getter(&[(ENV_BACKEND, "memory")])).expect("memory boots bare");
        assert!(matches!(e.backend, Backend::Memory { registry_dir: None }));
        let e = env_config_from(getter(&[
            (ENV_BACKEND, " Memory "),
            (ENV_REGISTRY_DIR, "/tmp/reg"),
            (ENV_DATABASE_URL, "postgres://ignored"),
        ]))
        .expect("ok");
        assert!(
            matches!(&e.backend, Backend::Memory { registry_dir: Some(d) } if d == &PathBuf::from("/tmp/reg")),
            "case-insensitive, trimmed, and DATABASE_URL does not override the choice"
        );
    }

    /// TM-5: an explicit `postgres` is the default backend, and still needs DATABASE_URL;
    /// anything else is refused naming the choices.
    #[test]
    fn the_backend_choice_is_explicit_and_validated() {
        let e = env_config_from(getter(&[
            (ENV_BACKEND, "postgres"),
            (ENV_DATABASE_URL, "postgres://h/db"),
        ]))
        .expect("ok");
        assert_eq!(pg_url(&e), "postgres://h/db");
        assert!(env_config_from(getter(&[(ENV_BACKEND, "postgres")])).is_err());
        let err = env_config_from(getter(&[(ENV_BACKEND, "sqlite")])).expect_err("unknown");
        assert!(
            err.message.contains("sqlite") && err.message.contains("memory"),
            "{}",
            err.message
        );
    }

    /// The Debug impl still never prints a database password, now through the backend.
    #[test]
    fn env_config_debug_redacts_the_postgres_password() {
        let e =
            env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://u:hunter2@h/db")])).unwrap();
        assert!(!format!("{e:?}").contains("hunter2"), "{e:?}");
    }

    #[test]
    fn a_missing_database_url_is_a_specific_actionable_error() {
        let err = env_config_from(getter(&[])).expect_err("must fail");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains(ENV_DATABASE_URL), "{}", err.message);
    }

    #[test]
    fn the_light_tier_needs_only_a_database_url() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(pg_url(&e), "postgres://h/db");
        assert_eq!(e.fence_version, None);
    }

    // ---- SP-DATA-4.1 Task 5: TORII_POOL_SIZE -----------------------------------------------

    /// Absent `TORII_POOL_SIZE` must fall back to `connect()`'s own default (8), not some
    /// independently-chosen torii constant — the two must never drift apart silently.
    #[test]
    fn an_absent_pool_size_defaults_to_eight() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(e.pool_size, 8);
    }

    #[test]
    fn a_valid_pool_size_is_accepted() {
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_POOL_SIZE, "16"),
        ]))
        .expect("ok");
        assert_eq!(e.pool_size, 16);
    }

    /// A zero-size pool cannot serve any connection — reject it loudly rather than let
    /// `PgPoolOptions` fail obscurely (or silently behave as "unlimited", which it does
    /// not, but a reader should not have to know that to trust this value).
    #[test]
    fn a_zero_pool_size_is_rejected() {
        let err = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_POOL_SIZE, "0"),
        ]))
        .expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains(ENV_POOL_SIZE), "{}", err.message);
    }

    #[test]
    fn an_unparseable_pool_size_is_rejected() {
        let err = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_POOL_SIZE, "abc"),
        ]))
        .expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains(ENV_POOL_SIZE), "{}", err.message);
        assert!(err.message.contains("abc"), "{}", err.message);
    }

    /// An absurdly large value is almost certainly a typo (an extra digit), not a real
    /// tuning decision — see `MAX_POOL_SIZE`'s doc comment for the reasoning.
    #[test]
    fn an_absurdly_large_pool_size_is_rejected() {
        let err = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_POOL_SIZE, "5000000"),
        ]))
        .expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains(ENV_POOL_SIZE), "{}", err.message);
    }

    /// A blank value (whitespace only) is treated the same as absent — parity with
    /// `ENV_FENCE_VERSION`'s handling.
    #[test]
    fn a_blank_pool_size_falls_back_to_the_default() {
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_POOL_SIZE, "   "),
        ]))
        .expect("ok");
        assert_eq!(e.pool_size, 8);
    }

    /// AG-3: unset, the wake-retry policy is the gateway's own default — torii adds no second
    /// set of numbers that could drift from it.
    #[test]
    fn an_absent_wake_retry_is_the_gateway_default() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(e.wake_retry, Ok(WakeRetryPolicy::default()));
    }

    #[test]
    fn the_wake_retry_policy_is_read_from_the_environment() {
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_WAKE_MAX_ATTEMPTS, " 3 "),
            (ENV_WAKE_BASE_BACKOFF, "10s"),
            (ENV_WAKE_MAX_BACKOFF, "15m"),
        ]))
        .expect("ok");
        assert_eq!(
            e.wake_retry,
            Ok(WakeRetryPolicy {
                max_attempts: 3,
                base_backoff: chrono::Duration::seconds(10),
                max_backoff: chrono::Duration::minutes(15),
                ..WakeRetryPolicy::default()
            })
        );
    }

    /// AG-5: unset, `TORII_WAKE_LEASE` is an explicit 60s; set, it takes `--interval` units; a
    /// bad one PARSES as an environment (the light tier never reads it) and is refused by the
    /// heavy tier, naming the variable and echoing the value.
    #[test]
    fn the_wake_lease_is_read_and_a_bad_one_is_refused_by_the_heavy_tier() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(
            require_drive_policy(&e).expect("default").wake_lease,
            chrono::Duration::seconds(60)
        );
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_WAKE_LEASE, " 10m "),
        ]))
        .expect("ok");
        assert_eq!(
            require_drive_policy(&e).expect("read").wake_lease,
            chrono::Duration::minutes(10)
        );
        for bad in ["0s", "10", "soon"] {
            let e = env_config_from(getter(&[
                (ENV_DATABASE_URL, "postgres://h/db"),
                (ENV_WAKE_LEASE, bad),
            ]))
            .expect("a bad drive policy must not fail the environment the light tier reads");
            let err = require_drive_policy(&e).expect_err("the heavy tier must refuse");
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(
                err.message.contains(ENV_WAKE_LEASE) && err.message.contains(bad),
                "{}",
                err.message
            );
        }
    }

    /// AG-5: unset, `TORII_MAP_CONCURRENCY` is an explicit 8; zero, garbage and a typo-sized
    /// value are refused by the heavy tier only, naming the variable and echoing the value.
    #[test]
    fn the_map_concurrency_is_read_and_a_bad_one_is_refused_by_the_heavy_tier() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(
            require_drive_policy(&e).expect("default").map_concurrency,
            8
        );
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_MAP_CONCURRENCY, " 16 "),
        ]))
        .expect("ok");
        assert_eq!(require_drive_policy(&e).expect("read").map_concurrency, 16);
        for bad in ["0", "-1", "four", "100000"] {
            let e = env_config_from(getter(&[
                (ENV_DATABASE_URL, "postgres://h/db"),
                (ENV_MAP_CONCURRENCY, bad),
            ]))
            .expect("a bad drive policy must not fail the environment the light tier reads");
            let err = require_drive_policy(&e).expect_err("the heavy tier must refuse");
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(
                err.message.contains(ENV_MAP_CONCURRENCY) && err.message.contains(bad),
                "{}",
                err.message
            );
        }
    }

    /// AG-5: unset, `TORII_TRANSIENT_ATTEMPTS` is 3 (retry ON); `1` is off and accepted; zero,
    /// garbage and a typo-sized value are refused by the heavy tier only, naming the variable.
    #[test]
    fn the_transient_attempts_are_read_and_a_bad_one_is_refused_by_the_heavy_tier() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        assert_eq!(
            require_drive_policy(&e)
                .expect("default")
                .transient_attempts,
            3
        );
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_TRANSIENT_ATTEMPTS, " 1 "),
        ]))
        .expect("ok");
        assert_eq!(require_drive_policy(&e).expect("off").transient_attempts, 1);
        for bad in ["0", "-1", "three", "300"] {
            let e = env_config_from(getter(&[
                (ENV_DATABASE_URL, "postgres://h/db"),
                (ENV_TRANSIENT_ATTEMPTS, bad),
            ]))
            .expect("a bad drive policy must not fail the environment the light tier reads");
            let err = require_drive_policy(&e).expect_err("the heavy tier must refuse");
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(
                err.message.contains(ENV_TRANSIENT_ATTEMPTS) && err.message.contains(bad),
                "{}",
                err.message
            );
        }
    }

    /// The heavy tier's refusal of a bad `TORII_WAKE_*` set: the environment itself PARSES
    /// (the light tier never reads the policy), and [`require_wake_retry`] is what refuses.
    fn wake_err(pairs: &[(&str, &str)]) -> CliError {
        let e = env_config_from(getter(pairs))
            .expect("a bad wake policy must not fail the environment the light tier reads");
        require_wake_retry(&e).expect_err("the heavy tier must refuse")
    }

    /// The gateway reads `max_attempts: 0` as 1; an operator who wrote 0 almost certainly
    /// meant something else (unlimited?), so it is refused, naming the variable.
    #[test]
    fn a_zero_or_unparseable_max_attempts_is_rejected() {
        for bad in ["0", "abc", "-1"] {
            let err = wake_err(&[
                (ENV_DATABASE_URL, "postgres://h/db"),
                (ENV_WAKE_MAX_ATTEMPTS, bad),
            ]);
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(
                err.message.contains(ENV_WAKE_MAX_ATTEMPTS) && err.message.contains(bad),
                "{}",
                err.message
            );
        }
    }

    #[test]
    fn an_unparseable_backoff_is_rejected_naming_the_variable() {
        for var in [ENV_WAKE_BASE_BACKOFF, ENV_WAKE_MAX_BACKOFF] {
            let err = wake_err(&[(ENV_DATABASE_URL, "postgres://h/db"), (var, "5")]);
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(err.message.contains(var), "{}", err.message);
        }
    }

    /// A base past the ceiling would clamp EVERY delay to the ceiling — the doubling the
    /// operator configured would never happen. Refused rather than silently flattened.
    #[test]
    fn a_base_backoff_past_the_max_backoff_is_rejected() {
        let err = wake_err(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_WAKE_BASE_BACKOFF, "2m"),
            (ENV_WAKE_MAX_BACKOFF, "1m"),
        ]);
        assert!(
            err.message.contains(ENV_WAKE_BASE_BACKOFF)
                && err.message.contains(ENV_WAKE_MAX_BACKOFF),
            "{}",
            err.message
        );
    }

    /// AG-3: the policy reaches the `Scheduler` `heavy()` builds — observed through `tick`,
    /// since the scheduler does not expose it. A submit whose worker was lost (a stale
    /// `waking` row, attempt 1 spent) is reclaimed as attempt 2: past a cap of 1 it is filed
    /// `Failed` WITHOUT being driven, where the default cap (5) would drive it to its pause.
    #[tokio::test]
    async fn heavy_wires_the_wake_retry_policy_into_the_scheduler() {
        let dir = tempfile::tempdir().unwrap();
        let reg = dir.path().join("registry");
        std::fs::create_dir_all(reg.join("agents")).unwrap();
        std::fs::write(
            reg.join("agents/researcher.md"),
            "---\nname: researcher\narea: research\nkind: lead\nchain: c\ntools: []\nskills: []\n---\nYou research.\n",
        )
        .unwrap();
        let gw = dir.path().join("gateway.json");
        std::fs::write(
            &gw,
            r#"{"routers":{"ollama":{"url":"http://127.0.0.1:11434"}},
                "chains":{"c":{"id":"c","capability":"text_chat","models":[],"fallback_triggers":[]}}}"#,
        )
        .unwrap();
        let env = EnvConfig {
            backend: Backend::Memory {
                registry_dir: Some(reg),
            },
            fence_version: Some("v1".into()),
            pool_size: DEFAULT_POOL_SIZE,
            wake_retry: Ok(WakeRetryPolicy {
                max_attempts: 1,
                ..WakeRetryPolicy::default()
            }),
            drive: Ok(DrivePolicy::default()),
        };
        let d = match heavy(&env, Some(&gw), None).await {
            Ok(d) => d,
            Err(e) => panic!("heavy boots on the memory backend: {}", e.message),
        };
        let run = orchestrator_core::RunId(uuid::Uuid::new_v4());
        let graph = orchestrator_core::Graph {
            nodes: vec![orchestrator_core::Node {
                id: orchestrator_core::NodeId("gate".into()),
                kind: orchestrator_core::NodeKind::AwaitSignal { timeout: None },
                deps: vec![],
            }],
        };
        d.light
            .scheduler_store
            .enqueue(
                run,
                &graph,
                chrono::Utc::now() - chrono::Duration::minutes(5),
            )
            .await
            .expect("enqueue");
        d.scheduler.tick().await.expect("tick");
        let st = d.scheduler.status(run).await.unwrap().expect("row");
        assert_eq!(
            (st.status, st.reason.as_deref()),
            (
                orchestrator_core::RunStatus::Failed,
                Some(
                    "gave up after 1 failed wake attempts; last error: the drive never \
                     recorded an outcome — its worker was lost mid-drive and its lease was \
                     reclaimed"
                )
            ),
            "a cap of 1 must reach the scheduler"
        );
    }

    /// AG-18 review: the policy is checked where it is USED — `heavy()` refuses a bad one before
    /// it opens a store, naming the variable.
    #[tokio::test]
    async fn heavy_refuses_a_bad_wake_policy() {
        let dir = tempfile::tempdir().unwrap();
        let (mut env, gw) = memory_heavy_fixture(dir.path());
        env.wake_retry =
            wake_retry_from(&|k: &str| (k == ENV_WAKE_MAX_ATTEMPTS).then(|| "0".to_string()));
        let err = match heavy(&env, Some(&gw), None).await {
            Ok(_) => panic!("a bad wake policy must not boot a driver"),
            Err(e) => e,
        };
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(
            err.message.contains(ENV_WAKE_MAX_ATTEMPTS),
            "{}",
            err.message
        );
    }

    /// AG-5: a bad drive policy is refused where it is USED — `heavy()` will not boot a driver
    /// on it, naming the variable.
    #[tokio::test]
    async fn heavy_refuses_a_bad_drive_policy() {
        for (var, bad) in [
            (ENV_WAKE_LEASE, "0s"),
            (ENV_MAP_CONCURRENCY, "0"),
            (ENV_TRANSIENT_ATTEMPTS, "0"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let (env, gw) = memory_env(dir.path(), IDLE_GATEWAY, &[(var, bad)]);
            let err = match heavy(&env, Some(&gw), None).await {
                Ok(_) => panic!("{var}={bad} must not boot a driver"),
                Err(e) => e,
            };
            assert_eq!(err.code, crate::errors::EXIT_ERROR);
            assert!(err.message.contains(var), "{}", err.message);
        }
    }

    /// A memory-backend `EnvConfig` and gateway-config file `heavy()` boots on with no
    /// database and no model: one agent bound to chain `c`, which the file defines.
    fn memory_heavy_fixture(dir: &Path) -> (EnvConfig, PathBuf) {
        let reg = dir.join("registry");
        std::fs::create_dir_all(reg.join("agents")).unwrap();
        std::fs::write(
            reg.join("agents/researcher.md"),
            "---\nname: researcher\narea: research\nkind: lead\nchain: c\ntools: []\nskills: []\n---\nYou research.\n",
        )
        .unwrap();
        let gw = dir.join("gateway.json");
        std::fs::write(
            &gw,
            r#"{"routers":{"ollama":{"url":"http://127.0.0.1:11434"}},
                "chains":{"c":{"id":"c","capability":"text_chat","models":[],"fallback_triggers":[]}}}"#,
        )
        .unwrap();
        let env = EnvConfig {
            backend: Backend::Memory {
                registry_dir: Some(reg),
            },
            fence_version: Some("v1".into()),
            pool_size: DEFAULT_POOL_SIZE,
            wake_retry: Ok(WakeRetryPolicy::default()),
            drive: Ok(DrivePolicy::default()),
        };
        (env, gw)
    }

    /// AG-5: a memory-backend boot whose environment goes through [`env_config_from`] — the
    /// real parse path — so a test proves a `TORII_*` variable reaches what `heavy()` builds,
    /// not just that it parses. `gateway_json` is the `--gateway-config` file's contents; the
    /// registry is [`memory_heavy_fixture`]'s one agent on chain `c`.
    fn memory_env(dir: &Path, gateway_json: &str, extra: &[(&str, &str)]) -> (EnvConfig, PathBuf) {
        let (_, gw) = memory_heavy_fixture(dir);
        std::fs::write(&gw, gateway_json).unwrap();
        let reg = dir.join("registry").display().to_string();
        let mut pairs: Vec<(String, String)> = vec![
            (ENV_BACKEND.into(), "memory".into()),
            (ENV_REGISTRY_DIR.into(), reg),
            (ENV_FENCE_VERSION.into(), "v1".into()),
        ];
        pairs.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        let env = env_config_from(|k| {
            pairs
                .iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.clone())
        })
        .expect("the environment parses");
        (env, gw)
    }

    /// The gateway config [`memory_heavy_fixture`] writes: an ollama router nobody calls, and
    /// chain `c` with no models.
    const IDLE_GATEWAY: &str = r#"{"routers":{"ollama":{"url":"http://127.0.0.1:11434"}},
        "chains":{"c":{"id":"c","capability":"text_chat","models":[],"fallback_triggers":[]}}}"#;

    async fn boot(env: &EnvConfig, gw: &Path) -> HeavyDeps {
        match heavy(env, Some(gw), None).await {
            Ok(d) => d,
            Err(e) => panic!("heavy boots on the memory backend: {}", e.message),
        }
    }

    /// A run whose worker was lost `age` ago: its `waking` claim is that old.
    async fn abandoned_claim(d: &HeavyDeps, age: chrono::Duration) -> RunId {
        let run = RunId(uuid::Uuid::new_v4());
        d.light
            .scheduler_store
            .enqueue(run, &signal_graph(), chrono::Utc::now() - age)
            .await
            .expect("enqueue");
        run
    }

    /// AG-5: `TORII_WAKE_LEASE` reaches the `Scheduler` — observed through `tick`, since the
    /// scheduler does not expose it. A claim abandoned 5 minutes ago is stale under the 60s
    /// default (reclaimed and driven) but still held under a 10-minute lease (left alone).
    #[tokio::test]
    async fn heavy_wires_the_wake_lease_into_the_scheduler() {
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(dir.path(), IDLE_GATEWAY, &[]);
        let d = boot(&env, &gw).await;
        abandoned_claim(&d, chrono::Duration::minutes(5)).await;
        assert_eq!(
            d.scheduler.tick().await.expect("tick"),
            1,
            "precondition: under the default lease a 5-minute-old claim is stale"
        );

        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(dir.path(), IDLE_GATEWAY, &[("TORII_WAKE_LEASE", "10m")]);
        let d = boot(&env, &gw).await;
        abandoned_claim(&d, chrono::Duration::minutes(5)).await;
        assert_eq!(
            d.scheduler.tick().await.expect("tick"),
            0,
            "TORII_WAKE_LEASE=10m must reach the scheduler: a 5-minute-old claim is still held"
        );
    }

    /// A fake model provider speaking the OpenAI wire (`/v1/chat/completions`, which the
    /// gateway's `ollama` adapter calls). Every call is held for `hold`, then answered with
    /// `status` — a canned completion on 200, an opaque provider error otherwise. It counts
    /// calls and the most it ever had in flight at once.
    struct FakeProvider {
        url: String,
        calls: Arc<std::sync::atomic::AtomicUsize>,
        max_in_flight: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl FakeProvider {
        async fn start(status: u16, hold: std::time::Duration) -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
            #[derive(Clone)]
            struct St {
                status: u16,
                hold: std::time::Duration,
                calls: Arc<AtomicUsize>,
                in_flight: Arc<AtomicUsize>,
                max_in_flight: Arc<AtomicUsize>,
            }
            async fn chat(
                axum::extract::State(st): axum::extract::State<St>,
            ) -> (axum::http::StatusCode, axum::Json<serde_json::Value>) {
                st.calls.fetch_add(1, SeqCst);
                let now = st.in_flight.fetch_add(1, SeqCst) + 1;
                st.max_in_flight.fetch_max(now, SeqCst);
                tokio::time::sleep(st.hold).await;
                st.in_flight.fetch_sub(1, SeqCst);
                let code = axum::http::StatusCode::from_u16(st.status).unwrap();
                if !code.is_success() {
                    let body = serde_json::json!({"error": {"message": "upstream blip"}});
                    return (code, axum::Json(body));
                }
                let body = serde_json::json!({
                    "id": "fake", "object": "chat.completion", "created": 0, "model": "m",
                    "choices": [{"index": 0, "finish_reason": "stop",
                                 "message": {"role": "assistant", "content": "ok"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
                });
                (code, axum::Json(body))
            }
            let st = St {
                status,
                hold,
                calls: Arc::new(AtomicUsize::new(0)),
                in_flight: Arc::new(AtomicUsize::new(0)),
                max_in_flight: Arc::new(AtomicUsize::new(0)),
            };
            let (calls, max_in_flight) = (st.calls.clone(), st.max_in_flight.clone());
            let app = axum::Router::new()
                .route("/v1/chat/completions", axum::routing::post(chat))
                .with_state(st);
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            Self {
                url,
                calls,
                max_in_flight,
            }
        }

        /// A gateway config whose chain `c` is one model served by this provider.
        fn gateway_json(&self) -> String {
            serde_json::json!({
                "routers": {"ollama": {"url": self.url}},
                "models": {"m": {"id": "m", "provider": "ollama", "capabilities": ["text_chat"],
                                 "context_window": 8192, "max_output_tokens": 1024}},
                "chains": {"c": {"id": "c", "capability": "text_chat",
                                 "models": [{"model": "m", "router": "ollama", "priority": 1}],
                                 "fallback_triggers": []}}
            })
            .to_string()
        }

        fn calls(&self) -> usize {
            self.calls.load(std::sync::atomic::Ordering::SeqCst)
        }

        fn max_in_flight(&self) -> usize {
            self.max_in_flight.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    fn graph_of(id: &str, kind: orchestrator_core::NodeKind) -> orchestrator_core::Graph {
        orchestrator_core::Graph {
            nodes: vec![orchestrator_core::Node {
                id: orchestrator_core::NodeId(id.into()),
                kind,
                deps: vec![],
            }],
        }
    }

    /// A `Map` of `items` model calls on chain `c`, asking for all of them at once.
    fn wide_map(items: usize) -> orchestrator_core::Graph {
        graph_of(
            "fan",
            orchestrator_core::NodeKind::Map {
                body: orchestrator_core::MapBody::ModelCall { chain: "c".into() },
                over: (0..items)
                    .map(|i| serde_json::json!({"prompt": format!("item {i}")}))
                    .collect(),
                concurrency: items,
                aggregation: orchestrator_core::Aggregation::FailFast,
            },
        )
    }

    /// `run submit`'s inline drive. Its `Outcome` is not returned: a run that drove to `failed`
    /// is an `Err` there, and every caller asserts on the run's recorded status instead.
    async fn submit_graph(d: &HeavyDeps, graph: orchestrator_core::Graph) -> RunId {
        let run = RunId(uuid::Uuid::new_v4());
        let _ = crate::cmd::run::submit(
            &d.scheduler,
            run,
            graph,
            orchestrator_core::RunBudget::default(),
            || {},
        )
        .await;
        run
    }

    /// AG-5: `TORII_MAP_CONCURRENCY` reaches the executor — observed at the provider. A `Map`
    /// asking for 6 calls at once gets at most 2 in flight under a cap of 2.
    #[tokio::test]
    async fn heavy_wires_the_map_concurrency_cap_into_the_executor() {
        let provider = FakeProvider::start(200, std::time::Duration::from_millis(150)).await;
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(
            dir.path(),
            &provider.gateway_json(),
            &[("TORII_MAP_CONCURRENCY", "2")],
        );
        let d = boot(&env, &gw).await;
        let run = submit_graph(&d, wide_map(6)).await;
        assert_eq!(
            d.scheduler.status(run).await.unwrap().expect("row").status,
            orchestrator_core::RunStatus::Completed,
            "precondition: every call was answered"
        );
        assert_eq!(provider.calls(), 6, "precondition: one call per item");
        assert_eq!(
            provider.max_in_flight(),
            2,
            "TORII_MAP_CONCURRENCY=2 must cap the fan-out at the provider"
        );
    }

    /// One model call on chain `c`.
    fn model_call() -> orchestrator_core::Graph {
        graph_of(
            "ask",
            orchestrator_core::NodeKind::ModelCall {
                chain: "c".into(),
                payload: serde_json::json!({"prompt": "hello"}),
            },
        )
    }

    /// AG-5: transient-failure retry is ON by default in torii (3 attempts) — one provider 500
    /// pauses the run on a backoff instead of failing it — and `TORII_TRANSIENT_ATTEMPTS=1`
    /// turns it off, so the same 500 is terminal.
    #[tokio::test]
    async fn heavy_retries_a_transient_provider_failure_by_default() {
        let provider = FakeProvider::start(500, std::time::Duration::ZERO).await;
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(dir.path(), &provider.gateway_json(), &[]);
        let d = boot(&env, &gw).await;
        let run = submit_graph(&d, model_call()).await;
        let st = d.scheduler.status(run).await.unwrap().expect("row");
        assert_eq!(provider.calls(), 1, "precondition: the provider was called");
        assert_eq!(
            st.status,
            orchestrator_core::RunStatus::Paused,
            "by default one transient 500 must pause for a retry, not fail the run: {:?}",
            st.reason
        );
        assert!(
            st.reason
                .as_deref()
                .is_some_and(|r| r.contains("attempt 1 of 3")),
            "{:?}",
            st.reason
        );

        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(
            dir.path(),
            &provider.gateway_json(),
            &[("TORII_TRANSIENT_ATTEMPTS", "1")],
        );
        let d = boot(&env, &gw).await;
        let run = submit_graph(&d, model_call()).await;
        assert_eq!(
            d.scheduler.status(run).await.unwrap().expect("row").status,
            orchestrator_core::RunStatus::Failed,
            "TORII_TRANSIENT_ATTEMPTS=1 turns retry off"
        );
    }

    /// AG-4 x AG-5: a node that exhausts its transient retries is reported by `run results` with
    /// the error the run actually stopped on — the one `run status` shows — not attempt 1's
    /// "retrying" notice; and while it waits on a retry it is `retrying`, not `failed`.
    #[tokio::test]
    async fn run_results_reports_the_terminal_error_of_a_node_that_exhausted_its_retries() {
        let provider = FakeProvider::start(500, std::time::Duration::ZERO).await;
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_env(
            dir.path(),
            &provider.gateway_json(),
            &[("TORII_TRANSIENT_ATTEMPTS", "3")],
        );
        let d = boot(&env, &gw).await;
        let run = submit_graph(&d, model_call()).await;
        let results = || async {
            torii_core::results::run_results(
                d.light.scheduler_store.as_ref(),
                d.light.journal.as_ref(),
                d.light.content.as_ref(),
                run,
            )
            .await
            .expect("results")
            .expect("the run exists")
        };

        let paused = results().await;
        assert_eq!(
            paused.status,
            orchestrator_core::RunStatus::Paused,
            "precondition"
        );
        assert_eq!(
            serde_json::to_value(paused.nodes[0].state).unwrap(),
            serde_json::json!("retrying"),
            "a node waiting on its retry is not failed: {:?}",
            paused.nodes
        );

        for _ in 0..4 {
            let st = d.scheduler.status(run).await.unwrap().expect("row");
            if st.status.is_terminal() {
                break;
            }
            d.light
                .scheduler_store
                .force_wake(run, chrono::Utc::now())
                .await
                .expect("force_wake");
            d.scheduler.tick().await.expect("tick");
        }
        let st = d.scheduler.status(run).await.unwrap().expect("row");
        assert_eq!(
            st.status,
            orchestrator_core::RunStatus::Failed,
            "precondition"
        );
        assert_eq!(provider.calls(), 3, "precondition: every attempt was made");
        let failed = results().await;
        assert_eq!(failed.nodes.len(), 1, "{:?}", failed.nodes);
        assert_eq!(
            failed.nodes[0].error.as_deref(),
            st.reason.as_deref(),
            "run results and run status must name the same failure"
        );
        assert!(
            !failed.nodes[0]
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("retrying"),
            "{:?}",
            failed.nodes[0]
        );
    }

    fn signal_graph() -> orchestrator_core::Graph {
        orchestrator_core::Graph {
            nodes: vec![orchestrator_core::Node {
                id: orchestrator_core::NodeId("gate".into()),
                kind: orchestrator_core::NodeKind::AwaitSignal { timeout: None },
                deps: vec![],
            }],
        }
    }

    fn drained(events: &mut RunEvents) -> Vec<torii_core::events::RunEventKind> {
        let mut out = Vec::new();
        while let Ok(e) = events.try_recv() {
            out.push(e.kind);
        }
        out
    }

    /// AG-18: `run submit`'s inline drive is `heavy()`'s scheduler, and it reports run events:
    /// the run's ask reaches `HeavyDeps::events`.
    #[tokio::test]
    async fn heavy_reports_run_events_from_the_submit_drive() {
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_heavy_fixture(dir.path());
        let mut d = match heavy(&env, Some(&gw), None).await {
            Ok(d) => d,
            Err(e) => panic!("heavy boots on the memory backend: {}", e.message),
        };
        let run = RunId(uuid::Uuid::new_v4());
        let out = crate::cmd::run::submit(
            &d.scheduler,
            run,
            signal_graph(),
            orchestrator_core::RunBudget::default(),
            || {},
        )
        .await
        .expect("submit");
        assert!(out.text.contains("paused"), "{}", out.text);
        assert_eq!(
            drained(&mut d.events),
            vec![torii_core::events::RunEventKind::SignalAwaited {
                node: "gate".into(),
                deadline: None,
            }],
            "the submit drive's ask must reach the event stream"
        );
    }

    /// AG-18: `worker serve`'s drive is `heavy()`'s scheduler too, and the decision a worker
    /// drive honours is reported BY that drive — an unhooked worker would leave the report to
    /// some later hooked drive, late.
    #[tokio::test]
    async fn heavy_reports_the_decision_a_worker_drive_honours() {
        let dir = tempfile::tempdir().unwrap();
        let (env, gw) = memory_heavy_fixture(dir.path());
        let mut d = match heavy(&env, Some(&gw), None).await {
            Ok(d) => d,
            Err(e) => panic!("heavy boots on the memory backend: {}", e.message),
        };
        let run = RunId(uuid::Uuid::new_v4());
        crate::cmd::run::submit(
            &d.scheduler,
            run,
            signal_graph(),
            orchestrator_core::RunBudget::default(),
            || {},
        )
        .await
        .expect("submit");
        drained(&mut d.events);

        // The operator answers on the light tier, then the worker loop drives it once.
        let out = crate::cmd::run::signal(
            d.light.scheduler_store.as_ref(),
            d.light.journal.as_ref(),
            run,
            orchestrator_core::NodeId("gate".into()),
            serde_json::json!({"decision": "approved"}),
            chrono::Utc::now(),
        )
        .await
        .expect("signal");
        assert_eq!(out.code, crate::errors::EXIT_OK, "{}", out.text);
        let (_tx, shutdown) = tokio::sync::watch::channel(0u64);
        let out = crate::cmd::worker::serve(
            &d.scheduler,
            crate::cmd::worker::ServeOpts {
                interval: std::time::Duration::from_millis(10),
                once: true,
            },
            shutdown,
        )
        .await
        .expect("serve --once");
        assert_eq!(out.code, crate::errors::EXIT_OK, "{}", out.text);
        assert_eq!(
            d.scheduler.status(run).await.unwrap().expect("row").status,
            orchestrator_core::RunStatus::Completed,
            "the worker drive completed the run"
        );
        assert_eq!(
            drained(&mut d.events),
            vec![torii_core::events::RunEventKind::SignalReceived {
                node: "gate".into(),
                payload: serde_json::json!({"decision": "approved"}),
            }],
            "the worker drive must report the decision it honoured"
        );
    }

    /// The heavy tier must refuse to start without an explicit fence base: deriving
    /// it would strand every paused run on a routine version bump.
    #[test]
    fn the_heavy_tier_refuses_without_an_explicit_fence_version() {
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, "postgres://h/db")])).expect("ok");
        let err = require_fence(&e).expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains(ENV_FENCE_VERSION), "{}", err.message);
        assert!(
            err.message.contains("recorded in every run"),
            "must explain WHY it is required: {}",
            err.message
        );
    }

    #[test]
    fn an_explicit_fence_version_is_accepted() {
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_FENCE_VERSION, "v1"),
        ]))
        .expect("ok");
        assert_eq!(require_fence(&e).expect("present"), "v1");
    }

    /// An empty fence version is as dangerous as a missing one.
    #[test]
    fn a_blank_fence_version_is_rejected() {
        let e = env_config_from(getter(&[
            (ENV_DATABASE_URL, "postgres://h/db"),
            (ENV_FENCE_VERSION, "   "),
        ]))
        .expect("ok");
        assert!(require_fence(&e).is_err(), "whitespace is not a fence base");
    }

    /// Errors must never echo the connection string.
    #[test]
    fn a_blank_database_url_error_does_not_echo_a_secret() {
        let pw = format!("s3cr{}t", "e");
        let url = format!("postgres://u:{pw}@h:5432/db");
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, &url)])).expect("ok");
        // The redaction helper is what every message uses.
        assert!(!redact_url(pg_url(&e)).contains(&pw));
    }

    /// FIX 6: `{:?}` on `EnvConfig` must never print the plaintext password —
    /// `Debug` is manual specifically to route it through `redact_url`.
    #[test]
    fn env_config_debug_redacts_the_database_url() {
        let pw = format!("s3cr{}t", "e");
        let url = format!("postgres://u:{pw}@h:5432/db");
        let e = env_config_from(getter(&[(ENV_DATABASE_URL, &url)])).expect("ok");
        let debug = format!("{e:?}");
        assert!(!debug.contains(&pw), "password leaked via Debug: {debug}");
        assert!(debug.contains("h:5432/db"), "{debug}");
    }

    /// WHOLE-SLICE FIX 2: `redact_url` handles the URL torii interpolates itself, and the
    /// AC10 test above proves that half — but only for the out-of-range-port shape, where
    /// sqlx happens not to echo its input. A SCHEME-LESS `DATABASE_URL` (an ordinary
    /// secret-store mistake: the scheme dropped somewhere in the pipeline) is the shape
    /// that actually leaked, reproduced 3/3 against the real binary:
    ///
    /// ```text
    /// torii: cannot connect to <unparseable database url>: error returned from database:
    ///        database "s3cr3t-XyZ@127.0.0.1:5433/postgres" does not exist
    /// ```
    ///
    /// `redact_url` did its job and the adjacent `{e}` defeated it. The error text is
    /// verbatim from that reproduction (a live server round trip, so it cannot be
    /// exercised as a fast unit test) — `connect_failure` is pure precisely so the
    /// composition can be proven without one.
    #[test]
    fn a_connect_failure_scrubs_the_password_out_of_the_sqlx_error_text() {
        let pw = format!("s3cr3t-{}", "XyZ");
        let url = format!("operator:{pw}@127.0.0.1:5433/postgres");
        let sqlx_err = format!(
            "error returned from database: database \"{pw}@127.0.0.1:5433/postgres\" does not exist"
        );
        let msg = connect_failure(&url, &sqlx_err);
        assert!(
            !msg.contains(&pw),
            "password leaked via the error text: {msg}"
        );
        assert!(
            msg.contains("does not exist"),
            "the diagnosis must survive scrubbing: {msg}"
        );
    }

    /// The same guard for the shape where sqlx echoes the WHOLE connection string.
    #[test]
    fn a_connect_failure_scrubs_a_whole_echoed_connection_string() {
        let pw = format!("s3cr{}t", "e");
        let url = format!("postgres://operator:{pw}@db.internal:5432/orch");
        let msg = connect_failure(&url, &format!("invalid connection string: {url}"));
        assert!(!msg.contains(&pw), "password leaked: {msg}");
        assert!(
            msg.contains("db.internal:5432/orch"),
            "the redacted host/db must still be reported: {msg}"
        );
    }

    /// The scrub must not fire when there is nothing to scrub: a passwordless URL whose
    /// user, scheme and database name are the same token (`postgres`) is the common case,
    /// and mangling it would make every legitimate connect error unreadable.
    #[test]
    fn a_connect_failure_leaves_a_passwordless_url_error_intact() {
        let msg = connect_failure(
            "postgres://postgres@localhost:5433/postgres",
            "error returned from database: database \"postgres\" does not exist",
        );
        assert!(
            msg.contains("database \"postgres\" does not exist"),
            "a passwordless URL has no credential to scrub: {msg}"
        );
    }

    /// WHOLE-SLICE FIX 3: serde_json's `Display` echoes the offending VALUE, so a key
    /// pasted as a router value instead of under `api_key` would land a live credential in
    /// a worker's stderr. Drives the REAL serde error (not a fabricated string) so the
    /// assertion is about what serde actually produces.
    #[test]
    fn a_bad_gateway_config_reports_the_location_not_the_offending_value() {
        let key = format!("sk-live-{}", "AbC1234567890");
        let raw = format!("{{\"routers\": {{\"openai\": \"{key}\"}}}}");
        let e = serde_json::from_str::<kernel::types::config::GatewayConfig>(&raw)
            .expect_err("a string where a struct belongs must not parse");
        // The hazard, stated as a fact about serde rather than an assumption.
        assert!(
            e.to_string().contains(&key),
            "precondition: serde's Display is what echoes the key: {e}"
        );
        let err = gateway_config_parse_error(Path::new("/tmp/gw-bad.json"), &e);
        assert!(
            !err.message.contains(&key),
            "the API key must never reach stderr: {}",
            err.message
        );
        assert!(err.message.contains("gw-bad.json"), "{}", err.message);
        assert!(
            err.message.contains("line 1") && err.message.contains("column"),
            "the operator still needs the location: {}",
            err.message
        );
    }

    fn chain(id: &str) -> kernel::types::config::FallbackChainConfig {
        kernel::types::config::FallbackChainConfig {
            id: id.into(),
            capability: kernel::types::capability::Capability::TextChat,
            models: vec![],
            fallback_triggers: vec![],
        }
    }

    fn registry_with(
        agent_chain: &str,
        phase_chain: &str,
        binding_chain: &str,
    ) -> orchestrator_core::Registry {
        let cfg: orchestrator_core::RegistryConfig = serde_json::from_value(serde_json::json!({
            "agents": [{
                "name": "researcher", "area": "research", "kind": "lead",
                "chain": agent_chain, "chains": {"draft": phase_chain},
                "tools": [], "skills": [], "system_prompt": "x"
            }],
            "skills": [], "tools": [],
            "chain_bindings": [{"area": "research", "kind": "worker", "chain": binding_chain}]
        }))
        .expect("registry config");
        orchestrator_core::Registry::from_config(cfg).expect("registry")
    }

    fn gw_with(chains: &[&str]) -> kernel::types::config::GatewayConfig {
        kernel::types::config::GatewayConfig {
            chains: chains.iter().map(|c| (c.to_string(), chain(c))).collect(),
            ..Default::default()
        }
    }

    /// TM-4: the boot check is ALWAYS on. A registry whose chains all resolve boots.
    #[test]
    fn boot_accepts_a_registry_whose_chains_all_resolve() {
        let reg = registry_with("deep", "fast", "cheap");
        assert!(
            require_chains_resolve(&reg, &gw_with(&["deep", "fast", "cheap"]), "gw.json").is_ok()
        );
    }

    /// TM-4: a registry bound to a chain the gateway does not define refuses to boot, naming
    /// every missing id AND who referenced it — agent, per-phase override, and binding.
    #[test]
    fn boot_refuses_a_registry_bound_to_chains_the_gateway_lacks() {
        let reg = registry_with("deep", "nope-phase", "nope-binding");
        let err = require_chains_resolve(&reg, &gw_with(&["deep"]), "gw.json")
            .expect_err("unresolved chains must refuse to boot");
        for needle in [
            "nope-phase",
            "nope-binding",
            "agent \"researcher\" phase \"draft\"",
            "chain binding \"research\"/\"worker\"",
            "gw.json",
        ] {
            assert!(
                err.message.contains(needle),
                "missing {needle:?} in: {}",
                err.message
            );
        }
        assert!(
            !err.message.contains("\"deep\""),
            "a resolved chain is not reported: {}",
            err.message
        );
    }

    /// TM-4: the file source parses a JSON GatewayConfig and names itself by path.
    #[tokio::test]
    async fn the_file_gateway_config_source_loads_and_describes_itself() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gw.json");
        std::fs::write(
            &path,
            r#"{"routers":{"ollama":{"url":"http://127.0.0.1:11434"}}}"#,
        )
        .unwrap();
        let src = FileGatewayConfigSource::new(&path);
        let gw = src.load().await.expect("a valid file loads");
        assert!(gw.routers.contains_key("ollama"));
        assert!(src.describe().contains("gw.json"), "{}", src.describe());
    }

    /// TM-4: the file source keeps boot's existing error contract — a missing file names the
    /// path; a bad file names the path and location but NEVER echoes a value (it holds keys).
    #[tokio::test]
    async fn the_file_gateway_config_source_errors_name_the_path_never_the_contents() {
        let dir = tempfile::tempdir().unwrap();
        let missing = FileGatewayConfigSource::new(dir.path().join("absent.json"));
        let err = missing
            .load()
            .await
            .expect_err("a missing file is an error");
        assert!(err.message.contains("absent.json"), "{}", err.message);

        let key = "sk-live-NEVER-PRINT-ME";
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, format!(r#"{{"routers":{{"openai":"{key}"}}}}"#)).unwrap();
        let err = FileGatewayConfigSource::new(&bad)
            .load()
            .await
            .expect_err("a string where a router belongs does not parse");
        assert!(
            !err.message.contains(key),
            "the key must never reach stderr: {}",
            err.message
        );
        assert!(
            err.message.contains("bad.json") && err.message.contains("line 1"),
            "{}",
            err.message
        );
    }

    /// FIX 1: `FacadeBuilder::build` never fails on a bad router — this is the only
    /// place a completely misconfigured gateway is caught. No live provider needed:
    /// the check is pure over the already-registered adapter ids.
    #[test]
    fn heavy_refuses_a_gateway_config_that_registered_no_adapters() {
        let err = require_adapters(&[], &[], "/tmp/gateway.json").expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains("gateway.json"), "{}", err.message);
        assert!(
            err.message.contains("no provider adapters"),
            "{}",
            err.message
        );
        assert!(
            err.message.contains("no routers configured"),
            "an EMPTY config must say so, not misdirect toward router names/keys: {}",
            err.message
        );
    }

    /// Minor 3 (re-review of `6c71703`): a config that named a router which produced
    /// no adapter (e.g. `bedrock`, deliberately skipped — see `facade.rs`) must be
    /// told WHICH router, not just "check the router names and API keys" — the
    /// operator's names and keys may already be correct for a case torii can't wire.
    #[test]
    fn heavy_names_the_configured_routers_that_produced_no_adapter() {
        let err = require_adapters(&[], &["bedrock".to_string()], "/tmp/gateway.json")
            .expect_err("must refuse");
        assert!(
            err.message.contains("bedrock"),
            "must name the skipped router: {}",
            err.message
        );
    }

    #[test]
    fn a_gateway_config_with_at_least_one_adapter_is_accepted() {
        require_adapters(
            &["anthropic".to_string()],
            &["anthropic".to_string()],
            "/tmp/gateway.json",
        )
        .expect("at least one adapter is enough");
    }

    /// FIX 7: an empty registry is a VALID registry (`from_source` succeeds on a
    /// fresh database), so this is the only signal an operator gets before the
    /// first burned run. No live database needed: pure over the counts.
    #[test]
    fn heavy_refuses_a_registry_with_zero_agents() {
        let err = require_agents(0, 0, 0, 3).expect_err("must refuse");
        assert_eq!(err.code, crate::errors::EXIT_ERROR);
        assert!(err.message.contains("zero agents"), "{}", err.message);
        assert!(
            err.message.contains('3'),
            "must name the generation: {}",
            err.message
        );
    }

    #[test]
    fn a_registry_with_at_least_one_agent_is_accepted() {
        require_agents(1, 0, 0, 3).expect("one agent is enough");
    }

    /// The Postgres env for one test tenant (by id), with an explicit fence.
    fn tenant_env(url: &str, tenant: uuid::Uuid, fence: &str) -> EnvConfig {
        EnvConfig {
            backend: Backend::Postgres {
                database_url: url.to_string(),
                tenant: tenant.to_string(),
            },
            fence_version: Some(fence.to_string()),
            pool_size: DEFAULT_POOL_SIZE,
            wake_retry: Ok(WakeRetryPolicy::default()),
            drive: Ok(DrivePolicy::default()),
        }
    }

    fn probe_agent(name: &str, chain: &str) -> orchestrator_core::RegistryConfig {
        orchestrator_core::RegistryConfig {
            agents: vec![orchestrator_core::AgentDefinition {
                default_planner: false,
                name: name.to_string(),
                area: "test".to_string(),
                kind: "test".to_string(),
                chain: Some(chain.to_string()),
                chains: Default::default(),
                grants: Default::default(),
                tools: vec![],
                skills: vec![],
                system_prompt: "probe".to_string(),
                backed_by: orchestrator_core::AgentBacking::Model,
                tool_limits: Default::default(),
                confirm_tools: vec![],
                confirm_timeout: None,
                escalate_to: None,
            }],
            ..Default::default()
        }
    }

    /// TM-4 at the boot path, against torii's catalog (TM-8c): `heavy()` refuses a registry
    /// bound to a chain the catalog does not define, naming the chain, the agent and the
    /// source. Each test owns a fresh tenant, so no shared lock or seed race.
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
    )]
    #[tokio::test]
    async fn heavy_refuses_a_registry_bound_to_a_chain_the_catalog_lacks() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let t = crate::test_tenant::TestTenant::new(&url).await;
        t.stores()
            .config
            .store_and_bump(&probe_agent(
                "torii-unbound-probe-agent",
                "torii-chain-nobody-defined",
            ))
            .await
            .expect("seed");
        let env = tenant_env(&url, t.id, "torii-unbound-probe-fence");
        let err = match heavy(&env, None, None).await {
            Ok(_) => panic!("heavy() must refuse a registry bound to an undefined chain"),
            Err(e) => e,
        };
        drop(t);
        assert!(
            err.message.contains("torii-chain-nobody-defined")
                && err.message.contains("torii-unbound-probe-agent")
                && err.message.contains("torii's catalog"),
            "{}",
            err.message
        );
    }

    /// **SP-REG-0 — the production executor must have a planner selector wired** (and
    /// SP-OPS-1.5: `fs_write` has its reconciler). Booted for a tenant whose registry binds
    /// the catalog's seeded `chat` chain.
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
    )]
    #[tokio::test]
    async fn heavy_wires_a_planner_selector_so_select_is_not_dead_in_the_binary() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let t = crate::test_tenant::TestTenant::new(&url).await;
        t.stores()
            .config
            .store_and_bump(&probe_agent("torii-selector-probe-agent", "chat"))
            .await
            .expect("seed");
        let env = tenant_env(&url, t.id, "torii-selector-probe-fence");
        let deps = heavy(&env, None, None).await;
        drop(t);
        let deps = deps.expect("boots against the catalog's chat chain");
        assert!(
            deps.scheduler.executor().has_reconciler_for("fs_write"),
            "heavy() registered fs_write (a Mutation tool) with NO reconciler",
        );
        assert!(
            deps.scheduler.executor().has_planner_selector(),
            "heavy() built an executor with NO planner selector",
        );
    }

    /// **AG-5 — a running worker picks up a `config push` without restarting.** The worker
    /// boots at generation 1; an operator pushes generation 2 with the real `config push`;
    /// `run submit` (a fresh process, so booted at generation 2) submits a run that waits on a
    /// signal; the operator answers it; and the SAME worker drives it. A worker frozen at
    /// generation 1 refuses that run at the config fence and files it `failed`.
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
    )]
    #[tokio::test]
    async fn a_running_worker_picks_up_a_config_push_without_restarting() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let t = crate::test_tenant::TestTenant::new(&url).await;
        t.stores()
            .config
            .store_and_bump(&probe_agent("torii-reload-before", "chat"))
            .await
            .expect("seed generation 1");
        let env = tenant_env(&url, t.id, "torii-reload-probe-fence");
        let worker = heavy(&env, None, None).await.expect("the worker boots");

        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("agents")).unwrap();
        std::fs::write(
            dir.path().join("agents/after.md"),
            "---\nname: torii-reload-after\narea: test\nkind: test\nchain: chat\ntools: []\nskills: []\n---\nAfter.\n",
        )
        .unwrap();
        let operator = light(&env).await.expect("light boots");
        let out = crate::cmd::config::push(
            operator.config_source.as_ref(),
            operator.scheduler_store.as_ref(),
            dir.path(),
            operator.gateway_config.as_deref(),
            true,
            &mut |_| true,
        )
        .await
        .expect("push");
        assert_eq!(out.code, crate::errors::EXIT_OK, "{}", out.text);

        let submitter = heavy(&env, None, None).await.expect("run submit boots");
        let run = RunId(uuid::Uuid::new_v4());
        crate::cmd::run::submit(
            &submitter.scheduler,
            run,
            signal_graph(),
            orchestrator_core::RunBudget::default(),
            || {},
        )
        .await
        .expect("submit pauses on the signal");
        drop(submitter);
        let out = crate::cmd::run::signal(
            operator.scheduler_store.as_ref(),
            operator.journal.as_ref(),
            run,
            orchestrator_core::NodeId("gate".into()),
            serde_json::json!({"decision": "approved"}),
            chrono::Utc::now(),
        )
        .await
        .expect("signal");
        assert_eq!(out.code, crate::errors::EXIT_OK, "{}", out.text);

        let (_tx, shutdown) = tokio::sync::watch::channel(0u64);
        crate::cmd::worker::serve(
            &worker.ticker(),
            crate::cmd::worker::ServeOpts {
                interval: std::time::Duration::from_millis(10),
                once: true,
            },
            shutdown,
        )
        .await
        .expect("serve --once");
        let st = worker.scheduler.status(run).await.unwrap().expect("row");
        drop(t);
        assert_eq!(
            st.status,
            orchestrator_core::RunStatus::Completed,
            "the worker must drive a run submitted under the pushed generation: {:?}",
            st.reason
        );
    }

    /// AG-3: `run status` on the Postgres backend reads the tenant's real wake-attempt
    /// counter — the light tier must wire the store's reader, not the memory backend's no-op.
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
    )]
    #[tokio::test]
    async fn light_wires_the_tenants_wake_attempt_counter() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let t = crate::test_tenant::TestTenant::new(&url).await;
        let env = tenant_env(&url, t.id, "torii-attempts-probe-fence");
        let run = orchestrator_core::RunId(uuid::Uuid::new_v4());
        let d = light(&env).await.expect("light boots");
        d.scheduler_store
            .enqueue(
                run,
                &orchestrator_core::Graph { nodes: vec![] },
                chrono::Utc::now(),
            )
            .await
            .expect("enqueue");
        let n = d.wake_attempts.wake_attempts(run).await.expect("read");
        drop(t);
        assert_eq!(n, Some(1), "submit's inline drive is attempt 1");
    }

    /// `heavy()` shares ONE pool across every store AND the catalog read: a regression to a
    /// pool per store shows ~5 backends, this ~1 (verified by hand in the gateway against the
    /// four-pool shape). Counted by a unique `application_name` carried only by the pool
    /// `heavy()` opens — a before/after delta of all backends charged concurrent tests'
    /// pools to `heavy()` and failed 5 runs in 6 with nothing wrong. `after >= 1` proves sqlx
    /// honoured the tag, so the upper bound is never vacuous.
    #[cfg_attr(
        not(have_database_url),
        ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
    )]
    #[tokio::test]
    async fn heavy_boots_on_one_pools_worth_of_real_backend_connections() {
        let Some(url) = crate::test_guard::db_url() else {
            return;
        };
        let t = crate::test_tenant::TestTenant::new(&url).await;
        t.stores()
            .config
            .store_and_bump(&probe_agent("torii-boot-probe-agent", "chat"))
            .await
            .expect("seed");
        let tag = format!("torii-boot-probe-{}", uuid::Uuid::new_v4());
        let sep = if url.contains('?') { '&' } else { '?' };
        let env = tenant_env(
            &format!("{url}{sep}application_name={tag}"),
            t.id,
            "torii-boot-probe-fence",
        );
        async fn backend_count(pool: &sqlx::PgPool, tag: &str) -> i64 {
            let (n,): (i64,) = sqlx::query_as(
                "select count(*) from pg_stat_activity
                 where datname = current_database() and application_name = $1",
            )
            .bind(tag)
            .fetch_one(pool)
            .await
            .expect("count backends");
            n
        }
        let before = backend_count(&t.pool, &tag).await;
        let deps = heavy(&env, None, None).await;
        let after = backend_count(&t.pool, &tag).await;
        drop(t);
        let deps = deps.expect("boots");
        assert_eq!(before, 0, "the probe tag is unique to this call");
        assert!(
            after >= 1,
            "sqlx did not honour application_name — measuring nothing"
        );
        assert!(
            after <= 2,
            "heavy() must share ONE pool (~1 backend connection), saw {after}"
        );
        drop(deps);
    }
}
