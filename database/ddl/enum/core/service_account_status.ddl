-- database/ddl/enum/core/service_account_status.ddl
set search_path to core;
-- db-redesign.md §3 core enum (access folds into core, §8): public.service_accounts.status.
-- Zero Rust read/write of status (the only reference is an id-existence check). Pure DDL swap.
create type service_account_status as enum ('active', 'disabled');
