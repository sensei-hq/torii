set search_path to public, extensions;

-- O2 §4.3 — refresh the analytics materialized views. CONCURRENTLY (needs the A1 unique
-- indexes) so dashboard reads never block on a refresh. Called on-demand by the Overview
-- load (A5) and intended to run on a short schedule (~60s). NB: pg_cron is available on
-- this project but not enabled (needs shared_preload_libraries); until it is, scheduling
-- is an operational step — the on-demand call keeps the Overview fresh. Reconcile
-- (analytics_rollup_reconcile) is the periodic drift-correction pass, scheduled likewise.
create or replace function public.analytics_refresh_mviews()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  refresh materialized view concurrently public.analytics_model_mix_daily;
  refresh materialized view concurrently public.analytics_overview_current;
end;
$$;

revoke execute on function public.analytics_refresh_mviews() from public;
grant  execute on function public.analytics_refresh_mviews() to service_role;

comment on function public.analytics_refresh_mviews is
'O2 §4.3: REFRESH MATERIALIZED VIEW CONCURRENTLY for the analytics MVs (unique index
required). On-demand (Overview load) + intended ~60s schedule. service_role only.';
