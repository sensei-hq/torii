import { render, fireEvent } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import EnvChip from './EnvChip.svelte'

test('EnvChip shows the mode and cycles on click', async () => {
	const { getByRole, getByText } = render(EnvChip)
	expect(getByText(/desktop/i)).toBeTruthy()
	await fireEvent.click(getByRole('button'))
	expect(getByText(/offline/i)).toBeTruthy()
})
