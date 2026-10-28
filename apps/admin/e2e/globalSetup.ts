import { chromium, type FullConfig } from '@playwright/test'
import { signIn } from './helpers'

// Warm the dev server's module graph once, before any worker starts.
//
// Playwright starts the webServer and immediately launches N workers; Vite compiles a route the
// first time it is asked for. So with the default worker count the first touch of several routes
// happens at the same time, and the suite's early assertions end up measuring the compiler rather
// than the app: the shell spec's client-side bounce timed out at 5s, and the sign-in helpers' post
// login navigation (15s) timed out when the server was fully cold. Both passed once the same
// server had already served those routes — which is what this reproduces, deterministically, once.
//
// Nothing here asserts anything: a warm-up that fails must not fail the run with a confusing error,
// because the tests that need these routes will report the real one.
export default async function warmup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use?.baseURL
	if (!baseURL) return // no baseURL configured: nothing to warm, and not our call to make

	const browser = await chromium.launch()
	try {
		const page = await browser.newPage({ baseURL })
		try {
			// /signin: the sign-in page and the auth client every authed spec starts from.
			await page.goto('/signin')
			// A real sign-in compiles the (app) shell + Overview, which is where every helper lands.
			await signIn(page)
			// The screen the runs specs open first, so five tests don't all compile it at once.
			await page.goto('/runs')
		} catch {
			// Left to the tests: a cold route compiles on their request instead.
		}
	} finally {
		await browser.close()
	}
}
