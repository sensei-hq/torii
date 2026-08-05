-- database/ddl/table/metering/execution_traces.ddl
set search_path to metering, core, extensions;  -- §D Phase 6: moved public→metering (inference_calls FK now intra-metering)

create table if not exists execution_traces (
  tenant_id           uuid        not null
    references core.tenants(id) on delete cascade
, id                  uuid        not null default gen_random_uuid()
, inference_call_id   uuid                                            -- nullable; Option<Uuid> in StoredTrace
, trace               jsonb       not null                            -- full ExecutionTrace struct (nested; JSONB)
, recorded_at         timestamptz not null default now()
, primary key (tenant_id, id)
, constraint execution_traces_call_fkey
    foreign key (tenant_id, inference_call_id)
    references inference_calls(tenant_id, id) on delete cascade       -- NULL-safe composite FK
);

create index if not exists idx_execution_traces_call
  on execution_traces(tenant_id, inference_call_id)
  where inference_call_id is not null;

create index if not exists idx_execution_traces_recorded
  on execution_traces(tenant_id, recorded_at desc);

create index if not exists idx_execution_traces_trace_gin
  on execution_traces using gin(trace);                               -- enables jsonb path/key queries

comment on table execution_traces is
'One execution trace per gateway routing attempt; linked to an inference_calls row.
- Matches GatewayStore::StoredTrace exactly (gateway crate, store.rs).
- tenant_id + id form the composite PK; tenant_id is the partition key.
- inference_call_id is nullable (Option<Uuid>): a trace may exist before the call row is
  committed, or for diagnostic traces not tied to a billed call.
- trace (jsonb) stores the full ExecutionTrace struct: request_id, capability, status,
  duration_ms, candidates[], skipped[], attempts[], estimated_cost, actual_cost, created_at.
  JSONB is used because ExecutionTrace contains nested arrays (candidates, attempts, skipped)
  that would require many join tables for marginal query benefit.
- GIN index on trace enables efficient jsonb containment queries (e.g. find all traces
  where a specific model was attempted).
- Written by service_role (bypasses RLS); clients SELECT via RLS (tenant_isolation.sql).';
