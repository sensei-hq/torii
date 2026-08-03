// State layer for the Overview alerts card (ui-state-pattern). Owns the derived alerts + the
// session-local dismissals; the component reads `visible` and calls `dismiss`. Data enters ONLY
// through `load()` (the mock→real seam lives in alerts.ts). A module singleton so the card and
// the page share one source of truth.
import { SvelteSet } from 'svelte/reactivity'
import { deriveAlerts, type Alert, type AlertSignals } from './alerts'

let all = $state<Alert[]>([])
const dismissed = new SvelteSet<string>()

/** Live filter (not $derived) so it recomputes on read in tests and in a reactive context alike. */
const currentlyVisible = () => all.filter((a) => !dismissed.has(a.id))

export const alertsState = {
	get all() {
		return all
	},
	get visible() {
		return currentlyVisible()
	},
	get count() {
		return currentlyVisible().length
	},

	/** Recompute the alerts from the current Overview reads. Clears prior dismissals. */
	load(signals: AlertSignals) {
		all = deriveAlerts(signals)
		dismissed.clear()
	},

	/** Hide one alert for this session (no backend persistence until the alerts service ships). */
	dismiss(id: string) {
		dismissed.add(id)
	},

	/** Test/navigation reset. */
	reset() {
		all = []
		dismissed.clear()
	}
}
