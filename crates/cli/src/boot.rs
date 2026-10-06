//! Wiring: environment and files -> live dependencies. This is torii's ONLY
//! Postgres/env/config-file-aware module: `Executor` takes every backend as an injected
//! `Arc<dyn ...>` precisely so the orchestrator library knows nothing about any of them,
//! and every `cmd` here takes its dependencies as arguments so none of them needs this
//! module either. Concentrating the wiring in one place is what keeps the commands
//! unit-testable against in-memory doubles.

use crate::errors::{CliError, redact_url};
use orchestrator::agent::tools::{
    FsReadTool, FsWriteReconciler, FsWriteTool, ReconcileRegistry, ShellTool, ToolRegistry,
};
use orchestrator::{Executor, Scheduler};
use orchestrator_core::{
    Clock, ConfigSource, ConfigStore, ContentStore, ContextStore, ExecutionJournal,
    PatternRedactor, RegistryHandle, RulePlannerSelector, SchedulerStore, SystemClock,
};
use orchestrator_store::postgres::{
    PostgresConfigSource, PostgresContentStore, PostgresContextStore, PostgresJournal,
    PostgresSchedulerStore, connect_with_max,
};
use orchestrator_store::{
    FilesystemConfigSource, InMemoryConfigStore, InMemoryContentStore, InMemoryContextStore,
    InMemoryJournal, InMemorySchedulerStore,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const ENV_DATABASE_URL: &str = "DATABASE_URL";
pub const ENV_FENCE_VERSION: &str = "TORII_FENCE_VERSION";
pub const ENV_POOL_SIZE: &str = "TORII_POOL_SIZE";
pub const ENV_BACKEND: &str = "TORII_BACKEND";
pub const ENV_REGISTRY_DIR: &str = "TORII_REGISTRY_DIR";
pub const ENV_TENANT: &str = "TORII_TENANT";

/// [`connect_with_max`]'s own default, restated here as the fallback when
/// `TORII_POOL_SIZE` is unset — see that function's doc comment for why 8.
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

/// The validated environment. `fence_version` is only required by the heavy tier;
/// `pool_size` only by the Postgres backend.
#[derive(PartialEq)]
pub struct EnvConfig {
    pub backend: Backend,
    pub fence_version: Option<String>,
    pub pool_size: u32,
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
    Ok(EnvConfig {
        backend,
        fence_version,
        pool_size,
    })
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
    let tenant = non_empty(ENV_TENANT).unwrap_or_default(); // TM-8c red: not yet required
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
        let _ = &self.pool;
        Err(CliError::error(
            "TM-8c red: the catalog source is not implemented",
        ))
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
             push` first, or check that DATABASE_URL points at the intended database."
        )));
    }
    Ok(())
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
}

/// Every store one backend provides — the light tier's three plus the heavy tier's CAS and
/// blackboard — built in ONE place, so no tier names a backend type (TM-5).
struct Stores {
    light: LightDeps,
    content: Arc<dyn ContentStore>,
    context: Arc<dyn ContextStore>,
}

async fn open_stores(env: &EnvConfig) -> Result<Stores, CliError> {
    match &env.backend {
        Backend::Postgres { database_url, .. } => {
            // ONE pool for every store: cloning a `PgPool` is an `Arc::clone`, not a new
            // connection, so the whole process is capped at `TORII_POOL_SIZE` connections
            // (see `connect_with_max`'s doc comment for why 8 is the default).
            let pool = connect_with_max(database_url, env.pool_size)
                .await
                .map_err(|e| CliError::error(connect_failure(database_url, &e.to_string())))?;
            Ok(Stores {
                light: LightDeps {
                    scheduler_store: Arc::new(PostgresSchedulerStore::new(pool.clone())),
                    journal: Arc::new(PostgresJournal::new(pool.clone())),
                    config_source: Arc::new(PostgresConfigSource::new(pool.clone())),
                    gateway_config: None, // TM-8c red
                },
                content: Arc::new(PostgresContentStore::new(pool.clone())),
                context: Arc::new(PostgresContextStore::new(pool)),
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
                },
                context: Arc::new(InMemoryContextStore::new(content.clone())),
                content,
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
}

pub async fn heavy(
    env: &EnvConfig,
    gateway_config_file: Option<&Path>,
    workspace_root: Option<&Path>,
) -> Result<HeavyDeps, CliError> {
    let fence = require_fence(env)?.to_string();
    // TM-8c red: still the file, whatever the backend.
    let file = FileGatewayConfigSource::new(
        gateway_config_file.ok_or_else(|| CliError::error("TM-8c red: no gateway config"))?,
    );
    let gateway_config: &dyn GatewayConfigSource = &file;

    // Load the gateway config FIRST: for a file source that is pure and offline, so the most
    // likely operator typo — a bad `--gateway-config` path — is caught instantly instead of
    // only after a TCP connect and auth handshake.
    let gw_config = gateway_config.load().await?;
    let gw_source = gateway_config.describe();

    // Every store from ONE backend (TM-5): for Postgres, one shared pool; for memory, this
    // process's heap. The journal the Executor writes is the SAME one the Scheduler reads, so
    // `tick`'s pause-deadline read sees what `run` wrote.
    let Stores {
        light,
        content,
        context,
    } = open_stores(env).await?;

    // One atomic (config, generation) read — the fence generation must match the
    // config it was computed from.
    let handle =
        RegistryHandle::from_source(light.config_source.as_ref() as &dyn ConfigSource).await?;
    // `snapshot()`, not `.current()` + `.generation()` as two separate lock
    // acquisitions: those release the lock in between, which is exactly the torn
    // -read shape SP-DATA-2 eliminated. Not reachable today (boot is sequential
    // and nothing calls `reload()`), but it must not quietly plant one for
    // whoever wires the deferred reload trigger.
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
    let builder = gateway::FacadeBuilder::new(gw_config);
    let registered = builder.registry().clone();
    let facade = builder.build().await;
    require_adapters(&registered.list().await, &configured_routers, &gw_source)?;
    let gateway = Arc::new(facade.gateway);

    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    let mut executor = Executor::new(gateway, light.journal.clone(), fence)
        .with_content_store(content)
        .with_context_store(context)
        .with_registry_handle(handle)
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

    let scheduler = Scheduler::new(
        light.scheduler_store.clone(),
        executor,
        light.journal.clone(),
        clock.clone(),
    );
    Ok(HeavyDeps {
        light,
        scheduler,
        clock,
    })
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
        t.drop().await;
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
        t.drop().await;
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
        t.drop().await;
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
