-- database/ddl/table/public/messages.ddl
set search_path to public, core, content, extensions;

-- RW5: turns within an Ask conversation.
create table if not exists messages (
  tenant_id          uuid        not null references core.tenants(id) on delete cascade
, id                 uuid        not null default gen_random_uuid()
, conversation_id    uuid        not null
, role               content.message_role not null
, content            text        not null
, model              text
, tier               text
, cost_usd           numeric(12,6)
, execution_location core.execution_location                             -- {local,cloud} enum (nullable)
, created_at         timestamptz not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, conversation_id) references conversations(tenant_id, id) on delete cascade
);

create index if not exists idx_messages_conversation on messages(tenant_id, conversation_id, created_at);

comment on table messages is
'RW5: Ask turns (user/assistant). Assistant turns carry model/tier/cost/plane;
citations in message_citations. Access inherits the parent conversation.';
