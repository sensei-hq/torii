import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A user with no organization must land on /onboarding, whichever way they signed in.
//
// WHY THIS EXISTS: /auth/callback resolves the destination (whoami → tenant_id ? '/' :
// '/onboarding'), and the magic-link and OAuth flows both go through it. The PASSWORD path
// did not — it hard-navigated to '/' on success. A tenant-less user therefore landed on the
// Overview, which renders its chrome and then fires ~10 API calls that all 403, so the
// first-run experience for a self-service signup was an empty dashboard full of console
// errors instead of "Create your organization".
//
// Fail-closed, so never a security hole — but it is the first thing a new user sees, and the
// destination logic already existed one route away.

/** The admin app's own env — the anon key is public by design (it is shipped to the browser). */
function adminEnv(): Record<string, string> {
	const raw = readFileSync(resolve(import.meta.dirname, '..', '.env'), 'utf8')
	return Object.fromEntries(
		raw
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#') && l.includes('='))
			.map((l) => {
				const i = l.indexOf('=')
				return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
			})
	)
}

// A FIXED address at an RFC 2606 reserved domain, for two reasons:
//   · `.invalid` can never be a real domain, so core.assign_tenant_by_domain() — which
//     auto-assigns a tenant when the signup email's domain matches an active tenant — can
//     never claim this user and quietly invalidate the premise of the test. A @torii.local
//     address would work today only because no tenant has `domain` set yet.
//   · fixed, not Date.now()-unique, so repeated runs reuse one row instead of accumulating
//     a new auth user every time the suite runs.
const NO_ORG = { email: 'e2e-no-org@e2e.invalid', password: 'e2e-no-org-passw0rd' }

/**
 * Ensure the tenant-less user exists. Local config has `enable_confirmations = false`, so a
 * fresh signup is immediately usable — no service key, no admin API, no mailbox to poll.
 * Idempotent: an "already registered" response is the steady state after the first run.
 */
async function ensureNoOrgUser(
	request: import('@playwright/test').APIRequestContext
): Promise<void> {
	const env = adminEnv()
	const url = env.PUBLIC_SUPABASE_URL
	const anon = env.PUBLIC_SUPABASE_ANON_KEY
	expect(url, 'PUBLIC_SUPABASE_URL must be set in apps/admin/.env').toBeTruthy()
	expect(anon, 'PUBLIC_SUPABASE_ANON_KEY must be set in apps/admin/.env').toBeTruthy()

	const res = await request.post(`${url}/auth/v1/signup`, {
		headers: { apikey: anon, 'Content-Type': 'application/json' },
		data: NO_ORG
	})
	if (res.ok()) return
	const body = await res.text()
	expect(
		/already (registered|exists)|user_already_exists/i.test(body),
		`signup failed for an unexpected reason: ${res.status()} ${body}`
	).toBeTruthy()
}

test('a user with no organization is sent to /onboarding after a password sign-in', async ({
	page,
	request
}) => {
	await ensureNoOrgUser(request)

	await page.goto('/signin')
	await page.locator('input[type="email"]').fill(NO_ORG.email)

	// Password is the revealed secondary path; the toggle can race hydration.
	const toggle = page.getByRole('button', { name: /sign in with a password/i })
	const pw = page.locator('input[type="password"]')
	await expect(async () => {
		if (!(await pw.isVisible())) await toggle.click()
		await expect(pw).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await pw.fill(NO_ORG.password)
	await page.getByRole('button', { name: /^sign in$/i }).click()

	await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 })
	await expect(page.getByRole('heading', { name: /create your organization/i })).toBeVisible({
		timeout: 10_000
	})
})
