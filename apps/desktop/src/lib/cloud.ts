import { GATEWAY_URL } from './env'
import { IS_E2E } from './e2e'
import { session } from '@torii/core'
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
	opts: { chain?: string; model?: string } = {}
): Promise<InferResult> {
	// Deterministic E2E stub — no network, no token required. Strictly env-gated.
	if (IS_E2E) {
		return {
			content: 'Hello from the cloud gateway.',
			model: opts.model ?? 'gemma4',
			plane: 'cloud',
			cost_usd: 0,
			duration_ms: 0
		}
	}

	const token = session.accessToken
	if (!token) throw new Error('not signed in — the cloud plane needs a session')

	// A named model targets that model directly (the gateway routes + governs it, e.g. the
	// workspace model-disable check); otherwise request a CAPABILITY CHAIN and let the gateway
	// route it (step-down / free-floor / budget) — the client must not hardcode the plane. Default
	// is the real 'chat' chain (M1); a demo/harness that wants a $0 local-only run passes
	// `chain: 'local'` explicitly rather than baking it into the product path.
	const body = opts.model
		? { messages, model: opts.model }
		: { messages, chain: opts.chain ?? 'chat' }
	const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify(body)
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

// C6 quality judge: score candidate answers to a question 0..1 via the gateway's local
// judge (POST /v1/judge). Used by Compare to rank answers on quality. Returns a map of the
// caller's answer id → score (null when an answer couldn't be judged). The judge runs on
// the central gateway regardless of where each answer was produced (it scores the text).
export async function judgeAnswers(
	question: string,
	answers: { id: string; content: string }[]
): Promise<Record<string, number | null>> {
	// Deterministic E2E stub — descending scores, no network.
	if (IS_E2E) {
		return Object.fromEntries(answers.map((a, i) => [a.id, Math.max(0, 1 - i * 0.15)]))
	}

	const token = session.accessToken
	if (!token) throw new Error('not signed in — the quality judge needs a session')

	const res = await fetch(`${GATEWAY_URL}/v1/judge`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ question, answers })
	})
	if (!res.ok) throw new Error(`judge ${res.status}: ${await res.text().catch(() => '')}`)

	const r: { scores: { id: string; score: number | null }[] } = await res.json()
	return Object.fromEntries(r.scores.map((s) => [s.id, s.score]))
}
