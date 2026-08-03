import { type ChatMessage, type InferResult, gateway } from './gateway'
import { route, type Plane } from './plane'
import { api, type AvailableModel } from './api'
import { pinnableForPlane, toPinnable, type LocalModelInfo, type PinnableModel } from './ask'
import { rag, type Citation, type SpaceRow } from './rag'

export interface Turn {
	role: 'user' | 'assistant'
	content: string
	exec?: InferResult
	/** did this answer run against a member-pinned model (vs plane auto-route)? drives the reason. */
	pinned?: boolean
	/** grounding sources for a grounded (space) answer — drives the Sources list. */
	citations?: Citation[]
	/** was this a grounded answer (asked within a space)? */
	grounded?: boolean
	/** the space this turn was grounded in (captured at send time, not the current selection). */
	spaceName?: string
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

	// ── grounded Ask: ask within a space → retrieval-augmented, cited answer ──
	#spaces = $state<SpaceRow[]>([])
	/** the space to ground answers in; '' = no grounding (plain plane routing). */
	spaceId = $state('')
	/** the RW5 Ask thread id, so follow-up grounded turns append to the same conversation. */
	#conversationId = $state<string | null>(null)

	/** Pinnable models for the CURRENT plane (the picker is plane-scoped so a pin is runnable). */
	get pinnable(): PinnableModel[] {
		return pinnableForPlane(toPinnable(this.#cloudModels, this.#localModels), this.plane)
	}

	/** Spaces the member can ground answers in (owned or member-of). */
	get spaces(): SpaceRow[] {
		return this.#spaces
	}
	/** Is the next Ask grounded in a space (retrieval-augmented, cited)? */
	get grounded(): boolean {
		return this.spaceId !== ''
	}
	/** The selected space's display name (for the grounded-reason line). */
	get spaceName(): string {
		return this.#spaces.find((s) => s.id === this.spaceId)?.name ?? 'this space'
	}

	setSpace(id: string) {
		if (id === this.spaceId) return
		this.spaceId = id
		// A new grounding target starts a fresh Ask thread.
		this.#conversationId = null
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
		// Spaces the member can ground in. A failure just means no grounding option — not an error.
		try {
			this.#spaces = (await rag.spaces()).spaces
		} catch {
			this.#spaces = []
		}
		this.loaded = true
	}

	async send(text: string) {
		const q = text.trim()
		if (!q || this.loading) return
		this.turns.push({ role: 'user', content: q })
		this.loading = true
		this.error = null
		const started = performance.now()
		try {
			if (this.grounded) {
				// Grounded Ask: retrieve → generate → cite, through the gateway (always cloud-plane).
				const res = await rag.ask(this.spaceId, q, this.#conversationId ?? undefined)
				this.#conversationId = res.conversation_id
				const duration_ms = Math.round(performance.now() - started)
				this.turns.push({
					role: 'assistant',
					content: res.content,
					exec: {
						content: res.content,
						model: res.model ?? undefined,
						plane: 'cloud',
						cost_usd: res.cost_usd,
						duration_ms
					},
					citations: res.citations,
					grounded: res.grounded,
					spaceName: this.spaceName
				})
			} else {
				const pinned = this.model !== ''
				const history: ChatMessage[] = this.turns.map((t) => ({
					role: t.role,
					content: t.content
				}))
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
			}
		} catch (e) {
			this.error = String(e)
		} finally {
			this.loading = false
		}
	}

	reset() {
		this.turns = []
		this.error = null
		this.#conversationId = null
	}
}

export const ask = new AskStore()
