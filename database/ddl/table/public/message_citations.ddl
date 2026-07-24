-- database/ddl/table/public/message_citations.ddl
set search_path to public, core, extensions;

-- RW5: grounding citations on an assistant message → document chunk + score.
create table if not exists message_citations (
  tenant_id    uuid          not null references core.tenants(id) on delete cascade
, id           uuid          not null default gen_random_uuid()
, message_id   uuid          not null
, document_id  uuid
, chunk_id     uuid
, score        numeric(6,4)
, primary key (tenant_id, id)
, foreign key (tenant_id, message_id) references messages(tenant_id, id) on delete cascade
);

create index if not exists idx_message_citations_message on message_citations(tenant_id, message_id);

comment on table message_citations is
'RW5: citation links (message → document/chunk + score) for grounded Ask answers.';
