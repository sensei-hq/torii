-- database/ddl/table/public/conversations.ddl
set search_path to public, core, extensions;

-- RW5: Ask threads (replaces the dropped curator_conversations). Owner-scoped.
create table if not exists conversations (
  tenant_id    uuid        not null references core.tenants(id) on delete cascade
, id           uuid        not null default gen_random_uuid()
, owner_id     uuid        not null                 -- auth.uid()
, space_id     uuid
, title        varchar(300)
, created_at   timestamptz not null default now()
, modified_at  timestamptz not null default now()
, primary key (tenant_id, id)
);

create index if not exists idx_conversations_owner on conversations(tenant_id, owner_id);

comment on table conversations is
'RW5: Ask conversation threads (owner-scoped self-write). Members read/write their
own; C1 persists turns via service_role.';
