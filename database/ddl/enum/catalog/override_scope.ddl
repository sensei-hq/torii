-- database/ddl/enum/catalog/override_scope.ddl
set search_path to catalog;
-- db-redesign.md §3 catalog enum: model_overrides.scope_type (which layer an override targets).
-- Table stays in `public` for now (moves to catalog later). Empty table, no RLS/Rust deps.
create type override_scope as enum ('tenant', 'space', 'role');
