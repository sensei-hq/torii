set search_path to public, core, extensions;

-- §3c (DECISIONS): "the model sees structure, not values." Returns ONLY the
-- column schema of a dataset — name, type, sensitivity, and whether the column is
-- field-encrypted — never any row value. This is what the LLM receives to emit a
-- computation plan; the gateway executes the plan in the trusted boundary and
-- returns policy-gated aggregates. Sensitive columns MUST be encrypted at rest.
create or replace function public.dataset_safe_schema(
  p_tenant  uuid,
  p_dataset uuid
) returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name',        c.name,
           'type',        c.data_type,
           'sensitivity', c.sensitivity,
           'encrypted',   c.encrypted
         ) order by c.name), '[]'::jsonb)
    from public.dataset_columns c
   where c.tenant_id = p_tenant and c.dataset_id = p_dataset;
$$;

revoke execute on function public.dataset_safe_schema(uuid, uuid) from public;
grant execute on function public.dataset_safe_schema(uuid, uuid) to authenticated;
grant execute on function public.dataset_safe_schema(uuid, uuid) to service_role;

-- §3c: a grouping result may only be returned if every group meets the
-- k-anonymity floor (no small group can re-identify a subject). Enforced before
-- any aggregate leaves the boundary.
create or replace function public.k_anon_ok(p_group_counts bigint[], p_k int default 5)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(cnt >= p_k), true) from unnest(p_group_counts) as cnt;
$$;

comment on function public.dataset_safe_schema is
'§3c: dataset column schema (name/type/sensitivity/encrypted) with NO values —
what the LLM sees for plan generation. Compute runs in the trusted boundary.';
comment on function public.k_anon_ok is
'§3c: true iff every group count meets the k-anonymity floor (default 5).';
