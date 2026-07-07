import { invoke } from '@tauri-apps/api/core'

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
	infer: (messages: ChatMessage[], opts: { model?: string } = {}) =>
		invoke<InferResult>('infer', {
			args: { messages, model: opts.model ?? null, system: null, max_tokens: 1024 }
		}),
	listModels: () => invoke<ModelInfo[]>('list_models'),
	status: () => invoke<{ configured: boolean; adapters: string[] }>('gateway_status')
}
