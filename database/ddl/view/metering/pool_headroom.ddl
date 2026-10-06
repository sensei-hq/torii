-- database/ddl/view/metering/pool_headroom.ddl
set search_path to metering, catalog, core, extensions;

-- G3: how much of each free-tier allowance is left in the CURRENT reset window.
--
-- This is the read the gateway's deferred features need: `headroom` / `least_used` intra-tier
-- ordering (today they stub to `priority` with a warn!), usage metering, and predicted
-- lockout. It is deliberately DERIVED from metering.usage_daily rather than kept as a second
-- set of counters — usage_daily is already the reconstructable rollup, and a parallel counter
-- table would need reconciling against it.
--
-- Three rules, each of which silently produces a plausible-but-wrong number if inverted:
--
--  1. ALLOWANCE IS PER POOL, COUNTED ONCE. Models sharing `free_pool_key` draw on ONE
--     allowance, so this takes max() within the pool rather than sum() across its members —
--     two 60M models on one pool grant 60M, not 120M.
--
--  2. USAGE IS WINDOWED. A recurring tier resets; counting all-time usage shows a tier as
--     exhausted forever after first use, so routing avoids a model that is free again.
--     Window start comes from free_type: daily → today, monthly → the 1st. Credit-style
--     tiers (`recurring_credit`, `one_time_initial`) are balances that never reset, so their
--     window opens at -infinity and their usage is cumulative — correct, not a special case.
--
--  3. UNCAPPED MEANS NULL, NOT ZERO. `recurring_uncapped` and `keyless` have no finite
--     allowance. Reporting 0 would read as "exhausted" and route traffic AWAY from a model
--     that is free and available — the exact inverse of the truth. `discontinued` is excluded
--     outright: it grants nothing and is not a headroom question.
--
-- Un-pooled free models stand alone, keyed by their own full_name, so they are represented
-- without inventing a pool identity for them.
create or replace view metering.pool_headroom as
with pools as (
    select
      m.free_pool_key is not null                       as is_pooled
    , coalesce(m.free_pool_key, m.full_name)            as pool_key
    , max(m.free_type::text)                            as free_type
      -- rule 1: one allowance per pool, not the sum of its members'
    , max(coalesce(m.free_monthly_tokens, m.free_credit_tokens)) as allowance_tokens
    from catalog.models m
   where m.free_type is not null
     and m.free_type <> 'discontinued'
   group by 1, 2
)
select
  t.id                                                  as tenant_id
, p.pool_key
, p.is_pooled
, p.free_type
  -- rule 3: NULL for an uncapped tier — never 0
, case when p.free_type in ('recurring_uncapped', 'keyless') then null
       else p.allowance_tokens end                      as allowance_tokens
, w.window_start
, w.window_end
, coalesce(u.used_tokens, 0)                            as used_tokens
, case when p.free_type in ('recurring_uncapped', 'keyless') then null
       else greatest(p.allowance_tokens - coalesce(u.used_tokens, 0), 0) end
                                                        as remaining_tokens
from pools p
cross join core.tenants t
cross join lateral (
    -- rule 2: the window this tier is currently in
    select
      case p.free_type
        when 'recurring_daily'   then current_date
        when 'recurring_monthly' then date_trunc('month', current_date)::date
        else '-infinity'::date          -- credit balances never reset
      end as window_start,
      case p.free_type
        when 'recurring_daily'   then current_date + 1
        when 'recurring_monthly' then (date_trunc('month', current_date) + interval '1 month')::date
        else 'infinity'::date
      end as window_end
) w
left join lateral (
    select sum(ud.input_tokens + ud.output_tokens) as used_tokens
      from metering.usage_daily ud
     where ud.tenant_id = t.id
       and ud.day >= w.window_start
       and ud.day <  w.window_end
       -- pooled usage matches on the pool; an un-pooled model matches on its own name
       and (case when p.is_pooled then ud.pool_key else ud.served_model end) = p.pool_key
) u on true;

comment on view metering.pool_headroom is
'G3: remaining free-tier allowance per pool, per tenant, for the current reset window.
Backs the gateway''s headroom/least_used ordering, usage metering and predicted lockout.
Allowance is counted ONCE per pool (max, not sum); usage is windowed by free_type; an
uncapped tier reports NULL allowance/remaining rather than 0, which would read as exhausted.';
