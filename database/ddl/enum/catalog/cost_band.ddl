-- database/ddl/enum/catalog/cost_band.ddl
set search_path to catalog;
-- G1 catalog enum: catalog.models.cost_band — coarse price segment, a tier-derivation input
-- (e.g. a `cost-optimized` tier derived by {cost=low}). Mirrors the gateway's `CostBand`.
-- Explicit here; the gateway derives it from pricing when absent, so leaving it NULL is valid
-- and means "derive it", not "free".
create type cost_band as enum ('free', 'low', 'mid', 'high');
