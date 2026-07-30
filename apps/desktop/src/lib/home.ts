// Pure, client-side derivations for the Torii Workspace/Home screen. Kept out of the
// component so they're unit-testable (type-only imports → no $env/Tauri pulled in at
// runtime, mirroring apps/admin/src/lib/overview.ts). Every value is derived from the real
// gateway reads — `/v1/models/available` (the cloud chat models this member may call) and
// the embedded gateway's `gateway_status` (Tauri) — no mock data.
import type { AvailableModel } from './api'

/** Shape returned by the Tauri `gateway_status` command (the embedded/local gateway). */
export interface GatewayStatus {
	configured: boolean
	adapters: string[]
}

/** A model the member may call, as rendered in the "models you can use" list. */
export interface ModelView {
	/** stable id (full_name) — the value the gateway routes on. */
	id: string
	/** human label; degrades to the id when the catalog carries no display name. */
	name: string
	provider: string
	/** on-device (embedded engine) vs via the cloud gateway. */
	plane: 'local' | 'cloud'
}

// Providers whose models run on the local plane (embedded engine), not the cloud gateway.
const LOCAL_PROVIDERS = new Set(['ollama', 'local', 'embedded', 'llama.cpp', 'llamacpp'])

/** True when a provider runs on-device. Case-insensitive; blank/unknown → cloud. */
export function isLocalProvider(provider: string | null | undefined): boolean {
	return LOCAL_PROVIDERS.has((provider ?? '').trim().toLowerCase())
}

/**
 * Project the raw `/v1/models/available` rows into the list Home renders: de-duplicated by
 * id (first wins), on-device models first (free + offline-capable), then alphabetical by
 * label. A blank display_name degrades to the full_name so a row never renders as "".
 * Rows with no usable id are dropped (the gateway routes on the id, so a blank one is dead).
 */
export function toModelViews(models: AvailableModel[]): ModelView[] {
	const seen = new Set<string>()
	const views: ModelView[] = []
	for (const m of models ?? []) {
		const id = (m?.full_name ?? '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		const name = (m?.display_name ?? '').trim() || id
		views.push({
			id,
			name,
			provider: (m?.provider ?? '').trim(),
			plane: isLocalProvider(m?.provider) ? 'local' : 'cloud'
		})
	}
	views.sort((a, b) => {
		if (a.plane !== b.plane) return a.plane === 'local' ? -1 : 1
		return a.name.localeCompare(b.name)
	})
	return views
}

export type HealthTone = 'ok' | 'degraded' | 'offline'

/** The offline/degraded banner state derived from the two live gateway signals. */
export interface GatewayHealth {
	tone: HealthTone
	/** whether to render the banner at all (false only when everything is healthy). */
	show: boolean
	headline: string
	detail: string
}

/**
 * Derive the offline/degraded banner from the two live signals:
 *  - `status`: the embedded gateway's `gateway_status` — `null` when the invoke failed
 *    (e.g. running outside Tauri / on web), which we treat as "local plane unavailable".
 *  - `cloudReachable`: did `/v1/models/available` resolve?
 *
 * local ok = configured with ≥1 adapter; cloud ok = the models read resolved.
 *   both ok              → healthy, no banner
 *   cloud down, local ok → offline: on-device still answers
 *   local down, cloud ok → degraded: routes through the cloud
 *   both down            → offline: nothing reachable
 */
export function deriveHealth(input: {
	status: GatewayStatus | null
	cloudReachable: boolean
}): GatewayHealth {
	const localOk =
		input.status != null && input.status.configured && input.status.adapters.length > 0
	const cloudOk = input.cloudReachable

	if (cloudOk && localOk) {
		return { tone: 'ok', show: false, headline: '', detail: '' }
	}
	if (!cloudOk && localOk) {
		return {
			tone: 'offline',
			show: true,
			headline: 'Cloud gateway unreachable',
			detail: 'On-device models still work — answers will run locally until the connection returns.'
		}
	}
	if (cloudOk && !localOk) {
		return {
			tone: 'degraded',
			show: true,
			headline: 'On-device engine unavailable',
			detail: 'The embedded gateway isn’t ready — answers route through the cloud instead.'
		}
	}
	return {
		tone: 'offline',
		show: true,
		headline: 'Gateway offline',
		detail: 'No models are reachable right now — check your connection and try again.'
	}
}

/** A jump-off tile on Home. `route` is an app-absolute path handled by the shell nav. */
export interface QuickAction {
	key: string
	title: string
	sub: string
	icon: string
	route: string
}

// The "start something new" tiles. Each routes to a screen that ALREADY exists in the
// desktop app (no dead links) — order: most-common member task first.
export const QUICK_ACTIONS: QuickAction[] = [
	{
		key: 'ask',
		title: 'Ask something',
		sub: 'one endpoint · auto-routed',
		icon: 'i-solar-chat-round-line-bold-duotone',
		route: '/ask'
	},
	{
		key: 'compare',
		title: 'Compare models',
		sub: 'answers side by side',
		icon: 'i-solar-layers-minimalistic-bold-duotone',
		route: '/compare'
	},
	{
		key: 'playground',
		title: 'Open the playground',
		sub: 'prompt · judge · inspect',
		icon: 'i-solar-test-tube-bold-duotone',
		route: '/playground'
	},
	{
		key: 'activity',
		title: 'Review activity',
		sub: 'spend · requests · budget',
		icon: 'i-solar-chart-2-bold-duotone',
		route: '/activity'
	}
]
