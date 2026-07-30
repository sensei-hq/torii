// Pure, client-side derivations for the Torii Playground meters + quality-judge panel. Kept
// out of the component (and out of the .svelte.ts store) so they unit-test in a node env — no
// $env / Tauri pulled in (mirrors src/lib/ask.ts / src/lib/home.ts). Every value here is
// derived from a REAL signal: the answering `InferResult` (`cost_usd` / `duration_ms`) and the
// /v1/judge score. Latency-meter semantics are shared with Ask — re-exported so both screens
// read a duration identically (one source of truth, no drift).
export { LATENCY_MAX_MS, LATENCY_SLOW_MS, fmtLatency, latencyTone } from './ask'

/** Full-scale for the cost meter (USD). A pricier answer clamps to 100% (Meter clamps). */
export const COST_MAX_USD = 0.05

/** Above this a query's cost reads as notable (accent fill) rather than nominal (ink fill). */
export const COST_WARN_USD = 0.02

/**
 * Format a query cost for the meter's value text. `$0` stays "$0" (a local run is free); a
 * non-zero cost too small to show at 4dp reads "<$0.0001" so it never renders a misleading
 * "$0.0000". A non-finite/negative value is treated as free.
 */
export function fmtCost(usd: number): string {
	if (!Number.isFinite(usd) || usd <= 0) return '$0'
	if (usd < 0.0001) return '<$0.0001'
	return '$' + usd.toFixed(4)
}

/** Meter tone for a query cost: nominal (`ink`) until it crosses the notable threshold (`accent`). */
export function costTone(usd: number): 'ink' | 'accent' {
	return Number.isFinite(usd) && usd > COST_WARN_USD ? 'accent' : 'ink'
}

/** LLM-as-judge thresholds — at/above HIGH is trustworthy; below OK is low-confidence. */
export const JUDGE_HIGH = 0.85
export const JUDGE_OK = 0.6

/** The rendered verdict for a /v1/judge quality score (0..1, or null when unscored). */
export interface JudgeVerdict {
	/** meter fill %, 0..100 */
	pct: number
	/** meter value text ("—" when unscored) */
	display: string
	/** Meter tone: trustworthy→ink, worth-a-check→accent, low-confidence→danger */
	tone: 'ink' | 'accent' | 'danger'
	/** one-line plain-language read of the score */
	label: string
}

/**
 * Map a /v1/judge quality score to the verdict panel's fields. `null`/non-finite (the judge
 * couldn't score the answer) renders as an em dash + neutral tone — never a fabricated 0%. An
 * out-of-range score is clamped to 0..1 so the meter fill and percent stay legible.
 */
export function judgeVerdict(score: number | null | undefined): JudgeVerdict {
	if (score == null || !Number.isFinite(score)) {
		return { pct: 0, display: '—', tone: 'ink', label: "The judge couldn't score this answer." }
	}
	const clamped = Math.min(1, Math.max(0, score))
	const pct = Math.round(clamped * 100)
	const display = pct + '%'
	if (clamped >= JUDGE_HIGH)
		return { pct, display, tone: 'ink', label: 'High-confidence answer — safe to rely on.' }
	if (clamped >= JUDGE_OK)
		return { pct, display, tone: 'accent', label: 'Reasonable answer — worth a quick check.' }
	return {
		pct,
		display,
		tone: 'danger',
		label: 'Low-confidence answer — verify before relying on it.'
	}
}
