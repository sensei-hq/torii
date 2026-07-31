import { invoke } from '@tauri-apps/api/core'
import { IS_E2E } from './e2e'

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string
}
export interface InferResult {
	content: string
	model?: string
	plane: 'local' | 'cloud'
	cost_usd: number
	duration_ms: number
}
export interface ModelInfo {
	id: string
	name: string
	local: boolean
}

export const gateway = {
	infer: (messages: ChatMessage[], opts: { model?: string } = {}) => {
		if (IS_E2E) {
			return Promise.resolve<InferResult>({
				content: 'Hello from your on-device model.',
				model: opts.model ?? 'gemma2:2b',
				plane: 'local',
				cost_usd: 0,
				duration_ms: 0
			})
		}
		return invoke<InferResult>('infer', {
			args: { messages, model: opts.model ?? null, system: null, max_tokens: 1024 }
		})
	},
	listModels: () => invoke<ModelInfo[]>('list_models'),
	status: () => invoke<{ configured: boolean; adapters: string[] }>('gateway_status')
}
