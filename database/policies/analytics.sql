-- RLS · O2 analytics rollup lockdown (spec §5).
-- Rollup TABLES: tenant-scoped SELECT for `authenticated`; every write is
-- service_role (the refresh functions) — INSERT/UPDATE/DELETE revoked. Belt-and-
-- suspenders: even a mis-granted write is denied by the SELECT-only RLS policy.
-- Materialized VIEWS cannot carry RLS in Postgres, so granting them to
-- `authenticated` would leak cross-tenant rows — they are revoked entirely and
-- read only through the gateway as service_role (tenant-scoped in the query).
-- service_role bypasses RLS. Idempotent (drop+create). Applied via `dbd policies`.

-- (1) Rollup tables — RLS + tenant SELECT; writes revoked.
do $$
declare r record;
begin
  for r in select unnest(array['analytics_usage_daily','analytics_quality_daily']) as tbl
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_read', r.tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (tenant_id = (auth.jwt() ->> %L)::uuid)',
      r.tbl || '_read', r.tbl, 'tenant_id');
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', r.tbl);
  end loop;
end $$;

-- (2) Materialized views — no RLS available → no client read at all (service_role only).
do $$
declare r record;
begin
  for r in select unnest(array['analytics_model_mix_daily','analytics_overview_current']) as mv
  loop
    execute format('revoke all on public.%I from authenticated, anon', r.mv);
  end loop;
end $$;
