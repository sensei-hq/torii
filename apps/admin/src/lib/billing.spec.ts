import { describe, expect, test } from 'vitest'
import { costBreakdown } from './billing'
import type { RequestRow } from './api'

// ── fixture ──────────────────────────────────────────────────────────────────
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

describe('costBreakdown', () => {
	test('empty ledger → zeroed breakdown, empty lists (no throw, no NaN)', () => {
		const b = costBreakdown([])
		expect(b).toEqual({ total: 0, calls: 0, providers: [], models: [] })
	})

	test('provider aggregation sums cost_usd per adapter and reconciles to the total', () => {
		const b = costBreakdown([
			row({ adapter: 'anthropic', model: 'sonnet', cost_usd: 2 }),
			row({ adapter: 'anthropic', model: 'opus', cost_usd: 3 }),
			row({ adapter: 'openai', model: 'gpt-5', cost_usd: 4 })
		])
		expect(b.total).toBeCloseTo(9)
		expect(b.calls).toBe(3)
		// one row per distinct adapter, richest first
		expect(b.providers.map((p) => p.provider)).toEqual(['anthropic', 'openai'])
		const anthropic = b.providers.find((p) => p.provider === 'anthropic')!
		expect(anthropic.cost).toBeCloseTo(5) // 2 + 3, not just one call
		expect(anthropic.calls).toBe(2)
		// the header "$X metered" must reconcile: provider spend sums back to the total.
		const sum = b.providers.reduce((s, p) => s + p.cost, 0)
		expect(sum).toBeCloseTo(b.total)
		const calls = b.providers.reduce((s, p) => s + p.calls, 0)
		expect(calls).toBe(b.calls)
	})

	test('model aggregation keeps one row per model — a provider with two models yields two model rows but one provider row', () => {
		const b = costBreakdown([
			row({ adapter: 'anthropic', model: 'sonnet', cost_usd: 2 }),
			row({ adapter: 'anthropic', model: 'sonnet', cost_usd: 2 }), // same model → merges
			row({ adapter: 'anthropic', model: 'opus', cost_usd: 5 })
		])
		expect(b.providers).toHaveLength(1)
		expect(b.models.map((m) => m.model)).toEqual(['opus', 'sonnet']) // richest first: 5 vs 4
		const sonnet = b.models.find((m) => m.model === 'sonnet')!
		expect(sonnet.cost).toBeCloseTo(4)
		expect(sonnet.calls).toBe(2)
		expect(sonnet.provider).toBe('anthropic') // carries the serving adapter for the dot/label
		// model spend also reconciles to the total.
		expect(b.models.reduce((s, m) => s + m.cost, 0)).toBeCloseTo(b.total)
	})

	test('the same model name served by two providers stays distinct', () => {
		const b = costBreakdown([
			row({ adapter: 'openrouter', model: 'llama-4', cost_usd: 1 }),
			row({ adapter: 'together', model: 'llama-4', cost_usd: 2 })
		])
		expect(b.models).toHaveLength(2)
		expect(b.models.map((m) => m.provider).sort()).toEqual(['openrouter', 'together'])
	})

	test('pct is the rounded share of the total; total 0 → every pct is 0 (never NaN)', () => {
		const b = costBreakdown([
			row({ adapter: 'anthropic', cost_usd: 3 }),
			row({ adapter: 'openai', model: 'gpt-5', cost_usd: 1 })
		])
		const anthropic = b.providers.find((p) => p.provider === 'anthropic')!
		expect(anthropic.pct).toBe(Math.round((3 / 4) * 100)) // 75
		expect(b.providers.every((p) => Number.isFinite(p.pct))).toBe(true)

		const free = costBreakdown([row({ adapter: 'ollama', model: 'gemma', cost_usd: 0 })])
		expect(free.total).toBe(0)
		expect(free.providers[0].pct).toBe(0)
		expect(free.models[0].pct).toBe(0)
	})

	test('zero-cost (local/free) calls still surface as rows with their call count', () => {
		const b = costBreakdown([
			row({ adapter: 'ollama', model: 'gemma-4', execution_location: 'local', cost_usd: 0 }),
			row({ adapter: 'ollama', model: 'gemma-4', execution_location: 'local', cost_usd: 0 }),
			row({ adapter: 'anthropic', model: 'sonnet', cost_usd: 5 })
		])
		const ollama = b.providers.find((p) => p.provider === 'ollama')!
		expect(ollama).toBeDefined()
		expect(ollama.cost).toBe(0)
		expect(ollama.calls).toBe(2)
		expect(b.calls).toBe(3)
	})

	test('non-finite cost_usd is coerced to 0 — the total never becomes NaN/Infinity', () => {
		const b = costBreakdown([
			row({ adapter: 'anthropic', cost_usd: Number.NaN }),
			row({ adapter: 'anthropic', cost_usd: Infinity }),
			row({ adapter: 'openai', model: 'gpt-5', cost_usd: 2 })
		])
		expect(Number.isFinite(b.total)).toBe(true)
		expect(b.total).toBeCloseTo(2)
		const anthropic = b.providers.find((p) => p.provider === 'anthropic')!
		expect(anthropic.cost).toBe(0)
		expect(anthropic.calls).toBe(2)
	})

	test('missing adapter/model fall back to "unknown" rather than dropping the spend', () => {
		const b = costBreakdown([row({ adapter: '', model: '', cost_usd: 1 } as Partial<RequestRow>)])
		expect(b.providers[0].provider).toBe('unknown')
		expect(b.models[0].model).toBe('unknown')
		expect(b.total).toBeCloseTo(1)
	})
})
