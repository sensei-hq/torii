import { describe, it, expect } from 'vitest'
import {
	spacesFromDocs,
	clampPct,
	densePct,
	maxFused,
	fusedPct,
	fmtScore,
	stageSummary,
	configSummary
} from './retrieval'
import type { DocumentRow, RetrieveChunk, RetrieveStage, RetrievalConfig } from './rag'

const doc = (space_id: string | null): DocumentRow => ({
	document_id: Math.random().toString(36),
	title: null,
	original_filename: 'f.md',
	content_type: 'text/markdown',
	classification: 'internal',
	status: 'completed',
	status_reason: null,
	chunk_count: 1,
	space_id,
	collection_id: null,
	created_at: '2026-08-01T10:00:00Z',
	completed_at: null
})

const chunk = (dense: number | null, fused: number): RetrieveChunk => ({
	chunk_id: 'c',
	document_id: 'd',
	text: 't',
	section_path: null,
	page_ref: null,
	scores: { dense, bm25: null, fused, rerank: null },
	dropped: false
})

describe('spacesFromDocs', () => {
	it('distinct non-null space_ids with counts, desc', () => {
		const out = spacesFromDocs([doc('a'), doc('a'), doc('b'), doc(null)])
		expect(out).toEqual([
			{ id: 'a', count: 2 },
			{ id: 'b', count: 1 }
		])
	})
	it('empty when no spaces', () => {
		expect(spacesFromDocs([doc(null)])).toEqual([])
	})
})

describe('score bars', () => {
	it('clampPct bounds 0..100 and handles NaN', () => {
		expect(clampPct(150)).toBe(100)
		expect(clampPct(-5)).toBe(0)
		expect(clampPct(NaN)).toBe(0)
		expect(clampPct(42)).toBe(42)
	})
	it('densePct = cosine * 100', () => {
		expect(densePct(chunk(0.82, 0.03))).toBeCloseTo(82)
		expect(densePct(chunk(null, 0.03))).toBe(0)
	})
	it('fusedPct is relative to the top fused score', () => {
		const chunks = [chunk(0.9, 0.04), chunk(0.5, 0.02)]
		expect(maxFused(chunks)).toBeCloseTo(0.04)
		expect(fusedPct(chunks[0], chunks)).toBeCloseTo(100)
		expect(fusedPct(chunks[1], chunks)).toBeCloseTo(50)
	})
})

describe('formatting', () => {
	it('fmtScore renders — for null', () => {
		expect(fmtScore(null)).toBe('—')
		expect(fmtScore(0.031)).toBe('0.031')
	})
	it('stageSummary lists name+k_out', () => {
		const stages: RetrieveStage[] = [
			{ name: 'embed', k_in: 1, k_out: 1, ms: 1 },
			{ name: 'dense', k_in: 100, k_out: 2, ms: 1 },
			{ name: 'fuse', k_in: 3, k_out: 2, ms: 1 }
		]
		expect(stageSummary(stages)).toBe('embed 1 · dense 2 · fuse 2')
	})
	it('configSummary reads the mode/k/rerank', () => {
		const c: RetrievalConfig = {
			mode: 'hybrid',
			k_dense: 100,
			k_bm25: 100,
			k_out: 20,
			rrf_k: 60,
			match_threshold: 0,
			rerank: null
		}
		expect(configSummary(c)).toBe('hybrid · RRF k=60 · top 20 · no rerank')
		expect(configSummary(null)).toBe('')
	})
})
