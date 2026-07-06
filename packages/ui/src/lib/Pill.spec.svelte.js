import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import Pill from './Pill.svelte'

test('Pill renders its label and tone class', () => {
	const { getByText } = render(Pill, { props: { label: 'Connected', tone: 'success' } })
	const el = getByText('Connected')
	expect(el).toBeTruthy()
	expect(el.closest('[data-pill]')?.getAttribute('data-tone')).toBe('success')
})
