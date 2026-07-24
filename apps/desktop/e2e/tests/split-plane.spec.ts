import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

// D3 split-plane: one Ask UI, two planes. Both legs are deterministically stubbed
// under VITE_E2E (local in gateway.ts, cloud in cloud.ts) — no network, no token.
test.describe('Ask — split-plane (local vs cloud)', () => {
	test('routes to the selected plane with an accurate ExecBadge', async ({ tauriPage }) => {
		// Navigate to /ask via the NavRail button (WKWebView-safe; same as ask.spec.ts).
		await tauriPage.evaluate(`
			(async function () {
				const buttons = Array.from(document.querySelectorAll('nav[aria-label="Primary"] button'))
				const askBtn = buttons.find(b => b.textContent?.trim() === 'Ask')
				if (!askBtn) throw new Error('Ask nav button not found in primary nav')
				askBtn.click()
				await new Promise(r => setTimeout(r, 50))
			})()
		`)
		await sleep(1_000)

		const input = tauriPage.locator('[data-ask] input')
		await expect(input).toBeVisible({ timeout: 10_000 })

		// --- Local plane (default) ---
		await input.fill('Answer locally, please.')
		await tauriPage.locator('[data-ask] [data-send]').click()
		await sleep(1_000)
		await expect(tauriPage.getByText('Hello from your on-device model.')).toBeVisible({
			timeout: 10_000
		})
		const localBadge = tauriPage.locator('[data-exec-badge][data-plane="local"]')
		await expect(localBadge).toBeVisible()
		await expect(localBadge).toContainText(/on your device/i)

		// --- Switch to the Cloud plane ---
		await tauriPage.locator('[data-plane-toggle] [data-plane="cloud"]').click()
		await sleep(200)
		await input.fill('Now answer via the cloud gateway.')
		await tauriPage.locator('[data-ask] [data-send]').click()
		await sleep(1_000)
		await expect(tauriPage.getByText('Hello from the cloud gateway.')).toBeVisible({
			timeout: 10_000
		})
		const cloudBadge = tauriPage.locator('[data-exec-badge][data-plane="cloud"]')
		await expect(cloudBadge).toBeVisible()
		await expect(cloudBadge).toContainText(/via gateway/i)
	})
})
