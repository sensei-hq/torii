// Torii desktop — C5 RAG gateway client (W2 Library + W3 retrieval lab). Typed wrappers over the
// C1 gateway endpoints (documents.rs / retrieve.rs), forwarding the Supabase JWT via gwGet/gwPost/
// gwDelete. Under IS_E2E every call returns a deterministic in-app fixture (no network/files) so the
// network-free Tauri e2e harness can drive the screens — the same seam cloud.ts uses for cloudInfer.
import { gwGet, gwPost, gwDelete } from './api'
import { GATEWAY_URL } from './env'
import { session } from '@torii/core'
import { IS_E2E } from './e2e'

// ── types (mirror the built endpoint shapes) ─────────────────────────────────────────────────
export interface DocumentRow {
	document_id: string
	title: string | null
	original_filename: string
	content_type: string
	classification: string
	/** uploaded|queued|parsing|redacting|chunking|embedding|indexing|processing|completed|failed */
	status: string
	status_reason: string | null
	chunk_count: number | null
	space_id: string | null
	collection_id: string | null
	created_at: string
	completed_at: string | null
}

export interface DocumentVersion {
	version_id: string
	version_no: number
	content_type: string | null
	created_at: string
	superseded_at: string | null
}

export interface DocumentDetail extends DocumentRow {
	scope: string
	embedding_model: string | null
	versions: DocumentVersion[]
}

export interface DocumentAsset {
	id: string
	kind: string
	label: string | null
	sequence: number | null
	page_ref: number | null
	caption: string | null
	download_url: string | null
}

export interface CreateDocResult {
	document_id: string
	version_no: number
	upload_url: string | null
}

export interface RetrieveScores {
	dense: number | null
	bm25: number | null
	fused: number
	rerank: number | null
}

export interface RetrieveChunk {
	chunk_id: string
	document_id: string
	text: string
	section_path: string | null
	page_ref: number | null
	scores: RetrieveScores
	dropped: boolean
}

export interface RetrieveStage {
	name: string
	k_in: number
	k_out: number
	ms: number
}

export interface RetrievalConfig {
	mode: string
	k_dense: number
	k_bm25: number
	k_out: number
	rrf_k: number
	match_threshold: number
	rerank: string | null
}

export interface RetrieveResult {
	chunks: RetrieveChunk[]
	stages: RetrieveStage[]
	grounding_ready: boolean
	config_used: RetrievalConfig
	redactions: number
}

export interface NewDocument {
	title?: string
	original_filename: string
	content_type: string
	space_id?: string
	collection_id?: string
	classification?: string
	scope?: string
}

const enc = encodeURIComponent

// ── deterministic e2e fixtures ───────────────────────────────────────────────────────────────
const E2E_SPACE = 'e2e-space-0000-0000-0000-000000000001'
const E2E_DOCS: DocumentRow[] = [
	{
		document_id: 'e2e-doc-ready',
		title: 'Widget Migration Runbook',
		original_filename: 'runbook.md',
		content_type: 'text/markdown',
		classification: 'internal',
		status: 'completed',
		status_reason: null,
		chunk_count: 3,
		space_id: E2E_SPACE,
		collection_id: null,
		created_at: '2026-08-01T10:00:00Z',
		completed_at: '2026-08-01T10:00:04Z'
	},
	{
		document_id: 'e2e-doc-ingesting',
		title: 'Q3 Board Deck',
		original_filename: 'board.pptx',
		content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		classification: 'confidential',
		status: 'embedding',
		status_reason: null,
		chunk_count: null,
		space_id: E2E_SPACE,
		collection_id: null,
		created_at: '2026-08-01T10:05:00Z',
		completed_at: null
	},
	{
		document_id: 'e2e-doc-failed',
		title: 'Scanned Invoice',
		original_filename: 'invoice.pdf',
		content_type: 'application/pdf',
		classification: 'internal',
		status: 'failed',
		status_reason: 'parser panicked on malformed input',
		chunk_count: null,
		space_id: E2E_SPACE,
		collection_id: null,
		created_at: '2026-08-01T10:07:00Z',
		completed_at: null
	}
]

const E2E_RETRIEVE: RetrieveResult = {
	chunks: [
		{
			chunk_id: 'e2e-c-01',
			document_id: 'e2e-doc-ready',
			text: 'The widget migration runs nightly at 02:00 UTC; rollback uses the previous snapshot. Deploy key [REDACTED:provider_key] must be rotated.',
			section_path: 'Widget Migration Runbook',
			page_ref: null,
			scores: { dense: 0.82, bm25: 0.031, fused: 0.0328, rerank: null },
			dropped: false
		},
		{
			chunk_id: 'e2e-c-02',
			document_id: 'e2e-doc-ready',
			text: 'On failure, page the on-call engineer and restore the prior snapshot before re-running.',
			section_path: 'Widget Migration Runbook > Rollback',
			page_ref: null,
			scores: { dense: 0.71, bm25: null, fused: 0.0164, rerank: null },
			dropped: false
		}
	],
	stages: [
		{ name: 'embed', k_in: 1, k_out: 1, ms: 12 },
		{ name: 'dense', k_in: 100, k_out: 2, ms: 4 },
		{ name: 'bm25', k_in: 100, k_out: 1, ms: 4 },
		{ name: 'fuse', k_in: 3, k_out: 2, ms: 4 }
	],
	grounding_ready: true,
	config_used: {
		mode: 'hybrid',
		k_dense: 100,
		k_bm25: 100,
		k_out: 20,
		rrf_k: 60,
		match_threshold: 0,
		rerank: null
	},
	redactions: 0
}

const DEFAULT_CONFIG: RetrievalConfig = {
	mode: 'hybrid',
	k_dense: 100,
	k_bm25: 100,
	k_out: 20,
	rrf_k: 60,
	match_threshold: 0,
	rerank: null
}

// ── client ───────────────────────────────────────────────────────────────────────────────────
export const rag = {
	/** List the caller's documents (classification-scoped server-side). */
	documents(params?: {
		space_id?: string
		collection?: string
		status?: string
	}): Promise<{ documents: DocumentRow[] }> {
		if (IS_E2E) return Promise.resolve({ documents: E2E_DOCS })
		const qs = new URLSearchParams()
		if (params?.space_id) qs.set('space_id', params.space_id)
		if (params?.collection) qs.set('collection', params.collection)
		if (params?.status) qs.set('status', params.status)
		const q = qs.toString()
		return gwGet(`/v1/documents${q ? `?${q}` : ''}`)
	},

	document(id: string): Promise<DocumentDetail> {
		if (IS_E2E) {
			const row = E2E_DOCS.find((d) => d.document_id === id) ?? E2E_DOCS[0]
			return Promise.resolve({
				...row,
				scope: 'tenant',
				embedding_model: 'mxbai-embed-large',
				versions: [
					{
						version_id: 'e2e-v1',
						version_no: 1,
						content_type: row.content_type,
						created_at: row.created_at,
						superseded_at: null
					}
				]
			})
		}
		return gwGet(`/v1/documents/${enc(id)}`)
	},

	assets(id: string): Promise<{ assets: DocumentAsset[] }> {
		if (IS_E2E)
			return Promise.resolve({
				assets: [
					{
						id: 'e2e-a1',
						kind: 'markdown',
						label: 'normalized.md',
						sequence: 0,
						page_ref: null,
						caption: null,
						download_url: 'e2e://asset/md'
					},
					{
						id: 'e2e-a2',
						kind: 'ir_json',
						label: 'ir.json',
						sequence: 0,
						page_ref: null,
						caption: null,
						download_url: 'e2e://asset/ir'
					}
				]
			})
		return gwGet(`/v1/documents/${enc(id)}/assets`)
	},

	createDocument(body: NewDocument): Promise<CreateDocResult> {
		if (IS_E2E)
			return Promise.resolve({
				document_id: 'e2e-doc-new',
				version_no: 1,
				upload_url: 'e2e://upload'
			})
		return gwPost('/v1/documents', body)
	},

	/** Raw PUT of the original bytes to the signed upload URL (self-authenticating; NOT GATEWAY_URL). */
	async uploadOriginal(uploadUrl: string, file: Blob): Promise<void> {
		if (IS_E2E) return
		const res = await fetch(uploadUrl, {
			method: 'PUT',
			headers: { 'content-type': file.type || 'application/octet-stream' },
			body: file
		})
		if (!res.ok) throw new Error(`upload → ${res.status}`)
	},

	ingest(id: string): Promise<{ document_id: string; status: string }> {
		if (IS_E2E) return Promise.resolve({ document_id: id, status: 'queued' })
		return gwPost(`/v1/documents/${enc(id)}/ingest`, {})
	},

	reingest(id: string): Promise<{ document_id: string; status: string }> {
		if (IS_E2E) return Promise.resolve({ document_id: id, status: 'queued' })
		return gwPost(`/v1/documents/${enc(id)}/reingest`, {})
	},

	deleteDocument(id: string): Promise<{ deleted: boolean }> {
		if (IS_E2E) return Promise.resolve({ deleted: true })
		return gwDelete(`/v1/documents/${enc(id)}`)
	},

	retrieve(
		spaceId: string,
		body: { query: string; top_k?: number; inspect?: boolean }
	): Promise<RetrieveResult> {
		if (IS_E2E) return Promise.resolve(E2E_RETRIEVE)
		return gwPost(`/v1/spaces/${enc(spaceId)}/retrieve`, body)
	},

	retrievalConfig(spaceId: string): Promise<RetrievalConfig> {
		if (IS_E2E) return Promise.resolve(DEFAULT_CONFIG)
		return gwGet(`/v1/spaces/${enc(spaceId)}/retrieval-config`)
	}
}

/** Fetch a signed asset URL's text (e.g. the normalized markdown) for preview. E2E → canned. */
export async function fetchAssetText(url: string): Promise<string> {
	if (IS_E2E) return '# Widget Migration Runbook\n\nThe widget migration runs nightly…'
	const res = await fetch(url)
	if (!res.ok) throw new Error(`asset → ${res.status}`)
	return res.text()
}

export { GATEWAY_URL, session }
