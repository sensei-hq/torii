# X2 · Agents & plans — Spec

**Module:** [X2](../modules/X2-agents-plans.md) · **Plane:** Cross-cutting (X) · **Status:** **Design-only in v1** (runtime v2)
**Depends on (v1, design):** W2 member console (owns the nav slot), W4 design system, the existing `view-workflows.jsx` + `view-workflows-builder.jsx` mockups · **Depends on (v2, runtime):** C1 (hot path / execute), C4 (governance + W5 tool-egress redaction), C5 (retrieval + collaborative-doc runtime), C6 (quality signals + the interaction-intelligence go-between), X1 (MCP tool invocation + allow-list), C3 (budget reserve per agent step) · **Enables (v2):** collaborative document editing (§3a), the interaction-intelligence go-between (§3b/C6)
**Date:** 2026-07-23 · **Authoritative record:** [`../DECISIONS.md`](../DECISIONS.md) §1 (#3), §3a, §3b · **Schema:** [`F1-data-model.md`](./F1-data-model.md) · **Signals:** [`C6-quality-signals.md`](./C6-quality-signals.md)

---

> **Scope banner (ratified 2026-07-23).** Agents & workflows are **design-only in v1** (DECISIONS §1 decision #3). X2 **owns** the two existing mockup screens — `view-workflows.jsx` (index + detail + runs + the **Review & approval / HITL** surface) and `view-workflows-builder.jsx` (List builder, DAG Canvas, agent builder) — plus the **design-only collaborative-doc-edit surfaces** whose *runtime* ships with X2 in v2. **No** runtime tables enter the v1 F1 cut (`plans` / `planned_tasks` / `planned_task_interactions` stay deferred). This spec **corrects** the earlier module-seed claim that these screens are "not in the current mockups" — they exist and are canonical. Sections 4b/5b/6b/7 sketch the **v2 runtime** as forward design so the v1 surfaces and the F1/C-plane contracts line up when the runtime lands.

---

## 1. Purpose & scope

Multi-step automation for Torii: **ReAct agents** (reason → tool → observe loops) and **DAG task plans** (dependency-ordered, parallel-grouped tasks) with **human-in-the-loop (HITL) approval** for sensitive steps. A first-class capability in the old system (`strategos_old` `agents` package: coordinator, plan/task tracking, HITL).

**v1 (this spec's build scope) is design-only:**

- Own and maintain the **Workflows** member surface (`view-workflows.jsx`) and the **agent/workflow builder** (`view-workflows-builder.jsx`), assigned to an owning module in nav (W2 member console → **Tools**) so they are not orphaned.
- Own the **HITL approval surface** already present in the Workflows detail view ("Review & approval" section + Branch-step review gates + the "Needs review · awaiting a human" metric).
- Own the **design-only collaborative-doc-edit surfaces** (comment threads, suggestion/correction review, a **chat-to-edit** panel where the user chats and an agent performs the edits, per-doc collaborators owner/editor/commenter/viewer) — mockup-review item 20. The C5 spec designs the same surfaces from the document-center side; X2 owns the **agent-driven edit runtime** that powers them in v2.
- Design the **v2 interaction-intelligence go-between** affordances (query rewrite/decompose/HyDE, clarifying questions, learned preferences) as non-functional surfaces — the runtime is C6 §3b/§6, shipped with X2 in v2.

**Explicitly out of v1 scope (v2 runtime):** the ReAct execution loop, plan/task persistence & execution, real HITL routing/approval enforcement, agent-driven document mutations, the go-between optimizer runtime, and any `/v1/agents`/`/v1/plans` backend endpoint. **The ENTIRE Workflows module — agent AND non-agent "flow" workflows — is v2** (confirmed 2026-07-23): in v1 **no** workflow of any kind runs or persists. The screens are design-only "v2 preview"; "Run now"/create/edit are disabled or mockup-local (`localStorage`) only, never hitting F1/PostgREST/an RPC. (Update the mockups so the interactive non-agent flow builder is also gated as preview, not a live v1 feature — mockup-review Q1.)

**Depends-on / enables:** see the header. In v1, X2 depends only on the W-plane (screens + design system). In v2 it composes C1 (execute), C4 (governance + tool-egress redaction, DECISIONS §2 W5), C5 (retrieval + doc runtime), C6 (signal capture + go-between), X1 (MCP/tool invocation under allow-list), and C3 (per-step budget reserve). It **enables** the v2 collaborative-editing runtime (§3a) and the v2 interaction-intelligence go-between (§3b).

Out of scope here: the F1 DDL for the deferred/v2 tables (F1 implementation plan); the MCP allow-list enforcement + SSRF/sandbox mechanics (X1); the retrieval pipeline (C5); the signal taxonomy (C6 owns it).

---

## 2. Responsibilities

**v1 (build):**

- **Own the Workflows + builder mockup screens** and keep them reconciled to DECISIONS — the canonical `view-workflows.jsx` (index cards, detail, runs, Review & approval) and `view-workflows-builder.jsx` (List / DAG Canvas / agent builder). Ensure the agent builder is badged `v2 · preview` with editing disabled, and classic workflows show they do not execute in v1.
- **Own the HITL approval surface** as a design artifact: the "Review & approval" panel, Branch-step "hold for review" gates, and the "Needs review — awaiting a human" run state — rendered but non-functional in v1.
- **Own the design-only collaborative-doc surfaces** (comments, suggestion/correction review, chat-to-edit, per-doc collaborator roles) — mockup-review item 20 — coordinated with C5's document-center design so both sides render one consistent surface.
- **Design the v2 go-between affordances** (mockup-review items 41, 53) as non-functional previews.
- **Fix the mockup drift** attributed to X2 (mockup-review item 25): keep the screens design-only, badge agent runtime "v2 · preview", ensure a nav owner.
- **Guarantee the negative invariant:** no runtime tables, no agent backend, no metered agent call ships in v1. This is a build gate for F1 (the deferred tables stay out of the cut) and for C1 (no `/v1/agents` route).

**v2 (forward design only in this spec):**

- **ReAct agent loop** (reason → tool → observe → repeat until goal/limit), with per-step tracking, tool selection from the X1 allow-list, budget reserve per step (C3), and signal emission per step (C6).
- **DAG plans** — `planned_tasks` with dependencies, parallel groups, per-task model/cost/latency tracking; a coordinator that schedules ready tasks and rolls up cost.
- **HITL** — approval requests for sensitive tool calls / plan steps, blocking execution until approved/denied, routed to an approver by capability.
- **Agent-driven collaborative document editing** (§3a) and the **interaction-intelligence go-between** (§3b/C6) as the two headline runtime consumers.

**Non-responsibilities:** X2 does not define quality signals (C6), route/fallback (C2), enforce budgets (C3), redact (C4), retrieve/embed (C5), invoke/allow-list MCP tools (X1), or own audit immutability (O1). In v2 it *composes* these; it never re-implements them.

---

## 3. Data model (F1 tables owned/used)

### 3.1 v1 — **no owned F1 tables**

X2 in v1 is design-only and **owns no F1 tables**. Per DECISIONS §1 (#3), §5, and F1 §3.3, the runtime tables `plans` / `planned_tasks` / `planned_task_interactions` are **deferred (post-v1)** and are **not in the v1 cut**. The mockup's workflow state (`WORKFLOWS` in `data.jsx`, user edits) is **mockup-local (`localStorage`) only** — it does not persist to F1, PostgREST, or any gateway RPC in v1. This is a hard build invariant: authoring the X2 screens must not introduce any workflow/agent/plan table, RLS policy, or backend write.

### 3.2 v1 — used (read-only, for the design surfaces)

The design surfaces reference existing v1 entities for realistic rendering but write nothing new:

- **`spaces` / `space_members`** — the "share (just me · this workspace · specific people · company-wide)" scope selector maps to space/tenant scope (read-only in v1).
- **`documents` / `document_collections` / `document_assets`** (C5/F1) — the collaborative-doc surfaces and chat-to-edit panel render against document rows; **all edits are design-only** (no `documents` mutation, no collaborator/comment/suggestion row is written in v1).
- **`mcp_servers` / `tenant_mcp_servers` / `tool_allow_lists`** (X1) — the builder's Tool/MCP step and its allow-list chips read the X1 catalog to show granted/blocked tools; no invocation occurs.
- **`prompt_templates`** (F1, RW6) — the builder's "Draft" step references shared templates (read-only).

### 3.3 v2 — forward table design (NOT built in v1)

When the runtime ships, X2 adds (subject to a v2 F1 rework, not the v1 cut):

| Table | Shape (forward sketch) | Notes |
|---|---|---|
| `agents` | tenant_id, id, name, goal/system-prompt, chain binding (capability), tool allow-list ref (X1), budget-node ref, guardrail policy ref (C4), scope (space/owner), status | The agent definition authored in the v2 builder. |
| `plans` | tenant_id, id, agent_id?/workflow_id, initiator identity, status, cost rollup, created_at | A run instance (DAG or ReAct session). Was in `database/`, deferred. |
| `planned_tasks` | tenant_id, id, plan_id, parent deps (array / edge table), parallel-group, step kind (retrieve/draft/tool/classify/branch/output/agent), bound model, `inference_call_id` FK, cost/latency, `execution_location` (plane), status | The DAG nodes; per-task metering keyed to the `inference_calls` ledger. |
| `planned_task_interactions` | tenant_id, id, task_id, role (reason/tool-call/observation/hitl), payload (**W5-redacted**), created_at | The ReAct trace + tool I/O; payloads pass C4 redaction before store. |
| `hitl_approvals` | tenant_id, id, plan_id/task_id, requested_by, required_capability, status (pending/approved/denied), approver_id, decided_at, reason | Blocking approval gate for sensitive steps. |
| `document_collaborators` | tenant_id, document_id, profile_id, role (owner/editor/commenter/viewer) | v2; §3a collaborative editing. Also referenced by C5. |
| `doc_comments` / `doc_suggestions` | tenant_id, document_id, author, anchor (range/bbox), body/diff, status (open/accepted/rejected), agent-authored flag | v2; comment threads + agent-produced suggestions/corrections. |

All v2 tables are tenant-scoped, RLS'd, and — for privileged writes (agent definitions, plan execution, approvals, doc mutations) — **`service_role`-write via C1 `/rpc/*`** per the DECISIONS §2 W1 posture. Agent/plan runtime interactions that carry model I/O store **W5-redacted** payloads only (counts/placeholders, no raw secrets/PII — same rule as C6 `value_json` and `quality_signals`).

---

## 4. Contracts

### 4.1 v1 — UI-only (design surfaces)

X2 exposes **no HTTP/IPC/trait contract in v1** — it is a set of member-console screens. The v1 "contract" is the screen inventory + their placement:

- **`view-workflows.jsx`** — Workflows index (cards: name, trigger, step pips, share tag, active/paused switch), a metrics strip (Active / Runs·7d / Spent·7d / **Needs review**), a workflow detail drawer (steps, **Review & approval** panel, runs list with `success`/`review`/`stepped`/`failed`/`running` states, a disabled/preview "Run now"), and share scopes (`private`/`workspace`/`people`/`company`). Nav owner: **W2 member console → Tools**.
- **`view-workflows-builder.jsx`** (exposes `window.StrategosWF`) — a **List builder** and a **DAG Canvas** over step kinds `trigger · retrieve · draft · tool · classify · notify · branch · output · agent`, plus the **agent builder** panel badged `v2 · preview` with editing disabled. Shared step metadata + run-status colors are reused by the index/runs views.
- **Collaborative-doc surfaces** (design-only) — comment threads, suggestion/correction review, a **chat-to-edit** panel (user chats; an agent "will perform" the edits), per-doc collaborator roles. Rendered against C5 document rows; no mutation.
- **Go-between affordances** (design-only) — query rewrite/decompose/HyDE, clarifying-question, and learned-preference previews (non-functional; the runtime is C6 §3b).

**v1 contract invariants (observable):** the agent builder is non-editable and `v2 · preview`-badged; classic-workflow "Run now" does not call any backend (mockup-local only); no `/v1/agents`, `/v1/plans`, or `/rpc/agents*` endpoint exists; collaborative-doc actions write nothing.

### 4b. v2 — runtime contracts (forward design; NOT built in v1)

Sketched so the v1 surfaces and the C-plane line up. All privileged writes follow the DECISIONS §2 W1 gateway-mediated pattern (C1 `/rpc/*`, capability-checked, `service_role` writer); all agent inference rides the C1 hot path (budget reserve → execute → commit → ledger) and emits C6 signals.

**HTTP (C1 domain endpoints — v2):**

```
POST /v1/agents/run            # start a ReAct agent run toward a goal
  Authorization: Bearer <jwt|api-key>
  { "agent_id": uuid, "input": string, "space_id"?: uuid }
  → 201 { "plan_id": uuid, "stream": "/v1/agents/run/{plan_id}/events" }
  # Runs under the CALLER's identity + capabilities; budget binds to the caller's node (never the agent def).

GET  /v1/agents/run/{plan_id}/events        # SSE: step events (reason/tool/observe/hitl-wait/done)
POST /v1/plans/{plan_id}/cancel             # cooperative cancel; commits metered-so-far

POST /rpc/agents/upsert | /rpc/agents/delete            # cap: agent.manage → agents
POST /rpc/plans/execute-task | /rpc/plans/retry-task     # service-role scheduler surface
POST /rpc/hitl/approve | /rpc/hitl/deny                   # cap: the step's required_capability → hitl_approvals
POST /rpc/docs/apply-agent-edit                          # cap: per-doc collaborator editor → documents/doc_suggestions (§3a)
POST /rpc/docs/comment | /rpc/docs/suggest               # doc_comments / doc_suggestions
```

**Rust traits (v2, in `services/gateway`, composing the `sensei-*` engine):**

```rust
/// ReAct loop: reason → select tool (X1 allow-list) → observe → repeat until goal/limit/HITL.
#[async_trait]
pub trait AgentLoop {
    async fn run(&self, ctx: CallerCtx, agent: AgentDef, input: String) -> Result<PlanId, AgentError>;
}

/// DAG scheduler: dependency-order + parallel-group execution over planned_tasks, per-task budget reserve.
#[async_trait]
pub trait PlanExecutor {
    async fn execute(&self, ctx: CallerCtx, plan: PlanId) -> Result<PlanOutcome, AgentError>;
    async fn on_task_ready(&self, task: TaskId) -> Result<(), AgentError>;
}

/// HITL gate: a sensitive step blocks until an authorized approver decides.
#[async_trait]
pub trait HitlGate {
    async fn require_approval(&self, req: ApprovalRequest) -> Result<ApprovalDecision, AgentError>;
}
```

**Events (v2):** each agent step → an SSE event to the client **and** a C6 signal batch (`implicit.why_model`, `implicit.fallbacks`, `implicit.cost`, `implicit.latency`, tool-call + redaction hits) keyed to the step's `inference_call_id`; each step → one `inference_calls` ledger row (O1) with `execution_location`/plane (GH-1); each HITL request/decision and each agent-applied doc edit → an `audit_events` row (O1) bound to the initiating/approving identity. A v2 `SignalKey` extension (`schema_version` 2, C6 §6/§10) covers agent-step and go-between decisions.

---

## 5. Security & RLS

### 5.1 v1

X2 v1 adds **no tables, no RLS policies, no backend write path** — so it introduces no new tenant-isolation, secret-handling, or capability surface. Its screens live inside the W2 member console and inherit that shell's authenticated, tenant-scoped RLS reads. The security-relevant v1 guarantees are **negative**:

- No workflow/agent/plan state is persisted server-side (mockup-local `localStorage` only) → no privilege-escalation, budget-bypass, or cross-tenant surface is created.
- No agent executes → no tool egress, no model call, no credential touch, no budget spend originates from X2 in v1.
- The collaborative-doc surfaces perform **no `documents` mutation** → no classification/ACL bypass path.

### 5b. v2 — forward security design (per DECISIONS §2)

When the runtime lands it MUST conform to the ratified posture:

- **Identity, not the agent, is the principal.** An agent run executes under the **initiating caller's** identity and resolved capabilities (JWT/api-key). **Budget binds to the caller's identity/node** (DECISIONS §2 W2) — never to the agent definition or a credential. Every step does the C3 hard reserve → commit against the single `service_role`-only `inference_calls` ledger; a `hard` node cannot be exceeded even across parallel DAG tasks.
- **Gateway-mediated privileged writes (W1).** Agent definitions, plan execution, HITL decisions, and agent-applied doc edits are `service_role`-write via C1 `/rpc/*` with a `require(ctx, cap)` check (`agent.manage`, the step's `required_capability`, per-doc `editor`); no direct PostgREST write. Clients keep `SELECT` + self-owned benign writes only.
- **Tool egress redaction (W5).** Every tool call the agent makes goes through the X1 allow-list (per role×space; SSRF-filter `http/sse`, sandbox `stdio`) **and** the C4 in-flight redaction — prompts, retrieved context, agent messages, and **MCP tool inputs/outputs** are scanned/redacted before egress to any model or tool (DECISIONS §2 W5, mockup-review item 27). Stored interaction payloads (`planned_task_interactions`) hold **one-way placeholders only** (v1 W5 rule extended).
- **HITL for sensitive actions.** Sensitive tool calls / plan steps block on `hitl_approvals`; the approver is resolved by the step's required capability; approve/deny is audited (actor-bound `audit_events`).
- **Device-status on the hot path.** Agent runs ride the C1 hot path where the per-request device-status check applies (a revoked device with a live JWT cannot keep an agent spending), per DECISIONS §2 apply-without-asking.
- **Collaborative-doc ACL.** Agent-driven edits are bounded by `document_collaborators` roles (owner/editor/commenter/viewer) layered on the space+classification ACL; an agent can only edit within the initiating user's document authority, and edits are suggestions pending human accept where the collaborator role is below `editor`.
- **Audit + signals.** Every agent step, tool call, HITL decision, and doc edit is an O1 audit event and a C6 quality signal (DECISIONS §3b — "every governance action is an auditable quality signal").

---

## 6. Key flows

### 6.1 v1 flows (design-only, observable in the mockups)

1. **Browse & author a workflow.** Member opens **Tools → Workflows** → sees index cards + metrics (incl. "Needs review") → opens a workflow → sees steps, the **Review & approval** panel, and the runs list → opens the **builder** (List or DAG Canvas) → arranges steps (`trigger…output`). Edits persist to `localStorage` only; nothing hits the backend.
2. **Agent builder preview.** Member opens the **agent** builder → sees the `v2 · preview` badge and copy ("The agent decides its own steps… Shipping in v2; editing is disabled") → editing controls are disabled; "Run now"/"Preview" does not execute.
3. **HITL surface (design).** A workflow with a Branch "hold for review" step renders a **Review & approval** panel listing the human gates; the index shows a "Needs review — awaiting a human" count. Non-functional in v1 (no approval is actually routed).
4. **Collaborative-doc design surfaces.** From the document workspace (C5), a member opens comment threads / suggestion review / the **chat-to-edit** panel → sees how a chat turn would drive an agent edit and how per-doc collaborators are shown. No document is mutated in v1.
5. **Go-between preview.** The Ask/Playground/agent surfaces show non-functional query-rewrite/HyDE/clarifying-question/learned-preference affordances (design per C6 §3b).

### 6b. v2 runtime flows (forward design)

6. **ReAct agent run.** Client `POST /v1/agents/run` → C1 resolves caller + capabilities + budget node → `AgentLoop::run`: (reason via chain → select an allow-listed X1 tool → C4-redact the tool input → invoke tool → observe → C6 signal + ledger row + budget commit) looped until goal/step-limit; sensitive tool → `HitlGate::require_approval` blocks until `/rpc/hitl/approve`; stream step events over SSE; final answer + full W5-redacted trace persisted.
7. **DAG plan execution.** `PlanExecutor::execute` schedules dependency-ready `planned_tasks` (parallel groups concurrently), each task = one metered call (reserve→commit, its own ledger row + plane/`execution_location`), rolling cost up to the `plan`; a `branch` step can route to a HITL gate; cancel commits metered-so-far.
8. **Agent-driven collaborative edit (§3a).** User chats in the chat-to-edit panel → an agent (bounded by the caller's `document_collaborators` role) proposes edits → `editor`+ applies directly via `/rpc/docs/apply-agent-edit`; lower roles produce `doc_suggestions` pending human accept; every edit audited + signalled.
9. **Interaction-intelligence go-between (§3b/C6).** Between user and gateway, the optimizer reads C6 signal history + learned prefs → rewrites/decomposes the query (HyDE), asks clarifying questions, tunes prompt/model selection in-flight → the optimized request flows through C4/C2/C1 as usual; its decisions emit `schema_version` 2 signals. Placement in the request path is a C6 open question.

---

## 7. Gateway-crate dependencies

Engine = the six `sensei-*` crates @ **`v0.4.6`** (`kernel`, `gateway`, `cloud-providers`, `local-engine`, `local-providers`, `kokoro`). **v1 X2 consumes the crate not at all** (design-only, no runtime). All crate dependencies are **v2** and reference issues already filed for other modules ([`../plans/gateway-issues.md`](../plans/gateway-issues.md)):

- **GH-7 (MCP / tool-calling support) — BLOCKING for the v2 agent runtime.** The ReAct loop needs a tool-call/MCP interface. GH-7 determines whether the engine exposes a tool-call hook or whether X1 builds tool invocation consumer-side in C1/C4 (with allow-list + SSRF/sandbox). X2's agent loop rides whatever X1/GH-7 land. Sequenced before the X1 phase; the X2 runtime rides after X1.
- **GH-1 (per-step `plane` + execution-location on the trace) — relevant (v2).** Agent/plan step trace + the run's exec-location badges depend on `plane` on `ChainEntry` and execution-location on `Attempt`/`ExecutionTrace`. Consumed via the C1 ledger row per step. Already filed for C2/D3.
- **GH-6 (streaming-safe governance/redaction hook) — relevant (v2).** Redacting streamed agent output/tool I/O before egress (W5) may need the crate stream-transform hook; else buffer-then-redact. Already filed for C4.
- **GH-4 (hard budget reserve→commit) — relevant (v2).** Per-step agent/DAG-task reserve rides the C3 hard-reserve affordance. Already filed for C3.

**No new gateway-repo issue is required by X2.** It is a pure v2 consumer of GH-7 (X1), GH-1 (C2/D3), GH-6 (C4), GH-4 (C3), plus the C6 signal contract. If, at v2 planning, the ReAct loop or the go-between needs an in-engine agent/pre-request hook not covered by GH-7, a new issue is filed then (out of v1 scope).

---

## 8. Decisions resolved

- **Agents & workflows are design-only in v1; runtime is v2.** *Rationale:* DECISIONS §1 (#3) ratified this. Shipping the runtime needs MCP/tool-calling (GH-7/X1), per-step trace (GH-1), stream redaction (GH-6), hard reserve (GH-4), and the mature C6 signal history the go-between reads — none of which are v1-critical. v1 delivers the authored surfaces; v2 delivers the loop. **Build gate:** no agent executes and no runtime table ships in v1.
- **The "not in the current mockups" claim is FALSE — corrected.** *Rationale:* `view-workflows.jsx` and `view-workflows-builder.jsx` both exist in the canonical `docs/mockups/app/` set (verified on disk: index/detail/runs + List/DAG/agent builder, with a `v2 · preview` agent badge already present). X2 **owns** them; they are not to be re-authored from scratch, only reconciled and given a nav owner (mockup-review item 25).
- **No runtime tables in the v1 F1 cut.** *Rationale:* DECISIONS §1 (#3) + §5 + F1 §3.3 defer `plans`/`planned_tasks`/`planned_task_interactions`. Authoring the X2 screens must add **zero** workflow/agent/plan tables, RLS policies, or backend writes. Mockup workflow state is `localStorage`-only.
- **X2 owns the HITL approval surface (design-only).** *Rationale:* the "Review & approval" panel + Branch review gates + "Needs review — awaiting a human" already live in `view-workflows.jsx`. Rather than invent a new HITL screen, X2 owns and reconciles this existing surface; the v2 runtime backs it with `hitl_approvals`.
- **X2 owns the agent-driven doc-edit runtime; C5 owns the doc-center surfaces.** *Rationale:* DECISIONS §3a ties collaborative editing to "agents = design-only v1 / runtime v2." The screens are designed once (coordinated with C5); the **edit runtime** — an agent performing the edits under the caller's collaborator ACL — is X2's v2 responsibility, not C5's.
- **X2 owns the v2 interaction-intelligence go-between runtime; C6 owns its signal contract.** *Rationale:* DECISIONS §3b/§6 place the go-between as "agent-adjacent … ships with X2 in v2." C6 fixes the v1 signal read model the go-between consumes; X2 builds the adaptive runtime in v2. v1 = design-only surfaces on both sides.
- **Nav owner = W2 member console → Tools.** *Rationale:* the mockup header marks Workflows as "(member · Tools)"; assigning X2 there resolves the orphaned-screen gap (mockup-review item 25) without inventing new IA.
- **Agent runs execute under the caller's identity; budget binds to identity, not the agent.** *Rationale:* DECISIONS §2 W2 — budget binds to the identity/node, never to a credential or (by extension) an agent definition. Forward-fixes the v2 security model so it cannot become a budget-bypass vector.
- **No new capability minted in v1.** *Rationale:* design-only surfaces need only authenticated tenant membership + the W2 shell's reads. v2 introduces `agent.manage` + the per-step HITL `required_capability` from the F2 canonical set; none enters the JWT in v1.
- **X2 files no gateway-repo issue.** *Rationale:* every runtime dependency (GH-7/GH-1/GH-6/GH-4) is already filed for X1/C2/D3/C4/C3; X2 is a downstream v2 consumer.

---

## 9. Acceptance criteria (observable)

1. **Screens owned + reconciled.** `view-workflows.jsx` and `view-workflows-builder.jsx` exist in the canonical mockup set, render index/detail/runs and List/DAG/agent builder, and are reachable under **W2 → Tools** in nav (not orphaned).
2. **Agent runtime badged v2, non-functional.** The agent builder shows a `v2 · preview` badge with editing **disabled**; "Run now"/"Preview" on an `agent`-kind workflow does not execute or call any backend.
3. **Classic workflows are design-only.** Editing a classic workflow persists to `localStorage` only; no PostgREST/RPC write occurs; no `plans`/`planned_tasks`/`planned_task_interactions` row is created.
4. **No runtime tables in the F1 v1 cut.** A schema check confirms `plans`, `planned_tasks`, `planned_task_interactions` (and the v2 collaborative tables `document_collaborators`/`doc_comments`/`doc_suggestions`) are **absent** from the built v1 schema.
5. **No agent backend endpoint in v1.** `/v1/agents/run`, `/v1/plans/*`, and `/rpc/agents*` return 404 (or are absent) in the v1 gateway; no agent inference call appears in `inference_calls`.
6. **HITL surface present (design).** The Workflows detail view renders the **Review & approval** panel and the index shows the "Needs review — awaiting a human" metric; a Branch "hold for review" step surfaces a human gate — all non-functional in v1.
7. **Collaborative-doc surfaces present, no mutation.** The comment-thread, suggestion/correction-review, chat-to-edit, and per-doc-collaborator surfaces render (coordinated with C5); triggering a chat-to-edit action mutates **no** `documents` row and writes no collaborator/comment/suggestion row in v1.
8. **Go-between affordances present, non-functional.** Query-rewrite/HyDE/clarifying-question/learned-preference affordances render as previews and perform no in-flight optimization in v1.
9. **Design-system conformance.** The screens use the `app/zs.css` named-token vocabulary (paper/ink/one vermillion accent), execution-location badges are plane-driven (not `route==='Ollama'`, per mockup-review item 49) where shown, and locked/governed controls use the locked-toggle visual.

---

## 10. Open questions (genuine)

- **DAG plan schema shape (v2).** Dependencies as an adjacency array on `planned_tasks` vs a separate edge table; how parallel groups and fan-in join semantics are represented; whether ReAct sessions and authored DAGs share one `plans`/`planned_tasks` shape or diverge. Resolved when the v2 runtime is planned (informed by `strategos_old` `agents`).
- **Agent memory / state store (v2).** Where per-run scratchpad / long-term agent memory lives (reuse `planned_task_interactions` vs a dedicated store), and how it interacts with the C6 learned-preference read model the go-between uses.
- **HITL approval routing (v2).** Who approves a sensitive step — the initiating user's manager in the org tree, any holder of the step's `required_capability`, or a configured approver per space — and the timeout/escalation behavior when no one approves.
- **Go-between placement in the request path (v2).** Where the optimizer sits relative to C4 governance and C2 routing, and which `schema_version` 2 `SignalKey`s its decisions emit. Shared with C6 §10; resolved when the X2 runtime is planned.
- **Agent-edit autonomy threshold (v2).** For collaborative editing, which collaborator role lets an agent apply edits directly vs. only propose suggestions, and whether direct agent edits always require a HITL confirmation regardless of role.
