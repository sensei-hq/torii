GRANT USAGE ON SCHEMA config TO anon, authenticated;
GRANT USAGE ON SCHEMA staging TO anon, authenticated;

-- Import base configuration
call staging.import_schemas();

-- Import organization structure
call staging.import_routers();
call staging.import_capabilities();
call staging.import_providers();
call staging.import_models();
