# X1 · Tools & MCP — Spec

**Module:** [X1](../modules/X1-tools-mcp.md) · **Plane:** Cross-cutting (X) — central (`http/sse` servers) **and** device (`stdio` servers via D1) · **Status:** Planned (in v1)
**Depends on:** [F1](F1-data-model.md) (registry + allow-list tables + RLS), [F2](F2-identity-auth-rbac.md) (`mcp.manage` capability + role/space resolution), [C1](C1-gateway-service.md) (auth, request context, the inference loop that invokes tools, the `/rpc/mcp/*` write surface), [C4](C4-governance-runtime.md) (tool-egress redaction, §2 W5), [D1](../modules/D1-desktop-shell.md) (device subprocess host for `stdio` servers)
**Enables:** tool-calling in Ask/Playground/Compare (W2/W3), agentic retrieval (C5), design-only agent runtime (X2, v2)
**Date:** 2026-07-23 · **Language:** Rust (`crates/tools` library, consumed by C1 + the desktop `src-tauri`) · **Engine crates:** `sensei-*` @ `v0.4.6`

---

> ⚠️ **Framing (2026-07-23).** X1 is **not** a network service. Like C4, it is a **consumer-side Rust library** (`crates/tools`) that runs *inside* C1's inference loop (central plane) and inside the desktop `src-tauri` process (device plane, for `stdio` servers launched via D1). The `sensei-*` engine (`v0.4.6`) has **no MCP crate** and no tool-invocation orchestrator (GH-7). Tool **invocation, allow-list enforcement, SSRF filtering, sandboxing, and C4 redaction are all Torii-owned security controls** and live in X1 — never in the crate. The crate is (at most) enhanced only to carry tool/function *definitions* on the request and to surface provider `tool_use` blocks on the response (§7, GH-7). Where any other doc disagrees, [`../DECISIONS.md`](../DECISIONS.md) (§1.1, §2 W5) wins.

---

## 1. Purpose & scope

X1 gives Torii models the ability to **invoke tools** and connect to **Model Context Protocol (MCP) servers** — a registry of servers (platform-managed + tenant-registered), a **per-(role × space) tool allow-list**, and a **server-side enforcement + invocation runtime** that the gateway runs at tool-call time. It is the substrate under Ask/Playground tool use, agentic retrieval (C5), and the v2 agent runtime (X2).

**In scope:**
- The **tool / MCP-server registry** (`mcp_servers`, `tenant_mcp_servers`) + **discovered-tool cache** (`mcp_server_tools`) and the **per-(role × space) allow-list** (`tool_allow_lists`).
- The **allow-list resolver** (default-deny; resolves the concrete set of `(server, tool)` a caller may use for a given `space_id`) and its **server-side enforcement at tool-call time** — a tool the model requests that is not in the resolved set is blocked, regardless of UI.
- The **tool-invocation runtime**: `stdio` servers sandboxed on the **device** (D1-launched subprocess), `http`/`sse` servers reached **centrally or on-device** behind an **SSRF filter**.
- **Tool-egress redaction** (§2 W5): every tool **input** and **output** passes through the C4 `redact_text` guard before it leaves for the tool / re-enters the model.
- The **agentic tool loop** driver inside C1's `/v1/chat` (bounded, budget-metered), and the transport MCP clients (`StdioClient` / `HttpClient` / `SseClient`).
- The **`/rpc/mcp/*`** business logic behind C1's gateway-mediated write surface (register/enable/refresh/set-allow-list/disable/delete) and the **Admin Tools & MCP** screen backing (mockup-review item 1).

**Out of scope (owned elsewhere, called by X1):**
- Redaction detectors + the `redact_text` implementation (C4 owns; X1 calls it at `ToolInput`/`ToolOutput`).
- JWT/API-key verification, `RequestContext`, capability resolution, and the `/rpc/*` authz plumbing (C1/F2 — X1 supplies the handler bodies).
- The DDL/RLS itself (F1 rework RW3 — X1 specifies the shape here).
- Subprocess host / Tauri sidecar lifecycle on the device (D1 — X1 defines the `stdio` contract).
- The chat/inference request assembly, budget reserve→commit, and ledger persistence (C1/C3).
- MCP *resources* and *prompts* primitives — **v1 = MCP tools only** (see §10).

---

## 2. Responsibilities

1. Own the **registry**: platform-scoped and tenant-scoped MCP servers, their transport/endpoint/credential refs, enablement, and the **discovered-tool cache** (refreshed via MCP `tools/list`).
2. Own the **per-(role × space) allow-list**: default-deny grants of `(server, tool)` by role and space; resolve the **effective allow-list** for a `RequestContext` + `space_id`.
3. **Enforce the allow-list server-side at tool-call time** — the gateway offers the model only allowed tool definitions, and **rejects any tool call outside the resolved set** even if a client forged it. Never UI-only.
4. **Invoke tools** safely: **sandbox `stdio`** servers (device-only, D1 subprocess), **SSRF-filter `http`/`sse`** servers (private-range deny, IP-pinning, scheme allowlist, size/time caps).
5. **Redact tool egress** (§2 W5): call C4 `redact_text(ToolInput, …)` before send and `redact_text(ToolOutput, …)` before the result re-enters the model — **fail-closed**.
6. Drive the **agentic tool loop** inside C1 (bounded iterations; each model turn is a metered `inference_calls` row; tool execution runs between turns).
7. Serve the **`/rpc/mcp/*`** write operations (capability `mcp.manage`, gateway-mediated) and emit `audit_events` + `quality_signals` for every tool invocation and registry change.
8. Provide the **Admin Tools & MCP** read models (registry list, resolved allow-list matrix with granted / blocked-by-policy state).

---

## 3. Data model (F1 tables owned / used)

X1 is the **DDL author** (via F1 rework RW3) of the registry + allow-list tables and the **sole runtime writer** (as `service_role`, through C1's `/rpc/mcp/*`). All references are to the reworked F1 (see [`F1-data-model.md`](F1-data-model.md) §5 and [`../plans/F1-rework-plan.md`](../plans/F1-rework-plan.md) RW3).

### 3.1 Owned (X1 specifies; F1 rework RW3 builds)

| Table | Role | Key columns (concrete) |
|-------|------|------------------------|
| `config.mcp_servers` | Server registry (platform + tenant) | `id uuid pk`, `tenant_id uuid NULL` (NULL ⇒ platform-scoped), `scope text CHECK (scope IN ('platform','tenant'))`, `name text` (slug, unique per scope/tenant), `label text`, `transport text CHECK (transport IN ('stdio','http','sse'))`, `command text NULL`, `args jsonb NULL`, `env_ref uuid NULL` (→ F3 credential for `stdio` env secrets), `url text NULL`, `auth_credential_id uuid NULL` (→ `router_credentials`/F3 for `http`/`sse` bearer/header auth), `enabled bool`, `created_at`, `modified_at`, `modified_by`. `stdio` rows require `command`; `http`/`sse` rows require `url`. |
| `public.tenant_mcp_servers` | Tenant enablement/config of a (platform or own) server | `id uuid pk`, `tenant_id uuid`, `mcp_server_id uuid FK (config.mcp_servers)`, `enabled bool`, `config_override jsonb` (per-tenant url/args/env override), `status text CHECK (status IN ('active','error','disabled'))`, `last_health_at`, `created_at`, `modified_at`, `modified_by`. Composite FK `(tenant_id, …)` keeps refs in-tenant. |
| `public.mcp_server_tools` | **Discovered-tool cache** (per server, from MCP `tools/list`) | `id uuid pk`, `tenant_id uuid NULL` (mirrors server scope), `mcp_server_id uuid FK`, `tool_name text`, `title text`, `description text`, `input_schema jsonb` (JSON-Schema for the tool args), `annotations jsonb` (read-only/destructive hints), `discovered_at`, `is_active bool`. Unique `(mcp_server_id, tool_name)`. **X1 addition to RW3 — see §8 D5.** |
| `public.tool_allow_lists` | Per-(role × space) grant | `id uuid pk`, `tenant_id uuid`, `role_id uuid FK (roles)`, `space_id uuid NULL FK (spaces)` (NULL ⇒ tenant-wide for that role), `mcp_server_id uuid FK`, `tool_name text NULL` (NULL ⇒ all tools on the server; supports a `*` wildcard), `effect text CHECK (effect IN ('allow')) DEFAULT 'allow'` (v1 is grant-only under default-deny), `created_at`, `modified_at`, `modified_by`. Composite FK keeps `role_id`/`space_id`/`mcp_server_id` in-tenant. |

### 3.2 Read (as `service_role`, or tenant-scoped SELECT under RLS)

`roles` / `role_permissions` / `profile_roles` (RW2 — resolve the caller's roles + `mcp.manage` capability), `spaces` / `space_members` (RW9 — validate `space_id` membership before resolving its allow-list), `router_credentials` (F3 — decrypt `http`/`sse` auth + `stdio` env secrets **only** at invoke time), `feature_states` / `settings` / `user_preferences` (RW6 — a per-space "tools enabled" 4-state feature gate, resolved via C4).

### 3.3 Written via `/rpc/mcp/*` (as `service_role`, capability `mcp.manage`)

`config.mcp_servers`, `public.tenant_mcp_servers`, `public.mcp_server_tools` (X1 writes the discovery cache after a `tools/list`), `public.tool_allow_lists`. Runtime writes to `audit_events` (O1) + `quality_signals` (C6) go via C4/C1 (X1 owns no audit/signal schema).

### 3.4 Seed

The orphan `database/import/dev/staging/mcp_servers.jsonl` (currently two `stdio` demo servers — `strategos`, `filesystem`) is **wired into `loader.sql`** as platform-scoped `config.mcp_servers` rows (RW3 / RW11).

### 3.5 RLS posture (per DECISIONS §2 W1)

- `config.mcp_servers` (platform rows): readable by all authenticated in-tenant callers; `service_role`-write only. Tenant-scoped rows: tenant-scoped SELECT + `service_role`-write.
- `public.tenant_mcp_servers`, `public.mcp_server_tools`, `public.tool_allow_lists`: tenant-scoped SELECT (`tenant_id = (auth.jwt()->>'tenant_id')::uuid`); **INSERT/UPDATE/DELETE revoked from `authenticated`/`anon`** — all writes through `/rpc/mcp/*`.
- `env_ref` / `auth_credential_id` reference F3 credentials; those rows are **deny-all** to clients (already correct) — X1 never exposes decrypted secrets.

---

## 4. Contracts

### 4.1 HTTP — gateway-mediated registry writes (C1 `/v1/mcp/*`, capability `mcp.manage`)

C1 (§4.2) exposes the endpoints; X1 supplies the handler bodies. Privileged **writes** are the control plane `POST /rpc/mcp/<action>` per DECISIONS §5a; **reads** are `GET /v1/mcp/*`. Tenant-scoped from `RequestContext`, capability-checked (`mcp.manage`) server-side, each success emits an `audit_events` row.

| Endpoint (`POST`) | Body (concrete) | Effect |
|---|---|---|
| `/rpc/mcp/register-server` | `{ scope, name, label, transport, command?, args?, url?, auth_credential_id?, env_ref? }` | INSERT `config.mcp_servers`; then run discovery (§6.1) → populate `mcp_server_tools`. `stdio` scope is validated **device-registrable only** (see §5). |
| `/rpc/mcp/set-enablement` | `{ id, enabled, config_override? }` | UPSERT `tenant_mcp_servers` (tenant opts a platform/own server in/out). |
| `/rpc/mcp/refresh-tools` | `{ id }` | Re-run MCP `tools/list`; refresh `mcp_server_tools` (new/removed tools reconciled, `is_active` toggled). |
| `/rpc/mcp/set-allow-list` | `{ role_id, space_id?, grants: [{ mcp_server_id, tool_name? }] }` | Replace the `tool_allow_lists` grants for that `(role, space)` scope (default-deny — absent ⇒ blocked). |
| `/rpc/mcp/disable-server` / `/rpc/mcp/delete-server` | `{ id }` | Disable (soft) / delete a tenant-owned server; platform servers can only be tenant-disabled via `set-enablement {enabled:false}`. |

`GET` read models are served under C1's authenticated read surface (tenant-scoped SELECT via PostgREST or a C1 `/v1/mcp/*` read route, e.g. `GET /v1/mcp/servers`, `GET /v1/mcp/servers/{id}/tools`, `GET /v1/mcp/allow-lists`): server list, `mcp_server_tools`, and the **resolved allow-list matrix** for a `(role, space)` showing each tool as `granted | blocked-by-policy`.

### 4.2 Inference-time tool contract (C1 `/v1/chat` etc.)

`/v1/chat` gains an optional tool dimension resolved from the allow-list (not client-declared tool defs):
```jsonc
// request (additive to C1 §4.1)
{ "messages": [...], "space_id": "uuid", "tools": "auto" | "none" | ["server.tool", ...] }
// "auto" = offer the full resolved allow-list for (identity roles × space); an explicit
// list is intersected with the allow-list (a request for a non-allowed tool is dropped, not honored).
```
The response `governance` block (C4 §4.4) gains tool-call provenance:
```jsonc
"tools": [
  { "server": "filesystem", "tool": "read_file", "outcome": "invoked",
    "redactions": [{ "direction": "input|output", "type": "SECRET_*", "count": 1 }],
    "latency_ms": 42, "plane": "local|cloud" },
  { "server": "web", "tool": "fetch", "outcome": "blocked_not_in_allow_list" }
]
```
Only tool name + outcome + redaction **counts/types** surface to clients — never raw args/results or offsets.

### 4.3 Rust — `crates/tools` public surface (consumed by C1 + `src-tauri`)

```rust
/// Resolves the effective allow-list for a caller in a space. Default-deny.
#[async_trait]
pub trait AllowListResolver: Send + Sync {
    async fn resolve(&self, ctx: &RequestContext, space_id: Option<Uuid>)
        -> Result<AllowedToolSet, ToolError>;
}

/// The set the model may be offered + validated against at call time.
pub struct AllowedToolSet {
    pub tools: Vec<ToolDef>,                 // name, description, JSON-Schema input, server ref, transport, plane
    pub by_key: HashMap<ToolKey, ToolBinding>, // fast membership check for enforcement
}
pub struct ToolKey { pub server_id: Uuid, pub tool_name: String }

/// Invokes a single tool call, applying SSRF/sandbox + C4 redaction. Enforcement happens here too:
/// an unknown/unallowed key returns Err(ToolError::NotAllowed) — the gateway never bypasses this.
#[async_trait]
pub trait ToolInvoker: Send + Sync {
    async fn invoke(&self, ctx: &RequestContext, allowed: &AllowedToolSet, call: ToolCall)
        -> ToolResult;   // Ok(output) | Blocked | Error, all audited + signalled
}

pub struct ToolCall  { pub server_id: Uuid, pub tool_name: String, pub arguments: serde_json::Value }
pub enum ToolOutcome { Invoked, BlockedNotAllowed, BlockedSsrf, BlockedRedactionFailClosed, Error(String) }
pub struct ToolResult { pub outcome: ToolOutcome, pub output: Option<serde_json::Value>, pub redactions: Vec<RedactionSummary>, pub plane: Plane, pub latency_ms: u32 }

/// Transport clients (behind McpClient). stdio is device-only; http/sse can be central or device.
#[async_trait]
pub trait McpClient: Send + Sync {
    async fn list_tools(&self) -> Result<Vec<ToolDef>, ToolError>;              // MCP tools/list
    async fn call_tool(&self, name: &str, args: serde_json::Value) -> Result<serde_json::Value, ToolError>; // MCP tools/call
}
// impls: StdioClient (D1 sidecar), HttpClient (SSRF-filtered), SseClient (SSRF-filtered)

/// SSRF policy applied to every http/sse request (see §5).
pub trait EgressFilter: Send + Sync {
    fn check(&self, url: &Url) -> Result<PinnedIp, SsrfReject>;   // resolve, deny private/link-local/meta, pin IP
}
```

### 4.4 Agentic loop hook (used by C1 `/v1/chat`)

```rust
/// Driven by C1 around Gateway::execute; bounded, budget-metered.
pub struct ToolLoopConfig { pub max_iterations: u8 /* default 8 */, pub per_call_timeout_ms: u32 }
// C1 loop: engine turn -> if response contains tool_use(s) in the allowed set ->
//   X1.invoke each (C4 redact in/out) -> append tool_result messages -> next engine turn
//   (each turn = one reserve->commit + one inference_calls row) ... until a final answer or max_iterations.
```

### 4.5 Events emitted (via C4/C1)

- **Per tool invocation:** one `audit_events` row (`actor_id` = caller identity; server, tool, outcome — never raw args/results) **and** one `quality_signals` row (C6; redaction counts/types, latency, plane, blocked reason).
- **Registry change** (`/rpc/mcp/*`): one `audit_events` config-change row.
- **Blocked call** (not-in-allow-list / SSRF / redaction-fail-closed): audit + signal with the block reason.

---

## 5. Security & RLS

X1 is a **security control**; its posture is a build gate.

- **Allow-list enforced server-side at tool-call time (DECISIONS §1.1).** Default-deny. C1 offers the model only the resolved `AllowedToolSet`; every model-emitted `tool_use` is re-checked against `AllowedToolSet.by_key` in `ToolInvoker::invoke` before execution. A forged/hallucinated/non-granted tool → `BlockedNotAllowed` (audited). UI never authorizes — the runtime does.
- **`stdio` = device-plane only (DECISIONS §1.1; module seed).** The **central gateway never spawns a subprocess.** `stdio` servers run **only** on the desktop via D1's sandboxed sidecar; `register-server` rejects a central-plane `stdio` registration for web use. Web (non-desktop) callers therefore get **only `http`/`sse` + platform tools**; `stdio` tools appear only in the desktop app. Sandbox: restricted working dir (jail), minimal env (only `env_ref` secrets injected on-device from F3), no ambient network unless the tool declares it, resource/time limits, and the subprocess is killed on device revocation.
- **SSRF filter on every `http`/`sse` tool (DECISIONS §1.1).** Before any request: resolve the host, **deny** loopback (`127.0.0.0/8`, `::1`), link-local + **cloud metadata** (`169.254.0.0/16`, incl. `169.254.169.254`), private ranges (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), and `0.0.0.0`; **scheme allowlist** (`https` only; `http` local-dev only); **pin the resolved IP** for the actual connection (anti DNS-rebinding); refuse redirects that resolve to a denied range; enforce a response **size cap + timeout**. Optional per-tenant hostname allowlist (policy). Local-dev may allow loopback behind an explicit flag.
- **Tool-egress redaction is mandatory + fail-closed (DECISIONS §2 W5).** X1 calls C4 `redact_text(ctx, ToolInput, args)` before send and `redact_text(ctx, ToolOutput, result)` before the result re-enters the model. If a detector faults/times out, the call is **blocked** (`BlockedRedactionFailClosed`) — never passed through raw. Redaction is one-way placeholders (v1). Runs on the **local plane too** (the `governance` crate is compiled into D2/`src-tauri`), so on-device tool I/O is guarded identically.
- **Tenant isolation.** Allow-list resolution and every registry read/write are tenant-scoped from the verified `RequestContext` (never the body). Tenant A cannot see, enable, or invoke tenant B's registered server; platform servers require an explicit per-tenant `tenant_mcp_servers` enable. `space_id` membership is validated before resolving that space's allow-list.
- **Capability + authz.** Registry/allow-list writes require `mcp.manage` (F2-owned; C1 `require(ctx, cap)` server-side; 403 + audit otherwise). Invocation is gated by the allow-list, not a capability. All writes are `service_role` via `/rpc/mcp/*` (§2 W1) — no direct PostgREST write path exists.
- **Secrets.** `http`/`sse` server auth + `stdio` env secrets live in the **F3 vault** (`router_credentials` / referenced credential), decrypted only at invoke time inside the trusted boundary; never returned by any read, never logged, never placed in a trace/audit/signal row.
- **Device-status gate.** Because tool loops run inside C1's authenticated hot path, the C1 per-request device-status check (§C1 §5) already covers device-revoked callers; a revoked device cannot invoke tools.
- **Negative-test gate.** Prove: a non-granted tool is never invoked (blocked + audited); a `stdio` server cannot be central-registered/invoked; an `http` tool whose URL resolves to `169.254.169.254` (or a private range, incl. via redirect/DNS-rebind) is blocked; a secret in tool I/O is redacted; a caller without `mcp.manage` gets 403 on `/rpc/mcp/*`; cross-tenant server read returns 0 rows; `router_credentials`/`env_ref` never appear in any response/log.

---

## 6. Key flows

**6.1 — Register an MCP server + discover tools (`/rpc/mcp/register-server`).**
1. C1 auth → `RequestContext`; `require(ctx, mcp.manage)`. 2. Validate transport rules (`stdio` ⇒ device-only + `command`; `http`/`sse` ⇒ `url` + optional `auth_credential_id`). 3. INSERT `config.mcp_servers` as `service_role`. 4. Instantiate the `McpClient` for the transport and call `list_tools()` (SSRF-filtered for `http`/`sse`; on-device sidecar for `stdio`). 5. UPSERT `mcp_server_tools` (name, description, `input_schema`, annotations). 6. Emit `audit_events`. 7. Return the server + discovered tool count.

**6.2 — Set a per-(role × space) allow-list (`/rpc/mcp/set-allow-list`).**
1. Auth → `require(ctx, mcp.manage)`. 2. Validate each grant's `mcp_server_id`/`tool_name` exists in `mcp_server_tools` and is tenant-visible. 3. Replace `tool_allow_lists` rows for that `(role_id, space_id)` scope as `service_role`. 4. Audit. (Absence ⇒ default-deny; the Admin matrix renders granted vs blocked-by-policy.)

**6.3 — Resolve the effective allow-list (per inference request).**
1. From `RequestContext` roles + `space_id`, `AllowListResolver::resolve` unions grants across the caller's roles, scoped to the space (plus role-level tenant-wide grants where `space_id IS NULL`). 2. Filter to servers `enabled` for the tenant (`tenant_mcp_servers`) and, on web, drop `stdio` servers. 3. Apply the C4 4-state **tools feature gate** for the space (locked/off ⇒ empty set). 4. Produce `AllowedToolSet` (definitions offered to the model + a fast membership map).

**6.4 — Agentic chat with tools (`POST /v1/chat`, `tools:"auto"`).**
1. C1 builds `RequestContext`, resolves `AllowedToolSet` (6.3). 2. C4 `guard_request` (redact prompt/context). 3. Budget **reserve**. 4. Engine turn with the allowed tool definitions attached (GH-7). 5. If the response contains `tool_use` block(s): for each, `ToolInvoker::invoke` → **allow-list re-check** → C4 `redact_text(ToolInput)` → SSRF/sandbox → `McpClient::call_tool` → C4 `redact_text(ToolOutput)` → append a `tool_result` message. 6. **Next engine turn** (another reserve→commit + `inference_calls` row). 7. Loop until a final answer or `max_iterations`. 8. C4 `guard_response`; budget **commit** (covers all turns); persist; return with the `governance.tools` provenance.

**6.5 — Blocked tool call.** Model requests a tool not in `AllowedToolSet` (or one that fails SSRF/redaction). `ToolInvoker` returns `Blocked*`; the loop feeds a **tool_error** result back to the model (so it can recover), records the block in `governance.tools`, and emits audit + signal. The call is **never executed**.

**6.6 — `stdio` tool on the desktop.** The desktop `src-tauri` (D1) hosts the `StdioClient`: D1 launches the sandboxed subprocess; `crates/tools` (compiled into `src-tauri`) drives `tools/list` / `tools/call` over stdio; C4 redaction (via the local `governance` crate) guards I/O; execution-location = `local`. Central plane is never involved for `stdio`.

**6.7 — Credential injection.** For an `http`/`sse` server with `auth_credential_id` (or a `stdio` server with `env_ref`), X1 decrypts the F3 credential **at invoke time** inside the trusted boundary and injects it into the request headers / subprocess env; the plaintext never enters a response, log, trace, or audit row.

---

## 7. Gateway-crate dependencies

X1 consumes `sensei-*` @ **`v0.4.6`** as a consumer; the tool runtime is Torii-owned. The one enhancement is the request/response tool-schema plumbing.

| Issue | What X1 needs | Blocking? |
|---|---|---|
| **GH-7** | **MCP / tool-calling support.** No `mcp` crate exists among the six. **Resolution (§8 D1):** tool *invocation* is consumer-side in X1/C1 — GH-7's scope narrows to the engine **request/response plumbing** only: (a) accept tool/function *definitions* on `InferenceRequest`; (b) surface provider `tool_use`/`tool_call` blocks on `InferenceResponse` **and** `StreamChunk` in a **provider-normalized** shape (Anthropic tool use first — the v1 OAuth/BYOK provider); (c) round-trip `tool_result` messages back into the next turn. If the engine already normalizes this, X1 consumes it; if not, GH-7 adds it. The invocation loop, allow-list, SSRF, sandbox, and redaction never move into the crate. | **Yes** — before the X1 inference-tool phase. Registry + allow-list + `stdio`-only desktop tools can ship without it; the *cloud* agentic loop needs it. |
| **GH-6** | Streaming redaction hook — informs whether tool-call deltas arriving mid-stream are buffered for C4's windowed redaction before the tool fires (C4 owns; X1 waits for a full tool_use block before invoking, so non-blocking for X1). | Investigate (C4-owned). |
| **GH-1** | Per-step `plane` on the trace — so `governance.tools[].plane` (`local|cloud`) is populated; else `unknown`. | Non-blocking (degrades to `unknown`). |

Each is a gateway-repo issue (create → implement → close), released via the lockstep tag bump, sequenced before its dependent Torii phase. See [`../plans/gateway-issues.md`](../plans/gateway-issues.md).

**Torii-side (non-crate) dependencies:** an MCP client implementation (official `rmcp` Rust SDK or equivalent) for `stdio`/`http`/`sse` transports; an SSRF-safe HTTP client (IP-pinning). The C4 `governance` crate for `redact_text`.

---

## 8. Decisions resolved

Applying the ratified defaults + settling X1's residuals:

1. **D1 — Tool invocation is consumer-side in X1/C1; GH-7 enhances only request/response tool-schema plumbing.** *Rationale:* mirrors C4 — the `v0.4.6` engine has no MCP crate or invocation orchestrator, and the security controls that matter (allow-list, SSRF, sandbox, W5 redaction) **must** be Torii-owned and testable outside the crate. Pushing invocation into the engine would bury the security boundary. The crate is enhanced (GH-7) only to carry tool definitions and surface normalized `tool_use` blocks, so X1 doesn't hand-write per-provider tool-calling wire formats.
2. **D2 — `stdio` transport is device-plane only; the central gateway never spawns subprocesses.** *Rationale:* running arbitrary local processes on the shared central service is an unacceptable RCE/lateral-movement surface. `stdio` tools run sandboxed on the user's device via D1; web callers get `http`/`sse` + platform tools only. `http`/`sse` may run centrally or on-device.
3. **D3 — Allow-list is default-deny, grant-only, keyed `(role × space)` → `(server, tool)` with a per-server wildcard.** *Rationale:* DECISIONS §1.1 (per-(role×space) allow-list); default-deny is the safe posture; wildcard keeps admin ergonomics for trusted servers without enumerating every tool. No `deny` rows in v1 (grants under default-deny suffice).
4. **D4 — `http`/`sse` auth and `stdio` env secrets live in the F3 vault; never in `mcp_servers` plaintext.** *Rationale:* DECISIONS §2 W4 — no plaintext secrets at rest; `service_role`-only, decrypted at invoke time inside the trusted boundary.
5. **D5 — X1 adds `mcp_server_tools` (discovered-tool cache) to F1 rework RW3.** *Rationale:* the allow-list references concrete tool names, and the Admin matrix + the model's offered tool set need discovered names + JSON-Schemas; caching `tools/list` avoids a live round-trip per request. Refreshed via `/rpc/mcp/refresh-tools`.
6. **D6 — The agentic tool loop is bounded (`max_iterations`, default 8) and each model turn is a separately metered `inference_calls` row.** *Rationale:* tool calling is inherently multi-turn; a bound prevents runaway loops/cost, and per-turn metering keeps the budget cascade (C3) honest. Budget reserve estimates cover the expected turns; overruns hit the `hard`-cap block like any call.
7. **D7 — Tool-egress redaction is fail-closed and applies on both planes.** *Rationale:* DECISIONS §2 W5 — a tool is a raw egress channel to a third party; a redaction fault must block, not leak. The `governance` crate compiles into D2 so on-device tool I/O is guarded identically.
8. **D8 — Tools carry no budget/credential-bound spend.** *Rationale:* DECISIONS §2 W2 — budget binds to the caller's identity/node; the surrounding inference turns are what accrue spend. Tool execution itself is not separately budgeted in v1.
9. **D9 — v1 MCP scope = tools only (not resources/prompts).** *Rationale:* tool-calling is the ratified v1 surface (Admin Tools & MCP + agentic retrieval); MCP resources/prompts are a later addition (§10) once the tool path is proven.

---

## 9. Acceptance criteria (observable, testable)

1. **Register + discover.** Registering an `http` server via `/rpc/mcp/register-server` runs `tools/list`, populates `mcp_server_tools`, and the server + tools appear in the Admin read model.
2. **Seed loads.** `dbd reset && dbd apply && dbd import` loads `mcp_servers.jsonl` as platform `config.mcp_servers` rows.
3. **Default-deny enforcement.** With no allow-list grant for a member's `(role × space)`, `/v1/chat` offers **zero** tools; if a forged request names a tool, the model's `tool_use` for it returns `blocked_not_in_allow_list` and the tool is **never executed** (asserted by no `tools/call` reaching the server + an audit row).
4. **Grant works.** After `/rpc/mcp/set-allow-list` grants `filesystem.read_file` to `(role, space)`, a member in that space can invoke it; a member in a different space cannot.
5. **SSRF block.** An `http` tool whose `url` resolves to `169.254.169.254` (and to a `10/8` address, and via a redirect to a private range, and via a DNS-rebind) is blocked (`blocked_ssrf`) before any connection; audited.
6. **`stdio` device-only.** A central-plane attempt to register/invoke a `stdio` server for web use is rejected; on the desktop the same server runs sandboxed and returns a result with `plane=local`.
7. **Tool-egress redaction.** A secret placed in a tool **input** and one in a tool **output** are both replaced with `⟦REDACTED:SECRET_*⟧` before egress/re-entry; `governance.tools[].redactions` reports type+count; a `quality_signals` row exists. A detector fault yields `blocked_redaction_fail_closed` (no raw pass-through).
8. **Agentic loop.** A prompt that triggers two tool calls completes within `max_iterations`, writes one `inference_calls` row per model turn, and the budget commit covers all turns; a loop that would exceed `max_iterations` terminates with a bounded result.
9. **Capability gating.** A caller without `mcp.manage` gets `403` + audit on every `/rpc/mcp/*` write; with it, the write succeeds and is audited.
10. **Tenant isolation.** A tenant-A caller sees/enables/invokes only tenant-A + enabled-platform servers; cross-tenant server SELECT returns 0 rows.
11. **Secret hygiene.** `auth_credential_id`/`env_ref` decrypted material never appears in any read, response, log, trace, audit, or signal row (log-scan test).
12. **Feature gate.** When the space's "tools" feature resolves to `locked/off` (C4 4-state), the allow-list resolves empty regardless of grants.

---

## 10. Open questions (genuine)

1. **GH-7 final shape.** Pending the crate investigation: does `sensei-gateway` already normalize provider tool-calling (Anthropic `tool_use`) on the request/response, or must GH-7 add it? Affects only how X1 attaches tool defs / parses `tool_use`, not the enforcement/invocation design.
2. **`stdio` for web callers.** Web users have no device to sandbox a `stdio` subprocess. v1 answer: web gets `http`/`sse` + platform tools only. Open: whether a future central sandbox (gVisor/Firecracker microVM) should host vetted `stdio` servers centrally, or whether they stay strictly desktop.
3. **Reserve estimation for multi-turn tool loops.** How C1 estimates the reserve for an agentic call whose turn-count is unknown up front (over-reserve vs. re-reserve per turn) — shared with C1 open question 4.
4. **MCP resources & prompts.** v1 is tools-only; when to admit MCP *resources* (as a C5 retrieval source) and *prompts* (into the prompt-template library, W1 item 8).
5. **Per-tool/server rate limiting + quotas.** Whether tool invocation needs its own rate limit (beyond the API-key rate limit + budget), especially for expensive external `http` tools.
6. **Tool result provenance in citations.** Whether tool outputs used in an answer should surface as citations (like retrieved chunks) in the Ask/Playground trace — coordinate with C5/C6.
