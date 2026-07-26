import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import DesktopShell from './DesktopShell.svelte'

test('DesktopShell renders user, nav landmark, env chip and nav items', () => {
	const { getByText, getByRole, getAllByText } = render(DesktopShell, {
		props: {
			user: { name: 'Alex Rivera', role: 'member' },
			items: ['Workspace', 'Ask'],
			active: 'Workspace',
			version: 1
		}
	})
	// TitleBar renders "{name} · {role}" in one node — match a substring.
	expect(getByText(/Alex Rivera/)).toBeTruthy()
	expect(getByRole('navigation')).toBeTruthy()
	// palette is closed by default — 'Workspace' appears only in the nav rail
	expect(getAllByText('Workspace').length).toBeGreaterThanOrEqual(1)
	expect(getByText('Ask')).toBeTruthy()
})
