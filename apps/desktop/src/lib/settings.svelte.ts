// Three-layer state (runbook B4) for the Torii Settings screen. The component reads these
// getters and NEVER touches storage directly. `load()` is the single seam — for this
// client-local screen the "data source" is localStorage (there is no prefs endpoint yet;
// see settings.ts). Theme is the app-wide `vibe.mode` (persisted by the root layout's
// `themable` action), so Settings just reflects + drives it; the answering prefs persist
// here under PREFS_KEY. Storage access is wrapped so a disabled/full store never throws.
import { vibe } from '@rokkit/states'
import {
	PREFS_KEY,
	PREF_DEFAULTS,
	parsePrefs,
	serializePrefs,
	type CiteDensity,
	type Prefs,
	type ThemePref,
	type Tier
} from './settings'

function readStorage(key: string): string | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
	} catch {
		return null
	}
}

function writeStorage(key: string, value: string): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
	} catch {
		/* storage disabled / full — local prefs are best-effort, never fatal */
	}
}

class SettingsStore {
	#prefs = $state<Prefs>({ ...PREF_DEFAULTS })
	loaded = $state(false)

	/** Read prefs from localStorage into reactive state (the mock→real seam). Idempotent. */
	load(): void {
		this.#prefs = parsePrefs(readStorage(PREFS_KEY))
		this.loaded = true
	}

	/** The member's local answering/notification preferences. */
	get prefs(): Prefs {
		return this.#prefs
	}

	/**
	 * App-wide theme (light/dark). Reads + writes the shared `vibe.mode`; the root layout's
	 * `themable` action is what persists it, so Settings only mirrors and drives it — no
	 * second theme store to drift out of sync.
	 */
	get theme(): ThemePref {
		return vibe.mode === 'dark' ? 'dark' : 'light'
	}

	setTheme(mode: ThemePref): void {
		vibe.mode = mode
	}

	setTier(v: Tier): void {
		this.#patch({ tier: v })
	}

	setCites(v: CiteDensity): void {
		this.#patch({ cites: v })
	}

	setRetention(v: boolean): void {
		this.#patch({ retention: v })
	}

	setAutotune(v: boolean): void {
		this.#patch({ autotune: v })
	}

	setDigest(v: boolean): void {
		this.#patch({ digest: v })
	}

	setAutosave(v: boolean): void {
		this.#patch({ autosave: v })
	}

	// Immutably replace prefs (so reads re-run) and persist the validated blob to storage.
	#patch(delta: Partial<Prefs>): void {
		this.#prefs = { ...this.#prefs, ...delta }
		writeStorage(PREFS_KEY, serializePrefs(this.#prefs))
	}
}

export const settings = new SettingsStore()
