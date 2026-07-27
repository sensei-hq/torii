import { test, expect } from '../fixtures'

test.describe('Desktop shell', () => {
	test('boots and renders the Desktop shell', async ({ tauriPage }) => {
		// Phase 0 smoke — updated for DesktopShell (data-desktop-shell replaces data-app-shell)
		await expect(tauriPage.locator('[data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
		await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
		// Home h1 is the welcome banner in (app)/+page.svelte ("Welcome back, <name>.")
		const title = await tauriPage.locator('h1').textContent()
		expect(title).toContain('Welcome')
	})
})
