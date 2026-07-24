-- RLS · knowledge confidentiality (documents + gateway-produced derivatives)
-- RW1/RW9: doc access = space membership + fixed 4-level classification (group-ACL
-- retired). READ is classification-aware; WRITE on documents is OWNER-only, and a
-- trigger blocks any classification change by a non-service_role caller (declassify
-- is a gateway capability, doc.declassify). Embeddings/versions/assets are
-- gateway-produced → SELECT-only for authenticated (service_role writes).
-- service_role bypasses RLS. Idempotent.

-- documents — READ (classification/space aware):
--   public / internal → any tenant member
--   confidential       → owner or a member of the doc's space
--   restricted         → owner or the space owner
alter table public.documents enable row level security;
drop policy if exists documents_tenant on public.documents;
drop policy if exists documents_access on public.documents;
drop policy if exists documents_read on public.documents;
drop policy if exists documents_write on public.documents;

create policy documents_read on public.documents for select to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and (
      classification in ('public', 'internal')
      or profile_id = auth.uid()
      or (classification = 'confidential' and space_id is not null and exists (
            select 1 from public.space_members sm
            where sm.tenant_id = documents.tenant_id
              and sm.space_id  = documents.space_id
              and sm.profile_id = auth.uid()))
      or (classification = 'restricted' and space_id is not null and exists (
            select 1 from public.spaces s
            where s.tenant_id = documents.tenant_id
              and s.id        = documents.space_id
              and s.owner_id  = auth.uid()))
    )
  );

-- documents — WRITE (owner-only, within tenant). Classification changes are
-- rejected for authenticated by the trigger below (declassify → gateway).
create policy documents_write on public.documents for all to authenticated
  using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and profile_id = auth.uid())
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid and profile_id = auth.uid());

-- Classification-change guard: only service_role (the gateway, enforcing
-- doc.declassify) may alter documents.classification.
create or replace function public.guard_document_classification()
returns trigger language plpgsql as $$
begin
  if new.classification is distinct from old.classification
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'classification changes must go through the gateway (doc.declassify)';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_document_classification on public.documents;
create trigger trg_guard_document_classification
  before update on public.documents
  for each row execute function public.guard_document_classification();

-- Gateway-produced derivatives — SELECT-only (inherit parent-document read).
-- Writes are service_role (grants.sql revokes DML from authenticated). RW1.
do $$
declare r record;
begin
  for r in select * from (values
    ('document_embeddings'),
    ('document_versions'),
    ('document_assets')
  ) as x(tbl)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_access', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_read', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (tenant_id = (auth.jwt() ->> %L)::uuid and exists ('
      || '  select 1 from public.documents d '
      || '  where d.tenant_id = public.%I.tenant_id and d.id = public.%I.document_id))',
      r.tbl || '_read', r.tbl, 'tenant_id', r.tbl, r.tbl
    );
  end loop;
end $$;
