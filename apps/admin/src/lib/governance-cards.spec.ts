import { describe, expect, test } from 'vitest'
import {
	actionLabel,
	agoLabel,
	auditCsvFilename,
	auditToCsv,
	AUDIT_CATEGORIES,
	categorize,
	categoryCounts,
	execPlane,
	filterByCategory,
	fleetSummary,
	seenFreshness,
	sortFleet
} from './governance-cards'
import type { AuditEvent, Device } from './api'

// Anchor "now" so relative-time derivations are deterministic.
const NOW = new Date('2026-07-30T12:00:00Z').getTime()
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// ── fixtures ─────────────────────────────────────────────────────────────────
const device = (over: Partial<Device> = {}): Device => ({
	id: Math.random().toString(36).slice(2),
	name: 'aiko-mbp',
	platform: 'macos',
	app_version: '0.1.1',
	config_version: 3,
	status: 'active',
	owner: 'a.rao',
	enrolled_at: at(30 * DAY),
	last_seen_at: at(MIN),
	...over
})

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
	id: Math.random().toString(36).slice(2),
	actor_id: '11111111-2222-3333-4444-555555555555',
	action: 'settings.set',
	target_type: 'setting',
	target_id: 'quality_judge',
	created_at: at(MIN),
	...over
})

// ── execPlane ─────────────────────────────────────────────────────────────────
describe('execPlane', () => {
	test('a desktop OS runs on-device', () => {
		expect(execPlane({ platform: 'macos' })).toBe('on-device')
		expect(execPlane({ platform: 'Windows' })).toBe('on-device')
		expect(execPlane({ platform: 'linux' })).toBe('on-device')
	})

	test('a web/browser client always routes via the gateway', () => {
		expect(execPlane({ platform: 'web · chrome' })).toBe('via-gateway')
		expect(execPlane({ platform: 'Firefox' })).toBe('via-gateway')
	})

	test('an absent/unknown platform reads as via-gateway — never over-claim a local plane', () => {
		expect(execPlane({ platform: null })).toBe('via-gateway')
		expect(execPlane({ platform: '   ' })).toBe('via-gateway')
	})
})

// ── seenFreshness / agoLabel ───────────────────────────────────────────────────
describe('seenFreshness', () => {
	test('buckets a last-seen time into online / idle / stale / never', () => {
		expect(seenFreshness(at(MIN), NOW)).toBe('online')
		expect(seenFreshness(at(2 * HOUR), NOW)).toBe('idle')
		expect(seenFreshness(at(3 * DAY), NOW)).toBe('stale')
		expect(seenFreshness(null, NOW)).toBe('never')
	})

	test('a malformed timestamp never throws — reads as never', () => {
		expect(seenFreshness('not-a-date', NOW)).toBe('never')
	})
})

describe('agoLabel', () => {
	test('renders compact relative time and handles the null / bad cases', () => {
		expect(agoLabel(at(30_000), NOW)).toBe('just now')
		expect(agoLabel(at(10 * MIN), NOW)).toBe('10m ago')
		expect(agoLabel(at(3 * HOUR), NOW)).toBe('3h ago')
		expect(agoLabel(at(2 * DAY), NOW)).toBe('2d ago')
		expect(agoLabel(null, NOW)).toBe('never')
		expect(agoLabel('nonsense', NOW)).toBe('never')
	})
})

// ── fleetSummary ────────────────────────────────────────────────────────────
describe('fleetSummary', () => {
	test('enrollment counts span all devices; plane/online/platforms cover ACTIVE only', () => {
		const s = fleetSummary(
			[
				device({ platform: 'macos', status: 'active', last_seen_at: at(MIN) }),
				device({ platform: 'windows', status: 'active', last_seen_at: at(2 * HOUR) }),
				device({ platform: 'web · chrome', status: 'active', last_seen_at: at(MIN) }),
				device({ platform: 'macos', status: 'revoked', last_seen_at: at(MIN) })
			],
			NOW
		)
		expect(s.total).toBe(4)
		expect(s.active).toBe(3)
		expect(s.revoked).toBe(1)
		// two active desktops on-device; the web client via gateway; the revoked mac excluded.
		expect(s.onDevice).toBe(2)
		expect(s.viaGateway).toBe(1)
		// online = active devices seen inside the window (the windows box @2h is idle).
		expect(s.online).toBe(2)
	})

	test('a revoked device never counts toward the plane split (it cannot run)', () => {
		const s = fleetSummary([device({ platform: 'macos', status: 'revoked' })], NOW)
		expect(s.onDevice).toBe(0)
		expect(s.viaGateway).toBe(0)
		expect(s.revoked).toBe(1)
	})

	test('platform mix is grouped and sorted by descending count (active devices)', () => {
		const s = fleetSummary(
			[
				device({ platform: 'macos' }),
				device({ platform: 'macos' }),
				device({ platform: 'windows' }),
				device({ platform: null })
			],
			NOW
		)
		expect(s.platforms[0]).toEqual({ platform: 'macos', count: 2 })
		// a null platform is bucketed as "unknown", not dropped.
		expect(s.platforms.some((p) => p.platform === 'unknown' && p.count === 1)).toBe(true)
	})

	test('empty fleet → all zero, no divide-by-zero', () => {
		expect(fleetSummary([], NOW)).toMatchObject({
			total: 0,
			active: 0,
			onDevice: 0,
			viaGateway: 0,
			online: 0,
			platforms: []
		})
	})
})

describe('sortFleet', () => {
	test('active devices lead, then most-recently-seen first', () => {
		const sorted = sortFleet([
			device({ name: 'revoked-old', status: 'revoked', last_seen_at: at(MIN) }),
			device({ name: 'active-stale', status: 'active', last_seen_at: at(3 * DAY) }),
			device({ name: 'active-fresh', status: 'active', last_seen_at: at(MIN) })
		])
		expect(sorted.map((d) => d.name)).toEqual(['active-fresh', 'active-stale', 'revoked-old'])
	})
})

// ── categorize — the real gateway action set ──────────────────────────────────
describe('categorize', () => {
	test('governance + mcp actions are policy', () => {
		expect(categorize('governance.feature.set')).toBe('policy')
		expect(categorize('mcp.tool.grant.set')).toBe('policy')
		expect(categorize('mcp.server.set')).toBe('policy')
	})

	test('identity / credential / device actions are access', () => {
		expect(categorize('role.assigned')).toBe('access')
		expect(categorize('role.unassigned')).toBe('access')
		expect(categorize('apikey.issued')).toBe('access')
		expect(categorize('apikey.revoked')).toBe('access')
		expect(categorize('device.revoked')).toBe('access')
		expect(categorize('org.ownership.transferred')).toBe('access')
	})

	test('config-plane actions (budget/connection/model/routing/settings/space/org.created) are config', () => {
		for (const a of [
			'budget.node.upserted',
			'budget.request.approved',
			'connection.connected',
			'connection.oauth_revoked',
			'model.enabled.set',
			'routing.step.set',
			'settings.set',
			'space.created',
			'org.created'
		]) {
			expect(categorize(a)).toBe('config')
		}
	})

	test('anything mentioning export lands in the export bucket', () => {
		expect(categorize('audit.exported')).toBe('export')
		expect(categorize('data.export.csv')).toBe('export')
	})

	test('an unknown domain falls back to config, and empty never throws', () => {
		expect(categorize('brand-new-domain.did-a-thing')).toBe('config')
		expect(categorize('')).toBe('config')
	})

	test('every category the chips offer is reachable from a real action', () => {
		// guards against a chip that can never light up (a false-green filter).
		const reached = new Set(
			['governance.feature.set', 'role.assigned', 'settings.set', 'audit.exported'].map(categorize)
		)
		for (const c of AUDIT_CATEGORIES) expect(reached.has(c)).toBe(true)
	})
})

// ── actionLabel ───────────────────────────────────────────────────────────────
describe('actionLabel', () => {
	test('dots/underscores become spaces and the phrase is sentence-cased', () => {
		expect(actionLabel('governance.feature.set')).toBe('Governance feature set')
		expect(actionLabel('connection.oauth_connected')).toBe('Connection oauth connected')
		expect(actionLabel('org.created')).toBe('Org created')
	})

	test('empty action degrades to a readable placeholder', () => {
		expect(actionLabel('')).toBe('Event')
	})
})

// ── categoryCounts / filterByCategory ─────────────────────────────────────────
describe('categoryCounts', () => {
	test('leads with an all-total then one entry per category, counted correctly', () => {
		const counts = categoryCounts([
			event({ action: 'governance.feature.set' }),
			event({ action: 'role.assigned' }),
			event({ action: 'settings.set' }),
			event({ action: 'connection.connected' })
		])
		expect(counts[0]).toEqual({ category: 'all', label: 'All', count: 4 })
		const by = Object.fromEntries(counts.map((c) => [c.category, c.count]))
		expect(by.policy).toBe(1)
		expect(by.access).toBe(1)
		expect(by.config).toBe(2)
		expect(by.export).toBe(0)
	})

	test('empty ledger → all-zero counts, every chip still present', () => {
		const counts = categoryCounts([])
		expect(counts).toHaveLength(1 + AUDIT_CATEGORIES.length)
		expect(counts.every((c) => c.count === 0)).toBe(true)
	})
})

describe('filterByCategory', () => {
	const events = [
		event({ action: 'governance.feature.set' }),
		event({ action: 'settings.set' }),
		event({ action: 'role.assigned' })
	]

	test('"all" returns the full set unchanged (same order)', () => {
		expect(filterByCategory(events, 'all')).toEqual(events)
	})

	test('a category returns only its events', () => {
		expect(filterByCategory(events, 'policy').map((e) => e.action)).toEqual([
			'governance.feature.set'
		])
		expect(filterByCategory(events, 'config').map((e) => e.action)).toEqual(['settings.set'])
	})

	test('a category with no matches returns [] (never the whole list)', () => {
		expect(filterByCategory(events, 'export')).toEqual([])
	})
})

// ── auditToCsv ────────────────────────────────────────────────────────────────
describe('auditToCsv', () => {
	test('emits a header row plus one line per event, with a derived category column', () => {
		const csv = auditToCsv([
			event({ action: 'governance.feature.set' }),
			event({ action: 'role.assigned' })
		])
		const lines = csv.split('\r\n')
		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe('Time,Actor,Action,Category,Target type,Target id,ID')
		expect(lines[1]).toContain('policy') // governance → policy
		expect(lines[2]).toContain('access') // role → access
	})

	test('a null actor exports as "system", never the string "null"', () => {
		const csv = auditToCsv([event({ actor_id: null, target_type: null, target_id: null })])
		expect(csv).toContain('system')
		expect(csv).not.toContain('null')
	})

	test('cells with commas/quotes/newlines are RFC-4180 quoted (no column bleed)', () => {
		const csv = auditToCsv([event({ target_id: 'a,b', target_type: 'say "hi"' })])
		const line = csv.split('\r\n')[1]
		expect(line).toContain('"a,b"')
		expect(line).toContain('"say ""hi"""')
	})

	test('empty ledger still yields the header row alone', () => {
		expect(auditToCsv([])).toBe('Time,Actor,Action,Category,Target type,Target id,ID')
	})
})

test('auditCsvFilename is dated and .csv', () => {
	expect(auditCsvFilename(new Date('2026-07-30T12:00:00Z'))).toBe('audit-2026-07-30.csv')
})
