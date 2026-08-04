-- database/ddl/enum/keyvault/credential_type.ddl
set search_path to keyvault;
-- db-redesign.md §3 vault enum → schema RENAMED vault→keyvault (the design's `vault` collides with
-- Supabase's built-in vault schema, used by the KEK provider). router_credentials.credential_type.
--
-- The shared sensei-vault crate accesses this column via SQL; its one bound-&str write
-- (deactivate) was decoupled with `credential_type::text = $4` so the crate is schema-agnostic
-- (works for varchar or enum). All other crate sites use literals ('api_key'/'oauth') that coerce.
create type credential_type as enum ('api_key', 'oauth');
