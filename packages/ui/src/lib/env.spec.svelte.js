import { beforeEach, describe, expect, it } from 'vitest'
import { env } from './env.svelte'

describe('env capability state', () => {
	beforeEach(() => env.set('desktop'))

	it('desktop mode is desktop-capable, not web, not offline', () => {
		expect(env.mode).toBe('desktop')
		expect(env.desktop).toBe(true)
		expect(env.web).toBe(false)
		expect(env.offline).toBe(false)
	})

	it('web mode is web-only', () => {
		env.set('web')
		expect(env.desktop).toBe(false)
		expect(env.web).toBe(true)
		expect(env.offline).toBe(false)
	})

	it('offline mode keeps desktop capabilities while flagged offline', () => {
		env.set('offline')
		expect(env.desktop).toBe(true)
		expect(env.web).toBe(false)
		expect(env.offline).toBe(true)
	})

	it('cycles desktop → offline → web → desktop', () => {
		env.cycle()
		expect(env.mode).toBe('offline')
		env.cycle()
		expect(env.mode).toBe('web')
		env.cycle()
		expect(env.mode).toBe('desktop')
	})

	it('set() accepts every known mode', () => {
		for (const mode of ['desktop', 'offline', 'web']) {
			env.set(mode)
			expect(env.mode).toBe(mode)
		}
	})
})
