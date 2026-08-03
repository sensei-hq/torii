// Torii desktop — Local Models pure types + derivations (formatting, disk %, fit/capability tones,
// pull %). No runes / no Tauri so it unit-tests in the node vitest env; the ModelsStore
// (models.svelte.ts) and +page.svelte consume these. Types mirror the Tauri IPC contract
// (src-tauri/src/commands/models.rs).

export interface LocalModel {
	id: string
	name: string
	format: string
	size_bytes: number
	/** "managed" (pullable/removable) | "ollama" (read-through) */
	source: string
	is_default: boolean
	removable: boolean
	/** "chat" | "embedding" | "unknown" */
	capability: string
}

export interface AvailableModel {
	id: string
	name: string
	format: string
	size_bytes: number
	ctx: number
	quant: string
	installed: boolean
	fits: boolean
	need_gb: number
}

export interface DeviceInfo {
	chip: string
	ram_gb: number
	accel: string
	disk_total_gb: number
	models_gb: number
	models_count: number
}

/** Bytes → a compact human size (GB above ~1 GB, else MB). */
export function fmtSize(bytes: number): string {
	if (bytes <= 0) return '—'
	const gb = bytes / 1024 ** 3
	if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
	const mb = bytes / 1024 ** 2
	return `${mb.toFixed(0)} MB`
}

export function fmtGb(gb: number): string {
	return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
}

/** Disk-used bar % (models share of total disk), clamped 0..100. */
export function diskPct(d: DeviceInfo): number {
	if (!d.disk_total_gb) return 0
	return Math.max(0, Math.min(100, (d.models_gb / d.disk_total_gb) * 100))
}

export function diskTone(d: DeviceInfo): 'accent' | 'warning' {
	return d.models_gb / (d.disk_total_gb || 1) > 0.85 ? 'warning' : 'accent'
}

export function capabilityTone(cap: string): 'accent' | 'success' | 'mute' {
	if (cap === 'embedding') return 'success'
	if (cap === 'chat') return 'accent'
	return 'mute'
}

/** Pull progress % from a (done, total) byte pair (total may be unknown → 0). */
export function pullPct(done: number, total: number | null | undefined): number {
	if (!total || total <= 0) return 0
	return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

/** A short "needs N GB of M GB" fit hint for a downloadable model. */
export function fitHint(m: AvailableModel, ram_gb: number): string {
	return `~${m.need_gb.toFixed(1)} GB / ${ram_gb.toFixed(0)} GB RAM`
}

/** Installed models sorted: default first, then managed before read-only, then by name. */
export function sortInstalled(models: LocalModel[]): LocalModel[] {
	return [...models].sort((a, b) => {
		if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
		if (a.removable !== b.removable) return a.removable ? -1 : 1
		return a.name.localeCompare(b.name)
	})
}
