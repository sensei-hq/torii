# C3 · Budgets, metering & reconciliation

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central · **Status:** Planned · **Depends on:** C1, F1

## Purpose

Enforce spend authoritatively so there are never surprise bills — cascading caps with automatic step-down and a free floor.

## Responsibilities

- Pre-call budget checks, per-call metering, cross-device reconciliation, alerts.

## What we build

- **Budget tree** (org→dept→team→user) with **caps, period (D/W/M), hard vs soft, alert thresholds, free-floor enablement** per node. A **`service_account` is its own leaf** (`kind='service'`) in the same tree. Budget tables are **`service_role`-write-only** (§2 W1); client-facing metering is read-only.
- **Budget binds to identity/node, never to credentials** (§2 W2). At execution the gateway resolves the authenticated caller (person or service account) → their budget node(s) → runs the cascade; **multiple `api_keys` for one identity share that identity's budget**, and which provider credential (BYOK key or OAuth account) fulfils the call is irrelevant to metering.
- **Hard reserve → commit** (§2 W2). The cascade — *every ancestor (user→team→dept→org) must have headroom* — and the `spent_amount` rollup are **enforced in the gateway/DB, not prose**. Nodes flagged **`hard`** get a **synchronous pre-call `reserve` → post-call `commit`** and cannot be exceeded even under concurrency; nodes flagged **`soft`** allow bounded overshoot + alert. Under pressure the crate's budget filter triggers **step-down**; at zero it drops to the **free floor** (local on desktop).
- **Metering** on the single authoritative **`inference_calls`** ledger (§3 — `service_role`-write; `gateway_tasks` cost duplication **retired**): actual cost/tokens → org→dept→team→user attribution columns → spend rollups. Same ledger backs O1/O2 analytics.
- **Reconciliation** of device-reported local/cloud usage into authoritative totals; push updated remaining via Realtime (D4). **Anti-spoof:** offline usage buffers are **signed + idempotent** (anti-replay / anti-under-report), and the C1 hot path runs a **per-request device-status check** so a revoked device with a live JWT cannot keep spending.
- **Increase requests** via `budget_requests` (member raises a request → approver grants), since clients cannot write budgets directly (§2 W1).

## Key contracts / data

- Budget node schema (caps/period/`hard|soft`/thresholds/free-floor, `kind` incl. `service`); `reserve`/`commit` against `inference_calls`; spend-query helpers (`get_spend_since` / `get_spend_by_model_since`) over the ledger; **signed** device usage-report payload; `budget_requests` (increase → approval).

## UI surfaces

- Organization (budget hierarchy) + Budgets & billing (W1); spend chips + Activity (W2). Member increase-request UI backed by `budget_requests`. (API keys carry **no** budget — §2 W2.)

## Reuse / source

The `sensei-*` engine (`v0.4.6` — `sensei-gateway`/`sensei-kernel`) budget filtering / step-down; `database/` budget tree; gap analysis §4 (hard/soft caps, alerts). Reserve→commit and the cascade/rollup are enforced **consumer-side in the C1 gateway + DB**, not inside the crate.

## Open questions

- ~~Soft vs synchronous hard caps per node~~ — **resolved (§2 W2):** `hard` = synchronous reserve→commit (no overshoot under concurrency); `soft` = bounded overshoot + alert; per-node flag.
- Billing/invoice integration (Stripe?) — Billing screen exists in mockups; **not ratified** in DECISIONS (internal metering is authoritative; external invoicing is outside the v1 decision record).
