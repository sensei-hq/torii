-- database/ddl/table/core/api_keys.ddl
set search_path to core, extensions;   -- §D Phase 1 MOVE: public→core (access folds into core, §8)

-- RW4 (decision #2): a key AUTHENTICATES an identity (a profile OR a service
-- account) — it carries NO budget (budget follows the identity's node, resolved at
-- execution, DECISIONS §2 W2). Only the hash + public prefix are stored; the secret
-- is revealed once at creation via the gateway.
create table if not exists api_keys (
  tenant_id           uuid        not null references core.tenants(id) on delete cascade
, id                  uuid        not null default gen_random_uuid()
, profile_id          uuid                                   -- identity: a person …
, service_account_id  uuid                                   -- … or a service account
, hashed_secret       text        not null                   -- never the raw key
, prefix              varchar(24) not null                   -- public key prefix (sk_str_…)
, scope               jsonb       not null default '[]'      -- capability subset
, rate_limit          integer                                -- requests/min; null = default
, last_used_at        timestamptz
, status              core.api_key_status not null default 'active'
, created_by          varchar     not null default 'system'
, created_at          timestamptz not null default now()
, primary key (tenant_id, id)
, foreign key (tenant_id, service_account_id)
    references service_accounts(tenant_id, id) on delete cascade
, constraint api_keys_one_identity
    check ((profile_id is not null)::int + (service_account_id is not null)::int = 1)
);

create unique index if not exists api_keys_prefix_ukey on api_keys(prefix);
create index if not exists idx_api_keys_identity on api_keys(tenant_id, profile_id, service_account_id);

comment on table api_keys is
'RW4: authenticates an identity (profile XOR service_account). NO budget column —
spend rolls up to the identity''s budget node. Hash + prefix only; reveal-once at
creation. Service_role-write; the gateway validates by prefix+hash.';
