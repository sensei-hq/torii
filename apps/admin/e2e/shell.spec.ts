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

// Regression guard for the reset cascade-layer bug: an unlayered `@unocss/reset` made the
// `button,[type="submit"],[type="button"]` reset TIE `.bg-primary` (both specificity 0,1,0) and
// win by source order, so every typed CTA rendered background:transparent — invisible on the dark
// primary token. The reset now lives in `@layer base` (packages/ui/src/app.css) so utilities win.
test('primary CTA renders a real fill, not the reset transparent', async ({ page }) => {
	await page.goto('/signin')
	const cta = page.getByRole('button', { name: /email me a magic link/i })
	await expect(cta).toBeVisible()
	const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor)
	expect(bg).not.toBe('rgba(0, 0, 0, 0)')
	expect(bg).not.toBe('transparent')
})
