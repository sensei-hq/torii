-- §3c · sensitive structured data — safe schema exposes structure not values; k-anon gate.
\set ON_ERROR_STOP on
\echo '== §3c dataset_safe_schema + k_anon_ok =='
begin;
  insert into public.structured_datasets(tenant_id, id, name)
    values ('00000000-0000-0000-0000-000000000000','da7a5e70-0000-0000-0000-0000000000e1','payroll');
  insert into public.dataset_columns(tenant_id, dataset_id, name, data_type, sensitivity, encrypted) values
    ('00000000-0000-0000-0000-000000000000','da7a5e70-0000-0000-0000-0000000000e1','department','text','public',false),
    ('00000000-0000-0000-0000-000000000000','da7a5e70-0000-0000-0000-0000000000e1','salary','numeric','restricted',true),
    ('00000000-0000-0000-0000-000000000000','da7a5e70-0000-0000-0000-0000000000e1','ssn','text','restricted',true);

  do $$
  declare schema jsonb;
  begin
    schema := public.dataset_safe_schema('00000000-0000-0000-0000-000000000000','da7a5e70-0000-0000-0000-0000000000e1');
    -- the schema names the columns + sensitivity...
    if not (schema::text like '%salary%' and schema::text like '%restricted%') then
      raise exception 'FAIL: safe schema missing column metadata'; end if;
    -- ...but sensitive columns must be marked encrypted (no raw values ever present)
    if exists (select 1 from jsonb_array_elements(schema) e
               where (e->>'sensitivity')='restricted' and (e->>'encrypted')::bool = false) then
      raise exception 'FAIL: a restricted column is not field-encrypted'; end if;
    -- and the schema carries NO row values (only name/type/sensitivity/encrypted keys)
    if exists (select 1 from jsonb_array_elements(schema) e
               where (select count(*) from jsonb_object_keys(e)) <> 4) then
      raise exception 'FAIL: safe schema leaks extra keys (possible values)'; end if;

    -- k-anonymity gate
    if public.k_anon_ok(array[9,7,3]::bigint[], 5) then raise exception 'FAIL: k-anon passed a group of 3'; end if;
    if not public.k_anon_ok(array[9,7,5]::bigint[], 5) then raise exception 'FAIL: k-anon rejected all-≥5'; end if;
    raise notice '§3c safe-schema (no values) + k-anon gate hold ✓';
  end $$;
rollback;
\echo 'DATASET §3c TEST PASSED'
