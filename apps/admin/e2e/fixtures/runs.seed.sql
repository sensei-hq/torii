-- apps/admin/e2e/fixtures/runs.seed.sql
--
-- The Runs screens read a ledger, so their e2e spec needs a ledger with a shape it can assert
-- on: lifecycle states to filter to, a spend per run, calls with routing traces to expand, and
-- enough rows to page through. Nothing in the dev DB has any of that (a fresh `supabase start`
-- has zero inference calls), and driving 62 real runs through the orchestrator to get it would
-- take longer than the whole suite.
--
-- So this seeds the tenant the e2e signs into (resolved from the owner's membership, never a
-- hard-coded uuid — the fixture follows whatever seed helpers.ts points at). Every row it writes
-- is identifiable by run id, and runs.teardown.sql removes exactly those, so the dev tenant is
-- left as it was found.
--
--   rich runs   c0000001..c0000006   the six states the UI has something to say about
--   filler runs d0000000-…-000000000001..056   56 older completed runs, for paging
--
-- Reference data the screens show for the rich runs:
--   c0000001  completed, 2 calls ($0.009, one failed), booked $0.000 of $2.000 → "unbooked".
--             Its served call is the run's DECISION call, whose trace carries both halves of
--             "why this model": the order it was handed under a MEASURED ranking for
--             `planner.select` (artifact revision 7, one ref no candidate could answer) and the
--             two candidates the pipeline withheld, each with its gate's own reason. Those two
--             are what the run detail's ranking and filtered-out blocks read.
--   c0000002  failed   with a reason, 1 call whose trace has 2 failed attempts
--   c0000003  paused   with a reason, no calls
--   c0000004  no schedule row (charge-only) — "No schedule"
--   c0000005  cancelled, no calls
--   c0000006  waking,    no calls
\set ON_ERROR_STOP on

\ir runs.teardown.sql

-- The tenant + its onboarding root unit + the signing-in profile, resolved once so every
-- statement below agrees about which workspace this is.
create temporary table _ctx as
select m.tenant_id as tenant,
       m.profile_id as issuer,
       :'email' as email,
       (select ou.id
          from core.org_units ou
         where ou.tenant_id = m.tenant_id
         order by ou.level, ou.id
         limit 1) as node
  from core.memberships m
  join auth.users u on u.id = m.profile_id
 where u.email = :'email' and m.active
 order by m.assigned_at
 limit 1;

-- Fail loudly when the email resolved to nothing: without this, every insert below would
-- quietly write zero rows and the spec would fail later with a misleading "no runs yet".
-- (The email itself is read back out of `_ctx`: psql does not interpolate `:'email'` inside a
-- dollar-quoted block, so it cannot be named here directly.)
do $seed$
declare who text;
begin
  select email into who from _ctx;
  if who is null then
    raise exception 'runs.seed: no active membership for the configured e2e owner (TORII_E2E_EMAIL) — seed the dev database first';
  end if;
  raise notice 'runs.seed: seeding runs for %', who;
end
$seed$;

-- ── rich runs: one per state the list can filter to ─────────────────────────────
create temporary table _rich (
  run_id            uuid,
  minutes_ago       int,
  status            runs.run_status,
  reason            text,
  limit_micro_usd   bigint,
  recorded_micro_usd bigint,
  settled           boolean
);

insert into _rich values
  ('c0000001-0000-4000-8000-000000000001', 1, 'completed', null,      2000000,       0, false),
  ('c0000002-0000-4000-8000-000000000002', 2, 'failed',
   'expand plan paused: provider returned 429 for every candidate in chain ''chat''', 1000000, 4000, true),
  ('c0000003-0000-4000-8000-000000000003', 3, 'paused',
   'budget: only 196 tokens left for output after the input estimate, below the 256-token floor', 500000, 0, false),
  ('c0000004-0000-4000-8000-000000000004', 4, null,     null,                0,       0, false),
  ('c0000005-0000-4000-8000-000000000005', 5, 'cancelled', null,          750000,    1500, true),
  ('c0000006-0000-4000-8000-000000000006', 6, 'waking', null,            3000000,       0, false);

insert into runs.runs (tenant_id, run_id, format_version, created_at)
select (select tenant from _ctx), r.run_id, 1, now() - make_interval(mins => r.minutes_ago)
  from _rich r;

-- the driver's lifecycle row — absent for c0000004 on purpose: a charge is legible before it.
insert into runs.scheduled_runs (tenant_id, run_id, graph, status, reason, updated_at)
select (select tenant from _ctx), r.run_id, '{}'::jsonb, r.status, r.reason,
       now() - make_interval(mins => r.minutes_ago)
  from _rich r
 where r.status is not null;

-- Anchored on the charge, like the read is: a run exists here from admission. node_ids is the
-- tenant's root unit, so the screens show a named charged unit rather than "no charged unit".
insert into runs.run_charges
  (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, recorded_micro_usd,
   settled, created_at)
select (select tenant from _ctx), r.run_id, (select issuer from _ctx),
       coalesce((select array_agg(node) from _ctx where node is not null), '{}'::uuid[]),
       r.limit_micro_usd, r.recorded_micro_usd, r.settled,
       now() - make_interval(mins => r.minutes_ago)
  from _rich r;

-- ── calls, with the routing traces the run detail expands ───────────────────────
-- c0000001: a served decision call that fell back once (2 attempts, the newest row on the
-- screen) and a failed one below it, which has no trace — the screen's "no trace recorded" case.
-- A run's decision call rather than a chat one because a MEASURED ranking is a claim about a
-- decision order: `dispatch::routing_for` maps the executor's measured `ChoiceOrder` into
-- `RoutingPreferences::ranking`, and only that mapping carries a category and an artifact revision.
insert into metering.inference_calls
  (tenant_id, id, capability, chain_id, adapter, model, api_model_id, input_tokens, output_tokens,
   cost_actual, duration_ms, status, fallback_sequence, recorded_at, execution_location, run_id,
   org_unit_id)
values
  ((select tenant from _ctx), 'c1000001-0000-4000-8000-000000000001', 'decision', 'decide',
   'anthropic', 'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929', 1180, 402, 0.009, 1750,
   'success'::metering.call_status, 2, now() - interval '25 seconds', 'cloud'::core.execution_location,
   'c0000001-0000-4000-8000-000000000001', (select node from _ctx)),
  ((select tenant from _ctx), 'c1000001-0000-4000-8000-000000000002', 'text_chat', 'chat',
   'openai', 'gpt-4o-mini', 'gpt-4o-mini', 640, null, 0, 240,
   'failed'::metering.call_status, 1, now() - interval '40 seconds', 'cloud'::core.execution_location,
   'c0000001-0000-4000-8000-000000000001', (select node from _ctx)),
  -- c0000002: the failed run's one call, whose whole chain failed.
  ((select tenant from _ctx), 'c1000002-0000-4000-8000-000000000001', 'decision', 'chat',
   'openai', 'gpt-4o-mini', 'gpt-4o-mini', 900, null, 0, 610,
   'failed'::metering.call_status, 2, now() - interval '110 seconds', 'cloud'::core.execution_location,
   'c0000002-0000-4000-8000-000000000002', (select node from _ctx));

insert into metering.execution_traces (tenant_id, inference_call_id, trace, recorded_at)
values
  -- served: openai 429 first, anthropic answered. The "why this model" chain, plus the ranking it
  -- was ordered under and the two models that were filtered out before it got a chance. The
  -- ordering, the skipped reasons and the ranking shape (category, artifact + revision, matched,
  -- unmatched) are the engine's own: `engine/execute.rs::build_trace` (§9.6).
  ((select tenant from _ctx), 'c1000001-0000-4000-8000-000000000001',
   jsonb_build_object(
     'request_id', 'c1000001-0000-4000-8000-000000000001',
     'capability', 'decision',
     'status', 'success',
     'duration_ms', 1990,
     'candidates', jsonb_build_array(
       jsonb_build_object('model', 'gpt-4o-mini', 'router', 'openai', 'priority', 0),
       jsonb_build_object('model', 'claude-sonnet-4-5', 'router', 'anthropic', 'priority', 1)),
     'skipped', jsonb_build_array(
       jsonb_build_object('model', 'qwen3:8b', 'router', 'ollama',
                          'reason', 'estimated 12000 input tokens exceeds the model''s 8192-token context window'),
       jsonb_build_object('model', 'grok-4-fast', 'router', 'grok',
                          'reason', 'router cooling down')),
     'attempts', jsonb_build_array(
       jsonb_build_object('sequence', 1, 'adapter', 'openai', 'model', 'gpt-4o-mini',
                          'api_model_id', 'gpt-4o-mini', 'status', 'failed', 'duration_ms', 240,
                          'error', 'upstream 429: rate limited', 'fallback_triggered', true),
       jsonb_build_object('sequence', 2, 'adapter', 'anthropic', 'model', 'claude-sonnet-4-5',
                          'api_model_id', 'claude-sonnet-4-5-20250929', 'status', 'success',
                          'duration_ms', 1750, 'fallback_triggered', false)),
     'routing', jsonb_build_object(
       'strategy', 'grouped_weighted',
       'degraded', false,
       'order', jsonb_build_array(
         jsonb_build_object('endpoint', 'openai:gpt-4o-mini', 'priority', 0,
                            'cost', 0.0003, 'reliability', 0.98, 'weight', 4.2),
         jsonb_build_object('endpoint', 'anthropic:claude-sonnet-4-5', 'priority', 1,
                            'cost', 0.009, 'reliability', null, 'weight', null)),
       'ranking', jsonb_build_object(
         'category', 'planner.select',
         'source', jsonb_build_object('artifact', 'torii:catalog.model_rankings', 'revision', 7),
         'matched', 2,
         'unmatched', jsonb_build_array('ollama:qwen3:8b'))),
     'created_at', now() - interval '25 seconds'),
   now() - interval '25 seconds'),
  -- failed: every candidate refused it.
  ((select tenant from _ctx), 'c1000002-0000-4000-8000-000000000001',
   jsonb_build_object(
     'request_id', 'c1000002-0000-4000-8000-000000000001',
     'capability', 'decision',
     'status', 'failed',
     'duration_ms', 610,
     'candidates', '[]'::jsonb,
     'skipped', '[]'::jsonb,
     'attempts', jsonb_build_array(
       jsonb_build_object('sequence', 1, 'adapter', 'openai', 'model', 'gpt-4o-mini',
                          'api_model_id', 'gpt-4o-mini', 'status', 'failed', 'duration_ms', 300,
                          'error', 'upstream 429: rate limited', 'fallback_triggered', true),
       jsonb_build_object('sequence', 2, 'adapter', 'anthropic', 'model', 'claude-sonnet-4-5',
                          'api_model_id', 'claude-sonnet-4-5-20250929', 'status', 'failed',
                          'duration_ms', 310, 'error', 'upstream 500: internal error',
                          'fallback_triggered', false)),
     'created_at', now() - interval '110 seconds'),
   now() - interval '110 seconds');

-- ── filler runs: older than every rich run, for the "Older runs" walk-back ──────
-- 62 runs in total against a 50-run page, so the first page fills and older runs are real.
insert into runs.runs (tenant_id, run_id, format_version, created_at)
select (select tenant from _ctx),
       ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       1,
       now() - make_interval(mins => 60 + n)
  from generate_series(1, 56) as n;

insert into runs.scheduled_runs (tenant_id, run_id, graph, status, updated_at)
select (select tenant from _ctx),
       ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       '{}'::jsonb, 'completed'::runs.run_status, now() - make_interval(mins => 60 + n)
  from generate_series(1, 56) as n;

insert into runs.run_charges
  (tenant_id, run_id, issuer_profile_id, node_ids, limit_micro_usd, recorded_micro_usd, settled,
   created_at)
select (select tenant from _ctx),
       ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (select issuer from _ctx),
       coalesce((select array_agg(node) from _ctx where node is not null), '{}'::uuid[]),
       500000, 5000, true,
       now() - make_interval(mins => 60 + n)
  from generate_series(1, 56) as n;
