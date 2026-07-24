# O1 · Request ledger, audit & SIEM

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Ops · **Status:** Planned · **Depends on:** C1, C4

## Purpose

A unified, trustworthy record of every call and every governance event — across both planes.

## What we build

- **Single request ledger** — the crate-native **`inference_calls`** table (the one authoritative ledger + budget source of truth; the duplicate `gateway_tasks` cost fields are **retired**), `service_role`-write-only, covering cloud calls and device-reported local calls; each row carries served model, route, **execution location**/`plane`, tokens, cost, outcome, and a **"why this model"** trace.
- **Immutable audit log** — `audit_events` (config changes, access, exports, sign-ins, policy/guardrail hits, redaction events) emitted by C4. **Integrity gate:** every INSERT binds **`actor_id = auth.uid()`** (or is **`service_role`-only**, gateway-emitted) so rows cannot be forged; append-only / immutable (no client UPDATE/DELETE).
- **Quality signals** (§3b) — explicit (ratings/edits/retries/corrections) + implicit (grounding score, LLM-judge score, latency, fallbacks, guardrail/redaction hits), keyed to `inference_calls`/`messages` — stream into this immutable ledger and roll up into analytics (O2).
- **SIEM streaming** connector; **CSV export**; filters/search and saved views.

## UI surfaces

- Requests & audit (W1), Activity (W2).

## Reuse / source

The single **`inference_calls`** ledger + trace from the six `sensei-*` engine crates (`v0.4.6`); `database/` `audit_events`; DECISIONS §2 (audit `actor_id` binding), §3 (one authoritative ledger — retire `gateway_tasks` cost fields), §3b (quality signals). Per-step `plane`/execution-location on the trace is a tracked gateway-repo enhancement.

## Open questions

- Retention windows per artifact; SIEM connector format (syslog/HTTP/vendor).
