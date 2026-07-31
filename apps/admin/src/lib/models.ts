// Pure, client-side derivations for the Model catalog screen. Kept out of the component
// so they're unit-testable (type-only imports → no $env at runtime). Every figure is from
// the real gateway read (/v1/models) — no mock data. The mock's economics columns
// (tier / $-per-1M / quality / latency) are NOT in ModelRow, so they're not derived here:
// they need a per-tenant catalog-metadata backend (see the fidelity backlog), not faked.
import type { ModelRow } from './api'

/** Distinct providers present in the catalog, alphabetical — the provider filter chips. */
export function providerList(models: ModelRow[]): string[] {
	return [...new Set(models.map((m) => m.provider))].sort((a, b) => a.localeCompare(b))
}

/** The catalog narrowed to one provider ('all' = everything), stable-sorted by display label. */
export function filterModels(models: ModelRow[], provider = 'all'): ModelRow[] {
	const label = (m: ModelRow) => m.display_name ?? m.full_name
	return models
		.filter((m) => provider === 'all' || m.provider === provider)
		.slice()
		.sort((a, b) => label(a).localeCompare(label(b)))
}

export interface CatalogSummary {
	total: number
	/** models with a reachable endpoint. */
	reachable: number
	/** models enabled for the tenant. */
	enabled: number
	/** distinct providers. */
	providers: number
}

export function catalogSummary(models: ModelRow[]): CatalogSummary {
	return {
		total: models.length,
		reachable: models.filter((m) => m.reachable).length,
		enabled: models.filter((m) => m.enabled).length,
		providers: providerList(models).length
	}
}

/** Context / output token counts as a compact `128K` label (`—` when unknown). */
export function tokenLabel(n: number | null): string {
	if (n == null) return '—'
	return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
}
