import { describe, expect, test } from 'vitest'
import {
	QUICK_ACTIONS,
	deriveHealth,
	isLocalProvider,
	toModelViews,
	type GatewayStatus
} from './home'
import type { AvailableModel } from './api'

// ── fixtures ─────────────────────────────────────────────────────────────────
const model = (over: Partial<AvailableModel> = {}): AvailableModel => ({
	full_name: 'anthropic/claude-sonnet-4-5',
	display_name: 'Sonnet',
	provider: 'anthropic',
	...over
})

const status = (over: Partial<GatewayStatus> = {}): GatewayStatus => ({
	configured: true,
	adapters: ['ollama'],
	...over
})

// ── isLocalProvider ──────────────────────────────────────────────────────────
describe('isLocalProvider', () => {
	test('classifies on-device providers case-insensitively; blank/unknown → cloud', () => {
		expect(isLocalProvider('ollama')).toBe(true)
		expect(isLocalProvider('Ollama')).toBe(true)
		expect(isLocalProvider(' EMBEDDED ')).toBe(true)
		expect(isLocalProvider('anthropic')).toBe(false)
		expect(isLocalProvider('')).toBe(false)
		expect(isLocalProvider(null)).toBe(false)
		expect(isLocalProvider(undefined)).toBe(false)
	})
})

// ── toModelViews ───────────────────────────────────────────────────────────────
describe('toModelViews', () => {
	test('maps each row and tags its plane from the provider (not a hardcoded name)', () => {
		const [v] = toModelViews([model({ full_name: 'ollama/gemma2', provider: 'ollama' })])
		expect(v).toMatchObject({ id: 'ollama/gemma2', provider: 'ollama', plane: 'local' })
		const [c] = toModelViews([model()])
		expect(c.plane).toBe('cloud')
	})

	test('de-duplicates by id (first wins) so the list never repeats a model', () => {
		const views = toModelViews([
			model({ full_name: 'x/one', display_name: 'First' }),
			model({ full_name: 'x/one', display_name: 'Dupe' }),
			model({ full_name: 'x/two', display_name: 'Two' })
		])
		expect(views).toHaveLength(2)
		expect(new Set(views.map((v) => v.id))).toEqual(new Set(['x/one', 'x/two']))
		// first occurrence wins — the later "Dupe" label is discarded.
		expect(views.find((v) => v.id === 'x/one')?.name).toBe('First')
	})

	test('a blank display_name degrades to the id — a row never renders as ""', () => {
		const [v] = toModelViews([model({ full_name: 'p/raw-id', display_name: '' })])
		expect(v.name).toBe('p/raw-id')
	})

	test('rows with no usable id are dropped (a blank id is un-routable)', () => {
		const views = toModelViews([
			model({ full_name: '' }),
			model({ full_name: '   ' }),
			model({ full_name: 'ok/id' })
		])
		expect(views.map((v) => v.id)).toEqual(['ok/id'])
	})

	test('orders on-device models first, then alphabetical within each plane', () => {
		const views = toModelViews([
			model({ full_name: 'a/zeta', display_name: 'Zeta', provider: 'anthropic' }),
			model({ full_name: 'a/alpha', display_name: 'Alpha', provider: 'anthropic' }),
			model({ full_name: 'o/local-b', display_name: 'Local B', provider: 'ollama' }),
			model({ full_name: 'o/local-a', display_name: 'Local A', provider: 'ollama' })
		])
		expect(views.map((v) => v.name)).toEqual(['Local A', 'Local B', 'Alpha', 'Zeta'])
		expect(views.slice(0, 2).every((v) => v.plane === 'local')).toBe(true)
	})

	test('empty / nullish input yields an empty list (no throw)', () => {
		expect(toModelViews([])).toEqual([])
		expect(toModelViews(undefined as unknown as AvailableModel[])).toEqual([])
	})
})

// ── deriveHealth ─────────────────────────────────────────────────────────────
describe('deriveHealth', () => {
	test('healthy (cloud reachable + local configured) → no banner', () => {
		const h = deriveHealth({ status: status(), cloudReachable: true })
		expect(h.tone).toBe('ok')
		expect(h.show).toBe(false)
	})

	test('cloud down but local ok → OFFLINE banner that reassures on-device still works', () => {
		const h = deriveHealth({ status: status(), cloudReachable: false })
		expect(h.tone).toBe('offline')
		expect(h.show).toBe(true)
		// The contract: this case must NOT read as a hard-down "nothing works" message.
		expect(h.detail.toLowerCase()).toContain('on-device')
	})

	test('local unavailable but cloud ok → DEGRADED (routes through the cloud), not offline', () => {
		const h = deriveHealth({ status: null, cloudReachable: true })
		expect(h.tone).toBe('degraded')
		expect(h.show).toBe(true)
	})

	test('local counts as down when configured=false OR it has zero adapters', () => {
		expect(deriveHealth({ status: status({ configured: false }), cloudReachable: true }).tone).toBe(
			'degraded'
		)
		expect(deriveHealth({ status: status({ adapters: [] }), cloudReachable: true }).tone).toBe(
			'degraded'
		)
	})

	test('both planes down → OFFLINE with a headline (nothing reachable)', () => {
		const h = deriveHealth({ status: null, cloudReachable: false })
		expect(h.tone).toBe('offline')
		expect(h.show).toBe(true)
		expect(h.headline.length).toBeGreaterThan(0)
	})
})

// ── QUICK_ACTIONS ────────────────────────────────────────────────────────────
describe('QUICK_ACTIONS', () => {
	// The desktop app routes that actually exist (apps/desktop/src/routes/(app)/*). A tile
	// pointing anywhere else is a dead link — this guard fails if one drifts.
	const APP_ROUTES = new Set([
		'/ask',
		'/compare',
		'/playground',
		'/activity',
		'/settings',
		'/library',
		'/models',
		'/workflows'
	])

	test('every tile routes to an existing app screen (no dead links)', () => {
		for (const a of QUICK_ACTIONS) {
			expect(a.route.startsWith('/')).toBe(true)
			expect(APP_ROUTES.has(a.route)).toBe(true)
		}
	})

	test('keys, routes and icons are unique and non-empty', () => {
		expect(new Set(QUICK_ACTIONS.map((a) => a.key)).size).toBe(QUICK_ACTIONS.length)
		expect(new Set(QUICK_ACTIONS.map((a) => a.route)).size).toBe(QUICK_ACTIONS.length)
		expect(QUICK_ACTIONS.every((a) => a.icon.startsWith('i-solar-') && a.title.length > 0)).toBe(
			true
		)
	})
})
