//! AG-4 (torii#33): `torii run results <id>` — a run's node outputs.
//!
//! The data comes from `torii_core::results` (shared with the API); this module only renders it.

use crate::cmd::Outcome;
use crate::errors::CliError;
use orchestrator_core::{ContentStore, ExecutionJournal, NodeId, RunId, SchedulerStore};

pub async fn results(
    _store: &dyn SchedulerStore,
    _journal: &dyn ExecutionJournal,
    _content: &dyn ContentStore,
    _run: RunId,
    _node: Option<&NodeId>,
    _json: bool,
) -> Result<Outcome, CliError> {
    Ok(Outcome::ok(""))
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
