-- database/ddl/table/catalog/models.ddl
set search_path to catalog, core, extensions;

-- §D move: catalog.models → catalog.models (config→catalog). Model catalog; provider_id FK →
-- catalog.providers (intra-schema). Global reference data (no tenant_id, no RLS).
create table if not exists models (
  id                       uuid primary key default uuid_generate_v4()
, provider_id              uuid
, name                     varchar(100) not null
, version                  varchar(50) not null
, variant                  varchar(50) default null
, full_name                varchar(200)
, display_name             varchar(200)
, description              text
, context_window           integer
, max_output_tokens        integer
, training_data_cutoff     date
, parameters_count         bigint
, license_type             varchar(50)
, usage_guidelines         text
, content_policy_url       varchar(500)
, config                   jsonb
, released_on              date
, deprecated_on            date
  -- ── G1: gateway CatalogMeta / FreeTier ────────────────────────────────────────────
  -- Tier membership in the gateway is DERIVED from these attributes, and free-tier totals
  -- are POOL-DEDUPED. See ddl/enum/catalog/{free_type,tos_verdict,model_auth_type,cost_band}.
  -- FreeTier — present iff free_type is not null.
, free_type                free_type
, free_monthly_tokens      bigint
, free_credit_tokens       bigint
  -- Shared-quota pool. Models sharing a key draw on ONE allowance, so totals must group by
  -- it and count the pool once — summing free_monthly_tokens across rows double-counts.
, free_pool_key            varchar(100)
, free_tos                 tos_verdict
  -- Privacy cost, surfaced next to the quota. NOT NULL: "unknown" must not read as "no".
, trains_on_prompts        boolean not null default false
  -- Tier-derivation inputs. NULL means "derive it" (the gateway falls back to pricing for
  -- the cost band), not "none".
, model_auth_type          model_auth_type
, cost_band                cost_band
  -- Reuses core.execution_location {local,cloud} rather than minting a duplicate enum
  -- (db-redesign §3 consolidated the execution_location/plane family into this one type).
, locality                 core.execution_location
  -- Free-form labels ("reasoning", "frontier") for tier predicates. NOT NULL default {}:
  -- a NULL makes `tags @> …` evaluate to NULL rather than false, which would silently drop
  -- the model out of every tag-derived tier instead of merely not matching.
, tags                     text[] not null default '{}'
, modified_at              timestamp with time zone not null default now()
, modified_by              varchar
, constraint models_deprecation_check check (deprecated_on is null or deprecated_on >= released_on)
  -- FreeTier.tos is non-optional in the gateway, so a free tier with no verdict fails to
  -- deserialize at config load. Reject it at write, where the cause is still visible.
, constraint models_free_tos_check check (free_type is null or free_tos is not null)
, constraint models_fkey foreign key (provider_id) references providers(id) on update cascade on delete restrict
, constraint models_name_lowercase_check check (name = lower(name))
, constraint models_version_lowercase_check check (version = lower(version))
, constraint models_variant_lowercase_check check (variant is null or variant = lower(variant))
);

create unique index if not exists models_ukey on models(provider_id, full_name);
create unique index if not exists models_ukey2 on models(provider_id, name, version, variant);
create index if not exists models_idx2 on models(name);
create index if not exists models_idx3 on models(version);
create index if not exists models_idx4 on models(variant);
create index if not exists models_idx6 on models(context_window);
create index if not exists models_idx7 on models(released_on);
create index if not exists models_idx8 on models(deprecated_on);
create index if not exists models_idx9 on models(deprecated_on) where deprecated_on is null;

comment on table models IS
'AI models with structured naming using provider_id, name, version, and variant components.
- full_name follows pattern: name-version[-variant] (e.g. gpt-4-turbo, claude-sonnet-3.7-thinking)
- Lifecycle managed via released_on/deprecated_on dates
- Links to providers table through provider_id foreign key';
