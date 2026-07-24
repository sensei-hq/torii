-- C2 · chain-binding resolution — most-specific binding wins.
\set ON_ERROR_STOP on
\echo '== C2 resolve_chain: specificity precedence =='
begin;
  -- two chains + bindings: a tenant default and a space-specific one for space S.
  insert into public.fallback_chains(tenant_id, id, name, capability_id, max_fallback_attempts,
      circuit_breaker_threshold, circuit_breaker_window_minutes, is_active, priority, modified_by) values
    ('00000000-0000-0000-0000-000000000000','c8a10000-0000-0000-0000-0000000000d1','default-chat',(select id from config.capabilities limit 1),3,5,10,true,1,'t'),
    ('00000000-0000-0000-0000-000000000000','c8a10000-0000-0000-0000-0000000000d2','space-chat',(select id from config.capabilities limit 1),3,5,10,true,1,'t')
    on conflict do nothing;
  insert into public.chain_bindings(tenant_id, capability, chain_id, space_id, role_id) values
    ('00000000-0000-0000-0000-000000000000','text_chat','c8a10000-0000-0000-0000-0000000000d1',null,null),
    ('00000000-0000-0000-0000-000000000000','text_chat','c8a10000-0000-0000-0000-0000000000d2','5face111-0000-0000-0000-0000000000d9',null);

  do $$
  declare t uuid := '00000000-0000-0000-0000-000000000000';
          s uuid := '5face111-0000-0000-0000-0000000000d9';
          other_s uuid := '5face222-0000-0000-0000-0000000000d8';
  begin
    -- in space S → the space-specific chain wins
    if public.resolve_chain(t,'text_chat',s,array[]::uuid[]) <> 'c8a10000-0000-0000-0000-0000000000d2' then
      raise exception 'FAIL: space-specific binding did not win'; end if;
    -- in another space → falls back to the tenant default
    if public.resolve_chain(t,'text_chat',other_s,array[]::uuid[]) <> 'c8a10000-0000-0000-0000-0000000000d1' then
      raise exception 'FAIL: default binding not used outside the space'; end if;
    -- unknown capability → NULL (config default)
    if public.resolve_chain(t,'text_embed',s,array[]::uuid[]) is not null then
      raise exception 'FAIL: unknown capability should resolve NULL'; end if;
    raise notice 'C2 chain resolution precedence holds ✓';
  end $$;
rollback;
\echo 'ROUTING RESOLUTION TEST PASSED'
