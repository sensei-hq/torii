-- database/ddl/enum/catalog/intra_tier_strategy.ddl
set search_path to catalog;
-- G2 catalog enum: catalog.tiers.strategy — how candidates are ORDERED WITHIN one tier.
-- Mirrors the gateway's `IntraTierStrategy`. Cross-tier fallover is the chain's job; this is
-- only the ordering inside a segment.
--
-- `priority` and `cost` are pure functions of config and are live in the engine today.
-- `headroom` and `least_used` need live usage + lockout state — the persistence layer the
-- gateway deliberately held off (and that torii now owns, DECISIONS §11). Until it is wired,
-- the engine STUBS both to `priority` and emits a tracing::warn! (never a silent degrade;
-- callers can also detect it via IntraTierStrategy::is_dynamic). Storing them is therefore
-- valid config that is not yet fully honoured — declared order puts the live ones first.
create type intra_tier_strategy as enum ('priority', 'cost', 'headroom', 'least_used');
