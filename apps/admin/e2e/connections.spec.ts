import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

// Integration — requires the live gateway + Supabase with the seeded owner. Drives the
// BYOK connect → revoke flow end to end and leaves the seed as it found it (revokes).
test.describe('connections — BYOK connect / revoke', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page)
	})

	test('connect seals a key (never shown), re-fetch keeps it, revoke clears it', async ({
		page
	}) => {
		await page.getByRole('link', { name: /^connections$/i }).click()

		// The first remote router that isn't connected yet exposes a Connect button.
		const connectCard = page
			.locator('[data-router]', { has: page.getByRole('button', { name: /^connect$/i }) })
			.first()
		await expect(connectCard).toBeVisible({ timeout: 10_000 })
		const router = await connectCard.getAttribute('data-router')
		expect(router).toBeTruthy()
		const card = () => page.locator(`[data-router="${router}"]`)

		// Connect: paste a key into the password field — write-only, cleared after the call.
		await card()
			.getByRole('button', { name: /^connect$/i })
			.click()
		const input = card().getByLabel(`API key for ${router}`)
		await expect(input).toHaveAttribute('type', 'password') // secret is never rendered back
		await input.fill('sk-e2e-doNotLog-000')
		await card()
			.getByRole('button', { name: /^save$/i })
			.click()

		// Row flips to connected and the secret appears nowhere in the card.
		await expect(card().getByText(/^connected$/i)).toBeVisible({ timeout: 10_000 })
		await expect(card()).not.toContainText('sk-e2e-doNotLog-000')

		// Leave and return (client-side) — the screen re-fetches connected state from the
		// gateway, proving it comes from the vault-backed read model, not client memory.
		await page.getByRole('link', { name: /overview/i }).click()
		await expect(
			page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })
		).toBeVisible()
		await page.getByRole('link', { name: /^connections$/i }).click()
		await expect(card().getByText(/^connected$/i)).toBeVisible({ timeout: 10_000 })

		// Revoke restores the seed → back to "not set" with a Connect action.
		// The Revoke button's accessible name is its descriptive aria-label ("Revoke <router>
		// key"), so match by substring rather than an anchored /^revoke$/.
		await card().getByRole('button', { name: 'Revoke' }).click()
		await expect(card().getByText(/^not set$/i)).toBeVisible({ timeout: 10_000 })
		await expect(card().getByRole('button', { name: /^connect$/i })).toBeVisible()
	})
})
