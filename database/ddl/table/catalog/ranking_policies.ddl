-- database/ddl/table/catalog/ranking_policies.ddl
set search_path to catalog, core, extensions;

-- The quality margin, per (tenant, category) — §System One Phase 4a. Not a ranking:
-- a TOLERANCE, in accuracy points, for how much measured accuracy a category may
-- give up when the best model is unavailable.
--
-- Why a margin rather than an absolute floor: the best measured model is 0.950 on
-- `tool.route` and 0.630 on `triage.score`, so one number is either trivially met on
-- the easy category or unreachable on the hard one. The question worth configuring is
-- relative — how much accuracy may THIS category trade for availability.
--
-- The resolver takes `greatest(margin, half-width of the top model's CI)`: asking for
-- a tolerance finer than the measurement's own uncertainty is not a claim anyone can
-- keep. On 60-case categories the half-width reaches ±0.10, so their effective margin
-- is 0.10 whatever this table says.
--
-- Tenant-scoped because tolerance is a business decision; `tenant_id is null` is the
-- platform default and a tenant row wins over it.
create table if not exists ranking_policies (
  tenant_id    uuid
    references core.tenants(id) on delete cascade
, category     text        not null
, margin       numeric     not null default 0.03
  -- Bumped on every edit, so it can be carried in the resolver cache key and into the
  -- trace: a changed policy must re-derive the next call's ordering, not the next TTL's.
, revision     bigint      not null default 1
, modified_at  timestamptz not null default now()
, modified_by  varchar     not null default current_user
  -- Accuracy points, so the domain is [0, 1] — wider than any sane category margin.
, constraint ranking_policies_margin_check
    check (margin >= 0 and margin <= 1)
);

-- Exactly one platform default per category …
create unique index if not exists ranking_policies_default_ukey
  on ranking_policies(category)
  where tenant_id is null;

-- … and at most one override per tenant.
create unique index if not exists ranking_policies_tenant_ukey
  on ranking_policies(category, tenant_id)
  where tenant_id is not null;

comment on table ranking_policies is
'The quality margin per (tenant, category) (System One Phase 4).
- margin: accuracy points a category may give up; the effective margin is
  greatest(margin, half-width of the top model CI)
- tenant_id null is the platform default; a tenant row wins over it
- the margin decides MEMBERSHIP of the ranking, never position: an admissible model
  keeps the artifact''s rank
- a model outside the margin is still a chain candidate (an authored fallback may beat
  failing the run); it just never leads on measurement
- revision travels into the resolver cache key and the call trace
- tenant-scoped config like catalog.chains: RLS read for authenticated, writes through
  the gateway as service_role.';
