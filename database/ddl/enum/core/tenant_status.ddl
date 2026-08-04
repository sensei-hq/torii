-- database/ddl/enum/core/tenant_status.ddl
set search_path to core;
-- db-redesign.md §3 shared core enum: core.tenants.status (tenant lifecycle).
-- Compared via literals in assign_tenant_by_domain (coerce); import_tenants() casts its
-- varchar staging column. No typed Rust read. Reads elsewhere project other columns only.
create type tenant_status as enum ('active', 'suspended', 'trial');
