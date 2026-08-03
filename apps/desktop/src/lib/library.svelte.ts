// Torii desktop — W2 Library state (the Load/State seam). Owns the document list, the upload flow
// (register → PUT signed URL → ingest → poll to terminal), and the selected doc's detail + assets.
// Pure derivations live in library.ts; the +page.svelte only renders + calls these methods.
import {
	rag,
	type DocumentRow,
	type DocumentDetail,
	type DocumentAsset,
	type NewDocument
} from './rag'
import { isTerminal } from './library'

class LibraryStore {
	docs = $state<DocumentRow[]>([])
	loading = $state(false)
	error = $state<string | null>(null)
	loaded = $state(false)

	// upload flow
	uploading = $state(false)
	uploadError = $state<string | null>(null)

	// selection / detail
	selectedId = $state<string | null>(null)
	detail = $state<DocumentDetail | null>(null)
	assets = $state<DocumentAsset[]>([])
	detailLoading = $state(false)

	#polls = new Map<string, ReturnType<typeof setTimeout>>()

	async load(): Promise<void> {
		if (this.loaded) return
		await this.refresh()
		this.loaded = true
	}

	async refresh(): Promise<void> {
		this.loading = true
		this.error = null
		try {
			const { documents } = await rag.documents()
			this.docs = documents
		} catch (e) {
			this.error = String(e)
		} finally {
			this.loading = false
		}
	}

	/** Full upload: register → PUT bytes to the signed URL → ingest → poll until terminal. */
	async upload(file: File, opts?: Partial<NewDocument>): Promise<void> {
		if (this.uploading) return
		this.uploading = true
		this.uploadError = null
		try {
			const reg = await rag.createDocument({
				original_filename: file.name,
				content_type: file.type || 'application/octet-stream',
				title: opts?.title,
				space_id: opts?.space_id,
				collection_id: opts?.collection_id,
				classification: opts?.classification
			})
			if (reg.upload_url) await rag.uploadOriginal(reg.upload_url, file)
			await rag.ingest(reg.document_id)
			await this.refresh()
			this.#poll(reg.document_id)
		} catch (e) {
			this.uploadError = String(e)
		} finally {
			this.uploading = false
		}
	}

	/** Re-run the pipeline for a doc (e.g. recover a failed one), then poll. */
	async reingest(id: string): Promise<void> {
		try {
			await rag.reingest(id)
			await this.refresh()
			this.#poll(id)
		} catch (e) {
			this.error = String(e)
		}
	}

	// Poll the list until this doc reaches a terminal status (completed/failed), then stop.
	#poll(id: string): void {
		const existing = this.#polls.get(id)
		if (existing) clearTimeout(existing)
		const tick = async () => {
			await this.refresh()
			const d = this.docs.find((x) => x.document_id === id)
			if (!d || isTerminal(d.status)) {
				this.#polls.delete(id)
				return
			}
			this.#polls.set(id, setTimeout(tick, 1500))
		}
		this.#polls.set(id, setTimeout(tick, 1500))
	}

	async select(id: string): Promise<void> {
		this.selectedId = id
		this.detail = null
		this.assets = []
		this.detailLoading = true
		try {
			this.detail = await rag.document(id)
			const { assets } = await rag.assets(id)
			this.assets = assets
		} catch (e) {
			this.error = String(e)
		} finally {
			this.detailLoading = false
		}
	}

	closeDetail(): void {
		this.selectedId = null
		this.detail = null
		this.assets = []
	}

	async remove(id: string): Promise<void> {
		try {
			await rag.deleteDocument(id)
			if (this.selectedId === id) this.closeDetail()
			await this.refresh()
		} catch (e) {
			this.error = String(e)
		}
	}
}

export const library = new LibraryStore()
