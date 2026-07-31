import { describe, expect, test } from 'vitest'
import {
	avgLatencySec,
	costTrend,
	dateEyebrow,
	displayName,
	execPlaneSplit,
	greeting,
	heroInsight,
	money,
	setupSpine,
	trendSummary,
	type SetupStep
} from './overview'
import type { BudgetNode, ModelRow, Provider, RequestRow, RoutingStep } from './api'

// ── fixtures ─────────────────────────────────────────────────────────────────
const row = (over: Partial<RequestRow> = {}): RequestRow => ({
	id: Math.random().toString(36).slice(2),
	chain_id: 'chat',
	adapter: 'anthropic',
	model: 'claude-sonnet-4-5',
	execution_location: 'cloud',
	input_tokens: 30,
	output_tokens: 24,
	cost_usd: 0.01,
	duration_ms: 500,
	recorded_at: '2026-07-25T10:37:00Z',
	status: 'success',
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

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
	full_name: 'anthropic/claude-sonnet-4-5',
	display_name: 'Sonnet',
	description: null,
	context_window: 200000,
	max_output_tokens: 8192,
	released_on: null,
	deprecated_on: null,
	provider: 'anthropic',
	reachable: true,
	enabled: true,
	...over
})

const step = (over: Partial<RoutingStep> = {}): RoutingStep => ({
	id: Math.random().toString(36).slice(2),
	chain_name: 'default',
	sequence_order: 0,
	plane: 'cloud',
	router: 'anthropic',
	model: 'claude-sonnet-4-5',
	is_active: true,
	...over
})

const node = (over: Partial<BudgetNode> = {}): BudgetNode => ({
	id: 'org',
	parent_id: null,
	kind: 'org',
	name: 'Northwind',
	cap_amount: 100,
	spent_amount: 10,
	reserved_amount: 0,
	alert_threshold: null,
	free_floor_enabled: true,
	enforcement: 'hard',
	period: 'month',
	...over
})

// ── money ────────────────────────────────────────────────────────────────────
test('money: 2dp, and NaN/Infinity collapse to $0.00 (never renders "$NaN")', () => {
	expect(money(1.5)).toBe('$1.50')
	expect(money(Number.NaN)).toBe('$0.00')
	expect(money(Infinity)).toBe('$0.00')
})

// ── execPlaneSplit ─────────────────────────────────────────────────────────────
describe('execPlaneSplit', () => {
	test('classifies local / cloud / unknown and sums cost per plane', () => {
		const s = execPlaneSplit([
			row({ execution_location: 'local', cost_usd: 0 }),
			row({ execution_location: 'local', cost_usd: 0 }),
			row({ execution_location: 'cloud', cost_usd: 0.02 }),
			row({ execution_location: 'eu-west-2', cost_usd: 0.03 }), // any non-local = cloud
			row({ execution_location: null, cost_usd: 0.05 }) // unrecorded = unknown
		])
		expect(s.local).toBe(2)
		expect(s.cloud).toBe(2)
		expect(s.unknown).toBe(1)
		expect(s.total).toBe(5)
		expect(s.localCost).toBe(0)
		expect(s.cloudCost).toBeCloseTo(0.05)
	})

	test('percentages are shares of ALL calls (incl. unknown) and round to 100-scale', () => {
		const s = execPlaneSplit([
			row({ execution_location: 'local' }),
			row({ execution_location: 'cloud' }),
			row({ execution_location: 'cloud' }),
			row({ execution_location: 'cloud' })
		])
		expect(s.localPct).toBe(25)
		expect(s.cloudPct).toBe(75)
	})

	test('empty ledger yields all-zero split with 0% (no divide-by-zero)', () => {
		const s = execPlaneSplit([])
		expect(s).toMatchObject({ local: 0, cloud: 0, unknown: 0, total: 0, localPct: 0, cloudPct: 0 })
	})
})

// ── costTrend ──────────────────────────────────────────────────────────────────
describe('costTrend', () => {
	test('returns exactly `days` points, oldest → newest, one per calendar day', () => {
		const pts = costTrend([row({ recorded_at: '2026-07-25T10:00:00Z' })], 14)
		expect(pts).toHaveLength(14)
		// strictly ascending day keys
		const sorted = [...pts].map((p) => p.day).sort()
		expect(pts.map((p) => p.day)).toEqual(sorted)
	})

	test('window is anchored at the latest activity, not wall-clock now', () => {
		// data lives in the past relative to `now`; the last bucket must still hold it.
		const pts = costTrend(
			[row({ recorded_at: '2026-07-25T10:00:00Z' })],
			14,
			new Date('2026-09-01T00:00:00Z')
		)
		expect(pts[pts.length - 1].day).toBe('2026-07-25')
		expect(pts[pts.length - 1].calls).toBe(1)
	})

	test('buckets by UTC day and blends cost-per-call within a day', () => {
		const pts = costTrend(
			[
				row({ recorded_at: '2026-07-25T01:00:00Z', cost_usd: 0.02 }),
				row({ recorded_at: '2026-07-25T23:00:00Z', cost_usd: 0.04 }),
				row({ recorded_at: '2026-07-24T12:00:00Z', cost_usd: 0.1 })
			],
			14
		)
		const d25 = pts.find((p) => p.day === '2026-07-25')!
		expect(d25.calls).toBe(2)
		expect(d25.cost).toBeCloseTo(0.06)
		expect(d25.costPerCall).toBeCloseTo(0.03) // 0.06 / 2
		const d24 = pts.find((p) => p.day === '2026-07-24')!
		expect(d24.costPerCall).toBeCloseTo(0.1)
	})

	test('days with no calls are 0-filled (costPerCall 0, not a fabricated value)', () => {
		const pts = costTrend([row({ recorded_at: '2026-07-25T10:00:00Z' })], 3)
		const empties = pts.filter((p) => p.calls === 0)
		expect(empties.length).toBe(2)
		expect(empties.every((p) => p.costPerCall === 0 && p.cost === 0)).toBe(true)
	})

	test('empty ledger → all-zero series of the requested length', () => {
		const pts = costTrend([], 7, new Date('2026-07-30T00:00:00Z'))
		expect(pts).toHaveLength(7)
		expect(pts.every((p) => p.calls === 0)).toBe(true)
		expect(pts[pts.length - 1].day).toBe('2026-07-30')
	})
})

describe('trendSummary', () => {
	test('latest/earliest/deltaPct read from days-with-calls only', () => {
		const pts = costTrend(
			[
				row({ recorded_at: '2026-07-24T10:00:00Z', cost_usd: 0.04 }),
				row({ recorded_at: '2026-07-26T10:00:00Z', cost_usd: 0.03 })
			],
			14
		)
		const s = trendSummary(pts)
		expect(s.hasData).toBe(true)
		expect(s.earliest).toBeCloseTo(0.04)
		expect(s.latest).toBeCloseTo(0.03)
		expect(s.deltaPct).toBe(-25) // (0.03-0.04)/0.04
	})

	test('no calls in window → hasData false, no NaN delta', () => {
		const s = trendSummary(costTrend([], 14, new Date('2026-07-30T00:00:00Z')))
		expect(s.hasData).toBe(false)
		expect(Number.isNaN(s.deltaPct)).toBe(false)
	})
})

// ── setupSpine ─────────────────────────────────────────────────────────────────
describe('setupSpine', () => {
	test('always yields the connect → register → route spine in order', () => {
		const spine = setupSpine([], [], [])
		expect(spine.map((s) => s.key)).toEqual(['connect', 'register', 'route'])
		expect(spine.map((s) => s.route)).toEqual(['/connections', '/models', '/routing'])
	})

	test('connect: keyless + credentialed count as connected; bare key-required does not', () => {
		const spine = setupSpine(
			[
				provider({ name: 'ollama', requires_key: false }), // local → connected
				provider({ name: 'anthropic', requires_key: true, connected: true }), // BYOK → connected
				provider({ name: 'openai', requires_key: true, oauth_connected: true }), // OAuth → connected
				provider({ name: 'openrouter', requires_key: true }) // needs a key
			],
			[],
			[]
		)
		const connect = spine[0]
		expect(connect.stat).toBe(3)
		expect(connect.unit).toBe('/ 4 routers')
		expect(connect.pct).toBe(75)
		expect(connect.done).toBe(false)
		expect(connect.sub).toBe('1 need a key')
	})

	test('register: reachable split into on-device (keyless router) vs via-gateway', () => {
		const spine = setupSpine(
			[provider({ name: 'ollama', requires_key: false }), provider({ name: 'anthropic' })],
			[
				model({ provider: 'ollama', reachable: true }),
				model({ provider: 'anthropic', reachable: true }),
				model({ provider: 'anthropic', reachable: false }) // unreachable → not counted
			],
			[]
		)
		const reg = spine[1]
		expect(reg.stat).toBe(2) // reachable
		expect(reg.unit).toBe('/ 3 reachable')
		expect(reg.sub).toBe('1 on-device · 1 via gateway')
		expect(reg.done).toBe(false) // one model unreachable
	})

	test('route: counts active steps and distinct chains; done when any step active', () => {
		const spine = setupSpine(
			[],
			[],
			[
				step({ chain_name: 'default', is_active: true }),
				step({ chain_name: 'default', is_active: false }),
				step({ chain_name: 'cheap', is_active: true })
			]
		)
		const route = spine[2]
		expect(route.stat).toBe(2) // active steps
		expect(route.pct).toBe(67) // 2/3
		expect(route.sub).toBe('2 chains configured')
		expect(route.done).toBe(true)
	})

	test('all-satisfied spine marks every step done', () => {
		const spine = setupSpine(
			[provider({ name: 'ollama', requires_key: false })],
			[model({ provider: 'ollama', reachable: true })],
			[step({ is_active: true })]
		)
		expect(spine.every((s) => s.done)).toBe(true)
	})
})

// ── heroInsight ────────────────────────────────────────────────────────────────
describe('heroInsight', () => {
	const spine = (over: Partial<SetupStep> = {}): SetupStep[] => [
		{
			key: 'connect',
			title: 'Connect routers',
			icon: '',
			route: '/connections',
			stat: 1,
			unit: '',
			pct: 100,
			done: true,
			sub: '',
			...over
		}
	]

	test('budget pressure (>=90% of a cap) is the top-priority insight', () => {
		const plane = execPlaneSplit([row({ execution_location: 'local' })]) // local present…
		const h = heroInsight({
			requests: [row({ execution_location: 'local' })],
			plane,
			spend: 95,
			orgRoot: node({ cap_amount: 100, spent_amount: 95 }),
			budgetPct: 95,
			setup: spine()
		})
		// …but budget danger must still win over the local-savings insight.
		expect(h.tone).toBe('danger')
		expect(h.figure).toBe('95%')
		expect(h.actionRoute).toBe('/organization')
	})

	test('no traffic + incomplete setup → onboarding, pointing at the first unfinished step', () => {
		const h = heroInsight({
			requests: [],
			plane: execPlaneSplit([]),
			spend: 0,
			orgRoot: node({ cap_amount: null, spent_amount: 0 }),
			budgetPct: 0,
			setup: spine({ done: false, title: 'Connect routers', route: '/connections' })
		})
		expect(h.tone).toBe('accent')
		expect(h.actionRoute).toBe('/connections')
		expect(h.figure).toBe('connect routers')
	})

	test('on-device carrying load → local-savings insight with the real local share', () => {
		const reqs = [
			row({ execution_location: 'local' }),
			row({ execution_location: 'local' }),
			row({ execution_location: 'cloud', cost_usd: 0.5 })
		]
		const h = heroInsight({
			requests: reqs,
			plane: execPlaneSplit(reqs),
			spend: 0.5,
			budgetPct: 5,
			orgRoot: node({ spent_amount: 5 }),
			setup: spine()
		})
		expect(h.tone).toBe('accent')
		expect(h.figure).toBe('67%') // 2 of 3
		expect(h.actionRoute).toBe('/routing')
	})

	test('all-cloud traffic, healthy budget → plain spend summary', () => {
		const reqs = [row({ execution_location: 'cloud' }), row({ execution_location: 'cloud' })]
		const h = heroInsight({
			requests: reqs,
			plane: execPlaneSplit(reqs),
			spend: 4,
			budgetPct: 10,
			orgRoot: node({ spent_amount: 10 }),
			setup: spine()
		})
		expect(h.tone).toBe('ink')
		expect(h.figure).toBe('2 calls')
		expect(h.actionRoute).toBe('/requests')
	})
})

// ── header helpers (match the mock's "Wed · 22 Apr · last 24h" / "Good morning, Aiko.") ──
describe('header helpers', () => {
	test('greeting is time-of-day bucketed', () => {
		const at = (h: number) => greeting(new Date(2026, 3, 22, h))
		expect(at(8)).toBe('Good morning')
		expect(at(13)).toBe('Good afternoon')
		expect(at(20)).toBe('Good evening')
	})

	test('displayName takes the first token of the email local-part, title-cased', () => {
		expect(displayName('jerry.thomas@x.co')).toBe('Jerry')
		expect(displayName('owner2@strategos.local')).toBe('Owner2')
		expect(displayName('')).toBe('')
		expect(displayName(null)).toBe('')
	})

	test('dateEyebrow renders "<Wd> · <D> <Mon> · last 24h"', () => {
		// 2026-04-22 is a Wednesday
		expect(dateEyebrow(new Date(2026, 3, 22, 9))).toBe('Wed · 22 Apr · last 24h')
	})

	test('avgLatencySec means duration_ms → seconds, 0 when none', () => {
		expect(avgLatencySec([row({ duration_ms: 1000 }), row({ duration_ms: 2000 })])).toBe(1.5)
		expect(avgLatencySec([])).toBe(0)
	})
})
