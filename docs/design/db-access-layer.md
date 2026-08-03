---
title: Torii/Seiki DB Redesign — Pass 2: Access Layer (blast-radius map · read-views · Rokkit forms · build order)
status: design (pre-build) — companion to db-redesign.md; nothing applied yet
created: 2026-08-03
method: ultracode workflow (API↔table + UI↔data + view/form tracers → synthesis), verified vs services/gateway/src + apps/*/src
depends_on: docs/design/db-redesign.md
---

# Torii/Seiki — Pass 2: Access-Layer Document

> Grounded on `docs/design/db-redesign.md` §0–§9 (finalized 8-schema target) + the three Pass-1 traces (API↔table map, UI-page↔data map, view/form catalog). Verified against `services/gateway/src/main.rs` (70 routes) + `services/gateway/src/routes/*.rs`, `apps/admin/src/routes/(app)/*` + `apps/admin/src/lib/*`, `apps/desktop/src/routes/(app)/*` + `apps/desktop/src/lib/*`.
>
> **Purpose.** Make every schema restructure's impact legible *before* it is applied: §A is the per-table blast-radius index (the maintained artifact that operationalizes the "verify blast radius, not the tool" rule); §B is the joined read-view catalog that **shields** those restructures behind stable view contracts; §C is the Rokkit schema-form binding for the write side; §D is the least-disruptive build order that falls out of the blast radius (views-first, so APIs/UI keep working through the move).

---

## §A. Blast-radius traceability — per target table → endpoints → pages

Reading key: **E(r)** = endpoint reads, **E(w)** = endpoint writes, **UI** = pages (S=Seiki admin, T=Torii desktop). "Churn" = what the restructure changes vs today's `public.*`. Tables ordered by schema, hottest-blast-radius first within schema.

### core (identity / tenancy / org / rbac / access)

| Target table | E(r) | E(w) | UI pages | Churn / remap (blast note) |
|---|---|---|---|---|
| **core.org_units** *(NEW)* | every `/v1/analytics/*` (8, via resolve_scope subtree), `/v1/budgets`, `/v1/devices` (indirect) | `/rpc/orgs/create` (seed tree+levels), `/rpc/budgets/upsert-node` (FK target) | S: organization, billing, overview; T: activity (cascade) | **Highest structural churn.** Org structure split OUT of `budget_nodes`. `resolve_scope`/`subtree_ids` (analytics.rs:55-103/182/404) walked `budget_nodes` by `kind='user'`/`ref_id`/`parent_id` — must be rewritten against `org_units.parent_id`. Every analytics scope + budget tree depends on it. |
| **core.unit_levels** *(NEW)* | `/v1/budgets` (kind label derive) | `/rpc/orgs/create` (seed default labels) | S: organization (tree labels), billing; T: activity | Per-tenant relabel of the tree; `node_kind`/`space_tier` enums dropped → both derive from `unit_levels.label`. `BudgetNode.kind` in the view comes from here. |
| **core.unit_members** *(NEW)* | — | `/rpc/orgs/create` (seed personal unit) | S: organization | People→units mapping; replaces `budget_nodes.ref_id` for user attribution. |
| **core.memberships** *(rename ← profile_tenants)* | `/rpc/rbac/assign-role`, `/rpc/rbac/unassign-role`, `/rpc/orgs/create` (single-tenant guard), `/rpc/orgs/transfer-ownership`, `/v1/org` | `/rpc/orgs/create` (insert) | S: organization | Pure rename `profile_tenants→memberships` (rpc.rs:565/683/1347/1390/1484). Existence guards + inserts; pk stays `(profile_id)` (one-profile-one-tenant, §8-Q2). |
| **core.permissions** *(rename ← core.capabilities)* | `/v1/org` (roles agg), `/rpc/rbac/create-role` | `/rpc/rbac/create-role` (role_permissions FK) | S: organization, governance (scope picker) | **Collision-fix rename.** `role_permissions.capability` text col → FK→`permissions.key`. ledger.rs:339 reads `core.capabilities`. Lookup catalog (global, tenant_id NULL). |
| **core.role_permissions** | `/v1/org` | `/rpc/rbac/create-role` | S: organization | `capability` col → FK→core.permissions.key. NO history twin (high churn, audit-captured). |
| **core.roles** | `/v1/org`, `/v1/tools` (grant scope), `/v1/governance` (scope), `/rpc/rbac/*`, `/rpc/mcp/set-tool-grant`, `/rpc/orgs/*` | `/rpc/rbac/create-role` | S: organization, governance, tools | Read via `effective_roles` view (shared NULL-tenant defaults ∪ custom). Cross-screen shared read. |
| **core.profile_roles** | `/v1/org`, `/rpc/rbac/*`, `/rpc/orgs/*` | `/rpc/rbac/assign-role`, `/rpc/rbac/unassign-role`, `/rpc/orgs/create`, `/rpc/orgs/transfer-ownership` (all bump `profiles.claims_version`) | S: organization | Grant writes; every write bumps claims_version (token staleness gate). |
| **core.profiles** | `/v1/org`, `/v1/devices` (owner), `/v1/budgets`→requests (requested_by), `/v1/audit` (actor) | `/rpc/rbac/*`, `/rpc/orgs/*` (claims_version++) | S: organization, devices, billing, requests, audit | Canonical actor uuid everywhere; display-name join on many views. |
| **core.api_keys** | `/v1/apikeys` | `/rpc/apikeys/issue`, `/rpc/apikeys/revoke` | S: organization (API keys) | `public→core`; `status→api_key_status` enum; XOR(profile_id⊕service_account_id); column-REVOKE SELECT(hashed_secret) — already excluded from read. |
| **core.service_accounts** | `/rpc/apikeys/issue` | — | S: organization | `public→core`; `budget_node_id`→FK→governance.nodes. |
| **core.tenants** | `/v1/whoami`, `/v1/org` | `/rpc/orgs/create` | S: all (tenant anchor); T: header | Anchor of RLS; onboarding cols added (legal_name/region/residency). |

### vault (secrets — deny-all)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **vault.router_credentials** *(MOVED ← public.router_credentials)* | `/v1/connections` (booleans only) | `/rpc/connections/{connect,rotate,revoke,oauth-connect,oauth-revoke}` (via sensei-vault crate) | S: connections | **Deny-all move.** Crate-side SQL (rpc.rs:1934-2140) must schema-qualify `vault`. Read never returns ciphertext — only `connected/*_at`/`oauth_connected` projection. `credential_type/refresh_status/custody` enums; also `mcp_servers.auth_credential_id` FK→ here. |
| **vault.tenant_keys / tenant_key_archive** | — (service_role decrypt in hot path) | connections write path | — | Per-tenant DEK; never a client surface. |

### catalog (model/router/routing reference + overrides)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **catalog.model_overrides** *(absorbs ← tenant_model_state)* | `/v1/models`, `/v1/models/available`, `/v1/chat` (enablement gate) | `/rpc/models/set-enabled` | S: models, overview; T: home, ask, compare, models | **String→uuid fold.** Every `tms.model_full_name = m.full_name` join → `model_id = m.id` (ledger.rs:377/411, rpc.rs:1144-1189, chat.rs:264). Adds scope_type/scope_id + price override. |
| **catalog.models** | `/v1/models`, `/v1/models/available`, `/v1/routing`, `/v1/requests` (name resolve), `/v1/chat` (config_loader) | — | S: models, routing, requests, overview; T: home, ask, compare, models | `config→catalog`; tier/tag/local_capable move onto row; price moves OFF onto model_endpoints. Cross-app shared read. |
| **catalog.model_endpoints** | `/v1/models`, `/v1/models/available`, plane-split baseline (cheapest-cloud) | — | S: models, overview; T: home | **Pricing source of truth** (SCD-2 twin `past_model_endpoints`). `reachable` EXISTS check; cloud-equiv baseline priced against price-in-effect. |
| **catalog.capability_types** *(rename ← config.capabilities)* | `/v1/models/available`, config_loader | — | S: models; T: home | Rename hidden behind `models_available` view (ledger.rs:418, config_loader.rs:288). |
| **catalog.chains** *(rename ← fallback_chains)* | `/v1/routing`, `/v1/config/snapshot`, config_loader | — | S: routing, requests; T: activity | `fallback_chains→chains`; FK to chains becomes composite. |
| **catalog.chain_models** *(rename ← fallback_chain_models)* | `/v1/routing`, `/v1/config/snapshot`, config_loader | `/rpc/routing/set-step-active` | S: routing | `plane` text→`execution_location` enum; composite step FKs (ledger.rs:594, rpc.rs:1190-1241, config_loader.rs:338-382). |
| **catalog.routers** | `/v1/connections`, `/v1/routing`, `/v1/models`, `/v1/requests` (adapter name) | — | S: connections, routing, models, requests | `config.routers`; joins vault.router_credentials for connection status. |
| **catalog.providers** | `/v1/models`, `/v1/models/available`, `/v1/connections` | — | S: models, connections, overview; T: home | `is_open_source` drives local-capable UI. |
| **catalog.model_capabilities / catalog.licenses** | `/v1/models/available` | — | S: models | Lookup + capability join; `licenses` lookup FK on models. |

### governance (policy/control + budget + billing)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **governance.nodes** *(rename ← budget_nodes + org split)* | `/v1/budgets`, ALL `/v1/analytics/*` (cap+scope), `/rpc/budgets/*`, `/rpc/orgs/create`, `/rpc/apikeys/issue` (sa budget) | `/rpc/budgets/{upsert,delete}-node`, `/rpc/budgets/approve-request`, `/rpc/orgs/create`, `/v1/chat` (reserve→commit) | S: billing, organization, overview; T: activity | **Widest single-table churn (finding #1).** `kind`/`parent_id`/`ref_id` DROPPED → `org_unit_id` FK; tree structure moves to core.org_units.parent_id. `resolve_scope` rewrite. Files: ledger.rs:187, analytics.rs:55-103/182/404, rpc.rs:120-560/1332-1441, store.rs:98. |
| **governance.holds** *(rename ← budget_holds)* | `/v1/chat` (reserve check) | `/v1/chat` (reserve→commit) | — (hot path only) | `path_node_ids uuid[]` justified denorm for hot-path cascade; idempotency_key. |
| **governance.requests** *(rename ← budget_requests)* | `/v1/budgets` | `/rpc/budgets/{request,approve,deny}-request` | S: billing; T: activity (member request) | `requested_cap numeric(12,2)→(14,6)`; `status→request_status` enum. Owner-INSERT own PENDING (member self-serve). |
| **governance.feature_policies** | `/v1/governance`, `/v1/judge`, `/v1/config/snapshot`, `/rpc/governance/matrix` | `/rpc/governance/{set,clear}-feature` | S: governance | **Finding #4.** free-text `feature_key`→`feature_id` FK→governance.features; scope polymorphic→per-target FK+CHECK; `state→feature_state` enum. Files: ledger.rs:623, rpc.rs:957-1143, judge.rs:23, config.rs:180. `source LIKE 'c5.%'` retired. |
| **governance.features** *(lookup, re-homed ← config.features)* | `/v1/governance` | — | S: governance | dojo `config.features` retired but feature-*governance* lookup re-seeded here (§8-Q1); `f.slug→features.key`. |
| **governance.settings** *(absorbs ← tenant_settings + public.settings)* | `/v1/settings`, `/v1/config/snapshot`, `/v1/spaces/{id}/retrieval-config`, `/v1/chat` (masking) | `/rpc/settings/set`, `/rpc/retrieval/set-config` | S: settings; T: retrieval (read) | **Finding #6 — SHAPE change, not a move.** boolean `setting_key/enabled` → `scope/key/value jsonb`. Rewrite reads at ledger.rs:657, rpc.rs:1607-1653/2203-2260, retrieve.rs:59, chat.rs:293/309. Per-space retrieval config should FURTHER move to content.space_rag_profiles. |
| **governance.config_versions** *(rename ← config.config_versions)* | `/v1/config/snapshot`, `/v1/devices` | `/v1/config/snapshot` (D4 spine) | S: devices | Schema move (config.rs:106, ledger.rs:536). |
| **governance.user_preferences** *(NEW)* | — (no endpoint yet) | — (localStorage today) | T: settings | **BLOCKED/unbuilt** — desktop settings is localStorage-only; target `(tenant_id,profile_id,key)`. |
| **governance.classifications / redaction_rules / retention_policies / masking_policies / safe_terms** *(NEW editors)* | — (partially read via governance cards) | — (unbuilt writes) | S: governance (policy cards) | **PARTIALLY BLOCKED** — cards static; only feature-state toggles wired to real writes. |
| **governance.plans / subscriptions / seats / invoices / payment_methods** *(NEW billing)* | — (no `/v1/billing` route) | — | S: billing | **BLOCKED/design-now** — billing page meters budget only; no commercial surface built. |

### metering (record plane — ledger + rollups)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **metering.inference_calls** | `/v1/requests`, `/v1/requests/{id}/trace`, analytics spend/plane-split/export | `/v1/chat`, `/v1/chat/stream`, `/v1/spaces/{id}/ask` (store.rs:106-160) | S: requests, overview; T: activity, ask, compare, playground | **Second-widest churn (finding #2).** free-text `adapter/model/chain_id`→model_id/router_id/endpoint_id FK; `*_node_id` snapshot cols → single `org_unit_id` FK; `cost_usd`→`cost_estimated`+`cost_actual`. `SpendGroup.column()` (org/team/user_node_id) has NO target col → org-tree GROUP BY. Files: store.rs:106-160, ledger.rs:123, analytics.rs:143-156/320-417/519. Cross-app hottest shared table. |
| **metering.execution_traces** | `/v1/requests/{id}/trace` | `/v1/chat` | S: requests; T: activity, compare | Schema move; may be superseded by routing_attempts read. |
| **metering.routing_attempts** *(NEW)* | `/v1/requests/{id}/trace` (normalized) | `/v1/chat` | S: requests; T: activity, compare | Normalizes trace jsonb → per-attempt rows for Compare/Requests fallback UI. |
| **metering.quality_signals** | `/v1/analytics/quality` | `/v1/judge`, `/v1/chat` (c6), `/v1/spaces/{id}/ask` | S: overview (quality); T: compare, playground | **Finding #15.** polymorphic subject_id→per-target FK (call/message/conversation) + exactly-one CHECK; user (explicit) signals split OUT to `metering.feedback` (owner-INSERT). Writers chat.rs:583, judge.rs:237, quality.rs:44. |
| **metering.feedback** *(NEW)* | `/v1/analytics/quality` (union) | (interaction loop, owner-INSERT) | S: overview (quality); T: ask/compare thumbs | Owner-INSERT `profile_id=auth.uid()` so the interaction-intelligence loop can write. |
| **metering.usage_daily** *(rename ← analytics_usage_daily)* | overview, cost-trend, model-mix, spend, quality, export | (rollup_apply) | S: overview; T: activity | `budget_node_id` grain col follows org_unit_id remap (finding #13). |
| **metering.quality_daily** *(rename ← analytics_quality_daily)* | `/v1/analytics/quality` | (rollup) | S: overview | budget_node_id→org_unit_id; counts from split quality_signals+feedback. |
| **metering.model_mix_daily / overview_current (MVs)** | overview, model-mix | (refresh) | S: overview | **MV invariant: never GRANT to authenticated** — service_role + in-query tenant filter only. |

### content (docs / spaces / chat / templates)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **content.documents** | `/v1/documents` (list/get), `/v1/documents/{id}/assets`, `/v1/spaces/{id}/retrieve`, `/rpc/documents/declassify` | `/v1/documents` (create), `/v1/documents/{id}/{ingest,reingest}`, DELETE, `/rpc/documents/declassify` | T: library, retrieval, ask | `public→content`; `status`(string)→`lifecycle` enum + free-form `stage`; legacy file cols (storage_path/size/type/hash) DROPPED→versions; `classification→core.classification_level`. rag/store.rs+ingest.rs write status/status_reason. |
| **content.document_versions** | `/v1/documents/{id}`, `/v1/documents/{id}/assets` | ingest/reingest, create | T: library | File metadata lives here now; view rejoins latest version. |
| **content.document_embeddings** | `/v1/spaces/{id}/retrieve` (hybrid_search), `/v1/spaces/{id}/ask` | ingest/reingest | T: retrieval, ask | `public→content`; holds redacted text only (DLP); version_id/parent_chunk_id FK enforced; supersede path. |
| **content.document_assets** | `/v1/documents/{id}/assets` | ingest | T: library | `kind→asset_kind` enum; version_id FK enforced. |
| **content.spaces** | `/v1/spaces`, `/v1/spaces/{id}/ask`, `/v1/spaces/{id}/retrieve`, `/rpc/spaces/create` | `/rpc/spaces/create` | T: ask, library, retrieval; S: governance/tools (scope options) | `classification→enum`; tier derived from org_unit level (space_tier dropped); owner_id FK→core.profiles; `org_unit_id` FK. **No dedicated CRUD screen** — consumed as picker. |
| **content.space_members** | `/v1/spaces`, doc ACL | `/rpc/spaces/create` | T: ask, library | `role→space_role` enum; classification/membership-aware RLS. |
| **content.conversations / messages / message_citations** | `/v1/spaces/{id}/ask` | `/v1/spaces/{id}/ask`, `/v1/chat` (compare/playground) | T: ask, compare, playground | `public→content`; **messages DROP cost/model copies** (read through metering.inference_calls via view, §7-#7); message_citations document_id/chunk_id FK enforced. |
| **content.collections** | `/v1/documents` (list) | — | T: library | self-FK parent_id; management UI partial. |
| **content.space_rag_profiles** *(NEW)* | `/v1/spaces/{id}/retrieval-config`, `/v1/spaces/{id}/retrieve` (config) | `/rpc/retrieval/set-config` (should target here, not generic settings) | T: retrieval (read-only) | **"Single largest missing admin surface."** Resolve should read this, not generic KV settings. EDITOR unbuilt. |
| **content.templates / template_versions** *(NEW)* | — | — | T: playground ("save as template"), ask draft | **BLOCKED/unbuilt** — presets client-local; powers Ask Draft/Playground/Workflows. |

### audit (event record + history)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **audit.audit_events** | `/v1/audit`, SIEM streamer | `/rpc/mcp/{register-server,refresh-tools}`, all `/rpc/connections/*`, shared `audit()` helper | S: (audit feed) | `public→audit` schema move (mechanical, schema-qualify). INSERT actor=auth.uid() bound; UPDATE/DELETE never granted. |
| **audit.notification_channels / siem_cursors** | SIEM streamer (siem.rs:40/66/147) | SIEM streamer | — (background task) | `public→audit`; `siem_cursors.channel_id` FK→notification_channels enforced. |
| **audit.alert_rules / alert_events / rule_channels** *(NEW)* | — | — | S: overview (alerts-state) | **Unbuilt** — alerts derived client-side today; `channel_ids uuid[]`→rule_channels junction. |
| **audit.past_\*** *(SCD-2 twins)* | — (deny-all) | historize triggers | — | Deny-all/service_role; carries tenant_id + FORCE RLS. |

### device (fleet + tools)

| Target table | E(r) | E(w) | UI pages | Churn / remap |
|---|---|---|---|---|
| **device.mcp_servers** | `/v1/tools`, `/rpc/mcp/{set-enabled,set-tool-grant,refresh-tools}` | `/rpc/mcp/register-server` | S: tools | `public→device`; single table + scope marker (tenant_id NULL=platform); `scope/transport`→enums; auth_credential_id FK→vault. |
| **device.mcp_server_tools** | `/v1/tools`, `/rpc/mcp/set-tool-grant` | `/rpc/mcp/refresh-tools` | S: tools | denormalized tenant_id for isolation; `UNIQUE(mcp_server_id,tool_name)`. |
| **device.tenant_mcp_servers** | `/v1/tools` | `/rpc/mcp/set-enabled` | S: tools | per-tenant enable + config_override. |
| **device.tool_allow_lists** | `/v1/tools` | `/rpc/mcp/set-tool-grant` | S: tools | single-col pk→composite `(tenant_id,id)`; space_id FK→content.spaces. **Stored-but-enforcement only recently closed (P11).** |
| **device.devices** | `/v1/devices` | `/rpc/devices/revoke` | S: devices | `public→device`; single SELECT policy = own OR device.manage (no permissive OR). |
| **device.local_models** *(NEW)* | — (Tauri invoke only) | — (embedded engine) | T: models | **BLOCKED/unbuilt central table** — download registry + HW-fit is desktop-runtime state, no `/v1` GET. |

### Cross-app highest-blast-radius tables (a restructure hits BOTH apps)

- **metering.inference_calls** — S: requests+overview / T: activity+compare+playground+ask
- **governance.nodes + core.org_units** — S: billing+organization / T: activity cascade
- **catalog.models/model_overrides/model_endpoints** — S: models+overview / T: home+ask+compare+models
- **content.spaces** — T: ask+library+retrieval (+ S scope pickers)
- **governance.requests** — S: billing (approve) / T: activity (request)

These five carry the most surfaces → they get first-class **view contracts** (§B) so the restructure never reaches the UI.

---

## §B. Joined read-view catalog — view → tables → screen → blast-radius shield

Naming = connector style: `<entity>_for_tenant`, `<entity>_in_<container>`. Each view GETs a shape 1:1 with the Component→State getter contract, so the underlying table restructure preserves the view → **shrinks blast radius to the view SQL only**.

| View (connector name) | Tables joined | Screen(s) fed | Shape (state getter) | Blast-radius shield rationale |
|---|---|---|---|---|
| **requests_ledger_for_tenant** | metering.inference_calls × catalog.models × catalog.routers × catalog.chains | S: requests, overview; T: activity | `RequestRow{id,chain_id,adapter,model,execution_location,input/output_tokens,cost_usd(←cost_actual),duration_ms,status,fallback_sequence,recorded_at}` | **★ Top shield.** Absorbs free-text adapter/model → catalog FK resolve. **3 screens across 2 apps** keep RequestRow byte-identical while inference_calls FK-normalizes. Backs `/v1/requests`. |
| **request_trace_detail** | metering.routing_attempts × execution_traces × catalog.routers × catalog.models | S: requests (drill-down); T: compare (fallback trace) | `RoutingTrace{request_id,capability,status,duration_ms,attempts[{sequence,adapter,model,api_model_id,status,duration_ms,error,fallback_triggered}]}` | Normalizes raw execution_traces jsonb into routing_attempts rows. **Polymorphic caution:** COALESCE the correct subject FK, don't assume one, or rows silently drop. Backs `/v1/requests/{id}/trace`. |
| **budget_tree_for_tenant** | governance.nodes × core.org_units × core.unit_levels | S: budgets, organization; T: activity (cascade) | `BudgetNode{id,parent_id(←org_units.parent_id),kind(←unit_levels.label),name,cap_amount,spent_amount,reserved_amount,enforcement,period,alert_threshold,free_floor_enabled}` | **★ Top shield.** Keeps flat `{parent_id,kind}` contract while structure splits into org_units + relabels via unit_levels and `node_kind` enum is DROPPED → `org-tree-state.svelte.ts` + Activity cascade/leaf logic stay byte-identical. Backs `/v1/budgets` (nodes). |
| **budget_requests_for_tenant** | governance.requests × core.profiles | S: billing; T: activity | `BudgetRequest{id,node_id,requested_by(display),requested_cap,reason,status,created_at}` | requested_cap widened to numeric(14,6) hidden behind view. Backs `/v1/budgets` (requests). |
| **connections_for_tenant** | catalog.routers × vault.router_credentials | S: connections | `Provider{name,api_base_url,is_active,requires_key,connected,connected_at,oauth_connected,oauth_connected_at}` | **★ Top shield.** Projects only booleans+timestamps (EXISTS/refresh_status) as router_credentials moves into **deny-all vault** — ciphertext becomes structurally unreadable while Connections keeps its Provider shape. Backs `/v1/connections`. |
| **models_with_pricing_for_tenant** | catalog.models × providers × model_endpoints × model_overrides | S: models, overview; T: home, ask, compare, models | `ModelRow{provider,display_name,full_name,context_window,max_output_tokens,enabled,reachable(EXISTS endpoint),tier/tag/local_capable,price(input/output)}` | **★ Top shield.** Folds `tenant_model_state`(string) → `model_overrides`(uuid) AND moves price off models onto model_endpoints; ModelRow contract preserved. Backs `/v1/models` + `/v1/models/available`. |
| **routing_chain_for_tenant** | catalog.chain_models × chains × models × routers × capability_types | S: routing | `RoutingStep{id,chain_name,capability,sequence_order,plane(←execution_location),router,model,rule,role,is_active}` | Hides fallback_chains→chains rename + text plane→execution_location enum + capability_types rename. Backs `/v1/routing`. |
| **feature_governance_for_tenant** | governance.features × feature_policies | S: governance | `Feature{key,module,label,description,sequence,state(effective via lateral policy)}` | Retires config.feature_states + free-text feature_key→feature_id FK; Feature shape stays. Backs `/v1/governance`. (`/rpc/governance/matrix` reads raw per-scope rows for the editor.) |
| **org_members_for_tenant** | core.profile_roles × profiles × roles × auth.users | S: organization | `Member{profile_id,display_name,email(←auth.users),roles[]}` | Formalizes the already join-heavy `ledger.get_org`. |
| **roles_with_caps_for_tenant** | core.effective_roles × effective_role_permissions | S: organization | `Role{id,key,name,is_system,cap_count,capabilities[]}` | **Strong precedent** — `effective_*` are already this exact shared-defaults∪custom pattern and get_org already resolves through them; view just formalizes + hides capabilities→permissions rename. |
| **permissions_catalog** | core.permissions | S: organization (cap picker), create-role form | `Capability{key,domain,description}` | Global/shared lookup (renamed from core.capabilities). |
| **apikeys_for_tenant** | core.api_keys × profiles × service_accounts | S: organization | `ApiKey{id,prefix,profile_id,service_account_id,scope,status,created_at}` | Exposes prefix only; column-REVOKE SELECT(hashed_secret) means secret never enters view. Backs `/v1/apikeys`. |
| **tools_for_tenant** | device.mcp_servers × mcp_server_tools × tool_allow_lists × core.effective_roles | S: tools | `ToolsData{servers[],tools[],roles[],grants[ToolGrant]}` pivoted to role×tool matrix | Single mcp_servers + scope marker (tenant_id NULL=platform). Backs `/v1/tools`. |
| **devices_for_tenant** | device.devices × core.profiles × governance.config_versions | S: devices | `Device{id,name,platform,app_version,status,owner,exec_location,config_version,enrolled_at,last_seen_at,key_fingerprint}` | Single SELECT policy = own OR device.manage. Backs `/v1/devices`. |
| **audit_events_for_tenant** | audit.audit_events × core.profiles | S: audit | `AuditEvent{id,actor(display),action,target_type,target_id,ip,created_at}` | Append-only tenant-read; no U/D. Backs `/v1/audit`. |
| **files_in_space** | content.documents × document_versions × spaces (+ collections) | T: library, retrieval | `DocumentRow{document_id,title,original_filename,content_type(←latest version),classification,status(←lifecycle),status_reason,chunk_count,space_id,collection_id,created_at,completed_at}` | **★ Shield.** Rejoins latest document_versions after file cols dropped off documents → DocumentRow contract holds. Backs `rag.documents()`. |
| **document_detail** | content.documents × document_versions × document_embeddings × space_rag_profiles | T: library (detail pane) | `DocumentDetail{...DocumentRow, scope, embedding_model, versions[DocumentVersion]}` | chunk_count from embeddings count. Backs `rag.document(id)`. |
| **document_assets_for_doc** | content.document_assets × document_versions | T: library (assets strip) | `DocumentAsset{id,kind,label,sequence,page_ref,caption,download_url}` | version_id FK enforced. Backs `rag.assets(id)`. |
| **spaces_for_tenant** | content.spaces × core.org_units × documents | T: ask (picker), retrieval | `Space{id,name,org_unit_label(tier←unit level),classification,item_count}` | Makes spaces first-class (desktop currently derives `spacesFromDocs`). Backs `/v1/spaces`. |
| **overview_dashboard_for_tenant** | metering.overview_current (MV) × usage_daily × governance.nodes | S: overview; T: activity (spend chip) | `AnalyticsOverview{spend_today{value,cap,pct_of_cap},calls_today,fallbacks_today,latency{avg,p95},blended_cost_per_call,savings}` | **MV constraint** — service_role-mediated + in-query tenant filter (NOT authenticated). Folds today's 4-5-endpoint client fan-in. Backs `/v1/analytics/overview`. |
| **plane_split_for_tenant** | metering.usage_daily × catalog.model_endpoints × past_model_endpoints | S: overview; T: activity | `PlaneSplit{local{calls,cost,cloud_equiv},cloud{...},savings_usd,savings_pct,baseline,series[]}` | cloud-equiv priced against price-in-effect (SCD-2) so restated baseline stays stable. Backs `/v1/analytics/plane-split`. |
| **model_mix_for_tenant** | metering.model_mix_daily (MV) × catalog.models × providers | S: overview | `ModelMixRow{model,provider,execution_location,calls,share_pct,cost_usd,savings_usd}` | MV → service_role + tenant filter; capability_types rename hidden. |
| **cost_trend_for_tenant** | metering.usage_daily | S: overview | `CostTrend{series[{day,blended_cost_per_call,cost_usd,calls,savings_usd}],delta_pct}` | Pure rollup read. |
| **billing_overview_for_tenant** *(design-now)* | governance.subscriptions × plans × seats × invoices | S: billing | `{plan,subscription,seats[],invoices[]}` | **No current `/v1/billing`** — view backs a new route; budget numbers stay in governance.nodes. |

**Screens with NO clean view mapping (documented gaps):**
- **T: models (local)** — device HW-fit + Ollama registry via `invoke('list/pull/remove_model')` + Realtime; `local_models_for_device` is device-local, not a `/v1` GET.
- **T: playground/ask/compare** — write/interaction flows (POST /chat, /judge) that WRITE metering.inference_calls; no read-view.
- **T: workflows** — maps to v2 agents/workflows schema with no v1 backing table; stub.
- **S: settings** — thin `{setting_key,enabled}` projection over governance.settings; its "form" is a per-key Toggle, not a structured entry form.
- **S: tools grant matrix** — role×server×tool toggle grid, not a classic entry form.

---

## §C. Rokkit schema-form bindings — form → target table → enum/lookup fields

Enum → static `Select` options; metadata-carrying lookup → async `Select`/`MultiSelect`. Secret-bearing forms write via the `/rpc` service_role boundary and bind credential fields as **id-refs only** (never a value round-tripped through the client).

| Rokkit form | Writes → target table | Enum-driven fields (static Select) | Lookup/async fields (async Select/MultiSelect) | Backing write / status |
|---|---|---|---|---|
| **budget-node create/edit** | governance.nodes | `period`(governance.budget_period), `enforcement`(governance.enforcement) | `org_unit_id`←core.org_units, level via core.unit_levels | `/rpc/budgets/upsert-node` — retarget. **NO `kind` field** (derived from unit level; node_kind dropped). +alert_threshold(number), free_floor(Toggle). |
| **routing-chain step create/edit** | catalog.chains + chain_models (+ chain_bindings) | `plane`(core.execution_location) | `capability_id`←catalog.capability_types, `model_id`←catalog.models, `router_id`←catalog.routers, binding `space_id`←content.spaces + `role_id`←core.roles | `/rpc/routing/set-step-active` (+ future upsert). +sequence_order(number), rule(text), is_active(Toggle). |
| **feature-policy create/edit** | governance.feature_policies | `scope_type`(governance.feature_scope), `state`(governance.feature_state {allow,deny,mandatory,default}) | `feature_id`←governance.features, `scope_id`←(spaces|roles|units, source switches on scope_type) | `/rpc/governance/set-feature` + clear-feature. +value(jsonb conditional). |
| **models set-enabled** | catalog.model_overrides | `scope_type`(catalog.override_scope) | `model_id`←catalog.models | `/rpc/models/set-enabled` — string key→uuid FK. |
| **space create/edit** | content.spaces | `classification`(core.classification_level, via governance.classifications lookup labels) | `org_unit_id`←core.org_units, `owner_id`←core.profiles | `/rpc/spaces/create`. **NO `tier` field** (derived from unit level; space_tier dropped). space_members role uses content.space_role. |
| **mcp-server register/edit** | device.mcp_servers (+ tenant_mcp_servers) | `scope`(device.mcp_scope {platform,tenant}), `transport`(device.mcp_transport) | `auth_credential_id`←vault.router_credentials (**id-ref only, never secret**) | `/rpc/mcp/register-server` + set-enabled. +url/command(text), enabled(Toggle). |
| **api-key issue** | core.api_keys | — | `identity`←core.profiles OR core.service_accounts (**XOR**, api_keys polymorphic-XOR pattern) | `/rpc/apikeys/issue`. hashed_secret written server-side, plaintext shown once, column REVOKE SELECT → never re-read. No per-key budget (identity-bound). |
| **rbac create-role / assign-role** | core.roles + role_permissions / core.profile_roles | `is_system`(bool) | capabilities←core.permissions (MultiSelect), member←org_members, role←roles | `/rpc/rbac/create-role`, `/rpc/rbac/assign-role`. capability col→FK core.permissions.key. |
| **connections connect/oauth** | vault.router_credentials | `credential_type`(vault.credential_type), `custody`(vault.credential_custody {gateway only v1}) | `router_id`←catalog.routers | `/rpc/connections/{connect,oauth-connect}`. Secret via service_role vault boundary; read-view projects booleans only. |
| **documents create** | content.documents (+ versions) | `classification`(core.classification_level), `scope`(content.document_scope) | `space_id`←content.spaces, `collection_id`←content.collections | `/v1/documents` (create) + signed upload + ingest. |
| **org-unit create/edit** *(design-now)* | core.org_units | `is_personal`(Toggle) — **NO org_unit_kind enum** | `parent_id`←core.org_units (self-ref), `level`←core.unit_levels (per-tenant label config) | **No current endpoint** — new. The ONE tree that scopes content + anchors budget. |
| **rag-profile edit** *(design-now, largest form)* | content.space_rag_profiles | `retrieval_mode`(content.retrieval_mode), `advanced_modes[]`(MultiSelect {raptor,graphrag,colbert,sqlrag,agentic}) | `embedding_model`/`rerank_model`←catalog.models (capability-filtered), `allowed_unit_levels[]`←core.unit_levels, `default_classification`←governance.classifications | **No write RPC** — "single largest missing admin surface." +parser_profile/chunk_strategy(Select), chunk_size/overlap/hybrid_weight/retention_days/storage_quota_gb(numbers), extract_*/rerank/force_masking(Toggles). SCD-2 twin. |
| **template create/edit** *(design-now)* | content.templates + template_versions | `scope`(content.template_scope), published(Toggle) | `space_id`←content.spaces, author←core.profiles | **No endpoint** — powers Ask Draft/Playground/Workflows. +body(TextArea), variables(jsonb repeater), preset(jsonb). |
| **alert-rule create/edit** *(design-now)* | audit.alert_rules (+ rule_channels junction) | `kind`(audit.alert_kind), `severity`(audit.alert_severity) | `channel_ids[]`←audit.notification_channels (persisted via rule_channels junction, NOT uuid[]) | **No endpoint** — alerts derived client-side today. +threshold/condition. |
| **classification edit** *(design-now)* | governance.classifications | `level`(core.classification_level {public,internal,confidential,restricted} — **locked/disabled on edit**; adding a level is a migration) | — | **No endpoint** — new Governance card. Editable label/policy_text/display_order/retention_days over a fixed enum; SCD-2 twin. |

**Enum-vs-lookup driver split (clean 1:1 with §3):**
- **Pure enums → static Select:** budget_period, enforcement, feature_scope, feature_state, execution_location, mcp_scope, mcp_transport, retrieval_mode, template_scope, alert_kind, alert_severity, space_role, override_scope, credential_type, document_scope, asset_kind, request_status, api_key_status.
- **Metadata lookups → async Select/MultiSelect:** governance.classifications, governance.features, catalog.licenses, catalog.capability_types, core.permissions, core.org_units, core.unit_levels, catalog.models/routers, audit.notification_channels, vault.router_credentials (id-ref), content.spaces, core.profiles.

**Non-forms (documented):** S: settings (per-key Toggle, not structured entry), S: tools grants (role×tool matrix grid), T: playground/ask/compare (interaction writes, no admin form).

---

## §D. Recommended build/restructure order — least-disruptive-first, views-first

The order follows the blast radius in §A: put a **stable view contract (§B) in front of a surface BEFORE moving the table under it**, so the API/UI keep working across each step. Grouped into phases; each phase is independently shippable and CI-gated (`dbd reset && dbd apply && dbd import` + the trailing-ALTER grep, §6-9).

### Phase 0 — Zero-blast prerequisites (no UI/API touches)
1. **Create all enum types + lookup tables** (`ddl/type/<schema>/*.ddl` + lookup DDL), seed lookups (permissions, capability_types, licenses, features, classifications). Convert `varchar+CHECK → enum USING` and drop CHECKs. *No surface reads these directly yet.*
2. **Create the 8 domain schemas**; fold the 8 trailing-ALTER DDLs inline (document_embeddings +9, document_assets +5, document_versions +4, documents +3, quality_signals, siem_cursors, tenant_model_state, tenant_settings) so declared==live. *Pure DDL hygiene.*
3. **Fix `has_capability()` → `effective_role_permissions`**, apply FORCE RLS, tighten device/spaces read policies, remove MV grants. *Security-correctness, no shape change.*

### Phase 1 — View shields for pure schema-MOVES (mechanical, lowest blast radius)
Move tables whose only churn is `public.* → <schema>.*` (schema-qualify only), each behind its view first:
4. **audit.audit_events** (+ notification_channels/siem_cursors) — schema move only. Ship `audit_events_for_tenant`, repoint `/v1/audit` + siem.rs.
5. **core.\*** grant tables + `core.memberships` rename (← profile_tenants) + `core.permissions`/`catalog.capability_types` renames. Ship `org_members_for_tenant`, `roles_with_caps_for_tenant` (formalize existing effective_* precedent), `permissions_catalog`, `apikeys_for_tenant`. Repoint `/v1/org`, `/v1/apikeys`, `/rpc/rbac/*`, `/rpc/orgs/*` (rename map at rpc.rs:565/683/1347/1390/1484).
6. **catalog.\*** renames (chains ← fallback_chains, chain_models, config→catalog). Ship `routing_chain_for_tenant`, repoint `/v1/routing`, `/rpc/routing/set-step-active`, config_loader.
7. **device.\*** move (mcp_servers/tools/tenant_mcp_servers/tool_allow_lists composite-pk fix, devices). Ship `tools_for_tenant`, `devices_for_tenant`, repoint `/v1/tools`, `/v1/devices`, `/rpc/mcp/*`.

### Phase 2 — Secret custody move (isolated, high-value shield)
8. **vault.router_credentials** (deny-all move). Ship `connections_for_tenant` (booleans-only projection) FIRST, then move the table + schema-qualify the sensei-vault crate SQL (rpc.rs:1934-2140). Connections screen never sees the move because the view already hid ciphertext. Also repoint `mcp_servers.auth_credential_id` FK.

### Phase 3 — Catalog string→uuid fold (models)
9. **catalog.model_overrides** (absorb tenant_model_state string→uuid) + price move onto model_endpoints. Ship `models_with_pricing_for_tenant` FIRST, then fold. Repoint `/v1/models`, `/v1/models/available`, `/rpc/models/set-enabled`, and the chat enablement gate (chat.rs:264). Shields S: models + overview and T: home/ask/compare/models in one step.

### Phase 4 — Governance shape-changes (settings + features)
10. **governance.features + feature_policies** (feature_key→feature_id FK, re-seed features lookup, state→enum). Ship `feature_governance_for_tenant`, repoint `/v1/governance`, `/v1/judge`, `/rpc/governance/*`, config snapshot.
11. **governance.settings** (absorb tenant_settings + public.settings, boolean→scope/key/value jsonb — a SHAPE change). Ship `settings_for_tenant` projection to keep the `{setting_key,enabled}` contract, then rewrite the boolean readers (ledger.rs:657, rpc.rs:1607-1653/2203-2260, retrieve.rs:59, chat.rs:293/309). config_versions rename rides along.

### Phase 5 — The org/budget split (WIDEST blast radius — do last among moves, with the most shielding)
12. **core.org_units + unit_levels + unit_members** (NEW tree) — create and backfill from budget_nodes.kind/ref_id/parent_id.
13. **governance.nodes** (← budget_nodes, org_unit_id FK; drop kind/parent_id/ref_id). Ship `budget_tree_for_tenant` + `budget_requests_for_tenant` FIRST so `org-tree-state.svelte.ts` + Activity cascade stay byte-identical, THEN move. Rewrite `resolve_scope`/`subtree_ids` against org_units (analytics.rs:55-103/182/404, rpc.rs:120-560/1332-1441, ledger.rs:187, store.rs:98). Repoint `/v1/budgets`, all `/rpc/budgets/*`, `/rpc/orgs/create`.

### Phase 6 — The ledger overhaul (SECOND-widest; depends on Phases 3+5 FKs existing)
14. **metering.inference_calls** (free-text→catalog FK, *_node_id→org_unit_id, cost_usd→cost_estimated+cost_actual) + **routing_attempts** (NEW normalization) + **quality_signals**/**feedback** split. Ship `requests_ledger_for_tenant` + `request_trace_detail` FIRST (they need the catalog + org_units FKs from Phases 3+5), THEN change the write path (store.rs:106-160) and rewrite `SpendGroup.column()` → org-tree GROUP BY (analytics.rs:143-156/320-417/519). Rollups (usage_daily/quality_daily/MVs) follow the org_unit_id grain (finding #13).

### Phase 7 — Content plane (docs/spaces/chat) + retire legacy stacks
15. **content.\*** move (documents lifecycle+stage split, file cols→versions, messages drop cost/model). Ship `files_in_space`, `document_detail`, `document_assets_for_doc`, `spaces_for_tenant`, repoint all `/v1/documents*`, `/v1/spaces*`, rag pipeline (rag/store.rs, rag/ingest.rs).
16. **Retire legacy stacks:** gateway_tasks/sessions → inference_calls/routing_attempts/conversations; config.feature_states → feature_policies/user_preferences; drop dead access_group tables.

### Phase 8 — Land NEW design-now surfaces (greenfield forms — no existing contract to preserve)
17. **content.space_rag_profiles** ("largest missing surface") + its rag-profile Rokkit form + `/rpc/retrieval/set-config` retarget (move off generic settings). Ship `document_detail` config field.
18. **content.templates/template_versions**, **governance policy editors** (classifications/redaction_rules/retention/masking/safe_terms), **audit.alert_rules+rule_channels**, **governance.user_preferences**, **billing** (plans/subscriptions/seats/invoices + `billing_overview_for_tenant` + new `/v1/billing` route), **device.local_models**, **agents/workflows v2 seam**. These have NO current write path → build view + Rokkit form together, greenfield.

**Ordering rationale (blast-radius derived):** Phase 0-2 are near-zero-blast (renames/moves/secret-isolation hidden by views). Phase 3-4 fold string keys + shape-changes behind existing view contracts. Phase 5 (org/budget split) and Phase 6 (ledger) are the two widest surfaces (§A findings #1, #2) and are sequenced LAST among restructures — deliberately after their FK targets (org_units, catalog uuids) exist and after their shield views (`budget_tree_for_tenant`, `requests_ledger_for_tenant`) are proven, so the highest-blast change lands with the most protection. Phase 7-8 are content + greenfield, which have the fewest cross-app consumers. Every phase is gated by the CI dbd-diff job (§6-9); enum value-adds go through reconcile/snapshot, never plain apply.
