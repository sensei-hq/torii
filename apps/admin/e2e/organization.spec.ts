import { test, expect } from '@playwright/test'
import { signIn } from './helpers'

// Integration — requires the live gateway (:8787) + Supabase (:55321) with the seeded owner.
// Guards DECISIONS §10.3: "API identities" lives on Organization (identity + roles + keys in one
// home); Connections stays pure outbound provider credentials.
test.describe('organization — API identities home', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page)
	})

	test('Organization hosts the API-identities section', async ({ page }) => {
		await page.getByRole('link', { name: /members & roles/i }).click()
		await expect(page).toHaveURL(/\/organization$/)
		// The screen is now the mock's "Hierarchy & budgets" (editable budget tree + RBAC).
		await expect(page.getByRole('heading', { name: /hierarchy & budgets/i })).toBeVisible({
			timeout: 10_000
		})
		// The moved block (DECISIONS §10.3): identity issuance still lives here.
		await expect(page.getByText(/^API identities$/i)).toBeVisible({ timeout: 10_000 })
		await expect(page.getByRole('button', { name: /issue key/i })).toBeVisible()
	})

	test('Connections no longer shows API identities (pure provider credentials)', async ({
		page
	}) => {
		await page.getByRole('link', { name: /^connections$/i }).click()
		await expect(page).toHaveURL(/\/connections$/)
		// Provider credentials remain the Connections screen's job.
		await expect(page.getByText(/^Routers & credentials$/i)).toBeVisible({ timeout: 10_000 })
		// The identity block moved out — no issuance UI here anymore.
		await expect(page.getByText(/^API identities$/i)).toHaveCount(0)
		await expect(page.getByRole('button', { name: /issue key/i })).toHaveCount(0)
	})
})
