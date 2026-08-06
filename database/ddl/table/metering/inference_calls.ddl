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
, input_tokens       integer                                           -- nullable; Option<u32>
, output_tokens      integer                                           -- nullable; Option<u32>
, cost_usd           numeric(12,6) not null default 0                 -- f64 mapped to numeric for precision
, duration_ms        bigint       not null                             -- u64; bigint avoids overflow for long calls
, status             metering.call_status not null                     -- CallStatus {success,failed}
, error_type         text                                              -- nullable; Option<String>
, fallback_sequence  smallint     not null default 0                  -- u8 (0-255); which attempt in the chain
, recorded_at        timestamptz  not null default now()
  -- RW7: budget attribution + split-plane columns on the authoritative ledger.
, budget_node_id     uuid
, org_node_id        uuid
, dept_node_id       uuid
, team_node_id       uuid
, user_node_id       uuid
  -- §D Ledger Normalize LN-3c: the cap-bearing unit (== budget_node_id under P5 DC-1). Added additively;
  -- LN-3c-2 migrates the analytics/rollup reads to it, reverses the P12 denorm (spend walks the org
  -- tree), then drops budget_node_id + the 4 *_node_id denorm cols.
, org_unit_id        uuid
, execution_location core.execution_location                       -- {local,cloud} enum (nullable)
, hold_id            uuid
, primary key (tenant_id, id)
  -- §D Ledger Normalize LN-3a: sessions retired → the composite FK is gone. session_id/project_id
  -- remain vestigial (bare uuids) until the LN-3b reshape drops them (→ conversation_id).
, foreign key (tenant_id, org_unit_id)
    references core.org_units(tenant_id, id) on delete set null   -- never cascade-delete billing history
);

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
