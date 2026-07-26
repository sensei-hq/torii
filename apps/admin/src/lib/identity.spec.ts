import { expect, test } from 'vitest'
import { meaningfulRole } from './identity'

test('meaningfulRole: drops the Supabase JWT default "authenticated"', () => {
	expect(meaningfulRole('authenticated')).toBeNull()
})

test('meaningfulRole: drops null/undefined/empty', () => {
	expect(meaningfulRole(null)).toBeNull()
	expect(meaningfulRole(undefined)).toBeNull()
	expect(meaningfulRole('')).toBeNull()
})

test('meaningfulRole: passes through a real app role', () => {
	expect(meaningfulRole('owner')).toBe('owner')
	expect(meaningfulRole('admin')).toBe('admin')
})
