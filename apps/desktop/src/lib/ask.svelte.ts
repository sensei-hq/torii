import { gateway, type ChatMessage, type InferResult } from './gateway'

export interface Turn {
	role: 'user' | 'assistant'
	content: string
	exec?: InferResult
}

class AskStore {
	turns = $state<Turn[]>([])
	loading = $state(false)
	error = $state<string | null>(null)

	async send(text: string) {
		const q = text.trim()
		if (!q || this.loading) return
		this.turns.push({ role: 'user', content: q })
		this.loading = true
		this.error = null
		try {
			const history: ChatMessage[] = this.turns.map((t) => ({ role: t.role, content: t.content }))
			const res = await gateway.infer(history)
			this.turns.push({ role: 'assistant', content: res.content, exec: res })
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
