import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import ExecBadge from './ExecBadge.svelte'

test('ExecBadge shows on-device text for the local plane', () => {
  const { getByText } = render(ExecBadge, { props: { plane: 'local' } })
  expect(getByText(/on your device/i)).toBeTruthy()
})

test('ExecBadge shows the region for the cloud plane', () => {
  const { getByText } = render(ExecBadge, { props: { plane: 'cloud', region: 'eu-west-2' } })
  expect(getByText(/via gateway · eu-west-2/i)).toBeTruthy()
})
