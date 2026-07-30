import { describe, expect, test } from 'vitest'
import {
	LATENCY_MAX_MS,
	LATENCY_SLOW_MS,
	fmtLatency,
	latencyTone,
	pinnableForPlane,
	routingReason,
	toPinnable,
	type PinnableModel
} from './ask'
import type { AvailableModel } from './api'

// ── fixtures ─────────────────────────────────────────────────────────────────
const cloud = (over: Partial<AvailableModel> = {}): AvailableModel => ({
	full_name: 'anthropic/claude-sonnet-4-5',
	display_name: 'Sonnet',
	provider: 'anthropic',
	...over
})

// ── toPinnable ─────────────────────────────────────────────────────────────────
describe('toPinnable', () => {
	test('local models come first and are tagged local; cloud after, tagged cloud', () => {
		const out = toPinnable([cloud()], [{ id: 'gemma2:2b', name: 'Gemma 2' }])
		expect(out.map((m) => m.plane)).toEqual(['local', 'cloud'])
		expect(out[0]).toMatchObject({ id: 'gemma2:2b', name: 'Gemma 2', plane: 'local' })
		expect(out[1]).toMatchObject({ id: 'anthropic/claude-sonnet-4-5', plane: 'cloud' })
	})

	test('de-duplicates by id across BOTH sources (first wins) so the picker never repeats', () => {
		const out = toPinnable(
			[cloud({ full_name: 'x/one', display_name: 'Cloud One' })],
			[
				{ id: 'x/one', name: 'Local One' },
				{ id: 'x/one', name: 'Dupe' }
			]
		)
		// only the first 'x/one' survives — and the local one wins the cross-source collision.
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({ id: 'x/one', name: 'Local One', plane: 'local' })
	})

	test('a blank display/name degrades to the id — an option never renders as ""', () => {
		const [c] = toPinnable([cloud({ full_name: 'p/raw', display_name: '' })], [])
		expect(c.name).toBe('p/raw')
		const [l] = toPinnable([], [{ id: 'l/raw', name: '' }])
		expect(l.name).toBe('l/raw')
	})

	test('rows with no usable id are dropped (a blank id is un-pinnable)', () => {
		const out = toPinnable(
			[cloud({ full_name: '   ' }), cloud({ full_name: 'ok/cloud' })],
			[{ id: '', name: 'x' }]
		)
		expect(out.map((m) => m.id)).toEqual(['ok/cloud'])
	})

	test('nullish inputs yield an empty list (no throw)', () => {
		expect(
			toPinnable(undefined as unknown as AvailableModel[], undefined as unknown as [])
		).toEqual([])
	})
})

// ── pinnableForPlane ─────────────────────────────────────────────────────────
describe('pinnableForPlane', () => {
	const all: PinnableModel[] = [
		{ id: 'l1', name: 'L1', plane: 'local' },
		{ id: 'c1', name: 'C1', plane: 'cloud' },
		{ id: 'l2', name: 'L2', plane: 'local' }
	]
	test('returns ONLY the models runnable on the requested plane', () => {
		// The picker is plane-scoped: pinning a cloud model on the local plane would target an
		// engine that cannot serve it, so the wrong-plane models must not be offered.
		expect(pinnableForPlane(all, 'local').map((m) => m.id)).toEqual(['l1', 'l2'])
		expect(pinnableForPlane(all, 'cloud').map((m) => m.id)).toEqual(['c1'])
	})
	test('nullish input yields an empty list (no throw)', () => {
		expect(pinnableForPlane(undefined as unknown as PinnableModel[], 'local')).toEqual([])
	})
})

// ── routingReason ──────────────────────────────────────────────────────────────
describe('routingReason', () => {
	test('local plane: names the on-device model and asserts nothing left the machine', () => {
		const r = routingReason({ plane: 'local', pinned: false, model: 'gemma2:2b' })
		expect(r).toContain('gemma2:2b')
		expect(r.toLowerCase()).toContain('on your device')
		expect(r.toLowerCase()).toContain('nothing left this machine')
	})

	test('cloud + pinned: says the pin skipped auto-routing (and keys stay server-side)', () => {
		const r = routingReason({ plane: 'cloud', pinned: true, model: 'anthropic/sonnet' })
		expect(r).toContain('anthropic/sonnet')
		expect(r.toLowerCase()).toContain('pinned')
		expect(r.toLowerCase()).toContain('server-side')
	})

	test('cloud + auto: says it was auto-routed (distinct from the pinned message)', () => {
		const auto = routingReason({ plane: 'cloud', pinned: false, model: 'gw/default' })
		const pinned = routingReason({ plane: 'cloud', pinned: true, model: 'gw/default' })
		expect(auto.toLowerCase()).toContain('auto-routed')
		expect(auto).not.toEqual(pinned)
	})

	test('a missing model name degrades to a plane-appropriate phrase (never blank)', () => {
		const local = routingReason({ plane: 'local', pinned: false, model: '' })
		const cloud = routingReason({ plane: 'cloud', pinned: false, model: null })
		expect(local).toContain('the on-device model')
		expect(cloud).toContain('the gateway default')
	})
})

// ── fmtLatency / latencyTone ───────────────────────────────────────────────────
describe('fmtLatency', () => {
	test('sub-second renders in ms, one second and up in seconds (1dp)', () => {
		expect(fmtLatency(1)).toBe('1 ms')
		expect(fmtLatency(842)).toBe('842 ms')
		expect(fmtLatency(999)).toBe('999 ms')
		expect(fmtLatency(1000)).toBe('1.0 s')
		expect(fmtLatency(2600)).toBe('2.6 s')
	})
	test('a non-positive / non-finite duration renders as an em dash, not "0 ms"', () => {
		expect(fmtLatency(0)).toBe('—')
		expect(fmtLatency(-5)).toBe('—')
		expect(fmtLatency(Number.NaN)).toBe('—')
	})
})

describe('latencyTone', () => {
	test('nominal below the slow threshold, accent above it', () => {
		expect(latencyTone(LATENCY_SLOW_MS)).toBe('ink')
		expect(latencyTone(LATENCY_SLOW_MS + 1)).toBe('accent')
		expect(latencyTone(0)).toBe('ink')
	})
	test('the slow threshold sits within the meter full-scale (so it renders as partial fill)', () => {
		expect(LATENCY_SLOW_MS).toBeLessThan(LATENCY_MAX_MS)
	})
})
