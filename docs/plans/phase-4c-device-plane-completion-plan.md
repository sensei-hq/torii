---
title: Phase 4c (P10) · Device-plane completion — D2 · D4 · D3 · O3 plan
description: Mature the device plane to build-ready depth — D2 full model registry/download/GC + local RAG/embed + §3c local-only compute; D4 versioned config sync (config_versions) + Realtime hot-reload + signed idempotent usage/audit buffer; D3 full unified split-plane trace + device-status hot-path check; O3 enrolled-device fleet mgmt + per-feature 4-state governance.
type: plan
status: plan
created: 2026-07-23
depends_on:
  - docs/DECISIONS.md
  - docs/plans/roadmap.md
  - docs/specs/D2-local-gateway.md
  - docs/specs/D4-config-sync.md
  - docs/specs/D3-split-plane-router.md
  - docs/specs/O3-device-fleet.md
  - docs/plans/gateway-issues.md
milestone: P10
supersedes_skeleton_in:
  - docs/plans/phase-1b-local-inference-ask-plan.md (D2·min)
  - docs/plans/phase-2b-split-plane-plan.md (C2·min, D3, D4·min)
---

# Phase 4c (P10) · Device-plane completion — Implementation Plan

> **Canonical position:** roadmap **P10** (`docs/plans/roadmap.md` §2 Part C). This phase *matures* the
> minimally-built device plane (D2·min from P1b, D3/D4·min from P2b) into the full split-plane and adds
> the ops surface (O3). It is the last device-plane phase before web breadth consumes it (W1 Device-fleet
> / Feature-management in P8, W2/W3 exec-location badges in P9).
>
> **For agentic workers:** DB changes go through **dbd** (`dbd reset && dbd apply && dbd import`, no
> migrations pre-v1 — `project_db_workflow`); the DDL these features touch already landed in the F1
> rework (P3) — this phase adds only the small deltas noted per feature and re-applies. **TDD**: write the
> failing test first (Rust `#[test]`/integration, `tests/authz.sql` extension, or a Playwright/IPC
> harness) then implement. **Heavy Rust/Tauri builds run in a BACKGROUND controller shell**, never inside a
> subagent (the `sensei-*` + llama-cpp + ort + tauri compile is minutes; the watchdog kills a subagent).
> Run `make clean` after the phase (Tauri `target/` fills disk — `feedback_regular_cleanup`).

## Objective

Deliver the **acceptance gate** (roadmap P10):

> An admin changes a chain in **W1 → the desktop picks it up live via Realtime and enforces it**; a
> **revoked device with a live JWT is blocked on the C1 hot path**; **offline usage buffers reconcile
> idempotently on reconnect** (no under-report / replay).

Concretely, at the end of P10 a desktop app: (a) runs local chat + 1024-dim embeddings **in-process, `$0`,
offline** on operator-governed models it can download/GC; (b) walks a **plane-spanning chain as one
`sensei-gateway` engine run** and emits **one unified `ExecutionTrace`** with a per-step
`execution_location`; (c) stays **fresh via RLS-scoped Realtime + versioned pull with fail-closed
atomic hot-reload**, and reports usage/audit back through a **Ed25519-signed, monotonic-sequenced,
idempotent buffer**; and (d) is **governed + revocable** from an admin fleet + 4-state feature matrix
whose precedence is resolved identically on-device and centrally.

**Guiding invariants (from DECISIONS §2/§3/§4):** *a device is never trusted and never authoritative* —
config flows one-way (server→device, credential-free); usage/audit flows device→server only through the
signed/idempotent buffer (anti-forge + anti-under-report + anti-replay); **no provider credential ever
touches the device**; a revoked device cannot spend on either plane; and every governed decision is
resolved server-side (the client render is UX, not enforcement).

---

## Prerequisites

### Prior phases (must be green)
| Prereq | What P10 consumes | Where |
|---|---|---|
| **P1a** (D1) | Tauri shell + local SQLite store + OS keychain (device session token, Ed25519 device key custody) + sync/offline shell chips | D1 spec |
| **P1b** (D2·min) | The minimal in-process `EmbeddedLlamaAdapter` boot + local Ask; P10 hardens/extends it | phase-1b |
| **P2b** (D3/D4·min) | The minimal split-plane walk + minimal config pull; P10 replaces both with the full versions | phase-2b |
| **P3** (F1 rework) | Schema deltas: `config.config_versions` (RW15), reworked `config.feature_states` 4-state + `app.user_preferences` (RW6), `devices.last_seen`/`buffer_health` (RW10), `inference_calls` single ledger + attribution (RW7 + GH-5 shape), `structured_datasets`/`dataset_columns` (RW15), routing `plane` on `fallback_chain_models` (RW14) | F1-rework |
| **P4** (F2, F3) | Device-bound JWT (`device_id` claim), device enroll/revoke lifecycle, **`DeviceGuard::check`** hot-path gate, `feature.manage`/`device.manage` capabilities; F3 central credential vault (never synced) | F2/F3 specs |
| **P5** (C1, C2, C3) | C1 gateway-mediated `/rpc/*` + `/v1/chat`·`/v1/embed` + JWT verify; **C2 named chains with per-step `plane` + `chain_bindings`/`routing_policies`**; **C3 hard reserve→commit + `/v1/usage/report`** verify/persist | C1/C2/C3 specs |
| **P6** (O1, C4, C6) | O1 immutable audit sink + `actor_id` binding (device audit rows flush here); C4 redaction wrapper (redact-in-flight, local→cloud egress); C6 `quality_signals` contract | O1/C4/C6 specs |

### Crate issues (gateway-repo, released via the lockstep tag bump before this phase)
| Issue | Status required for P10 | Blocking? |
|---|---|---|
| **GH-1** — per-step `plane` on `ChainEntry` + `execution_location` on `Attempt`/`ExecutionTrace` | **Released** (`v0.4.6+`). The unified split-plane trace (D3) and every exec-location badge/ledger row cannot exist without it. | **Yes** — hard gate for D3-3, D4-6, O3-4. |
| **GH-5** — `inference_calls` shape with org→dept→team→user attribution + `execution_location` + `hold_id` | **Decided/landed** in P3/C3. D4's uploaded device-call records + D3's `$0` local rows must match this shape so C3 persists them with node attribution. | Decided (F1-rework/C3). |
| **GH-6** — streaming-safe redaction hook | **Investigated** (informs D3 mid-stream policy). v1 falls back to buffer-then-redact where no crate transform point exists. | Investigate (not blocking). |
| **GH-2** — OAuth/bearer credential | **Not a device concern** — credentials never sync to the device; listed only to note D4 explicitly excludes them from the snapshot. | No. |
| **GH-3** — local embedding path | **Resolved** (embedded in-process path exists; D2 only picks a 1024-dim model). | No. |

### Front-loaded human inputs
- **No new human secret is introduced by P10.** The device Ed25519 keypair is generated on-device at F2
  enrollment (P4); the device session token lives in the OS keychain (D1); provider credentials stay
  central (F3). **Reconfirm the P2a/P5 paid-provider-call approval** still stands (D3 cloud steps proxy real
  paid calls through C1) — a reconfirmation only, no new key.
- **Supabase Realtime authorization must be enabled** on the project (RLS-authorized Realtime channels) —
  a project-config confirmation (same project as the P2a RS256/JWKS setup), not a secret.

---

## Residuals resolved (zero TBD — conform to DECISIONS)

The four specs carry genuine open questions; P10 freezes each so the build is unblocked. Rationale binds
each to DECISIONS or to a spec §8 decision.

1. **§3c on-device decrypt is *deferred*; v1 device §3c compute = local-only datasets that need no central DEK.**
   DECISIONS §3c: sensitive-column decryption + compute run **only in the central trusted boundary** for
   v1, because per-tenant **device-DEK custody is deferred** (no secret leaves central). P10 therefore
   **builds the on-device execute-in-app compute engine** (schema-to-LLM + DuckDB SELECT/aggregate +
   k-anon/threshold gating) and pins it to datasets that are **local-only** (ingested on-device, never
   central-DEK-encrypted). A dataset whose sensitive columns are central-DEK-encrypted **routes to central**
   for decrypt+compute even on desktop (D3 forwards to C1; the model still sees only schema + aggregates).
   *Resolves D3 Q2 + D2 Q4; conforms to DECISIONS §3c.* (On-device DEK custody is a future F3 issue.)
2. **Plane→adapter selection = two distinct router ids, not a new engine selection axis.** GH-1's per-step
   `plane` drives the **trace/badge/ledger**; adapter *selection* reuses the existing router→adapter map by
   modeling each local-capable model as two routers — `{model}@local` bound to the D2 embedded adapter and
   `{model}@cloud` bound to the `RemoteGatewayAdapter` — so a `plane='local'` step resolves to the
   `@local` router and a `plane='cloud'` step to the `@cloud` router with no crate change beyond GH-1.
   *Resolves D3 Q1; reuses the C1/MIG-2 `AdapterRegistry`/`RegisterInto` mechanism.*
3. **Planned-`local` step not viable → skip-to-next (fallback); pull-and-wait is opt-in feature-governed.**
   When a planned-local model isn't `Ready` (not downloaded / won't fit), D2's `phase()` tells the engine to
   fall through to the next step; **pull-and-wait** (block on a download) is off by default and only enabled
   by a governed feature. *Resolves D3 Q4; never block a user-awaited answer (D3 §8.2).*
4. **Mid-stream cloud disconnect → if no output committed, fall back to a local step; if partial output already
   streamed, surface the partial + an explicit retry (no silent local restart that would duplicate/append).**
   *Resolves D3 Q3; ties to GH-6 — where redaction needs the whole response, buffer-then-redact.*
5. **Config snapshot is a dedicated C1 handler** `GET /v1/config/snapshot?since=` guaranteeing **one atomic
   `config_version` generation** (the RLS-scoped PostgREST assembly is a fallback only). *Resolves D4 Q4;
   coherent atomic apply is the whole point (D4 §8 D2/D3).*
6. **Delta retention horizon = last N generations (operator config, default 20); older `since` → full snapshot.**
   A full pull is always valid, so this is a latency/memory knob, not correctness. *Resolves D4 Q1.*
7. **Realtime topology = per-tenant `config` + `budget` channels, per-device `device` channel.** *Resolves D4
   Q2 (matches F2 §10.3 device-status fallback).*
8. **Buffer back-pressure = soft-warn at a threshold, hard-ceiling blocks *new metered local calls* rather than
   drop.** Dropping would under-report (forbidden, DECISIONS §2); blocking new spend is fail-closed. *Resolves
   D4 Q3.*
9. **Admin governance matrix is read via a capability-gated C1 RPC** (`GET /rpc/governance/matrix`), keeping
   `feature_states` fully `service_role`-only. *Resolves O3 §8.4.*
10. **Feature catalog is seed-authored; a catalog `default_state` change leaves already-seeded tenant rows
    as-is** (explicit admin action to adopt). *Resolves O3 Q3.*
11. **Stale-device threshold = a D4 operator-config constant** (not hardcoded — `project-gateway-no-hardcoded-ops`),
    surfaced read-only in the fleet UI. *Resolves O3 Q4.*
12. **GPU/accelerator = advisory-only in v1**; fit-gating uses the crate's disk+RAM `FitReport`. *D2 §8.5 / Q1.*

---

## Features

Grouped by module. Each feature: **Module · Layers**, **Depends on**, **Spec/Decision**, **Acceptance
criteria** (observable), **Test scenarios** (Given/When/Then). Feature ids are stable references for the
build order + dependency graph.

### D2 · Embedded local gateway & model manager (full)

#### D2-1 — Full local-engine assembly & capability-adapter registration (hardened)
- **Module · Layers:** D2 · Rust (`src-tauri`) — engine boot
- **Depends on:** P1b (D2·min boot), P3 (catalog dims)
- **Spec/Decision:** D2 §2.1, §6 Flow 1, §8.1/§8.6; DECISIONS §3 (embedded in-process, no daemon; `fastembed` off)
- **Acceptance criteria:**
  - After `LocalEngine::boot`, `AdapterRegistry::list()` includes the `EmbeddedLlamaAdapter` id under **both** the chat and embed capability maps and the `OrtAdapter` id under embed; the `ChainedResolver` composes `ManagedResolver`(`~/.strategos/models`)→`OllamaResolver`(read-through `~/.ollama`)→`ExternalResolver`.
  - The `ProvisioningSupervisor` is registered as the `Arc<dyn ReadinessProbe>` the local wing consults; unready models degrade (fall-through) rather than block.
  - Build compiles with `llama-cpp`+`ort`+`hf-download` and **without** `fastembed` (no `FastembedAdapter`/`ProvisionPlan::Fastembed` symbol); there is **no** `InferenceAdapter` reference (MIG-2); every `ProvisionPlan` match carries a wildcard arm (`#[non_exhaustive]`).
- **Test scenarios:**
  - Given a clean boot, When `AdapterRegistry::list()` is inspected, Then the embedded adapter appears under chat **and** embed and the ort adapter under embed.
  - Given `cargo build --features "llama-cpp,ort,hf-download"`, When it compiles, Then no `fastembed`/`InferenceAdapter` symbol is present (grep/symbol assertion).

#### D2-2 — Model registry enumeration, operator-governed catalog & fit pre-flight
- **Module · Layers:** D2 · Rust + Tauri IPC + SvelteKit (Local models screen, mockup-review §A.9)
- **Depends on:** D2-1, D4-2 (catalog overrides + governance arrive via the snapshot)
- **Spec/Decision:** D2 §4.2, §6 Flow 2/3, §8.2/§8.4/§8.5; DECISIONS §3 (no-hardcoded-ops)
- **Acceptance criteria:**
  - `local_models_list()` returns each known model with the correct `source_kind` (`managed`/`ollama`/`external`), `size_bytes`, `capabilities[]`, a live `ProvisionPhase`, and default/last-used flags; a model present only in the read-through Ollama cache shows `ollama` and is not deletable.
  - `local_model_catalog()` returns the **operator-governed** pullable set (platform defaults + per-tenant/space/role catalog overrides from the D4 snapshot), each with a `FitReport`; a model disabled by the catalog or a `locked` feature is **not** offered.
  - `local_model_check_fit(id)` returns `fits` with an actionable `reason` and downloads **no** bytes; `local_device_capabilities()` reports CPU + `sysinfo` RAM/disk consistent with `FitReport` plus an accelerator advisory flagged `advisory:true`.
- **Test scenarios:**
  - Given an oversized model, When `local_model_check_fit`, Then `fits=false` with a non-empty `reason` and zero bytes downloaded.
  - Given a catalog override disabling model X for the tenant, When `local_model_catalog()`, Then X is absent from the pullable list.

#### D2-3 — Download / update lifecycle with streamed provisioning phases
- **Module · Layers:** D2 · Rust + Tauri event channel
- **Depends on:** D2-2
- **Spec/Decision:** D2 §4.4, §6 Flow 3, §9.4; §5 (supply-chain integrity)
- **Acceptance criteria:**
  - `local_model_pull(id)` refuses when `!fit.fits`; otherwise `supervisor.ensure(id, EnsureOpts{wait:false})` drives phases `Absent→Queued→Downloading{done,total}→Verifying→Loading→Ready`, each observable on `local-model://phase`.
  - On `Ready`, a **Managed** `ModelEntry` with a verified `sha256` and a **pinned `revision`** is registered and `local-model://registry-changed` fires; a forced failure lands `Failed{error}` and registers nothing (no half-registered state).
- **Test scenarios:**
  - Given a fitting 1024-dim embed GGUF, When pulled, Then the full phase sequence streams and a hash-verified, revision-pinned Managed entry is registered.
  - Given a corrupted download (sha mismatch), When it verifies, Then `Failed{error}` is emitted and the registry is unchanged.

#### D2-4 — Storage usage, remove & GC (managed-only, refcounted) + device defaults
- **Module · Layers:** D2 · Rust + Tauri IPC
- **Depends on:** D2-3
- **Spec/Decision:** D2 §4.2, §6 Flow 6/7, §8.8, §9.8; §10 Q4 (refcount)
- **Acceptance criteria:**
  - `local_model_remove(id)` deletes **Managed** bytes + index row only when `refcount==0`, drops `local_storage_usage.managed_bytes` accordingly, and **refuses** (typed error) for `Ollama`/`External` sources or a referenced model; `local_gc()` removes only unreferenced (`refcount==0`, non-default) managed files.
  - `local_set_default(capability, model_id)` persists the device default chat **or** embed model; the embed default is validated 1024-dim; the value is a `user-overridable` preference only where governance permits (else the admin-locked default wins).
  - `refcount` is maintained against device-default + C5 local-index references; a model in use is never GC'd.
- **Test scenarios:**
  - Given a referenced managed model, When `local_model_remove`, Then a typed refusal is returned and bytes remain.
  - Given an Ollama read-through entry, When `local_model_remove`, Then it is refused (not owned).

#### D2-5 — 1024-dim embedding chain + local RAG embed for C5's desktop plane
- **Module · Layers:** D2 · Rust (in-process API for C5)
- **Depends on:** D2-1, D2-4
- **Spec/Decision:** D2 §4.3, §6 Flow 5, §8.3, §9.5; DECISIONS §3 (`document_embeddings vector(1024)`)
- **Acceptance criteria:**
  - `LocalEngine::embed(model, texts)` returns vectors of length **exactly 1024**; registering an embed model whose output is not 1024-dim is rejected at registration (hard error), and no non-1024 model can be set as the embed default.
  - C5's desktop ingestion/query embedding chain resolves its local step through `LocalEngine::embed`; the local and cloud RAG indexes are dimension-interchangeable.
- **Test scenarios:**
  - Given the default embed model, When `embed` runs, Then every returned vector has length 1024.
  - Given a 768-dim embed model, When registration is attempted, Then it is rejected with a dim-mismatch error.

#### D2-6 — §3c on-device execute-in-app compute (local-only datasets)
- **Module · Layers:** D2 · Rust (on-device `SecureExecutor` compute, DuckDB)
- **Depends on:** D2-5, C5 (dataset schema/`dataset_columns`), P3 (`structured_datasets`)
- **Spec/Decision:** DECISIONS §3c + **Residual #1**; D3 §6.7; C5 §3c
- **Acceptance criteria:**
  - For a **local-only** dataset (no central-DEK-encrypted columns), the LLM receives **only** schema + non-sensitive metadata/aggregates; the compute (SELECT/filter/aggregate) executes on-device in the DuckDB engine with k-anonymity / min-group thresholds enforced; **no raw sensitive value** is in any payload that egresses.
  - A dataset whose sensitive columns are **central-DEK-encrypted** is **not** decrypted on-device — the compute routes to C1/central (D3 forwards); the desktop never holds a tenant DEK.
  - Every compute emits an audit + `quality_signals` row (via the D4 buffer / C6 contract).
- **Test scenarios:**
  - Given a local-only dataset with a salary column, When an aggregate is requested, Then only the aggregate result crosses any plane boundary and no row-level salary appears in any payload.
  - Given a central-DEK-encrypted dataset, When §3c compute is requested on desktop, Then it is routed to central (no on-device decrypt attempted).

### D4 · Config sync & offline (full)

#### D4-1 — `config.config_versions` + component sub-versions + bump wiring
- **Module · Layers:** D4 · DDL (dbd) → trigger → RLS
- **Depends on:** P3 (RW15 created the table shell)
- **Spec/Decision:** D4 §3.1, §8 D2; F1-rework RW15
- **Acceptance criteria:**
  - `config.config_versions(tenant_id pk, version bigint monotonic, components jsonb {catalog,routing,budgets,features,settings,tools}, updated_at)` exists; a `service_role` write / trigger bumps `version` **and the touched `components` sub-version** on any config-affecting change (catalog overrides, `fallback_chains`/`fallback_chain_models`, `routing_policies`, `budget_nodes` cap/enforcement, `feature_states`, `settings`, `mcp`/`tool_allow_lists`).
  - `authenticated` has tenant-scoped `SELECT`; INSERT/UPDATE/DELETE are `service_role`-only (extends `tests/authz.sql`).
- **Test scenarios:**
  - Given a `/rpc/chains/*` edit, When it commits, Then `config_versions.version` increments and `components.routing` bumps.
  - Given an `authenticated` client, When it attempts to write `config_versions`, Then it is denied.

#### D4-2 — Versioned config snapshot pull (`GET /v1/config/snapshot`) with delta + 304
- **Module · Layers:** D4 · Rust (Tauri client) + C1 handler (confirm/complete)
- **Depends on:** D4-1, C1 (P5 config authority §6.6)
- **Spec/Decision:** D4 §4.2, §8 D3, **Residual #5**; DECISIONS §2 W4 (credential-free)
- **Acceptance criteria:**
  - The C1 handler returns a coherent snapshot for the caller's tenant + resolved feature layer keyed by one atomic `config_version`; `since` absent/older-than-horizon → **full**, else a **delta** (only changed components), `since == config_version` → **304**.
  - The response contains **no** `router_credentials`/key/token field (payload-scan test); cloud steps are marked `plane:"cloud"` and carry no credential.
- **Test scenarios:**
  - Given `since` older than the retention horizon, When pulled, Then a full snapshot with the current `config_version` returns.
  - Given `since == config_version`, When pulled, Then `304 Not Modified`.

#### D4-3 — RLS-scoped Supabase Realtime subscriptions (config / budget / device)
- **Module · Layers:** D4 · Rust (Tauri host) + Supabase Realtime
- **Depends on:** P4 (device-bound JWT), **Residual #7**
- **Spec/Decision:** D4 §4.1, §5, §9.5; DECISIONS §2 (Realtime RLS-scoped)
- **Acceptance criteria:**
  - Three channels — per-tenant `config`, per-tenant `budget`, per-device `device` — open with the device-bound RS256 JWT; each delivers only rows the JWT may `SELECT` (a tenant-A device receives 0 rows for tenant-B).
  - Channels re-subscribe on token refresh (F2 1-hour TTL) and network resume; on `TokenStale`/`DeviceRevoked` the subscriptions tear down and D4 enters the offline-revoked state.
- **Test scenarios:**
  - Given a tenant-A device subscribing to the config channel, When a tenant-B row changes, Then 0 rows are delivered (RW12-style negative test).
  - Given a token refresh, When the socket re-auths, Then the three channels re-subscribe without a gap.

#### D4-4 — Fail-closed atomic hot-reload into the embedded engine
- **Module · Layers:** D4 · Rust (`Gateway::try_update_config`)
- **Depends on:** D4-2, D2-1 (engine handle)
- **Spec/Decision:** D4 §4.5, §6.2, §8 D8, §9.3; DECISIONS §3 (hot-reload)
- **Acceptance criteria:**
  - A pulled snapshot is assembled into a `GatewayConfig` and applied via `try_update_config` **atomically**; a chain edit + the model it references land together (never a dangling reference).
  - A snapshot failing validation is **rejected** and the engine keeps the prior config (fail-closed); a `sync.failed` audit row is emitted and the shell shows `Degraded`. `devices.config_version` reflects only the **successfully applied** version.
- **Test scenarios:**
  - Given a valid delta touching a chain + its model, When applied, Then a subsequent request uses the new chain **without a restart**.
  - Given an invalid snapshot, When `try_update_config` rejects it, Then the engine still answers with the old chain and `sync.failed` is audited.

#### D4-5 — Offline cache (SQLite) + cold-start bootstrap
- **Module · Layers:** D4 · Rust + SQLite (schema D4-owned, store D1-owned)
- **Depends on:** D4-2, D1 (SQLite store)
- **Spec/Decision:** D4 §3.4, §6.1, §8 D5, §9.1
- **Acceptance criteria:**
  - `cached_snapshot` (per-component), `sync_meta`, `usage_buffer`, `audit_buffer`, `pending_mutations` tables exist in the D1 SQLite store; last-known-good is persisted **only after** a successful apply.
  - On cold start with **no network**, the app boots, reassembles a `GatewayConfig` from the cache, and the local engine answers a local chat — **no central call is made**. The cache holds no credential and no other tenant's/user's data.
- **Test scenarios:**
  - Given a populated cache and the network down, When the app boots, Then a local chat succeeds with zero central calls.
  - Given a snapshot that fails to apply, When bootstrap runs, Then the prior last-known-good remains the cached config.

#### D4-6 — Signed / sequenced / idempotent usage + audit buffer → C3 `/v1/usage/report` + O1
- **Module · Layers:** D4 · Rust (Ed25519 sign) + HTTP flush
- **Depends on:** D4-5, P4 (device key custody), P5 (C3 verify/persist), P6 (O1), **GH-1/GH-5**
- **Spec/Decision:** D4 §3.4, §4.4, §5, §6.7, §8 D6, §9.6/9.7; DECISIONS §2 (signed + idempotent + anti-replay)
- **Acceptance criteria:**
  - Every device-side call (local `$0` + proxied) and device audit event is enqueued with a **monotonic `buffer_seq`**, a unique `idempotency_key`, and an **Ed25519 signature** over a canonical payload; the private key stays in the OS keychain (never in SQLite, never transmitted).
  - `flush()` posts batches in `seq` order to `POST /v1/usage/report`; the row appears in `inference_calls` **exactly once** with the correct `execution_location`, `cost_usd`, and node attribution; audit rows land in O1 with `actor_id` bound server-side.
  - Server rejects invalid signatures, `devices.status != active`, `buffer_seq ≤ last accepted` (replay), and returns a **200 no-op** for a duplicate `idempotency_key` (no second ledger row); D4 marks rows `acked` only on 2xx.
- **Test scenarios:**
  - Given an offline local call, When it flushes on reconnect, Then it appears exactly once in `inference_calls` (`execution_location='local'`) and the member's headroom updates via Realtime.
  - Given a re-submitted batch with a reused `buffer_seq`, When posted, Then it is rejected; a duplicate `idempotency_key` returns 200 no-op and creates no second row.

#### D4-7 — Reconnect reconciliation + self-owned mutation replay + budget adoption
- **Module · Layers:** D4 · Rust
- **Depends on:** D4-3, D4-6
- **Spec/Decision:** D4 §6.4, §8 D1/D7, §9.9/9.10; **Residual #8**
- **Acceptance criteria:**
  - On reconnect: **config** = server version always wins (one-directional, no conflict); **usage buffer** flushes (additive + idempotent); **self-owned benign writes** (`user_preferences`, own `conversations`/`messages`) replay via PostgREST under RLS **last-writer-wins by `modified_at`** (server-newer wins → local dropped with a `sync:drift` note); **budget headroom** = server-pushed value replaces cached advisory headroom.
  - Buffer back-pressure: soft-warn at a threshold; a hard ceiling blocks **new metered local calls** (fail-closed on spend) rather than dropping any buffered row.
- **Test scenarios:**
  - Given a stale cached `config_version`, When reconnecting, Then the newer server generation is adopted and cached headroom is replaced by the pushed authoritative value.
  - Given a preference toggled offline that was also changed elsewhere with a newer `modified_at`, When replayed, Then the server value wins and `sync:drift` surfaces.

#### D4-8 — Device liveness signals + sync/offline shell chips
- **Module · Layers:** D4 · Rust (writes `devices.*`) + Tauri IPC/events + SvelteKit shell
- **Depends on:** D4-6, P4 (`devices` table)
- **Spec/Decision:** D4 §4.6/4.7, §6.7, §9.12/9.13; O3 §3.3 (`buffer_health` shape)
- **Acceptance criteria:**
  - D4 updates `devices.last_seen`, `devices.config_version` (on apply), and `devices.buffer_health` (`{usage_queued, audit_queued, last_flush_at, oldest_pending_at, flush_status, clock_skew_ms}`) on each heartbeat/flush; O3's fleet reads them.
  - `sync_status()`/`buffer_stats()`/`config_version()` IPC + events (`sync:applied`, `sync:offline`, `sync:degraded`, `sync:drift`, `sync:revoked`, `buffer:enqueued`, `buffer:flushed`) back the D1 shell chips (`synced · config vNNN`, `syncing`, `offline`, `N calls queued`).
- **Test scenarios:**
  - Given N queued calls with a failing flush endpoint, When `buffer_stats()` is read, Then `queued=N` with an `oldest_ts`, and `devices.buffer_health` reflects it; retries drain the buffer once the endpoint recovers (no double-report).
  - Given a successful apply, When the shell renders, Then the chip reads `synced · config vNNN`.

### D3 · Split-plane router (full)

#### D3-1 — `RemoteGatewayAdapter` + same-registry desktop engine + hot-reload
- **Module · Layers:** D3 · Rust (`src-tauri`)
- **Depends on:** D2-1, D4-4, P5 (C1 `/v1/chat`·`/v1/embed`), **Residual #2**
- **Spec/Decision:** D3 §4.1, §6.2, §8.1; MIG-2 (registration mechanism)
- **Acceptance criteria:**
  - `RemoteGatewayAdapter` implements `ChatModel`/`EmbedModel`, authenticates to C1 with the **device token + user JWT only** (no provider credential), and is registered into the **same** `AdapterRegistry` as the D2 local adapters via `RegisterInto`.
  - Each local-capable model is exposed as two routers (`@local`→embedded adapter, `@cloud`→remote adapter); the desktop `Gateway` is built once and hot-reloads on D4 config change (`Gateway::update_config`).
  - Network unreachable / 5xx / timeout → `GatewayError` mapped to a `FallbackTrigger` (Timeout/ProviderError/RateLimit); `403 device_revoked`/`401` → non-fallback terminal error.
- **Test scenarios:**
  - Given a `cloud` step, When executed, Then the remote adapter is invoked (HTTP to C1) and the trace `adapter`/`execution_location` reflect it.
  - Given a D4 chain/plane change, When a subsequent `d3_infer` runs, Then it walks the new planes without an app restart.

#### D3-2 — Locality resolution (planned plane + `DeviceCtx` overlay → executed plane)
- **Module · Layers:** D3 · Rust
- **Depends on:** D3-1, D2-2 (readiness/hw), D4-3 (reachability), **Residual #3**
- **Spec/Decision:** D3 §4.2, §6.1, §8.3/8.6; DECISIONS §3 (no-hardcoded-ops — plane is operator config)
- **Acceptance criteria:**
  - For each step the **planned plane** = C2's `fallback_chain_models.plane`; the **executed plane** is derived by overlaying (in precedence) §3c pin → privacy/feature governance → capability viability (D2 `local_capable` + ready + hardware) → reachability → else planned.
  - A planned-`local` step that isn't viable is **skipped** (fallback advances); pull-and-wait is only enabled by a governed feature. D3 records **both** planned and actual on each `Attempt`.
- **Test scenarios:**
  - Given a step planned `local` whose model isn't downloaded, When resolved, Then D3 skips to the next step and records planned=`local`, actual=the served step.
  - Given `privacy_local_only` and a cloud-only chain, When resolved, Then no cloud step is viable.

#### D3-3 — Split-plane chain walk → one unified `ExecutionTrace` (GH-1)
- **Module · Layers:** D3 · Rust (single engine run)
- **Depends on:** D3-2, **GH-1 released**
- **Spec/Decision:** D3 §4.1, §6.2, §8.8, §9.1/9.2; gateway-issues GH-1
- **Acceptance criteria:**
  - A chain `[opus(cloud) → sonnet(cloud) → gemma(local)]` executed via `d3_infer` returns **one** `ExecutionTrace` whose attempts each carry `execution_location` matching the resolved plane; cloud attempts show a real C1-served answer, the local attempt (when reached) shows `$0`.
  - The single engine run (not a bespoke merge) produces the trace; a `cloud` step invokes the remote adapter and a `local` step the embedded adapter — asserted by trace `adapter` + `execution_location`.
- **Test scenarios:**
  - Given the three-step split chain, When executed, Then exactly one trace with three per-step `execution_location`s returns.
  - Given the same run, When the trace is inspected, Then cloud attempts name the remote adapter and the local attempt names the embedded adapter.

#### D3-4 — Offline behavior (local fallback / fail-fast) + streaming across planes
- **Module · Layers:** D3 · Rust + Tauri channel
- **Depends on:** D3-3, **Residual #4**
- **Spec/Decision:** D3 §6.4/6.5/6.9, §8.2, §9.3/9.4/9.11
- **Acceptance criteria:**
  - Network down + a chain with a viable local step → `d3_infer` returns a **locally-served** answer (trace shows cloud skipped/failed, local served, UI "served locally").
  - Network down + a cloud-only (or privacy-local-only + cloud-only) chain → `d3_infer` returns `offline_no_local_fallback` **immediately** and **queues no inference** (queue-and-retry applies only to the telemetry buffer, never a pending answer).
  - `d3_infer_stream` streams from a `local` or `cloud` step and ends with a `done` event (usage/cost + `trace_id`); a mid-stream cloud disconnect with no committed output falls back to a local step, with committed partial output it surfaces partial + explicit retry.
- **Test scenarios:**
  - Given the network down and a chain with a local step, When `d3_infer` runs, Then a local answer returns and the trace shows the cloud step skipped.
  - Given the network down and a cloud-only chain, When `d3_infer` runs, Then `offline_no_local_fallback` returns immediately and no inference is queued.

#### D3-5 — Unified `$0` local logging via D4 + trace stitching + revocation handling
- **Module · Layers:** D3 · Rust
- **Depends on:** D3-3, D4-6
- **Spec/Decision:** D3 §6.6/6.8, §8.4, §9.5/9.7; DECISIONS §2 (device-status hot path)
- **Acceptance criteria:**
  - Each **local** attempt produces exactly one `inference_calls` row (via the D4 buffer → C1 `service_role`) with `execution_location='local'`, `cost_usd=0`, correct tenant + subject-node attribution, and a stable idempotency key (re-flush does not duplicate); **cloud** attempts are ledgered by C1 at call time and D3 stitches the returned `inference_call_id`/`trace_id` (no double-log).
  - On a C1 `403 device_revoked`, D3 stops cloud attempts (terminal, no retry), emits a re-enroll event, and continues serving on a local step if the chain has one.
- **Test scenarios:**
  - Given a local attempt, When flushed and re-flushed, Then exactly one `inference_calls` row exists.
  - Given a revoked device mid-session, When a cloud step is attempted, Then C1 returns `403 device_revoked`, D3 stops cloud retries, and a local step still serves.

#### D3-6 — §3c pin-to-local orchestration + local→cloud redaction egress gate
- **Module · Layers:** D3 · Rust (orchestrates C5 `SecureExecutor` + C4 redaction)
- **Depends on:** D3-3, D2-6, C4 (P6 redaction), **Residual #1**
- **Spec/Decision:** D3 §6.7, §5, §8.5, §9.8; DECISIONS §2 W5 + §3c
- **Acceptance criteria:**
  - For a dataset with `plane_pin='local'` / sensitive columns that are **local-only decryptable**, D3 forces the compute step on-device (D2-6); only schema + non-sensitive aggregates + the derived result cross to a `cloud` step, **after the C4 on-device redaction pass** (one-way placeholders, v1). A payload carrying a raw sensitive value to the remote adapter is **blocked** (request fails rather than leak).
  - Central-DEK-encrypted sensitive datasets route the compute to central (Residual #1); the trace marks the compute step `local` (local-only) or forwarded (central).
- **Test scenarios:**
  - Given an Ask over a local-only dataset with a `sensitive` column, When it runs, Then only schema + aggregates + the derived result reach a cloud reasoning step and no raw sensitive value is in any remote-adapter payload.
  - Given a step that would send a raw sensitive value to cloud, When D3 evaluates egress, Then the request is blocked.

#### D3-7 — Tauri IPC surface (`d3_infer`/`_stream`/`d3_embed`/`d3_preview_plane`) + per-step badges
- **Module · Layers:** D3 · Rust IPC + SvelteKit (W2/W3 consumers)
- **Depends on:** D3-3, D3-4
- **Spec/Decision:** D3 §4.3, §4.5, §9.12
- **Acceptance criteria:**
  - `d3_infer`/`d3_infer_stream`/`d3_embed` back the Ask/Playground inference (desktop chat/embed goes through D3, not C1 directly), returning per-step `{model, plane_planned, execution_location, status, cost_usd}`; `d3_embed` returns a 1024-length embedding.
  - `d3_preview_plane` returns per-step planned + predicted planes and makes **no** cloud call and writes **no** `inference_calls` row (Playground preview); per-step execution-location events back the W2/W3 badges.
- **Test scenarios:**
  - Given `d3_preview_plane`, When called, Then it returns planned+predicted planes and records no ledger row and makes no cloud call.
  - Given `d3_infer` completes, When the response is read, Then each step carries its planned plane and actual `execution_location` for the badge.

### O3 · Device fleet & feature governance

#### O3-1 — Feature-governance data model finalization + anon lockdown + workspace seeding
- **Module · Layers:** O3 · DDL (dbd, from F1 RW6) → RLS → seed
- **Depends on:** P3 (RW6 DDL), P4 (`space.manage`/roles)
- **Spec/Decision:** O3 §3.1, §5.3, §6.1, §8.2/8.3, §9.1/9.8; DECISIONS §2/§4
- **Acceptance criteria:**
  - `config.modules`/`config.features` (registry: `governable`, `user_facing`, `default_state`, `mandatory`), reworked `config.feature_states` (`tenant_id`, `scope_type∈{workspace,space,role}`, `scope_id`, `state∈{locked,default_on,default_off,user_overridable}`, `value`, `version`), and `app.user_preferences` exist with the documented uniqueness + composite FKs.
  - `feature_states` is **`service_role`-write-only and not client-`SELECT`able** (anon/`authenticated` INSERT/UPDATE/DELETE **denied** — the built anon hole is closed); `user_preferences` is owner-write/owner-read.
  - On tenant creation, one `scope_type='workspace'` row per `governable` feature is seeded from `features.default_state` (idempotent under `dbd import`); `mandatory` features get **no** row.
- **Test scenarios:**
  - Given an `anon`/non-`feature.manage` caller, When they attempt to write `feature_states` via PostgREST, Then denied (only `/rpc/governance/set-feature` succeeds).
  - Given `dbd reset && apply && import`, When it completes, Then the seed tenant has one workspace row per `governable` feature and zero rows for `mandatory` features.

#### O3-2 — Precedence resolver (`config.resolve_feature_state(s)`) + C1 Rust mirror + offline parity
- **Module · Layers:** O3 · SQL (`SECURITY DEFINER`) + Rust (C1 + device)
- **Depends on:** O3-1, D4-2 (snapshot `feature_governance` block)
- **Spec/Decision:** O3 §4.1/4.2/4.5, §5.6, §6.5/6.6, §8.6, §9.3–9.7; DECISIONS §4
- **Acceptance criteria:**
  - `config.resolve_feature_state(feature_slug, space_id?)` (+ bulk `resolve_feature_states`) implements: mandatory floor → **locks broadest-wins** (workspace>space>role) → **non-locked most-specific-wins** (role>space>workspace) → user layer only where `user_overridable`; returns `{enabled, governed, source}` only (no policy rows leak); uses `auth.jwt()` tenant + `core.jwt_role_ids()` + `auth.uid()`.
  - C1 mirrors the identical algorithm in Rust from the config snapshot; the device re-runs the **same** algorithm on the cached `feature_governance` block so offline renders match online.
  - A governed runtime feature (e.g. `grounded-only` `locked` on) is enforced by C4 regardless of a forged/omitted client toggle or a `user_preferences` value.
- **Test scenarios:**
  - Given workspace=`locked`/off + space=`default_on`, When resolved for a member in that space, Then `{enabled:false, governed:true, source:'locked@workspace'}` on both server and offline device.
  - Given a `locked` feature, When a member sets `user_preferences`, Then resolution still returns the locked value (user layer inert).

#### O3-3 — Governance write/read RPCs + `config_version` bump + audit
- **Module · Layers:** O3 · HTTP (C1 `/rpc/*`) → audit
- **Depends on:** O3-2, D4-1 (version bump), P6 (O1 audit)
- **Spec/Decision:** O3 §4.3/4.4/4.7, §6.2/6.3, §8.5, §9.2/9.15; DECISIONS §2 W1
- **Acceptance criteria:**
  - `POST /rpc/governance/set-feature` (cap `feature.manage`) upserts one `feature_states` row, **bumps the tenant `config_version`**, and emits `feature.governance_set` (`actor_id=auth.uid()`); it rejects a `scope_id` mismatched to `scope_type`, a `state` outside the 4 values (`400`), a space-scope write by a caller lacking `space.manage` on that space, and a narrower override under a broader `locked` (`409 locked_by_workspace`).
  - `POST /rpc/governance/clear-feature` reverts to the next-broader scope/default; `GET /rpc/governance/matrix?space_id=` (cap `feature.manage`) returns raw per-scope policy rows (members never get raw rows — they use the resolver verdict).
- **Test scenarios:**
  - Given workspace=`locked`, When a space owner attempts a space-scope override, Then `409 locked_by_workspace`.
  - Given a `set-feature` write, When it commits, Then `config_version` bumps, an audit row with the caller's `actor_id` exists, and a subscribed device re-resolves without a restart.

#### O3-4 — Device fleet read model + admin actions (list / health / sync-policy / revoke)
- **Module · Layers:** O3 · DDL (dbd — `devices.sync_policy` jsonb) → HTTP (C1 `/rpc/*` + F2 endpoints) → SvelteKit-ready read model
- **Depends on:** O3-3, P4 (F2 `devices`, revoke), D4-8 (`buffer_health`)
- **Spec/Decision:** O3 §3.2/3.4, §4.3/4.4, §5.4, §6.7/6.8/6.9, §9.10/9.11/9.13
- **Acceptance criteria:**
  - `devices.sync_policy jsonb` (`{config_pull, pull_interval_s, offline_grace_h, buffer_flush}`) column exists (small dbd delta), seeded per tenant, edited only via `POST /rpc/devices/set-sync-policy` (cap `device.manage`, audited `device.sync_policy_changed`); D4 reads it.
  - The fleet read model (`GET /v1/devices` under RLS — own-vs-`device.manage`) lists `last_seen`, `app_version`, `config_version` (with drift vs tenant current), a `buffer_health` verdict (healthy/flushing/stale/failed), and `sync_policy`; `public_key`/token material never appears.
  - **Revoke** orchestrates F2's `POST /v1/devices/:id/revoke` (O3 adds no parallel device-write path).
- **Test scenarios:**
  - Given a member without `device.manage`, When they read the fleet, Then only their own devices appear.
  - Given `/rpc/devices/set-sync-policy` without `device.manage`, When called, Then `403`; with it, the change is audited.

#### O3-5 — Device-status hot-path budget contract + observability
- **Module · Layers:** O3 · Rust (constrains F2 `DeviceGuard` in C1 middleware) + observability
- **Depends on:** O3-4, P4 (F2 `DeviceGuard`), P5 (C1 middleware order)
- **Spec/Decision:** O3 §4.6, §5.4, §6.8, §8.7, §9.11/9.12; DECISIONS §2 (device-status hot-path)
- **Acceptance criteria:**
  - `DeviceGuard::check` runs **before** the C3 budget reserve; on a warm cache hit it adds `< 1 ms` p99 and issues **zero** synchronous DB round-trips on the hot path (asserted via the C1 request trace / query counter).
  - A revoked device is rejected `403 device_revoked` within **≤ 30 s** (cache TTL) or **immediately** on the `devices` Realtime signal, despite a valid unexpired JWT — and **no** `inference_calls` row is written for the rejected call.
- **Test scenarios:**
  - Given a warm `DeviceGuard` cache, When a `/v1/chat` runs, Then the device check adds `<1 ms` p99 and issues zero synchronous DB queries.
  - Given a device revoked via the fleet, When it presents a live JWT to `/v1/chat`, Then `403 device_revoked` within ≤30s/immediately-on-Realtime and no ledger row is written.

---

## Dependency graph

```mermaid
graph TD
  subgraph Prereqs
    GH1[GH-1 released: per-step plane + execution_location]
    P3[P3 F1-rework: config_versions/feature_states/buffer_health/plane]
    P4[P4 F2/F3: device JWT + DeviceGuard + capabilities]
    P5[P5 C1/C2/C3: /rpc + /v1/chat + chains(plane) + reserve→commit]
    P6[P6 O1/C4/C6: audit + redaction + quality signals]
  end

  %% D2
  P3 --> D2_1[D2-1 engine assembly]
  D2_1 --> D2_2[D2-2 registry/catalog/fit]
  D4_2 --> D2_2
  D2_2 --> D2_3[D2-3 download lifecycle]
  D2_3 --> D2_4[D2-4 storage/GC/defaults]
  D2_1 --> D2_5[D2-5 1024-dim embed + local RAG]
  D2_4 --> D2_5
  D2_5 --> D2_6[D2-6 §3c local-only compute]

  %% D4
  P3 --> D4_1[D4-1 config_versions + bumps]
  D4_1 --> D4_2[D4-2 snapshot pull + delta]
  P4 --> D4_3[D4-3 Realtime subs]
  D4_2 --> D4_4[D4-4 fail-closed hot-reload]
  D2_1 --> D4_4
  D4_2 --> D4_5[D4-5 offline cache + bootstrap]
  D4_5 --> D4_6[D4-6 signed idempotent buffer → C3/O1]
  GH1 --> D4_6
  D4_3 --> D4_7[D4-7 reconnect reconciliation]
  D4_6 --> D4_7
  D4_6 --> D4_8[D4-8 liveness signals + chips]

  %% D3
  D2_1 --> D3_1[D3-1 RemoteGatewayAdapter + registry]
  D4_4 --> D3_1
  P5 --> D3_1
  D3_1 --> D3_2[D3-2 locality resolution]
  D2_2 --> D3_2
  D4_3 --> D3_2
  D3_2 --> D3_3[D3-3 unified split-plane trace]
  GH1 --> D3_3
  D3_3 --> D3_4[D3-4 offline fallback + streaming]
  D3_3 --> D3_5[D3-5 $0 ledger + revocation]
  D4_6 --> D3_5
  D3_3 --> D3_6[D3-6 §3c pin + redaction egress]
  D2_6 --> D3_6
  D3_3 --> D3_7[D3-7 Tauri IPC + preview + badges]
  D3_4 --> D3_7

  %% O3
  P3 --> O3_1[O3-1 governance model + lockdown + seed]
  O3_1 --> O3_2[O3-2 resolver + C1 mirror + offline parity]
  D4_2 --> O3_2
  O3_2 --> O3_3[O3-3 governance RPCs + version bump + audit]
  D4_1 --> O3_3
  O3_3 --> O3_4[O3-4 fleet read model + revoke/sync-policy]
  D4_8 --> O3_4
  O3_4 --> O3_5[O3-5 device-status hot-path budget]
  P4 --> O3_5

  %% Acceptance gate consumers
  O3_3 --> GATE[[P10 gate]]
  D4_4 --> GATE
  O3_5 --> GATE
  D4_7 --> GATE
```

**Reading it:** the two hinges are **D4-2** (versioned snapshot — every consumer's config comes through it,
including D2's catalog/governance and O3's resolver parity) and **GH-1 → D3-3** (the unified trace, which
D4-6's `execution_location` buffer and O3's exec-badges all depend on). D2 and O3-1/2 can start as soon as
P3 is green; D3 cannot land its full trace until GH-1 is released and D4-4 gives it a hot-reloadable engine.

---

## Suggested build order

Bottom-up by dependency; parallelizable lanes noted. (Sequence subagents one-at-a-time near a usage limit —
`feedback_subagents_near_limits`.)

1. **Foundation (parallel):** **D4-1** (config_versions + bumps, dbd) ‖ **O3-1** (governance model + lockdown + seed, dbd) ‖ **D2-1** (engine assembly). *These are the schema/boot base.*
2. **Snapshot spine:** **D4-2** (snapshot pull + delta/304). Unblocks D2-2, D4-4/5, O3-2.
3. **D2 lane (parallel with D4/O3 lanes):** **D2-2 → D2-3 → D2-4 → D2-5 → D2-6**.
4. **D4 lane:** **D4-3** (Realtime) ‖ **D4-4** (hot-reload, needs D2-1) → **D4-5** (cache/bootstrap) → **D4-6** (signed buffer, needs GH-1) → **D4-7** (reconciliation) ‖ **D4-8** (liveness/chips).
5. **O3 lane:** **O3-2** (resolver + mirror, needs D4-2) → **O3-3** (RPCs + version bump, needs D4-1) → **O3-4** (fleet + sync-policy, needs D4-8) → **O3-5** (hot-path budget).
6. **D3 lane (last — needs D2-1, D4-4, GH-1):** **D3-1 → D3-2 → D3-3** (unified trace) → { **D3-4**, **D3-5** (needs D4-6), **D3-6** (needs D2-6), **D3-7** }.
7. **Acceptance gate E2E** (below) → `make clean` → push `develop`.

---

## Phase acceptance gate (observable, end-to-end)

The phase is done when this single Given/When/Then passes on a real desktop build against a live C1:

- **Given** an enrolled, `active` desktop device synced to tenant-A config (chain `web-search@space-X`
  bound with a per-step plane), a signed-in admin in **W1**, and the network up —
- **When** the admin edits that chain in W1 (a `/rpc/chains/*` write that bumps `config_versions.version`),
- **Then** (1) the `tenant:{A}:config` Realtime channel notifies the device, D4 pulls a **delta**, and a
  subsequent `d3_infer` on the desktop **walks the new chain without a restart** (`devices.config_version`
  reflects the new version) — **live hot-reload + enforcement**;
- **And Given** the admin then **revokes** that device (fleet **Revoke** → F2), **When** the device (still
  holding a valid unexpired JWT) issues a `cloud` step, **Then** C1's `DeviceGuard` returns `403
  device_revoked` within ≤30 s / immediately on the Realtime signal, **no `inference_calls` row is written**
  for it, and the local plane still answers — **revoked device blocked on the C1 hot path**;
- **And Given** the device ran local `$0` calls while offline (buffered, Ed25519-signed, sequenced), **When**
  it reconnects and flushes, **Then** every buffered call appears in `inference_calls` **exactly once**
  (`execution_location='local'`, correct node attribution); a **replayed batch (reused `buffer_seq`) is
  rejected** and a **duplicate `idempotency_key` is a 200 no-op** — **idempotent reconciliation, no
  under-report / no replay**.

Supporting negative-test gate (extends `tests/authz.sql` + the C1/C3 integration harness): a cross-tenant
Realtime subscribe delivers 0 rows; a snapshot response contains no credential/key/token; a revoked
device's flush is rejected (`status != active`); a device cannot flush a call attributed to a
`leaf_node_id` it doesn't own; an `anon`/non-`feature.manage` write to `feature_states` is denied.

## Deferred (flagged, out of P10)
- **On-device DEK custody for §3c** (raw sensitive values decrypted on-device) — deferred to a future F3
  issue (Residual #1); v1 §3c on-device compute is local-only-datasets, central-DEK datasets route central.
- **Accelerator (GPU) fit-gating / layer selection** — advisory-only in v1 (Residual #12); a first-class
  cross-platform probe is a later optional crate issue.
- **W1 Device-fleet / Feature-management *screens*** (P8) and **W2/W3 exec-location badges + Playground
  split-plane preview UI** (P9) — P10 delivers the backend read models + IPC + events they consume.
- **HF-search-backed local catalog** — v1 uses the operator-governed catalog + curated defaults (Residual #6).
