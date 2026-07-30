// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { alertsState } from './alerts-state.svelte'
import type { AlertSignals } from './alerts'
import type { Provider } from './api'

const provider = (over: Partial<Provider> = {}): Provider => ({
	name: 'openrouter',
	api_base_url: 'https://openrouter.ai',
	is_active: true,
	requires_key: true,
	connected: false,
	connected_at: null,
	oauth_connected: false,
	oauth_connected_at: null,
	...over
})
// two unconnected routers + an over-cap node → 2 alerts to work with
const signals = (): AlertSignals => ({
	nodes: [
		{
			id: 'org',
			parent_id: null,
			kind: 'org',
			name: 'Org',
			cap_amount: 100,
			spent_amount: 95,
			reserved_amount: 0,
			enforcement: 'hard',
			period: 'month'
		}
	],
	requests: [],
	providers: [provider({ name: 'a' }), provider({ name: 'b' })]
})

describe('alertsState', () => {
	beforeEach(() => alertsState.reset())

	test('load() derives alerts and exposes them via visible/count', () => {
		alertsState.load(signals())
		expect(alertsState.count).toBeGreaterThan(0)
		expect(alertsState.visible.length).toBe(alertsState.count)
	})

	test('dismiss() hides one alert — visible shrinks, all is retained', () => {
		alertsState.load(signals())
		const before = alertsState.visible.length
		const id = alertsState.visible[0].id
		alertsState.dismiss(id)
		expect(alertsState.visible.length).toBe(before - 1)
		expect(alertsState.all.length).toBe(before) // dismissal is a view concern, not deletion
		expect(alertsState.visible.some((a) => a.id === id)).toBe(false)
	})

	test('load() clears prior dismissals (a fresh read starts clean)', () => {
		alertsState.load(signals())
		alertsState.dismiss(alertsState.visible[0].id)
		expect(alertsState.visible.length).toBeLessThan(alertsState.all.length)
		alertsState.load(signals())
		expect(alertsState.visible.length).toBe(alertsState.all.length)
	})

	test('reset() empties everything', () => {
		alertsState.load(signals())
		alertsState.reset()
		expect(alertsState.all).toEqual([])
		expect(alertsState.count).toBe(0)
	})
})
