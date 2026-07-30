import { type ChatMessage, type InferResult, gateway } from './gateway'
import { route, type Plane } from './plane'
import { api, type AvailableModel } from './api'
import { pinnableForPlane, toPinnable, type LocalModelInfo, type PinnableModel } from './ask'

export interface Turn {
	role: 'user' | 'assistant'
	content: string
	exec?: InferResult
	/** did this answer run against a member-pinned model (vs plane auto-route)? drives the reason. */
	pinned?: boolean
}

class AskStore {
	turns = $state<Turn[]>([])
	loading = $state(false)
	error = $state<string | null>(null)
	// D3 split-plane: which plane the next Ask runs on (local in-process vs cloud via C1).
	plane = $state<Plane>('local')
	// The member's pinned model — '' = let the plane auto-route (opts.model omitted). Always a
	// model valid for the current plane (setPlane clears it on a plane switch, see below).
	model = $state('')

	// Load seam (runbook B4): the models the member may pin. Two REAL sources that degrade
	// independently (the Compare/Home precedent) — cloud via `/v1/models/available`, local via
	// the embedded engine's `list_models` (Tauri). A failure of either is not an error state.
	#cloudModels = $state<AvailableModel[]>([])
	#localModels = $state<LocalModelInfo[]>([])
	loaded = $state(false)

	/** Pinnable models for the CURRENT plane (the picker is plane-scoped so a pin is runnable). */
	get pinnable(): PinnableModel[] {
		return pinnableForPlane(toPinnable(this.#cloudModels, this.#localModels), this.plane)
	}

	setPlane(p: Plane) {
		if (p === this.plane) return
		this.plane = p
		// A pin is plane-specific; clear it so we never target the wrong engine after a switch.
		this.model = ''
	}

	setModel(id: string) {
		this.model = id
	}

	async load(): Promise<void> {
		if (this.loaded) return
		// Cloud models the member may call. A failure (no session / gateway down) just means
		// the cloud plane offers no pinnable models — not an error the UI should surface.
		try {
			const { models } = await api.availableModels()
			this.#cloudModels = models
		} catch {
			this.#cloudModels = []
		}
		// Local models from the embedded engine (Tauri). Throws outside Tauri (web/E2E) → none.
		try {
			this.#localModels = await gateway.listModels()
		} catch {
			this.#localModels = []
		}
		this.loaded = true
	}

	async send(text: string) {
		const q = text.trim()
		if (!q || this.loading) return
		this.turns.push({ role: 'user', content: q })
		this.loading = true
		this.error = null
		const pinned = this.model !== ''
		const started = performance.now()
		try {
			const history: ChatMessage[] = this.turns.map((t) => ({ role: t.role, content: t.content }))
			const res = await route(history, this.plane, this.model || undefined)
			// gateway.infer returns a real duration; the cloud leg reports 0 → measure the
			// round-trip client-side so the latency meter is never a fabricated/blank value.
			const duration_ms = res.duration_ms || Math.round(performance.now() - started)
			this.turns.push({
				role: 'assistant',
				content: res.content,
				exec: { ...res, duration_ms },
				pinned
			})
		} catch (e) {
			this.error = String(e)
		} finally {
			this.loading = false
		}
	}

	reset() {
		this.turns = []
		this.error = null
	}
}

export const ask = new AskStore()
