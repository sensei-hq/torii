import { test, expect } from '../fixtures'
import { sleep } from '../helpers'

// Activity ("You") screen e2e, driven in the real Tauri binary. Network-free: the activity
// store serves deterministic IS_E2E fixtures (2 ledger rows + a 1-node budget tree, and a
// per-call routing trace for each), so this verifies the ledger table + the "why this model"
// expandable trace UI, not the live gateway (the live trace path is a gateway integration test).

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

test.describe('Activity — ledger + why-this-model trace', () => {
	test('lists requests and expands a fallback routing trace', async ({ tauriPage }) => {
		await expect(tauriPage.locator('[data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
		await nav(tauriPage, 'Activity')

		// two stubbed ledger rows.
		await expect(tauriPage.locator('[data-request-row]')).toHaveCount(2)

		// expand the SECOND row (the cloud call that rate-limited → fell back) → its trace panel.
		await tauriPage.locator('[data-request-row] [data-trace-toggle]').nth(1).click()
		await sleep(500)
		await expect(tauriPage.locator('[data-trace]')).toBeVisible()

		// the one-line "why" summary names the winning model + says it fell back.
		await expect(tauriPage.locator('[data-why]')).toContainText(/gpt-4o/i)
		await expect(tauriPage.locator('[data-why]')).toContainText(/fallback/i)

		// the attempt chain shows both hops — anthropic failed (429) → openai answered.
		await expect(tauriPage.locator('[data-trace] [data-attempt]')).toHaveCount(2)
		await expect(tauriPage.locator('[data-trace]')).toContainText(/429 rate limited/i)
	})
})
