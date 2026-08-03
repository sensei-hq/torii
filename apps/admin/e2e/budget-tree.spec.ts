import { test, expect, type Page, type Locator } from '@playwright/test'
import { signIn } from './helpers'

// The editable budget-hierarchy tree, end-to-end against the REAL gateway (upsert-node +
// delete-node RPCs). Self-cleaning: it creates a department, proves the create PERSISTS across
// a reload (so it truly hit the backend, not just local state), then deletes exactly that node
// and proves it's gone — leaving the seeded tenant tree as it found it.

/** The name-input of every rendered budget node. */
const nodeNames = (page: Page): Locator => page.getByRole('textbox', { name: 'Node name' })

/** Re-open Organization via CLIENT-side nav (Overview → Members & roles) so the page re-mounts
 *  and re-reads /v1/budgets. A full `page.reload()` would hard-load and the client-only session
 *  guard bounces that to /signin, so it can't be used to test persistence. */
async function reopenOrg(page: Page): Promise<void> {
	await page.getByRole('link', { name: /^overview$/i }).click()
	await expect(page.locator('main h1')).toBeVisible({ timeout: 10_000 })
	await page.getByRole('link', { name: /members & roles/i }).click()
	await expect(page.locator('main h1')).toHaveText(/hierarchy & budgets/i, { timeout: 15_000 })
}

/** The tree row (name-input → its `min-w` wrapper → the row) whose node is named `name`. */
async function rowByName(page: Page, name: string): Promise<Locator> {
	const inputs = nodeNames(page)
	const n = await inputs.count()
	for (let i = 0; i < n; i++) {
		const inp = inputs.nth(i)
		if ((await inp.inputValue()) === name) return inp.locator('xpath=../..')
	}
	throw new Error(`no budget node named "${name}"`)
}

test.describe('editable budget tree', () => {
	test('add a department → persists across reload → remove it (self-cleaning)', async ({
		page
	}) => {
		await signIn(page)
		await page.getByRole('link', { name: /members & roles/i }).click()
		await expect(page.locator('main h1')).toHaveText(/hierarchy & budgets/i, { timeout: 15_000 })
		await expect(page.getByText('Budget hierarchy', { exact: true })).toBeVisible()

		const names = nodeNames(page)
		await expect(names.first()).toBeVisible({ timeout: 10_000 }) // org root row
		const before = await names.count()

		// CREATE — add a department under the org root (real /rpc/budgets/upsert-node, no id → insert)
		await page.getByRole('button', { name: /add department/i }).click()
		await expect(names).toHaveCount(before + 1)
		expect(await (await rowByName(page, 'New dept')).count()).toBe(1)

		// PERSIST — re-read /v1/budgets; the node must still be there.
		await reopenOrg(page)
		await expect(names).toHaveCount(before + 1)

		// DELETE — remove exactly the node we created (real /rpc/budgets/delete-node), self-clean.
		const row = await rowByName(page, 'New dept')
		page.once('dialog', (d) => d.accept())
		await row.getByRole('button', { name: 'Remove this node' }).click()
		await expect(names).toHaveCount(before)

		// PERSIST the delete too.
		await reopenOrg(page)
		await expect(names).toHaveCount(before)
	})
})
