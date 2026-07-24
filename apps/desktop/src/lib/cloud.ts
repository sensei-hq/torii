import { GATEWAY_URL } from './env'
import { session } from '@strategos/core'
import type { ChatMessage, InferResult } from './gateway'

interface C1ChatResponse {
	content: string
	model?: string
	cost_usd: number
	input_tokens?: number
	output_tokens?: number
}

// Cloud leg: proxy the request to the C1 central gateway with the Supabase JWT.
// Provider keys stay on C1 — the desktop only forwards the token, never a key.
export async function cloudInfer(
	messages: ChatMessage[],
	opts: { chain?: string } = {}
): Promise<InferResult> {
	// Deterministic E2E stub — no network, no token required. Strictly env-gated.
	if (import.meta.env.VITE_E2E === 'true') {
		return {
			content: 'Hello from the cloud gateway.',
			model: 'gemma4',
			plane: 'cloud',
			cost_usd: 0,
			duration_ms: 0
		}
	}

	const token = session.accessToken
	if (!token) throw new Error('not signed in — the cloud plane needs a session')

	// chain defaults to 'local' so the demo routes C1 → Ollama at $0; production uses 'chat'.
	const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ messages, chain: opts.chain ?? 'local' })
	})
	if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text().catch(() => '')}`)

	const r: C1ChatResponse = await res.json()
	return {
		content: r.content,
		model: r.model,
		plane: 'cloud',
		cost_usd: r.cost_usd,
		duration_ms: 0
	}
}
