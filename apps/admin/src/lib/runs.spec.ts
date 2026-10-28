import { expect, test } from 'vitest'
import {
	bookedPct,
	bookingPending,
	currentSpend,
	filterLabel,
	narrowed,
	nextCursor,
	RUN_STATUS_FILTERS,
	spendNote,
	statusLabel,
	statusTone,
	usd
} from './runs'
import type { RunDetail, RunsResponse } from './api'

const run = (over: Partial<RunDetail> = {}): RunDetail => ({
	run_id: '9f1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
	status: 'completed',
	reason: null,
	submitted_at: '2026-10-26T09:00:00Z',
	updated_at: '2026-10-26T09:02:00Z',
	settled: true,
	limit_usd: 2,
	booked_usd: 0.25,
	attributed_to: { id: 'u1', name: 'Platform', level: 2, level_label: 'Team' },
	totals: { calls: 2, failed: 1, cost_usd: 0.25, input_tokens: 20, output_tokens: 10 },
	...over
})

test('statusTone: only failed is an alarm; paused/cancelled are not errors', () => {
	expect(statusTone('completed')).toBe('success')
	expect(statusTone('waking')).toBe('accent')
	expect(statusTone('paused')).toBe('warning')
	expect(statusTone('failed')).toBe('danger')
	expect(statusTone('cancelled')).toBe('mute')
})

test('statusTone: a missing or unknown status is mute, never a fabricated failure', () => {
	// a charge is legible before the driver writes a schedule row
	expect(statusTone(null)).toBe('mute')
	expect(statusTone('quarantined')).toBe('mute')
})

test('statusLabel: known lifecycle words read properly; null is "No schedule"', () => {
	expect(statusLabel('completed')).toBe('Completed')
	expect(statusLabel('paused')).toBe('Paused')
	expect(statusLabel(null)).toBe('No schedule')
})

test('statusLabel: an unknown status is humanized rather than hidden', () => {
	expect(statusLabel('quarantined')).toBe('Quarantined')
})

test('bookedPct: share of the limit, null when there is no cap to be a share of', () => {
	expect(bookedPct(0.25, 2)).toBe(13)
	expect(bookedPct(2, 2)).toBe(100)
	// admitted with no money cap — a bar with no denominator would read as "0% of something"
	expect(bookedPct(0.25, 0)).toBeNull()
})

test('bookedPct: an over-booked run clamps to 100 instead of overflowing the bar', () => {
	expect(bookedPct(3, 2)).toBe(100)
})

test('spendNote: says nothing when the booked figure and the calls agree', () => {
	expect(spendNote(run({ booked_usd: 0.25, totals: { ...run().totals, cost_usd: 0.25 } }))).toBe('')
	// a rounding hair apart is still "agree" — not a discrepancy worth a sentence
	expect(spendNote(run({ booked_usd: 0.25, totals: { ...run().totals, cost_usd: 0.2502 } }))).toBe(
		''
	)
})

test('spendNote: names both figures when the charge watermark lags the calls (System One §9.4)', () => {
	const note = spendNote(run({ booked_usd: 0, totals: { ...run().totals, cost_usd: 0.25 } }))
	expect(note).toContain('$0.000')
	expect(note).toContain('$0.250')
	expect(note).toContain('settles')
})

test('currentSpend: a row shows the calls’ own prices, never the booked watermark', () => {
	// a live run: admitted, calls priced, nothing booked yet. The list must not read $0.
	const live = run({ booked_usd: 0, totals: { ...run().totals, cost_usd: 0.25 } })
	expect(currentSpend(live)).toBe(0.25)
	expect(currentSpend(run())).toBe(0.25)
})

test('currentSpend: an empty or junk cost is zero, not NaN in a cell', () => {
	expect(currentSpend(run({ totals: { ...run().totals, cost_usd: Number.NaN } }))).toBe(0)
})

test('bookingPending: true only while the booking lags the calls', () => {
	expect(bookingPending(run({ booked_usd: 0, totals: { ...run().totals, cost_usd: 0.25 } }))).toBe(
		true
	)
	expect(
		bookingPending(run({ booked_usd: 0.1, totals: { ...run().totals, cost_usd: 0.25 } }))
	).toBe(true)
	// settled: the watermark and the calls agree
	expect(bookingPending(run())).toBe(false)
	// a bookkeeping hair apart is not a marker — the same tolerance spendNote uses
	expect(
		bookingPending(run({ booked_usd: 0.25, totals: { ...run().totals, cost_usd: 0.2502 } }))
	).toBe(false)
})

test('filterLabel: a control for every state the read accepts, worded like the row tag', () => {
	expect(filterLabel('all')).toBe('All')
	expect(filterLabel('waking')).toBe('Waking')
	expect(filterLabel('failed')).toBe('Failed')
	// the charge-only state reuses the row tag's own words rather than inventing a second name
	expect(filterLabel('unscheduled')).toBe(statusLabel(null))
	for (const f of RUN_STATUS_FILTERS) expect(filterLabel(f)).not.toBe('')
})

test('narrowed: the empty state only says "no runs yet" when nothing is filtered out', () => {
	expect(narrowed('all', false)).toBe(false)
	expect(narrowed('failed', false)).toBe(true)
	// the failures toggle is the second way to be looking at zero rows in a full ledger
	expect(narrowed('all', true)).toBe(true)
	expect(narrowed('completed', true)).toBe(true)
})

test('nextCursor: the cursor is the last row served, offered only when older runs exist', () => {
	const page = (has_more: boolean): RunsResponse => ({
		has_more,
		runs: [
			run({ run_id: 'a', submitted_at: '2026-10-26T09:00:00Z' }),
			run({ run_id: 'b', submitted_at: '2026-10-25T09:00:00Z' })
		]
	})
	expect(nextCursor(page(true))).toEqual({ submitted_at: '2026-10-25T09:00:00Z', run_id: 'b' })
	// the gateway says this is the end of the ledger — no button whose only answer is an empty table
	expect(nextCursor(page(false))).toBeNull()
})

test('nextCursor: an unusable row is no cursor, not a walk-back that restarts from the top', () => {
	expect(nextCursor({ has_more: true, runs: [] })).toBeNull()
	expect(nextCursor({ has_more: true, runs: [run({ submitted_at: null })] })).toBeNull()
})

test('usd: three decimal places, resilient to junk input', () => {
	expect(usd(0.0004)).toBe('$0.000')
	expect(usd(1.239)).toBe('$1.239')
	expect(usd(null)).toBe('$0.000')
	expect(usd(Number.NaN)).toBe('$0.000')
})
