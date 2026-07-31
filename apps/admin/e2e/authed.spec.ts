import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

// Integration smoke — requires the live gateway (:8787) + Supabase (:55321) with the
// seeded owner. Signs in once per test, then exercises the critical read/write paths.
test.describe('authenticated admin', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page)
	})

	test('Overview renders live aggregates + real identity', async ({ page }) => {
		await expect(
			page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })
		).toBeVisible()
		// the top bar shows the real signed-in identity + a sign-out control
		await expect(page.getByText(/@/).first()).toBeVisible()
		await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
	})

	test('nav rail reaches every gateway screen (client-side, each loads)', async ({ page }) => {
		const routes: [RegExp, string][] = [
			[/usage patterns/i, '/requests'],
			[/members & roles/i, '/organization'],
			[/^models$/i, '/models'],
			[/^routing$/i, '/routing'],
			[/^connections$/i, '/connections'],
			[/^governance$/i, '/governance'],
			[/budgets & billing/i, '/billing'],
			[/^settings$/i, '/settings']
		]
		for (const [link, path] of routes) {
			await page.getByRole('link', { name: link }).click()
			await expect(page).toHaveURL(new RegExp(`${path}$`))
			await expect(page.locator('[data-app-shell]')).toBeVisible()
			await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 })
		}
	})

	test('settings toggle round-trips through the gateway (persists on re-fetch)', async ({
		page
	}) => {
		await page.getByRole('link', { name: /^settings$/i }).click()
		await expect(page.getByRole('heading', { name: /workspace defaults/i })).toBeVisible()

		// Wait out the initial load (switches are disabled while loading) so the element
		// is settled before we interact — otherwise the re-render detaches it mid-click.
		const toggle = () => page.getByRole('switch').first()
		await expect(toggle()).toBeEnabled({ timeout: 10_000 })
		const before = (await toggle().getAttribute('aria-checked')) === 'true'

		await toggle().click()
		await expect(toggle()).toHaveAttribute('aria-checked', String(!before))

		// leave + return (client-side) → the screen re-fetches from the gateway
		await page.getByRole('link', { name: /overview/i }).click()
		await expect(
			page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })
		).toBeVisible()
		await page.getByRole('link', { name: /^settings$/i }).click()
		await expect(toggle()).toBeEnabled({ timeout: 10_000 })
		await expect(toggle()).toHaveAttribute('aria-checked', String(!before))

		// restore original state (keep the dev seed stable)
		await toggle().click()
		await expect(toggle()).toHaveAttribute('aria-checked', String(before))
	})
})
