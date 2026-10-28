import { test, expect } from '@playwright/test'
import { applyFixture } from './db'
import { signIn } from './helpers'

// Integration — needs the live gateway (:8787) + Supabase (:55321/55322) with the seeded owner,
// like authed.spec.ts. The ledger itself is seeded (e2e/fixtures/runs.seed.sql) because the Runs
// screens read accounting rows a fresh dev database does not have.
//
// What this covers that the unit tests and the gateway's own Postgres-backed tests cannot: the
// screens are actually wired to those reads. A filtered, paged list of real ledger rows; a run
// detail showing its calls, spend and charged unit; and a call expanding into the routing trace
// that explains it.
const RUNS = {
	completed: 'c0000001-0000-4000-8000-000000000001',
	failed: 'c0000002-0000-4000-8000-000000000002',
	paused: 'c0000003-0000-4000-8000-000000000003',
	unscheduled: 'c0000004-0000-4000-8000-000000000004'
}
/** The oldest seeded run: 116 minutes old, and only reachable from the second page. */
const OLDEST = 'd0000000-0000-4000-8000-000000000056'
/** The list's page size, so "the page is full" is asserted rather than a magic number. */
const PAGE = 50

test.describe('runs', () => {
	test.beforeAll(() => applyFixture('runs.seed.sql'))
	test.afterAll(() => applyFixture('runs.teardown.sql'))

	test.beforeEach(async ({ page }) => {
		await signIn(page)
		await page.getByRole('link', { name: /^runs$/i }).click()
		await expect(page).toHaveURL(/\/runs$/)
	})

	test('the list is the ledger: status and spend per run, newest first', async ({ page }) => {
		const rows = page.locator('[data-run-row]')
		// A full page, and no more: the read is bounded even though the ledger is not.
		await expect(rows).toHaveCount(PAGE)
		await expect(rows.first()).toHaveAttribute('data-run-row', RUNS.completed)

		// status comes from the driver's lifecycle row, and the spend from the run's own calls.
		const newest = rows.first()
		await expect(newest).toContainText('Completed')
		await expect(newest).toContainText('$0.009')
		// booked is still $0.000 of $2.000 on this run, so the row says so rather than showing $0
		await expect(newest).toContainText('unbooked')

		// a charge with no schedule row reads as a state, not as a missing run
		await expect(page.locator(`[data-run-row="${RUNS.unscheduled}"]`)).toContainText('No schedule')
	})

	test('the status filter narrows the whole ledger, and pages with it', async ({ page }) => {
		const rows = page.locator('[data-run-row]')
		const failedChip = page.locator('[data-run-filter="failed"]')

		await failedChip.click()
		await expect(failedChip).toHaveAttribute('aria-pressed', 'true')
		await expect(rows.first()).toHaveAttribute('data-run-row', RUNS.failed)
		// the other states are gone — not merely further down the page
		await expect(page.locator(`[data-run-row="${RUNS.paused}"]`)).toHaveCount(0)
		await expect(page.locator(`[data-run-row="${RUNS.unscheduled}"]`)).toHaveCount(0)

		// 60 seeded runs are completed — more than a page — so a filter applied to the page in
		// hand could never show 50 of them and still offer an older page.
		await page.locator('[data-run-filter="completed"]').click()
		await expect(rows).toHaveCount(PAGE)
		await expect(page.locator('[data-more-runs]')).toBeVisible()
	})

	test('the failed-calls filter finds the runs whose calls failed, whatever the run did', async ({
		page
	}) => {
		const rows = page.locator('[data-run-row]')
		const toggle = page.locator('[data-run-filter="failed-calls"]')

		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-pressed', 'true')

		// Exactly the two runs that had a failed call — and the newest of them is COMPLETED: it fell
		// back and finished, so no lifecycle filter could ever have found it. That difference is the
		// whole reason this is its own filter rather than "status=failed".
		await expect(rows).toHaveCount(2)
		await expect(rows.first()).toHaveAttribute('data-run-row', RUNS.completed)
		await expect(page.locator(`[data-run-row="${RUNS.failed}"]`)).toBeVisible()
		// runs whose calls all succeeded, or which made none at all, are not "runs something failed in"
		await expect(page.locator(`[data-run-row="${RUNS.paused}"]`)).toHaveCount(0)
		await expect(page.locator(`[data-run-row="${RUNS.unscheduled}"]`)).toHaveCount(0)
		// two matches fit on one page, so there is no older page to offer
		await expect(page.locator('[data-more-runs]')).toHaveCount(0)

		// It composes with the lifecycle chip instead of replacing it: completed + failed calls is
		// the run that fell back, not the run that failed outright.
		await page.locator('[data-run-filter="completed"]').click()
		await expect(rows).toHaveCount(1)
		await expect(rows.first()).toHaveAttribute('data-run-row', RUNS.completed)

		// And it toggles off: the chip's own list comes back, still paged.
		await toggle.click()
		await expect(toggle).toHaveAttribute('aria-pressed', 'false')
		await expect(rows).toHaveCount(PAGE)
		await expect(page.locator('[data-more-runs]')).toBeVisible()
	})

	test('older runs walk back through the ledger instead of repeating the newest page', async ({
		page
	}) => {
		const rows = page.locator('[data-run-row]')
		const oldest = page.locator(`[data-run-row="${OLDEST}"]`)

		await expect(rows).toHaveCount(PAGE)
		await expect(oldest).toHaveCount(0)

		await page.locator('[data-more-runs]').click()

		// the rows already read stay put, and the older page is appended below them
		await expect(oldest).toBeVisible()
		await expect(rows.first()).toHaveAttribute('data-run-row', RUNS.completed)
		expect(await rows.count()).toBeGreaterThan(PAGE)
	})

	test('a run opens to its calls, spend and charged unit', async ({ page }) => {
		await page.locator(`[data-run-row="${RUNS.completed}"]`).click()
		await expect(page).toHaveURL(new RegExp(`/runs/${RUNS.completed}$`))
		await expect(page.getByRole('heading', { name: /run c0000001/i })).toBeVisible()

		// both of this run's calls, and only this run's
		await expect(page.locator('[data-call-row]')).toHaveCount(2)
		await expect(page.getByText('priced per call')).toBeVisible()
		await expect(page.getByText('$0.009').first()).toBeVisible()
		// the unit governance charged, resolved from the run's own node_ids
		await expect(page.getByText('Organization').first()).toBeVisible()
	})

	test('a run URL survives a hard load, so it can be shared', async ({ page }) => {
		// No click, no in-app state: the URL is opened cold. This is the case that used to fail — the
		// server guard could only see a cookie, the session was only in localStorage, and kavach had
		// no rule admitting /runs — so the page bounced to /signin even though the session was fine.
		await page.goto(`/runs/${RUNS.completed}`)
		await expect(page).toHaveURL(new RegExp(`/runs/${RUNS.completed}$`))
		await expect(page.getByRole('heading', { name: /run c0000001/i })).toBeVisible({
			timeout: 15_000
		})
		// and it is the real screen, not a shell that only looks right
		await expect(page.locator('[data-call-row]')).toHaveCount(2)
	})

	test('a call expands into why it went where it went', async ({ page }) => {
		// Reached by clicking, like every other spec here except the deep link above.
		await page.locator(`[data-run-row="${RUNS.completed}"]`).click()
		await expect(page).toHaveURL(new RegExp(`/runs/${RUNS.completed}$`))
		const calls = page.locator('[data-call-row]')
		const first = calls.first()

		await expect(first).toHaveAttribute('aria-expanded', 'false')
		await first.click()
		await expect(first).toHaveAttribute('aria-expanded', 'true')

		// the served call fell back once: two attempts, the first failure explained
		const trace = page.locator('[data-trace]')
		await expect(trace).toBeVisible()
		await expect(trace.locator('[data-attempt]')).toHaveCount(2)
		await expect(trace.locator('[data-why]')).toContainText('claude-sonnet-4-5')
		await expect(trace).toContainText('openai → gpt-4o-mini')
		await expect(trace).toContainText('upstream 429: rate limited')

		// The two halves that answer "why THIS model" rather than "what did it fall past": the order
		// the call was handed and the MEASUREMENT it obeyed — category, and the artifact revision that
		// was in force (System One §9.6) — plus the ref that measurement named and no candidate could
		// answer. Written by the engine, so this is the run path's own record, not the chat path's.
		const ranking = trace.locator('[data-ranking]')
		await expect(ranking).toBeVisible()
		await expect(ranking).toContainText('grouped_weighted')
		await expect(ranking.locator('[data-ranking-order]')).toContainText(
			'openai:gpt-4o-mini → anthropic:claude-sonnet-4-5'
		)
		await expect(ranking.locator('[data-ranking-source]')).toContainText('planner.select')
		await expect(ranking.locator('[data-ranking-source]')).toContainText('revision 7')
		await expect(ranking.locator('[data-ranking-unmatched]')).toContainText('ollama:qwen3:8b')

		// And who never got a chance, each with the gate's own reason — the models that were filtered
		// out before the call, which the ledger row alone cannot explain (it names only the winner).
		const filtered = trace.locator('[data-filtered]')
		await expect(filtered.locator('[data-skipped]')).toHaveCount(2)
		await expect(filtered).toContainText('ollama:qwen3:8b')
		await expect(filtered).toContainText('8192-token context window')
		await expect(filtered).toContainText('router cooling down')

		// the other call has no trace recorded — the chat path persists one only for a served call —
		// and the panel says so rather than showing an empty chain: "nothing to explain" and
		// "explanation lost" are different statements.
		await calls.nth(1).click()
		await expect(page.locator('[data-call-row]').first()).toHaveAttribute('aria-expanded', 'false')
		await expect(page.locator('[data-trace]')).toContainText('No routing trace recorded')
	})

	test('a failed call opens to its attempts and the order it was handed', async ({ page }) => {
		// The run whose whole chain failed. Its ledger row names only the last error, so the trace
		// is the entire explanation: what the walk tried, and the order it was given
		// (System One §9.6 writes a failed trace, not only a served one).
		await page.locator(`[data-run-row="${RUNS.failed}"]`).click()
		await expect(page).toHaveURL(new RegExp(`/runs/${RUNS.failed}$`))

		const calls = page.locator('[data-call-row]')
		await expect(calls).toHaveCount(1)
		await calls.first().click()
		await expect(calls.first()).toHaveAttribute('aria-expanded', 'true')

		const trace = page.locator('[data-trace]')
		await expect(trace.locator('[data-why]')).toContainText('All 2 routing attempts failed')
		await expect(trace.locator('[data-attempt]')).toHaveCount(2)
		await expect(trace.locator('[data-attempt]').nth(1)).toContainText('claude-sonnet-4-5')
		// the reason each attempt was refused is the provider's own, not a flattened summary
		await expect(trace).toContainText('upstream 429: rate limited')
		await expect(trace).toContainText('upstream 500: internal error')

		// The order it was handed survives the failure, which is the half a failed call could not show
		// before: the walk had an order even though no candidate answered.
		const ranking = trace.locator('[data-ranking]')
		await expect(ranking).toContainText('grouped_weighted')
		await expect(ranking.locator('[data-ranking-order]')).toContainText(
			'openai:gpt-4o-mini → anthropic:claude-sonnet-4-5'
		)
		// This call was given an authored order and no measurement, and the screen says that rather
		// than attaching a ranking category the trace does not record.
		await expect(ranking.locator('[data-ranking-source]')).toContainText(
			'No measured ranking was in force for this call'
		)
		await expect(trace.locator('[data-ranking-unmatched]')).toHaveCount(0)
		// nothing was withheld before this walk, so the filtered-out block is absent rather than empty
		await expect(trace.locator('[data-filtered]')).toHaveCount(0)
	})
})
