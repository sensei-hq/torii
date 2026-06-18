-- Strategos seed data loader
-- Run after migration has been applied and staging tables populated
-- Executes import procedures in dependency order

-- Phase 1: Independent base tables
call staging.import_providers();
call staging.import_routers();
call staging.import_capabilities();

-- Phase 2: Models (depends on providers)
call staging.import_models();

-- Phase 3: Junction tables (depends on models, routers, capabilities)
call staging.import_model_endpoints();
call staging.import_model_capabilities();

-- Phase 4: Fallback chains (depends on capabilities)
call staging.import_fallback_chains();

-- Phase 5: Fallback chain models (depends on fallback_chains, routers, models)
call staging.import_fallback_chain_models();

-- Phase 6: UI modules and features (independent)
call staging.import_modules();
call staging.import_features();

-- Phase 7: Dev-only data (loaded via `dbd import -e dev`)
-- Skipped in prod: staging tables will be empty, procedures are no-ops
call staging.import_tenants();
call staging.import_tenant_keys();
call staging.import_router_keys();
call staging.import_mcp_servers();
