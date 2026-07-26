import { expect, test } from 'vitest'
import { matchesRequest, matchesEvent } from './filters'
import type { AuditEvent, RequestRow } from './api'

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
	id: '1',
	chain_id: 'chat',
	adapter: 'anthropic',
	model: 'claude-sonnet-4-5',
	execution_location: 'cloud',
	input_tokens: 30,
	output_tokens: 24,
	cost_usd: 0.0004,
	duration_ms: 500,
	status: 'success',
	recorded_at: '2026-07-25T10:37:00Z',
	...over
})

const ev = (over: Partial<AuditEvent> = {}): AuditEvent => ({
	id: 'e1',
	actor_id: '5107174b-aaaa',
	action: 'role.assigned',
	target_type: 'profile_role',
	target_id: 'p1',
	created_at: '2026-07-25T16:31:00Z',
	...over
})

test('matchesRequest: empty needle + plane=all matches everything', () => {
	expect(matchesRequest(row(), '', 'all')).toBe(true)
	expect(matchesRequest(row({ execution_location: 'local' }), '', 'all')).toBe(true)
})

test('matchesRequest: plane filter narrows by execution_location', () => {
	expect(matchesRequest(row({ execution_location: 'local' }), '', 'local')).toBe(true)
	expect(matchesRequest(row({ execution_location: 'cloud' }), '', 'local')).toBe(false)
	// a null plane only matches 'all', never a concrete plane
	expect(matchesRequest(row({ execution_location: null }), '', 'cloud')).toBe(false)
	expect(matchesRequest(row({ execution_location: null }), '', 'all')).toBe(true)
})

test('matchesRequest: needle searches model/chain/status/plane, case-insensitive', () => {
	expect(matchesRequest(row(), 'sonnet', 'all')).toBe(true) // model
	expect(matchesRequest(row(), 'chat', 'all')).toBe(true) // chain_id
	expect(matchesRequest(row({ status: 'error' }), 'error', 'all')).toBe(true) // status
	expect(matchesRequest(row(), 'llama', 'all')).toBe(false) // no match
})

test('matchesRequest: plane AND needle are combined (both must hold)', () => {
	// cloud row, plane=local → excluded even if the needle matches
	expect(matchesRequest(row({ execution_location: 'cloud' }), 'sonnet', 'local')).toBe(false)
})

test('matchesRequest: null chain_id does not throw + is treated as empty', () => {
	expect(matchesRequest(row({ chain_id: null }), 'sonnet', 'all')).toBe(true)
})

test('matchesEvent: empty needle matches; needle searches action/target/actor', () => {
	expect(matchesEvent(ev(), '')).toBe(true)
	expect(matchesEvent(ev(), 'role.assigned')).toBe(true)
	expect(matchesEvent(ev(), 'profile_role')).toBe(true)
	expect(matchesEvent(ev(), '5107174b')).toBe(true)
	expect(matchesEvent(ev(), 'budget')).toBe(false)
})

test('matchesEvent: null target fields do not throw', () => {
	expect(matchesEvent(ev({ target_type: null, target_id: null, actor_id: null }), 'role')).toBe(
		true
	)
})
