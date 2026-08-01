import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

// C5 RAG frontend e2e. The harness is network-free: rag.ts returns deterministic IS_E2E fixtures
// (3 docs — ready/ingesting/failed; a 2-chunk retrieve result), so this verifies the UI FLOWS +
// rendering, not the live gateway (the live path is covered by services/gateway/scripts/rag-e2e.sh).

/** Click a primary-nav button by its label (anchor clicks don't route in the built WKWebView). */
async function nav(tauriPage: any, label: string): Promise<void> {
	await tauriPage.evaluate(`
		(async function () {
			const b = Array.from(document.querySelectorAll('nav[aria-label="Primary"] button'))
				.find((x) => x.textContent?.trim() === ${JSON.stringify(label)})
			if (!b) throw new Error('nav button not found: ' + ${JSON.stringify(label)})
			b.click()
			await new Promise((r) => setTimeout(r, 50))
		})()
	`)
	await sleep(900)
}

test.describe('C5 RAG frontend', () => {
	test('Library lists documents with ingestion status + opens the detail drawer', async ({
		tauriPage
	}) => {
		await expect(tauriPage.locator('[data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
		await nav(tauriPage, 'Library')

		await expect(tauriPage.locator('[data-library]')).toBeVisible()
		// stubbed: a completed, an ingesting (embedding), and a failed document.
		await expect(tauriPage.locator('[data-doc-row]')).toHaveCount(3)
		await expect(tauriPage.locator('[data-ingest-status]').first()).toBeVisible()
		// one doc is mid-ingest → the "N ingesting…" note shows.
		await expect(tauriPage.locator('[data-ingesting-note]')).toBeVisible()

		// open the first document → detail drawer with the ingestion pipeline.
		await tauriPage.locator('[data-doc-row]').first().click()
		await sleep(700)
		await expect(tauriPage.locator('[data-doc-detail]')).toBeVisible()
		await expect(tauriPage.locator('[data-doc-detail]')).toContainText(/Ingestion pipeline/i)
		await expect(tauriPage.locator('[data-doc-detail]')).toContainText(/Extracted assets/i)
	})

	test('Retrieval inspector runs a query and shows scored chunks + stages', async ({
		tauriPage
	}) => {
		await nav(tauriPage, 'Retrieval')
		await expect(tauriPage.locator('[data-retrieval]')).toBeVisible()
		// space auto-selected from the stubbed documents.
		await expect(tauriPage.locator('[data-space-select]')).toBeVisible()

		await tauriPage.locator('[data-query]').fill('widget migration rollback')
		await tauriPage.locator('[data-retrieve-run]').click()
		await sleep(800)

		await expect(tauriPage.locator('[data-grounding]')).toContainText(/grounding ready/i)
		// stubbed retrieve returns 2 chunks, each with dense/bm25/fused score bars.
		await expect(tauriPage.locator('[data-chunk]')).toHaveCount(2)
		await expect(tauriPage.locator('[data-score]').first()).toBeVisible()
		await expect(tauriPage.locator('[data-stage]')).toContainText(/embed/i)
	})
})
