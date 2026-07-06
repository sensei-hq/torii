import { test, expect } from '../fixtures'

test.describe('Desktop shell', () => {
	test('boots and renders the Console shell', async ({ tauriPage }) => {
		await expect(tauriPage.locator('[data-app-shell]')).toBeVisible({ timeout: 20_000 })
		await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
		const title = await tauriPage.locator('header h1').textContent()
		expect(title).toContain('Workspace')
	})
})
