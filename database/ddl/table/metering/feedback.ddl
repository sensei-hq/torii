-- database/ddl/table/metering/feedback.ddl
set search_path to metering, core, extensions;

-- §D Ledger Normalize (§7-#4): user-written EXPLICIT interaction signals, split OUT of quality_signals
-- (which stays machine-written implicit/system). The interaction-intelligence loop (C6 §3b) needs the
-- END USER to write these — so this is **owner-INSERT** (RLS with check actor_id = auth.uid()), the one
-- posture the over-merged blanket service_role-write quality_signals couldn't offer. Typed subject
-- (subject_type + exactly-one-per-type, mirroring quality_signals §7-#6): 'event' = a doc/space event
-- (target in json context), no call/message/conversation. Rollups UNION feedback + quality_signals.
create table if not exists feedback (
  tenant_id         uuid        not null references core.tenants(id) on delete cascade
, id                uuid        not null default gen_random_uuid()
, subject_type      metering.signal_subject not null
, inference_call_id uuid                        -- subject_type='call'  (bare uuid, like quality_signals)
, message_id        uuid                        -- subject_type='message' (content, not built)
, conversation_id   uuid                        -- subject_type='conversation'
, actor_id          uuid        not null        -- the writing user (= auth.uid(), enforced by RLS with-check)
, kind              varchar(24) not null        -- thumb_up | thumb_down | rating | edit | accept
, value             numeric(12,6)               -- rating score / edit distance / etc. (nullable)
, created_at        timestamptz not null default now()
, primary key (tenant_id, id)
, constraint feedback_subject_one check (
     (subject_type = 'call'         and inference_call_id is not null and message_id is null and conversation_id is null)
  or (subject_type = 'message'      and message_id is not null and inference_call_id is null and conversation_id is null)
  or (subject_type = 'conversation' and conversation_id is not null and inference_call_id is null and message_id is null)
  or (subject_type = 'event'        and inference_call_id is null and message_id is null and conversation_id is null))
);

create index if not exists idx_feedback_call  on feedback(tenant_id, inference_call_id);
create index if not exists idx_feedback_actor on feedback(tenant_id, actor_id);

comment on table feedback is
'§D Ledger Normalize (§7-#4): user-written explicit feedback (thumb/rating/edit/accept), split out of
quality_signals. Typed subject (subject_type + exactly-one-per-type; event target in json). Owner-INSERT
(actor_id = auth.uid()) + tenant SELECT, no U/D. Rollups union feedback + quality_signals.';
