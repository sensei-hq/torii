import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/svelte'
import Stat from './Stat.svelte'
import PageHeader from './PageHeader.svelte'
import CardHead from './CardHead.svelte'
import AlertsCard from './AlertsCard.svelte'

// Component-level guard for the mock-matched typography/spacing CLASSES on the shared Zen-Sumi
// components. jsdom doesn't compute CSS (the page-level e2e/fidelity.spec.ts does that against the
// live mock) — here we pin the class contract cheaply: explicit asserts on the roles that drifted
// (display title, 300-weight stat number, 500-weight tracked eyebrows, p-6 / rounded-lg card) plus
// a full-markup snapshot as the catch-all. A weight/size/tracking regression fails fast.
// (svelteTesting auto-cleans the DOM between tests, so each test renders its own instance.)

describe('Stat', () => {
	const props = {
		label: 'Spend · today',
		value: '$157',
		unit: '/ $1,333 cap',
		hint: '11.8% of cap'
	}

	test('eyebrow label is text-xs / font-medium / 0.18em tracking (not font-semibold)', () => {
		const { container } = render(Stat, { props })
		const label = container.querySelector('.uppercase')
		expect(label?.className).toContain('text-xs')
		expect(label?.className).toContain('font-medium')
		expect(label?.className).toContain('tracking-[0.18em]')
		expect(label?.className).not.toContain('font-semibold')
	})

	test('value is the light display number (font-heading / text-3xl / font-light)', () => {
		const { container } = render(Stat, { props })
		const num = container.querySelector('.font-heading')
		expect(num?.className).toContain('text-3xl')
		expect(num?.className).toContain('font-light')
	})

	test('card is p-6 / rounded-lg (24px padding, 10px radius via the scale)', () => {
		const { container } = render(Stat, { props })
		expect(container.firstElementChild?.className).toContain('p-6')
		expect(container.firstElementChild?.className).toContain('rounded-lg')
	})

	test('markup snapshot', () => {
		const { container } = render(Stat, { props })
		expect(container.innerHTML).toMatchSnapshot()
	})
})

describe('PageHeader', () => {
	const props = { eyebrow: 'Wed · 22 Apr · last 24h', title: 'Good morning, Aiko.' }

	test('title is the display face at font-normal (not font-semibold)', () => {
		const { container } = render(PageHeader, { props })
		const h1 = container.querySelector('h1')
		expect(h1?.className).toContain('font-heading')
		expect(h1?.className).toContain('text-2xl')
		expect(h1?.className).toContain('font-normal')
		expect(h1?.className).not.toContain('font-semibold')
	})

	test('eyebrow is font-medium / 0.18em tracking', () => {
		const { container } = render(PageHeader, { props })
		const eyebrow = container.querySelector('.uppercase')
		expect(eyebrow?.className).toContain('font-medium')
		expect(eyebrow?.className).toContain('tracking-[0.18em]')
	})

	test('markup snapshot', () => {
		const { container } = render(PageHeader, { props })
		expect(container.innerHTML).toMatchSnapshot()
	})
})

describe('CardHead', () => {
	test('eyebrow is font-medium / 0.18em tracking (not font-semibold)', () => {
		const { container } = render(CardHead, { props: { title: 'Execution plane' } })
		const eyebrow = container.querySelector('.uppercase')
		expect(eyebrow?.className).toContain('font-medium')
		expect(eyebrow?.className).toContain('tracking-[0.18em]')
		expect(eyebrow?.className).not.toContain('font-semibold')
	})

	test('markup snapshot', () => {
		const { container } = render(CardHead, { props: { title: 'Execution plane' } })
		expect(container.innerHTML).toMatchSnapshot()
	})
})

describe('AlertsCard', () => {
	const alerts = [
		{
			id: 'a1',
			severity: 'warning',
			icon: 'i-solar-wallet-2-bold-duotone',
			text: 'Support at 92%',
			route: '/billing'
		},
		{
			id: 'a2',
			severity: 'accent',
			icon: 'i-solar-key-bold-duotone',
			text: '2 routers need a key',
			route: '/connections'
		}
	]

	test('renders a row per alert with a severity-toned dot', () => {
		const { container } = render(AlertsCard, { props: { alerts } })
		const rows = container.querySelectorAll('[data-severity]')
		expect(rows).toHaveLength(2)
		expect(rows[0].querySelector('.bg-warning')).toBeTruthy() // warning → amber
		expect(rows[1].querySelector('.bg-accent')).toBeTruthy() // accent → vermillion
		expect(container.textContent).toContain('2 open')
	})

	test('empty alerts → the reassuring empty state, no rows', () => {
		const { container } = render(AlertsCard, { props: { alerts: [] } })
		expect(container.querySelectorAll('[data-severity]')).toHaveLength(0)
		expect(container.textContent).toContain('Nothing needs attention')
	})

	test('routes user intent: opening a row calls onopen(route); dismiss calls ondismiss(id)', async () => {
		const opened = []
		const dismissed = []
		const { container } = render(AlertsCard, {
			props: { alerts, onopen: (r) => opened.push(r), ondismiss: (id) => dismissed.push(id) }
		})
		const firstRow = container.querySelector('[data-severity]')
		firstRow.querySelector('button').click() // the text button opens
		firstRow.querySelector('button[aria-label="Dismiss alert"]').click()
		expect(opened).toEqual(['/billing'])
		expect(dismissed).toEqual(['a1'])
	})

	test('markup snapshot', () => {
		const { container } = render(AlertsCard, { props: { alerts } })
		expect(container.innerHTML).toMatchSnapshot()
	})
})
