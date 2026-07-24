# O1 · Request ledger, audit & SIEM — Spec

**Module:** [O1](../modules/O1-ledger-audit.md) · **Plane:** Ops · **Status:** Planned — build-ready
**Depends on:** [F1](../specs/F1-data-model.md) (schema — owns the DDL), [F2](../modules/F2-identity-auth-rbac.md) (capabilities/JWT), [C1](../specs/C1-gateway-service.md) (hot-path writer of the ledger + `GatewayStore`), [C4](../modules/C4-governance-runtime.md) (audit/redaction/policy-hit emission), and reads events from [C3](../specs/C3-budgets-metering.md) (budget/alert events, `notification_channels`) + [C6](../specs/C6-quality-signals.md) (quality signals)
**Enables:** [O2](../modules/O2-analytics.md) (analytics reads the same ledger + signals), [O3](../modules/O3-device-fleet.md) (device/exec-location columns), [W1](../modules/W1-admin-portal.md) (Requests & audit, Overview), [W2](../modules/W2-member-console.md) (Activity, member spend)
**Date:** 2026-07-23 · **Engine:** `sensei-*` crates @ `v0.4.6` · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §2 (audit `actor_id` binding), §3 (one authoritative ledger), §3b (quality signals)

---

> **Premise (DECISIONS §2 + §3).** *There is exactly one trustworthy record of what happened, and it cannot be forged or quietly erased.* Every call lands in the single `service_role`-only **`inference_calls`** ledger; every governance/access/config event lands in an **append-only, actor-bound `audit_events`** log. O1 owns the **read/export/retention/SIEM surface** over both, across **both planes** (`execution_location = local|cloud`). It writes no inference and enforces no policy — it captures, protects, streams, and serves the record.

---

## 1. Purpose & scope

O1 turns the raw runtime record into a **unified, tamper-evident, exportable, streamable audit surface** spanning cloud (C1) and device-local (D4/C3-reconciled) activity. It owns:

- the **unified request ledger read/export surface** over the single `service_role`-only **`inference_calls`** table (C1 is the sole *writer*; O1 owns the *cross-plane read/filter/export/retention* contract) — served model, route, `execution_location`/`plane`, tokens, cost, outcome, and the "why this model" trace link;
- the **immutable audit log** (`audit_events`) — config changes, access/sign-ins, exports, privileged writes, policy/guardrail hits, redaction events, device revocations, budget events — **append-only** (no UPDATE/DELETE by any role), with `actor_id` bound to `auth.uid()` or gateway-emitted as `service_role`/system;
- **quality-signal fan-out into the audit stream** — every `quality_signals` row (C6) is an audit-eligible event on the immutable ledger;
- **SIEM streaming** — a durable, at-least-once, per-tenant-ordered connector that ships audit events to an external SIEM (wire format is a per-sink operator choice — see §8 D4/§10);
- **export** — CSV/JSON export of ledger + audit with filters/search and saved views (the export is itself audited);
- **retention** — per-artifact retention windows + legal hold + DSR (data-subject) erase, reconciled against the immutability guarantee.

**In scope:** the `audit_events` DDL + the append-only/actor-binding/tamper-evidence guarantees; the `AuditSink` emission contract every emitting module calls; the SIEM connector abstraction + streaming state; retention/legal-hold/DSR-erase enforcement; the read/filter/export endpoints backing W1 Requests & audit and W2 Activity; the retention + SIEM config RPCs.

**Out of scope (owned elsewhere, consumed here):** the `inference_calls` DDL + its sole-writer role (C1); the budget cascade + `alert_events`/`notification_channels` DDL (C3 — O1 reuses `notification_channels` kind `siem` as a SIEM destination and consumes budget events); the quality-signal *contract* (C6 owns `SignalKey`/units; O1 receives signals via the same fan-out); the analytics rollup math + dashboards (O2); the guardrail/redaction *enforcement* that produces policy/redaction events (C4); the device-status hot-path check (C1) and device fleet UI (O3); the capability vocabulary (F2).

---

## 2. Responsibilities

1. **Own the audit log** — author `audit_events` DDL, guarantee it is **append-only** (UPDATE/DELETE denied to *every* role, including `service_role`, by trigger — not just grants) and **actor-bound** (`actor_id = auth.uid()` for client-emitted, `service_role`/system for gateway-emitted), so no row can be forged or mutated.
2. **Provide the single emission path** — the `AuditSink` trait (service-role) that C1 (privileged writes), C3 (budget events), C4 (policy/guardrail/redaction/classification hits, access, config, exports), and O3 (device revoke) all call; a privileged write and its audit row commit in the **same DB transaction** so no privileged action is unaudited.
3. **Present the unified request ledger** — a cross-plane read/filter/export surface over C1-written `inference_calls` + `execution_traces` (cloud + device-reconciled local rows), with `execution_location`, device, cost, outcome, and the "why this model" trace resolvable per row.
4. **Fan quality signals into the ledger** — accept each `quality_signals` row (C6 fan-out) as an audit-eligible event and stream it with the rest.
5. **Stream to SIEM** — a durable, at-least-once, per-tenant-ordered streamer that reads `audit_events` by a monotonic cursor and ships to configured sinks; retry + dead-letter on sink outage; resume from cursor after restart; wire format per-sink (§8 D4).
6. **Export** — capability-gated CSV/JSON export of filtered ledger/audit rows and saved views; the export action is itself an audit event.
7. **Enforce retention** — per-artifact retention windows (`retention_policies`), a scheduled purge that honors **legal hold** and preserves the audit-immutability chain, and **DSR erase** via crypto-shred / field-redaction-in-place (never a hard delete of audit rows).
8. **Guarantee integrity** — tamper-evidence over `audit_events` (per-tenant hash chain) so any post-hoc mutation of the underlying storage is detectable; RLS tenant isolation on all read/export paths.

Non-responsibilities: O1 does **not** meter/enforce budgets (C3), route (C2), redact/enforce policy (C4), define the signal taxonomy (C6), or compute analytics rollups (O2). It captures and protects the record and serves reads/exports/streams.

---

## 3. Data model (F1 tables owned / used)

O1 is the **DDL author + behavioral owner** of the audit + retention + SIEM tables; F1 (`../plans/F1-rework-plan.md`) carries the DDL in the rework cut. It is a **reader** of the ledger, traces, signals, and alert tables owned elsewhere. Any column O1 needs that the built schema lacks is listed as a **required F1 delta**, coordinated into the F1 rework — not invented ad hoc.

### 3.1 Owned — `audit.audit_events` (new; append-only, immutable)

One row per governance/access/config/policy event. `service_role`-write via `AuditSink`; **no UPDATE/DELETE by any role** (DB trigger raises); tenant-scoped SELECT under RLS gated by `audit.read`.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | `uuid` NOT NULL | RLS key; composite FK `core.tenants`. |
| `id` | `uuid` PK | PK `(tenant_id, id)`, `gen_random_uuid()`. |
| `seq` | `bigint` | Per-tenant monotonic sequence (`identity`/sequence) — the SIEM cursor + hash-chain order. |
| `category` | `text` NOT NULL | Fixed versioned enum: `access` \| `config_change` \| `privileged_write` \| `policy_hit` \| `redaction` \| `classification` \| `budget` \| `device` \| `export` \| `retention` \| `siem` \| `quality_signal`. CHECK. |
| `action` | `text` NOT NULL | Verb slug within the category (e.g. `role.assign`, `budget.approve`, `space.declassify-doc`, `signin`, `key.rotate`, `redaction.hit`). |
| `outcome` | `text` NOT NULL | `success` \| `denied` \| `error`. CHECK. |
| `severity` | `text` NOT NULL DEFAULT `info` | `info` \| `notice` \| `warning` \| `critical`. CHECK. |
| `actor_id` | `uuid` NULL | The submitting person (`auth.uid()`-bound on client-facing paths) **or** NULL for gateway/system emission. |
| `actor_kind` | `text` NOT NULL | `user` \| `service_account` \| `system`. CHECK. |
| `resource_type` | `text` NULL | Affected entity kind (`budget_node`, `role`, `router_credential`, `document`, `space`, `feature_state`, `api_key`, `device`, …). |
| `resource_id` | `uuid` NULL | Affected entity id (tenant-scoped). |
| `space_id` | `uuid` NULL | Space scope, where applicable. |
| `execution_location` | `text` NULL | `local` \| `cloud` (for call-linked events; GH-1). |
| `correlation` | `jsonb` NULL | Links: `{ inference_call_id?, trace_id?, hold_id?, request_id? }` — resolves an audit row to its ledger row / "why this model" trace. |
| `source_module` | `text` NOT NULL | `C1` \| `C3` \| `C4` \| `O1` \| `O3` (provenance of the emit). |
| `payload` | `jsonb` NOT NULL DEFAULT `'{}'` | **W5-clean** structured detail (before/after diff for config, hit counts by detector, export filter, etc.). MUST NOT hold raw secret/PII — counts / one-way placeholders / detector labels only. |
| `prev_hash` | `bytea` NULL | Hash of the previous row in this tenant's chain (tamper-evidence). |
| `row_hash` | `bytea` NOT NULL | `sha256(prev_hash ‖ canonical(row-without-hash))` — chain link. |
| `occurred_at` | `timestamptz` NOT NULL | When the event happened (emitter clock). |
| `recorded_at` | `timestamptz` NOT NULL DEFAULT `now()` | DB insert time. |

Indexes: `(tenant_id, seq)`, `(tenant_id, category, occurred_at)`, `(tenant_id, actor_id, occurred_at)`, `(tenant_id, resource_type, resource_id)`, GIN on `payload`/`correlation` for search. Retention: §3.5.

**Required F1 deltas (O1-driven):** the trigger enforcing append-only (raise on UPDATE/DELETE for all roles); the per-tenant `seq` allocation (sequence or `generated`); the `prev_hash`/`row_hash` maintenance in the insert path (a `BEFORE INSERT` trigger that reads the last row's `row_hash` under a per-tenant advisory lock so the chain stays ordered under concurrent inserts).

### 3.2 Owned — `audit.retention_policies` (new)

Per-artifact retention windows; drives the purge job (§6.7).

`tenant_id, id, artifact ∈ {audit_events, inference_calls, execution_traces, quality_signals}, window_days int NOT NULL, min_severity_kept text NULL (audit only — never purge ≥ this severity), legal_hold_default bool, updated_by, updated_at`. Tenant-scoped SELECT; `service_role`-write via the `PUT /v1/retention/policies` path (capability `governance.manage`). Seed defaults: `audit_events` 400d, `inference_calls` 400d, `execution_traces` 90d, `quality_signals` **co-terminous with subject** (matches C6 §3.4 — not a day-window).

### 3.3 Owned — `audit.legal_holds` (new)

Blocks purge for a scope. `tenant_id, id, scope ∈ {tenant, space, subject, actor}, scope_ref uuid NULL, reason text, placed_by, placed_at, released_by NULL, released_at NULL`. Active holds exclude matching rows from every purge. `service_role`-write (`governance.manage`); tenant-scoped SELECT.

### 3.4 Owned — SIEM config + stream state (new)

- **SIEM destinations reuse C3's `notification_channels`** where `kind='siem'` (C3 owns that DDL; O1 consumes it) — `config jsonb` carries endpoint/auth-ref/`format`. O1 does **not** duplicate a destination table.
- **`audit.siem_stream_state` (owned, new)** — one row per (tenant, channel): `tenant_id, channel_id, last_seq bigint, last_shipped_at, status ∈ {active,paused,dead_letter}, retry_count, updated_at`. The cursor that makes streaming resumable + at-least-once. `service_role`-only (no client read/write).
- **`audit.siem_dead_letter` (owned, new)** — batches that exhausted retries: `tenant_id, id, channel_id, from_seq, to_seq, payload jsonb, error text, created_at`. `service_role`-only; drained by a redrive job.

### 3.5 Used (read; owned elsewhere)

- **`public.inference_calls`** — the single `service_role`-only ledger (C1 writes via `GatewayStore`; GH-5 shape). O1 reads served model / route / `execution_location` / tokens / `cost_usd` / outcome / node attribution / trace link for the Requests surface + export. **O1 never writes it.**
- **`public.execution_traces`** — the per-call `ExecutionTrace` (attempts, fallbacks, per-step `plane`/execution-location once GH-1 lands) resolving the "why this model" trace behind a ledger row.
- **`public.quality_signals`** (C6) — streamed into the audit fan-out; also joinable for the Requests trace panel (grounding/judge/redaction-hit counts).
- **`public.alert_events` / `alert_rules` / `notification_channels`** (C3) — budget/outage/policy alert events consumed into the audit stream; `notification_channels` (kind `siem`) is the SIEM destination registry.
- **`public.devices`** (O3) — device id / last-seen / status for the device column + local-call attribution.
- **`spaces` / `conversations` / `messages`, `roles`/`role_permissions`/`profile_roles`** — join/filter targets + capability resolution for read authz.

> **One ledger (DECISIONS §3).** O1 adds **no** parallel request/cost table. `gateway_tasks` cost/metering fields are retired; `inference_calls` is the single request record. O1's contribution is the cross-plane *read/export/retention/SIEM* surface over it, plus the separate immutable `audit_events` log.

---

## 4. Contracts

C6-style split: (a) a Rust `AuditSink` every emitting module calls; (b) a `SiemConnector` abstraction with per-format impls; (c) C1 read endpoints for the Requests & audit / Activity surfaces + export; (d) C1 domain RPCs for SIEM/retention/legal-hold/DSR config.

### 4.1 Rust — the audit emission sink (service-role; the single INSERT path)

```rust
/// The ONLY writer of audit_events. Lives in services/gateway; backed by the DB
/// insert path that maintains seq + the hash chain. Called by C1/C3/C4/O3.
#[async_trait]
pub trait AuditSink: Send + Sync {
    /// Emit one event. When called inside a privileged-write DB tx, it MUST share
    /// that tx (same connection) so the write + its audit row commit atomically.
    async fn emit(&self, ev: AuditEvent) -> Result<Uuid, AuditError>;
    /// Async / batched emission (e.g. quality-signal fan-out, alert events).
    async fn emit_batch(&self, evs: Vec<AuditEvent>) -> Result<(), AuditError>;
}

pub struct AuditEvent {
    pub tenant_id: Uuid,
    pub actor: Actor,                 // Person(uuid) | Service(uuid) | System
    pub category: AuditCategory,      // Access | ConfigChange | PrivilegedWrite | PolicyHit
                                      // | Redaction | Classification | Budget | Device
                                      // | Export | Retention | Siem | QualitySignal
    pub action: String,               // verb slug, e.g. "role.assign", "redaction.hit"
    pub outcome: Outcome,             // Success | Denied | Error
    pub severity: Severity,           // Info | Notice | Warning | Critical
    pub resource: Option<ResourceRef>,// { type, id }
    pub space_id: Option<Uuid>,
    pub execution_location: Option<ExecLocation>, // Local | Cloud (GH-1)
    pub correlation: Correlation,     // { inference_call_id?, trace_id?, hold_id?, request_id? }
    pub source_module: SourceModule,
    pub payload: serde_json::Value,   // MUST be W5-clean (counts/labels/placeholders only)
    pub occurred_at: DateTime<Utc>,
}
pub enum Actor { Person(Uuid), Service(Uuid), System }
```

- `emit` asserts the payload is **W5-clean** (rejects a payload with a detectable raw secret/PII) before insert — the same gate C6's `QualitySignalSink` applies. A rejected payload is itself logged as an `Error`-outcome `redaction`-category meta-event (no raw content).
- The hash chain (`prev_hash`/`row_hash`) + per-tenant `seq` are assigned in the insert path under a per-tenant advisory lock; callers do not set them.

### 4.2 Rust — the SIEM connector abstraction

```rust
/// One shipper per configured sink. Wire format is per-sink operator config (§8 D4).
#[async_trait]
pub trait SiemConnector: Send + Sync {
    fn format(&self) -> SiemFormat;  // JsonHttps | SyslogRfc5424 | Cef | Leef | SplunkHec | Otlp
    /// Ship an ordered batch; return the last seq durably accepted by the sink.
    async fn ship(&self, tenant: Uuid, batch: &[AuditEvent]) -> Result<u64 /*last_seq*/, SiemError>;
    async fn health(&self) -> SinkHealth;
}
```

The **streamer** (a background task in `services/gateway`, or a scheduled worker) reads `audit_events WHERE tenant_id=? AND seq > siem_stream_state.last_seq ORDER BY seq`, batches, calls `ship`, advances `last_seq` on success; on repeated failure it marks the sink `dead_letter` and parks the batch in `siem_dead_letter`. **At-least-once, per-tenant-ordered** (the receiver dedups on `(tenant_id, seq)`).

### 4.3 HTTP — read + export surfaces (auth: JWT or API key; capability-gated)

Served by C1 (the HTTP authority); RLS-scoped; require an F2-owned read capability.

| Method + path | Capability | Purpose |
|---|---|---|
| `GET /v1/requests` | `audit.read` (or tenant member for own rows) | Unified request ledger: filter by space / model / outcome / `execution_location` / device / date; columns include exec-location + device + cost + outcome + `trace_id`. Backs W1 Requests + W2 Activity. |
| `GET /v1/requests/{id}/trace` | `audit.read` | Resolves the `execution_traces` "why this model" trace (attempts, fallbacks, per-step plane) + linked `quality_signals` for one ledger row. |
| `GET /v1/audit` | `audit.read` | Immutable audit log: filter by category / actor / resource / action / severity / date; full-text over `payload`; saved views. |
| `POST /v1/exports` | `audit.export` | Create a filtered CSV/JSON export of ledger or audit; returns a job id; the export request is itself an `export`-category audit event (actor-bound). |
| `GET /v1/exports/{id}` | `audit.export` | Poll/download the export artifact (tenant-scoped signed URL). |
| `GET /v1/audit/verify?from=&to=` | `governance.manage` | Verify the hash chain over a seq range (tamper check); returns `{ ok, broken_at? }`. |

Member (W2 Activity) reads are scoped to the caller's own `inference_calls` rows without `audit.read` (self-owned read), matching mockup item 40 / 17.

### 4.4 HTTP — SIEM / retention / legal-hold / DSR config (C1 gateway-mediated, REST `/v1/<domain>/<resource>`)

Per-domain, capability-checked server-side (DECISIONS §5a — all gateway HTTP is REST `/v1/<domain>/<resource>`, never `/rpc/*`); each write emits its own `audit_events` row.

| Endpoint | Capability | Writes / effect |
|---|---|---|
| `POST /v1/siem/sinks`, `POST /v1/siem/sinks/{id}/disable` | `governance.manage` | `notification_channels` (kind `siem`) — endpoint/format/auth-ref. |
| `POST /v1/siem/sinks/{id}/test` | `governance.manage` | Ships a synthetic event to the sink; returns delivery result (no state change). |
| `POST /v1/siem/sinks/{id}/redrive` | `governance.manage` | Re-queues `siem_dead_letter` batches for a sink. |
| `PUT /v1/retention/policies` | `governance.manage` | `retention_policies` (per-artifact `window_days` / `min_severity_kept`). |
| `POST /v1/audit/holds`, `DELETE /v1/audit/holds/{id}` | `governance.manage` | `legal_holds`. |
| `POST /v1/audit/dsr-erasures` | `governance.manage` | DSR erasure of a subject's PII: crypto-shred / field-redaction-in-place recorded as a new audit event (never a hard row delete — §8 D5). |

> **Capability vocabulary is F2-owned.** `audit.read`, `audit.export`, and `governance.manage` reference the canonical F2 set. `governance.manage` (already in C1 §4.2) covers SIEM/retention/legal-hold/DSR config. **`audit.read` / `audit.export` are new slugs O1 needs; if absent from the F2 canonical set, raise them against F2** (O1 does not mint capabilities). Analytics-screen viewing may reuse an `analytics.read` slug (O2).

### 4.5 Events (consumed by O1; O1 re-emits none of its own beyond audit rows)

O1 is the **terminus** of the event fan-out — every emitting module calls `AuditSink`:

- **From C1:** every privileged `/v1/<domain>/<resource>` write (`privileged_write` / `config_change`), sign-in/out + auth failures (`access`), device-revocation rejections (`device`), each completed call already persisted to `inference_calls` (O1 links, does not duplicate).
- **From C4:** policy/guardrail hits, **redaction hits** (`redaction`, counts only — W5), classification enforcement, "why this model" trace, sensitive-compute (§3c) — the headline governance events.
- **From C3:** `budget.alert` / `budget.overshoot` / `budget.exhausted` / `budget.request.*` / `budget.spoof_detected` (`budget`), plus the `alert_events` dispatch.
- **From C6:** every `quality_signals` row (`quality_signal`) via the same fan-out C6 already calls.
- **From O3:** device enroll / revoke (`device`).

Config-change RPCs that alter routing/credentials also drive C1's `update_config` (C1 §4.5) — O1 records the config-change audit row; it does not manage the reload.

---

## 5. Security & RLS

- **Append-only, tamper-evident (DECISIONS §2).** `audit_events` UPDATE/DELETE are **denied to every role including `service_role`** by a DB trigger that raises (grants alone are insufficient because `service_role` bypasses RLS). The per-tenant hash chain (`prev_hash`/`row_hash`) makes any out-of-band storage mutation detectable via `GET /v1/audit/verify`. Purge (§6.7) is the *only* deletion path and it is itself a `service_role` operation constrained by retention policy + legal hold, emitting a `retention` audit event.
- **Actor binding (DECISIONS §2 "apply-without-asking").** `actor_id = auth.uid()` for client-originated events (bound server-side from the verified JWT, never client-supplied); gateway/system events set `actor_kind='system'` with a null `actor_id` + `source_module`. A client cannot forge an event attributed to another user (same rule as C6 explicit signals).
- **Atomic write+audit.** A privileged write and its audit row share the DB transaction (C1 §6.5 step 5) so no privileged mutation can commit unaudited and no audit row can reference an uncommitted write.
- **Tenant isolation.** RLS `tenant_id = (auth.jwt()->>'tenant_id')::uuid` on every readable O1 table; `service_role` (the streamer, purge, export jobs) bypasses RLS and scopes explicitly in code. Cross-tenant read returns 0 rows (extends the F1 RW12 harness to `audit_events`).
- **Read authz.** `audit_events` and the full request ledger require `audit.read`; export requires `audit.export`; SIEM/retention/legal-hold/DSR config require `governance.manage` — all resolved server-side from `role_permissions` via the JWT-carried `role_ids` (never a raw grant in the JWT). Members read only their **own** `inference_calls` rows (self-owned) for W2 Activity without `audit.read`.
- **Secrets & redaction (DECISIONS §2 W5 — first-class here).** `audit_events.payload` and every exported/streamed field are **W5-clean**: counts, detector labels, span offsets, one-way placeholders — **never** raw secret/PII, provider keys, OAuth tokens, or prompt/response content. `AuditSink::emit` hard-rejects a non-clean payload. Because audit rows stream to an external SIEM (widest blast radius in the system), this gate is a build gate, not advisory. Redaction events themselves record only *what kind* and *how many*, never the redacted material.
- **SIEM transport.** SIEM sink credentials live in the F3 vault / a secret-ref in `notification_channels.config` (never plaintext in the row); the connector authenticates over TLS; a sink outage never drops events (dead-letter, not loss).
- **DSR vs immutability.** A data-subject erase never hard-deletes audit rows (that would break the chain + destroy the compliance record). It crypto-shreds / field-redacts the subject's PII in place and records the erasure as a new, forward-hashed audit event (§8 D5).
- **Device anti-spoof carry-through.** Device-reported local calls enter `inference_calls` only via C3's signed/idempotent reconciliation (C3 §4.4); O1 reads the result — a spoofed buffer never reaches the ledger, so the audit/ledger surface inherits C3's anti-replay guarantee.
- **Negative-test gate.** The RW12 harness + O1 integration tests prove: no role can UPDATE/DELETE an audit row; a client-supplied `actor_id` is ignored; cross-tenant read = 0 rows; no secret/PII appears in any audit row, export, or SIEM payload (log-scan); a privileged write whose tx rolls back leaves no audit row; the hash chain verifies and a mutated row is detected.

---

## 6. Key flows

1. **Privileged write → audit (atomic).** C1 handles a privileged `/v1/<domain>/<resource>` write → `require(ctx, cap)` → opens a DB tx → performs the `service_role` write → in the **same tx** calls `AuditSink::emit(category=PrivilegedWrite/ConfigChange, action, resource, actor=ctx.identity, payload=before/after diff (W5-clean))` → commit. If the write fails, the tx rolls back and no audit row exists; if audit-emit fails (e.g. non-clean payload), the write rolls back — no unaudited privileged action.

2. **Completed inference call → ledger + trace + signals.** C1's `GatewayStore` writes the `inference_calls` row (cost, served model, `execution_location`, node attribution) + `execution_traces` (why-model, fallbacks, per-step plane via GH-1). C4 assembles the implicit `quality_signals` batch and C6's sink fans each signal into `AuditSink` (`category=QualitySignal`). O1 links, never duplicates, the ledger row. The Requests surface joins all three per row.

3. **Governance / redaction hit → audit.** C4's wrapper detects a guardrail/redaction/classification/sensitive-compute event around `execute`/`execute_stream` → `AuditSink::emit(category=Redaction|PolicyHit|Classification, payload=counts-by-detector, no raw content)` → row streams to SIEM. Streaming redaction fidelity depends on GH-6 (buffer-then-redact until the crate stream-transform hook lands).

4. **Access / sign-in / device event → audit.** F2/C1 emit `access` events (sign-in/out, auth failure, API-key use denied); O3/C1 emit `device` events (enroll, revoke, revoked-device rejection on the hot path). Each is actor-bound.

5. **Budget event → audit + alert.** C3 emits `budget.alert`/`overshoot`/`exhausted`/`request.*`/`spoof_detected` → `AuditSink` (`category=Budget`) → C3's `alert_events` dispatch fans to `notification_channels` (email/slack/webhook/**siem**). O1 records the audit row; SIEM channels also receive it via the streamer.

6. **SIEM streaming (durable, at-least-once, ordered).** The streamer, per (tenant, active `siem` channel): read `audit_events` with `seq > last_seq` in `seq` order → build the batch → `SiemConnector::ship` in the sink's `format` → on success advance `siem_stream_state.last_seq`; on failure retry with backoff, and after N attempts park the batch in `siem_dead_letter` + mark the sink `dead_letter` + emit a `siem` audit event. Restart resumes from `last_seq` (at-least-once; receiver dedups on `(tenant, seq)`). `POST /v1/siem/sinks/{id}/redrive` re-queues dead-lettered batches.

7. **Retention purge (scheduled).** A scheduled job, per tenant per artifact: delete rows older than `retention_policies.window_days` **except** those matched by an active `legal_hold` and (for audit) those `severity ≥ min_severity_kept`; `quality_signals` are purged co-terminously with their subject `inference_call`/`message` (C6 §3.4). Each purge run emits a `retention` audit event (counts per artifact). `audit_events` purge preserves chain continuity by purging only whole contiguous prefixes and re-anchoring the chain head (the verify endpoint accounts for a purged prefix).

8. **Export.** `POST /v1/exports` (capability `audit.export`) → the request is recorded as an `export` audit event (actor-bound, filter in payload) → a `service_role` job streams the filtered, W5-clean ledger/audit rows to CSV/JSON in tenant object storage → `GET /v1/exports/{id}` returns a tenant-scoped signed URL.

9. **DSR erase.** `POST /v1/audit/dsr-erasures` (capability `governance.manage`) for a subject → a `service_role` op crypto-shreds / field-redacts the subject's PII across `inference_calls`/`quality_signals`/`documents` payloads and audit `payload` fields, **without deleting audit rows**, records the erasure as a forward-hashed audit event, and (if a hold applies) refuses until the hold is released.

10. **Integrity verification.** `GET /v1/audit/verify?from=&to=` recomputes `row_hash` over the seq range and compares to stored values; a mismatch returns `{ ok:false, broken_at:<seq> }` — surfaced to admins as a tamper alert.

---

## 7. Gateway-crate dependencies

Engine = the six `sensei-*` crates @ **`v0.4.6`**. O1 consumes the crate **only indirectly** through C1/C4 (it reads the ledger + trace those modules persist; it never wraps `execute`). Like C6, O1 files **no new gateway-repo issue** — it is a pure consumer of issues already filed for C1/C2/C3/C4/D3.

| Issue | What O1 needs | Blocking? |
|---|---|---|
| **GH-1** | Per-step `plane` + execution-location on `ChainEntry`/`Attempt`/`ExecutionTrace` → `inference_calls.execution_location` + the "why this model" trace carry local/cloud, so the **unified cross-plane request ledger** distinguishes device vs gateway calls and the exec-location column/badge is truthful. Until it lands, `execution_location` degrades to cloud-only fidelity for the trace. | For full split-plane ledger fidelity (rides the C2/D3 phase). |
| **GH-5** | `inference_calls` ledger shape + org→dept→team→user attribution + rollup — O1 reads these for the request ledger, spend-by-scope filters, and O2 hand-off. O1 does not write the ledger. | Relevant (rides F1-rework/C3). |
| (GH-6) | Streaming-safe redaction hook — determines whether redaction-hit audit events for **streamed** answers are accurate at egress or after a buffer-then-redact. O1 consumes whatever C4 produces. | Relevant to flow 3 (rides C4). |

---

## 8. Decisions resolved

- **D1 — `audit_events` is append-only, enforced by a DB trigger (not grants alone).** UPDATE/DELETE raise for *every* role including `service_role`; the only deletion path is the retention purge (policy + legal-hold constrained, itself audited). *Rationale: `service_role` bypasses RLS, so grant-level append-only is insufficient; a trigger closes the built audit-forgery/mutation hole (DECISIONS §2).*
- **D2 — Actor binding: `actor_id = auth.uid()` (client) or `system`/`service_role` (gateway).** Client-supplied `actor_id` is ignored. *Rationale: DECISIONS §2 apply-without-asking — a member cannot forge an audit row attributed to someone else.*
- **D3 — Tamper-evidence via a per-tenant hash chain (`prev_hash`/`row_hash`) in v1.** Assigned in the insert path under a per-tenant advisory lock. *Rationale: append-only + RLS stops the application; a hash chain also detects out-of-band storage tampering, and a per-tenant chain avoids a global serialization bottleneck. (If load testing shows the advisory-lock ordering is too hot, fall back to append-only + periodic anchoring — see §10.)*
- **D4 — SIEM is a pluggable per-sink connector; the *wire format* is operator config, the *architecture* is fixed.** Streaming is a cursor-based, durable, **at-least-once, per-tenant-ordered** reader of `audit_events` with retry + dead-letter; the sink's `format` (`JsonHttps` default; `SyslogRfc5424` / `CEF` / `LEEF` / `SplunkHec` / `OTLP` selectable) is per-`notification_channels` config. *Rationale: the O1 seed explicitly leaves wire format open; making it a per-sink format field (not a code fork) lets operators pick their SIEM without a build change, while the delivery guarantee is uniform. `notification_channels` (kind `siem`) is reused — no duplicate destination table.*
- **D5 — Retention is per-artifact windows + legal hold; DSR erase is redaction-in-place, never a hard delete of audit rows.** `retention_policies` per artifact (audit 400d / ledger 400d / traces 90d default; `quality_signals` co-terminous with subject per C6); legal holds exclude matching rows from purge; DSR erase crypto-shreds / field-redacts PII and is itself audited. *Rationale: reconciles GDPR/DSR erasure with the immutability guarantee — the compliance record + hash chain survive while the subject's PII is rendered unrecoverable.*
- **D6 — One request ledger; O1 adds no parallel table.** O1 owns the cross-plane read/export/retention/SIEM surface over C1-written `inference_calls`; `gateway_tasks` cost fields are retired. *Rationale: DECISIONS §3.*
- **D7 — Quality signals stream through the same `AuditSink` fan-out; O1 does not own the signal contract.** C6 owns `SignalKey`/units; O1 receives each signal as a `quality_signal`-category audit event. *Rationale: DECISIONS §3b; keeps the taxonomy single-owned (C6) while all events terminate in one immutable log.*
- **D8 — Privileged write + its audit row commit in one DB transaction.** *Rationale: guarantees no unaudited privileged action and no dangling audit row; aligns with C1 §6.5.*
- **D9 — O1 mints no capability; it references F2's canonical set and raises `audit.read`/`audit.export` against F2 if absent.** SIEM/retention/legal-hold/DSR reuse `governance.manage`. *Rationale: DECISIONS default — capabilities are F2-owned, resolved server-side.*
- **D10 — Audit payloads are W5-clean; `AuditSink` hard-rejects raw secret/PII.** *Rationale: DECISIONS §2 W5 — audit rows have the widest egress (external SIEM), so a leak here propagates furthest.*

---

## 9. Acceptance criteria (observable, testable)

1. **Append-only immutability.** `UPDATE`/`DELETE` on `audit_events` fails for both `authenticated` and `service_role` (trigger raises); the only successful deletion is the retention purge. A tamper attempt via `GET /v1/audit/verify` returns `ok:false` with the broken `seq`.
2. **Actor binding + no forgery.** A client-emitted event stores `actor_id = auth.uid()`; a request supplying a different `actor_id` is ignored (server binds the JWT identity); a member of tenant A cannot write an event into tenant B (0-row cross-tenant, RW12).
3. **Atomic write+audit.** A privileged `/v1/<domain>/<resource>` write and its `audit_events` row commit together; forcing the write to roll back leaves **no** audit row; forcing a non-clean audit payload rolls back the write.
4. **Unified cross-plane ledger.** A cloud call (C1) and a device-reported local call (C3 reconciliation) both appear in `GET /v1/requests` with correct `execution_location`, device, cost, outcome; `gateway_tasks` holds no cost fields.
5. **Why-this-model trace.** `GET /v1/requests/{id}/trace` returns the attempts/fallbacks/per-step plane (GH-1) + linked `quality_signals` for a real call.
6. **Redaction event captured, no leak.** A call that triggers C4 redaction produces a `redaction`-category audit row with per-detector **counts** and **no raw secret/PII** (log-scan test green); the same row streams to SIEM with no raw content.
7. **SIEM at-least-once, ordered, resumable.** With a configured sink, every audit event is delivered in per-tenant `seq` order at least once; a simulated sink outage triggers retry then dead-letter (no loss); restarting the streamer resumes from `last_seq`; `POST /v1/siem/sinks/{id}/redrive` re-delivers dead-lettered batches.
8. **Export is filtered + audited.** `POST /v1/exports` with filters yields a CSV/JSON matching the filter; the export action itself appears as an `export` audit event bound to the caller; a caller without `audit.export` is denied.
9. **Retention + legal hold.** The purge deletes artifacts past their `window_days` **except** legal-held rows and audit rows `≥ min_severity_kept`; `quality_signals` purge co-terminous with their subject; each purge emits a `retention` audit event.
10. **DSR erase preserves the chain.** A DSR erase renders a subject's PII unrecoverable across ledger/signals/audit payloads **without** deleting audit rows; the chain still verifies; the erasure is recorded as a new audit event.
11. **Read authz.** `GET /v1/audit` and full `GET /v1/requests` require `audit.read` (403 without); a member can read only their own `inference_calls` rows for W2 Activity without it; SIEM/retention/legal-hold config requires `governance.manage`.
12. **Fan-out completeness.** Every C6 `quality_signals` row appears as a `quality_signal` audit event; disabling O1 capture removes those events from the audit stream (proving the dependency) while C6 signal storage is unaffected.

---

## 10. Open questions

1. **SIEM default wire-format set.** Which formats ship enabled in v1 (JSON/HTTPS is the default; syslog RFC 5424 / CEF / LEEF / Splunk HEC / OTLP as options) — a product/operator choice, not a build blocker. The architecture (pluggable per-sink `format`) is fixed (D4); the enabled *set* is TBD.
2. **Hash-chain cost at scale.** Whether the per-tenant advisory-lock chain insert (D3) holds up under a very high multi-writer audit rate, or whether v1 ships append-only + periodic Merkle-anchoring instead of a per-row chain. Decision deferred to load-test evidence (not a correctness question — both detect tampering).
3. **Retention default windows.** The default `window_days` per artifact (audit/ledger/traces) needs compliance/product input; the mechanism (`retention_policies` + legal hold) is fixed regardless.
4. **DSR erase granularity.** Field-level redaction-in-place vs per-subject crypto-shred (a per-subject DEK that can be destroyed) — the latter is cleaner for "make it unrecoverable" but requires F3 to mint per-subject keys. Depends on F3's key model; both satisfy D5.
5. **Ledger read path: C1 endpoints vs direct PostgREST RLS.** Whether W1/W2 read `inference_calls`/`audit_events` via the C1 `GET /v1/requests|audit` endpoints (uniform authz + saved views) or directly via PostgREST under RLS (less gateway load). Leaning C1 endpoints for the capability-gated audit surface + saved views; member self-owned Activity reads could go direct.
6. **Cross-region audit aggregation.** If C1 deploys multi-region (C1 open q #1), whether audit/ledger rows aggregate into one per-tenant chain or per-region chains that merge — undecided until the C1 deployment topology is settled.
