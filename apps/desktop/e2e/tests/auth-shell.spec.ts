import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

test.describe('Desktop auth + shell', () => {
	test('seeded member sees the DesktopShell with nav + user', async ({ tauriPage }) => {
		await expect(tauriPage.locator('[data-desktop-shell], [data-app-shell]')).toBeVisible({
			timeout: 20_000
		})
		await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
		await expect(tauriPage.locator('[data-env-chip]')).toBeVisible()
		// User name 'E2E Member' is rendered in the title bar — scope to data-title-bar
		// to avoid ambiguity with any nav text.
		await expect(tauriPage.locator('[data-title-bar]')).toContainText('E2E Member')
	})

	test('nav to Ask switches route', async ({ tauriPage }) => {
		// anchor-click to (app) routes doesn't trigger SvelteKit client-side routing in a
		// built Tauri WKWebView; click the NavRail "Ask" button which calls goto() directly.
		await tauriPage.evaluate(`
			(async function() {
				const buttons = Array.from(document.querySelectorAll('nav[aria-label="Primary"] button'))
				const askBtn = buttons.find(b => b.textContent?.trim() === 'Ask')
				if (!askBtn) throw new Error('Ask nav button not found in primary nav')
				askBtn.click()
				await new Promise(r => setTimeout(r, 50))
			})()
		`)
		await sleep(1_000)
		await expect(tauriPage.locator('h1')).toContainText(/ask/i)
	})
})
