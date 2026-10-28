import { test, expect } from '@playwright/test'

// Deterministic, no auth required. `/` is a `roles: '*'` rule in kavach.config.js, so the server
// turns an unauthenticated request away before SvelteKit renders anything — the sign-in page that
// follows is the real Seiki one, not a 404. The (app) layout's client guard is only a backstop now.
test('unauthenticated / redirects to the sign-in page', async ({ page }) => {
	await page.goto('/')
	await expect(page.locator('app[data-style="rokkit"]')).toBeVisible()
	// Still 15s, but no longer for hydration: on a cold dev server the first request compiles the
	// route, and that compile time is what the assertion would otherwise be measuring.
	await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 })
	await expect(page.getByRole('heading', { name: /sign in to the admin portal/i })).toBeVisible({
		timeout: 15_000
	})
	// Magic-link is the primary CTA; the password path is a secondary, revealed option.
	await expect(page.getByRole('button', { name: /email me a magic link/i })).toBeVisible()
})

// The flip side of the deep link that now works when signed in: kavach.config.js admits /runs for
// signed-in members, and this pins that it did not become public. Default-deny turns the request
// away server-side, so a shared run URL leaks nothing.
test('an unauthenticated deep link to a run is still turned away', async ({ page }) => {
	await page.goto('/runs/c0000001-0000-4000-8000-000000000001')
	await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 })
	await expect(page.getByRole('heading', { name: /sign in to the admin portal/i })).toBeVisible({
		timeout: 15_000
	})
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
