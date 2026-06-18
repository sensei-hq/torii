set search_path to config, history;

create or replace function historize_feature_states()
returns trigger
language plpgsql
as
$$
begin
  -- Auto-set modified_at if caller didn't change it
  if (new.modified_at is null
      or new.modified_at = old.modified_at) then
    new.modified_at := now();
  end if;

  -- Close previous history record
  update history.past_feature_states
     set effective_to = new.modified_at
   where state_id     = old.id
     and effective_to is null;

  if (tg_op = 'DELETE') then
    return old;
  end if;

  -- Bump version
  new.version := coalesce(old.version, 0) + 1;

  -- Insert new history record
  insert into history.past_feature_states (
    state_id
  , feature_id
  , user_id
  , enabled
  , version
  , modified_by
  , effective_from
  , effective_to
  , operation
  , modified_at)
  values (
    new.id
  , new.feature_id
  , new.user_id
  , new.enabled
  , new.version
  , new.modified_by
  , new.modified_at
  , null
  , tg_op
  , new.modified_at)
  on conflict (state_id, effective_from, effective_to)
  do nothing;

  return new;
end;
$$;

drop trigger if exists feature_states_historize on config.feature_states;
create trigger feature_states_historize
before insert or update or delete
    on config.feature_states
   for each row execute function historize_feature_states();
