// Pure, client-local model for the Torii member Settings screen. Torii keeps a member's
// answering preferences on THIS device only (localStorage) — there is no server prefs
// endpoint yet (W2 spec §3.2 `user_preferences` is a fast-follow, out of this pass). Kept
// framework-free so it unit-tests under the node env (no $lib/Tauri/localStorage pulled in):
// this module owns the SHAPE, defaults and validation; the state layer (settings.svelte.ts)
// owns the storage read/write + the theme (vibe.mode) side-effect.

export type ThemePref = 'light' | 'dark'
export type Tier = 'fast' | 'balanced' | 'frontier'
export type CiteDensity = 'off' | 'compact' | 'full'

/** The answering + workspace preferences Torii persists locally for a member. */
export interface Prefs {
	/** How the gateway balances quality vs cost for this member's default routing. */
	tier: Tier
	/** How many sources to attach to an answer. */
	cites: CiteDensity
	/** Carry prior turns into the next question by default. */
	retention: boolean
	/** Rewrite prompts for the chosen model before sending. */
	autotune: boolean
	/** Weekly Monday digest of activity in the member's spaces. */
	digest: boolean
	/** Keep generated docs as drafts in the active space. */
	autosave: boolean
}

/** Defaults applied on first run and whenever a stored value is absent/invalid. */
export const PREF_DEFAULTS: Prefs = {
	tier: 'balanced',
	cites: 'compact',
	retention: false,
	autotune: false,
	digest: true,
	autosave: true
}

/** localStorage key for the member's local answering preferences. */
export const PREFS_KEY = 'torii-prefs'

/** A single choice in a segmented control (also the whitelist used for validation). */
export interface Option<V extends string> {
	value: V
	label: string
}

// Option catalogs are the single source of truth for BOTH the rendered segmented controls
// and the value validation below — a value that isn't in the catalog can't be a valid pref.
export const THEME_OPTIONS: Option<ThemePref>[] = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' }
]

export const TIER_OPTIONS: Option<Tier>[] = [
	{ value: 'fast', label: 'Fast' },
	{ value: 'balanced', label: 'Balanced' },
	{ value: 'frontier', label: 'Frontier' }
]

export const CITE_OPTIONS: Option<CiteDensity>[] = [
	{ value: 'off', label: 'Off' },
	{ value: 'compact', label: 'Compact' },
	{ value: 'full', label: 'Full' }
]

const TIER_VALUES = new Set<string>(TIER_OPTIONS.map((o) => o.value))
const CITE_VALUES = new Set<string>(CITE_OPTIONS.map((o) => o.value))

/** Keep a string only if it's a known enum member; otherwise fall back to the default. */
function pickEnum<V extends string>(v: unknown, allowed: Set<string>, fallback: V): V {
	return typeof v === 'string' && allowed.has(v) ? (v as V) : fallback
}

/** Keep a real boolean only; a truthy string / missing key falls back to the default. */
function pickBool(v: unknown, fallback: boolean): boolean {
	return typeof v === 'boolean' ? v : fallback
}

/**
 * Merge a possibly-partial / untrusted stored blob over the defaults, validating every key.
 * Forward-compatible: a blob written before a pref existed still gets that pref's default,
 * and an out-of-range value (corrupt storage, hand-edited, or a removed enum member) falls
 * back to its default — so a segmented control ALWAYS has a matching, selectable segment.
 * Never trusts extra keys: the result carries only the known Prefs fields.
 */
export function mergePrefs(stored: unknown): Prefs {
	const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
	return {
		tier: pickEnum(s.tier, TIER_VALUES, PREF_DEFAULTS.tier),
		cites: pickEnum(s.cites, CITE_VALUES, PREF_DEFAULTS.cites),
		retention: pickBool(s.retention, PREF_DEFAULTS.retention),
		autotune: pickBool(s.autotune, PREF_DEFAULTS.autotune),
		digest: pickBool(s.digest, PREF_DEFAULTS.digest),
		autosave: pickBool(s.autosave, PREF_DEFAULTS.autosave)
	}
}

/** Parse the raw localStorage string into valid Prefs — never throws (corrupt → defaults). */
export function parsePrefs(raw: string | null | undefined): Prefs {
	if (!raw) return { ...PREF_DEFAULTS }
	try {
		return mergePrefs(JSON.parse(raw))
	} catch {
		return { ...PREF_DEFAULTS }
	}
}

/** Serialize prefs for storage — re-validated so only known, in-range keys are ever written. */
export function serializePrefs(prefs: Prefs): string {
	return JSON.stringify(mergePrefs(prefs))
}
