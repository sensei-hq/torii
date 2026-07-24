set search_path to public, core, extensions;

-- X1 (DECISIONS §1): resolve whether a caller may invoke a tool on an MCP server.
-- DEFAULT-DENY — a tool is allowed only if a tool_allow_lists grant exists for one
-- of the caller's roles, matching the space (or a role-wide grant, space_id null)
-- and the tool (or a server-wide grant, tool_name null). Space overrides tighten:
-- a space grant is required when scoped, never loosens a role default. The gateway
-- calls this at tool-call time; enforcement is server-side, never UI.
create or replace function public.tool_allowed(
  p_tenant   uuid,
  p_role_ids uuid[],
  p_space    uuid,
  p_server   uuid,
  p_tool     text
) returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.tool_allow_lists tal
     where tal.tenant_id     = p_tenant
       and tal.role_id       = any(p_role_ids)
       and tal.mcp_server_id = p_server
       and (tal.space_id  is null or tal.space_id  = p_space)
       and (tal.tool_name is null or tal.tool_name = p_tool)
  );
$$;

revoke execute on function public.tool_allowed(uuid, uuid[], uuid, uuid, text) from public;
grant execute on function public.tool_allowed(uuid, uuid[], uuid, uuid, text) to authenticated;
grant execute on function public.tool_allowed(uuid, uuid[], uuid, uuid, text) to service_role;

comment on function public.tool_allowed is
'X1: default-deny (role × space) → (server, tool) allow-list resolution. The
gateway enforces this at MCP tool-call time (DECISIONS §1).';
