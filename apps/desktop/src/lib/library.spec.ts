import { describe, it, expect } from 'vitest'
import {
	isTerminal,
	isIngesting,
	statusBadge,
	pipelineSteps,
	classificationClass,
	docIcon,
	fmtWhen,
	docTitle,
	ingestingCount
} from './library'
import type { DocumentRow } from './rag'

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
	document_id: 'd',
	title: null,
	original_filename: 'f.md',
	content_type: 'text/markdown',
	classification: 'internal',
	status: 'completed',
	status_reason: null,
	chunk_count: 3,
	space_id: 's',
	collection_id: null,
	created_at: '2026-08-01T10:00:00Z',
	completed_at: '2026-08-01T10:00:04Z',
	...over
})

describe('status', () => {
	it('terminal = completed | failed', () => {
		expect(isTerminal('completed')).toBe(true)
		expect(isTerminal('failed')).toBe(true)
		expect(isTerminal('embedding')).toBe(false)
		expect(isTerminal('uploaded')).toBe(false)
	})

	it('ingesting = in-flight (not terminal, not uploaded)', () => {
		expect(isIngesting('embedding')).toBe(true)
		expect(isIngesting('parsing')).toBe(true)
		expect(isIngesting('completed')).toBe(false)
		expect(isIngesting('failed')).toBe(false)
		expect(isIngesting('uploaded')).toBe(false)
	})

	it('badge maps each status to tone/label/spinner', () => {
		expect(statusBadge('completed')).toEqual({ label: 'Ready', tone: 'ok', spinning: false })
		expect(statusBadge('failed')).toEqual({ label: 'Failed', tone: 'fail', spinning: false })
		expect(statusBadge('queued')).toEqual({ label: 'Queued', tone: 'wait', spinning: false })
		expect(statusBadge('embedding')).toEqual({ label: 'Embedding', tone: 'run', spinning: true })
		expect(statusBadge('redacting')).toEqual({ label: 'Redacting', tone: 'run', spinning: true })
	})
})

describe('pipelineSteps', () => {
	it('completed → all done', () => {
		expect(pipelineSteps('completed').every((s) => s.state === 'done')).toBe(true)
	})
	it('embedding → prior stages done, embedding current, ready pending', () => {
		const s = pipelineSteps('embedding')
		expect(s.map((x) => x.state)).toEqual(['done', 'done', 'done', 'current', 'pending'])
	})
	it('failed → marks the failed stage, later stages pending', () => {
		const s = pipelineSteps('failed')
		expect(s.some((x) => x.state === 'failed')).toBe(true)
		expect(s[s.length - 1].state).toBe('pending')
	})
})

describe('helpers', () => {
	it('classificationClass falls back to internal for unknown', () => {
		expect(classificationClass('restricted')).toBe('restricted')
		expect(classificationClass('bogus')).toBe('internal')
	})
	it('docIcon picks by mime family', () => {
		expect(docIcon('application/pdf')).toContain('file-text')
		expect(docIcon('image/png')).toContain('gallery')
		expect(docIcon('text/markdown')).toContain('notes')
	})
	it('fmtWhen is a stable UTC yyyy-mm-dd hh:mm', () => {
		expect(fmtWhen('2026-08-01T10:05:09Z')).toBe('2026-08-01 10:05')
	})
	it('docTitle prefers title then filename', () => {
		expect(docTitle(doc({ title: 'Runbook' }))).toBe('Runbook')
		expect(docTitle(doc({ title: '  ', original_filename: 'x.pdf' }))).toBe('x.pdf')
	})
	it('ingestingCount counts only in-flight docs', () => {
		expect(
			ingestingCount([
				doc({ status: 'completed' }),
				doc({ status: 'embedding' }),
				doc({ status: 'failed' })
			])
		).toBe(1)
	})
})
