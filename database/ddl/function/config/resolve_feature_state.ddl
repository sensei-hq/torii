set search_path to config, public, core, extensions;

-- O3-2 (RW6 / DECISIONS §4): resolve the effective 4-state governance for a feature, for a caller
-- (tenant + roles + optional space). Precedence:
--   1. mandatory floor (catalog `mandatory=true`) → always enabled;
--   2. LOCKS broadest-wins (workspace > space > role) → a `locked` policy is a hard OFF that no
--      narrower scope can override;
--   3. non-locked most-specific-wins (role > space > workspace) for default-on/off/user-overridable;
--   4. user layer applies only where `user-overridable` (v1: falls back to the catalog default —
--      the per-user toggle is a tracked follow-up).
-- Returns ONLY {enabled, governed, source} — never leaks policy rows. Explicit params so the
-- gateway (service_role) calls it with the JWT's verified role_ids (mirrors public.tool_allowed).
create or replace function config.resolve_feature_state(
  p_tenant   uuid,
  p_role_ids uuid[],
  p_feature  text,
  p_space    uuid default null
) returns jsonb
language plpgsql
stable
as $$
declare
  v_default   boolean := false;
  v_mandatory boolean := false;
  v_locked    text;
  v_state     text;
  v_scope     text;
begin
  -- catalog base default + mandatory floor (a feature absent from the catalog is default-off,
  -- but any explicit policy below is still honoured).
  select f.enabled, f.mandatory into v_default, v_mandatory
    from config.features f where f.slug = p_feature limit 1;
  v_default := coalesce(v_default, false);
  v_mandatory := coalesce(v_mandatory, false);

  if v_mandatory then
    return jsonb_build_object('enabled', true, 'governed', true, 'source', 'mandatory');
  end if;

  -- 2. LOCKS broadest-wins: workspace > space > role. A lock is a hard OFF.
  v_locked := case
    when exists(select 1 from public.feature_policies fp
                 where fp.tenant_id = p_tenant and fp.feature_key = p_feature
                   and fp.state = 'locked' and fp.scope_type = 'workspace') then 'workspace'
    when p_space is not null and exists(select 1 from public.feature_policies fp
                 where fp.tenant_id = p_tenant and fp.feature_key = p_feature
                   and fp.state = 'locked' and fp.scope_type = 'space' and fp.scope_id = p_space) then 'space'
    when exists(select 1 from public.feature_policies fp
                 where fp.tenant_id = p_tenant and fp.feature_key = p_feature
                   and fp.state = 'locked' and fp.scope_type = 'role' and fp.scope_id = any(p_role_ids)) then 'role'
    else null
  end;
  if v_locked is not null then
    return jsonb_build_object('enabled', false, 'governed', true, 'source', 'locked@' || v_locked);
  end if;

  -- 3. NON-LOCKED most-specific-wins: role > space > workspace; on a same-scope tie the more
  --    restrictive (default-off) wins.
  select fp.state, fp.scope_type into v_state, v_scope
    from public.feature_policies fp
   where fp.tenant_id = p_tenant and fp.feature_key = p_feature and fp.state <> 'locked'
     and ( (fp.scope_type = 'role' and fp.scope_id = any(p_role_ids))
        or (fp.scope_type = 'space' and p_space is not null and fp.scope_id = p_space)
        or (fp.scope_type = 'workspace') )
   order by case fp.scope_type when 'role' then 0 when 'space' then 1 else 2 end,
            case fp.state when 'default-off' then 0 when 'default-on' then 1 else 2 end
   limit 1;

  if found then
    if v_state = 'default-on' then
      return jsonb_build_object('enabled', true, 'governed', true, 'source', v_scope);
    elsif v_state = 'default-off' then
      return jsonb_build_object('enabled', false, 'governed', true, 'source', v_scope);
    else -- user-overridable (v1: catalog default; per-user toggle is a follow-up)
      return jsonb_build_object('enabled', v_default, 'governed', true, 'source', 'user-overridable@' || v_scope);
    end if;
  end if;

  -- 4. no policy → catalog default, ungoverned.
  return jsonb_build_object('enabled', v_default, 'governed', false, 'source', 'default');
end;
$$;

revoke execute on function config.resolve_feature_state(uuid, uuid[], text, uuid) from public;
grant execute on function config.resolve_feature_state(uuid, uuid[], text, uuid) to service_role;

comment on function config.resolve_feature_state is
'O3-2: effective 4-state feature governance for (tenant, roles, feature, space). Precedence
mandatory → locked-broadest → non-locked-most-specific → user-overridable. Returns {enabled,
governed, source} only. Service_role (gateway) calls it with the JWT-verified role_ids.';
