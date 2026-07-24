# W2 · Member Console — Spec

**Module:** [W2](../modules/W2-member-console.md) · **Status:** Planned — build-ready · **Plane:** Web client (reused verbatim in desktop D1) · **Domain:** `app.strategos.sensei-hq.com`
**Depends on:** [W4](../modules/W4-design-system.md) (Rokkit tokens/atoms), [F2](./F2-identity-auth-rbac.md) (Supabase auth, JWT claims, capability set), [C1](./C1-gateway-service.md) (inference + gateway-mediated write RPC), [C5](./C5-rag-document-intelligence.md) (Library/document center + retrieval + datasets), [C6](./C6-quality-signals.md) (live meters + explicit-feedback capture) · **Hosts:** [W3](../modules/W3-playground.md) (Playground authored there, mounted here) · **Owns design-only:** X2 Workflows/agent-builder surfaces
**Enables:** the member-facing product (Workspace/Ask/Library/Activity/Settings) on web and inside the desktop shell (D1).
**Date:** 2026-07-23 · **Framework:** SvelteKit + Svelte 5 (Runes) + Rokkit · **Runtime:** static SPA served at `app.` (Cloudflare) + embedded in the Tauri desktop shell (D1)

---

> **Authority.** [`../DECISIONS.md`](../DECISIONS.md) is the single source of truth for scope/architecture/security; the mockups under `docs/mockups/app/*.jsx` are the authoritative **UI** ground truth. This spec turns the ratified member surface into a buildable client contract. It **invents no screens** beyond the ratified set (`docs/design/mockup-review.md` §A–G + the member views `app.jsx`, `view-workspace/ask/library/library-doc/workflows/workflows-builder`); every gap it depends on is tracked as a numbered `mockup-review.md` item.
>
> **W2 is a pure client.** It holds a **client-only Supabase session** (never `service_role`), reads tenant data via **PostgREST under RLS** + module HTTP APIs, and performs **every privileged mutation through C1 `/rpc/*`** (DECISIONS §2 W1). All capability gating in the UI is **UX affordance only** — the server is the sole authority (F2 §5, C1 §5).

---

## 1. Purpose & scope

W2 is the **member-facing workspace**: the surface a non-admin user works in every day — ask questions grounded in their spaces, manage documents, review their activity/spend, and tune personal preferences. It is served as a web SPA at `app.` and **reused verbatim inside the desktop shell** (D1), where the same screens gain local-plane execution, offline states, and a desktop-only Local-models surface (owned by D2, not W2).

**In scope (screens W2 builds):**
- **Workspace / Home** — orientation ("your lane": active space, allowed models, budget ceiling), recent work, space switcher, quick-start.
- **Ask** — grounded conversational Q&A over accessible spaces: conversation/message **persistence**, per-answer **execution badge** + model/tier + cost + **"why this model"** trace, **live quality meters** (grounding/quality/cost/latency) + **explicit feedback** (thumb/rating/accept/edit/retry/correction), **multi-space** ask, **citation → open-at-chunk** (bbox evidence-pin), offline behaviour.
- **Library → document workspace** (§3a) — collections/folders/tags, version history, source→artifact **lineage**, **dedup** indicator + download-original, **extracted-asset browser** (rendered md / table-as-data-grid / image gallery), **chunk inspector**, **ingestion-status** pipeline (queued→parsing→chunking→embedding→ready/failed), preview pane, bulk actions, and the space-settings entry (owner).
- **Activity** — personal request/spend history with **execution-location** + device columns, filters, offline-queued reconciliation, and the **budget-increase request** flow.
- **Settings** — personal preferences rendered through the **4-state governance model** (some shown **locked**), backed by `user_preferences`.
- **Design-only surfaces (v1 screens, v2 runtime — X2/§3a/§3c):** the **collaborative** doc surfaces (comment threads, suggestion/correction review, a **chat-to-edit** panel where an agent performs edits, per-doc collaborators), the **"ask the data"** §3c structured-data surface, and the **Workflows / agent-builder** screens.

**Hosted, not owned:** the **Playground** screen and all retrieval-lab controls (mode selector, weight slider, rerank picker, chunking selector, inspector, promote-to-default, compare) are **authored in [W3](../modules/W3-playground.md)** and mounted under the console's **Tools** nav group; W2 provides the route slot + shell only.

**Out of scope (owned elsewhere):** all admin/tenant governance (W1 admin portal — separate SPA `admin.`); the Playground internals (W3); the inference/RAG/quality engines (C1/C5/C6); auth wiring, JWT minting, device enrollment RPC (F2); the desktop shell, local gateway, split-plane router, config-sync, and the desktop-only **Local models & downloads** screen (D1/D2/D3/D4); the marketing site (W5). W2 **never** writes a privileged table directly and **never** computes budgets/redaction/routing client-side.

---

## 2. Responsibilities

1. Render the ratified member screens on Rokkit (W4 tokens), pixel-faithful to `docs/mockups/app/*.jsx` and reconciled to `mockup-review.md`.
2. Hold a **client-only Supabase session** (email/password + Google/GitHub OAuth via F2), attach the access token as `Authorization: Bearer` to every C1/C5/C6 call, and refresh silently on `token_stale`/expiry.
3. Resolve the caller's **capabilities + identity + budget ceiling** from `GET /v1/whoami` and **gate UI affordances** accordingly (hide/disable controls the caller lacks) — never as a security boundary.
4. Drive **Ask**: create conversations, stream answers over SSE, render exec-badge / model / cost / "why-this-model", surface live meters + explicit feedback, resolve citations to the source chunk, persist user turns as self-owned benign writes.
5. Drive the **Library document workspace**: upload → signed-URL PUT → ingest, subscribe to ingestion-status Realtime, browse extracted assets/lineage/versions/chunks, dedup/original affordances, bulk actions, and (owner) the space-settings entry.
6. Render **Activity**: read-only spend/request history with execution-location + device + offline-queued state and filters; submit **budget-increase requests** via C1 RPC and reflect their approval status.
7. Render **Settings**: apply the 4-state precedence (workspace→space→role→user), showing governed toggles **locked** where not `user-overridable`, and persist the user layer to `user_preferences` (self-owned write).
8. Mount the W3 **Playground** and the design-only **Workflows/agent-builder**, **"ask the data"**, and **collaborative** surfaces (rendered, non-functional runtime where noted).
9. Surface **cross-cutting states everywhere**: execution-location badge (per-step plane, not provider), desktop-vs-web capability affordances, offline banner, device/sync chip, **redaction "N items redacted"** indicator, and the **locked-toggle** visual for governed controls.
10. On desktop (via D1), route local-plane operations (local inference, on-device ingestion/retrieval, §3c local compute) through the D2/D3 IPC bridge, and buffer usage/audit **signed + idempotent** while offline.

W2 does **not**: enforce authz, compute budgets, redact content, route/select models, embed/retrieve, own any F1 table, or hold any secret/`service_role` credential.

---

## 3. Data model (F1 tables — used; W2 owns none)

W2 authors **no schema**. It is a **read client** (PostgREST `SELECT` under RLS + module read-model endpoints) and performs a **narrow set of self-owned benign writes** (DECISIONS §2 W1); everything else is a C1 `/rpc/*` call. Tables below are owned by F1 and the module named.

### 3.1 Read (PostgREST `SELECT` under RLS, tenant + classification scoped)

| Table | Owner | W2 use |
|---|---|---|
| `conversations` / `messages` / `message_citations` | C1/C4 (Ask) | Render Ask threads; a citation resolves message → `document_embeddings` chunk + `document_assets` bbox (open-at-chunk). |
| `documents` / `document_collections` / `document_versions` / `document_assets` / `document_embeddings` | C5 | Library index, document workspace (preview/lineage/versions/chunk inspector), dedup indicator (`content_hash`), status pipeline. |
| `datasets` / `dataset_columns` | C5 (§3c) | "Ask the data" schema view + column-sensitivity display (values never fetched client-side). |
| `spaces` / `space_members` | F1/W1 | Space switcher, "your lane", scope chips, per-space classification, space-settings entry (owner). |
| `budget_nodes` | C3 | Read-only "ceiling" meter on Home + Activity (client-facing metering is read-only, §2 W2). |
| `budget_requests` | C3 | Show the member's own pending/approved/denied increase requests. |
| `prompt_templates` | C5/W1 | Shared + own templates for Ask "Draft" and Reusable-assets. |
| `roles` / `role_permissions` (via `/v1/whoami`) | F2 | Resolve capabilities to gate UI (read via whoami, not raw table). |
| `settings` / `feature_states` / `user_preferences` | W1/O3 | 4-state governance resolution for Settings + governed toggles. |
| `quality_signals` (read model via `/v1/meters`, `/v1/signals`) | C6 | Live meters + inspector + "why this model"; W2 reads its own subject rows only. |
| `devices` | F2/O3 | Device/sync chip, offline-buffer health (self rows). |

### 3.2 Self-owned benign writes (RLS: `owner_id`/`actor_id = auth.uid()`, no capability)

| Table | Write | Notes |
|---|---|---|
| `user_preferences` | INSERT/UPDATE own | Settings user layer (only where the governed key is `user-overridable`; RLS + C4 resolution reject an override of a `locked` key). |
| `conversations` | INSERT/UPDATE own | Create a thread + rename/delete own thread; `owner_id = auth.uid()`. |
| `messages` | INSERT own **user turns** | The user's prompt turns. **Assistant turns, `message_citations`, and the `inference_call` linkage are written by C1/C4** during the Ask flow (§6.1) — W2 does not fabricate them. |
| `documents` (own draft metadata) | INSERT/UPDATE own draft | Title/collection/tags on **own draft** docs (`scope='individual'`, `owner_id=auth.uid()`). Classification **downgrade** is NOT a benign write — it routes through `/rpc/spaces/declassify-doc`. |

### 3.3 Everything else → C1 `/rpc/*` (never a direct write)

Budget-increase request/approval, space create/join/member changes, doc **declassify**, retrieval-config promote, dataset sensitivity policy, feedback signal capture — all go through the gateway-mediated write path (§4). W2 issues the call and renders the result; it holds no write authority over any privileged column.

---

## 4. Contracts

W2's "contracts" are its **consumption contracts** (the module APIs it calls), its **route/data-layer shape**, and the **desktop IPC** it uses. It exposes no server API of its own.

### 4.1 SvelteKit route map (member SPA)

Nav mirrors `app.jsx` exactly (three groups): **Workspace** {Home, Ask, Library} · **Tools** {Playground, Workflows} · **You** {Activity, Settings}.

| Route | Screen | Source view | Notes |
|---|---|---|---|
| `/(app)/home` | Workspace/Home | `view-workspace.jsx` | "Your lane", recent, space grid, quick-start. |
| `/(app)/ask` | Ask | `view-ask.jsx` | Full-bleed; conversation + context rail. |
| `/(app)/library` | Library index | `view-library.jsx` | Collections/tags/bulk/storage; opens the doc workspace. |
| `/(app)/library/[documentId]` | Document workspace | `view-library-doc.jsx` | Preview / Chunks / Lineage / Versions tabs; design-only collaborate tab. |
| `/(app)/playground` | Playground (**W3**) | `view-playground.jsx` | Route slot only; W3 owns the component. |
| `/(app)/workflows` + `/workflows/[id]` | Workflows (**design-only, X2**) | `view-workflows(.builder).jsx` | Agent runtime badged **"v2 · preview"**; no runtime wiring. |
| `/(app)/activity` | Activity | `view-requests.jsx` | Spend/requests + budget-increase request. |
| `/(app)/settings` | Settings | `app.jsx` `SettingsView` | 4-state governed prefs. |
| `/(auth)/signin` | Sign-in | `view-signin.jsx` | Email + Google/GitHub (F2); SAML shown stubbed. |

Shared shell (rail, chrome, workspace switcher `⌘K`, mobile tabs, device footer) is Rokkit-ported from `app.jsx`/`StrategosShell`.

### 4.2 HTTP consumed — C1 (inference + gateway-mediated writes)

All calls carry `Authorization: Bearer <supabase-jwt>`; base `https://api.strategos…/v1`.

| Call | Purpose (W2) |
|---|---|
| `GET /v1/whoami` | Resolve `{tenant_id, identity, capabilities[], device_status}` → capability-gate the UI, set active-tenant context. |
| `POST /v1/chat/stream` (SSE) | Ask: stream the grounded answer; body carries `messages`, `space_id`, `conversation_id`; final `done` event carries usage/cost/`inference_call_id`/`trace_id`. |
| `POST /v1/chat` | Non-streaming fallback / short tasks. |
| `POST /rpc/budgets/request-increase` | Activity/Settings: submit a `budget_requests` row (any member). |
| `POST /rpc/spaces/add-member` / `remove-member` / `declassify-doc` / `update` | Space-owner actions surfaced in Library/space-settings (capability-gated; server re-checks). |

**Compare / `/v1/embed` / `/v1/generate`** are Playground concerns (W3) — W2 does not call them directly.

### 4.3 HTTP consumed — C5 (Library / document center / datasets)

| Call | W2 use |
|---|---|
| `POST /v1/documents` → `{document_id, upload_url, version_no}` | Register upload; then client `PUT`s bytes to `upload_url`. |
| `POST /v1/documents/:id/ingest` / `:id/reingest` | Begin/re-run the pipeline (re-process button). |
| `GET /v1/documents/:id` (+ `?watch=1` SSE) / `GET /v1/documents/:id/assets` | Status + versions; signed asset URIs for preview (md/csv/image/original). |
| `GET /v1/documents?space_id=&collection=&tag=&status=` | Library index + filters. |
| `DELETE /v1/documents/:id` | Delete (capability `doc.delete`; gated). |
| `POST /v1/spaces/:space_id/retrieve` | "Ask this doc" scoping + citation provenance (Ask itself is orchestrated by C1/C4, which calls retrieve server-side). |
| `GET /v1/spaces/:space_id/retrieval-config` | Read-only display of space retrieval defaults; **promote/PUT is W3-gated**. |
| `POST /v1/datasets/:id/compute` | "Ask the data" (§3c) — design-only in v1: W2 renders the request/response shape (schema-to-LLM → aggregate/k-anon result), never raw values. |

Ingestion status arrives on the RLS-scoped Realtime channel `documents:<space_id>` (payload `{document_id, status, status_reason, stage_ms}`) — the primary transport for the Library status UI.

### 4.4 HTTP consumed — C6 (meters + explicit feedback)

| Call | W2 use |
|---|---|
| `GET /v1/meters?message_id=… \| inference_call_id=…` | Ask live meters (grounding/quality/cost/latency + why-model + redaction_hits). |
| `POST /v1/signals/feedback` | Explicit capture: `{inference_call_id?|message_id?, key: rating\|thumb\|accept\|edit\|retry\|correction, value_*}`. Server binds `actor_id=auth.uid()`, redacts `value_json` (W5). No special capability. |
| `GET /v1/signals?message_id=…` | Inspector/debug view of a turn's signals. |

The meter read model may be subscribed via an RLS-scoped Realtime channel for in-flight updates during a streaming answer.

### 4.5 Auth (F2, Supabase JS client)

`supabase.auth.signInWithPassword` / `signInWithOAuth({provider:'google'|'github'})` / `signOut` / `onAuthStateChange`. The client is **client-only** (no `service_role`), stores the session per platform (web: memory/secure cookie; desktop: via D1 IPC into the OS keychain). SAML SSO renders as a **stubbed/fast-follow** step (F2 §8.1). On `401 token_stale` W2 forces a silent refresh (F2 §4.1.1).

### 4.6 Desktop reuse & IPC (D1/D2/D3)

W2's screens are reused **verbatim** in the desktop shell. **Only** the **Local models & downloads** screen is **desktop-only** (owned by D2, mounted into the desktop nav — not part of the web build). Behavioural deltas on desktop:

- **Execution plane:** on desktop, local-capable chains may resolve to the in-process engine; the exec-badge shows `ran on your device` (per-step `plane=local`, GH-1) vs `via gateway · <region>`. W2 reads the plane from the response/trace — **never** keys "local" off a provider name (`mockup-review` #49).
- **Local-plane calls (via D1→D2/D3 IPC):** `c5_ingest_document`, `c5_document_status`, `c5_retrieve`, `c5_dataset_compute` (C5 §4.2) and local inference for Ask when offline/pinned-local. Sensitive datasets (`plane_pin='local'`) compute on-device only.
- **Offline:** when the cloud gateway is unreachable, Ask falls back to local models (if enrolled/available); usage + audit are buffered **signed + idempotent** (anti-replay/anti-under-report, §2 apply-without-asking) and flushed on reconnect. Web has no local fallback — it shows the offline banner and disables cloud-only actions.
- **Session:** desktop sessions carry the `device_id` claim; the device/sync chip mirrors `device_status()` (F2 §4.7).

### 4.7 Client-internal contracts (data layer + capability gating)

```ts
// One typed gateway client wraps every module call; injects the bearer token, maps RFC-7807
// errors to toast/inline states, and centralizes retry/refresh on 401 token_stale.
interface GatewayClient {
  whoami(): Promise<WhoAmI>;                              // { tenant_id, identity, capabilities, device_status }
  chatStream(req: ChatReq): AsyncIterable<StreamChunk>;   // SSE; final chunk = { usage, cost, inference_call_id, trace_id }
  meters(subject: SignalSubject): Promise<Meters>;
  feedback(sig: ExplicitSignal): Promise<{ signal_id: string }>;
  rpc<T>(path: `/rpc/${string}`, body: unknown): Promise<T>;  // gateway-mediated privileged writes
}

// Capabilities gate affordances only. `can()` never authorizes — the server re-checks every write.
// A control the caller lacks is hidden or rendered disabled+locked; attempting it still 403s server-side.
function can(caps: Set<Capability>, cap: Capability): boolean;

// 4-state governance resolution for a preference/feature key (precedence workspace→space→role→user).
type GovState = 'locked' | 'default-on' | 'default-off' | 'user-overridable';
function resolveGov(key: string, ctx: GovContext): { state: GovState; value: boolean; editable: boolean };
```

Capabilities referenced by W2 (all F2-owned, §4.3): `doc.read`/`doc.write`/`doc.delete`/`doc.declassify`, `space.join`/`space.manage`, `budget.read`/`budget.request`, `template.manage`, `dataset.compute`, `analytics.read`. W2 mints **no** capability.

### 4.8 Events / realtime consumed

- `documents:<space_id>` (Realtime, RLS-scoped) — ingestion-status transitions → Library pipeline UI.
- meter channel (Realtime, RLS-scoped, per conversation/tenant) — in-flight live-meter updates during a stream.
- `devices` update (Realtime) — device revoked/sync-state → chip + forced re-auth affordance.
- Supabase `onAuthStateChange` — session lifecycle.

---

## 5. Security & RLS

- **No elevated credential, ever.** W2 runs with a **client-only Supabase session**; it never holds `service_role` or any provider secret. Reads are PostgREST under RLS (tenant + classification scoped); every privileged write is a C1 `/rpc/*` call that re-checks the capability server-side (DECISIONS §2 W1, C1 §5, F2 §5.5).
- **Capability gating is UX-only.** `can()` hides/disables controls for legibility; it is **not** a security boundary. A member who forges a request to a `/rpc/*` they lack still receives `403` (verified by the F2/C1 negative tests). W2 must degrade gracefully on `403` (surface "you don't have permission"), not assume the gate held.
- **Tenant isolation.** All data is fetched with the caller's JWT; RLS returns only own-tenant rows. W2 renders the **active-tenant** claim only; a tenant switch re-mints the token (F2 §8.5). Cross-tenant ids yield 0 rows.
- **Classification-aware rendering.** Ask answers and Library items are already filtered server-side by space membership + the fixed 4-level classification; W2 shows the classification chip and the "confidential content masked for members without space access" note, and never attempts to surface a doc/chunk the API withheld.
- **Redaction (§2 W5, one-way v1).** W2 **never receives raw secrets/PII** — ingestion redacts at rest and C1/C4 redact in-flight before egress. W2 renders the **"N items redacted"** chip (from `implicit.redaction_hit` counts) and a "what was redacted" affordance in the why-this-model/Activity trace; there is **no** client-side reveal of original secret material in v1 (no reversible mapping). Explicit `correction`/`edit` feedback the user types is redacted server-side (C6 §5) before store.
- **Device revocation.** A revoked device with a live JWT is rejected on the C1 hot path (`403 device_revoked`); W2 surfaces this as a forced re-auth/"device revoked" state rather than retrying.
- **Self-owned writes only.** The only client-direct writes are the §3.2 self-owned rows (RLS binds `owner_id = auth.uid()`); a member cannot escalate a role, raise a budget, join a confidential space, declassify a doc, or forge a signal/audit row via PostgREST — those paths are `service_role`-write-only.
- **Offline integrity (desktop).** Buffered usage/audit entries are **signed + idempotent** so a replay cannot double-count and a drop cannot under-report; the gateway reconciles on flush (§2 apply-without-asking).
- **No secret logging.** The client logs no tokens; access tokens live only in the auth client / OS keychain (desktop). Realtime channels are RLS-scoped (a channel cannot leak another tenant's events).

---

## 6. Key flows

**6.1 — Ask (grounded, streaming, persisted).**
1. User picks a task (Find/Summarize/Draft/Compare) and a scope (one or more spaces via the `⌘K` switcher); W2 creates/loads a `conversation` (self-owned) and appends the user turn (`messages`, self-owned).
2. W2 `POST /v1/chat/stream` with `{messages, space_id(s), conversation_id}`. **C1/C4** run device-check → budget reserve → C5 retrieve → redact-in-flight → engine `execute_stream` → redact output → persist the assistant `message` + `message_citations` + `inference_calls`/`execution_traces`.
3. W2 streams tokens into the answer; on the `done` event it records `{inference_call_id, trace_id, usage, cost, execution_location}`.
4. W2 renders the **exec-badge** (from `execution_location`/per-step plane — not provider), the answering **model + tier**, **cost** (0/`free` when local), and the **"why this model"** panel (from `trace_id` → C6 `implicit.why_model`).
5. W2 pulls `GET /v1/meters?message_id=…` (and/or Realtime) → renders **grounding/quality/cost/latency** meters + the **"N redacted"** chip.
6. User gives **explicit feedback** (thumb/rating/accept/edit/retry/correction) → `POST /v1/signals/feedback` → chip confirms capture. *(Ask feedback control + meter parity is `mockup-review` #45/#31.)*

**6.2 — Citation → open-at-chunk.** Clicking a citation superscript resolves `message_citations` → `{document_id, chunk_id, page_ref, bbox}` → navigates to `/(app)/library/[documentId]`, opens the **Chunks**/**Preview** tab, scrolls to the chunk, and highlights the **bbox evidence-pin** on the rendered asset (`mockup-review` #51).

**6.3 — Library upload → ingest → browse.**
1. Drop a PDF/DOCX/PPTX/XLSX/image → `POST /v1/documents` → `PUT` bytes to the signed URL → `POST /:id/ingest`.
2. Subscribe to `documents:<space_id>` Realtime; render the pipeline stepper `queued→parsing→chunking→embedding→ready`/`failed` (+ `status_reason`, re-process on failure).
3. On `ready`, the document workspace shows **Preview** (rendered md / table-as-grid / image gallery), **Chunks** (contextual-prefix + scores + dropped-by-rerank), **Lineage** (original → md/csv/images, original always kept + download), **Versions** (history; only current indexed), a **dedup** indicator (content-hash), and parse-quality (`mockup-review` #19/#34).
4. Space owners see a **space-settings** entry (governed retrieval/chunking/embedding defaults are set in W3/W1; W2 links, does not author them).

**6.4 — Budget-increase request.** In Activity/Settings the member sees their read-only ceiling; "Request increase" → `POST /rpc/budgets/request-increase {node_id, amount, reason}` → a `budget_requests` row; W2 shows it as **pending** and reflects admin approval/denial when it lands (`mockup-review` #30). Clients never write `budget_nodes`.

**6.5 — Settings with 4-state governed prefs.** For each preference key, `resolveGov(key)` computes the effective state (workspace→space→role→user). `user-overridable` keys render an editable toggle writing `user_preferences` (self-owned); `locked`/`default-on`/`default-off` render **locked** (greyed + lock icon + tooltip "set by your administrator") and are non-interactive. A write to a non-overridable key is rejected by RLS/C4 (`mockup-review` #18).

**6.6 — Offline / degraded (desktop).** Cloud unreachable → offline banner; Ask falls back to a local model (if enrolled); cloud-only actions (compare, cloud-only spaces) disable with a "needs the gateway"/"needs the desktop app" note; usage/audit buffer **signed + idempotent**; the sync chip shows "N calls queued"; on reconnect the buffer flushes and Activity reconciles ("pending sync" → settled). Web shows the banner and disables cloud-dependent actions with no local fallback.

**6.7 — Design-only surfaces (rendered, non-functional runtime).**
- **Collaborative editing** (X2 v2): comment threads, suggestion/correction review, a **chat-to-edit** panel (user chats; an agent performs edits — v2 runtime), per-doc collaborators (owner/editor/commenter/viewer). Screens render; no runtime wiring; badged v2 (`mockup-review` #20).
- **"Ask the data"** (§3c): dataset **schema view** + **column-sensitivity** display + a compute panel showing an aggregate/k-anon result with a **"computed in-app, values never sent to model"** badge. In v1 W2 renders the surface and (design-direction) can call `/v1/datasets/:id/compute` to display a real gated result; raw sensitive values are never fetched client-side (`mockup-review` #21/#52).
- **Workflows / agent-builder** (X2): List⇄DAG builder + runs, agent runtime badged **"v2 · preview"**; no runtime (`mockup-review` #25).

---

## 7. Gateway-crate dependencies

W2 is a web/Tauri **client** and depends on the `sensei-*` engine **only indirectly** through C1/C5/C6 (it never links the crate on web; on desktop it reaches the local engine via the D2 IPC bridge, not by embedding). Relevant issues (tracked in [`../plans/gateway-issues.md`](../plans/gateway-issues.md)):

| Issue | Why W2 cares | Blocking? |
|---|---|---|
| **GH-1** (per-step `plane` + execution-location on trace) | The exec-badge and the "why this model" trace must render **per-step plane (local\|cloud)**, not infer local from a provider name (`mockup-review` #49). Until GH-1 lands, the badge degrades to served-model + coarse location. | Not blocking W2 build; badge fidelity improves when it lands (rides C2/D3). |
| **GH-6** (streaming-safe redaction hook) | Whether SSE tokens are redacted incrementally or buffered-then-redacted changes Ask streaming latency/UX; W2 renders whatever C1/C4 emit and shows the redaction chip on completion. | Not blocking; affects streaming feel only. |

W2 introduces **no new** gateway-repo issue. It owns no `GatewayStore`/adapter/engine surface.

---

## 8. Decisions resolved

Settling the residuals from the W2 seed (module doc §Open questions) per the RESOLVED DEFAULTS + the ratified UI surface:

- **DW1 — Desktop reuse is verbatim; the *only* desktop-only screen is Local models & downloads (D2).** *Rationale:* Home/Ask/Library/Playground/Workflows/Activity/Settings are identical surfaces; desktop adds behaviour (local plane, offline, device chip), not new screens, except the local-model management surface which is meaningless on web. The Local-models screen is owned by **D2** and mounted into the desktop nav — it is **not** part of W2's web build. (Resolves the seed's "shared verbatim vs desktop-only" residual.)
- **DW2 — Exec-badge is driven by per-step `plane`, not provider.** *Rationale:* capability is a model attribute (DECISIONS §3); the mockup's `route==='Ollama'` heuristic is wrong (`mockup-review` #49). W2 reads `execution_location`/plane from the response/trace (GH-1).
- **DW3 — "Ask the data" (§3c) ships as a design-direction surface in v1: schema + sensitivity display + a gated compute panel; no bespoke authoring.** *Rationale:* DECISIONS §3c makes schema-to-LLM/execute-in-app a v1 *direction*; the compute engine + guardrails are C5-owned. W2 renders the surface and can display a real gated result via `/v1/datasets/:id/compute`, but never fetches raw sensitive values and adds no client-side compute. (Resolves the seed's "depth of Ask the data v1 vs v2" residual.)
- **DW4 — Nav label is "Workflows"; the agent runtime is badged "v2 · preview".** *Rationale:* matches `app.jsx` nav + DECISIONS §1(#3) design-only agents; avoids implying a live agent runtime. The builder lives under the **Tools** group (not orphaned). (Resolves the seed's "Workflows vs Agents labelling" residual.)
- **DW5 — Ask gains explicit-feedback controls + meter parity with Playground.** *Rationale:* DECISIONS §3b lists rating/thumb/accept/edit/retry/correction as v1 capture points and C6 backs the meters; the current `view-ask.jsx` lacks them (`mockup-review` #45/#31). The controls are v1 scope; the missing mockup affordance is a designer-handoff gap, not a scope cut.
- **DW6 — Conversations + user turns are self-owned benign writes; assistant turns/citations/ledger are C1/C4-written.** *Rationale:* DECISIONS §2 W1 self-owned-writes carve-out + C1's Ask persistence ownership; keeps privileged/audited rows on the gateway path while letting the client own its own thread. (Resolves how Ask persistence splits between client and gateway.)
- **DW7 — Capability gating in the UI is affordance-only; the server is the sole authority.** *Rationale:* DECISIONS §2 W1 + F2 §5; prevents treating the client as a security boundary. W2 hides/disables + degrades on `403`.
- **DW8 — Playground is hosted, not owned; W2 provides only the route slot + shell.** *Rationale:* the retrieval-lab is a distinct module (W3) reused inside the console; W2 must not duplicate its controls. (Confirms the seed's "Playground authored in W3, hosted here".)

---

## 9. Acceptance criteria (observable, testable)

1. **Auth + gating.** Signing in via email or Google/GitHub yields a session; `GET /v1/whoami` populates capabilities; a control the caller lacks (e.g. `doc.declassify`) is hidden/disabled, and a forged call to its `/rpc/*` returns `403` and W2 shows a permission error (no client crash).
2. **Ask end-to-end.** `POST /v1/chat/stream` renders a streamed grounded answer with an **exec-badge**, answering **model + tier**, **cost** (shows `free` when `execution_location='local'`), and a **why-this-model** panel resolved from `trace_id`; exactly one user turn + one assistant turn appear in the thread after completion.
3. **Live meters.** After an answer, grounding/quality/cost/latency meters render from `GET /v1/meters` and match the values C6 returns for that `inference_call_id`; a redaction on the call shows an **"N items redacted"** chip.
4. **Explicit feedback.** Thumb/rating/accept/edit/retry/correction each `POST /v1/signals/feedback` and confirm capture; a typed `correction` containing a secret-shaped string is stored redacted (verified via the C6 read model) — W2 never displays a raw secret.
5. **Citation open-at-chunk.** Clicking a citation navigates to the source document, opens the chunk, and highlights the **bbox** evidence-pin (where coords exist).
6. **Library ingestion.** Uploading a PDF/DOCX/XLSX/image drives the pipeline stepper through `queued→…→ready` via the `documents:<space_id>` Realtime channel; a forced failure shows `failed` + `status_reason` + a working re-process; the document workspace shows Preview/Chunks/Lineage/Versions, a **dedup** indicator, and **download-original**.
7. **Budget-increase request.** "Request increase" persists a `budget_requests` row via `/rpc/budgets/request-increase` and shows **pending**; the member cannot edit `budget_nodes` (no such control; a direct PostgREST write is denied).
8. **4-state Settings.** A `user-overridable` pref toggles and persists to `user_preferences`; a `locked`/`default-*` pref renders **locked** (non-interactive, lock + tooltip); a scripted write to a locked key is rejected.
9. **Desktop reuse.** The same build renders inside the D1 shell; on desktop the exec-badge shows `ran on your device` for a local-plane answer (driven by `plane`, not provider); the **Local models** screen appears only in the desktop nav.
10. **Offline (desktop).** With the gateway unreachable, the offline banner shows, Ask falls back to a local model (when enrolled), cloud-only actions disable, and queued usage flushes idempotently on reconnect with Activity reconciling from "pending sync".
11. **Tenant isolation.** A tenant-A session shows only tenant-A spaces/docs/threads/spend; cross-tenant ids return nothing (rides the RW12 harness on the API side).
12. **No secret exposure.** No provider key/OAuth token/raw redacted secret appears in any rendered surface, client log, or network payload originated by W2 (asserted by a client log/DOM scan test).
13. **Design-only surfaces render, don't run.** Collaborative editing, "ask the data", and Workflows/agent-builder render with the correct v2/"preview" badging and expose no live agent-runtime action.

---

## 10. Open questions (genuine)

1. **Tenant-switch UX location** — the token model supports multi-tenant users (F2 §8.5) but where the active-tenant switcher lives on the member side (in the `⌘K` workspace switcher vs a chrome menu vs sub-domain per tenant) is undesigned. Does not block the single-tenant build. *(Shared with F2 open-q1.)*
2. **Compare's home** — dedicated screen vs a Playground control vs an Ask tab (DECISIONS leans a Playground control + optional dedicated screen). Owned with W3; affects whether W2's Ask surfaces any compare affordance. *(mockup-review open question + #10.)*
3. **Ingestion-status transport at scale** — Realtime channel fan-out vs per-doc SSE (`GET /v1/documents/:id?watch=1`) when a tenant bulk-uploads hundreds of docs; W2 should pick one primary transport for the Library status UI. *(Shared with C5 open-q2.)*
4. **Session-only Playground/Ask experiments in Activity** — whether experiment runs surface in the member's Activity/spend (counted as real `inference_calls`) or are hidden as ephemeral; affects Activity totals and the "why this cost" story. *(Shared with C6 open-q on session-only signals.)*
5. **Chat-to-edit design fidelity for v1** — how much of the agent-driven edit *interaction* (diff/suggestion review affordances) to design now so the v2 X2 runtime slots in without a redesign, vs a thinner placeholder. Design-only either way in v1.
