set search_path to config, history;

create or replace function historize_mcp_servers()
returns trigger
language plpgsql
as
$$
begin
  -- Auto-set updated_at if caller didn't change it
  if (new.updated_at is null
      or new.updated_at = old.updated_at) then
    new.updated_at := now();
  end if;

  -- Close previous history record
  update history.past_mcp_servers
     set effective_to = new.updated_at
   where server_id    = old.id
     and effective_to is null;

  if (tg_op = 'DELETE') then
    return old;
  end if;

  -- Bump version
  new.version := coalesce(old.version, 0) + 1;

  -- Insert new history record
  insert into history.past_mcp_servers (
    server_id
  , name
  , label
  , transport
  , command
  , args
  , env
  , url
  , is_active
  , version
  , modified_by
  , effective_from
  , effective_to
  , operation
  , created_at
  , updated_at)
  values (
    new.id
  , new.name
  , new.label
  , new.transport
  , new.command
  , new.args
  , new.env
  , new.url
  , new.is_active
  , new.version
  , new.modified_by
  , new.updated_at
  , null
  , tg_op
  , new.created_at
  , new.updated_at)
  on conflict (server_id, effective_from, effective_to)
  do nothing;

  return new;
end;
$$;

drop trigger if exists mcp_servers_historize on config.mcp_servers;
create trigger mcp_servers_historize
before insert or update or delete
    on config.mcp_servers
   for each row execute function historize_mcp_servers();
