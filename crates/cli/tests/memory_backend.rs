//! TM-5 (gateway#81): the memory backend boots and drives a run with NO database — the
//! development/CI backend, and the seam the move to torii plugs its own stores into.

use std::process::Command;

use orchestrator_core::{Graph, Node, NodeId, NodeKind};

fn torii() -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_torii"));
    // The point of the test: there is no database at all.
    c.env_remove("DATABASE_URL");
    c.env_remove("TORII_FENCE_VERSION");
    c.env_remove("TORII_BACKEND");
    c.env_remove("TORII_REGISTRY_DIR");
    for v in [
        "TORII_WAKE_MAX_ATTEMPTS",
        "TORII_WAKE_BASE_BACKOFF",
        "TORII_WAKE_MAX_BACKOFF",
    ] {
        c.env_remove(v);
    }
    c
}

/// A registry dir (one agent bound to chain `c`), a gateway config defining `c`, and a graph
/// whose only node waits for a human — so the run needs no model and no network to reach a
/// durable pause.
fn fixtures(dir: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
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

    let graph = dir.join("graph.json");
    let g = Graph {
        nodes: vec![Node {
            id: NodeId("gate".into()),
            kind: NodeKind::AwaitSignal { timeout: None },
            deps: vec![],
        }],
    };
    std::fs::write(&graph, serde_json::to_string(&g).unwrap()).unwrap();
    (reg, gw, graph)
}

#[test]
fn run_submit_on_the_memory_backend_needs_no_database() {
    let dir = tempfile::tempdir().unwrap();
    let (reg, gw, graph) = fixtures(dir.path());
    let out = torii()
        .env("TORII_BACKEND", "memory")
        .env("TORII_REGISTRY_DIR", &reg)
        .env("TORII_FENCE_VERSION", "v1")
        .args(["run", "submit", "--graph"])
        .arg(&graph)
        .arg("--gateway-config")
        .arg(&gw)
        .output()
        .expect("spawn torii");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "exit {:?}\nstdout: {stdout}\nstderr: {stderr}",
        out.status.code()
    );
    assert!(stdout.contains("submitted: "), "{stdout}");
    assert!(
        stdout.contains("paused: ") && stdout.contains("at node gate"),
        "the run reached its durable pause on the memory backend: {stdout}"
    );
}

#[test]
fn the_default_backend_is_still_postgres_and_still_needs_a_database_url() {
    let out = torii()
        .args(["run", "list-paused"])
        .output()
        .expect("spawn torii");
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("DATABASE_URL"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn an_unknown_backend_is_refused_naming_the_choices() {
    let out = torii()
        .env("TORII_BACKEND", "mysql")
        .args(["run", "list-paused"])
        .output()
        .expect("spawn torii");
    assert!(!out.status.success());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("mysql") && err.contains("memory") && err.contains("postgres"),
        "{err}"
    );
}

/// AG-18 review: `TORII_WAKE_*` is the DRIVERS' policy, so a bad value must fail only the
/// commands that drive (`run submit`, `worker serve`) — never strand an operator's read and
/// recovery verbs (`run status`, `run list-paused`, `run cancel`) on a variable they never read.
#[test]
fn a_bad_wake_policy_fails_only_the_commands_that_drive() {
    let dir = tempfile::tempdir().unwrap();
    let (reg, gw, graph) = fixtures(dir.path());
    let bad = |c: &mut Command| {
        c.env("TORII_BACKEND", "memory")
            .env("TORII_REGISTRY_DIR", &reg)
            .env("TORII_FENCE_VERSION", "v1")
            .env("TORII_WAKE_MAX_ATTEMPTS", "0");
    };

    let mut c = torii();
    bad(&mut c);
    let out = c
        .args(["run", "list-paused"])
        .output()
        .expect("spawn torii");
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
    assert!(
        out.status.success(),
        "list-paused never reads the wake policy: exit {:?}\nstdout: {stdout}\nstderr: {stderr}",
        out.status.code()
    );

    let mut c = torii();
    bad(&mut c);
    let out = c
        .args(["run", "status", "00000000-0000-4000-8000-000000000001"])
        .output()
        .expect("spawn torii");
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
    assert!(
        stdout.contains("no such run") && !stderr.contains("TORII_WAKE_MAX_ATTEMPTS"),
        "run status reaches the store, not the wake policy: exit {:?}\nstdout: {stdout}\n\
         stderr: {stderr}",
        out.status.code()
    );

    let mut c = torii();
    bad(&mut c);
    let out = c
        .args(["run", "submit", "--graph"])
        .arg(&graph)
        .arg("--gateway-config")
        .arg(&gw)
        .output()
        .expect("spawn torii");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "a driver refuses: {stderr}");
    assert!(
        stderr.contains("TORII_WAKE_MAX_ATTEMPTS") && stderr.contains("\"0\""),
        "and names the variable and the value: {stderr}"
    );
    assert!(
        !String::from_utf8_lossy(&out.stdout).contains("submitted"),
        "refused BEFORE anything is submitted"
    );
}

/// AG-6 (#35): `config show` prints the live registry as JSON with its generation, and
/// `config pull` writes the directory `config push` (and `TORII_REGISTRY_DIR`) reads — so a
/// memory backend booted from the pulled directory shows the same registry.
#[test]
fn config_show_and_pull_on_the_memory_backend_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let (reg, _, _) = fixtures(dir.path());
    let show = |registry: &std::path::Path| {
        let out = torii()
            .env("TORII_BACKEND", "memory")
            .env("TORII_REGISTRY_DIR", registry)
            .args(["config", "show"])
            .output()
            .expect("spawn torii");
        assert!(
            out.status.success(),
            "exit {:?}\nstderr: {}",
            out.status.code(),
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap_or_else(|e| {
            panic!(
                "config show prints JSON ({e}): {}",
                String::from_utf8_lossy(&out.stdout)
            )
        })
    };
    let shown = show(&reg);
    assert_eq!(shown["generation"], 1, "{shown}");
    assert_eq!(
        shown["registry"]["agents"][0]["name"], "researcher",
        "{shown}"
    );

    let pulled = dir.path().join("pulled");
    let pull = |force: bool| {
        let mut c = torii();
        c.env("TORII_BACKEND", "memory")
            .env("TORII_REGISTRY_DIR", &reg)
            .args(["config", "pull"])
            .arg(&pulled);
        if force {
            c.arg("--force");
        }
        c.output().expect("spawn torii")
    };
    let out = pull(false);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "exit {:?}\nstderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("pulled config v1") && stdout.contains("1 agent"),
        "{stdout}"
    );
    assert!(pulled.join("agents/researcher.md").is_file());

    // A second pull into the now non-empty directory is refused, and says how to proceed.
    // Exit 2 prints its result on stdout, like `config push`'s refusal.
    let out = pull(false);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(2), "{stdout}");
    assert!(
        stdout.contains("not empty") && stdout.contains("--force"),
        "{stdout}"
    );
    let out = pull(true);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    assert_eq!(
        show(&pulled)["registry"],
        shown["registry"],
        "the pulled directory boots as the same registry"
    );
}

/// A provider speaking the OpenAI wire that fails every call with a 500 — a fault the gateway
/// classifies as retryable. Returns its base URL and its call count.
async fn failing_provider() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    let app = axum::Router::new().route(
        "/v1/chat/completions",
        axum::routing::post(move || {
            let counted = counted.clone();
            async move {
                counted.fetch_add(1, SeqCst);
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!({"error": {"message": "upstream blip"}})),
                )
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, calls)
}

/// AG-5 on the memory backend: nothing outlives the process, so a run paused on a transient
/// retry can never be woken — no later `worker serve` can see it. With `TORII_TRANSIENT_ATTEMPTS`
/// unset, `run submit` must therefore fail a provider 500 (exit non-zero), not print `paused`
/// and exit 0 on a model call that never succeeded.
#[tokio::test(flavor = "multi_thread")]
async fn a_provider_500_fails_run_submit_on_the_memory_backend_by_default() {
    let (url, calls) = failing_provider().await;
    let dir = tempfile::tempdir().unwrap();
    let (reg, gw, _) = fixtures(dir.path());
    std::fs::write(
        &gw,
        serde_json::json!({
            "routers": {"ollama": {"url": url}},
            "models": {"m": {"id": "m", "provider": "ollama", "capabilities": ["text_chat"],
                             "context_window": 8192, "max_output_tokens": 1024}},
            "chains": {"c": {"id": "c", "capability": "text_chat",
                             "models": [{"model": "m", "router": "ollama", "priority": 1}],
                             "fallback_triggers": []}}
        })
        .to_string(),
    )
    .unwrap();
    let graph = dir.path().join("ask.json");
    let g = Graph {
        nodes: vec![Node {
            id: NodeId("ask".into()),
            kind: NodeKind::ModelCall {
                chain: "c".into(),
                payload: serde_json::json!({"prompt": "hello"}),
            },
            deps: vec![],
        }],
    };
    std::fs::write(&graph, serde_json::to_string(&g).unwrap()).unwrap();

    let out = torii()
        .env_remove("TORII_TRANSIENT_ATTEMPTS")
        .env("TORII_BACKEND", "memory")
        .env("TORII_REGISTRY_DIR", &reg)
        .env("TORII_FENCE_VERSION", "v1")
        .args(["run", "submit", "--graph"])
        .arg(&graph)
        .arg("--gateway-config")
        .arg(&gw)
        .output()
        .expect("spawn torii");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        calls.load(std::sync::atomic::Ordering::SeqCst) >= 1,
        "precondition: the provider was called\nstdout: {stdout}\nstderr: {stderr}"
    );
    assert_ne!(
        out.status.code(),
        Some(0),
        "a memory-backend run paused on a retry nothing can wake must not exit 0\n\
         stdout: {stdout}\nstderr: {stderr}"
    );
    assert!(
        stderr.contains("failed: ") && stderr.contains("at node ask"),
        "stdout: {stdout}\nstderr: {stderr}"
    );
}
