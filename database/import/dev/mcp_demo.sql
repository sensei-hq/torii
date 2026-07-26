-- Dev demo data for the X1 Tools & MCP admin screen: two MCP servers (a local stdio
-- one + a shared http one) and their discovered tools. Idempotent.

insert into public.mcp_servers (id, tenant_id, scope, name, label, transport, command, args, enabled)
values ('11110000-0000-0000-0000-0000000000f1', null, 'platform', 'filesystem',
        'Filesystem (local)', 'stdio', 'npx',
        '["-y","@modelcontextprotocol/server-filesystem","/data"]'::jsonb, true)
on conflict (id) do nothing;

insert into public.mcp_servers (id, tenant_id, scope, name, label, transport, url, enabled)
values ('11110000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
        'tenant', 'github', 'GitHub', 'http', 'https://api.githubcopilot.com/mcp', true)
on conflict (id) do nothing;

insert into public.mcp_server_tools (mcp_server_id, tool_name, is_active) values
  ('11110000-0000-0000-0000-0000000000f1', 'read_file',            true),
  ('11110000-0000-0000-0000-0000000000f1', 'write_file',           true),
  ('11110000-0000-0000-0000-0000000000f1', 'list_directory',       true),
  ('11110000-0000-0000-0000-0000000000f2', 'search_repositories',  true),
  ('11110000-0000-0000-0000-0000000000f2', 'create_issue',         true),
  ('11110000-0000-0000-0000-0000000000f2', 'get_file_contents',    true)
on conflict (mcp_server_id, tool_name) do nothing;
