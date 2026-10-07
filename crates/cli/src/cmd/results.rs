//! AG-4 (torii#33): `torii run results <id>` — a run's node outputs.
//!
//! The data — the schedule row, the executor's output checkpoint, the journal's failures and the
//! CAS refs resolved — comes from `torii_core::results`, which the API shares; this module only
//! renders it, with the same display discipline `run status` gives free text.

use crate::cmd::Outcome;
use crate::errors::{CliError, EXIT_OK, EXIT_PRECONDITION};
use crate::render;
use orchestrator_core::{ContentStore, ExecutionJournal, NodeId, RunId, RunStatus, SchedulerStore};
use torii_core::results::{NodeResult, NodeState, RunResults, Stored};

/// How much of one output the TABLE shows. The table is a scan of the run; `--node` prints an
/// output whole.
const OUTPUT_CELL_MAX: usize = 160;

/// How many hex characters of a CAS digest the table shows — enough to tell blobs apart at a
/// glance; `--json` carries the whole digest.
const DIGEST_SHOWN: usize = 12;

/// `torii run results <id> [--node <id>] [--json]`.
///
/// Exit 0 only for the unqualified success: a COMPLETED run whose every shown output resolved.
/// A run that has not completed still prints what it has produced so far, and a CAS ref that
/// could not be read back still prints its row, both at exit 2 — the documented "printable but
/// not what you asked for". An unknown run — including another tenant's, which the
/// tenant-scoped stores make indistinguishable from one that never existed — and an unknown
/// `--node` are exit 2 with `null` under `--json`, as `run status` does.
pub async fn results(
    store: &dyn SchedulerStore,
    journal: &dyn ExecutionJournal,
    content: &dyn ContentStore,
    run: RunId,
    node: Option<&NodeId>,
    json: bool,
) -> Result<Outcome, CliError> {
    let Some(results) = torii_core::results::run_results(store, journal, content, run).await?
    else {
        return Ok(Outcome::precondition(if json {
            "null".to_string()
        } else {
            format!("no such run: {}", run.0)
        }));
    };
    let results = redacted(results);
    let complete = results.status == RunStatus::Completed;

    if let Some(wanted) = node {
        let Some(row) = results.nodes.iter().find(|r| &r.node == wanted) else {
            return Ok(Outcome::precondition(if json {
                "null".to_string()
            } else {
                format!(
                    "run {} has no result for node {}",
                    run.0,
                    render::one_line(&wanted.0)
                )
            }));
        };
        let code = exit_code(complete, std::slice::from_ref(row));
        let text = if json {
            to_json(row)?
        } else {
            node_text(&results, row)?
        };
        return Ok(Outcome { text, code });
    }

    let code = exit_code(complete, &results.nodes);
    let text = if json {
        to_json(&results)?
    } else {
        table(&results)
    };
    Ok(Outcome { text, code })
}

fn exit_code(complete: bool, rows: &[NodeResult]) -> i32 {
    if complete && rows.iter().all(|r| r.unresolved.is_none()) {
        EXIT_OK
    } else {
        EXIT_PRECONDITION
    }
}

/// The free text in a result — a node's failure and a CAS read fault — through the same redaction
/// `run status --json` gives a pause reason, for BOTH outputs. The OUTPUTS are already redacted
/// by `torii_core`.
fn redacted(mut r: RunResults) -> RunResults {
    for n in &mut r.nodes {
        n.error = n.error.as_deref().map(render::redact_reason);
        n.unresolved = n.unresolved.as_deref().map(render::redact_reason);
    }
    r
}

fn to_json<T: serde::Serialize>(v: &T) -> Result<String, CliError> {
    serde_json::to_string_pretty(v).map_err(|e| CliError::error(e.to_string()))
}

fn header(r: &RunResults) -> String {
    let mut s = format!("run {}: {}\n", r.run.0, r.status.as_str());
    if r.status != RunStatus::Completed {
        s.push_str("not completed: these are its outputs as of its last checkpoint\n");
    }
    if r.as_of.is_none() {
        s.push_str("no output checkpoint recorded yet\n");
    }
    s
}

fn state_str(s: NodeState) -> &'static str {
    match s {
        NodeState::Completed => "completed",
        NodeState::Failed => "failed",
        NodeState::Retrying => "retrying",
        NodeState::Skipped => "skipped",
    }
}

fn stored_cell(s: &Option<Stored>) -> String {
    match s {
        None => "—".to_string(),
        Some(Stored::Inline) => "inline".to_string(),
        Some(Stored::Cas { digest, size }) => {
            let short: String = digest.chars().take(DIGEST_SHOWN).collect();
            format!("cas {short} {size}B")
        }
    }
}

/// What a row says in place of (or about) its output. JSON-serialized outputs cannot carry a raw
/// control character — serde escapes them — and the error and fault text go through
/// [`render::safe_reason`] (redact, one line, capped), so no cell can forge a row.
fn output_cell(r: &NodeResult) -> String {
    if let Some(e) = &r.error {
        return format!("error: {}", render::safe_reason(e));
    }
    if let Some(e) = &r.unresolved {
        return format!("unresolved: {}", render::safe_reason(e));
    }
    match &r.output {
        Some(v) => render::cap_chars(&render::one_line(&v.to_string()), OUTPUT_CELL_MAX),
        None => "—".to_string(),
    }
}

fn table(r: &RunResults) -> String {
    let mut s = header(r);
    let nodes: Vec<String> = r
        .nodes
        .iter()
        .map(|n| render::one_line(&n.node.0))
        .collect();
    let stored: Vec<String> = r.nodes.iter().map(|n| stored_cell(&n.stored)).collect();
    let nw = nodes
        .iter()
        .map(|n| n.chars().count())
        .max()
        .unwrap_or(0)
        .max(4);
    let sw = stored
        .iter()
        .map(|c| c.chars().count())
        .max()
        .unwrap_or(0)
        .max(6);
    s.push_str(&format!(
        "{:<nw$}  {:<9}  {:<sw$}  OUTPUT\n",
        "NODE", "STATE", "STORED"
    ));
    for ((row, node), stored) in r.nodes.iter().zip(&nodes).zip(&stored) {
        s.push_str(&format!(
            "{node:<nw$}  {:<9}  {stored:<sw$}  {}\n",
            state_str(row.state),
            output_cell(row)
        ));
    }
    s
}

/// One node, whole: its row's facts, then the full output pretty-printed (serde escapes every
/// control character in it, so it is safe to put on a terminal uncapped).
fn node_text(r: &RunResults, row: &NodeResult) -> Result<String, CliError> {
    let mut s = header(r);
    s.push_str(&format!(
        "node {}  {}  {}\n",
        render::one_line(&row.node.0),
        state_str(row.state),
        stored_cell(&row.stored)
    ));
    if let Some(e) = &row.error {
        s.push_str(&format!("error: {}\n", render::safe_reason(e)));
    }
    if let Some(e) = &row.unresolved {
        s.push_str(&format!("unresolved: {}\n", render::safe_reason(e)));
    }
    if let Some(v) = &row.output {
        s.push_str(&to_json(v)?);
        s.push('\n');
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::{EXIT_OK, EXIT_PRECONDITION};
    use orchestrator_core::{ContentRef, EffectOutput, Graph, JournalEvent, RunStatus, Snapshot};
    use orchestrator_store::{InMemoryContentStore, InMemoryJournal, InMemorySchedulerStore};
    use serde_json::json;

    struct F {
        store: InMemorySchedulerStore,
        journal: InMemoryJournal,
        content: InMemoryContentStore,
        run: RunId,
    }

    fn n(id: &str) -> NodeId {
        NodeId(id.into())
    }

    async fn fixture(status: Option<RunStatus>, outputs: Vec<(NodeId, EffectOutput)>) -> F {
        let f = F {
            store: InMemorySchedulerStore::new(),
            journal: InMemoryJournal::new(),
            content: InMemoryContentStore::new(),
            run: RunId(uuid::Uuid::new_v4()),
        };
        f.store
            .enqueue(f.run, &Graph { nodes: vec![] }, chrono::Utc::now())
            .await
            .unwrap();
        match status {
            Some(RunStatus::Paused) => f.store.record_paused(f.run, None, "waiting").await.unwrap(),
            Some(s) => f.store.record_terminal(f.run, s, None).await.unwrap(),
            None => {}
        }
        f.journal
            .snapshot(
                f.run,
                Snapshot {
                    seq: 7,
                    completed: outputs.iter().map(|(id, _)| id.clone()).collect(),
                    outputs,
                    ..Snapshot::default()
                },
            )
            .await
            .unwrap();
        f
    }

    async fn ask(f: &F, run: RunId, node: Option<&str>, json: bool) -> Outcome {
        let node = node.map(n);
        results(&f.store, &f.journal, &f.content, run, node.as_ref(), json)
            .await
            .expect("results")
    }

    #[tokio::test]
    async fn an_unknown_run_is_not_found_in_text_and_null_in_json() {
        let f = fixture(Some(RunStatus::Completed), vec![]).await;
        let other = RunId(uuid::Uuid::new_v4());
        let text = ask(&f, other, None, false).await;
        assert_eq!(text.code, EXIT_PRECONDITION);
        assert_eq!(text.text, format!("no such run: {}", other.0));
        let json = ask(&f, other, None, true).await;
        assert_eq!(json.code, EXIT_PRECONDITION);
        assert_eq!(json.text, "null");
    }

    #[tokio::test]
    async fn a_completed_run_prints_one_row_per_node_and_exits_ok() {
        let f = fixture(
            Some(RunStatus::Completed),
            vec![(
                n("a"),
                EffectOutput::Inline(json!({ "decision": "approved" })),
            )],
        )
        .await;
        let out = ask(&f, f.run, None, false).await;
        assert_eq!(out.code, EXIT_OK, "{}", out.text);
        assert!(out.text.contains("completed"), "{}", out.text);
        assert!(
            out.text.lines().any(|l| l.starts_with("a ")
                && l.contains("inline")
                && l.contains(r#"{"decision":"approved"}"#)),
            "{}",
            out.text
        );
    }

    #[tokio::test]
    async fn a_run_that_has_not_completed_still_prints_its_outputs_at_exit_2() {
        let f = fixture(
            Some(RunStatus::Paused),
            vec![(n("a"), EffectOutput::Inline(json!("so far")))],
        )
        .await;
        let out = ask(&f, f.run, None, false).await;
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(
            out.text.contains("paused") && out.text.contains("so far"),
            "{}",
            out.text
        );
        let json = ask(&f, f.run, None, true).await;
        assert_eq!(json.code, EXIT_PRECONDITION);
        let v: serde_json::Value = serde_json::from_str(&json.text).unwrap();
        assert_eq!(v["status"], "paused");
        assert_eq!(v["nodes"][0]["output"], "so far");
    }

    #[tokio::test]
    async fn a_long_output_is_capped_to_one_line_in_the_table_and_whole_with_node() {
        let long = "word ".repeat(400);
        let f = fixture(
            Some(RunStatus::Completed),
            vec![(n("a"), EffectOutput::Inline(json!({ "text": long })))],
        )
        .await;
        let table = ask(&f, f.run, None, false).await;
        let row = table
            .text
            .lines()
            .find(|l| l.starts_with("a "))
            .expect("row");
        assert!(row.chars().count() < 300, "{row}");
        assert!(row.ends_with('…'), "{row}");
        let one = ask(&f, f.run, Some("a"), false).await;
        assert_eq!(one.code, EXIT_OK);
        assert!(one.text.contains(long.trim_end()), "{}", one.text);
    }

    #[tokio::test]
    async fn a_failed_nodes_error_is_redacted_and_kept_on_one_line() {
        let f = fixture(Some(RunStatus::Failed), vec![]).await;
        let secret = format!("sk-{}", "B".repeat(30));
        f.journal
            .append(
                f.run,
                JournalEvent::NodeFailed {
                    node: n("x"),
                    error: format!("provider said\n{secret}"),
                },
            )
            .await
            .unwrap();
        let table = ask(&f, f.run, None, false).await;
        assert!(!table.text.contains(&secret), "{}", table.text);
        let row = table
            .text
            .lines()
            .find(|l| l.starts_with("x "))
            .expect("row");
        assert!(
            row.contains("provider said") && row.contains("[REDACTED]"),
            "{row}"
        );
        let json = ask(&f, f.run, None, true).await;
        assert!(!json.text.contains(&secret), "{}", json.text);
    }

    #[tokio::test]
    async fn an_unresolvable_ref_is_reported_on_its_row_at_exit_2() {
        let f = fixture(
            Some(RunStatus::Completed),
            vec![(
                n("a"),
                EffectOutput::Ref(ContentRef {
                    digest: orchestrator_core::Digest("f".repeat(64)),
                    size: 5000,
                    summary: None,
                }),
            )],
        )
        .await;
        let out = ask(&f, f.run, None, false).await;
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        let row = out.text.lines().find(|l| l.starts_with("a ")).expect("row");
        assert!(row.contains("cas ") && row.contains("unresolved"), "{row}");
    }

    #[tokio::test]
    async fn node_names_one_node_and_an_unknown_node_is_not_found() {
        let f = fixture(
            Some(RunStatus::Completed),
            vec![
                (n("a"), EffectOutput::Inline(json!(1))),
                (n("b"), EffectOutput::Inline(json!(2))),
            ],
        )
        .await;
        let one = ask(&f, f.run, Some("b"), true).await;
        assert_eq!(one.code, EXIT_OK);
        let v: serde_json::Value = serde_json::from_str(&one.text).unwrap();
        assert_eq!(v["node"], "b");
        assert_eq!(v["output"], 2);
        let none = ask(&f, f.run, Some("zz"), false).await;
        assert_eq!(none.code, EXIT_PRECONDITION);
        assert!(none.text.contains("zz"), "{}", none.text);
        let none = ask(&f, f.run, Some("zz"), true).await;
        assert_eq!((none.code, none.text.as_str()), (EXIT_PRECONDITION, "null"));
    }
}
