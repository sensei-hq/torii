import { test, expect } from '@playwright/test'

test('admin boots and renders the shell with the Zen-Sumi skin', async ({ page }) => {
	await page.goto('/') // Phase 0: '/' is public → shell renders directly
	await expect(page.locator('app[data-style="rokkit"]')).toBeVisible()
	await expect(page.locator('[data-app-shell]')).toBeVisible()
})
