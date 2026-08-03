// Pure, client-side derivations for the Budgets & billing cost-breakdown card. Kept out of
// the component so they're unit-testable (type-only imports → no $env at runtime). Every
// figure is aggregated from the real request ledger (/v1/requests) by adapter (provider)
// and model over `cost_usd` — no mock data. The commercial billing/plan/invoice sections
// stay deferred (DECISIONS §10.1); this module only meters spend already incurred.
import type { RequestRow } from './api'

/** Spend rolled up for one provider (the ledger's `adapter`). */
export interface ProviderCost {
	/** the routing adapter that served the calls (e.g. `anthropic`, `openai`, `ollama`). */
	provider: string
	/** total $ metered against this provider in the window. */
	cost: number
	/** calls served by this provider. */
	calls: number
	/** share of the window's total metered spend, 0-100 rounded (0 when nothing is metered). */
	pct: number
}

/** Spend rolled up for one model, carrying the provider that served it. */
export interface ModelCost {
	/** the model id as recorded on the call (e.g. `claude-sonnet-4-5`). */
	model: string
	/** the adapter that served this model. */
	provider: string
	cost: number
	calls: number
	/** share of the window's total metered spend, 0-100 rounded. */
	pct: number
}

export interface CostBreakdown {
	/** exact sum of `cost_usd` across every row (non-finite costs coerced to 0). */
	total: number
	/** rows aggregated. */
	calls: number
	/** per-provider spend, richest first. */
	providers: ProviderCost[]
	/** per-model spend, richest first. */
	models: ModelCost[]
}

/** A non-finite / missing cost must never poison a sum — coerce it to 0. */
const safeCost = (v: number): number => (Number.isFinite(v) ? v : 0)

/** Share of the window's total, as a whole percent; 0 (never NaN) when nothing is metered. */
const share = (cost: number, total: number): number =>
	total > 0 ? Math.round((cost / total) * 100) : 0

interface Bucket {
	cost: number
	calls: number
}

/**
 * Aggregate the request ledger into per-provider and per-model spend.
 *
 * - Providers group by `adapter`; models group by the `adapter model` pair so a model
 *   name shared across providers stays distinct (the provider that served it is carried on
 *   the row for the dot/label).
 * - `cost` sums `cost_usd` exactly per group; `calls` counts rows (a $0 local call still
 *   counts and still yields a row, so "free" providers/models surface rather than vanish).
 * - `total` is the exact sum across all rows, so the header "$X metered" reconciles with the
 *   sum of either breakdown (no dropped or double-counted spend).
 * - Both lists sort richest → cheapest (then most calls, then name) so the biggest line items
 *   lead; ties are deterministic.
 */
export function costBreakdown(requests: RequestRow[]): CostBreakdown {
	const providerBuckets = new Map<string, Bucket>()
	const modelBuckets = new Map<string, Bucket & { model: string; provider: string }>()
	let total = 0

	for (const r of requests) {
		const cost = safeCost(r.cost_usd)
		total += cost

		const provider = r.adapter || 'unknown'
		const pb = providerBuckets.get(provider) ?? { cost: 0, calls: 0 }
		pb.cost += cost
		pb.calls += 1
		providerBuckets.set(provider, pb)

		const model = r.model || 'unknown'
		const key = `${provider} ${model}`
		const mb = modelBuckets.get(key) ?? { cost: 0, calls: 0, model, provider }
		mb.cost += cost
		mb.calls += 1
		modelBuckets.set(key, mb)
	}

	const providers: ProviderCost[] = [...providerBuckets.entries()]
		.map(([provider, b]) => ({ provider, cost: b.cost, calls: b.calls, pct: share(b.cost, total) }))
		.sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.provider.localeCompare(b.provider))

	const models: ModelCost[] = [...modelBuckets.values()]
		.map((b) => ({
			model: b.model,
			provider: b.provider,
			cost: b.cost,
			calls: b.calls,
			pct: share(b.cost, total)
		}))
		.sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.model.localeCompare(b.model))

	return { total, calls: requests.length, providers, models }
}
