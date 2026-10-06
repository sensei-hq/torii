import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@rokkit/states', () => ({ commands: { registerMany: vi.fn(() => () => {}) } }))

import { commands } from '@rokkit/states'
import { registerShellCommands } from './commands'

describe('registerShellCommands', () => {
	beforeEach(() => vi.mocked(commands.registerMany).mockClear())

	it('maps items to navigation descriptors and returns the unregister handle', () => {
		const cleanup = () => {}
		vi.mocked(commands.registerMany).mockReturnValueOnce(cleanup)
		const goto = vi.fn()

		const unregister = registerShellCommands({ goto, items: ['Inbox', 'Library'] })

		expect(unregister).toBe(cleanup)
		expect(commands.registerMany).toHaveBeenCalledTimes(1)
		expect(commands.registerMany.mock.calls[0][0]).toEqual([
			{
				id: 'nav.inbox',
				label: 'Go to Inbox',
				group: 'navigation',
				keywords: ['inbox'],
				run: expect.any(Function)
			},
			{
				id: 'nav.library',
				label: 'Go to Library',
				group: 'navigation',
				keywords: ['library'],
				run: expect.any(Function)
			}
		])
	})

	it('each descriptor navigates to its original item casing when run', () => {
		const goto = vi.fn()
		registerShellCommands({ goto, items: ['Inbox'] })
		const [descriptor] = commands.registerMany.mock.calls[0][0]
		descriptor.run()
		expect(goto).toHaveBeenCalledWith('Inbox')
	})

	it('tolerates a missing goto handler', () => {
		registerShellCommands({ items: ['Settings'] })
		const [descriptor] = commands.registerMany.mock.calls[0][0]
		expect(() => descriptor.run()).not.toThrow()
	})
})
