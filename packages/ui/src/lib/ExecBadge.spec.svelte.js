import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import ExecBadge from './ExecBadge.svelte'

test('ExecBadge shows on-device text for the local plane', () => {
	const { getByText } = render(ExecBadge, { props: { plane: 'local' } })
	expect(getByText(/on your device/i)).toBeTruthy()
})

test('ExecBadge shows the region for the cloud plane WHEN one is provided', () => {
	const { getByText } = render(ExecBadge, { props: { plane: 'cloud', region: 'iad' } })
	expect(getByText(/via gateway · iad/i)).toBeTruthy()
})

test('ExecBadge shows plain "via gateway" (no fabricated region) when none is provided (M3)', () => {
	const { getByText } = render(ExecBadge, { props: { plane: 'cloud' } })
	const el = getByText(/via gateway/i)
	expect(el).toBeTruthy()
	expect(el.textContent).not.toMatch(/·/) // no trailing "· <region>"
})
