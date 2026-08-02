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
		await input.fill('What is Torii?')
		// The composer Send button (data-send). Header now also has plane-toggle
		// buttons inside [data-ask], so scope to the stable hook (avoids strict-mode).
		const sendButton = tauriPage.locator('[data-ask] [data-send]')
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

test.describe('Ask — grounded (space)', () => {
	test('grounding in a space returns a cited answer with a Sources list', async ({ tauriPage }) => {
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

		// Choose a space to ground in (E2E stub: "Product docs") → grounded mode. Set the value
		// + dispatch a real change event via evaluate: the harness's selectOption sets .value
		// without firing 'change', so Svelte's onchange (→ setSpace) wouldn't run.
		await tauriPage.evaluate(`
			(function () {
				const sel = document.querySelector('[data-space-picker]')
				if (!sel) throw new Error('space picker not found')
				sel.value = 'e2e-space-0000-0000-0000-000000000001'
				sel.dispatchEvent(new Event('change', { bubbles: true }))
			})()
		`)
		await sleep(300)

		await input.fill('What is the refund policy?')
		await tauriPage.locator('[data-ask] [data-send]').click()
		await sleep(1_000)

		// The grounded answer text (from the E2E stub) is shown. NB: this harness's getByText
		// stringifies its arg (no regex), so assert via toContainText on the conversation.
		await expect(tauriPage.locator('[data-ask]')).toContainText(
			'Refunds are available within 30 days'
		)
		// The reason line marks the answer as grounded in the space, with its source count.
		await expect(tauriPage.locator('[data-routing-reason]')).toContainText(/Grounded in Product docs/i)

		// The Sources list renders both cited excerpts.
		await expect(tauriPage.locator('[data-sources]')).toBeVisible()
		await expect(tauriPage.locator('[data-sources] [data-citation]')).toHaveCount(2)
		await expect(tauriPage.locator('[data-sources]')).toContainText(/Refund policy/i)
	})
})
