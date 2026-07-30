// Three-layer state (runbook B4) for the Workspace/Home screen. The component reads the
// getters here and never fetches directly; `load()` is the single seam that pulls REAL data
// via $lib/api (`/v1/models/available`) + the Tauri gateway bridge (`gateway_status`). The
// two reads degrade independently (the Compare precedent) so one failing still renders the
// other and still drives the offline/degraded banner.
import { api, type AvailableModel } from './api'
import { gateway } from './gateway'
import {
	deriveHealth,
	toModelViews,
	type GatewayHealth,
	type GatewayStatus,
	type ModelView
} from './home'

class HomeStore {
	#rawModels = $state<AvailableModel[]>([])
	#status = $state<GatewayStatus | null>(null)
	#cloudReachable = $state(false)
	loading = $state(false)
	loaded = $state(false)

	/** "Models you can use" — de-duped, on-device first (see toModelViews). */
	get models(): ModelView[] {
		return toModelViews(this.#rawModels)
	}

	/** Offline/degraded banner state (see deriveHealth). */
	get health(): GatewayHealth {
		return deriveHealth({ status: this.#status, cloudReachable: this.#cloudReachable })
	}

	async load(): Promise<void> {
		this.loading = true
		// Cloud models the member may call. A failure (no session / gateway down) is not
		// an error state — it just means the cloud plane is unreachable, which the banner shows.
		try {
			const { models } = await api.availableModels()
			this.#rawModels = models
			this.#cloudReachable = true
		} catch {
			this.#rawModels = []
			this.#cloudReachable = false
		}
		// Embedded gateway status (Tauri). Throws outside Tauri (web/E2E) → local plane unknown.
		try {
			this.#status = await gateway.status()
		} catch {
			this.#status = null
		}
		this.loading = false
		this.loaded = true
	}
}

export const home = new HomeStore()
