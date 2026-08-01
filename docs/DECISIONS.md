# Torii — Authoritative v1 Decision Record

> **Status:** RATIFIED 2026-07-23 (Jerry). This document is the **single source of truth** for v1
> scope, architecture, security, and governance. Where any other doc (README "Open decisions",
> module seeds, `specs/F1-data-model.md`, `mockups/CLAUDE.md`, the phase plans, or the built
> `database/` schema) disagrees, **this document wins** and the other must be reconciled to it.
> The mockups under `docs/mockups/app/*.jsx` remain the authoritative **UI** ground truth.
>
> Derived from the 2026-07-23 doc-clarity analysis (10 deep-readers + 6 synthesis lenses). The
> analysis found three diverging sources of truth (June decisions vs. module docs vs. the built
> schema) plus a gateway crate that was refactored (v0.2.x → v0.4.6) out from under every doc.

---

## 1. Product scope (v1)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | **MCP / tools** | **Full v1.** `mcp_servers` + `tenant_mcp_servers` + per-(role×space) tool-allow-list tables in the F1 cut; wire the orphan `mcp_servers.jsonl` seed; Admin **Tools & MCP** screen (register servers, edit allow-lists). The gateway enforces the allow-list **at tool-call time** (server-side, not UI-only): SSRF-filter `http/sse` tools, sandbox `stdio` tools. |
| 2 | **Programmatic API keys** | **Full v1, owned by the Organization screen** (move from Billing). `api_keys` authenticate an **identity** — a person or a `service_account` — with a hashed secret + public prefix, capability scope, rate-limit, rotate/revoke, **reveal-once** issuance. **No budget is attached to a key** (see §2 W2): budget is a property of the caller's identity in the role/budget hierarchy, resolved + enforced at execution time; multiple keys for one identity share that identity's budget. A `service_account` is itself a node in the hierarchy (its own `budget_nodes` leaf, `kind='service'`). |
| 3 | **Agents & Workflows** | **The ENTIRE Workflows module is v2 — design-only screens in v1** (confirmed 2026-07-23). Both **agent** workflows and **non-agent "flow"** workflows are v2: the mockup screens (`view-workflows.jsx` + `view-workflows-builder.jsx`) are *designed* in v1 but **non-functional / "v2 preview"** — no interactive create/run/persist, no runtime. **No** `plans`/`planned_tasks`/`planned_task_interactions` or any workflow-runtime tables in v1. **X2** owns them ("design in v1, runtime v2"). |
| 4 | **Role model** | **Full role + permission matrix, now.** Build `roles` / `role_permissions` / `profile_roles`; a single hierarchical tree drives **both** permissions and budgets; new Admin **permission-matrix** screen. This **replaces** the built fixed-six `profile_tenants.role` enum and **reworks all RLS role predicates**. Reconcile the three divergent mockup role vocabularies into this one model. |

## 2. Security posture (first-class — the "sure budgeted access" premise)

The built F1 schema currently has critical holes (any `authenticated` user can `UPDATE profile_tenants SET role='owner'`, raise their own budget, self-join confidential spaces, forge audit rows; `feature_states` is anon-writable). The following posture closes them and is a **build gate**:

- **W1 — Write path (gateway-mediated).** Privileged tables — roles, budgets, routing chains, governance/classification, `space_members`, catalog overrides — become **`service_role`-write-only**. Web clients get `SELECT` + writes **only** on clearly self-owned benign rows (own draft docs, own preferences). Every privileged mutation goes through the central gateway (or a thin authz API) that enforces the permission matrix server-side. No direct PostgREST writes to privileged tables.
- **W2 — Budget enforcement (hard reserve).** The gateway does a pre-call **reserve → commit** against a `service_role`-only ledger. Nodes flagged `hard` cannot be exceeded even under concurrency; `soft` nodes allow bounded overshoot + alert. Client-facing metering is read-only. The org→dept→team→user cascade ("every ancestor must have headroom") + `spent_amount` rollup are enforced in the gateway/DB, not prose. **Budgets bind to identities/nodes in the hierarchy — never to credentials or keys.** At execution the gateway resolves the authenticated caller (person or service account) → their budget node(s) → runs the cascade; which provider credential (BYOK key or OAuth account) fulfils the call is irrelevant to metering.
- **W3 — JWT verification (RS256/JWKS).** C1 verifies Supabase JWTs with an asymmetric **verify-only** public key from the JWKS endpoint — not a shared HS256 secret. Confirm/enable asymmetric signing on the Supabase project.
- **W4 — Key custody (F3 before real keys).** The DEK/KEK envelope vault (F3) **must** land before C1 handles any real BYOK key — no deployed phase holds plaintext provider keys. Production KEK lives in a cloud **KMS/HSM**; `TORII_KEK` env var is **local-dev only**. F3 gets a real phase plan, sequenced before C1 goes live.
- **W5 — Secret/PII leak prevention (redaction/DLP).** Accidental secrets/keys/tokens/passwords/PII in documents or chat must **never leak during (agentic) interactions**. Two layers: **(1) redact-at-rest** — during C5 ingestion, detect + redact secrets/PII in the normalized markdown **and before embedding**, so the vector store/index never holds raw secrets (**one-way placeholders only for v1** — no reversible mapping store; reversible un-redaction for authorized roles is post-v1); **(2) redact-in-flight** — scan + redact prompts, retrieved context, agent messages, and **MCP tool inputs/outputs** before they egress to any model or tool (cloud especially). Detectors: high-recall secret scanners (API-key/token patterns + entropy) + PII classifiers — use vetted libraries, not hand-rolled regex. Enforced consumer-side (C4 wrapper) at three points: C5 ingestion, C1/C4 inference, X1 tool egress. Every redaction is a quality/audit signal (§3b).
- **Apply-without-asking:** `audit_events` INSERT binds `actor_id = auth.uid()` (or is `service_role`-only, gateway-emitted); `config.feature_states` gains `tenant_id` + RLS and **revokes anon writes**; per-request **device-status check** on the C1 proxy hot path (a revoked device with a live JWT cannot keep spending); Supabase Realtime channels are RLS-scoped; offline usage/audit buffers are signed + idempotent (anti-replay/anti-under-report).
- **At-rest key custody is already correct** (`router_keys`/`tenant_keys` RLS deny-all + `service_role`-only + AES-256-GCM envelope, C1 sole decryptor) — keep it.

## 3. Architecture

- **Gateway crate:** pin **`v0.4.6`** (latest; six `sensei-*` crates: `kernel`, `gateway`, `cloud-providers`, `local-engine`, `local-providers`, `kokoro`). There is **no** `gateway-embedded` and **no** `InferenceAdapter` (deleted → capability-segregated traits `ChatModel`/`EmbedModel`/…). Fix the monorepo `Cargo.toml` `[patch]` and every C/D doc (C1 `v0.2.18`, D2 `gateway-embedded`+`InferenceAdapter`, C5 `fastembed`, clients-buildout `v0.2.23`) to the real names + version.
- **Crate enhancements (owned in this project — not a separate session).** Each is tracked as a **gateway-repo issue (create → implement → close)** and released via the lockstep tag bump (`develop → make bump → main → develop`, see [[feedback_gateway_release_flow]]); each is **sequenced before its dependent Torii phase**. Known enhancements: (a) per-step `plane` + execution-location on `ChainEntry`/`Attempt`/trace (D3/C2 unified split-plane trace); (b) **OAuth/bearer provider credential** support in `sensei-cloud-providers` if the adapter is key-only today (for Anthropic-style OAuth accounts). **Rerank** = a separate C5 service for v1 (crate `TextRerank` is a reserved `Unsupported` variant — a `RerankModel` trait is a later optional issue). **C4 governance** = a consumer-side wrapper around `execute`/`execute_stream` (the engine has no in-request hook) — correct the "inline guardrails" wording.
- **Capabilities are chain-managed (the universal mechanism).** Every capability — chat/reasoning, **embedding**, (later) rerank — resolves through a **fallback chain** bound per capability (and per space/role). The models bound into a chain determine what it does: a chain with a reasoning model does reasoning; an **embedding chain** with embedding models does embeddings. The same fallback / circuit-breaker / **per-step plane (local|cloud)** machinery applies to embedding chains exactly as to chat chains. Adapters (embedded llama.cpp, ORT, cloud providers, HTTP Ollama) are just **registered into the registry**; the chain selects them per capability. **Capability is an attribute of the MODEL, not the provider** — one adapter/provider serves many models, each with its own capabilities (chat/reasoning, embed, rerank, vision, tool-use) tracked in `model_capabilities`; a chain step's behavior derives from its **bound model's** capability. So the *same* embedded/Ollama/cloud provider can supply a reasoning model to a chat chain and an embedding model to an embedding chain. **No capability is hardwired to a provider or adapter** — models/endpoints/chains are operator-managed config (see [[project-gateway-no-hardcoded-ops]]).
- **Local inference/embeddings — desktop = EMBEDDED (in-process, no daemon).** These adapters are what **local chain steps** bind to. `sensei-local-providers` runs models **in-process** via `EmbeddedLlamaAdapter` (llama.cpp; implements **chat and embed**; runs GGUF, reusing Ollama- or HF-hub-pulled model bytes — "the way the ollama router does") with `OrtAdapter` (ONNX) as an embed option; the model registry handles pull (Managed → Ollama → HF). **This is the desktop local plane — no external Ollama daemon required.** Separately, `sensei-cloud-providers::OllamaAdapter` is **Ollama over HTTP** to a running server (a router/cloud option, *not* the desktop-embedded path). **v1 desktop local = embedded in-process**; pick a **1024-dim** embedding model (a GGUF embed model for `EmbeddedLlamaAdapter`, or ONNX for `OrtAdapter`) to match `document_embeddings vector(1024)`. `fastembed` is disabled — don't use it. (GH-3 resolved — no blocking crate enhancement.)
- **Provider credential vault (F3):** stores two credential **types** per router — **API key** (BYOK static secret) **and OAuth account** (e.g. Anthropic OAuth: access + refresh token, expiry, scopes, token endpoint). Both encrypted at rest (DEK/KEK envelope), `service_role`-only, never exposed to clients. OAuth accounts are **auto-refreshed before expiry** by a background refresher (F3/central); the Connections screen supports connect-via-OAuth alongside paste-a-key. Storage generalizes `router_keys` → **`router_credentials`** (`type = api_key | oauth`). **Credentials carry no budget** (§2 W2). **OAuth provider scope (v1): Anthropic only** — build + test the OAuth connect/refresh flow for Anthropic; all other providers use BYOK API keys in v1 (generalize later). **AMENDED 2026-07-27 (OAuth acquisition method):** Anthropic offers **no self-serve third-party OAuth client_id** — the community "subscription" PKCE flow reuses the **public Claude Code client_id** on **unofficial** endpoints, and Anthropic's ToS restricts subscription tokens to **official clients**, so harvesting them into a multi-tenant SaaS risks customer **account bans** and breakage. **v1 connect = paste a bearer token** (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic's sanctioned non-official-client token; long-lived → no refresh worker). **PKCE is still supported but config-driven** (client_id + authorize/token URLs operator-supplied, never hardcoded — [[project-gateway-no-hardcoded-ops]]) and **off by default**; it lights up only with a legitimate client_id (an official Anthropic app, or self-host at the operator's own ToS risk) — **not** enabled for customer traffic. Plan: [[f3-oauth-credential-vault-plan]].
- **Identity/sign-in (F2):** **magic link (passwordless email) is the primary v1 sign-in** — simplest, Supabase-native (confirmed 2026-07-23) — and the **registration / new-account shape**; **email+password is a supported secondary** (set/reset password + password sign-in) — **AMENDED 2026-07-31, see §10.2**; OAuth (Google/GitHub) optional. The region + IdP shown in the mockups are **examples / operator-config, not baked constants**. **SAML SSO + SCIM are fast-follow (v1.x)** — onboarding designs a stubbed SSO step. JWT verification is RS256/JWKS (§2 W3).
- **Document ACL (v1):** space membership + fixed 4-level classification **only**. **Retire** the dead `access_groups` / `group_levels` / `document_access` recursive-ACL tables + `user_accessible_documents` view (currently unenforced — dormant security surface).
- **One authoritative ledger:** consolidate on the crate-native **`inference_calls`** (`service_role`-write); add org→dept→team→user attribution columns + a rollup path; **retire** `gateway_tasks` cost duplication. This is both the budget source of truth and the O1/O2 analytics source.
- **Build model:** **author ALL missing module specs + phase plans up front** (12 unplanned modules: F3, C2, C3, C4, C5, D4, W1, W3, W5, O2, O3, X1; and Phases 3/3.5/4/5), to build-ready depth (observable AC, no TBDs). Then run the build **autonomously with a human checkpoint after each phase**. Secrets/approvals (Supabase signing config, `SUPABASE_JWT_*`, paid-provider-call authorization) are front-loaded.

## 3a. Document center & RAG (C5 · W2 Library · W3 Playground)

Under-specified earlier; capturing the fuller vision. A dedicated **research-backed C5 design** + a **document-center design** (`design/rag-and-document-center.md`) are authored in step 4, assimilating current published best practices (hybrid/graph/vector retrieval, chunking, reranking, evaluation, contextual retrieval).

- **Retrieval (v1, composable per space).** A robust, composable stack — not one mode: **classic (BM25/keyword) + dense vector + hybrid fusion**, **semantic / structure-aware chunking**, **contextual retrieval**, **cross-encoder rerank** (C5 service), with **GraphRAG** (entity/relation graph) and advanced modes (**RAPTOR**, **multi-vector/ColBERT**, **SQL-RAG/text-to-SQL**, **agentic** retrieve→reason→re-retrieve) selectable per space. **Default stack:** markdown-first parse → semantic/structural chunking → contextual retrieval + hybrid (dense+BM25) → cross-encoder rerank → grounded generation with citations. Playground exposes the selector + retrieval inspector; admins/space-owners set defaults (feature-governed, member experiments session-only).
- **Document center (v1 storage + management).** **Markdown-first ingestion**: parse **PDF / DOCX / PPTX / XLSX / images** into markdown (prose → md; tables → md + CSV; images/figures → extracted, captioned assets), **always keeping and referencing the original**. Tenant/space-scoped **object storage** (Supabase Storage / S3-style buckets) for originals + normalized artifacts. **Dedup** (content hash + lineage), **versioning** (re-upload = new version, history kept), collections/folders/tags, bulk actions, an ingestion-status pipeline (queued→parsing→chunking→embedding→ready/failed), and preview (rendered md / table-as-grid / image gallery).
- **Ownership & collaboration.** Documents carry **ownership at multiple levels** — org / space / individual (via `documents.scope` + `owner_id` + space) — layered on the space+classification ACL. **Collaborative editing, comments, and corrections are a forward-looking capability: v2 runtime, design-only screens in v1.** Users interact **via chat**, and an **agent performs the actual edits/suggestions** to the document — this aligns with agents = design-only (v1) / runtime (v2). v1 designs the surfaces (comment threads, suggestion/correction review, a chat-to-edit panel, per-doc collaborators owner/editor/commenter/viewer); the agent-driven edit **runtime** ships with X2 in v2.
- **Tiering:** robust retrieval + markdown-first ingestion + storage/dedup/versioning/ownership = **v1**. Agent-driven collaborative editing runtime = **v2** (screens designed in v1).

## 3b. Quality signals, audit & interaction intelligence (C4 · O1/O2 · W3 · proposed new module C6)

Capture **quality signals** on every interaction, **audit** them, and — forward-looking — use them to actively improve interaction quality via a component that sits **between the user and the gateway** as an optimizing go-between.

- **Signal capture + audit (v1).** Every call/message records quality signals: **explicit** (user rating/thumb, accept/edit/retry, corrections) and **implicit/system** (grounding score, retrieval recall/precision, **LLM-as-judge** quality score, cost, latency, fallbacks taken, guardrail/policy hits, "why this model" trace). Persisted to a `quality_signals` store keyed to `inference_calls` / `messages`, streamed to the immutable audit ledger (O1) and rolled into analytics (O2). Governance application (masking, grounded-only, classification) emits signals too.
- **Live surfacing (v1).** The Playground/Ask live meters (grounding / quality / cost / latency), the quality-judge toggle, and auto-tune-prompt already in the mockups are backed by this store.
- **Interaction intelligence / go-between (v2, forward-looking).** An inference/optimization layer that consumes the signal history + a model of user & LLM responses to **mediate and improve conversations in-flight**: query rewriting/decomposition/HyDE, clarifying questions, applying learned user/space preferences, prompt auto-tuning, model-selection tuning — an adaptive go-between between the user and the system. **Agent-adjacent** (aligns with agents = design-only v1 / runtime v2): design the surfaces in v1, ship the adaptive runtime with X2 in v2.
- **Module placement (confirm in step 4):** default is a new **C6 "Quality signals & interaction intelligence"** (C-plane, in the request path) owning the signals contract + the v2 mediator, with the `quality_signals` store in F1 and audit/analytics in O1/O2 — alternative is to distribute it across C4/O1/O2 with no new module.
- **Tiering:** signal capture + audit + live meters + judge/auto-tune toggles = **v1**. The adaptive go-between optimizer = **v2** (surfaces designed in v1).

## 3c. Sensitive structured data — compute without exposing (C5 · C4 · F3)

Problem: teams (e.g. accounts/payroll) want AI over sensitive tabular data, but sending raw account/salary/PII rows to an LLM (especially cloud) is unacceptable leakage. Approach — **the model sees the structure, not the values; the app does the math**:

- **Structured datasets.** Ingest CSV/XLSX (and tables extracted from docs) as **queryable datasets** stored as JSON/CSV, with a **schema** (column names, types, descriptions, stats) and **column-level sensitivity** classification (`sensitive`/`restricted` columns: salary, SSN, account #, …).
- **Field-level encryption at rest.** Sensitive columns are **encrypted per-tenant** (F3 DEK), decryptable only inside the trusted compute boundary (central gateway `service_role`, or the on-device plane for local-only data). Non-sensitive columns + aggregate stats stay queryable.
- **Schema-to-LLM, execute-in-app.** The LLM receives only the **schema + non-sensitive metadata/samples/aggregates** — never raw sensitive rows. It emits a **computation plan** (text-to-SQL / filter / formula spec); the **app/gateway executes** it against the real data inside the trusted boundary and returns **only the derived, policy-gated result**. Guards: aggregate-only where required, k-anonymity / min-group thresholds, no row-level sensitive values in the response, and the result passes the W5 redaction check before reaching the model or user.
- **Where sensitive decryption + compute runs — v1 = central trusted boundary.** For v1, sensitive-column decryption + the compute step run **only in the central gateway trusted boundary** (`service_role`); the model (cloud *or* local) never sees raw values — only schema + non-sensitive aggregates + policy-gated results. **On-device** decrypt+compute (raw values never leaving the machine) is **deferred** until F3 designs a per-tenant **device-DEK custody** mechanism (today provider/DEK keys never leave central, and desktop holds no secrets). Until then, §3c compute on desktop routes to central.
- **Governance:** column sensitivity + allowed operations (aggregate-only, thresholds, which roles/spaces may compute) are space/admin policy (feature-governed); every compute is an audit + quality signal (§3b).
- **Tiering:** schema + field-encryption + text-to-SQL execute-in-app with aggregate/threshold gating = **v1 direction** for the structured-data surface (builds on SQL-RAG in §3a); richer controls (differential privacy, format-preserving encryption / tokenization) = later. Detailed in the C5 / `design/rag-and-document-center.md` design.

## 4. Governance model

- **Feature governance:** 4-state — `locked` / `default-on` / `default-off` / `user-overridable` — precedence **workspace → space → role → user** (admin workspace default; space owner overrides within it; role narrows inside the space; user preference applies last, only where `user-overridable`). Replaces the mockup's 2-state toggle; drives a new Admin **Feature management** screen and how member toggles render (some shown locked). Add a `user_preferences` table for the user layer.
- **Classification:** fixed at the built 4 levels (`public`/`internal`/`confidential`/`restricted`) for v1 — Governance may relabel display names but not change the set (matches the CHECK constraints + classification RLS).

## 5. Schema deltas required in F1 (consolidated)

New/changed tables & fixes the reworked F1 must carry (details go into the updated `specs/F1-data-model.md` + a rework plan):

- **Add:** `core.profiles` (per-user row = `auth.users.id`, **`claims_version`** bigint counter for the token-staleness/revocation gate, display fields — `profile_tenants`/`profile_roles` FK to it); `roles`, `role_permissions`, `profile_roles` (permission matrix); `mcp_servers`, `tenant_mcp_servers`, tool-allow-list, `mcp_server_tools` (discovered-tool cache); `api_keys`/`service_accounts`; `conversations`, `messages`, `message_citations` (Ask persistence); `prompt_templates`; `user_preferences`; `budget_requests` (member increase-request/approval); **`budget_holds`** + `budget_nodes.{reserved_amount, period_started_at, soft_overshoot_limit}` + `inference_calls.{budget_node_id, org/dept/team/user node attribution, execution_location, hold_id}` (the hard reserve→commit path, §2 W2 — **C3 §3.1 is the canonical shape**; C1 is only a writer); alerts (`alert_rules`/`notification_channels`/`alert_events`); per-tenant catalog **override** tables — `model_overrides`/`provider_overrides` (tenant_id, scope `tenant|space|role` + scope_id, model/provider ref, enabled, price overrides, verified, audit cols); `quality_signals` (§3b, keyed to `inference_calls`/`messages`); **structured datasets** (§3c: `structured_datasets` + `dataset_columns` with per-column sensitivity + field-level encryption for sensitive columns); **routing schema** (C2): `chain_bindings` (named chain ↔ capability ↔ space/role), `routing_policies` (retry/timeout/region/health as operator config, not hardcoded), `provider_health`; `config.config_versions` (D4 delta-sync); O2 analytics **rollup** tables/mviews (`analytics_usage_daily`/`analytics_quality_daily` + `analytics_model_mix_daily`/`analytics_overview_current` — reconstructable cache over `inference_calls`+`quality_signals`, not a parallel ledger). *(v1 redaction is one-way placeholders — no reversible mapping store.)*
- **Rework:** RLS on all privileged tables → role-predicate + `service_role`-write (§2 W1); budget cascade + rollup + hard reserve (§2 W2), budget bound to **identity/node** (not to `api_keys`/credentials); `router_keys` → **`router_credentials`** (`type api_key|oauth` + encrypted OAuth access/refresh/expiry/scopes/token_url); `feature_states` → `tenant_id` + RLS + 4-state + role/space scope; `audit_events` actor binding.
- **Fix:** `similarity_search` `vector(384)` → `1024` and re-point to the space/classification ACL; add config-catalog `SELECT` grants + `core.tenants` client read; add default-space + default-budget seed; add `devices.last_seen` + offline-buffer-health; consolidate to `inference_calls`.
- **Document center (§3a):** `documents.content_hash` (dedup) + lineage; object-storage refs on `document_assets` (originals + normalized md/CSV/images); confirm `document_collections`/`document_versions`/`document_assets` cover collections/versioning; per-space retrieval/chunking config on `spaces`/`settings`. Collaborative-editing tables (comments/suggestions/`document_collaborators`) are **v2** (design-only in v1) — not in the v1 cut.
- **Retire:** `access_groups`/`group_levels`/`document_access`/`user_accessible_documents` (§3); `gateway_tasks` cost fields.

## 5a. API conventions (canonical — resolves the /rpc-vs-/v1 split)

- **Two endpoint surfaces, split by role:**
  - **Inference + reads → REST `/v1/...`** — `/v1/chat`, `/v1/embed`, `/v1/compare`, `/v1/generate`, and read/GET resources (`GET /v1/routing/bindings`, `GET /v1/audit`, …).
  - **Privileged / gateway-mediated writes → `/rpc/<domain>/<action>`** — the capability-gated control plane: `/rpc/budgets/upsert-node`, `/rpc/budgets/approve-request`, `/rpc/roles/*`, `/rpc/chains/*`, `/rpc/connections/upsert`, `/rpc/connections/oauth-start`, `/rpc/governance/*`, `/rpc/spaces/create`, `/rpc/mcp/register-server`, `/rpc/mcp/set-allow-list`, `/rpc/apikeys/create`, `/rpc/models/enable`, `/rpc/devices/*`.
  - **Rationale:** `/rpc/*` is the established majority convention across the corpus (C1, W1, X1, O3, D4, all phase plans) and **mirrors Supabase PostgREST's own `/rpc/<function>` stored-procedure surface** — idiomatic in this stack — cleanly separating the privileged control plane from the `/v1` inference/read plane. Every `/rpc/*` write still enforces the capability matrix server-side (§2 W1); this is a URL-shape rule only. *(Specs that used `/v1/<domain>` for privileged WRITES — C2, C3, C4, F2 — are reconciled to `/rpc/<domain>/<action>`; their GET reads stay on `/v1`.)*
- **JWT claims contract (frozen, owned by F2 §4.1):** `tenant_id` + `role_ids[]` + `claims_version` (+ optional `device_id`) — **no `role` enum claim, no `groups[]` claim**; capabilities resolved server-side from `role_permissions`. `claims_version` is **`bigint`/`i64`** everywhere.
- **Capability set** is the closed, FK-bound list in **F2 §4.3** (`core.capabilities`). Any capability a spec guards on must exist there. Naming is `<domain>.<verb>` — reads use **`.read`** (e.g. `audit.read`, `analytics.read`); the set also includes `audit.export`, `doc.delete`, `retrieval.manage`.

## 6. Designer handoff (→ `design/mockup-review.md`)

Author the **full v1 surface**: **new screens** — Tools & MCP, API-keys/service-accounts (in **Organization**), roles & permission matrix, Local models `[desktop]`, Device fleet, Feature management (4-state), Spaces & knowledge base, Alerts & notifications, Prompt/template library; **make editable** the four read-only admin editors — Connections (connect/rotate/revoke), Routing (chain editor), Models (add/enable/pricing), Governance (masking/retention editors); plus cross-cutting execution-location badges, desktop/offline states, and the locked-toggle visual for governed controls; the **document-center** surfaces (collections/versions/lineage/dedup, extracted-asset browser — md / table-grid / image gallery, ingestion-status, preview pane) and the **design-only** collaborative surfaces (comment threads, suggestion/correction review, a chat-to-edit panel where an agent performs the edits); a per-space **retrieval-mode selector + inspector** (§3a) in Playground/Space-settings. Connections must support **OAuth connect** (Anthropic-style) alongside paste-a-key. Canonical UI set = `app/*.jsx` (`uploads/Strategos-2` is a byte-identical backup — ignore; `components/*` is the W5 marketing app — separate, later); W4 tokens port from `app/zs.css` (named vocab), `_ds/` reference-only.

## 7. Reconciliation checklist (docs to update to this record)

- `README.md` (repo + `docs/`): remove/resolve the four "Open decisions"; fix crate version/split-plane wording.
- `modules/README.md`: fix the inverted D-plane dependency graph; mark X1/X2 resolved; add **C6** (module count 22 → **23**) with edges { C1, C4 } → C6 → O1/O2.
- `modules/`: F1 (role matrix, retire group-ACL, ledger, credential vault + OAuth), F2 (RBAC matrix, RS256, device lifecycle), F3 (phase + KMS KEK + OAuth credential refresh), C1 (crate `v0.4.6`, RS256, gateway-mediated writes, API keys/identity), C2/C3 (crate reality, hard reserve), C4 (governance wrapper + **secret/PII redaction/DLP**, §2 W5), C5 (**research-backed** robust hybrid+graph+vector retrieval, semantic chunking, markdown-first **document center**, redact-at-rest, rerank service, §3a), D2/D3/D4 (crate names, embedded-Ollama, upstream trace fields, config-sync phase), W1 (Organization API keys + permission matrix + editable editors), W2 (document-center Library + design-only collaborative editing), X1 (resolved, in v1; **tool-egress redaction**), X2 (design-only; agent runtime powers v2 collaborative-edit + interaction-intelligence), O1/O2/O3 (audit integrity, quality signals/analytics, device fleet, feature 4-state), **new C6** (quality signals & interaction intelligence, §3b — placement to confirm).
- `specs/F1-data-model.md` + new `plans/F1-rework-plan.md`: §5 schema deltas.
- `plans/`: fix crate `[patch]`/tags in 0/1b/2a; author **F3, C2, C3, C4, C5, D4, W1, W3, W5, O2, O3, X1** module docs→specs and **Phase 3/3.5/4/5** plans; reconcile the one canonical dependency graph. C5 spec is **research-backed** (§3a) and covers the document center + all retrieval modes.
- Gateway-repo **issues** (create → implement → close, released via tag bump): per-step `plane`/execution-location on the trace; OAuth/bearer provider-credential support in `sensei-cloud-providers`; (later, optional) `RerankModel` trait.
- New: `design/mockup-review.md` (§6); `design/rag-and-document-center.md` (§3a — research-backed retrieval + document-center design).

## 8. Rebrand — Strategos → torii + seiki (RATIFIED 2026-07-25)

"Strategos" is retired as the umbrella. The suite splits into two products that parallel the developer-focused **sensei + dojo**:

- **`torii`** = the AI-gateway **engine / product** — the central gateway daemon, the embedded daemon, the desktop app, and the shared UI/core kit. Torii is *the gateway*.
- **`seiki`** = the commercial **web-SaaS layer** on top — the admin portal, the tenant/billing/org web, and the central multi-tenant Supabase. Seiki is the platform that sells and operates torii.

**Authoritative identifier mapping:**

| Area | Strategos (old) | → New |
|---|---|---|
| Central gateway crate | `strategos-gateway` | **`torii-gateway`** |
| Embedded daemon | gateway-embedded | torii (daemon) |
| Desktop app pkg | `@torii/desktop` | **`@torii/desktop`** |
| Shared UI kit | `@torii/ui` | **`@torii/ui`** |
| Shared core | `@torii/core` | **`@torii/core`** |
| Web admin portal pkg | `@seiki/admin` | **`@seiki/admin`** |
| Root monorepo pkg | `torii-seiki` | **`torii-seiki`** |
| Tauri bundle id | `dev.strategos.console` | **`dev.torii.app`** |
| Desktop brand string | "Strategos" | **"Torii"** |
| Web-portal brand string | "Strategos Admin" | **"Seiki"** |
| Central Supabase project | `strategos` | **`torii`** *(umbrella = torii; local rebrand 2026-07-31)* |
| Env prefix | `STRATEGOS_*` | `TORII_*` (engine) *(done 2026-07-31 — legacy fallbacks removed)* |

**Confirmed calls (Jerry, 2026-07-25):** the *central* gateway daemon is **torii** (torii is the whole engine, not merely the local piece); the shared npm scope is **`@torii/*`**; the two apps split by brand (`@seiki/admin`, `@torii/desktop`), with the shared kit under torii and consumed by both.

**Sweep order (safe tiers, commit each):** T1 npm scope + package names + imports → T2 crate rename → T3 Tauri id + brand strings + env. **Done 2026-07-31 (umbrella = torii, no strategos in code/config/docs):** the env-prefix removal (`STRATEGOS_*` fallbacks dropped) and the doc-prose sweep (Strategos→Torii for engine/gateway/desktop docs, →Seiki for admin/web-SaaS docs); the Supabase `project_id` rebrand is executed at a coordinated `dbd reset`. **Kept:** the mockups' `StrategosUI`/`StrategosAPI` functional identifiers (design reference + a byte-identical `uploads/Strategos-2` backup) and this section's rename-mapping (documents the old→new). The separate-Supabase-instances decision stands (see the rebrand memory).

## 9. Auth + deployment architecture (RATIFIED 2026-07-25)

**One hosted Supabase** backs the whole torii+seiki suite (one `auth.users`; a user's
account works across the desktop app *and* the web portal). Tenant isolation is RLS + a
`custom_access_token_hook` stamping `tenant_id`/`role_ids`/`claims_version`. This is
SEPARATE from sensei-dojo's Supabase (§8, cross-*product* isolation) — but WITHIN
torii+seiki it is shared (one product). The **Torii desktop and Seiki web are both clients**
of that one Supabase; a desktop install on any machine connects to the *same hosted URL*
over the internet — `localhost` Supabase is **dev-only**. The **Supabase URL ≠ the web-app
URL**: `seiki.sensei-hq.com` is the portal; Supabase is `https://<ref>.supabase.co` (or a
custom domain). JWT signing is **RS256/JWKS** (W3); the gateway verifies via JWKS, trusts no
capability from the token.

**Hosting — two workloads, two hosts:**
- **Seiki web** (`apps/admin`, SvelteKit adapter-cloudflare) → **Cloudflare Workers**
  (`wrangler deploy`, mirrors dojo) at **`seiki.sensei-hq.com`**.
- **torii-gateway** (`services/gateway`, Rust/Axum + Postgres pool + tokio tasks) →
  **Fly.io** (container) at **`api-torii.sensei-hq.com`**. It **cannot** run on Cloudflare
  Pages/Workers (native binary, persistent DB pool, background tasks). Hyphenated
  `api-torii` is a **first-level** subdomain (covered by free Universal SSL, unlike a nested
  `api.torii.…`) and leaves `torii.sensei-hq.com` free for a product page; point DNS-only →
  Fly issues the cert + avoids proxy buffering on the SSE `/v1/chat/stream`. The gateway
  binds `HOST:PORT` (`HOST=0.0.0.0` in the container).
- **Torii desktop** (Tauri) → per-OS installer; prod env baked in points at the hosted
  Supabase + `api-torii.sensei-hq.com`; `torii://` deep link for OAuth/magic-link redirects.

Docs: `docs/ops/supabase-configuration.md`, `docs/ops/deployment.md`. Config:
`apps/admin/wrangler.jsonc`, `services/gateway/{Dockerfile,fly.toml}`. **Prod build:** the
`sensei-gateway` git dep is pinned to `tag = "v0.4.6"`; the Dockerfile strips the dev
`[patch]` (local sibling repo) so it builds from the tag.

## 10. Amendments — 2026-07-29 (screen-audit reconciliation)

Ruled by Jerry after the build-vs-mock screen audit (`specs/{seiki,torii}-screens/README.md`). The
audit confirmed **most "open questions" were already settled** here + in `plans/roadmap.md` — the
STUB/PARTIAL/MISSING screen states are **unbuilt later phases (P7–P13), not undecided scope**. Five
genuinely-open / deviation items resolved:

1. **Billing / monetization = v1.x fast-follow (NOT v1).** The budget-hierarchy tree (hard
   reserve→commit + increase-requests) is v1 and built. The **commercial** layer — invoices,
   seats-as-licenses, pricing tiers, payment provider (Stripe et al.) — is **deferred to launch /
   v1.x**, gated on the W5/P14 pricing decision. The Budgets & billing screen shows the budget tree
   only + an honest "plans & invoices at launch" note. No billing schema / payment integration in v1.
2. **Auth = magic-link primary + email/password secondary. AMENDED 2026-07-31.** The original
   ratification treated email+password as a *rejected* "P1a shortcut"; that is **overturned** — the
   review (`docs/code-review.md` H2) flagged the shipped desktop email+password as a shipped-vs-agreed
   discrepancy, and the resolution is to **amend the decision, not rip out the code**. The v1 auth
   model for **both Seiki (admin) and Torii (desktop)**:
   - **Magic link (passwordless email) is PRIMARY** — the default sign-in *and* the **registration /
     new-account shape**. This is the front-and-centre path.
   - **Email + password is a SUPPORTED secondary** — a user may **set / reset a password** (Supabase
     reset-password email) and **sign in with email + password**. It is a first-class, blessed option,
     not a shortcut. Rationale: password login is a legitimate convenience for returning users and
     reset is a table-stakes recovery path; passwordless-only over-constrained the product.
   - **GitHub / Google OAuth** via the `torii://` deep link (§9) stays **optional**.
   **Remaining reconcile delta:** Seiki already implements this (magic-link primary + reveal-password +
   reset). **Torii desktop is password-ONLY today (no magic-link)** — add magic-link as primary + the
   register shape + a reset-password path (Torii WS-5 auth-polish). Not a v1-ship blocker on its own.
3. **API keys / service accounts = the Organization screen** (confirms §1.2; overrides the mockup's
   separate `view-apikeys.jsx`). The build placed "API identities" inside Connections — **move it to
   Organization** (identity + roles + keys in one home); Connections stays pure outbound provider
   credentials.
4. **Tools & MCP "Enforced server-side" label = honesty fix now.** Tool-calling + enforcement is
   X1/**P11 (unbuilt)**; `chat.rs` invokes no tools → **no live bypass** (the audit's "security gap"
   framing is downgraded). The allow-list resolver is pre-built + tested (default-deny,
   `tests/tools.sql`). Action: reword the admin label to *"allow-list saved · enforced at tool-call
   time (ships with the Tools runtime)"*; keep the config screen; **P11 must wire the existing
   resolver into the tool-call path** (roadmap note).
5. **Next build focus = C5 RAG + document center (P7).** Confirmed next major phase per the roadmap —
   the flagship data-intelligence surface and the shared unblock for Torii Library/Ask/Playground
   retrieval (P9) and Seiki Spaces & KB (P8). Precede it with the small reconcile batch (items 3+4 +
   the billing note + a Torii-auth ticket).

*(Doc note: `BUILD-PROGRESS.md` is stale — it lists the W1 admin portal as "next" though it is
substantially built with real endpoints; reconcile when convenient.)*
