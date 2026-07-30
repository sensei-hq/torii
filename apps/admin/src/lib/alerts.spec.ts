import { describe, expect, test } from 'vitest'
import { deriveAlerts, BUDGET_ALERT_PCT, type AlertSignals } from './alerts'
import type { BudgetNode, Provider, RequestRow } from './api'

const node = (over: Partial<BudgetNode> = {}): BudgetNode => ({
	id: 'org',
	parent_id: null,
	kind: 'org',
	name: 'Org',
	cap_amount: 100,
	spent_amount: 0,
	reserved_amount: 0,
	enforcement: 'hard',
	period: 'month',
	...over
})
const req = (over: Partial<RequestRow> = {}): RequestRow => ({
	id: Math.random().toString(36).slice(2),
	chain_id: 'chat',
	adapter: 'anthropic',
	model: 'claude',
	execution_location: 'cloud',
	input_tokens: 1,
	output_tokens: 1,
	cost_usd: 0,
	duration_ms: 10,
	status: 'success',
	recorded_at: '2026-07-30T10:00:00Z',
	...over
})
const provider = (over: Partial<Provider> = {}): Provider => ({
	name: 'anthropic',
	api_base_url: 'https://api.anthropic.com',
	is_active: true,
	requires_key: true,
	connected: false,
	connected_at: null,
	oauth_connected: false,
	oauth_connected_at: null,
	...over
})
const signals = (o: Partial<AlertSignals> = {}): AlertSignals => ({
	nodes: [],
	requests: [],
	providers: [],
	...o
})

describe('deriveAlerts', () => {
	test('empty signals → no alerts (the card shows its empty state)', () => {
		expect(deriveAlerts(signals())).toEqual([])
	})

	test('budget node at/over the threshold raises an alert; below stays quiet', () => {
		const quiet = deriveAlerts(signals({ nodes: [node({ spent_amount: 50 })] })) // 50%
		expect(quiet).toEqual([])
		const at = deriveAlerts(
			signals({ nodes: [node({ name: 'Support', spent_amount: BUDGET_ALERT_PCT })] })
		)
		expect(at).toHaveLength(1)
		expect(at[0]).toMatchObject({ severity: 'warning', route: '/billing' })
		expect(at[0].text).toContain('Support')
		expect(at[0].text).toContain(`${BUDGET_ALERT_PCT}%`)
	})

	test('a node at/over 100% is escalated to accent severity', () => {
		const [a] = deriveAlerts(signals({ nodes: [node({ spent_amount: 120 })] }))
		expect(a.severity).toBe('accent')
	})

	test('nodes with no cap never alert (no divide-by-zero, no false positive)', () => {
		expect(
			deriveAlerts(signals({ nodes: [node({ cap_amount: null, spent_amount: 999 })] }))
		).toEqual([])
	})

	test('provider health: non-success calls group per adapter with a count', () => {
		const [a] = deriveAlerts(
			signals({
				requests: [
					req({ adapter: 'openai', status: 'error' }),
					req({ adapter: 'openai', status: 'error' }),
					req({ adapter: 'openai', status: 'success' })
				]
			})
		)
		expect(a).toMatchObject({ id: 'health-openai', severity: 'warning', route: '/requests' })
		expect(a.text).toContain('2 errors')
	})

	test('unconnected active key-required routers raise one accent alert (keyless/connected excluded)', () => {
		const [a] = deriveAlerts(
			signals({
				providers: [
					provider({ name: 'openrouter' }), // needs a key → counts
					provider({ name: 'ollama', requires_key: false }), // keyless → excluded
					provider({ name: 'anthropic', connected: true }), // connected → excluded
					provider({ name: 'off', is_active: false }) // inactive → excluded
				]
			})
		)
		expect(a).toMatchObject({ id: 'conn-missing', severity: 'accent', route: '/connections' })
		expect(a.text).toContain('1 active router need') // singular count
	})
})
