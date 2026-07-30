// Load layer for the Overview "Alerts · needs attention" card (mock: view-overview.jsx ALERTS).
// The alerts backend (notification_channels + rules) is Pass 2 — until it exists, alerts are
// DERIVED from the reads the Overview already loads: budget headroom, provider health (failed
// calls), and unconnected routers. Pure + typed so it's unit-tested; the real seam (a future
// `/v1/alerts`) swaps `deriveAlerts` for a fetch without touching state or component.
import type { BudgetNode, Provider, RequestRow } from './api'

/** `warning` = amber (at-risk), `accent` = vermillion (needs attention / action). */
export type AlertSeverity = 'warning' | 'accent'

export interface Alert {
	id: string
	severity: AlertSeverity
	/** Solar icon class. */
	icon: string
	text: string
	/** in-app deep link the row opens. */
	route: string
}

export interface AlertSignals {
	nodes: BudgetNode[]
	requests: RequestRow[]
	providers: Provider[]
}

/** A budget node at or above this % of its cap raises an alert. */
export const BUDGET_ALERT_PCT = 80

/** Derive "needs attention" alerts from the existing Overview reads. Ordered most-urgent first. */
export function deriveAlerts({ nodes, requests, providers }: AlertSignals): Alert[] {
	const out: Alert[] = []

	// 1 · budget headroom — any node at/over the alert threshold.
	for (const n of nodes) {
		if (!n.cap_amount || n.cap_amount <= 0) continue
		const pct = Math.round((n.spent_amount / n.cap_amount) * 100)
		if (pct >= BUDGET_ALERT_PCT)
			out.push({
				id: `budget-${n.id}`,
				severity: pct >= 100 ? 'accent' : 'warning',
				icon: 'i-solar-wallet-2-bold-duotone',
				text: `${n.name} is at ${pct}% of its budget cap.`,
				route: '/billing'
			})
	}

	// 2 · provider health — non-success calls, grouped by adapter.
	const fails = new Map<string, number>()
	for (const r of requests)
		if (r.status && r.status !== 'success') fails.set(r.adapter, (fails.get(r.adapter) ?? 0) + 1)
	for (const [adapter, n] of fails)
		out.push({
			id: `health-${adapter}`,
			severity: 'warning',
			icon: 'i-solar-server-minimalistic-bold-duotone',
			text: `${adapter} returned ${n} error${n === 1 ? '' : 's'} recently — watch the provider.`,
			route: '/requests'
		})

	// 3 · advertised remote routers with no credential can't route their models.
	const unconnected = providers.filter(
		(p) => p.is_active && p.requires_key && !p.connected && !p.oauth_connected
	).length
	if (unconnected > 0)
		out.push({
			id: 'conn-missing',
			severity: 'accent',
			icon: 'i-solar-key-bold-duotone',
			text: `${unconnected} active router${unconnected === 1 ? '' : 's'} need a key before they can route.`,
			route: '/connections'
		})

	return out
}

/** Hand-crafted mock exercising warning + accent + (via an empty array) the empty state. */
export function alertsMock(): Alert[] {
	return [
		{
			id: 'mock-budget',
			severity: 'warning',
			icon: 'i-solar-wallet-2-bold-duotone',
			text: 'Support is at 92% of its budget cap.',
			route: '/billing'
		},
		{
			id: 'mock-conn',
			severity: 'accent',
			icon: 'i-solar-key-bold-duotone',
			text: '2 active routers need a key before they can route.',
			route: '/connections'
		}
	]
}
