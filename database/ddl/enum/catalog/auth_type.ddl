-- database/ddl/enum/catalog/auth_type.ddl
set search_path to catalog;
-- db-redesign.md §3 catalog enum: catalog.routers.authentication_type (router auth scheme).
-- Column KEEPS its name `authentication_type` for now — the §3 rename →auth_type folds into the
-- later config→catalog shape-move (kept out of this pure type change). Staging import casts.
create type auth_type as enum ('api_key', 'aws_signature', 'oauth2', 'bearer_token', 'custom', 'none');
