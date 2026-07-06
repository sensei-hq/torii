import { test, expect } from '../fixtures'

test.describe('Desktop shell', () => {
	test('boots and renders the Desktop shell', async ({ tauriPage }) => {
		// Phase 0 smoke — updated for DesktopShell (data-desktop-shell replaces data-app-shell)
		await expect(tauriPage.locator('[data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
		await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
		// Workspace h1 is in the (app)/+page.svelte section, not in a <header>
		const title = await tauriPage.locator('h1').textContent()
		expect(title).toContain('Workspace')
	})
})
