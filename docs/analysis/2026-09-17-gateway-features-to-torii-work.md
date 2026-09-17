# Gateway features → what torii/seiki must build

> **Status:** analysis, 2026-09-17. Verified against `~/Developer/gateway` @ `1ac4e4e`
> (develop) and `~/Developer/torii` @ `28ce402`. Every status claim is quoted from the
> gateway's own feature docs or checked against source.
>
> Companion to [`2026-09-17-seiki-torii-gateway-alignment.md`](./2026-09-17-seiki-torii-gateway-alignment.md)
> (screens, crate delta, orchestrator/registry).

---

## 1. The one thing to understand first

The gateway has deliberately built **config-only** and left persistence unimplemented.
From `catalog/README.md`:

> **Persistence is a separate, deliberately held-off layer — the catalog is config-driven
> only.** … The DB `config_loader`, the live-usage intra-tier strategies
> (`headroom`/`least-used`), config versioning, and expiration tracking are all **deferred**
> to that held-off persistence layer (SP-DATA, Phase 4).

And it plans to obtain that layer by **taking torii's**. From `data-tier/README.md`:

> A decoupled, user-agnostic subsystem — **extracted from torii** — that manages catalog
> metadata, refresh, and usage tracking… torii's user / tenancy / governance stay in torii
> (tenancy made optional/injectable).

`tiers-and-chains.md` is explicit about which tables: *"Reuses torii's `routing_policies` /
`chain_models` / `chain_bindings`."* Those are three of the four **orphaned tables** I found
earlier — schema torii already has and nothing reads.

**This is the whole opportunity.** Gateway has a set of features that are built-but-stubbed
purely for want of a persistence layer. Torii already has that layer. Torii *supplies* the
data-tier rather than having it extracted — which lights up six deferred gateway features
without writing any engine code.

> **RATIFIED 2026-09-17 (DECISIONS §11).** Gateway is always a library; torii owns the web
> interface and the persistence. Gateway's SP-DATA Phase-4 extraction is **cancelled**.
>
> This restates gateway's own established pattern rather than constraining it: `crates/gateway`
> has **no database dependency at all** (`GatewayStore` is a trait with an in-memory impl,
> which torii already implements over Postgres), and the crates that do touch a DB gate it off
> by default — `vault`'s `sqlx = ["dep:sqlx"]`, `orchestrator-store`'s `postgres = ["dep:sqlx"]`,
> commented *"Off by default so the crate stays dependency-light."* The departure is
> `docs/features/data-tier/`, not the ruling.
>
> **Action in the gateway repo:** add a catalog/metering trait seam mirroring `GatewayStore`,
> and redirect or delete `docs/features/data-tier/` so it stops describing an extraction.

---

## 2. What is actually stubbed today, and why

These are live gateway behaviours degraded by the missing persistence — not future ideas.

| gateway feature | status in gateway | what it does without persistence |
|---|---|---|
| `headroom` / `least-used` intra-tier strategies | **stubbed** | falls back to `priority` + `tracing::warn!`; `IntraTierStrategy::is_dynamic` lets callers detect it |
| Usage metering | Planned (SP-DATA) | no counters vs free/paid limits, no reset windows |
| Predicted lockout | Planned (SP-DATA) | lockout is reactive-on-429 only, never pre-emptive |
| Config versioning | Planned (SP-DATA) | no `config_versions` bump; the replay version-fence has nothing to fence on |
| Expiration tracking | Partial | reactive `401 → auth-lock` only; no proactive OAuth/credit/free-reset alerts |
| Catalog refresh (external DB loader) | Partial | re-audit + drift gate work; the DB `config_loader` is deferred |

Health gates are a separate, sharper problem:

> **Gate state is in-memory/per-process today**; a future seam can persist it for
> multi-instance sharing. — `routing/README.md`

torii-gateway runs on Fly with more than one instance. So circuit-breaker, connection-cooldown
and model-lockout state is **per-instance and divergent**: instance A locks a model out,
instance B keeps sending to it. `catalog.provider_health` exists in torii and is unread. This
is a correctness gap at current scale, not only a missing feature.

---

## 3. Schema torii must add

### 3.1 `catalog.models` — the `CatalogMeta` columns (none exist today)

Verified: `database/ddl/table/catalog/models.ddl` has no free-tier or classification fields.
Gateway's `CatalogMeta` / `FreeTier` (now in `kernel/src/types/config.rs`) needs:

| column | type | notes |
|---|---|---|
| `free_type` | enum | `recurring-daily · recurring-monthly · recurring-credit · recurring-uncapped · one-time-initial · keyless · discontinued` |
| `monthly_tokens` | bigint | documented budget |
| `credit_tokens` | bigint | one-time credits |
| `pool_key` | varchar | **shared-quota pool** — models sharing a pool are counted once |
| `tos` | enum | `ok · caution · ambiguous` — ToS verdict for proxy/relay use |
| `trains_on_prompts` | boolean | privacy cost, surfaced next to the quota |
| `auth_type` | enum | tier derivation input |
| `cost_band` | enum | tier derivation input |
| `locality` | enum | tier derivation input |
| `tags` | text[] | tier derivation input |

Torii is enum-first (§ the 2026-08-04 conversion), so these belong in `ddl/enum/`, not as
CHECK constraints.

`pool_key` is the subtle one: totals must be **pool-deduped** — two models sharing pool
`gemini-flash` at 60M each contribute 60M once, not 120M. One-time credits and uncapped
providers are reported separately and never inflate the steady headline.

### 3.2 `catalog.tiers` — new; no equivalent exists

A tier is a named catalog segment with an intra-tier strategy, and a chain is an ordered list
of **tier-refs**. Torii has `chains` + `chain_models` (concrete models only) and no tier concept.

- `catalog.tiers` — `name`, `strategy` (`headroom|least-used|cost|priority`), and membership
  that is **curated ∪ attribute-derived** (a predicate over `auth_type`/`cost_band`/
  `capability`/`free_type`/`locality`)
- `catalog.tier_models` — curated membership
- `catalog.chain_models` — needs a step that is *either* a model *or* a tier-ref

The payoff is in the gateway's own scenario: *"Adding a model to a tier updates every chain
that references it"* — one edit re-points every chain, instead of editing each chain.

### 3.3 `metering` — pool and window dimensions are missing

Torii's `metering.usage_daily` aggregates by `(day, org_unit_id, served_model, provider,
capability, execution_location)`. Gateway's metering store needs two dimensions torii lacks:

- **`pool_key`** — quota is consumed per *pool*, not per model; without it, headroom against a
  shared pool cannot be computed
- **reset windows** — free tiers reset daily/monthly; `usage_daily` has no window-start/end or
  quota-period concept, so "used 40M of 60M this window" is not answerable

Both are required by `headroom`, usage metering, and predicted lockout. Note the guarantee
difference, which the gateway calls out: metering is **best-effort** (losing a counter is
acceptable; a failed write must not fail inference), unlike the orchestrator journal which is
strict.

### 3.4 Wire the four orphaned tables

Already in torii, zero code readers, and each now has a concrete consumer:

| table | consumer |
|---|---|
| `catalog.routing_policies` | gateway's `ResilienceConfig` — tunable cooldown/lockout durations, eviction cap, jitter |
| `catalog.provider_health` | persisted health-gate state (fixes the multi-instance divergence in §2) |
| `catalog.chain_bindings` | tier-ref chains / `(area,kind)→chain` — see the alignment doc §2.2 |
| `catalog.provider_overrides` | per-router config overrides on Connections |

---

## 4. What seiki must surface

| screen | addition | backed by |
|---|---|---|
| **Models** | tier tabs; free-tier columns (`free_type`, monthly/credit tokens, pool, ToS badge, "trains on prompts") | §3.1 |
| **Models** | "Refresh from routers" | `/v1/models/available` (**already built, unwired**) |
| **Routing** | routing-policy card — retries/backoff/timeout, cooldown + lockout durations, jitter | `routing_policies` + `ResilienceConfig` |
| **Routing** | provider-health card | `provider_health` |
| **Routing** | tier editor + chains as ordered tier-refs | §3.2 |
| **Overview / Billing** | free-tier headroom, pool-deduped totals, predicted-exhaustion warning | §3.3 |
| **Connections** | credential expiry / OAuth-refresh warnings | expiration tracking |

The economics columns the Models mock has always wanted (tier / price / quality / latency)
are **partly answered by gateway's `CatalogMeta`** — decide source-of-truth before adding a
torii-only table (alignment doc §9.6).

---

## 5. Work breakdown

**G1 · Catalog metadata** — enums + `CatalogMeta` columns on `catalog.models`; import/seed;
expose on `/v1/models`; Models screen columns. *Unblocks the `free` tier and honest economics.*

**G2 · Tiers & chains** — `catalog.tiers` + membership + tier-ref chain steps; Routing tier
editor. *Unblocks "add a model to a tier, every chain updates".*

**G3 · Metering pools + windows** — `pool_key` and reset-window dimensions in `metering`;
rollups; headroom read API. *Unblocks `headroom`/`least-used`, usage metering, predicted
lockout — three gateway features at once.*

**G4 · Persisted health gates** — back the breaker/cooldown/lockout seam with
`catalog.provider_health`. **Do this one early**: it is a live multi-instance correctness gap,
not a feature.

**G5 · Resilience config** — persist `ResilienceConfig` in `routing_policies`; Routing policy
card.

**G6 · Config versioning + expiration tracking** — `config_versions` bump on catalog edits;
proactive credential/credit/free-reset alerts into Alerts + Connections.

**G0 · Release and repin** (prerequisite for G1–G3) — none of `CatalogMeta`, `gates/`, or the
selection rewrite exists in the pinned `v0.5.1`. Dev builds gateway HEAD via `[patch]`;
production builds the tag, **828 commits behind**. Cut a release and repin first, or G1–G3
will be developed against an engine production does not have.

Suggested order: **G0 → G4 → G1 → G3 → G2 → G5 → G6.**
(G4 first because it is a defect; G1 before G3 because pools are a catalog concept; G2 after
G3 so `headroom` has data to order by.)

---

## 6. Decisions needed

1. ~~Does torii supply the data-tier, or does gateway extract it?~~ **RESOLVED 2026-09-17 —
   torii supplies it; the extraction is cancelled (DECISIONS §11).**
2. **Tenancy of the catalog.** `catalog.models`/`providers` are global reference data (no
   `tenant_id`); `catalog.chains` is tenant-scoped. Are **tiers** global, tenant-scoped, or
   both (platform defaults + tenant overrides, like chains)? This shapes §3.2.
3. **Model economics source of truth** — gateway `CatalogMeta` or a torii table?
4. **Is persisted health-gate state shared across tenants?** Provider health is a property of
   the provider, not the tenant — but a tenant's own BYOK key can be the thing that is rate-
   limited. Getting this wrong either leaks signal across tenants or fails to share a genuinely
   global outage.

---

## Related

- Gateway feature docs: `docs/features/{catalog,routing,governance,data-tier}/`
- [`2026-09-17-seiki-torii-gateway-alignment.md`](./2026-09-17-seiki-torii-gateway-alignment.md) — screens, crate delta, orchestrator/registry
- `docs/specs/seiki-screens/README.md` — prior build-vs-mock audit (needs refresh)
