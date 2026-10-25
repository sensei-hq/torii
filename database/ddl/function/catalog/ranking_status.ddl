-- database/ddl/function/catalog/ranking_status.ddl
set search_path to catalog, core, extensions;

-- Why the resolver would (or would not) send an order for this (tenant, capability,
-- category) — §System One Phase 4b. `ranked_chain` answers "which candidates"; this
-- answers "was the ranking used, and if not, why".
--
-- The distinction that matters to an operator: "no measurement" and "nothing on your
-- chain is within the margin" must not look alike, because the first is a benchmark
-- gap and the second is an availability problem — and the second is tenant-specific,
-- since two tenants share the ranking but not their chains.
--
-- Derived from ranked_chain rather than re-reading the tables, so the two can never
-- disagree about which rows are admissible.
create or replace function ranking_status(
  p_tenant     uuid
, p_capability text
, p_category   text
)
returns table (
  category          text
, capability        text
, verdict           catalog.verdict
, effective_margin  numeric
, policy_revision   bigint
, chained           integer
, measured          integer
, admissible        integer
, ranking_revision  bigint
, artifact_sha      text
, corpus_sha        text
, generated_at      timestamp with time zone
, proxy             text
, reason            text
)
language sql
stable
as
$$
with chain_rows as (
  select *
    from catalog.ranked_chain(p_tenant, p_capability, p_category)
)
, summary as (
  select p_category                     as category
       , p_capability                   as capability
       , count(*)::integer              as chained
       , count(*) filter (where r.measured)::integer      as measured
       , count(*) filter (where r.within_margin)::integer as admissible
       , max(r.effective_margin)        as effective_margin
       , max(r.policy_revision)         as policy_revision
       , max(r.revision)                as ranking_revision
       , max(r.artifact_sha)            as artifact_sha
       , max(r.corpus_sha)              as corpus_sha
       , max(r.generated_at)            as generated_at
       , max(r.proxy)                   as proxy
         -- max() has no enum overload; every row of a category carries the same
         -- verdict, so taking one textually and casting back is exact.
       , coalesce((array_agg(distinct r.verdict::text)
                     filter (where r.verdict is not null))[1]
                , 'unranked')::catalog.verdict as verdict
    from chain_rows r
)
select s.category
     , s.capability
     , s.verdict
     , s.effective_margin
     , s.policy_revision
     , s.chained
     , s.measured
     , s.admissible
     , s.ranking_revision
     , s.artifact_sha
     , s.corpus_sha
     , s.generated_at
     , s.proxy
     , case
         when s.chained = 0
           then 'no chain step for this capability and tenant'
         when s.measured = 0
           then 'no measurement for this category'
         when s.verdict <> 'winner'
           then format('verdict %s: there is no order to claim', s.verdict)
         when s.admissible = 0
           then 'no chain model is within the quality margin'
         when s.admissible = 1
           then 'one admissible model: nothing to order'
         else format('%s of %s chained models are within the margin',
                     s.admissible, s.measured)
       end as reason
  from summary s
$$;

comment on function ranking_status(uuid, text, text) is
'Why a ranking was or was not usable for (tenant, capability, category) (System One Phase 4):
verdict, the effective margin and its policy revision, how many chain steps are measured and
how many are admissible, the ranking provenance, and a human reason distinguishing "no
measurement" from "nothing within margin". Derived from catalog.ranked_chain, so the two cannot
disagree. service_role only.';

revoke all on function ranking_status(uuid, text, text) from public;
grant execute on function ranking_status(uuid, text, text) to service_role;
