//! TM-8c (torii#26) done-when, at the BINARY: the `torii` built from this repo runs
//! submit → pause → signal → worker → completion against torii's database for one tenant, and
//! `config push` writes that tenant's registry and bumps only that tenant's generation. The
//! gateway config is torii's catalog throughout — no `--gateway-config` anywhere.
//!
//! The graph's only node waits for a human (`AwaitSignal`), so the run needs no model.

use orchestrator_core::{ConfigSource, Graph, Node, NodeId, NodeKind};
use std::process::{Command, Output};

fn torii() -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_torii"));
    for k in [
        "DATABASE_URL",
        "TORII_TENANT",
        "TORII_FENCE_VERSION",
        "TORII_BACKEND",
        "TORII_REGISTRY_DIR",
    ] {
        c.env_remove(k);
    }
    c
}

/// A tenant of the test's own, removed on drop (also when the test panicked).
struct Tenant {
    url: String,
    id: uuid::Uuid,
    slug: String,
}

impl Tenant {
    async fn new(url: &str) -> Tenant {
        let id = uuid::Uuid::new_v4();
        let slug = format!("torii-bin-{id}");
        let pool = torii_core::connect(url, 1).await.expect("connect");
        sqlx::query(
            "insert into core.tenants (id, name, slug, modified_by) values ($1, $2, $2, 'torii-bin')",
        )
        .bind(id)
        .bind(&slug)
        .execute(&pool)
        .await
        .expect("create the test tenant");
        Tenant {
            url: url.to_string(),
            id,
            slug,
        }
    }

    /// `torii` for this tenant — by SLUG, the way an operator names it.
    fn torii(&self) -> Command {
        let mut c = torii();
        c.env("DATABASE_URL", &self.url)
            .env("TORII_TENANT", &self.slug);
        c
    }

    async fn generation(&self) -> Option<u64> {
        let pool = torii_core::connect(&self.url, 1).await.expect("connect");
        torii_core::TenantStores::open(&pool, self.id)
            .config
            .version()
            .await
            .expect("version")
    }
}

impl Drop for Tenant {
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

fn db_url() -> Option<String> {
    let url = std::env::var("DATABASE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty());
    if url.is_none() {
        use std::io::Write;
        let name = std::thread::current()
            .name()
            .unwrap_or("<unnamed test>")
            .to_string();
        let _ =
            std::io::stderr().write_all(format!("SKIP {name}: DATABASE_URL not set\n").as_bytes());
    }
    url
}

/// A registry dir with one agent bound to `chain`.
fn registry(dir: &std::path::Path, chain: &str) -> std::path::PathBuf {
    let reg = dir.join(format!("registry-{chain}"));
    std::fs::create_dir_all(reg.join("agents")).unwrap();
    std::fs::write(
        reg.join("agents/researcher.md"),
        format!(
            "---\nname: researcher\narea: research\nkind: lead\nchain: {chain}\ntools: []\nskills: []\n---\nYou research.\n"
        ),
    )
    .unwrap();
    reg
}

fn ok(out: &Output) -> String {
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    assert!(
        out.status.success(),
        "exit {:?}\nstdout: {stdout}\nstderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    stdout
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn config_push_writes_the_tenants_registry_and_bumps_only_its_generation() {
    let Some(url) = db_url() else { return };
    let (a, b) = (Tenant::new(&url).await, Tenant::new(&url).await);
    let dir = tempfile::tempdir().unwrap();

    // A chain torii's catalog does not define is refused — the check is always on.
    let out = a
        .torii()
        .args(["config", "push", "--yes"])
        .arg(registry(dir.path(), "torii-chain-nobody-defined"))
        .output()
        .expect("spawn");
    assert!(!out.status.success());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("torii-chain-nobody-defined") && err.contains("torii's catalog"),
        "{err}"
    );
    assert_eq!(
        a.generation().await,
        Some(0),
        "a refused push writes nothing"
    );

    // A chain the catalog defines lands — for A only.
    ok(&a
        .torii()
        .args(["config", "push", "--yes"])
        .arg(registry(dir.path(), "chat"))
        .output()
        .expect("spawn"));
    assert_eq!(a.generation().await, Some(1), "A's generation moved");
    assert_eq!(b.generation().await, Some(0), "B's generation did not");
    let version = ok(&a
        .torii()
        .args(["config", "version"])
        .output()
        .expect("spawn"));
    assert_eq!(
        version.trim(),
        "config version: 1",
        "the CLI reads the same tenant's generation"
    );
}

#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn a_run_submitted_on_postgres_pauses_is_signalled_and_a_worker_completes_it() {
    let Some(url) = db_url() else { return };
    let t = Tenant::new(&url).await;
    let dir = tempfile::tempdir().unwrap();
    ok(&t
        .torii()
        .args(["config", "push", "--yes"])
        .arg(registry(dir.path(), "chat"))
        .output()
        .expect("spawn"));

    let graph = dir.path().join("graph.json");
    let g = Graph {
        nodes: vec![Node {
            id: NodeId("gate".into()),
            kind: NodeKind::AwaitSignal { timeout: None },
            deps: vec![],
        }],
    };
    std::fs::write(&graph, serde_json::to_string(&g).unwrap()).unwrap();

    // Submit: drives to the durable pause. No --gateway-config: the catalog is the config.
    let submit = t
        .torii()
        .env("TORII_FENCE_VERSION", "v1")
        .args(["run", "submit", "--graph"])
        .arg(&graph)
        .output()
        .expect("spawn");
    let submitted = ok(&submit);
    // AG-18: the submit drive's run events reach the operator's log.
    let log = String::from_utf8_lossy(&submit.stderr);
    assert!(
        log.contains(r#""type":"signal_awaited""#) && log.contains(r#""node":"gate""#),
        "run submit must log the drive's run events:\n{log}"
    );
    let run = submitted
        .lines()
        .find_map(|l| l.strip_prefix("submitted: "))
        .expect("the run id is announced")
        .trim()
        .to_string();
    assert!(
        submitted.contains("paused: ") && submitted.contains("at node gate"),
        "{submitted}"
    );

    // The human answers, in another process.
    ok(&t
        .torii()
        .args(["run", "signal", &run, "--node", "gate", "--payload"])
        .arg(r#"{"decision":"approved"}"#)
        .output()
        .expect("spawn"));

    // A worker — a third process — drives it home.
    let worker = t
        .torii()
        .env("TORII_FENCE_VERSION", "v1")
        .args(["worker", "serve", "--once"])
        .output()
        .expect("spawn");
    ok(&worker);
    // AG-18: and the worker drive reports the decision it honoured.
    let log = String::from_utf8_lossy(&worker.stderr);
    assert!(
        log.contains(r#""type":"signal_received""#) && log.contains(r#""decision":"approved""#),
        "worker serve must log the decision its drive honoured:\n{log}"
    );

    let status = ok(&t
        .torii()
        .args(["run", "status", &run, "--json"])
        .output()
        .expect("spawn"));
    assert!(status.contains("completed"), "{status}");

    // And the run is this tenant's: another tenant does not see it.
    let other = Tenant::new(&url).await;
    let out = other
        .torii()
        .args(["run", "status", &run])
        .output()
        .expect("spawn");
    assert!(
        !out.status.success(),
        "another tenant must not find the run"
    );
}

/// On Postgres the gateway config IS torii's catalog: `config push --gateway-config <file>` is
/// refused outright — even when the file defines the chain the registry needs — so a push can
/// never be checked against a source the API never sees, and nothing is written.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn config_push_refuses_a_gateway_config_file_on_postgres_and_writes_nothing() {
    let Some(url) = db_url() else { return };
    let t = Tenant::new(&url).await;
    let dir = tempfile::tempdir().unwrap();
    let gw = dir.path().join("gw.json");
    std::fs::write(
        &gw,
        r#"{"routers":{"ollama":{"url":"http://127.0.0.1:11434"}},
            "chains":{"file-only-chain":{"id":"file-only-chain","capability":"text_chat","models":[],"fallback_triggers":[]}}}"#,
    )
    .unwrap();
    let out = t
        .torii()
        .args(["config", "push", "--yes", "--gateway-config"])
        .arg(&gw)
        .arg(registry(dir.path(), "file-only-chain"))
        .output()
        .expect("spawn");
    assert!(!out.status.success(), "a file must be refused on postgres");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--gateway-config is not accepted"), "{err}");
    assert_eq!(t.generation().await, Some(0), "nothing was pushed");
}

/// AG-15: the tool-policy and escalation keys survive `config push` → torii's Postgres
/// registry → load, exactly as authored — and a second push of the same directory is a no-op,
/// so the durable form is byte-stable (a key dropped or reshaped on the way in would show up
/// as a "changed" agent on every push).
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn ag15_agent_policy_keys_round_trip_through_the_postgres_registry() {
    let Some(url) = db_url() else { return };
    let t = Tenant::new(&url).await;
    let dir = tempfile::tempdir().unwrap();
    let reg = dir.path().join("registry-ag15");
    std::fs::create_dir_all(reg.join("agents")).unwrap();
    std::fs::create_dir_all(reg.join("tools")).unwrap();
    std::fs::write(
        reg.join("tools/deploy.json"),
        r#"{"name":"deploy","description":"ship it","input_schema":{},"effect_class":"Pure","ttl_secs":null,"source":null}"#,
    )
    .unwrap();
    std::fs::write(
        reg.join("agents/deployer.md"),
        "---\nname: deployer\narea: ops\nkind: deploy\nchain: chat\ntools: [deploy]\nskills: []\n\
         tool_limits: [deploy=2]\nconfirm_tools: [deploy]\nconfirm_timeout: 2h\n---\nYou deploy.\n",
    )
    .unwrap();
    std::fs::write(
        reg.join("agents/reviewer.md"),
        "---\nname: reviewer\narea: review\nkind: lead\ntools: []\nskills: []\n\
         backed_by: human\ntimeout: 1h\nescalate_to: lead\n---\nYou review.\n",
    )
    .unwrap();
    std::fs::write(
        reg.join("agents/lead.md"),
        "---\nname: lead\narea: review\nkind: escalation\ntools: []\nskills: []\n\
         backed_by: human\ntimeout: 2h\n---\nYou decide.\n",
    )
    .unwrap();

    ok(&t
        .torii()
        .args(["config", "push", "--yes"])
        .arg(&reg)
        .output()
        .expect("spawn"));

    let pool = torii_core::connect(&url, 1).await.expect("connect");
    let (cfg, _) = torii_core::TenantStores::open(&pool, t.id)
        .config
        .load_versioned()
        .await
        .expect("load");
    let agent = |n: &str| {
        cfg.agents
            .iter()
            .find(|a| a.name == n)
            .unwrap_or_else(|| panic!("{n} was not stored: {cfg:?}"))
            .clone()
    };
    let deployer = agent("deployer");
    assert_eq!(deployer.tool_limits.get("deploy"), Some(&2), "{deployer:?}");
    assert_eq!(deployer.confirm_tools, vec!["deploy".to_string()]);
    assert_eq!(deployer.confirm_timeout, Some(chrono::Duration::hours(2)));
    assert_eq!(agent("reviewer").escalate_to.as_deref(), Some("lead"));
    assert_eq!(agent("lead").escalate_to, None);

    let again = ok(&t
        .torii()
        .args(["config", "push", "--yes"])
        .arg(&reg)
        .output()
        .expect("spawn"));
    assert!(
        again.contains("no changes"),
        "the stored policy must compare equal to what was authored: {again}"
    );
}

/// AG-4 (#33) done-when, at the BINARY on Postgres, per tenant: `torii run results` returns a
/// completed run's node outputs — one small enough to sit inline in the executor's checkpoint,
/// and one over the CAS threshold that is stored as a ref into the tenant's CAS and has to be
/// resolved — and another tenant asking for the same run gets the not-found every unknown run
/// gets, with nothing of the run in it.
///
/// No model: `gate` waits for a signal and `review` is a human-backed role, so the two outputs
/// are a signal payload and a human answer. The answer is sized so the node's output
/// (`{text, actor}`) serializes past the executor's 4096-byte CAS threshold while the text
/// itself stays under the 4096-byte answer cap.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn run_results_returns_a_completed_runs_outputs_incl_a_cas_ref_and_another_tenant_gets_not_found()
 {
    let Some(url) = db_url() else { return };
    let t = Tenant::new(&url).await;
    let dir = tempfile::tempdir().unwrap();
    let reg = dir.path().join("registry-results");
    std::fs::create_dir_all(reg.join("agents")).unwrap();
    std::fs::write(
        reg.join("agents/reviewer.md"),
        "---\nname: reviewer\narea: review\nkind: lead\ntools: []\nskills: []\n\
         backed_by: human\n---\nYou review.\n",
    )
    .unwrap();
    ok(&t
        .torii()
        .args(["config", "push", "--yes"])
        .arg(&reg)
        .output()
        .expect("spawn"));

    let graph = dir.path().join("graph.json");
    let g = Graph {
        nodes: vec![
            Node {
                id: NodeId("gate".into()),
                kind: NodeKind::AwaitSignal { timeout: None },
                deps: vec![],
            },
            Node {
                id: NodeId("review".into()),
                kind: NodeKind::Agent {
                    agent: orchestrator_core::AgentRef("reviewer".into()),
                    input: serde_json::json!("review clause 7"),
                    phase: None,
                },
                deps: vec![],
            },
        ],
    };
    std::fs::write(&graph, serde_json::to_string(&g).unwrap()).unwrap();
    let submitted = ok(&t
        .torii()
        .env("TORII_FENCE_VERSION", "v1")
        .args(["run", "submit", "--graph"])
        .arg(&graph)
        .output()
        .expect("spawn"));
    let run = submitted
        .lines()
        .find_map(|l| l.strip_prefix("submitted: "))
        .expect("the run id is announced")
        .trim()
        .to_string();

    ok(&t
        .torii()
        .args(["run", "signal", &run, "--node", "gate", "--payload"])
        .arg(r#"{"decision":"approved"}"#)
        .output()
        .expect("spawn"));
    let answer: String = "clause seven reads fine. "
        .repeat(200)
        .chars()
        .take(4090)
        .collect();
    let answer_file = dir.path().join("answer.txt");
    std::fs::write(&answer_file, &answer).unwrap();
    ok(&t
        .torii()
        .args([
            "run", "agent", "answer", &run, "--node", "review", "--as", "alice",
        ])
        .arg("--text-file")
        .arg(&answer_file)
        .output()
        .expect("spawn"));
    ok(&t
        .torii()
        .env("TORII_FENCE_VERSION", "v1")
        .args(["worker", "serve", "--once"])
        .output()
        .expect("spawn"));

    // The text table: both nodes, the CAS-stored one marked as such.
    let table = ok(&t
        .torii()
        .args(["run", "results", &run])
        .output()
        .expect("spawn"));
    assert!(table.contains("completed"), "{table}");
    assert!(
        table
            .lines()
            .any(|l| l.starts_with("gate") && l.contains("approved")),
        "{table}"
    );
    assert!(
        table
            .lines()
            .any(|l| l.starts_with("review") && l.contains("cas ")),
        "{table}"
    );

    // --json: the whole result, the CAS ref resolved to the answer.
    let json: serde_json::Value = serde_json::from_str(&ok(&t
        .torii()
        .args(["run", "results", &run, "--json"])
        .output()
        .expect("spawn")))
    .expect("--json is JSON");
    assert_eq!(json["run"], serde_json::json!(run));
    assert_eq!(json["status"], "completed");
    let nodes = json["nodes"].as_array().expect("nodes");
    let node = |id: &str| {
        nodes
            .iter()
            .find(|n| n["node"] == id)
            .unwrap_or_else(|| panic!("no {id}: {json}"))
            .clone()
    };
    assert_eq!(node("gate")["stored"]["kind"], "inline", "{json}");
    assert_eq!(node("gate")["output"]["decision"], "approved", "{json}");
    let review = node("review");
    assert_eq!(review["stored"]["kind"], "cas", "{json}");
    assert_eq!(review["output"]["text"], serde_json::json!(answer));
    assert_eq!(review["output"]["actor"], "alice");
    // The ref really is a blob in THIS tenant's CAS.
    let digest = review["stored"]["digest"]
        .as_str()
        .expect("digest")
        .to_string();
    let pool = torii_core::connect(&url, 1).await.expect("connect");
    let (n,): (i64,) =
        sqlx::query_as("select count(*) from runs.cas_blobs where tenant_id = $1 and digest = $2")
            .bind(t.id)
            .bind(&digest)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 1, "the review output lives in the tenant's CAS");

    // --node: one node.
    let one: serde_json::Value = serde_json::from_str(&ok(&t
        .torii()
        .args(["run", "results", &run, "--node", "review", "--json"])
        .output()
        .expect("spawn")))
    .expect("--node --json is JSON");
    assert_eq!(one["node"], "review");
    assert_eq!(one["output"]["text"], serde_json::json!(answer));
    let text = ok(&t
        .torii()
        .args(["run", "results", &run, "--node", "review"])
        .output()
        .expect("spawn"));
    assert!(
        text.contains(&answer),
        "--node prints the whole output: {text}"
    );

    // Another tenant: the same not-found as a run that never existed — nothing of the run.
    let other = Tenant::new(&url).await;
    let never = uuid::Uuid::new_v4().to_string();
    for json in [false, true] {
        let ask = |id: &str| {
            let mut c = other.torii();
            c.args(["run", "results", id]);
            if json {
                c.arg("--json");
            }
            c.output().expect("spawn")
        };
        let (theirs, missing) = (ask(&run), ask(&never));
        assert_eq!(theirs.status.code(), Some(2), "{theirs:?}");
        assert_eq!(missing.status.code(), Some(2), "{missing:?}");
        let theirs_out = String::from_utf8_lossy(&theirs.stdout).replace(&run, "<id>");
        let missing_out = String::from_utf8_lossy(&missing.stdout).replace(&never, "<id>");
        assert_eq!(
            theirs_out, missing_out,
            "another tenant's run must read exactly like no run at all"
        );
        assert!(!theirs_out.contains("approved") && !theirs_out.contains("clause"));
    }
}

/// A registry using every file of the layout: AG-15 policy keys, a human-backed escalation
/// chain, a keyword skill, a tool, chain bindings and per-tool grants.
fn rich_registry(dir: &std::path::Path, tag: &str) -> std::path::PathBuf {
    let reg = dir.join(format!("registry-rich-{tag}"));
    for sub in ["agents", "skills", "tools"] {
        std::fs::create_dir_all(reg.join(sub)).unwrap();
    }
    std::fs::write(
        reg.join("tools/deploy.json"),
        r#"{"name":"deploy","description":"ship it","input_schema":{"type":"object"},"effect_class":"Mutation","ttl_secs":null,"source":null,"credentials":["github"]}"#,
    )
    .unwrap();
    std::fs::write(
        reg.join("skills/careful.md"),
        "---\nname: careful\ndescription: Be careful: always\nactivate_on: [deploy, ship]\n---\nCheck twice.\n",
    )
    .unwrap();
    std::fs::write(
        reg.join(format!("agents/deployer-{tag}.md")),
        format!(
            "---\nname: deployer-{tag}\narea: ops\nkind: deploy\nchains: [plan=chat]\ntools: [deploy]\n\
             skills: [careful]\ntool_limits: [deploy=2]\nconfirm_tools: [deploy]\n\
             confirm_timeout: 90m\n---\nYou deploy.\n\n---\nA rule line in the body.\n"
        ),
    )
    .unwrap();
    std::fs::write(
        reg.join("agents/reviewer.md"),
        "---\nname: reviewer\narea: review\nkind: lead\ntools: []\nskills: []\n\
         backed_by: human\ntimeout: 1h\nescalate_to: lead\n---\nYou review.\n",
    )
    .unwrap();
    std::fs::write(
        reg.join("agents/lead.md"),
        "---\nname: lead\narea: review\nkind: escalation\ntools: []\nskills: []\n\
         backed_by: human\ntimeout: 2d\n---\nYou decide.\n",
    )
    .unwrap();
    std::fs::write(
        reg.join("chains.json"),
        r#"[{"area":"ops","kind":"deploy","chain":"chat"}]"#,
    )
    .unwrap();
    std::fs::write(
        reg.join("grants.json"),
        format!(
            r#"{{"deployer-{tag}":{{"deploy":{{"commands":["git"],"network":{{"Hosts":["github.com"]}}}}}}}}"#
        ),
    )
    .unwrap();
    reg
}

/// AG-6 (#35) done-when, at the BINARY on Postgres: `config pull` then `config push` of the
/// result is a no-op, per tenant — and neither `config show` nor `config pull` of one tenant
/// ever carries another tenant's registry.
#[cfg_attr(
    not(have_database_url),
    ignore = "needs a Postgres at $DATABASE_URL with torii's schema applied + seeded"
)]
#[tokio::test]
async fn config_pull_then_push_is_a_no_op_per_tenant_and_never_shows_another_tenant() {
    let Some(url) = db_url() else { return };
    let (a, b) = (Tenant::new(&url).await, Tenant::new(&url).await);
    let dir = tempfile::tempdir().unwrap();
    for (t, tag) in [(&a, "alpha"), (&b, "beta")] {
        ok(&t
            .torii()
            .args(["config", "push", "--yes"])
            .arg(rich_registry(dir.path(), tag))
            .output()
            .expect("spawn"));
    }

    for (t, mine, theirs) in [(&a, "alpha", "beta"), (&b, "beta", "alpha")] {
        let shown: serde_json::Value = serde_json::from_str(&ok(&t
            .torii()
            .args(["config", "show"])
            .output()
            .expect("spawn")))
        .expect("config show prints JSON");
        assert_eq!(shown["generation"], 1, "{shown}");
        let names: Vec<String> = shown["registry"]["agents"]
            .as_array()
            .expect("agents")
            .iter()
            .map(|a| a["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            names,
            [format!("deployer-{mine}"), "lead".into(), "reviewer".into()],
            "show carries this tenant's agents only"
        );
        assert!(!shown.to_string().contains(theirs), "{shown}");

        let pulled = dir.path().join(format!("pulled-{mine}"));
        let out = ok(&t
            .torii()
            .args(["config", "pull"])
            .arg(&pulled)
            .output()
            .expect("spawn"));
        assert!(out.contains("pulled config v1"), "{out}");
        let grants = std::fs::read_to_string(pulled.join("grants.json")).unwrap();
        assert!(grants.contains(&format!("deployer-{mine}")), "{grants}");
        for entry in walk(&pulled) {
            let text = std::fs::read_to_string(&entry).unwrap();
            assert!(
                !text.contains(theirs),
                "{} carries the other tenant's registry: {text}",
                entry.display()
            );
        }

        let again = ok(&t
            .torii()
            .args(["config", "push", "--yes"])
            .arg(&pulled)
            .output()
            .expect("spawn"));
        assert!(
            again.contains("no changes"),
            "pushing a pull of the live registry must change nothing: {again}"
        );
        assert_eq!(t.generation().await, Some(1), "a no-op push bumps nothing");
    }
}

/// Every file under `root`, recursively.
fn walk(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(root).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}
