set search_path to staging;

create or replace procedure import_mcp_servers()
language plpgsql
as
$$
begin
  insert into config.mcp_servers(
     name, label, transport, command, args, env, url, is_active
   , modified_by)
  select trim(stg.name)
       , stg.label
       , coalesce(stg.transport, 'stdio')
       , stg.command
       , coalesce(stg.args, '[]'::jsonb)
       , coalesce(stg.env, '{}'::jsonb)
       , stg.url
       , coalesce(stg.is_active, true)
       , coalesce(stg.modified_by, current_user)
    from staging.mcp_servers stg
   where not exists (
     select 1
       from config.mcp_servers m
      where m.name = trim(stg.name)
        and m.updated_at > stg.modified_at
   )
      on conflict(name)
      do update
            set label     = excluded.label
              , transport = excluded.transport
              , command   = excluded.command
              , args      = excluded.args
              , env       = excluded.env
              , url       = excluded.url
              , is_active = excluded.is_active
              , modified_by = excluded.modified_by
              , updated_at  = now();
end;
$$;
