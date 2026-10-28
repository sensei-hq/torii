// Pure derivations for the run detail screen (System One §9.2). A run is an accounting
// object, so this file is presentation only: which tone a lifecycle status carries, how much
// of the run's limit is booked, and how to say — in one sentence — why the run's two dollar
// figures legitimately differ. No fetching, no `$env` → unit-testable.
import type { RunCursor, RunDetail, RunsResponse } from './api'

/** Chip tones the run screen uses (the subset of `Chip`'s that means something here). */
export type RunTone = 'accent' | 'success' | 'warning' | 'danger' | 'mute'

/**
 * Lifecycle tone for `runs.run_status`. Only `failed` is an alarm: `paused` is a timer, and
 * `cancelled` is a decision someone made, not an error. A null status (no schedule row) is
 * mute — a charge is legible before the driver writes the schedule, so absence is not failure.
 */
export function statusTone(status: string | null): RunTone {
	switch (status) {
		case 'completed':
			return 'success'
		case 'waking':
			return 'accent'
		case 'paused':
			return 'warning'
		case 'failed':
			return 'danger'
		case 'cancelled':
			return 'mute'
		default:
			return 'mute'
	}
}

/** Title-case an unknown status slug, so a new scheduler state reads rather than blares. */
function humanize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Human label for a run's lifecycle; unknown statuses are humanized, never hidden. */
export function statusLabel(status: string | null): string {
	if (!status) return 'No schedule'
	const known: Record<string, string> = {
		waking: 'Waking',
		paused: 'Paused',
		completed: 'Completed',
		failed: 'Failed',
		cancelled: 'Cancelled'
	}
	return known[status] ?? humanize(status)
}

/**
 * Share of the run's money limit that governance has booked, 0-100. `null` when the run was
 * admitted with no money cap (`limit_usd` 0) — a bar with no denominator would read as "0% of
 * something" when the honest answer is "nothing to be a fraction of".
 */
export function bookedPct(booked: number, limit: number): number | null {
	if (!Number.isFinite(limit) || limit <= 0) return null
	const b = Number.isFinite(booked) ? booked : 0
	return Math.min(100, Math.round((b / limit) * 100))
}

/**
 * A run's spend as a row shows it: the sum of the calls' own prices, which is always current.
 * Deliberately NOT `booked_usd` — that watermark lags by design (see `spendNote`), and a list
 * that showed it would report $0 for every run still in flight.
 */
export function currentSpend(run: RunDetail): number {
	const v = Number(run.totals?.cost_usd ?? 0)
	return Number.isFinite(v) ? v : 0
}

/**
 * Does the booked watermark still lag what the calls cost? True for a live run, or one whose
 * settle has not folded yet — the list-row form of the gap `spendNote` explains in full. The
 * tolerance matches `spendNote`, so the marker and the sentence never disagree.
 */
export function bookingPending(run: RunDetail): boolean {
	const booked = Number(run.booked_usd ?? 0)
	if (!Number.isFinite(booked)) return false
	return currentSpend(run) - booked >= 0.0005
}

// ── the runs list: which subset is shown, and how it walks back through the ledger ────────
/**
 * The lifecycle states the list can be filtered to, in the order `runs.run_status` declares them,
 * plus `unscheduled` for the charge-only state — a run governance has charged before the driver
 * wrote a schedule row. Mirrors the gateway's own `RUN_STATUS_FILTERS`, which rejects anything
 * else with a 400, so the two have to agree about what exists.
 */
export const RUN_STATUS_FILTERS = [
	'waking',
	'paused',
	'completed',
	'failed',
	'cancelled',
	'unscheduled'
] as const

/** `'all'` plus one filter per lifecycle state. */
export type RunStatusFilter = 'all' | (typeof RUN_STATUS_FILTERS)[number]

/**
 * Label for a filter control. `unscheduled` reuses the words the status tag already uses for a
 * missing lifecycle — a second name for one state is how two screens start disagreeing.
 */
export function filterLabel(filter: RunStatusFilter): string {
	return filter === 'all'
		? 'All'
		: filter === 'unscheduled'
			? statusLabel(null)
			: statusLabel(filter)
}

/**
 * Is the list narrowed at all? The empty state depends on it: "no runs yet" is only true when
 * nothing was filtered out, and the failures toggle is a second way to be looking at zero rows
 * while the ledger is full.
 */
export function narrowed(status: RunStatusFilter, failedOnly: boolean): boolean {
	return status !== 'all' || failedOnly
}

/**
 * The cursor that walks back one page, or null when there is nothing older to show. `has_more` is
 * what decides — not the page's length — so the list never offers a button whose only honest
 * answer is an empty table.
 */
export function nextCursor(page: RunsResponse): RunCursor | null {
	if (!page.has_more) return null
	const last = page.runs.at(-1)
	if (!last?.submitted_at || !last.run_id) return null
	return { submitted_at: last.submitted_at, run_id: last.run_id }
}

/** `$X.XXX` — a run's costs are often sub-cent, so the run screen keeps three places. */
export function usd(n: number | null | undefined): string {
	const v = Number(n ?? 0)
	return '$' + (Number.isFinite(v) ? v : 0).toFixed(3)
}

/**
 * One sentence for the two figures on the run screen, or '' when they agree.
 *
 * `booked_usd` (`run_charges.recorded_micro_usd`) is what governance has charged to the run's
 * budget nodes — the number Budgets & billing shows — and it is a watermark that only moves
 * when the run settles. `totals.cost_usd` is the sum of the calls' own prices and is always
 * current. §9.4 kept both rather than picking one; this is where the screen says so, instead
 * of leaving an operator to wonder why a $0.25 run shows $0 booked.
 */
export function spendNote(run: RunDetail): string {
	const calls = Number(run.totals?.cost_usd ?? 0)
	const booked = Number(run.booked_usd ?? 0)
	if (Math.abs(booked - calls) < 0.0005) return ''
	return `Booked ${usd(booked)} to the budget nodes; the calls below total ${usd(calls)}. The booking is a watermark and catches up when the run settles.`
}
