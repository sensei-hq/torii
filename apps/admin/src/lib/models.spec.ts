import { describe, expect, test } from 'vitest'
import { catalogSummary, filterModels, providerList, tokenLabel } from './models'
import type { ModelRow } from './api'

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
	full_name: 'anthropic/claude-sonnet-4-5',
	display_name: 'Claude Sonnet 4.5',
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

describe('providerList', () => {
	test('distinct providers, alphabetical', () => {
		const list = providerList([
			model({ provider: 'openai' }),
			model({ provider: 'anthropic' }),
			model({ provider: 'openai' }),
			model({ provider: 'ollama' })
		])
		expect(list).toEqual(['anthropic', 'ollama', 'openai'])
	})

	test('empty catalog → no providers', () => {
		expect(providerList([])).toEqual([])
	})
})

describe('filterModels', () => {
	const catalog = [
		model({ full_name: 'a', display_name: 'Zeta', provider: 'openai' }),
		model({ full_name: 'b', display_name: 'Alpha', provider: 'anthropic' }),
		model({ full_name: 'c', display_name: 'Mu', provider: 'openai' })
	]

	test("'all' returns everything, sorted by display label", () => {
		expect(filterModels(catalog, 'all').map((m) => m.display_name)).toEqual(['Alpha', 'Mu', 'Zeta'])
	})

	test('narrows to one provider', () => {
		expect(filterModels(catalog, 'openai').map((m) => m.full_name)).toEqual(['c', 'a'])
	})

	test('falls back to full_name when display_name is null', () => {
		const [only] = filterModels([model({ display_name: null, full_name: 'x/y' })])
		expect(only.full_name).toBe('x/y')
	})

	test('does not mutate the input array', () => {
		const input = [...catalog]
		filterModels(input, 'all')
		expect(input).toEqual(catalog)
	})
})

describe('catalogSummary', () => {
	test('counts total, reachable, enabled, and distinct providers', () => {
		const s = catalogSummary([
			model({ provider: 'anthropic', reachable: true, enabled: true }),
			model({ provider: 'openai', reachable: false, enabled: true }),
			model({ provider: 'openai', reachable: true, enabled: false })
		])
		expect(s).toEqual({ total: 3, reachable: 2, enabled: 2, providers: 2 })
	})

	test('empty catalog → all zero', () => {
		expect(catalogSummary([])).toEqual({ total: 0, reachable: 0, enabled: 0, providers: 0 })
	})
})

describe('tokenLabel', () => {
	test('compacts thousands to a K label', () => {
		expect(tokenLabel(200000)).toBe('200K')
		expect(tokenLabel(8192)).toBe('8K')
	})

	test('sub-thousand renders as-is', () => {
		expect(tokenLabel(512)).toBe('512')
	})

	test('null renders an em dash', () => {
		expect(tokenLabel(null)).toBe('—')
	})
})
