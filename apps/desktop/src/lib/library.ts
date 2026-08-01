// Torii desktop — W2 Library pure derivations (status badges, the ingestion pipeline stepper,
// classification, formatting). No runes / no I/O so it unit-tests in the node vitest env; the
// LibraryStore (library.svelte.ts) and +page.svelte consume these.
import type { DocumentRow } from './rag'

export type IngTone = 'ok' | 'wait' | 'run' | 'fail'

/** A terminal status ends the ingestion pipeline (stop polling). */
export function isTerminal(status: string): boolean {
	return status === 'completed' || status === 'failed'
}

/** In-flight ingestion (drives the spinner + the "N ingesting" count). */
export function isIngesting(status: string): boolean {
	return !isTerminal(status) && status !== 'uploaded'
}

const RUN_LABEL: Record<string, string> = {
	parsing: 'Parsing',
	redacting: 'Redacting',
	chunking: 'Chunking',
	embedding: 'Embedding',
	indexing: 'Indexing',
	processing: 'Processing'
}

/** IngBadge state (mockup ING map, reconciled to the backend enum where terminal-success = completed). */
export function statusBadge(status: string): { label: string; tone: IngTone; spinning: boolean } {
	if (status === 'completed') return { label: 'Ready', tone: 'ok', spinning: false }
	if (status === 'failed') return { label: 'Failed', tone: 'fail', spinning: false }
	if (status === 'uploaded' || status === 'queued')
		return { label: 'Queued', tone: 'wait', spinning: false }
	return { label: RUN_LABEL[status] ?? 'Processing', tone: 'run', spinning: true }
}

export const PIPELINE_STAGES = ['queued', 'parsing', 'chunking', 'embedding', 'ready'] as const

const STATUS_TO_STAGE: Record<string, number> = {
	uploaded: 0,
	queued: 0,
	parsing: 1,
	redacting: 1,
	chunking: 2,
	embedding: 3,
	indexing: 3,
	processing: 3,
	completed: 4,
	failed: 1
}

export type StepState = 'done' | 'current' | 'pending' | 'failed'

/** The 5-stage ingestion stepper for the doc workspace, resolved from a document's status. */
export function pipelineSteps(status: string): { name: string; state: StepState }[] {
	const idx = STATUS_TO_STAGE[status] ?? 0
	const failed = status === 'failed'
	const done = status === 'completed'
	return PIPELINE_STAGES.map((name, i) => {
		if (done) return { name, state: 'done' }
		if (failed) return { name, state: i < idx ? 'done' : i === idx ? 'failed' : 'pending' }
		return { name, state: i < idx ? 'done' : i === idx ? 'current' : 'pending' }
	})
}

const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted']

/** The clf-<class> token suffix (falls back to 'internal' for an unknown value). */
export function classificationClass(c: string): string {
	return CLASSIFICATIONS.includes(c) ? c : 'internal'
}

/** Solar icon for a document by mime (best-effort). */
export function docIcon(contentType: string): string {
	const m = contentType.toLowerCase()
	if (m.includes('pdf')) return 'i-solar-file-text-bold-duotone'
	if (m.includes('spreadsheet') || m.includes('sheet') || m.includes('csv'))
		return 'i-solar-chart-2-bold-duotone'
	if (m.includes('presentation') || m.includes('powerpoint'))
		return 'i-solar-slider-vertical-bold-duotone'
	if (m.includes('word') || m.includes('document')) return 'i-solar-document-text-bold-duotone'
	if (m.startsWith('image/')) return 'i-solar-gallery-bold-duotone'
	if (m.includes('markdown') || m.includes('text')) return 'i-solar-notes-bold-duotone'
	return 'i-solar-file-bold-duotone'
}

/** Short UTC timestamp for list rows (deterministic, locale-free). */
export function fmtWhen(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
	return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso
}

export function docTitle(d: DocumentRow): string {
	return (d.title && d.title.trim()) || d.original_filename
}

/** Count of documents still ingesting (for the "N in flight" attention note). */
export function ingestingCount(docs: DocumentRow[]): number {
	return docs.filter((d) => isIngesting(d.status)).length
}
