-- RLS · knowledge confidentiality (documents + embeddings)
-- Replaces the generic tenant policy on documents/document_embeddings with
-- classification + space-membership aware access. service_role bypasses RLS.
-- Idempotent (drop+create).

-- documents:
--   public / internal  → any tenant member
--   confidential        → document owner or a member of the document's space
--   restricted          → document owner or the space owner (named owners)
alter table public.documents enable row level security;
drop policy if exists documents_tenant on public.documents;
drop policy if exists documents_access on public.documents;
create policy documents_access on public.documents for all to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and (
      classification in ('public', 'internal')
      or profile_id = auth.uid()
      or (classification = 'confidential' and space_id is not null and exists (
            select 1 from public.space_members sm
            where sm.tenant_id  = documents.tenant_id
              and sm.space_id   = documents.space_id
              and sm.profile_id = auth.uid()))
      or (classification = 'restricted' and space_id is not null and exists (
            select 1 from public.spaces s
            where s.tenant_id = documents.tenant_id
              and s.id        = documents.space_id
              and s.owner_id  = auth.uid()))
    )
  )
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- document_embeddings inherit document access: the documents subquery is itself
-- RLS-filtered for the caller, so an embedding is visible only when its document is.
alter table public.document_embeddings enable row level security;
drop policy if exists document_embeddings_tenant on public.document_embeddings;
drop policy if exists document_embeddings_access on public.document_embeddings;
create policy document_embeddings_access on public.document_embeddings for all to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and exists (
      select 1 from public.documents d
      where d.tenant_id = document_embeddings.tenant_id
        and d.id        = document_embeddings.document_id
    )
  )
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- document_versions / document_assets inherit parent document access (same pattern).
alter table public.document_versions enable row level security;
drop policy if exists document_versions_access on public.document_versions;
create policy document_versions_access on public.document_versions for all to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and exists (select 1 from public.documents d
                where d.tenant_id = document_versions.tenant_id and d.id = document_versions.document_id)
  )
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

alter table public.document_assets enable row level security;
drop policy if exists document_assets_access on public.document_assets;
create policy document_assets_access on public.document_assets for all to authenticated
  using (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    and exists (select 1 from public.documents d
                where d.tenant_id = document_assets.tenant_id and d.id = document_assets.document_id)
  )
  with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
