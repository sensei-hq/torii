import { expect, test } from 'vitest'
import { createMockDataSource } from './index'
import { ModelSchema } from '../types'

test('mock data source returns validated models seeded from the mockups', async () => {
	const ds = createMockDataSource()
	const models = await ds.listModels()
	expect(models.length).toBeGreaterThan(0)
	for (const m of models) expect(() => ModelSchema.parse(m)).not.toThrow()
	expect(models.some((m) => m.localCapable)).toBe(true)
})
