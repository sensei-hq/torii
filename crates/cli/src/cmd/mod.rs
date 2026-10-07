//! Command implementations. Each returns an `Outcome` rather than printing, so
//! every command is unit-testable without capturing stdout.

pub mod config;
pub mod gate;
pub mod human;
pub mod results;
pub mod run;
pub mod tool;
pub mod worker;

/// What a command produced: the operator-facing text and the process exit code.
#[derive(Debug, PartialEq)]
pub struct Outcome {
    pub text: String,
    pub code: i32,
}

/// The report an answering verb (`run signal`, `run gate decide`, `run agent answer`, `run tool
/// approve|reject`) gives when a RE-READ faults after its `force_wake` committed.
///
/// By then the answer is durable AND the wake was sent, so the run may well be queued — or
/// already claimed and driven. "Not queued — run `torii run wake`" would be false on both
/// counts, and a bare error would read as "it did not go through". So: say the wake was sent,
/// say what is durable (`durable`, e.g. "x's answer is journaled durably (seq 4)"), and point at
/// `torii run status` for the outcome — the shape `run wake` uses for its own re-read fault.
///
/// `e` is FREE TEXT FROM THE DRIVER (a pool timeout carries the connection string), so it goes
/// through `render::safe_reason` here, once, for every caller.
pub(crate) fn wake_sent_unread(
    durable: &str,
    run: orchestrator_core::RunId,
    what: &str,
    e: &dyn std::fmt::Display,
) -> Outcome {
    let e = crate::render::safe_reason(&e.to_string());
    Outcome::precondition(format!(
        "wake sent: {durable}, and the wake was requested, but {what} failed: {e}. Whether it \
         applied — and whether anything has read it — could not be read back; check `torii run \
         status {}` before waking again.",
        run.0
    ))
}

impl Outcome {
    pub fn ok(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            code: crate::errors::EXIT_OK,
        }
    }
    /// A command that ran fine but whose precondition was not met (nothing to
    /// cancel, nothing to wake, no such run).
    pub fn precondition(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            code: crate::errors::EXIT_PRECONDITION,
        }
    }
}
