// Torii desktop — W3 retrieval-lab pure derivations (score bars, stage summary, space list,
// config summary). No runes / no I/O → unit-tested in the node vitest env. The RetrievalStore
// (retrieval.svelte.ts) + +page.svelte consume these.
import type { DocumentRow, RetrieveChunk, RetrieveStage, RetrievalConfig } from './rag'

/** Distinct spaces the member has documents in (there is no spaces-list endpoint yet, so the
 * retrieval lab derives its space picker from the document list). Ordered by doc count desc. */
export function spacesFromDocs(docs: DocumentRow[]): { id: string; count: number }[] {
	const counts = new Map<string, number>()
	for (const d of docs) {
		if (d.space_id) counts.set(d.space_id, (counts.get(d.space_id) ?? 0) + 1)
	}
	return [...counts.entries()]
		.map(([id, count]) => ({ id, count }))
		.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export function clampPct(n: number): number {
	if (Number.isNaN(n)) return 0
	return Math.max(0, Math.min(100, n))
}

/** Dense cosine (0..1) as a bar width % — the meaningful per-chunk signal. */
export function densePct(chunk: RetrieveChunk): number {
	return clampPct((chunk.scores.dense ?? 0) * 100)
}

export function maxFused(chunks: RetrieveChunk[]): number {
	return chunks.reduce((m, c) => Math.max(m, c.scores.fused), 0)
}

/** Fused RRF is small in absolute terms; show it RELATIVE to the top hit so the bar reads. */
export function fusedPct(chunk: RetrieveChunk, chunks: RetrieveChunk[]): number {
	const max = maxFused(chunks)
	return max > 0 ? clampPct((chunk.scores.fused / max) * 100) : 0
}

export function fmtScore(n: number | null | undefined): string {
	return n === null || n === undefined ? '—' : n.toFixed(3)
}

/** One-line per-stage summary, e.g. "embed 1 · dense 2 · bm25 1 · fuse 2". */
export function stageSummary(stages: RetrieveStage[]): string {
	return stages.map((s) => `${s.name} ${s.k_out}`).join(' · ')
}

/** Config legend, e.g. "hybrid · RRF k=60 · top 20". */
export function configSummary(c: RetrievalConfig | null): string {
	if (!c) return ''
	const rerank = c.rerank ? ` · rerank ${c.rerank}` : ' · no rerank'
	return `${c.mode} · RRF k=${c.rrf_k} · top ${c.k_out}${rerank}`
}
