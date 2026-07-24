-- C3/RW7 · hard budget reserve test — proves a hard cap cannot be exceeded.
\set ON_ERROR_STOP on
\echo '== C3 hard-reserve: over-cap reserves are rejected =='
begin;
  -- org (cap 100, hard) → team (no cap) → user (no cap)
  insert into public.budget_nodes(tenant_id,id,parent_id,kind,name,cap_amount,enforcement,modified_by) values
    ('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a1',null,'org','Org',100,'hard','t'),
    ('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a2','b0d0e000-0000-0000-0000-0000000000a1','user','U',null,'hard','t');

  do $$
  declare h1 uuid; h2 uuid;
  begin
    -- reserve 60 on the user → ok (org headroom 100)
    h1 := public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a2',60);
    if (select reserved_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000a1') <> 60 then
      raise exception 'FAIL: org.reserved should be 60'; end if;

    -- a second 60 would exceed the org cap (100-60=40 < 60) → must raise
    begin
      h2 := public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a2',60);
      raise exception 'FAIL: over-cap reserve was ALLOWED (hard cap breached)';
    exception when check_violation then null; end;

    -- commit h1 with actual 50 → org.spent=50, reserved=0
    perform public.budget_commit('00000000-0000-0000-0000-000000000000',h1,50);
    if (select spent_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000a1') <> 50
       or (select reserved_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000a1') <> 0 then
      raise exception 'FAIL: commit did not settle spent/reserved'; end if;

    -- now headroom is 50; a 60 reserve still exceeds → raise; a 40 is fine
    begin
      perform public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a2',60);
      raise exception 'FAIL: 60 reserve allowed with only 50 headroom';
    exception when check_violation then null; end;
    perform public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000a2',40);

    raise notice 'C3 hard-reserve invariant holds ✓';
  end $$;
rollback;
\echo 'BUDGET RESERVE TEST PASSED'

\echo '== C3 precision: sub-cent spend accrues (numeric(14,6), not rounded to 0) =='
begin;
  -- Regression guard: per-call costs are sub-cent (~$0.0002). If budget_nodes
  -- amounts revert to numeric(12,2) these round to 0.00 and spend never accrues
  -- (a silent budget leak). org cap 1.00 → user (no cap).
  insert into public.budget_nodes(tenant_id,id,parent_id,kind,name,cap_amount,enforcement,modified_by) values
    ('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000b1',null,'org','OrgP',1,'hard','t'),
    ('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000b2','b0d0e000-0000-0000-0000-0000000000b1','user','UP',null,'hard','t');
  do $$
  declare h uuid;
  begin
    h := public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000b2',0.001);
    perform public.budget_commit('00000000-0000-0000-0000-000000000000',h,0.000204);
    if (select spent_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000b1') <> 0.000204 then
      raise exception 'FAIL: sub-cent spend rounded away (spent=%); budget_nodes amounts must be numeric(14,6)',
        (select spent_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000b1'); end if;

    -- many sub-cent commits must accumulate, not vanish.
    for i in 1..10 loop
      h := public.budget_reserve('00000000-0000-0000-0000-000000000000','b0d0e000-0000-0000-0000-0000000000b2',0.001);
      perform public.budget_commit('00000000-0000-0000-0000-000000000000',h,0.0001);
    end loop;
    if (select spent_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000b1') <> 0.001204 then
      raise exception 'FAIL: sub-cent commits did not accumulate (spent=%)',
        (select spent_amount from public.budget_nodes where id='b0d0e000-0000-0000-0000-0000000000b1'); end if;

    raise notice 'C3 sub-cent accrual holds ✓';
  end $$;
rollback;
\echo 'BUDGET PRECISION TEST PASSED'
