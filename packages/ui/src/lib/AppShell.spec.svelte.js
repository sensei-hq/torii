import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import AppShell from './AppShell.svelte'

test('AppShell renders the title and the nav rail landmark', () => {
	const { getByText, getByRole } = render(AppShell, { props: { app: 'admin', title: 'Dashboard' } })
	// The top-bar center renders "{brand} · {title}" in one node — match a substring.
	expect(getByText(/Dashboard/)).toBeTruthy()
	expect(getByRole('navigation')).toBeTruthy()
})

// Fidelity-audit shell alignment (docs/design/fidelity-audit.md): the rail sits on
// `paper` (not `paper-soft`) and nav items use a 4px-grid padding (`px-3 py-2`),
// matching the mockup once its off-grid 7px/12px is snapped to the scale.
test('nav rail sits on paper and nav items use grid padding', () => {
	const { getByRole } = render(AppShell, { props: { app: 'admin', title: 'Dashboard' } })
	const railClasses = getByRole('navigation').className.split(/\s+/)
	expect(railClasses).toContain('bg-paper')
	expect(railClasses).not.toContain('bg-paper-soft')
	const linkClasses = getByRole('link', { name: /Overview/ }).className.split(/\s+/)
	expect(linkClasses).toEqual(expect.arrayContaining(['px-3', 'py-2']))
	expect(linkClasses).not.toContain('py-1.5')
})
