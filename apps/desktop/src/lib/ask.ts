// Pure, client-side derivations for the Torii Ask screen. Kept out of the component (and out
// of the .svelte.ts store) so they're unit-testable in a node env — type-only imports mean no
// $env/Tauri is pulled in at runtime (mirrors src/lib/home.ts). Every value here is derived
// from REAL signals: the answering `InferResult` (plane/model/duration_ms) and the models the
// member may call (`/v1/models/available` + the embedded engine's `list_models`). No mock data.
import type { AvailableModel } from './api'
import type { Plane } from './plane'

/** A model the member can pin as the answering model, tagged by the plane it runs on. */
export interface PinnableModel {
	/** stable id the gateway routes on (cloud `full_name` / local model id). */
	id: string
	/** human label; degrades to the id when the source carries no display name. */
	name: string
	/** on-device (embedded engine) vs via the cloud gateway. */
	plane: Plane
}

/** Shape of a local model as reported by the embedded engine (`gateway.listModels()`). */
export interface LocalModelInfo {
	id: string
	name: string
}

/**
 * Project the two model sources into one pin list: local models first (on-device, free,
 * offline-capable — same ordering as Home), then cloud. De-duplicated by id (first wins);
 * blank ids are dropped (the gateway routes on the id, so a blank one is un-pinnable) and a
 * blank name degrades to the id so an option never renders as "".
 */
export function toPinnable(cloud: AvailableModel[], local: LocalModelInfo[]): PinnableModel[] {
	const seen = new Set<string>()
	const out: PinnableModel[] = []
	for (const m of local ?? []) {
		const id = (m?.id ?? '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		out.push({ id, name: (m?.name ?? '').trim() || id, plane: 'local' })
	}
	for (const m of cloud ?? []) {
		const id = (m?.full_name ?? '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		out.push({ id, name: (m?.display_name ?? '').trim() || id, plane: 'cloud' })
	}
	return out
}

/** The pinnable models valid for a given plane — pinning a cloud model on the local plane
 * (or vice-versa) would target an engine that can't serve it, so the picker is plane-scoped. */
export function pinnableForPlane(all: PinnableModel[], plane: Plane): PinnableModel[] {
	return (all ?? []).filter((m) => m.plane === plane)
}

/**
 * The routing-reason line: which plane/model answered and WHY, in one legible sentence.
 * Driven by the REAL answer — `plane`/`model` come off the `InferResult`, `pinned` records
 * whether the member had pinned a model for that turn. No provider-name heuristics.
 */
export function routingReason(input: {
	plane: Plane
	pinned: boolean
	model?: string | null
}): string {
	const model =
		(input.model ?? '').trim() ||
		(input.plane === 'local' ? 'the on-device model' : 'the gateway default')
	if (input.plane === 'local') {
		return input.pinned
			? `Answered on your device by ${model} (pinned) — nothing left this machine.`
			: `Answered on your device by ${model} — nothing left this machine.`
	}
	return input.pinned
		? `You pinned ${model}, so the gateway used it directly instead of auto-routing. Provider keys stayed server-side.`
		: `Auto-routed to ${model} through the gateway — the balanced default. Provider keys stayed server-side.`
}

/** Full-scale value for the latency meter (ms). A slower answer clamps to 100% (Meter clamps). */
export const LATENCY_MAX_MS = 4000

/** Above this the latency meter reads as slow (accent fill) rather than nominal (ink). */
export const LATENCY_SLOW_MS = 2600

/** Format a round-trip duration for the meter's value text: sub-second in ms, else seconds.
 * A non-positive/non-finite duration (e.g. an un-timed stub) renders as an em dash, not "0 ms". */
export function fmtLatency(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '—'
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Meter tone for a latency: nominal (`ink`) until it crosses the slow threshold (`accent`). */
export function latencyTone(ms: number): 'ink' | 'accent' {
	return Number.isFinite(ms) && ms > LATENCY_SLOW_MS ? 'accent' : 'ink'
}
