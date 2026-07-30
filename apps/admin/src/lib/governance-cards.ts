// Pure, client-side derivations for the Governance screen's two runtime cards — the
// device fleet (where execution lands) and the audit / SIEM trail. Kept out of the
// component so they're unit-testable (type-only imports → no $env at runtime). Every
// figure is computed from the real gateway reads (/v1/devices, /v1/audit) — no mock data.
import type { AuditEvent, Device } from './api'

// ── device fleet: enrollment + execution-plane summary ───────────────────────

/**
 * Which plane a device's inference lands on, inferred from its enrolled `platform`: a
 * desktop OS runs models on-box (the local plane, ≈$0 egress); a web/browser client
 * always routes via the gateway. An absent/unknown platform reads as via-gateway — the
 * safe default that never over-claims a local capability we can't see.
 */
export type ExecPlane = 'on-device' | 'via-gateway'

const WEB_PLATFORM = /web|browser|chrome|safari|firefox|edge|wasm/i

export function execPlane(device: Pick<Device, 'platform'>): ExecPlane {
	const p = device.platform?.trim()
	if (!p) return 'via-gateway'
	return WEB_PLATFORM.test(p) ? 'via-gateway' : 'on-device'
}

/** How recently a device checked in — drives the fleet's online/idle status dot. */
export type Freshness = 'online' | 'idle' | 'stale' | 'never'

const MIN = 60_000
const DAY = 86_400_000

export function seenFreshness(ts: string | null, now: number = Date.now()): Freshness {
	if (!ts) return 'never'
	const t = new Date(ts).getTime()
	if (Number.isNaN(t)) return 'never'
	const d = now - t
	if (d < 5 * MIN) return 'online'
	if (d < DAY) return 'idle'
	return 'stale'
}

/** A compact relative-time label for a last-seen / enrolled timestamp. */
export function agoLabel(ts: string | null, now: number = Date.now()): string {
	if (!ts) return 'never'
	const t = new Date(ts).getTime()
	if (Number.isNaN(t)) return 'never'
	const s = Math.max(0, (now - t) / 1000)
	if (s < 90) return 'just now'
	if (s < 5400) return `${Math.round(s / 60)}m ago`
	if (s < 129_600) return `${Math.round(s / 3600)}h ago`
	return `${Math.round(s / 86_400)}d ago`
}

export interface PlatformCount {
	platform: string
	count: number
}

export interface FleetSummary {
	/** every enrolled device, active or revoked. */
	total: number
	active: number
	revoked: number
	/** ACTIVE devices that checked in within the online window. */
	online: number
	/** ACTIVE devices whose plane is on-device (revoked devices can't run, so excluded). */
	onDevice: number
	/** ACTIVE devices whose plane is via-gateway. */
	viaGateway: number
	/** ACTIVE devices grouped by platform, most common first. */
	platforms: PlatformCount[]
}

/**
 * Roll the enrolled fleet up into the governance summary: enrollment counts over ALL
 * devices, but plane / freshness / platform mix over ACTIVE devices only — a revoked
 * device is denied on the next call, so it neither runs models nor "lands" anywhere.
 */
export function fleetSummary(devices: Device[], now: number = Date.now()): FleetSummary {
	let active = 0
	let revoked = 0
	let online = 0
	let onDevice = 0
	let viaGateway = 0
	const platforms = new Map<string, number>()
	for (const d of devices) {
		if (d.status === 'revoked') {
			revoked++
			continue
		}
		active++
		if (seenFreshness(d.last_seen_at, now) === 'online') online++
		if (execPlane(d) === 'on-device') onDevice++
		else viaGateway++
		const key = d.platform?.trim() || 'unknown'
		platforms.set(key, (platforms.get(key) ?? 0) + 1)
	}
	return {
		total: devices.length,
		active,
		revoked,
		online,
		onDevice,
		viaGateway,
		platforms: [...platforms.entries()]
			.map(([platform, count]) => ({ platform, count }))
			.sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
	}
}

/** Active devices first, then most-recently-seen — the order the summary list renders. */
export function sortFleet(devices: Device[]): Device[] {
	return [...devices].sort((a, b) => {
		const av = a.status === 'revoked' ? 1 : 0
		const bv = b.status === 'revoked' ? 1 : 0
		if (av !== bv) return av - bv
		const at = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
		const bt = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
		return bt - at
	})
}

// ── audit / SIEM trail: triage the privileged-change ledger by category ───────

/** The governance lens on an audit event — the same four buckets the SIEM stream tags. */
export type AuditCategory = 'config' | 'policy' | 'access' | 'export'

export const AUDIT_CATEGORIES: AuditCategory[] = ['config', 'policy', 'access', 'export']

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
	config: 'Config',
	policy: 'Policy',
	access: 'Access',
	export: 'Export'
}

/**
 * Bucket an `audit_events.action` slug into a governance category by its `domain.verb`
 * shape (the domain is the part before the first `.`). Resilient to any action the
 * gateway may add — an unmapped domain falls back to `config` (the general "an operator
 * changed configuration" bucket). Matches the real gateway actions: `governance.*` /
 * `mcp.*` → policy; `role.*` / `apikey.*` / `device.*` / `org.ownership.*` → access;
 * anything mentioning `export` → export; the rest (budget/connection/model/routing/
 * settings/space/org.created) → config.
 */
export function categorize(action: string): AuditCategory {
	const a = (action || '').toLowerCase()
	if (a.includes('export')) return 'export'
	const domain = a.split('.')[0]
	if (domain === 'governance' || domain === 'mcp') return 'policy'
	if (domain === 'role' || domain === 'apikey' || domain === 'device') return 'access'
	if (domain === 'org') return a.includes('ownership') ? 'access' : 'config'
	return 'config'
}

/**
 * A readable label for an action slug: `governance.feature.set` → "Governance feature
 * set". Dots and underscores become spaces; the whole phrase is sentence-cased. The
 * domain is kept (it disambiguates otherwise-terse verbs like `created`).
 */
export function actionLabel(action: string): string {
	const a = (action || '').trim()
	if (!a) return 'Event'
	const words = a.replace(/[._]+/g, ' ').trim()
	return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface CategoryCount {
	category: AuditCategory | 'all'
	label: string
	count: number
}

/** Per-category counts (plus an `all` total) for the filter chips + the SIEM summary. */
export function categoryCounts(events: AuditEvent[]): CategoryCount[] {
	const acc = new Map<AuditCategory, number>()
	for (const e of events) {
		const c = categorize(e.action)
		acc.set(c, (acc.get(c) ?? 0) + 1)
	}
	return [
		{ category: 'all', label: 'All', count: events.length },
		...AUDIT_CATEGORIES.map((c) => ({
			category: c,
			label: AUDIT_CATEGORY_LABELS[c],
			count: acc.get(c) ?? 0
		}))
	]
}

/** The events in a category (or all of them when `cat === 'all'`), newest first preserved. */
export function filterByCategory(events: AuditEvent[], cat: AuditCategory | 'all'): AuditEvent[] {
	if (cat === 'all') return events
	return events.filter((e) => categorize(e.action) === cat)
}

// ── CSV export of the (filtered) audit trail ─────────────────────────────────
// A client-side download of the fetched events — no backend write. The SIEM stream +
// retention are server-owned (out of this pass); this is the ad-hoc "grab the visible
// slice" export the governance mock offers on the audit card.

interface AuditCsvColumn {
	header: string
	value: (e: AuditEvent) => unknown
}

const AUDIT_CSV_COLUMNS: AuditCsvColumn[] = [
	{ header: 'Time', value: (e) => e.created_at },
	{ header: 'Actor', value: (e) => e.actor_id ?? 'system' },
	{ header: 'Action', value: (e) => e.action },
	{ header: 'Category', value: (e) => categorize(e.action) },
	{ header: 'Target type', value: (e) => e.target_type },
	{ header: 'Target id', value: (e) => e.target_id },
	{ header: 'ID', value: (e) => e.id }
]

/** RFC-4180 cell: quote when the value contains a comma, quote, or newline; double any
 *  embedded quote. Null/undefined render as an empty cell. */
function csvCell(v: unknown): string {
	if (v == null) return ''
	const s = String(v)
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize audit events to CSV (header + one CRLF-joined line per event). */
export function auditToCsv(events: AuditEvent[]): string {
	const head = AUDIT_CSV_COLUMNS.map((c) => c.header).join(',')
	const lines = events.map((e) => AUDIT_CSV_COLUMNS.map((c) => csvCell(c.value(e))).join(','))
	return [head, ...lines].join('\r\n')
}

/** A dated, filesystem-safe filename for the export. */
export function auditCsvFilename(now: Date = new Date()): string {
	return `audit-${now.toISOString().slice(0, 10)}.csv`
}
