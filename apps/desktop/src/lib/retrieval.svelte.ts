// Torii desktop — W3 retrieval-lab state. Owns the query, the selected space (derived from the
// member's documents), the resolved per-space config, and the last RetrieveResult (the inspector
// data). Pure derivations live in retrieval.ts.
import { rag, type RetrieveResult, type RetrievalConfig } from './rag'
import { spacesFromDocs } from './retrieval'

class RetrievalStore {
	query = $state('')
	spaceId = $state<string | null>(null)
	spaces = $state<{ id: string; count: number }[]>([])
	topK = $state(10)
	result = $state<RetrieveResult | null>(null)
	config = $state<RetrievalConfig | null>(null)
	loading = $state(false)
	error = $state<string | null>(null)
	loaded = $state(false)

	async load(): Promise<void> {
		if (this.loaded) return
		await this.loadSpaces()
		this.loaded = true
	}

	async loadSpaces(): Promise<void> {
		try {
			const { documents } = await rag.documents()
			this.spaces = spacesFromDocs(documents)
			if (!this.spaceId && this.spaces.length) await this.setSpace(this.spaces[0].id)
		} catch (e) {
			this.error = String(e)
		}
	}

	async setSpace(id: string): Promise<void> {
		this.spaceId = id
		this.result = null
		try {
			this.config = await rag.retrievalConfig(id)
		} catch {
			this.config = null
		}
	}

	setTopK(n: number): void {
		this.topK = Math.max(1, Math.min(50, Math.round(n)))
	}

	async run(): Promise<void> {
		const q = this.query.trim()
		if (!q || !this.spaceId || this.loading) return
		this.loading = true
		this.error = null
		try {
			this.result = await rag.retrieve(this.spaceId, { query: q, top_k: this.topK, inspect: true })
		} catch (e) {
			this.error = String(e)
			this.result = null
		} finally {
			this.loading = false
		}
	}
}

export const retrieval = new RetrievalStore()
