// Pure, client-side derivations for the Rankings screen (§System One Phase 5).
//
// Kept out of the component so the judgement calls are unit-testable: which margin counts
// as configured, whether the measurement's own CI is what set the effective margin, and
// how a NULL rank must read. Every figure comes from the gateway read (/v1/rankings) —
// nothing is invented here.
import type { RankingCategory, RankingPolicy, RankingRow } from './api'

/**
 * The resolver's built-in margin when no policy row exists. Mirrors the `0.03` default in
 * `catalog.ranked_chain` (SQL) — the database is the authority; this only lets the screen
 * show what is in force before anyone has ever edited it.
 */
export const DEFAULT_MARGIN = 0.03

export type MarginScope = 'tenant' | 'platform' | 'built-in'

export interface ConfiguredMargin {
	margin: number
	scope: MarginScope
	/** the policy row's revision, or null when the built-in default is in force. */
	revision: number | null
	/** who last set it, when a row exists. */
	modifiedBy: string | null
}

/**
 * The margin an edit would start from: the tenant's own row wins over the platform
 * default, and with neither in force the resolver's built-in 0.03 applies.
 *
 * Deliberately NOT `effective_margin`: that number is `greatest(configured, half-width of
 * the category's top CI)`, so seeding the form with it would look like someone had already
 * set a wider margin and quietly lock the CI floor in as a policy.
 */
export function configuredMargin(
	policies: RankingPolicy[],
	category: string,
	builtin = DEFAULT_MARGIN
): ConfiguredMargin {
	const forCategory = policies.filter((p) => p.category === category)
	const tenant = forCategory.find((p) => !p.is_default)
	if (tenant) {
		return {
			margin: tenant.margin,
			scope: 'tenant',
			revision: tenant.revision,
			modifiedBy: tenant.modified_by
		}
	}
	const platform = forCategory.find((p) => p.is_default)
	if (platform) {
		return {
			margin: platform.margin,
			scope: 'platform',
			revision: platform.revision,
			modifiedBy: platform.modified_by
		}
	}
	return { margin: builtin, scope: 'built-in', revision: null, modifiedBy: null }
}

/**
 * True when the effective margin is wider than what is configured — i.e. the top model's
 * confidence interval, not the policy, is what any ordering has to live with. Worth
 * surfacing: on a small corpus an operator can lower the number and see nothing change.
 */
export function ciFloorIsBinding(configured: number, effective: number): boolean {
	// The two come from numeric columns with more precision than a UI ever shows; compare
	// at display precision so a 0.030000000001 difference doesn't claim the floor binds.
	return Math.round(effective * 1000) > Math.round(configured * 1000)
}

/** Accuracy as a percentage with one decimal (`0.945` → `94.5%`); `—` when unmeasured. */
export function accuracyLabel(n: number | null | undefined): string {
	if (n == null) return '—'
	return `${(n * 100).toFixed(1)}%`
}

/**
 * The confidence interval around a measured accuracy (`94.5% ±1.5` → `93.0–96.0%`).
 * Without a half-width the point estimate stands alone rather than implying certainty.
 */
export function ciLabel(
	accuracy: number | null | undefined,
	halfWidth: number | null | undefined
): string {
	if (accuracy == null) return '—'
	if (halfWidth == null) return accuracyLabel(accuracy)
	const lo = Math.max(0, accuracy - halfWidth)
	const hi = Math.min(1, accuracy + halfWidth)
	return `${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%`
}

/**
 * A rank only exists for a `winner`. A tie is a SET, and rendering "1" or a dash that
 * looks like missing data would both be wrong, so the label says what the verdict says.
 */
export function rankLabel(rank: number | null | undefined, verdict: string): string {
	if (rank != null) return String(rank)
	if (verdict === 'tie') return 'tied'
	return verdict === 'unranked' ? 'unranked' : '—'
}

/** A row's standing in the margin: admissible, outside it, or nothing claimed. */
export function marginLabel(within: boolean | null | undefined, verdict: string): string {
	if (within === true) return 'within'
	if (within === false) return 'outside'
	return verdict === 'winner' ? 'unmeasured' : 'no order'
}

/** `3 of 4` — admissible chain models out of the measured ones. */
export function admissibleLabel(c: Pick<RankingCategory, 'admissible' | 'measured'>): string {
	return `${c.admissible} of ${c.measured}`
}

/** Truncated digest for a table cell; the full value belongs in a tooltip. */
export function shortSha(sha: string | null | undefined): string {
	return sha ? sha.slice(0, 7) : '—'
}

/** Chip tone for a verdict — an order is good news, a tie is a warning, no data is muted. */
export function verdictTone(verdict: string): 'success' | 'warning' | 'danger' | 'mute' {
	if (verdict === 'winner') return 'success'
	if (verdict === 'tie') return 'warning'
	if (verdict === 'insufficient') return 'danger'
	return 'mute'
}

/** Chains in the order the gateway would walk them: rank where one exists, else sequence. */
export function orderedRows(rows: RankingRow[]): RankingRow[] {
	return rows.slice().sort((a, b) => {
		if (a.rank != null && b.rank != null) return a.rank - b.rank
		if (a.rank != null) return -1
		if (b.rank != null) return 1
		return a.sequence_order - b.sequence_order
	})
}
