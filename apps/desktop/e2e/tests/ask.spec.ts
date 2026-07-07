import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

test.describe('Ask — local inference', () => {
	test('member asks a question and gets an on-device answer', async ({ tauriPage }) => {
		// Navigate to /ask via the NavRail button (WKWebView-safe; same pattern as auth-shell.spec.ts)
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

		// Confirm the Ask screen is visible
		const input = tauriPage.locator('[data-ask] input')
		await expect(input).toBeVisible({ timeout: 10_000 })

		// Type a question and submit
		await input.fill('What is Strategos?')
		// The Send button is inside [data-ask] — only one button in the composer.
		// It becomes enabled once draft is non-empty (reactive bind:value).
		const sendButton = tauriPage.locator('[data-ask] button')
		await sendButton.click()

		await sleep(1_000)

		// Assert the stubbed answer text is visible
		await expect(tauriPage.getByText('Hello from your on-device model.')).toBeVisible({
			timeout: 10_000
		})

		// Assert the on-device badge is present
		const badge = tauriPage.locator('[data-exec-badge][data-plane="local"]')
		await expect(badge).toBeVisible()
		await expect(badge).toContainText(/on your device/i)
	})
})
