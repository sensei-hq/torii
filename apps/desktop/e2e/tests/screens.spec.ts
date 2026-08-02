import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

// Local Models + Workflows screens, driven in the real Tauri binary. Under IS_E2E the models store
// serves deterministic fixtures (2 installed, a download registry) so this is network-free; the real
// Tauri model-management IPC (list_local_models/pull_model/…) is compile-verified separately.
// Workflows is a static v2 design-preview (no backend).

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

test.describe('Desktop screens — Models + Workflows', () => {
	test('Local models: device card, installed list, download registry', async ({ tauriPage }) => {
		await expect(tauriPage.locator('[data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
		await nav(tauriPage, 'Local models')

		await expect(tauriPage.locator('[data-models]')).toBeVisible()
		await expect(tauriPage.locator('[data-device]')).toBeVisible()
		// stubbed installed: gemma2:2b (default) + mxbai-embed-large.
		await expect(tauriPage.locator('[data-installed] [data-model-row]')).toHaveCount(2)
		await expect(tauriPage.locator('[data-available]')).toBeVisible()
		// a not-installed, fitting model (llama3.2:3b) offers a Download button.
		await expect(tauriPage.locator('[data-pull]').first()).toBeVisible()
	})

	test('Workflows: v2 design-preview (flows + builder)', async ({ tauriPage }) => {
		await nav(tauriPage, 'Workflows')
		await expect(tauriPage.locator('[data-workflows]')).toBeVisible()
		await expect(tauriPage.locator('[data-workflows]')).toContainText(/v2 preview/i)
		// the example-flows list + the read-only builder canvas.
		await expect(tauriPage.locator('[data-flow-row]').first()).toBeVisible()
		await expect(tauriPage.locator('[data-builder]')).toBeVisible()
	})
})
