---
title: Torii/Seiki Database Redesign — Blueprint
status: design (pre-build) — needs review + the open decisions below before any schema change
created: 2026-08-03
method: ultracode workflow (5 domain maps → synthesis → 2 adversarial critics), all facts verified against the live dev DB (55322) + database/ddl/
supersedes: the incremental trailing-ALTER fold (subsumed here)
---

> **How to read this.** §0–§6 are the target design. **§7 (Required corrections)** folds in the
> adversarial review — apply those before building (two are CRITICAL security fixes to the design as
> drafted). **§8 (Open decisions)** needs Jerry. **§9** is the access-layer pass (traceability map +
> joined views + Rokkit forms) that follows. Doc-before-code: nothing here is applied yet.

## Torii/Seiki Target Database Design — Normalized, Schema-Organized, RLS-Secure Blueprint

### 0. Governing principles

1. **Schema = security + domain boundary.** The 51-table `public` dumping ground is dissolved into ~20 domain schemas. The privileged-read / owner-self / service_role-write / secret-deny-all splits that today are enforced per-table become **schema-level defaults** (revoke-all on the schema, then grant back per posture). Secrets live only in `vault`; the append-only ledger lives only in `metering`; rollups only in `analytics`.
2. **Cross-schema refs are normal.** Every table DDL declares `set search_path to <own_schema>, core, extensions;` and writes **schema-qualified FKs** (e.g. `references core.tenants(id)`, `references budget.nodes(tenant_id, id)`). Moving a table into a domain schema never breaks a FK.
3. **ENUM-FIRST for constrained value-sets** (ratified). Each of the 42 varchar+CHECK columns becomes a Postgres `ENUM` (DDL at `ddl/type/<owning_schema>/*.ddl`, singular name) — **unless** the value-set carries editable metadata (label/order/policy/active) or is operator-editable at runtime, in which case it becomes a **lookup table** (plural, seed-managed, FK). Bare varchar+CHECK is banned (churns the table AND dbd mis-diffs it).
4. **3NF by default; denormalize only with a written reason.** The only sanctioned denormalizations: `analytics.*` daily rollups/MVs (read-perf), `budget.holds.path_node_ids` (ancestor path for hot-path cascade), and `metering.inference_calls` node-path snapshot columns (documented analytics snapshot, kept FK-enforced).
5. **Canonical domain types:** actor/user = `uuid` FK → `core.profiles` everywhere (never varchar/text; system actor = a reserved sentinel uuid); money = `numeric(14,6)`; all timestamps = `timestamptz` named `*_at` (standardize on `modified_at`, retire `updated_at`); ids = `uuid`; pk pattern = **composite `(tenant_id, id)`** on every tenant table (enables composite tenant-scoped FKs).
6. **Every tenant-scoped table carries `tenant_id` and an explicit RLS posture**, and tenant tables get `FORCE ROW LEVEL SECURITY` as defense-in-depth so the runtime role cannot silently bypass RLS by owning the table.

---

### 1. Target schema set — 8 app schemas (was 20; consolidated with Jerry)

Schemas map to **coarse domain × shared security posture**, organized on two axes: **policy/control**
(the rules + limits an admin sets) vs **record** (what happened). `vault` (secrets) stays isolated.

| Schema | Consolidates | Purpose / posture |
|---|---|---|
| `extensions` | — | pgvector / pgcrypto / uuid-ossp / pg_net (unchanged; infra) |
| `vault` | vault + router_credentials | **Secrets only — deny-all to clients, service_role decrypt.** Non-negotiably separate. |
| `core` | core + **rbac** + **access** | Identity, tenancy, org structure, RBAC (roles/permissions/grants + `effective_*` views + `has_capability()`), programmatic access (api_keys/service_accounts), IdP/SCIM. |
| `catalog` | catalog + **routing** | Model/provider/router catalog + capability/license lookups + per-tenant overrides + fallback chains/bindings/policies/provider-health. (renames `config`) |
| `governance` | governance + **budget** + **billing** | **POLICY/CONTROL plane:** the *rules* (feature 4-state policy, settings/prefs, config_versions, redaction/classification/retention/masking editors) **and** the *limits* (budget caps/holds/requests) — plus the billing/licensing seam. Admin/service_role-write; needs SCD-2 history. |
| `metering` | metering + **analytics** | **RECORD plane:** the single append-only inference ledger (inference_calls/execution_traces/routing_attempts/quality_signals) + reconstructable rollups/MVs. Service_role-write, tenant SELECT-only, FORCE RLS. |
| `content` | knowledge + **workspace** + **chat** + templates | User content/collaboration: spaces + membership, documents/RAG/datasets/redactions/rag-profiles, conversation threads/messages/citations, prompt templates. Owner-self + classification-aware. |
| `audit` | audit + **history** | The change/event **record**: append-only audit_events + alerting (rules/events/channels) + siem_cursors, **and** the `past_<table>` SCD-2 twins (audit + history go hand in hand). Deny-all/service_role for `past_*` (tenant-scoped, see §7-#2); tenant-read append-only for `audit_events`. |
| `device` | device + **tools** | Edge/integration: device fleet (enroll/revoke/snapshots/buffers/local-models) + MCP servers/tools/allow-lists. |
| `staging` | — | dbd import staging (unchanged, ignored; infra) |

**8 app schemas** (`vault, core, catalog, governance, metering, content, audit, device`) + `extensions`/`staging` (infra).
**`agents`/workflows (v2)** is *not* a v1 schema — it lands as its own schema when the v2 runtime is
scheduled (design captured in §2 for continuity). `public` ceases to hold application tables. The §2
catalog is grouped by *sub-domain* (rbac, routing, budget, workspace, chat, content, tools, billing,
history, agents) — read each `#### <sub-domain>` as "→ lives in `<parent schema>`" per this table.

---

### 2. Per-schema table catalog

#### core (identity / tenancy / org structure)
- **tenants**(id pk, slug uniq, domain uniq, name, legal_name, primary_domain, region, data_residency, egress_policy jsonb, `status core.tenant_status`, is_platform) — anchor of all RLS. *New:* legal_name/region/residency/egress for onboarding.
- **tenant_languages**(pk(tenant_id,language), is_default, is_active).
- **profiles**(id pk = auth.users.id, display_name, avatar_url, claims_version bigint) — the token-staleness gate; **no schema FK to auth** (Supabase). Reserve `SYSTEM` sentinel row for actor attribution.
- **memberships** (was `profile_tenants`): pk(profile_id) today (single-tenant), FK tenant_id, `status core.membership_status`, active bool, assigned_by uuid→profiles. *Multi-tenant seam:* documented path to pk(profile_id,tenant_id).
- **org_units** (NEW, split from budget_nodes structure): pk(tenant_id,id), self-FK parent_id, `kind core.org_unit_kind {org,dept,team}`, name. Separates org structure lifecycle from budget caps.
- **unit_members** (NEW): pk(tenant_id,unit_id,profile_id) — the "people→teams" mapping the mock needs.
- **identity_providers** (NEW, v1 partial): pk(tenant_id,id), `kind core.idp_kind`, config jsonb, is_active.
- **scim_configs** / **directory_syncs** (NEW, fast-follow): SCIM endpoint/token ref + sync state. Deprovision must bump `profiles.claims_version`.

#### rbac
- **roles**(pk(id), UNIQUE NULLS NOT DISTINCT(tenant_id,key), is_system) — shared defaults = tenant_id NULL.
- **permissions** (RENAMED from `core.capabilities` — ends the collision): pk(key), domain, description. Lookup catalog.
- **role_permissions**(pk(role_id,capability→permissions.key), tenant_id).
- **profile_roles**(pk(tenant_id,profile_id,role_id), assigned_by uuid→profiles).
- **VIEWS** `effective_roles`, `effective_role_permissions` — shared-defaults (tenant_id NULL) cross-joined to every tenant ∪ custom rows. **All resolve reads MUST use these.**
- **has_capability(text)** SECURITY DEFINER — **FIXED to read `effective_role_permissions`** (not `role_permissions` directly), closing the live bug where NULL-tenant defaults never match and every user gets caps=0.

#### access
- **service_accounts**(pk(tenant_id,id), budget_node_id **FK→budget.nodes**, `status access.service_account_status`).
- **api_keys**(pk(tenant_id,id), XOR CHECK(profile_id ⊕ service_account_id), profile_id **FK→core.profiles**, service_account_id FK, `status access.api_key_status`, hashed_secret, scope jsonb). Column-level `REVOKE SELECT(hashed_secret)` from authenticated; budget resolves from identity, never the key.

#### vault (secret custody — RLS enabled, **zero client policies**, all privileges revoked from anon/authenticated; service_role only)
- **tenant_keys**(pk(tenant_id), encrypted_dek bytea, dek_version).
- **tenant_key_archive**(pk(tenant_id,dek_version), encrypted_dek).
- **router_credentials** (MOVED out of public): pk(tenant_id,id), router_id FK→catalog.routers, `credential_type vault.credential_type`, `refresh_status vault.refresh_status`, encrypted_api_key/encrypted_oauth bytea, oauth_client_id, token_url, expires_at, scopes, XOR CHECK(type→column). Never appears in any authenticated SELECT.

#### catalog (global reference + tenant overrides)
- **providers**(pk(id), name uniq, is_active, is_open_source).
- **routers**(pk(id), name uniq, `router_type catalog.router_type`, `auth_type catalog.auth_type`, api_base_url [EXCLUDE /v1]).
- **models**(pk(id), provider_id FK, name/version/variant lowercased via `citext`+CHECK, full_name alias, display_name, context_window, max_output_tokens, `license_type` FK→**licenses** lookup). *New UI columns:* tier/tag/local_capable move here; price/quality/latency belong on **model_endpoints** (route-dependent).
- **capability_types** (RENAMED from `config.capabilities`): pk(id), name, category, parameters — model-capability lookup.
- **model_capabilities**(pk(id), model_id FK, capability_id FK, supported) — add `ON DELETE CASCADE`.
- **model_endpoints**(pk(id), model_id/router_id/capability_id FK, cost_per_* `numeric(14,6)` standardized, latency_p50/p95, quality_score, is_active/is_default) — pricing source of truth.
- **model_overrides**(pk(tenant_id,id), UNIQUE(tenant_id,model_id,scope_type,scope_id), `scope_type catalog.override_scope`, price override) — **absorbs `tenant_model_state`** (the string-keyed enable subset).
- **provider_overrides**(pk(tenant_id,id), UNIQUE(tenant_id,provider_id), enabled).
- **licenses** (LOOKUP): key, label, url, is_open_source.
- Global catalog tables keep RLS-off but **SELECT-only, zero write grants** (documented invariant: never add a tenant-scoped row here — it would leak cross-tenant).

#### routing
- **chains** (was fallback_chains): pk(tenant_id,id), capability_id FK, is_active, priority.
- **chain_models** (was fallback_chain_models): pk(tenant_id,id), chain_id/router_id/model_id FK, sequence_order, `plane execution_location` (unified type + name — replaces text `plane`), rule, role.
- **chain_bindings**: pk(tenant_id,id), chain_id FK, space_id **FK→workspace.spaces**, role_id **FK→rbac.roles**, capability_id FK (add the missing FKs).
- **routing_policies**(pk(tenant_id,chain_id), breaker jsonb, retries, backoff, timeout, region_pin, health_interval).
- **provider_health**(pk(tenant_id,router_id), `state routing.breaker_state`, failures, last_check).

#### budget
- **nodes** (was budget_nodes): pk(tenant_id,id), self-FK parent_id, `kind budget.node_kind`, `period budget.budget_period`, `enforcement budget.enforcement`, org_unit_id **FK→core.org_units** (structure link), ref_id (user/service, FK-resolved via kind), cap/spent/reserved `numeric(14,6)`, alert_threshold, free_floor.
- **holds** (was budget_holds): pk(tenant_id,id), budget_node_id FK, path_node_ids uuid[] (justified denorm), `status budget.hold_status`, idempotency_key.
- **requests** (was budget_requests): pk(tenant_id,id), node_id FK, requested_by/resolved_by uuid→profiles, requested_cap `numeric(14,6)` (fix from (12,2)), `status budget.request_status`. Member may SELECT own + INSERT own PENDING; approval service_role only.

#### metering (the single ledger — service_role write, tenant SELECT-only, FORCE RLS)
- **inference_calls**(pk(tenant_id,id), conversation_id/session→**chat**, model_id/router_id/capability_id **FK→catalog** (replace free-text), budget_node_id + org/dept/team/user_node_id **FK→budget.nodes** (documented snapshot), hold_id FK→budget.holds, project_id **FK→chat.projects** (lands the phantom ref), cost_usd `numeric(14,6)`, `status metering.call_status`, `execution_location execution_location`).
- **execution_traces**(pk(tenant_id,id), inference_call_id FK, trace jsonb) — kept as raw sidecar.
- **routing_attempts** (NEW, normalizes the trace for Compare/Requests UI): pk(tenant_id,id), inference_call_id FK, attempt_no, router_id, model_id, `plane execution_location`, latency_ms, outcome, cost_usd.
- **quality_signals**(pk(tenant_id,id), `subject_type metering.signal_subject {call,message,conversation}` + subject_id (replaces the fragile `source LIKE 'c5.%'` escape hatch), `signal_class metering.signal_class`, signal_key, value_num/text/json, schema_version, actor_id uuid→profiles). Cost/latency NOT re-stored (read from inference_calls).
- **LEGACY `gateway_tasks`/`gateway_task_logs`/`sessions`/`session_logs` are retired** (migrated into inference_calls/routing_attempts and chat.conversations) — kills the double-ledger.

#### analytics (justified denormalization; rebuildable from metering)
- **usage_daily**, **quality_daily** (wide-grain rollups, tenant SELECT RLS, writes revoked).
- **applied_calls** (idempotency ledger for rollup_apply).
- **MVs** model_mix_daily / overview_current — **revoked from authenticated** (MVs can't carry RLS); read only via service_role with in-query tenant filter. Invariant: never GRANT an MV to authenticated.

#### chat
- **projects** (NEW, reserves the workspace-grouping above conversations): pk(tenant_id,id), space_id FK, owner_id uuid→profiles.
- **conversations**(pk(tenant_id,id), project_id FK, space_id FK, owner_id uuid→profiles).
- **messages**(pk(tenant_id,id), conversation_id FK, `role chat.message_role`, model_id **FK→catalog.models**, `execution_location execution_location`, cost_usd `numeric(14,6)`) — cost/model become **read-through joins to metering** where possible; retain only display copies.
- **message_citations**(pk(tenant_id,id), message_id FK, document_id/chunk_id **FK→knowledge** (enforce)).

#### knowledge (RAG / doc center)
- **documents**(pk(tenant_id,id), space_id/collection_id FK, `scope knowledge.document_scope`, `classification core.classification_level`, `status knowledge.document_status`, current_version_id, parse_quality, source_format, tags[]). **Legacy file cols (storage_path/file_size/content_type/content_hash) DROPPED** → live on versions only.
- **document_versions**(pk(tenant_id,id), UNIQUE(tenant_id,document_id,version_no), content_hash, parser, parser_version, storage_path, file_size, content_type, superseded_at) — trailing-ALTER cols folded inline.
- **document_assets**(pk(tenant_id,id), document_id FK, version_id **FK** (enforce), `kind knowledge.asset_kind`, bbox, page_ref, caption).
- **document_embeddings**(pk(tenant_id,id), UNIQUE(...chunk_sequence), version_id FK, parent_chunk_id **self-FK** (enforce), contextual_prefix, section_path, page_ref, `element_type knowledge.element_type`, redaction_count, embedding vector(1024), tsv tsvector, superseded_at) — all 9 trailing-ALTER cols folded inline. Holds **only redacted text** (DLP invariant).
- **collections** (was document_collections): self-FK parent_id, space_id FK.
- **space_rag_profiles** (NEW — the single largest missing admin surface): pk(tenant_id,space_id), parser_profile, embedding_model, extract_tables/images/formulas, chunk_strategy, chunk_size, overlap, `retrieval_mode knowledge.retrieval_mode`, hybrid_weight, rerank+rerank_model, advanced_modes[] (raptor/graphrag/colbert/sqlrag/agentic), default_classification, retention_days, force_masking, allowed_tiers[], storage_quota_gb. **Not buried in generic settings.**
- **structured_datasets**(pk(tenant_id,id), space_id/document_id **FK** (enforce), storage_ref, row_count).
- **dataset_columns**(pk(tenant_id,id), dataset_id FK, `sensitivity core.classification_level`, data_type, description [LLM-facing schema metadata], encrypted_value bytea + dek_ref (realize §3c custody, not just a flag), compute_policy jsonb {aggregate_only, k_anon_threshold, allowed_roles}).
- **redactions** (NEW, W5): pk(tenant_id,id), document_id/message ref, type, original→placeholder, false_positive, at — the DLP audit trail + safe-list feedback.
- **document_comments** / **document_shares** (NEW, v2 design-now): comments/suggestions with `status`, per-person doc ACL (`doc_share_role`, visibility).

#### workspace
- **spaces**(pk(tenant_id,id), `tier workspace.space_tier` (NEW), `classification core.classification_level`, owner_id **FK→core.profiles**, mark, people_count/item_count [maintained], budget_node_id FK). Apply classification/membership-aware RLS consistently (not tenant-only).
- **space_members**(pk(tenant_id,space_id,profile_id), `role workspace.space_role`).

#### content
- **templates** (NEW — entirely missing today): pk(tenant_id,id), space_id FK, `scope content.template_scope`, name, current_version_id, published, uses. Powers Ask Draft / Playground / Workflows / "Save as template".
- **template_versions** (NEW): body, variables jsonb, preset (pipeline config), version_no, author uuid→profiles.

#### governance
- **features** (LOOKUP, from config.features): key, module, label, description, mandatory, enabled_default.
- **modules** (LOOKUP; verify still needed vs vestigial dojo heritage — retire with legacy sessions if unused).
- **feature_policies** (the real 4-state governance table): pk(tenant_id,id), **feature_id FK→governance.features** (replace free-text feature_key), `scope_type governance.feature_scope`, scope_id, `state governance.feature_state`, value. **Legacy `config.feature_states` RETIRED** (folded here + user_preferences); its history twin becomes `history.past_feature_policies`.
- **settings** (scoped KV): pk(tenant_id,id), `scope governance.config_scope`, space_id, key, value jsonb. **Absorbs `tenant_settings`** (boolean-only KV) — consolidated.
- **user_preferences**(pk(tenant_id,profile_id,key), value jsonb).
- **config_versions** (D4, from config.config_versions): pk(tenant_id), version bigint, components jsonb.
- **classifications** (LOOKUP over the fixed `core.classification_level` enum): level pk, label, policy_text, display_order, retention_days — the editable Governance classification-scheme card.
- **redaction_rules** (NEW): label, pattern (RE2), `action governance.redaction_action`, is_active.
- **retention_policies** (NEW): artifact_type, period, legal_hold.
- **safe_terms** (NEW): allow-list terms (false-positive feedback sink).
- **masking_policies** (NEW): rule-key→on/off (replaces masking-in-tenant_settings).
- **policy_enforcement_events** (NEW): policy, `outcome governance.enforcement_outcome`, applied/blocked, feedback (reinforce/correct loop).

#### audit (append-only)
- **audit_events**(pk(tenant_id,id), actor_id **uuid=auth.uid()** with_check binding, action, target, ip inet, data jsonb) — INSERT with actor binding; **UPDATE/DELETE never granted** to authenticated.
- **alert_rules**(pk(tenant_id,id), `kind audit.alert_kind`, `severity audit.alert_severity`, channel_ids — normalized via **rule_channels** junction (NEW) rather than uuid[]).
- **alert_events**(pk(tenant_id,id), rule_id FK, `severity audit.alert_severity`).
- **notification_channels**(pk(tenant_id,id), `kind audit.channel_kind`, target, config jsonb).
- **rule_channels** (NEW junction, replaces `alert_rules.channel_ids uuid[]`).
- **siem_cursors**(pk(tenant_id,channel_id), channel_id **FK→notification_channels** (enforce)).

#### device
- **devices**(pk(tenant_id,id), profile_id FK, `status device.device_status`, public_key, config_version, `exec_location execution_location`, local_model_count, key_fingerprint, sync_policy/buffer_health jsonb). Sole SELECT policy = own OR `device.manage` (no permissive OR from a generic tenant-read batch — the O3-4 leak class).
- **device_snapshots** / **device_buffer_receipts** / **device_sync_events** (NEW, D2/D4): config-snapshot versioning + offline signed-buffer replay (idempotent/anti-replay).
- **local_models** (NEW, D2-full): download registry + device HW-fit estimates.

#### tools (standardize on composite pk(tenant_id,id) or explicit platform/tenant scope split)
- **mcp_servers**: split into **mcp_servers** (platform-global, pk(id), tenant_id NULL) vs tenant rows via pk(tenant_id,id), `scope tools.mcp_scope`, `transport tools.mcp_transport`, auth_credential_id **FK→vault.router_credentials** (enforce).
- **mcp_server_tools**: add `tenant_id` (denormalized-for-isolation) or keep explicit parent-join contract in every read policy; `UNIQUE(mcp_server_id,tool_name)`, input_schema/annotations jsonb.
- **tenant_mcp_servers**(pk(tenant_id,mcp_server_id), enabled, config_override jsonb).
- **tool_allow_lists**: **fix single-col pk → pk(tenant_id,id)**, role_id/mcp_server_id FK, space_id **FK**. Verify enforcement on the chat hot path (P11).

#### agents (design-now; v2 runtime)
- **agents**(pk(tenant_id,id), space_id FK, goal, bound_identity (profile/service_account), budget_node_id FK).
- **agent_guardrails**(max_steps, budget_cap, grounded).
- **workflows** / **workflow_triggers** {schedule,event,manual} / **workflow_steps** {retrieve,draft,tool,classify,notify,branch,output}.
- **workflow_runs** / **run_steps** / **agent_traces** — each run **owns many `metering.inference_calls`** (agent_run_id FK seam added to inference_calls) and tool invocations; executes under bound actor + capability scope + budget node + audit binding.

#### billing (future seam — attaches without touching budget)
- **plans**, **subscriptions**, **seats** (assignment + idle-reclaim), **invoices**, **payment_methods**. Budget-tree numbers stay in `budget`; billing is the licensing layer on top.

#### history (SCD-2 twins — reuse the exact existing shape)
`past_<table>`(id pk, <original key cols>, version int, modified_by uuid, effective_from, effective_to, `operation history.operation`, modified_at), auto-populated by `historize_<table>` trigger. **Tables that get history:** budget.nodes, catalog.model_overrides, catalog.provider_overrides, governance.feature_policies (replaces past_feature_states), governance.redaction_rules, governance.retention_policies, governance.classifications, rbac.role_permissions, knowledge.space_rag_profiles. (Documents/templates use their explicit `*_versions` lineage instead of a history twin.)

---

### 3. Value-set classification (all 42 varchar+CHECK → ENUM or LOOKUP)

**Shared enums (owning schema `core`):** `execution_location {local,cloud}` (unifies inference_calls/messages/gateway/analytics.execution_location AND routing `plane`); `classification_level {public,internal,confidential,restricted}` (spaces/documents/dataset_columns — with a `governance.classifications` LOOKUP for editable label/policy metadata over the fixed enum); `tenant_status`, `membership_status`, `org_unit_kind`, `idp_kind`.

**Per-domain enums:** vault(credential_type, refresh_status); catalog(router_type, auth_type, override_scope); routing(breaker_state); budget(node_kind, budget_period, enforcement, hold_status, request_status); metering(call_status, signal_class, signal_subject); chat(message_role); knowledge(document_status, document_scope, asset_kind, element_type, retrieval_mode, doc_share_role); workspace(space_tier, space_role); content(template_scope); governance(feature_scope, feature_state, config_scope, redaction_action, enforcement_outcome); audit(alert_severity, alert_kind, channel_kind); tools(mcp_scope, mcp_transport); device(device_status); history(operation).

**Lookup tables (metadata-carrying / operator-editable):** `governance.classifications`, `governance.features`, `governance.modules`, `catalog.licenses`, `catalog.capability_types` (renamed), `rbac.permissions` (renamed) — these carry labels/descriptions/order/active and stay seed-managed + FK.

**Enum DDL location:** `ddl/type/<owning_schema>/<type>.ddl`, created as `create type … as enum (…)`. Value ADDITIONS flow through dbd's **reconcile (pre-release) / snapshot-migrate (post-release)** — never plain `apply`. The table DDL never changes on a value-add.

---

### 4. RLS posture per domain

- **Secret (deny-all):** `vault.*` — RLS enabled, zero policies, all privileges revoked from anon/authenticated, service_role only.
- **Service_role-write / tenant SELECT-only (+FORCE RLS):** `metering.*`, `budget.nodes/holds`, `analytics.*` tables, `rbac.*` grant tables, `access.*` (with column-level revoke on hashed_secret), `catalog` tenant-override tables, `routing.*`, `governance` policy tables, `device.*`, `tools.*`, `audit.audit_events` (INSERT with actor=auth.uid(), no U/D).
- **Owner-self DML:** `chat.*` (owner_id=auth.uid()), `governance.user_preferences`, `budget.requests` (own PENDING insert), `knowledge.documents` (owner-write + classification/space-membership-aware read + `guard_document_classification` trigger), `content.templates` (scope-aware).
- **Classification/membership-aware read** (documents pattern) applied consistently to `workspace.spaces` (retire tenant-only read), `knowledge.*` derivatives (inherit parent-doc read), `chat` (space + owner).
- **MVs:** never granted to authenticated; gateway-mediated (service_role + in-query tenant filter).
- **Global reference (`catalog` platform tables):** RLS-off acceptable ONLY as SELECT-only, zero write grants; documented invariant that no tenant row may be added.
- **Structural hardening:** FORCE RLS on all tenant tables; `has_capability()` fixed to `effective_role_permissions`; single SELECT policy on `device.devices` (own OR device.manage — no permissive OR); Realtime channels RLS-scoped to tenant + row-ownership.

---

### 5. Normalization / dedup rationale

- **One inference ledger:** retire `gateway_tasks/gateway_task_logs/sessions/session_logs`; canonical = `metering.inference_calls` + `routing_attempts` + `execution_traces`; `chat.conversations/messages` for threads. Kills the double cost-ledger + double thread model.
- **One model-enable surface:** `tenant_model_state` (string-keyed) folded into `catalog.model_overrides` (uuid + price); provider-level stays in `provider_overrides`.
- **One settings hierarchy:** catalog=`governance.features` → policy=`governance.feature_policies` (FK to features, +value) → user override=`governance.user_preferences`; generic KV=`governance.settings` (absorbs boolean-only `tenant_settings`). Legacy `config.feature_states` retired.
- **Doc file metadata** lives only on `document_versions` (dropped from `documents`).
- **Actor identity** normalized to `uuid` FK→core.profiles across all `modified_by/created_by/assigned_by/user_id/actor_id` (28+ varchar columns + 6 text `user_id`), with a SYSTEM sentinel.
- **Money** standardized to `numeric(14,6)` (fixes budget_requests (12,2) + unqualified cost_usd).
- **Org structure** split out of `budget_nodes` into `core.org_units`/`unit_members`; budget nodes reference the unit.
- **Justified denormalization only:** analytics rollups/MVs, `budget.holds.path_node_ids`, `metering.inference_calls` node-path snapshot (all FK-enforced/reconcilable), `mcp_server_tools.tenant_id`.
- **Add all missing FKs** (composite tenant-scoped) called out across the maps; add tenant FKs on the two FK-less tenant tables.

---

### 6. Migration / cleanup path from today

1. **Create enum types + lookup tables** (`ddl/type/<schema>/*.ddl` + lookup DDL) and seed lookups. Convert columns `varchar+CHECK → enum USING value::enum`; drop the CHECKs.
2. **Create domain schemas**; move tables via `ALTER TABLE … SET SCHEMA` (dbd apply after re-homing DDL under `ddl/table/<schema>/`). Update every DDL header to `set search_path to <own_schema>, core, extensions` and schema-qualify FKs.
3. **Fold trailing `ALTER TABLE … ADD COLUMN IF NOT EXISTS` back inline** into CREATE TABLE for the 8 drifted DDLs (document_embeddings +9, document_assets +5, document_versions +4, documents +3, quality_signals, siem_cursors, tenant_model_state, tenant_settings) so declared == live.
4. **Renames/dedups:** core.capabilities→`rbac.permissions`; config.capabilities→`catalog.capability_types`; fallback_chains→`routing.chains`; router_credentials→`vault.router_credentials`; tenant_keys/archive→`vault`; fold tenant_model_state→catalog.model_overrides; fold tenant_settings→governance.settings; drop legacy file cols from documents.
5. **Add missing FKs** (backfill/repair orphans first), split org_units from budget_nodes (backfill via kind), normalize actor columns to uuid (join by email/username to profiles; unresolved→SYSTEM sentinel).
6. **Retire legacy stacks:** migrate gateway_tasks/sessions → inference_calls/routing_attempts/conversations, then drop; retire config.feature_states → feature_policies/user_preferences; drop dead access_group tables (already absent).
7. **Fix `has_capability()`**, apply FORCE RLS on tenant tables, tighten device/spaces read policies, remove any MV grants.
8. **Land new surfaces** as designed-now tables: space_rag_profiles, templates/template_versions, governance policy editors, redactions/comments/shares, org_units/unit_members, routing_attempts, chat.projects, agents/workflows seam, billing seam.
9. **CI dbd-diff gate:** a job that (a) greps `ddl/table/*.ddl` and **fails on any trailing `alter table … add column`**, and (b) runs `dbd reset && dbd apply && dbd import` on an ephemeral DB and diffs live catalog vs declared — failing on any differ-invisible drift. Enum value-adds go through reconcile/snapshot, never plain apply. Use the dev DB (55322/postgres) as the reconcile source; NEVER `reconcile` against live without snapshot (would drop GH-5/RAG cols) — the CI gate uses an ephemeral DB.

This blueprint covers every current screen (18 Seiki + 10 Torii) and the proposed-future scope (spaces/KB, document workspace/versions/lineage/redactions/comments/shares, prompt templates, governance policy editors, alerts, IdP/SCIM, agents/workflows, billing/seats, interaction-intelligence, §3c gated compute, device fleet/local models), with a schema-level security boundary replacing the per-table one.
---

### 7. Required corrections from adversarial review (apply BEFORE build)

Two independent critics reviewed the §0–§6 design against the maps + live DB. The design is **SOLID** on coverage; these are the fixes it needs.

**🔴 CRITICAL — must fix (security):**

1. **`knowledge.dataset_columns.encrypted_value` must NOT be client-SELECTable.** As drafted the table sits under the tenant-wide `authenticated SELECT` policy, so the §3c ciphertext + `dek_ref` would be readable by *any* tenant member — breaking "compute without exposing" and the no-key-exfiltration premise. **Fix:** move the ciphertext to `vault.*` (deny-all) keyed by `(tenant_id, column_id)`, **or** keep it in `knowledge` with `REVOKE SELECT (encrypted_value, dek_ref) FROM authenticated` **and** a sensitivity/space-aware row policy (not tenant-wide). Decrypt+compute only in the service_role boundary; never return ciphertext/`dek_ref` to `authenticated`.

2. **`history.past_*` twins need `tenant_id` + RLS.** The existing history shape has no `tenant_id` and no policy; generalized to `past_budget_nodes`/`past_role_permissions`/etc. it would hold another tenant's budgets + RBAC grants with **zero declared security posture** → cross-tenant leak if ever exposed. **Fix:** add `tenant_id` to every `past_<tenant-table>` (backfilled from the source key), `ENABLE`+`FORCE` RLS with the source's tenant predicate, default the whole `history` schema to **deny-all / service_role-only**, and declare its posture explicitly in §4.

**🟠 HIGH:**

3. **Composite FKs, not single-column.** §5 mandates `pk(tenant_id,id)` but lists intra-tenant FKs single-column (`holds.budget_node_id`, `inference_calls.hold_id`, `messages.conversation_id`, `siem_cursors.channel_id`, …). A single-col FK to a composite-PK table is impossible without a redundant `UNIQUE(id)` that *discards the tenant-consistency guarantee*. **Fix:** every intra-tenant FK is composite — `foreign key (tenant_id, budget_node_id) references budget.nodes(tenant_id, id)`. Only cross-tenant/global refs (`catalog.*`, `core.profiles`, `vault`) stay single-column.

4. **`metering.quality_signals` is over-merged.** `signal_class='explicit'` = user feedback (thumbs) written by a real user; under blanket service_role-write-only the interaction-intelligence loop can't insert. **Fix:** split explicit user signals into an owner-INSERT table (`with check profile_id = auth.uid()`), **or** a per-row INSERT policy letting `authenticated` insert only `signal_class='explicit'` bound to their own `actor_id`; implicit/system stay service_role.

**🟡 MEDIUM:**

5. **`document_status` enum will churn** — its transient pipeline stages (parsing/chunking/embedding…) are exactly what gets renamed/removed, and Postgres can't DROP an enum value (only add). **Fix:** stable lifecycle enum `{pending, processing, completed, failed, archived}` + a separate nullable `stage` column (lookup or progress field) for the fine-grained step. Same caution for any status enum encoding a transient state machine.
6. **Polymorphic `scope_id`/`subject_id`/`ref_id`** (feature_policies, settings, quality_signals, budget.nodes.ref_id) can't be FK-enforced — orphan-prone. **Fix:** per-target nullable FK columns + a CHECK that exactly one is set (the `api_keys` XOR pattern), or explicitly document as app-enforced (don't count them under "all FKs added").
7. **`chat.messages.cost_usd`/`model_id` are an unsanctioned second cost store** that will drift from `metering`. **Fix:** read-through join to metering (or a view), or add to the §0.4 sanctioned-denorm list with a reconciliation trigger + immutable-from-clients.
8. **§3c compute runtime has no home** — column encryption exists but "Ask-the-data" queries/grants/audit don't. **Fix:** reserve `knowledge.compute_jobs` (dataset, requester, query, aggregate/k-anon result, status) + `query_grants` (column × role × op); every compute emits a `metering.quality_signal` + `audit.audit_events` row.
9. **`knowledge.redactions` must not store the raw original** in a non-vault schema (contradicts the one-way-placeholder DLP posture). **Fix:** store only type + placeholder + span offsets in `knowledge`; any reversible original→placeholder mapping goes in `vault` (service_role, per-tenant DEK).
10. **`space_rag_profiles.advanced_modes[]`** is a toggle with no backing store. **Fix:** reserve stub tables (`knowledge.graph_edges`, `knowledge.summary_nodes`, multi-vector plan) or explicitly scope them v2 with a note.

**🟢 LOW:** add `vault.router_credentials.custody {gateway|device}` (toggle home, only `gateway` valid v1); confirm device-session binding folds into `devices` or add `device.device_sessions`, + `last_active_at` for seat idle-reclaim; reserve `core.membership_requests` (onboarding M2); denormalize `tenant_id` onto `tools.mcp_server_tools` so isolation doesn't depend on every policy remembering the parent join.

---

### 8. Open decisions (need Jerry)

1. **`config.modules` + `sessions.module_id`** — still load-bearing for torii, or vestigial dojo heritage that retires with the legacy sessions stack? (Decides whether `governance.modules` survives.)
2. **Multi-tenant-per-user** — keep `memberships pk(profile_id)` (single-tenant, simpler RLS/JWT) for v1 with a documented future path, or design `pk(profile_id,tenant_id)` + re-scoped RLS now?
3. **`chat.projects`** — land the workspace-grouping-above-conversations in v1 (several screens imply it) or drop the phantom `inference_calls.project_id` until scheduled?
4. **`access` schema** — separate schema for api_keys/service_accounts (secret boundary, recommended) or fold into `core` to reduce schema count?
5. **`chat.messages` cost/model** — display copies, or strict read-through joins to `metering` (single source of truth vs join cost)?
6. **`mcp_servers`** — split platform-global (`pk(id)`, tenant_id NULL) vs tenant (`pk(tenant_id,id)`), or one table with nullable tenant_id + `mcp_scope` enum?
7. **SCD-2 history set** — confirm which config tables need history twins (proposed: budget.nodes, catalog overrides, feature_policies, role_permissions, governance policy tables, space_rag_profiles); does per-request-resolved `role_permissions` truly need history?
8. **`classification_level`** — fixed 4-value enum + editable-metadata lookup (label/policy only), or must operators **add levels** at runtime (→ full lookup table + FK, no enum)?
9. **`billing`** — reserve the seam only, or model plans/seats now to unblock the Seiki Billing seat/idle-reclaim UI (gated on the DECISIONS §10.1 payment-provider choice)?

---

### 9. Next: access-layer pass (Pass 2)

Per the tables→APIs→UI sequence, the follow-on pass produces (built on this schema):
- **Blast-radius traceability map** — per table: the API endpoints (gateway routes) + UI pages that read/write it, so a restructure shows its impact and fixes flow through (operationalizes the verify-blast-radius rule as a maintained artifact, not an ad-hoc grep).
- **Joined view catalog** — read-views per access pattern (connector names: `files_in_space`, `budget_tree_for_tenant`) so APIs GET from a view and the UI's Component→State mapping matches the view shape 1:1; restructuring underlying tables can preserve the view contract → smaller API/UI blast radius.
- **Rokkit schema-form bindings** — the table schema + enum/lookup types drive Rokkit schema+layout-controlled entry forms (enum values become field options) for the write side.
