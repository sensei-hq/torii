import { test, expect } from '@playwright/test'

// Deterministic, no auth required. Phase-0 behaviour: the (app) guard bounces an
// unauthenticated visitor to /signin, which renders the real Seiki sign-in page.
test('unauthenticated / redirects to the sign-in page', async ({ page }) => {
	await page.goto('/')
	await expect(page.locator('app[data-style="rokkit"]')).toBeVisible()
	await expect(page).toHaveURL(/\/signin$/)
	await expect(page.getByRole('heading', { name: /sign in to the admin portal/i })).toBeVisible()
	// Magic-link is the primary CTA; the password path is a secondary, revealed option.
	await expect(page.getByRole('button', { name: /email me a magic link/i })).toBeVisible()
})
