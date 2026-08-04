-- database/ddl/enum/catalog/router_type.ddl
set search_path to catalog;
-- db-redesign.md §3 catalog enum: config.routers.router_type (routing adapter class).
-- Table stays in `config` for now (config→catalog is a later move); referenced cross-schema.
-- Reads: none (config_loader omits it). Staging import assigns from a varchar column → cast.
create type router_type as enum ('direct', 'aggregator', 'local');
