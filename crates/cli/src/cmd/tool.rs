//! `torii run tool approve|reject` — the operator surface for a confirm-before-run tool call
//! (AG-15).
//!
//! An agent whose definition lists a tool under `confirm_tools` does not run a call of it until
//! a human approves: the executor journals `ToolConfirmAwaited` (keyed by the CALL's
//! `effect_id`, carrying the redacted arguments and an absolute deadline) and pauses the run.
//! This appends the `ToolConfirmDecided` that answers it, then queues the wake — the same
//! append-THEN-`force_wake` order every other waiting verb keeps, for the same reason: a worker
//! in another process can claim the wake the instant it lands, and must fold a journal that
//! already holds the decision.
//!
//! **Keyed by the call, not the node.** One agent node can ask about several calls over its
//! life, so `--call <effect_id>` names the ask; `--node` is optional and, when given, must
//! agree with the node the call belongs to.
//!
//! **Who may approve is not decided here** (torii#47). `--as` is ATTRIBUTION, NOT
//! AUTHENTICATION, exactly as on `run gate`: it records who claimed to decide.

use crate::cmd::Outcome;
use crate::cmd::run::{Measured, SignalState, ToolConfirmState, check_payload_size};
use crate::errors::CliError;
use crate::render;
use chrono::{DateTime, Utc};
use orchestrator_core::{
    EffectId, ExecutionJournal, JournalEvent, NodeId, OrchestratorError, RunId, RunStatus,
    SchedulerStore,
};

/// The two verbs of `run tool`. They differ only in the decision they record, so they are
/// normalised by [`tool_decision_of`] into one [`ToolDecision`] and `dispatch` has exactly one
/// call to [`decide`] — the shape `run gate` adopted after swapping two literals in the binary
/// left every test green.
#[derive(clap::Subcommand)]
pub enum ToolAction {
    /// Approve one pending tool call — the tool then runs on the next worker tick
    Approve {
        run_id: String,
        /// The call's id (its `effect_id`) — `torii run list-paused` and `torii run status`
        /// show it on the `tool:` row.
        #[arg(long = "call", value_name = "EFFECT_ID")]
        call: String,
        /// The agent node the call belongs to. Optional; when given it must match.
        #[arg(long)]
        node: Option<String>,
        #[arg(long, default_value = "", hide_default_value = true, help = ACTOR_HELP)]
        r#as: String,
        /// Free text recorded with the decision, for the audit. It is NOT shown to the model.
        /// Max 4096 bytes as stored; secret-shaped text is redacted first.
        #[arg(long)]
        note: Option<String>,
    },
    /// Reject one pending tool call — the model is told `not_confirmed` and carries on
    Reject {
        run_id: String,
        /// The call's id (its `effect_id`) — `torii run list-paused` and `torii run status`
        /// show it on the `tool:` row.
        #[arg(long = "call", value_name = "EFFECT_ID")]
        call: String,
        /// The agent node the call belongs to. Optional; when given it must match.
        #[arg(long)]
        node: Option<String>,
        #[arg(long, default_value = "", hide_default_value = true, help = ACTOR_HELP)]
        r#as: String,
        /// Free text recorded with the decision, for the audit. It is NOT shown to the model.
        /// Max 4096 bytes as stored; secret-shaped text is redacted first.
        #[arg(long)]
        note: Option<String>,
    },
}

/// The `--as` help — the trust boundary, stated where the flag is typed.
const ACTOR_HELP: &str = "Who decided. ATTRIBUTION, NOT AUTHENTICATION: it is whatever \
                          string you supply (defaulting to $USER), so it records who \
                          CLAIMED to decide. Anyone who can reach the database can write \
                          any actor.";

/// One [`ToolAction`], normalised — still unparsed and unresolved.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDecision {
    pub run_id: String,
    pub call: String,
    pub node: Option<String>,
    pub approved: bool,
    /// Still RAW — [`crate::cmd::gate::actor_or_user`] resolves the `$USER` fallback.
    pub actor: String,
    pub note: Option<String>,
}

/// Normalise a verb into the one shape [`decide`] takes.
pub fn tool_decision_of(action: ToolAction) -> ToolDecision {
    let approved = matches!(action, ToolAction::Approve { .. });
    let (ToolAction::Approve {
        run_id,
        call,
        node,
        r#as,
        note,
    }
    | ToolAction::Reject {
        run_id,
        call,
        node,
        r#as,
        note,
    }) = action;
    ToolDecision {
        run_id,
        call,
        node,
        approved,
        actor: r#as,
        note,
    }
}

/// Scrub one operator-supplied string with the shared redactor before it is journaled —
/// fail-CLOSED on a non-string result, as `run gate` and `run agent answer` are.
fn redact(text: &str) -> String {
    render::redact_payload(&serde_json::json!(text))
        .as_str()
        .unwrap_or("[REDACTED]")
        .to_string()
}

/// Deliver a human's decision on one confirm-before-run tool call (AG-15).
///
/// **Validation is JOURNAL-ONLY and advisory**, like every waiting verb: the call's
/// `ToolConfirmAwaited` is the whole evidence a human was asked, and the executor re-checks
/// at fold time. It refuses, before anything is written, every state in which a decision
/// would not be read: no such ask, a `--node` that is not the call's, a call already decided
/// (the engine folds decisions LAST-wins, but a second one is a silent correction the operator
/// never sees land — this verb names the first instead), a call the executor already settled
/// (an expiry journals `not_confirmed` and NO decision), a terminated node, a passed deadline
/// (the executor refuses the call BEFORE it reads any decision, so a late approval could only
/// be reported here, never honoured) and a run that is not paused.
///
/// **Order: append, THEN `force_wake`**, and every fault after the append is REPORTED as a
/// durable-but-unqueued decision rather than `?`-ed — a bare store error reads as "it did not
/// go through" for a write that succeeded.
#[allow(clippy::too_many_arguments)]
pub async fn decide(
    store: &dyn SchedulerStore,
    journal: &dyn ExecutionJournal,
    run: RunId,
    call: &str,
    node: Option<NodeId>,
    approved: bool,
    actor: &str,
    note: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Outcome, CliError> {
    // ---- Pure, before any I/O --------------------------------------------------------
    let call = call.trim();
    if call.is_empty() {
        return Ok(Outcome::precondition(
            "not delivered: --call is empty. `torii run list-paused` shows each pending call's \
             id on its `tool:` row."
                .to_string(),
        ));
    }
    let shown = render::cap_chars(&render::one_line(call), 80);
    // Redacted BEFORE the size check: `[REDACTED]` is longer than the shortest span it
    // replaces, so the bytes bounded must be the bytes written.
    let note = note.map(str::trim).filter(|n| !n.is_empty()).map(redact);
    if let Some(n) = &note {
        check_payload_size(
            &serde_json::json!(n),
            Measured::AfterRedaction,
            "the decision note (--note)",
        )
        .map_err(CliError::error)?;
    }
    // Collapsed on the way IN (an escape smuggled through `--as` would be re-rendered by every
    // reader of the journal) and redacted like the note beside it on the same row.
    let one_lined = render::one_line(&crate::cmd::gate::actor_or_user(actor));
    let actor = redact(&one_lined);
    check_payload_size(
        &serde_json::json!(actor),
        Measured::AfterRedaction,
        "the decision's actor (--as)",
    )
    .map_err(CliError::error)?;

    let Some(before) = store.status(run).await? else {
        return Ok(Outcome::precondition(format!("no such run: {}", run.0)));
    };
    let events = journal
        .load(run)
        .await
        .map_err(OrchestratorError::Journal)?;

    let Some(ask) = crate::cmd::run::tool_confirm_asks(&events)
        .into_iter()
        .find(|a| a.effect_id.0 == call)
    else {
        return Ok(Outcome::precondition(format!(
            "not delivered: run {} has no tool call {shown} waiting for confirmation. \
             `torii run list-paused` shows each pending call's id on its `tool:` row.",
            run.0
        )));
    };
    let owner = render::cap_chars(&render::one_line(&ask.node.0), 80);
    if let Some(n) = &node
        && n != &ask.node
    {
        return Ok(Outcome::precondition(format!(
            "not delivered: call {shown} belongs to node {owner}, not {}. Drop --node, or \
             name {owner}.",
            render::cap_chars(&render::one_line(&n.0), 80)
        )));
    }
    match &ask.state {
        ToolConfirmState::Pending => {}
        ToolConfirmState::Decided {
            approved: was,
            actor: by,
        } => {
            return Ok(Outcome::precondition(format!(
                "not delivered: call {shown} was already {} by {} — its decision is on the \
                 journal and the next drive reads it. A second decision would be a silent \
                 correction; nothing was written.",
                if *was { "approved" } else { "rejected" },
                render::cap_chars(&render::one_line(by), 80)
            )));
        }
        ToolConfirmState::Recorded => {
            return Ok(Outcome::precondition(format!(
                "not delivered: call {shown} is already settled — the run recorded its outcome \
                 (an expired confirmation is refused to the model as `not_confirmed`), so \
                 nothing will ever read a decision for it."
            )));
        }
        ToolConfirmState::NodeTerminal(state) => {
            return Ok(Outcome::precondition(format!(
                "not delivered: call {shown}'s node {owner} {} — nothing will ever read a \
                 decision for it.",
                match state {
                    SignalState::Completed => "already completed".to_string(),
                    other => format!("is {}", other.as_str()),
                }
            )));
        }
    }
    if let Some(d) = ask.deadline
        && now >= d
    {
        return Ok(Outcome::precondition(format!(
            "not delivered: call {shown}'s confirmation deadline passed at {d} — the run \
             refuses an expired call before it reads any decision, so an approval now could \
             never run the tool. Nothing was written."
        )));
    }
    if before.status != RunStatus::Paused {
        return Ok(Outcome::precondition(
            if before.status == RunStatus::Waking {
                format!(
                    "not delivered: call {shown} is awaiting confirmation, but the run is waking — \
                 a worker holds the lease and is folding this journal right now. Retry once \
                 `torii run status {}` shows it paused.",
                    run.0
                )
            } else {
                format!(
                    "not delivered: call {shown} is awaiting confirmation, but the run is {} — a \
                 {} run is never paused again, so nothing will ever read a decision delivered \
                 to it.",
                    before.status.as_str(),
                    before.status.as_str()
                )
            },
        ));
    }

    let verdict = if approved { "approved" } else { "rejected" };
    let appended = journal
        .append(
            run,
            JournalEvent::ToolConfirmDecided {
                node: ask.node.clone(),
                effect_id: EffectId(call.to_string()),
                approved,
                actor: actor.clone(),
                note,
            },
        )
        .await
        .map_err(OrchestratorError::Journal)?;

    // Past here the decision is DURABLE: report, never `?`.
    let unread = |what: &str, e: &dyn std::fmt::Display| {
        let e = render::safe_reason(&e.to_string());
        Outcome::precondition(format!(
            "not queued: call {shown} is {verdict} and journaled durably (seq {appended}), but \
             {what} failed: {e}. Nothing has read it yet and the run is not queued to resume — \
             run `torii run wake {}` to drive it.",
            run.0
        ))
    };
    if let Err(e) = store.force_wake(run, now).await {
        return Ok(unread("the wake", &e));
    }
    let after = match store.status(run).await {
        Ok(Some(s)) => s,
        Ok(None) => return Ok(unread("the status re-read", &"the run vanished")),
        Err(e) => return Ok(unread("the status re-read", &e)),
    };
    let rewritten = if actor != one_lined {
        format!(" (--as contained secret-shaped text and was recorded as {actor})")
    } else {
        String::new()
    };
    // The effect achieved, read back: STATUS plus the pinned timestamp, exactly as `wake`
    // checks its own (a stale `next_wake` or an unrelated re-pause can each fake one alone).
    let queued = after.status == RunStatus::Paused
        && after.next_wake.is_some_and(|t| {
            let drift = if t >= now { t - now } else { now - t };
            drift <= chrono::Duration::microseconds(2)
        });
    if queued {
        return Ok(Outcome::ok(format!(
            "{verdict}: call {shown} on node {owner} (the run will resume on the next worker \
             tick){rewritten}"
        )));
    }
    // Not queued: a worker may already have claimed the run and folded the decision. The
    // journal ORDER says which — an outcome recorded for this call AFTER our row was read
    // with the decision on the journal.
    let after_events = match journal.load(run).await {
        Ok(evs) => evs,
        Err(e) => return Ok(unread("the journal re-read", &e)),
    };
    let settled_after = after_events.iter().any(|(seq, e)| {
        *seq > appended
            && matches!(e, JournalEvent::EffectRecorded { effect_id, .. } if effect_id.0 == call)
    });
    Ok(if settled_after {
        Outcome::ok(format!(
            "{verdict}: call {shown} on node {owner} (a drive already in flight settled the \
             call after the decision landed){rewritten}"
        ))
    } else if after.status.is_terminal() {
        Outcome::precondition(format!(
            "not read: call {shown}'s decision is journaled durably, but the run is {} — \
             nothing will ever read it.",
            after.status.as_str()
        ))
    } else {
        Outcome::precondition(format!(
            "not queued: call {shown}'s decision is journaled durably, but the run is {} and \
             the wake did not apply. Run `torii run wake {}` once it is paused again.",
            after.status.as_str(),
            run.0
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cmd::run::tests::{
        FailingForceWakeStore, append_tool_confirm, now, paused_store, tool_confirm_journal,
    };
    use crate::errors::{EXIT_OK, EXIT_PRECONDITION};
    use orchestrator_core::{
        EffectClass, EffectId, EffectOutput, Graph, JournalEvent, RunStatus, Seq,
    };
    use orchestrator_store::{InMemoryJournal, InMemorySchedulerStore};

    const CALL: &str = "deployer#t1#1";

    fn deployer() -> NodeId {
        NodeId("deployer".into())
    }

    fn decisions(events: &[(Seq, JournalEvent)]) -> Vec<JournalEvent> {
        events
            .iter()
            .filter(|(_, e)| matches!(e, JournalEvent::ToolConfirmDecided { .. }))
            .map(|(_, e)| e.clone())
            .collect()
    }

    async fn decided_rows(j: &InMemoryJournal, run: RunId) -> Vec<JournalEvent> {
        decisions(&j.load(run).await.unwrap())
    }

    /// A paused run with one pending call whose deadline is an hour out.
    async fn pending(run: RunId) -> (InMemorySchedulerStore, InMemoryJournal) {
        let deadline = now() + chrono::Duration::hours(1);
        (
            paused_store(run, Some(deadline)).await,
            tool_confirm_journal(run, Some(deadline)).await,
        )
    }

    fn approve(run: RunId) -> ToolAction {
        ToolAction::Approve {
            run_id: run.0.to_string(),
            call: CALL.into(),
            node: None,
            r#as: "alice".into(),
            note: None,
        }
    }

    #[test]
    fn each_verb_maps_to_the_decision_that_names_it() {
        let run = RunId(uuid::Uuid::new_v4());
        assert!(tool_decision_of(approve(run)).approved);
        let rejected = tool_decision_of(ToolAction::Reject {
            run_id: run.0.to_string(),
            call: CALL.into(),
            node: Some("deployer".into()),
            r#as: "bob".into(),
            note: Some("not today".into()),
        });
        assert_eq!(
            rejected,
            ToolDecision {
                run_id: run.0.to_string(),
                call: CALL.into(),
                node: Some("deployer".into()),
                approved: false,
                actor: "bob".into(),
                note: Some("not today".into()),
            }
        );
    }

    #[tokio::test]
    async fn an_approval_is_journaled_then_the_wake_is_queued() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;

        let out = decide(&s, &j, run, CALL, None, true, "alice", None, now())
            .await
            .expect("decides");
        assert_eq!(out.code, EXIT_OK, "{}", out.text);
        assert!(
            out.text.contains("approved") && out.text.contains(CALL),
            "{}",
            out.text
        );
        match decided_rows(&j, run).await.as_slice() {
            [
                JournalEvent::ToolConfirmDecided {
                    node,
                    effect_id,
                    approved: true,
                    actor,
                    note: None,
                },
            ] => {
                assert_eq!(node, &deployer());
                assert_eq!(effect_id, &EffectId(CALL.into()));
                assert_eq!(actor, "alice");
            }
            other => panic!("exactly one approval expected: {other:?}"),
        }
        let after = s.status(run).await.unwrap().unwrap();
        assert_eq!(
            (after.status, after.next_wake),
            (RunStatus::Paused, Some(now())),
            "queued for the next tick"
        );
    }

    #[tokio::test]
    async fn a_rejection_records_its_note_redacted_and_the_named_node_must_match() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;
        let secret = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

        let wrong = decide(
            &s,
            &j,
            run,
            CALL,
            Some(NodeId("other".into())),
            false,
            "bob",
            None,
            now(),
        )
        .await
        .expect("a refusal");
        assert_eq!(wrong.code, EXIT_PRECONDITION, "{}", wrong.text);
        assert!(
            wrong.text.contains("deployer"),
            "names the real node: {}",
            wrong.text
        );
        assert!(decided_rows(&j, run).await.is_empty());

        let out = decide(
            &s,
            &j,
            run,
            CALL,
            Some(deployer()),
            false,
            "bob",
            Some(&format!("leaked {secret} here")),
            now(),
        )
        .await
        .expect("decides");
        assert_eq!(out.code, EXIT_OK, "{}", out.text);
        assert!(out.text.contains("rejected"), "{}", out.text);
        match decided_rows(&j, run).await.as_slice() {
            [
                JournalEvent::ToolConfirmDecided {
                    approved: false,
                    note: Some(note),
                    actor,
                    ..
                },
            ] => {
                assert!(!note.contains(secret), "{note}");
                assert!(note.contains("[REDACTED]"), "{note}");
                assert_eq!(actor, "bob");
            }
            other => panic!("one rejection expected: {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_call_nobody_asked_about_is_refused_and_nothing_is_written() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;
        let out = decide(&s, &j, run, "nope", None, true, "alice", None, now())
            .await
            .expect("a refusal");
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(
            out.text.contains("list-paused"),
            "points at where the pending calls are listed: {}",
            out.text
        );
        assert!(decided_rows(&j, run).await.is_empty());
        let out = decide(&s, &j, run, "  ", None, true, "alice", None, now())
            .await
            .expect("a refusal");
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(decided_rows(&j, run).await.is_empty());
    }

    /// The engine folds decisions LAST-wins, but once one is on the journal a second is at
    /// best a silent correction an operator cannot see land; this verb refuses it, naming
    /// what was decided and by whom.
    #[tokio::test]
    async fn a_call_already_decided_is_refused_naming_the_decision() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;
        decide(&s, &j, run, CALL, None, true, "alice", None, now())
            .await
            .unwrap();
        let s = paused_store(run, Some(now() + chrono::Duration::hours(1))).await;

        let out = decide(&s, &j, run, CALL, None, false, "bob", None, now())
            .await
            .expect("a refusal");
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(
            out.text.contains("already approved") && out.text.contains("alice"),
            "{}",
            out.text
        );
        assert_eq!(decided_rows(&j, run).await.len(), 1, "nothing new written");
    }

    #[tokio::test]
    async fn a_settled_or_expired_call_is_refused() {
        let cases: Vec<(&str, JournalEvent, &str)> = vec![
            (
                "the executor recorded its outcome",
                JournalEvent::EffectRecorded {
                    node: deployer(),
                    effect_id: EffectId(CALL.into()),
                    class: EffectClass::Pure,
                    input_hash: "h".into(),
                    seq: 0,
                    output: EffectOutput::Inline(serde_json::json!({"error":"not_confirmed"})),
                    observation: None,
                    usage: None,
                },
                "already settled",
            ),
            (
                "the node failed",
                JournalEvent::NodeFailed {
                    node: deployer(),
                    error: "boom".into(),
                },
                "failed",
            ),
        ];
        for (why, e, says) in cases {
            let run = RunId(uuid::Uuid::new_v4());
            let (s, j) = pending(run).await;
            j.append(run, e).await.unwrap();
            let out = decide(&s, &j, run, CALL, None, true, "alice", None, now())
                .await
                .expect("a refusal");
            assert_eq!(out.code, EXIT_PRECONDITION, "{why}: {}", out.text);
            assert!(out.text.contains(says), "{why}: {}", out.text);
            assert!(decided_rows(&j, run).await.is_empty(), "{why}");
        }

        // Past the deadline the executor refuses the call BEFORE reading any decision, so an
        // approval could only be reported here and never honoured.
        let run = RunId(uuid::Uuid::new_v4());
        let s = paused_store(run, Some(now())).await;
        let j = tool_confirm_journal(run, Some(now() - chrono::Duration::seconds(1))).await;
        let out = decide(&s, &j, run, CALL, None, true, "alice", None, now())
            .await
            .expect("a refusal");
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(out.text.contains("deadline"), "{}", out.text);
        assert!(decided_rows(&j, run).await.is_empty());
    }

    #[tokio::test]
    async fn a_run_that_is_not_paused_is_refused_with_the_right_advice() {
        let run = RunId(uuid::Uuid::new_v4());
        let j = tool_confirm_journal(run, None).await;

        let unknown = InMemorySchedulerStore::default();
        let out = decide(&unknown, &j, run, CALL, None, true, "a", None, now())
            .await
            .unwrap();
        assert_eq!(out.code, EXIT_PRECONDITION);
        assert!(out.text.contains("no such run"), "{}", out.text);

        let waking = InMemorySchedulerStore::default();
        waking
            .enqueue(run, &Graph { nodes: vec![] }, now())
            .await
            .unwrap();
        let out = decide(&waking, &j, run, CALL, None, true, "a", None, now())
            .await
            .unwrap();
        assert_eq!(out.code, EXIT_PRECONDITION);
        assert!(
            out.text.contains("waking") && out.text.contains("Retry"),
            "{}",
            out.text
        );

        let cancelled = paused_store(run, None).await;
        cancelled.cancel(run).await.unwrap();
        let out = decide(&cancelled, &j, run, CALL, None, true, "a", None, now())
            .await
            .unwrap();
        assert_eq!(out.code, EXIT_PRECONDITION);
        assert!(
            out.text.contains("cancelled") && !out.text.contains("Retry"),
            "{}",
            out.text
        );
        assert!(decided_rows(&j, run).await.is_empty());
    }

    /// The decision lands BEFORE `force_wake` is called, and a wake fault after it is reported
    /// as a durable-but-unqueued decision — never as "it did not go through".
    #[tokio::test]
    async fn the_decision_is_appended_before_force_wake_and_a_wake_fault_says_so() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;
        let s = FailingForceWakeStore(s);

        let out = decide(&s, &j, run, CALL, None, true, "alice", None, now())
            .await
            .expect("reported, not an error");
        assert_eq!(out.code, EXIT_PRECONDITION, "{}", out.text);
        assert!(
            out.text.contains("journaled durably") && out.text.contains("torii run wake"),
            "{}",
            out.text
        );
        assert_eq!(decided_rows(&j, run).await.len(), 1);
    }

    #[tokio::test]
    async fn a_hostile_or_oversized_actor_or_note_is_contained() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;

        let huge = "x".repeat(orchestrator_core::MAX_HUMAN_TEXT_BYTES + 1);
        for (actor, note) in [("alice", Some(huge.as_str())), (huge.as_str(), None)] {
            let r = decide(&s, &j, run, CALL, None, true, actor, note, now()).await;
            assert!(r.is_err(), "an over-limit field is invalid input");
            assert!(decided_rows(&j, run).await.is_empty());
        }

        let out = decide(
            &s,
            &j,
            run,
            CALL,
            None,
            true,
            "eve\n\u{1b}[2Jroot",
            None,
            now(),
        )
        .await
        .expect("decides");
        assert_eq!(out.code, EXIT_OK, "{}", out.text);
        match decided_rows(&j, run).await.as_slice() {
            [JournalEvent::ToolConfirmDecided { actor, .. }] => {
                assert!(
                    !actor.contains('\n') && !actor.contains('\u{1b}'),
                    "{actor:?}"
                );
            }
            other => panic!("{other:?}"),
        }
    }

    /// Two pending calls on one node: deciding one leaves the other pending.
    #[tokio::test]
    async fn deciding_one_call_leaves_the_nodes_other_call_pending() {
        let run = RunId(uuid::Uuid::new_v4());
        let (s, j) = pending(run).await;
        append_tool_confirm(&j, run, "deployer#t1#2", "rollback", "{}", None).await;

        decide(&s, &j, run, CALL, None, true, "alice", None, now())
            .await
            .unwrap();
        let listed = crate::cmd::run::list_paused(&s, &j, false).await.unwrap();
        let (_, block) = listed.text.split_once("AWAITING").expect("still awaiting");
        assert!(
            block.contains("deployer#t1#2") && !block.contains(CALL),
            "{block}"
        );
    }
}
