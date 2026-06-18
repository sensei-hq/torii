-- database/ddl/function/core/add_tenant_partitions.ddl
set search_path to core, public, extensions;

create or replace function core.add_tenant_partitions()
returns trigger language plpgsql as $$
declare
  r         record;
  safe_id   text;
  part_name text;
begin
  -- Replace dashes in UUID with underscores for valid SQL identifiers
  safe_id := replace(NEW.id::text, '-', '_');

  -- Discover all list-partitioned tables in public that have a tenant_id column
  for r in
    select
      c.table_schema,
      c.table_name
    from information_schema.columns c
    join pg_class        pc on pc.relname = c.table_name
    join pg_namespace    pn on pn.oid = pc.relnamespace
                           and pn.nspname = c.table_schema
    join pg_partitioned_table pt on pt.partrelid = pc.oid
    where c.column_name   = 'tenant_id'
      and c.table_schema  = 'public'
    order by c.table_name
  loop
    part_name := r.table_name || '_tenant_' || safe_id;

    -- Skip if this partition already exists
    if not exists (
      select 1
      from pg_class   pc2
      join pg_namespace pn2 on pn2.oid = pc2.relnamespace
                            and pn2.nspname = r.table_schema
      where pc2.relname = part_name
    ) then
      execute format(
        'create table if not exists %I.%I partition of %I.%I for values in (%L)',
        r.table_schema, part_name,
        r.table_schema, r.table_name,
        NEW.id
      );
    end if;
  end loop;

  return NEW;
end;
$$;

create or replace trigger add_tenant_partitions_trigger
  after insert on core.tenants
  for each row execute function core.add_tenant_partitions();

comment on function core.add_tenant_partitions() is
'Auto-creates one partition per list-partitioned table in public for a new tenant.
Partition naming: {table}_tenant_{uuid_with_underscores}
Idempotent: skips partitions that already exist.';
