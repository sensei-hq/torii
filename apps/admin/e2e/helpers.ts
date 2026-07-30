import { expect, type Page } from '@playwright/test'

// Dev-DB credentials; overridable so the same suite runs against another seed.
export const CREDS = {
	email: process.env.TORII_E2E_EMAIL ?? 'owner2@strategos.local',
	password: process.env.TORII_E2E_PASSWORD ?? 'testpass123'
}

/** Real Supabase sign-in through the UI, landing on the authenticated Overview. */
export async function signIn(page: Page): Promise<void> {
	await page.goto('/signin')
	await page.locator('input[type="email"]').fill(CREDS.email)
	// Sign-in is magic-link-primary; reveal the secondary password path for the seed login.
	// The toggle click can race SvelteKit hydration (handler not yet attached → click lost), so
	// retry the reveal until the password field actually renders. Guarded on visibility so a
	// late-registering click can't toggle it back off.
	const toggle = page.getByRole('button', { name: /sign in with a password/i })
	const password = page.locator('input[type="password"]')
	await expect(async () => {
		if (!(await password.isVisible())) await toggle.click()
		await expect(password).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await password.fill(CREDS.password)
	await page.getByRole('button', { name: /^sign in$/i }).click()
	await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
	await expect(page.locator('[data-app-shell]')).toBeVisible({ timeout: 15_000 })
	// Let the Overview's post-login data fetches settle — their re-render otherwise
	// eats the first nav click (SPA routing races the DOM update).
	await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
}
