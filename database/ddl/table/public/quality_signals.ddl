-- database/ddl/table/public/quality_signals.ddl
set search_path to public, core, metering, extensions;
-- RW15/RW8 (C6 §3.1): explicit + implicit quality signals keyed to a call or message.
create table if not exists quality_signals (
  tenant_id         uuid        not null references core.tenants(id) on delete cascade
, id                uuid        not null default gen_random_uuid()
, inference_call_id uuid
, message_id        uuid
, conversation_id   uuid
, signal_key        varchar(60) not null
, signal_class      metering.signal_class not null
, value_num         numeric(12,6)
, value_text        text
, value_json        jsonb
, unit              varchar(24)
, source            varchar(40)
, actor_id          uuid
, schema_version    integer     not null default 1
, created_at        timestamptz not null default now()
, primary key (tenant_id, id)
, constraint quality_signals_target check (inference_call_id is not null or message_id is not null)
);
create index if not exists idx_quality_signals_call on quality_signals(tenant_id, inference_call_id);
create index if not exists idx_quality_signals_msg  on quality_signals(tenant_id, message_id);
comment on table quality_signals is 'RW15 (C6): quality/interaction signals → O1 audit + O2 analytics + live meters. Service_role-write.';

-- C5 (2026-08-01): admit C5 EVENT-level signals (a retrieval op, an ingest redaction batch) that are
-- keyed to a document/space event rather than a single inference_call or message — their target lives
-- in value_json (e.g. {document_id}/{space_id}). Ledger-keying C5 signals to the query-embed
-- inference_call is a GH-5 follow-up; until then non-C5 signals STILL must reference a call/message.
alter table quality_signals drop constraint if exists quality_signals_target;
alter table quality_signals add constraint quality_signals_target
  check (inference_call_id is not null or message_id is not null or source like 'c5.%');
