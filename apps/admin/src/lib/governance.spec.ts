import { describe, expect, test } from 'vitest'
import { scopeOptions, setFeaturePayload, WORKSPACE_SCOPE } from './governance'
import type { Role } from './api'

const role = (over: Partial<Role> = {}): Role => ({
	id: 'r-1',
	key: 'member',
	name: 'Member',
	is_system: true,
	cap_count: 3,
	capabilities: [],
	...over
})

// ── scopeOptions: the switcher's menu ────────────────────────────────────────
describe('scopeOptions', () => {
	test('always leads with the workspace default (scope_id null)', () => {
		const [first] = scopeOptions([])
		expect(first).toMatchObject({ key: 'workspace', type: 'workspace', id: null })
	})

	test('with no roles, offers only the workspace default', () => {
		expect(scopeOptions([])).toHaveLength(1)
		expect(scopeOptions()).toHaveLength(1) // undefined roles degrade the same way
	})

	test('appends one role scope per role, carrying the REAL role_id as scope_id', () => {
		const opts = scopeOptions([
			role({ id: 'r-owner', name: 'Owner' }),
			role({ id: 'r-viewer', name: 'Viewer' })
		])
		expect(opts).toHaveLength(3)
		expect(opts[1]).toMatchObject({ key: 'role:r-owner', type: 'role', id: 'r-owner', label: 'Owner' })
		expect(opts[2]).toMatchObject({ key: 'role:r-viewer', type: 'role', id: 'r-viewer', label: 'Viewer' })
	})

	test('keys are unique + stable for #each keying', () => {
		const opts = scopeOptions([role({ id: 'a' }), role({ id: 'b' })])
		expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length)
	})
})

// ── setFeaturePayload: the un-hardcoded RPC seam ──────────────────────────────
describe('setFeaturePayload', () => {
	test('defaults to the workspace scope — the pre-existing body is byte-identical', () => {
		// Guards the "do NOT break the workspace-scope path" contract: same shape the
		// client hardcoded before, so the existing write keeps working untouched.
		expect(setFeaturePayload('grounded', 'locked')).toEqual({
			feature_key: 'grounded',
			scope_type: 'workspace',
			scope_id: null,
			state: 'locked'
		})
		expect(setFeaturePayload('grounded', 'locked', WORKSPACE_SCOPE)).toEqual(
			setFeaturePayload('grounded', 'locked')
		)
	})

	test('a role scope carries scope_type:"role" + the role_id through to the gateway', () => {
		// The whole point of the pass: the RPC body must NOT be hardcoded to workspace.
		expect(setFeaturePayload('masking', 'default-on', { type: 'role', id: 'r-viewer' })).toEqual({
			feature_key: 'masking',
			scope_type: 'role',
			scope_id: 'r-viewer',
			state: 'default-on'
		})
	})

	test('a space scope is carried too (backend accepts it; UI enumeration pending a spaces read)', () => {
		expect(setFeaturePayload('citations', 'default-off', { type: 'space', id: 's-leasing' })).toEqual({
			feature_key: 'citations',
			scope_type: 'space',
			scope_id: 's-leasing',
			state: 'default-off'
		})
	})
})
