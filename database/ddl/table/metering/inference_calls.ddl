-- database/ddl/table/metering/inference_calls.ddl
set search_path to metering, core, extensions;  -- §D Phase 6 (moved public→metering); LN-3a dropped the sessions FK

create table if not exists inference_calls (
  tenant_id          uuid         not null
    references core.tenants(id) on delete cascade
, id                 uuid         not null default gen_random_uuid()
, session_id         uuid                                              -- nullable; FK below
, project_id         uuid                                              -- nullable; no FK yet (projects table TBD)
, capability         text         not null                             -- Capability enum (snake_case: text_chat, text_complete, …)
, chain_id           text                                              -- nullable
, adapter            text         not null                             -- e.g. anthropic, openai
, model              text         not null                             -- logical model name
, api_model_id       text                                              -- nullable; exact API model string
  -- §D Ledger Normalize LN-3b: FK-normalized routing identity, resolved at write from
  -- (adapter→routers.name, api_model_id→model_endpoints.router_model_id) with the is_default desc /
  -- priority asc tiebreak — the SAME lateral config_loader uses to derive api_model_id, so the recorded
  -- api_model_id resolves back to the identical endpoint by construction. All nullable + FK ON DELETE SET
  -- NULL → fail-soft: a resolution miss never blocks a call; deleting a catalog row never cascade-deletes
  -- billing history. adapter/model/chain_id free-text are KEPT (point-in-time snapshot of what actually
  -- ran); LN-3b-2 swaps the read shields/rollups to resolve these back before deciding drop-vs-keep.
, endpoint_id        uuid                                              -- winning catalog.model_endpoints row (precise, priced)
, model_id           uuid                                              -- catalog.models (stable; models soft-deleted, not dropped)
, router_id          uuid                                              -- catalog.routers (== adapter)
, input_tokens       integer                                           -- nullable; Option<u32>
, output_tokens      integer                                           -- nullable; Option<u32>
, cost_usd           numeric(12,6) not null default 0                 -- f64 mapped to numeric for precision (LN-4b → cost_actual)
, cost_estimated     numeric(14,6)                                     -- §D LN-4: gateway pre-call cost estimate (USD); nullable — some paths (C6 judge) produce none
, duration_ms        bigint       not null                             -- u64; bigint avoids overflow for long calls
, status             metering.call_status not null                     -- CallStatus {success,failed}
, error_type         text                                              -- nullable; Option<String>
, fallback_sequence  smallint     not null default 0                  -- u8 (0-255); which attempt in the chain
, recorded_at        timestamptz  not null default now()
  -- §D Ledger Normalize: budget attribution = the cap-bearing unit. LN-3c-2b DROPPED budget_node_id +
  -- the 4 GH-5 *_node_id denorm cols (org/dept/team/user_node_id) — the P12 reversal: analytics
  -- spend-by-tier now walks the org tree via core.org_unit_ancestor_at_level instead of the denorm.
, org_unit_id        uuid
, execution_location core.execution_location                       -- {local,cloud} enum (nullable)
, hold_id            uuid
, primary key (tenant_id, id)
  -- §D Ledger Normalize LN-3a: sessions retired → the composite FK is gone. session_id/project_id
  -- remain vestigial (bare uuids) until the LN-3b reshape drops them (→ conversation_id).
, foreign key (tenant_id, org_unit_id)
    references core.org_units(tenant_id, id) on delete set null   -- never cascade-delete billing history
  -- §D LN-3b: FK-normalized routing identity → catalog (global, not tenant-scoped). ON DELETE SET NULL so
  -- retiring a catalog endpoint/model/router leaves the free-text snapshot as the surviving record.
, foreign key (endpoint_id) references catalog.model_endpoints(id) on delete set null
, foreign key (model_id)    references catalog.models(id)          on delete set null
, foreign key (router_id)   references catalog.routers(id)         on delete set null
);

create index if not exists idx_inference_calls_model_id
  on inference_calls(tenant_id, model_id)
  where model_id is not null;

create index if not exists idx_inference_calls_router_id
  on inference_calls(tenant_id, router_id)
  where router_id is not null;

create index if not exists idx_inference_calls_recorded
  on inference_calls(tenant_id, recorded_at desc);

create index if not exists idx_inference_calls_model
  on inference_calls(tenant_id, model);

create index if not exists idx_inference_calls_org_unit
  on inference_calls(tenant_id, org_unit_id)
  where org_unit_id is not null;

create index if not exists idx_inference_calls_session
  on inference_calls(tenant_id, session_id)
  where session_id is not null;

comment on table inference_calls is
'Append-only ledger of every model inference routed through the gateway.
- Matches GatewayStore::InferenceCall exactly (gateway crate, store.rs).
- tenant_id + id form the composite PK; tenant_id is the partition key.
- capability stores the Capability enum variant in snake_case (text_chat, image_generate, …).
- status stores CallStatus: ''success'' | ''failed'' (snake_case serde).
- cost_usd is numeric(12,6) — f64 is converted on INSERT by the gateway store impl.
- duration_ms is bigint (Rust u64) to handle pathological long calls without overflow.
- fallback_sequence (u8) indicates which position in the fallback chain succeeded.
- session_id composite FK is NULL-safe; project_id has no FK until a projects table lands.
- RW7 columns (budget attribution + execution_location + hold_id) are declared inline above.
- Written by service_role (bypasses RLS); clients SELECT via RLS (tenant_isolation.sql).';
