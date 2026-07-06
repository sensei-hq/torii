import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import AppShell from './AppShell.svelte'

test('AppShell renders the title and the nav rail landmark', () => {
  const { getByText, getByRole } = render(AppShell, { props: { app: 'admin', title: 'Dashboard' } })
  expect(getByText('Dashboard')).toBeTruthy()
  expect(getByRole('navigation')).toBeTruthy()
})
