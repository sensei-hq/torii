-- database/ddl/enum/core/api_key_status.ddl
set search_path to core;
-- db-redesign.md §3 core enum (access folds into core, §8): public.api_keys.status.
-- THE API-key auth hot path (auth.rs) decodes this into a Rust String → that SELECT casts
-- status::text. Writes are literals ('active' issue / 'revoked' revoke) → coerce.
create type api_key_status as enum ('active', 'revoked');
