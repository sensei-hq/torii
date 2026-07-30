import { test, expect, type Page } from '@playwright/test'
import { signIn } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Fidelity harness — the REPEATABLE mock-vs-app verification the runbook mandates.
// For each screen we anchor a set of typographic ROLES (title, eyebrow, stat value,
// card head, …) by exact/contains text or a CSS selector, measure the COMPUTED style
// in both the React mockup (:8890/Seiki.html, source of truth) and the built app
// (authed), and assert they match. Drift now fails the suite instead of being caught
// by eye. Extend a screen by adding rows; add a screen by adding a table + test.
//
// Requires the live gateway + Supabase + seeded owner (like the other integration
// specs) plus the mock server (auto-started by playwright.config webServer).
// ─────────────────────────────────────────────────────────────────────────────

const MOCK = 'http://localhost:8890/Seiki.html'

/** How to find one element: a CSS selector, or a text needle matched exact/contains. */
type Anchor = { selector?: string; text?: string; mode?: 'exact' | 'contains' }
type Style = { fs: string; fw: string; ff: string; found: boolean }

/** Measure computed typography of the anchored element (deepest text match, or selector). */
async function measure(page: Page, a: Anchor): Promise<Style> {
	return page.evaluate((anchor) => {
		let el: Element | null = null
		if (anchor.selector) {
			el = document.querySelector(anchor.selector)
		} else {
			const needle = (anchor.text || '').toLowerCase()
			const hit = (s: string) => (anchor.mode === 'contains' ? s.includes(needle) : s === needle)
			for (const e of document.querySelectorAll('body *')) {
				const t = (e.textContent || '').trim().toLowerCase()
				if (hit(t) && ![...e.children].some((c) => hit((c.textContent || '').trim().toLowerCase())))
					el = e
			}
		}
		if (!el) return { fs: '', fw: '', ff: '', found: false }
		const c = getComputedStyle(el)
		const ff = c.fontFamily
			.split(',')[0]
			.replace(/['"]/g, '')
			.replace(/ Variable$/, '')
			.trim() // "Fraunces Variable" → "Fraunces" to match the mock's family
		return { fs: c.fontSize, fw: c.fontWeight, ff, found: true }
	}, a)
}

/** Sign into the mockup (persona → magic link) and wait for its Overview to render. */
async function enterMock(page: Page): Promise<void> {
	await page.goto(MOCK)
	await page.getByRole('button', { name: /Aiko Tanaka/i }).click()
	await page.getByRole('button', { name: /email me a magic link/i }).click()
	await expect(page.getByText(/good morning/i).first()).toBeVisible({ timeout: 10_000 })
}

/** A typographic role: how to anchor the SAME element in the app vs the mockup. */
type Role = { role: string; app: Anchor; mock: Anchor }

const OVERVIEW: Role[] = [
	{ role: 'page title (h1)', app: { selector: 'main h1' }, mock: { text: 'good morning', mode: 'contains' } },
	{ role: 'date eyebrow', app: { text: 'last 24h', mode: 'contains' }, mock: { text: 'last 24h', mode: 'contains' } },
	{ role: 'stat label', app: { text: 'spend · today', mode: 'exact' }, mock: { text: 'spend · today', mode: 'exact' } },
	{ role: 'card head eyebrow', app: { text: 'execution plane', mode: 'exact' }, mock: { text: 'execution plane · 24h', mode: 'exact' } },
	{ role: 'setup step title', app: { text: 'connect routers', mode: 'exact' }, mock: { text: 'connect routers', mode: 'exact' } }
]

test.describe('fidelity — computed typography matches the mock', () => {
	test('Overview: every role matches font size / weight / family', async ({ browser }) => {
		const appCtx = await browser.newContext()
		const app = await appCtx.newPage()
		await signIn(app) // lands on the Overview

		const mockCtx = await browser.newContext()
		const mock = await mockCtx.newPage()
		await enterMock(mock)

		const drift: string[] = []
		for (const r of OVERVIEW) {
			const a = await measure(app, r.app)
			const m = await measure(mock, r.mock)
			if (!a.found) drift.push(`${r.role}: not found in app`)
			else if (!m.found) drift.push(`${r.role}: not found in mock`)
			else if (a.fs !== m.fs || a.fw !== m.fw || a.ff !== m.ff)
				drift.push(`${r.role}: app ${a.fs}/${a.fw}/${a.ff} ≠ mock ${m.fs}/${m.fw}/${m.ff}`)
		}
		await appCtx.close()
		await mockCtx.close()

		expect(drift, `typography drift vs the mock:\n  ${drift.join('\n  ')}`).toEqual([])
	})
})
