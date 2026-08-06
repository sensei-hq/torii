-- database/ddl/table/metering/quality_signals.ddl
set search_path to metering, core, extensions;
-- RW15/RW8 (C6 §3.1) + §D Ledger Normalize (§7-#6): MACHINE-written quality signals (implicit/system).
-- User-written EXPLICIT feedback split out to metering.feedback (§7-#4). The old polymorphic target
-- ("inference_call_id OR message_id OR source LIKE 'c5.%'") is replaced by a TYPED discriminant
-- subject_type (metering.signal_subject) + a CHECK enforcing exactly one target per type — with 'event'
-- covering C5 doc/space-event signals (no call/message/conversation; target in value_json). Moved
-- public→metering. Service_role-write (via the C6/RAG paths + the fanout trigger reads it).
create table if not exists quality_signals (
  tenant_id         uuid        not null references core.tenants(id) on delete cascade
, id                uuid        not null default gen_random_uuid()
, subject_type      metering.signal_subject not null
, inference_call_id uuid                          -- subject_type='call'
, message_id        uuid                          -- subject_type='message' (content)
, conversation_id   uuid                          -- subject_type='conversation'
, signal_key        varchar(60) not null
, signal_class      metering.signal_class not null
, value_num         numeric(12,6)
, value_text        text
, value_json        jsonb                         -- subject_type='event' target (document_id/space_id) lives here
, unit              varchar(24)
, source            varchar(40)
, actor_id          uuid
, schema_version    integer     not null default 1
, created_at        timestamptz not null default now()
, primary key (tenant_id, id)
, constraint quality_signals_subject_one check (
     (subject_type = 'call'         and inference_call_id is not null and message_id is null and conversation_id is null)
  or (subject_type = 'message'      and message_id is not null and inference_call_id is null and conversation_id is null)
  or (subject_type = 'conversation' and conversation_id is not null and inference_call_id is null and message_id is null)
  or (subject_type = 'event'        and inference_call_id is null and message_id is null and conversation_id is null))
);
create index if not exists idx_quality_signals_call on quality_signals(tenant_id, inference_call_id);
create index if not exists idx_quality_signals_msg  on quality_signals(tenant_id, message_id);

comment on table quality_signals is
'RW15 (C6) + §D Ledger Normalize (§7-#6): machine-written implicit/system quality signals (user
feedback split to metering.feedback). Typed subject (subject_type + exactly-one-per-type; event target
in value_json). Moved public→metering. Service_role-write; rollups union quality_signals + feedback.';
