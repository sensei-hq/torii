-- X1 · tool allow-list resolution — default-deny + role/space/tool matching.
\set ON_ERROR_STOP on
\echo '== X1 tool_allowed: default-deny + grant matching =='
begin;
  -- a server + a role that gets one tool granted
  insert into public.mcp_servers(id, scope, name, transport)
    values ('5e5e5e00-0000-0000-0000-0000000000a1','tenant','warehouse','http');
  insert into core.roles(id, tenant_id, key, name)
    values ('501e0000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','ops','Ops')
    on conflict do nothing;
  -- grant: role Ops may use tool 'query' on the server, in any space
  insert into public.tool_allow_lists(tenant_id, role_id, space_id, mcp_server_id, tool_name)
    values ('00000000-0000-0000-0000-000000000000','501e0000-0000-0000-0000-0000000000a1',null,'5e5e5e00-0000-0000-0000-0000000000a1','query');

  do $$
  declare ops uuid := '501e0000-0000-0000-0000-0000000000a1';
          other uuid := '502e0000-0000-0000-0000-0000000000a2';
          srv uuid := '5e5e5e00-0000-0000-0000-0000000000a1';
          t uuid := '00000000-0000-0000-0000-000000000000';
  begin
    -- granted tool for the granted role → allowed
    if not public.tool_allowed(t, array[ops], null, srv, 'query') then
      raise exception 'FAIL: granted (role,tool) not allowed'; end if;
    -- different tool → denied (default-deny)
    if public.tool_allowed(t, array[ops], null, srv, 'delete') then
      raise exception 'FAIL: ungranted tool allowed'; end if;
    -- different role → denied
    if public.tool_allowed(t, array[other], null, srv, 'query') then
      raise exception 'FAIL: ungranted role allowed'; end if;
    -- no grants at all (empty roles) → denied
    if public.tool_allowed(t, array[]::uuid[], null, srv, 'query') then
      raise exception 'FAIL: empty roles allowed'; end if;
    raise notice 'X1 tool allow-list default-deny holds ✓';
  end $$;
rollback;
\echo 'TOOL ALLOW-LIST TEST PASSED'
