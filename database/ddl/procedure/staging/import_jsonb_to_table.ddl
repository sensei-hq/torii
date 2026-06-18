CREATE OR REPLACE PROCEDURE staging.import_jsonb_to_table(temp_table text, target_table text)
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'INSERT INTO %s SELECT * FROM jsonb_populate_recordset(null::%s, (SELECT jsonb_agg(data) FROM %s))',
    target_table, target_table, temp_table
  );
END;
$$;
