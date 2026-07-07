-- database/ddl/table/public/inference_calls.ddl
set search_path to public, core, extensions;

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
, status             varchar(20)  not null
    check (status in ('success', 'failed'))                           -- CallStatus (snake_case serde)
, error_type         text                                              -- nullable; Option<String>
, fallback_sequence  smallint     not null default 0                  -- u8 (0-255); which attempt in the chain
, recorded_at        timestamptz  not null default now()
, primary key (tenant_id, id)
, constraint inference_calls_session_fkey
    foreign key (tenant_id, session_id)
    references sessions(tenant_id, id) on delete set null             -- NULL-safe composite FK
);

create index if not exists idx_inference_calls_recorded
  on inference_calls(tenant_id, recorded_at desc);

create index if not exists idx_inference_calls_model
  on inference_calls(tenant_id, model);

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
- Written by service_role (bypasses RLS); clients SELECT via RLS (tenant_isolation.sql).';
