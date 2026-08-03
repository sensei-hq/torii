// Torii desktop — Local Models state (the Load/State seam). Wraps the Tauri model-management IPC
// (list_local_models / available_models / device_info / pull_model / remove_model /
// set_default_model, src-tauri/src/commands/models.rs) and relays the model-pull-progress events.
// Under IS_E2E it serves deterministic fixtures (no Tauri) so the network-free e2e drives the screen.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { IS_E2E } from './e2e'
import type { LocalModel, AvailableModel, DeviceInfo } from './models'

const E2E_INSTALLED: LocalModel[] = [
	{
		id: 'gemma2:2b',
		name: 'gemma2:2b',
		format: 'gguf',
		size_bytes: 1_700_000_000,
		source: 'ollama',
		is_default: true,
		removable: false,
		capability: 'chat'
	},
	{
		id: 'mxbai-embed-large',
		name: 'mxbai-embed-large',
		format: 'gguf',
		size_bytes: 670_000_000,
		source: 'managed',
		is_default: false,
		removable: true,
		capability: 'embedding'
	}
]
const E2E_AVAILABLE: AvailableModel[] = [
	{
		id: 'gemma2:2b',
		name: 'gemma2:2b',
		format: 'gguf',
		size_bytes: 1_700_000_000,
		ctx: 8192,
		quant: 'Q4_K_M',
		installed: true,
		fits: true,
		need_gb: 2.1
	},
	{
		id: 'llama3.2:3b',
		name: 'Llama 3.2 3B Instruct',
		format: 'gguf',
		size_bytes: 2_000_000_000,
		ctx: 131072,
		quant: 'Q4_K_M',
		installed: false,
		fits: true,
		need_gb: 3.0
	},
	{
		id: 'qwen2.5-coder:7b',
		name: 'Qwen2.5 Coder 7B',
		format: 'gguf',
		size_bytes: 4_700_000_000,
		ctx: 32768,
		quant: 'Q4_K_M',
		installed: false,
		fits: false,
		need_gb: 40.0
	}
]
const E2E_DEVICE: DeviceInfo = {
	chip: 'Apple M3 Pro',
	ram_gb: 36,
	accel: 'Metal',
	disk_total_gb: 512,
	models_gb: 2.3,
	models_count: 2
}

class ModelsStore {
	installed = $state<LocalModel[]>([])
	available = $state<AvailableModel[]>([])
	device = $state<DeviceInfo | null>(null)
	loading = $state(false)
	error = $state<string | null>(null)
	loaded = $state(false)
	/** model id → download % (0..100) while a pull is in flight. */
	pulling = $state<Record<string, number>>({})

	#unlisten: UnlistenFn[] = []

	async load(): Promise<void> {
		if (this.loaded) return
		await this.refresh()
		await this.#subscribe()
		this.loaded = true
	}

	async refresh(): Promise<void> {
		this.loading = true
		this.error = null
		try {
			if (IS_E2E) {
				this.installed = E2E_INSTALLED
				this.available = E2E_AVAILABLE
				this.device = E2E_DEVICE
			} else {
				const [installed, available, device] = await Promise.all([
					invoke<LocalModel[]>('list_local_models'),
					invoke<AvailableModel[]>('available_models'),
					invoke<DeviceInfo>('device_info')
				])
				this.installed = installed
				this.available = available
				this.device = device
			}
		} catch (e) {
			this.error = String(e)
		} finally {
			this.loading = false
		}
	}

	// Relay the Rust pull-progress events into the `pulling` map.
	async #subscribe(): Promise<void> {
		if (IS_E2E) return
		try {
			this.#unlisten.push(
				await listen<{ id: string; pct: number }>('model-pull-progress', (ev) => {
					this.pulling = { ...this.pulling, [ev.payload.id]: ev.payload.pct }
				})
			)
			this.#unlisten.push(
				await listen<{ id: string }>('model-pull-done', (ev) => {
					this.#clearPull(ev.payload.id)
					this.refresh()
				})
			)
			this.#unlisten.push(
				await listen<{ id: string; error: string }>('model-pull-error', (ev) => {
					this.#clearPull(ev.payload.id)
					this.error = `pull ${ev.payload.id}: ${ev.payload.error}`
				})
			)
		} catch {
			/* not running under Tauri — no events */
		}
	}

	#clearPull(id: string): void {
		const next = { ...this.pulling }
		delete next[id]
		this.pulling = next
	}

	async pull(id: string): Promise<void> {
		if (this.pulling[id] != null) return
		this.pulling = { ...this.pulling, [id]: 0 }
		if (IS_E2E) {
			this.pulling = { ...this.pulling, [id]: 100 }
			return
		}
		try {
			await invoke('pull_model', { id }) // progress + completion arrive via events
		} catch (e) {
			this.#clearPull(id)
			this.error = String(e)
		}
	}

	async remove(id: string): Promise<void> {
		if (IS_E2E) {
			this.installed = this.installed.filter((m) => m.id !== id)
			return
		}
		try {
			await invoke('remove_model', { id })
			await this.refresh()
		} catch (e) {
			this.error = String(e)
		}
	}

	async setDefault(id: string): Promise<void> {
		if (IS_E2E) {
			this.installed = this.installed.map((m) => ({ ...m, is_default: m.id === id }))
			return
		}
		try {
			await invoke('set_default_model', { id })
			await this.refresh()
		} catch (e) {
			this.error = String(e)
		}
	}
}

export const models = new ModelsStore()
