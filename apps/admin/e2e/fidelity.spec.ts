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
type Style = { fs: string; fw: string; ff: string; color: string; found: boolean }
type Box = { pad: string; mt: string; radius: string; found: boolean }

/** Measure computed typography + color of the anchored element (deepest text match, or selector). */
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
		if (!el) return { fs: '', fw: '', ff: '', color: '', found: false }
		const c = getComputedStyle(el)
		const ff = c.fontFamily
			.split(',')[0]
			.replace(/['"]/g, '')
			.replace(/ Variable$/, '')
			.trim() // "Fraunces Variable" → "Fraunces" to match the mock's family
		return { fs: c.fontSize, fw: c.fontWeight, ff, color: c.color, found: true }
	}, a)
}

/** Measure the box (padding-top, margin-top, radius) of the nearest CARD ancestor of the anchor. */
async function measureBox(page: Page, a: Anchor): Promise<Box> {
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
		// climb to the nearest rounded, bordered/filled ancestor — the card
		while (el) {
			const c = getComputedStyle(el)
			if (
				parseFloat(c.borderTopLeftRadius) >= 8 &&
				(parseFloat(c.borderTopWidth) > 0 || c.backgroundColor !== 'rgba(0, 0, 0, 0)')
			)
				break
			el = el.parentElement
		}
		if (!el) return { pad: '', mt: '', radius: '', found: false }
		const c = getComputedStyle(el)
		return { pad: c.paddingTop, mt: c.marginTop, radius: c.borderTopLeftRadius, found: true }
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

/** Pin the app to LIGHT mode (its default is dark; the mock is light) so colours are
 * compared in the same mode — the runbook's "match modes" rule. Detects dark via the h1
 * text lightness (light text = dark mode) and clicks the theme toggle. */
async function ensureLight(page: Page): Promise<void> {
	const h1Lightness = () =>
		page.evaluate(() => {
			const el = document.querySelector('main h1')
			const col = el ? getComputedStyle(el).color : ''
			const m = col.match(/oklch\(([\d.]+)/)
			return m ? parseFloat(m[1]) : 0
		})
	if ((await h1Lightness()) > 0.5) {
		await page.getByRole('button', { name: /toggle light or dark/i }).click()
		await expect.poll(h1Lightness, { timeout: 5000 }).toBeLessThan(0.5)
	}
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

test.describe('fidelity — computed typography matches the mock', () => {
	test('Overview: every role matches font size / weight / family', async ({ browser }) => {
		const appCtx = await browser.newContext({ colorScheme: 'light' })
		const app = await appCtx.newPage()
		await signIn(app) // lands on the Overview
		await ensureLight(app)

		const mockCtx = await browser.newContext({ colorScheme: 'light' })
		const mock = await mockCtx.newPage()
		await enterMock(mock)

		const drift: string[] = []
		for (const r of OVERVIEW) {
			const a = await measure(app, r.app)
			const m = await measure(mock, r.mock)
			if (!a.found) drift.push(`${r.role}: not found in app`)
			else if (!m.found) drift.push(`${r.role}: not found in mock`)
			else if (a.fs !== m.fs || a.fw !== m.fw || a.ff !== m.ff || a.color !== m.color)
				drift.push(
					`${r.role}: app ${a.fs}/${a.fw}/${a.ff}/${a.color} ≠ mock ${m.fs}/${m.fw}/${m.ff}/${m.color}`
				)
		}
		await appCtx.close()
		await mockCtx.close()

		expect(drift, `typography/color drift vs the mock:\n  ${drift.join('\n  ')}`).toEqual([])
	})

	// Card padding, inter-card gap, and radius — the Zen-Sumi rhythm (mock uses 24px / 10px).
	const SPACING: Role[] = [
		{
			role: 'stat tile (padding + radius)',
			app: { text: 'spend · today', mode: 'exact' },
			mock: { text: 'spend · today', mode: 'exact' }
		},
		{
			role: 'card (inter-card gap + radius)',
			app: { text: 'execution plane', mode: 'exact' },
			mock: { text: 'execution plane · 24h', mode: 'exact' }
		}
	]

	test('Overview: card padding / gap / radius match the mock', async ({ browser }) => {
		const appCtx = await browser.newContext({ colorScheme: 'light' })
		const app = await appCtx.newPage()
		await signIn(app)
		await ensureLight(app)
		const mockCtx = await browser.newContext({ colorScheme: 'light' })
		const mock = await mockCtx.newPage()
		await enterMock(mock)

		const drift: string[] = []
		for (const r of SPACING) {
			const a = await measureBox(app, r.app)
			const m = await measureBox(mock, r.mock)
			if (!a.found || !m.found) drift.push(`${r.role}: card not found`)
			// stat tile: compare padding + radius; mid card: compare margin-top (gap) + radius
			else if (r.role.includes('stat')) {
				if (a.pad !== m.pad || a.radius !== m.radius)
					drift.push(`${r.role}: app pad ${a.pad} r ${a.radius} ≠ mock pad ${m.pad} r ${m.radius}`)
			} else if (a.mt !== m.mt || a.radius !== m.radius)
				drift.push(`${r.role}: app gap ${a.mt} r ${a.radius} ≠ mock gap ${m.mt} r ${m.radius}`)
		}
		await appCtx.close()
		await mockCtx.close()

		expect(drift, `spacing/radius drift vs the mock:\n  ${drift.join('\n  ')}`).toEqual([])
	})

	test('Overview: card-head + page padding match the mock', async ({ browser }) => {
		const appCtx = await browser.newContext({ colorScheme: 'light' })
		const app = await appCtx.newPage()
		await signIn(app)
		await ensureLight(app)
		const mockCtx = await browser.newContext({ colorScheme: 'light' })
		const mock = await mockCtx.newPage()
		await enterMock(mock)

		const drift: string[] = []
		// card-head strip padding (mock card-hd = 16px 24px; app had a tighter px-4 py-2.5)
		const aHead = await measureHeadPad(app, { text: 'execution plane', mode: 'exact' })
		const mHead = await measureHeadPad(mock, { text: 'execution plane · 24h', mode: 'exact' })
		if (aHead !== mHead) drift.push(`card-head padding: app ${aHead} ≠ mock ${mHead}`)

		// page content side padding (mock .view-pad = 24px; app had px-5 = 20px)
		const sidePad = (page: Page) =>
			page.evaluate(() => {
				const wrap = [...(document.querySelector('main')?.children || [])].find((d) =>
					/space-y/.test(d.className)
				)
				const el = wrap || document.querySelector('.view-pad')
				return el ? getComputedStyle(el).paddingLeft : ''
			})
		const aSide = await sidePad(app)
		const mSide = await sidePad(mock)
		if (aSide !== mSide) drift.push(`page side padding: app ${aSide} ≠ mock ${mSide}`)

		await appCtx.close()
		await mockCtx.close()
		expect(drift, `card-head / page padding drift vs the mock:\n  ${drift.join('\n  ')}`).toEqual(
			[]
		)
	})
})
