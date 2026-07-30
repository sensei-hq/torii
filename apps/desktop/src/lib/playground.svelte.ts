// Three-layer state (runbook B4) for the Torii Playground: the component reads these fields and
// routes intent through the named methods; this store owns every data change; the Load seam is
// the run itself (real inference via the plane router + real /v1/judge scoring — no mock data).
import type { ChatMessage, InferResult } from './gateway'
import { route, type Plane } from './plane'
import { judgeAnswers } from './cloud'

class PlaygroundStore {
	system = $state('You are a concise assistant.')
	prompt = $state('')
	// D3 split-plane: cloud (via the C1 gateway) or local (on-device, Tauri). Cloud is the default.
	plane = $state<Plane>('cloud')
	loading = $state(false)
	error = $state('')
	result = $state<InferResult | null>(null)
	sent = $state<ChatMessage[]>([])
	showInspector = $state(false)

	// Quality judge (C6 · POST /v1/judge). Off by default — judging is a *second* metered call,
	// so it runs only when the member opts in; once on it auto-scores every new answer.
	judgeOn = $state(false)
	judging = $state(false)
	/** 0..1 from /v1/judge, or null when the answer couldn't be scored. */
	judgeScore = $state<number | null>(null)
	judgeError = $state('')
	// The exact prompt that produced `result`, so the judge scores the real question→answer pair.
	#judgedPrompt = ''

	/** Run the system+user prompt through the selected plane in one shot. */
	async run(): Promise<void> {
		const p = this.prompt.trim()
		if (!p || this.loading) return
		this.loading = true
		this.error = ''
		this.result = null
		this.judgeScore = null
		this.judgeError = ''
		const messages: ChatMessage[] = []
		if (this.system.trim()) messages.push({ role: 'system', content: this.system.trim() })
		messages.push({ role: 'user', content: p })
		this.sent = messages
		const started = performance.now()
		try {
			const res = await route(messages, this.plane)
			// The cloud leg reports duration_ms: 0 → measure the round-trip client-side so the
			// latency meter is a real number, never a blank (mirrors the Ask store).
			const duration_ms = res.duration_ms || Math.round(performance.now() - started)
			this.result = { ...res, duration_ms }
			this.#judgedPrompt = p
			if (this.judgeOn) await this.judge()
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e)
		} finally {
			this.loading = false
		}
	}

	/** Score the current answer via /v1/judge. No-op without a result or while already judging. */
	async judge(): Promise<void> {
		const r = this.result
		if (!r || this.judging) return
		this.judging = true
		this.judgeError = ''
		try {
			const scores = await judgeAnswers(this.#judgedPrompt, [{ id: 'answer', content: r.content }])
			this.judgeScore = scores.answer ?? null
		} catch (e) {
			this.judgeScore = null
			this.judgeError = e instanceof Error ? e.message : String(e)
		} finally {
			this.judging = false
		}
	}

	/** Toggle the quality judge; turning it on scores the current (un-judged) answer immediately. */
	toggleJudge(): void {
		this.judgeOn = !this.judgeOn
		if (this.judgeOn && this.result && this.judgeScore == null && !this.judging) void this.judge()
	}

	toggleInspector(): void {
		this.showInspector = !this.showInspector
	}
}

export const playground = new PlaygroundStore()
