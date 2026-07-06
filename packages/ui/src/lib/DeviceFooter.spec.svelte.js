import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import DeviceFooter from './DeviceFooter.svelte'

test('DeviceFooter shows localModels and configVersion', () => {
	const { getByText } = render(DeviceFooter, { props: { localModels: 2, configVersion: 412 } })
	expect(getByText(/2 on device/i)).toBeTruthy()
	expect(getByText(/config v412/i)).toBeTruthy()
})
