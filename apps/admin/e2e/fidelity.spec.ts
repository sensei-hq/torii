import { test, expect, type Page } from '@playwright/test'
import { signIn } from './helpers'

// ─────────────────────────────────────────────────────────────────────────────
// Fidelity harness — the REPEATABLE mock-vs-app verification the runbook mandates.
// Drives the live React mockup (:8890/Seiki.html, source of truth) + the authed app,
// reads getComputedStyle on anchored ROLES, and fails on drift. Now COMPREHENSIVE:
//   · typography + colour, in BOTH light and dark mode (catches token/mode drift)
//   · spacing/radius + card-head + page padding, at MULTIPLE viewports (catches
//     responsive drift — the mock's ViewPad + grids change by breakpoint)
//   · card border colour (the dark hairline that must stay subtle)
// Extend a screen by adding rows to OVERVIEW; add a screen by adding a table.
//
// Requires the live gateway + Supabase + seeded owner + the mock server
// (auto-started by playwright.config webServer).
// ─────────────────────────────────────────────────────────────────────────────

const MOCK = 'http://localhost:8890/Seiki.html'
type Mode = 'light' | 'dark'

/** How to find one element: a CSS selector, or a text needle matched exact/contains. */
type Anchor = { selector?: string; text?: string; mode?: 'exact' | 'contains' }
type Style = { fs: string; fw: string; ff: string; color: string; found: boolean }
type Box = { pad: string; mt: string; radius: string; border: string; found: boolean }

/** Measure computed typography + colour of the anchored element (deepest text match, or selector). */
async function measure(page: Page, a: Anchor): Promise<Style> {
	return page.evaluate((anchor) => {
		let el: Element | null = null
		if (anchor.selector) el = document.querySelector(anchor.selector)
		else {
			const needle = (anchor.text || '').toLowerCase()
			const hit = (s: string) => (anchor.mode === 'contains' ? s.includes(needle) : s === needle)
			for (const e of document.querySelectorAll('body *')) {
				const t = (e.textContent || '').trim().toLowerCase()
				if (hit(t) && ![...e.children].some((c) => hit((c.textContent || '').trim().toLowerCase())))
					el = e
			}
		}
		if (!el) return { fs: '', fw: '', ff: '', color: '', found: false }
		const c = getComputedStyle(el)
		const ff = c.fontFamily
			.split(',')[0]
			.replace(/['"]/g, '')
			.replace(/ Variable$/, '')
			.trim() // "Fraunces Variable" → "Fraunces"
		return { fs: c.fontSize, fw: c.fontWeight, ff, color: c.color, found: true }
	}, a)
}

/** Measure the box (padding-top, margin-top, radius, border colour) of the anchor's nearest CARD. */
async function measureBox(page: Page, a: Anchor): Promise<Box> {
	return page.evaluate((anchor) => {
		let el: Element | null = null
		const needle = (anchor.text || '').toLowerCase()
		const hit = (s: string) => (anchor.mode === 'contains' ? s.includes(needle) : s === needle)
		for (const e of document.querySelectorAll('body *')) {
			const t = (e.textContent || '').trim().toLowerCase()
			if (hit(t) && ![...e.children].some((c) => hit((c.textContent || '').trim().toLowerCase())))
				el = e
		}
		while (el) {
			const c = getComputedStyle(el)
			if (
				parseFloat(c.borderTopLeftRadius) >= 8 &&
				(parseFloat(c.borderTopWidth) > 0 || c.backgroundColor !== 'rgba(0, 0, 0, 0)')
			)
				break
			el = el.parentElement
		}
		if (!el) return { pad: '', mt: '', radius: '', border: '', found: false }
		const c = getComputedStyle(el)
		return {
			pad: c.paddingTop,
			mt: c.marginTop,
			radius: c.borderTopLeftRadius,
			border: c.borderTopColor,
			found: true
		}
	}, a)
}

/** Padding (top + left) of the nearest bottom-bordered strip above the anchor — i.e. a card-head. */
async function measureHeadPad(page: Page, a: Anchor): Promise<string> {
	return page.evaluate((anchor) => {
		let el: Element | null = null
		const needle = (anchor.text || '').toLowerCase()
		const hit = (s: string) => (anchor.mode === 'contains' ? s.includes(needle) : s === needle)
		for (const e of document.querySelectorAll('body *')) {
			const t = (e.textContent || '').trim().toLowerCase()
			if (hit(t) && ![...e.children].some((c) => hit((c.textContent || '').trim().toLowerCase())))
				el = e
		}
		while (el && parseFloat(getComputedStyle(el).borderBottomWidth) === 0) el = el.parentElement
		if (!el) return ''
		const c = getComputedStyle(el)
		return `${c.paddingTop} ${c.paddingLeft}`
	}, a)
}

/** Left-padding of the page wrapper (direct child of <main>/.view) — responsive by breakpoint. */
async function sidePad(page: Page, needle = 'execution plane'): Promise<string> {
	return page.evaluate((needle) => {
		let el: Element | null = null
		for (const e of document.querySelectorAll('body *')) {
			const t = (e.textContent || '').trim().toLowerCase()
			if (
				t.includes(needle) &&
				![...e.children].some((c) => (c.textContent || '').trim().toLowerCase().includes(needle))
			)
				el = e
		}
		while (el && el.parentElement) {
			const p = el.parentElement
			if (p.tagName === 'MAIN' || /(^|\s)view(\s|$)/.test(p.className)) break
			el = p
		}
		return el ? getComputedStyle(el).paddingLeft : ''
	}, needle)
}

/** Pin the APP to a mode (its default is dark). Detect via the h1 text lightness, toggle to match. */
async function setAppMode(page: Page, want: Mode): Promise<void> {
	const isDark = async () =>
		(await page.evaluate(() => {
			const el = document.querySelector('main h1')
			const m = (el ? getComputedStyle(el).color : '').match(/oklch\(([\d.]+)/)
			return m ? parseFloat(m[1]) : 0
		})) > 0.5
	if ((await isDark()) !== (want === 'dark')) {
		await page.getByRole('button', { name: /toggle light or dark/i }).click()
		await expect.poll(isDark, { timeout: 5000 }).toBe(want === 'dark')
	}
}

/** Pin the MOCK to a mode. zs.css keys dark off `[data-theme="dark"]`. */
async function setMockMode(page: Page, want: Mode): Promise<void> {
	await page.evaluate((m) => {
		for (const root of [document.documentElement, document.querySelector('.zs')]) {
			if (!root) continue
			if (m === 'dark') root.setAttribute('data-theme', 'dark')
			else root.removeAttribute('data-theme')
		}
	}, want)
}

/** Sign into the mockup (persona → magic link) and wait for its Overview to render. */
async function enterMock(page: Page): Promise<void> {
	await page.goto(MOCK)
	await page.getByRole('button', { name: /Aiko Tanaka/i }).click()
	await page.getByRole('button', { name: /email me a magic link/i }).click()
	await expect(page.getByText(/good morning/i).first()).toBeVisible({ timeout: 10_000 })
}

/** A role: how to anchor the SAME element in the app vs the mockup. */
type Role = { role: string; app: Anchor; mock: Anchor }

const OVERVIEW: Role[] = [
	{
		role: 'page title (h1)',
		app: { selector: 'main h1' },
		mock: { text: 'good morning', mode: 'contains' }
	},
	{
		role: 'date eyebrow',
		app: { text: 'last 24h', mode: 'contains' },
		mock: { text: 'last 24h', mode: 'contains' }
	},
	{
		role: 'stat label',
		app: { text: 'spend · today', mode: 'exact' },
		mock: { text: 'spend · today', mode: 'exact' }
	},
	{
		role: 'card head eyebrow',
		app: { text: 'execution plane', mode: 'exact' },
		mock: { text: 'execution plane · 24h', mode: 'exact' }
	},
	{
		role: 'setup step title',
		app: { text: 'connect routers', mode: 'exact' },
		mock: { text: 'connect routers', mode: 'exact' }
	},
	{
		role: 'alerts card eyebrow',
		app: { text: 'alerts · needs attention', mode: 'exact' },
		mock: { text: 'alerts · needs attention', mode: 'exact' }
	}
]
const CARD_APP: Anchor = { text: 'execution plane', mode: 'exact' }
const CARD_MOCK: Anchor = { text: 'execution plane · 24h', mode: 'exact' }
const STAT_A: Anchor = { text: 'spend · today', mode: 'exact' }

// Semantic tokens must resolve to the same value in the app and the mock, per mode. Catches
// drift the rendered roles miss (e.g. accent-soft alpha, accent chroma in dark).
const TOKENS = [
	'--accent',
	'--accent-soft',
	'--paper',
	'--paper-soft',
	'--paper-edge',
	'--ink',
	'--ink-mute',
	'--success',
	'--warning'
]
async function measureTokens(page: Page): Promise<Record<string, string>> {
	return page.evaluate((names) => {
		const root = getComputedStyle(document.documentElement)
		const out: Record<string, string> = {}
		for (const n of names) out[n] = root.getPropertyValue(n).trim()
		return out
	}, TOKENS)
}

/** Typography + colour per role, the card border colour, and semantic-token parity. */
async function collectTypoColor(
	app: Page,
	mock: Page,
	roles: Role[],
	cardApp: Anchor,
	cardMock: Anchor
): Promise<string[]> {
	const drift: string[] = []
	for (const r of roles) {
		const a = await measure(app, r.app)
		const m = await measure(mock, r.mock)
		if (!a.found) drift.push(`${r.role}: not found in app`)
		else if (!m.found) drift.push(`${r.role}: not found in mock`)
		else if (a.fs !== m.fs || a.fw !== m.fw || a.ff !== m.ff || a.color !== m.color)
			drift.push(
				`${r.role}: app ${a.fs}/${a.fw}/${a.ff}/${a.color} ≠ mock ${m.fs}/${m.fw}/${m.ff}/${m.color}`
			)
	}
	const ab = await measureBox(app, cardApp)
	const mb = await measureBox(mock, cardMock)
	if (ab.border !== mb.border) drift.push(`card border: app ${ab.border} ≠ mock ${mb.border}`)

	const at = await measureTokens(app)
	const mt = await measureTokens(mock)
	for (const n of TOKENS)
		if (at[n] && mt[n] && at[n] !== mt[n]) drift.push(`token ${n}: app ${at[n]} ≠ mock ${mt[n]}`)
	return drift
}

/** Card padding + radius + inter-card gap, card-head padding, and responsive page side padding. */
async function collectSpacing(
	app: Page,
	mock: Page,
	statApp: Anchor,
	statMock: Anchor,
	cardApp: Anchor,
	cardMock: Anchor,
	sideApp: string,
	sideMock: string
): Promise<string[]> {
	const drift: string[] = []
	const as = await measureBox(app, statApp)
	const ms = await measureBox(mock, statMock)
	if (as.pad !== ms.pad || as.radius !== ms.radius)
		drift.push(`stat tile: app pad ${as.pad} r ${as.radius} ≠ mock pad ${ms.pad} r ${ms.radius}`)
	const ac = await measureBox(app, cardApp)
	const mc = await measureBox(mock, cardMock)
	if (ac.mt !== mc.mt) drift.push(`inter-card gap: app ${ac.mt} ≠ mock ${mc.mt}`)
	const ah = await measureHeadPad(app, cardApp)
	const mh = await measureHeadPad(mock, cardMock)
	if (ah !== mh) drift.push(`card-head padding: app ${ah} ≠ mock ${mh}`)
	const ap = await sidePad(app, sideApp)
	const mp = await sidePad(mock, sideMock)
	if (ap !== mp) drift.push(`page side padding: app ${ap} ≠ mock ${mp}`)
	return drift
}

const DESKTOP = { width: 1280, height: 900 }
const VIEWPORTS = [
	{ name: 'mobile', width: 560, height: 900 },
	{ name: 'tablet', width: 820, height: 1100 },
	{ name: 'desktop', width: 1280, height: 900 }
]

test.describe('fidelity — Overview matches the mock', () => {
	// Colour is mode-sensitive, not viewport-sensitive → both modes at one viewport.
	for (const mode of ['light', 'dark'] as Mode[]) {
		test(`typography + colour @ ${mode}`, async ({ browser }) => {
			const appCtx = await browser.newContext({ viewport: DESKTOP })
			const app = await appCtx.newPage()
			await signIn(app)
			await setAppMode(app, mode)
			const mockCtx = await browser.newContext({ viewport: DESKTOP })
			const mock = await mockCtx.newPage()
			await enterMock(mock)
			await setMockMode(mock, mode)

			const drift = await collectTypoColor(app, mock, OVERVIEW, CARD_APP, CARD_MOCK)
			await appCtx.close()
			await mockCtx.close()
			expect(
				drift,
				`${mode}-mode typography/colour drift vs the mock:\n  ${drift.join('\n  ')}`
			).toEqual([])
		})
	}

	// Spacing is viewport-sensitive (responsive ViewPad/grids), not mode-sensitive → all viewports, light.
	for (const vp of VIEWPORTS) {
		test(`spacing @ ${vp.name} (${vp.width}px)`, async ({ browser }) => {
			const appCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
			const app = await appCtx.newPage()
			await signIn(app)
			await setAppMode(app, 'light')
			const mockCtx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
			const mock = await mockCtx.newPage()
			await enterMock(mock)
			await setMockMode(mock, 'light')

			const drift = await collectSpacing(
				app,
				mock,
				STAT_A,
				STAT_A,
				CARD_APP,
				CARD_MOCK,
				'execution plane',
				'execution plane'
			)
			await appCtx.close()
			await mockCtx.close()
			expect(
				drift,
				`spacing/radius drift @ ${vp.name} vs the mock:\n  ${drift.join('\n  ')}`
			).toEqual([])
		})
	}
})

// ─────────────────────────────────────────────────────────────────────────────
// Requests (org lens) — the admin "usage patterns" screen. Navigates BOTH sides to
// the Requests view first (app: /requests · mock: the "Usage patterns" nav item),
// then runs the same measured diff. Structure/labels render regardless of data, so
// an empty tenant still verifies typography, tokens, and the stat-tile/card rhythm.
// ─────────────────────────────────────────────────────────────────────────────
const REQUESTS: Role[] = [
	{
		role: 'page title (h1)',
		app: { selector: 'main h1' },
		mock: { text: 'routing & usage health', mode: 'contains' }
	},
	{
		role: 'header eyebrow',
		app: { text: 'usage patterns', mode: 'exact' },
		mock: { text: 'usage patterns', mode: 'exact' }
	},
	{
		role: 'stat label',
		app: { text: 'calls · 24h', mode: 'exact' },
		mock: { text: 'calls · 24h', mode: 'exact' }
	},
	{
		role: 'card head eyebrow (falling back)',
		app: { text: 'falling back · 24h', mode: 'contains' },
		mock: { text: 'falling back · 24h', mode: 'contains' }
	},
	{
		role: 'card head eyebrow (being used)',
		app: { text: 'being used · 24h', mode: 'contains' },
		mock: { text: 'being used · 24h', mode: 'contains' }
	}
]
const REQ_CARD_APP: Anchor = { text: 'falling back · 24h', mode: 'contains' }
const REQ_CARD_MOCK: Anchor = { text: 'falling back · 24h', mode: 'contains' }
const REQ_STAT: Anchor = { text: 'calls · 24h', mode: 'exact' }

/** Sign into the app and click through to the Requests screen. Uses the in-app nav link
 *  (client-side SvelteKit routing) — a full `goto('/requests')` would hard-load and the
 *  client-only session guard bounces that to /signin. */
async function gotoAppRequests(app: Page): Promise<void> {
	await signIn(app)
	await app
		.getByRole('link', { name: /usage patterns/i })
		.first()
		.click()
	await expect(app.locator('main h1')).toHaveText(/routing & usage health/i, { timeout: 15_000 })
}

/** Enter the mock and click through to its "Usage patterns" (Requests) view. */
async function gotoMockRequests(mock: Page): Promise<void> {
	await enterMock(mock)
	await mock
		.getByRole('button', { name: /usage patterns/i })
		.first()
		.click()
	await expect(mock.getByText(/routing & usage health/i).first()).toBeVisible({ timeout: 10_000 })
}

test.describe('fidelity — Requests (org lens) matches the mock', () => {
	for (const mode of ['light', 'dark'] as Mode[]) {
		test(`typography + colour @ ${mode}`, async ({ browser }) => {
			const appCtx = await browser.newContext({ viewport: DESKTOP })
			const app = await appCtx.newPage()
			await gotoAppRequests(app)
			await setAppMode(app, mode)
			const mockCtx = await browser.newContext({ viewport: DESKTOP })
			const mock = await mockCtx.newPage()
			await gotoMockRequests(mock)
			await setMockMode(mock, mode)

			const drift = await collectTypoColor(app, mock, REQUESTS, REQ_CARD_APP, REQ_CARD_MOCK)
			await appCtx.close()
			await mockCtx.close()
			expect(
				drift,
				`${mode}-mode Requests typography/colour drift vs the mock:\n  ${drift.join('\n  ')}`
			).toEqual([])
		})
	}

	test('spacing @ desktop (1280px)', async ({ browser }) => {
		const appCtx = await browser.newContext({ viewport: DESKTOP })
		const app = await appCtx.newPage()
		await gotoAppRequests(app)
		await setAppMode(app, 'light')
		const mockCtx = await browser.newContext({ viewport: DESKTOP })
		const mock = await mockCtx.newPage()
		await gotoMockRequests(mock)
		await setMockMode(mock, 'light')

		const drift = await collectSpacing(
			app,
			mock,
			REQ_STAT,
			REQ_STAT,
			REQ_CARD_APP,
			REQ_CARD_MOCK,
			'being used · 24h',
			'being used · 24h'
		)
		await appCtx.close()
		await mockCtx.close()
		expect(drift, `Requests spacing drift vs the mock:\n  ${drift.join('\n  ')}`).toEqual([])
	})
})
