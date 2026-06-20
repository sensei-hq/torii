-- database/ddl/table/public/spaces.ddl
set search_path to public, core, extensions;

create table if not exists spaces (
  tenant_id      uuid    not null
    references core.tenants(id) on delete cascade
, id             uuid    not null default gen_random_uuid()
, name           varchar(200) not null
, description    text
, classification varchar(20) not null default 'confidential'
    check (classification in ('public', 'internal', 'confidential', 'restricted'))
, owner_id       uuid
, created_at     timestamptz not null default now()
, modified_at    timestamptz not null default now()
, modified_by    varchar     not null
, primary key (tenant_id, id)
);

create index if not exists idx_spaces_owner on spaces(tenant_id, owner_id);

comment on table spaces is
'Shared document containers (the mockup "spaces"). A space groups documents and
has its own default confidentiality classification + owner.
- classification: default for documents placed here (public/internal/confidential/restricted)
- owner_id: profile that owns/administers the space
- membership lives in space_members; document access is enforced in policies/knowledge.sql';
