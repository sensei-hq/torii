import { describe, expect, it } from 'vitest'

import {
	accuracyLabel,
	admissibleLabel,
	ciFloorIsBinding,
	ciLabel,
	configuredMargin,
	DEFAULT_MARGIN,
	marginLabel,
	orderedRows,
	rankLabel,
	shortSha,
	verdictTone
} from './rankings'
import type { RankingPolicy, RankingRow } from './api'

const policy = (over: Partial<RankingPolicy> = {}): RankingPolicy => ({
	category: 'planner.select',
	is_default: false,
	margin: 0.05,
	revision: 2,
	modified_at: '2026-10-25T00:00:00Z',
	modified_by: 'tester',
	...over
})

const row = (over: Partial<RankingRow> = {}): RankingRow => ({
	category: 'planner.select',
	chain_name: 'decide',
	sequence_order: 1,
	model_full_name: 'nimble',
	provider: 'Ollama',
	router_name: 'ollama',
	plane: 'cloud',
	context_window: 8194,
	rank: null,
	verdict: 'tie',
	within_margin: null,
	effective_margin: 0.03,
	policy_revision: null,
	accuracy: 0.95,
	ci_half_width: 0.03,
	measured: true,
	proxy: 'tool.route',
	revision: 1,
	artifact_sha: 'a332308251c575e185f019d9d1d40cc73cd11272dedde44f168c16f24cc56ad6',
	corpus_sha: 'd7dbb5ba6621f2a9a4133ee7b5649e0d74fba282de3fb0ae00da6615ecd4fcf7',
	generated_at: '2026-10-24T22:00:08Z',
	...over
})

describe('configuredMargin', () => {
	it('prefers the tenant row over the platform default', () => {
		const got = configuredMargin(
			[policy({ is_default: true, margin: 0.09 }), policy({ is_default: false, margin: 0.04 })],
			'planner.select'
		)
		expect(got).toMatchObject({ margin: 0.04, scope: 'tenant', revision: 2 })
	})

	it('falls back to the platform default when the tenant has no row', () => {
		const got = configuredMargin([policy({ is_default: true, margin: 0.09 })], 'planner.select')
		expect(got).toMatchObject({ margin: 0.09, scope: 'platform' })
	})

	it('reports the built-in default when no row exists at all', () => {
		const got = configuredMargin([], 'planner.select')
		expect(got).toEqual({
			margin: DEFAULT_MARGIN,
			scope: 'built-in',
			revision: null,
			modifiedBy: null
		})
	})

	it('ignores policies for other categories', () => {
		const got = configuredMargin(
			[policy({ category: 'tool.route', margin: 0.2 })],
			'planner.select'
		)
		expect(got.scope).toBe('built-in')
		expect(got.margin).toBe(DEFAULT_MARGIN)
	})
})

describe('ciFloorIsBinding', () => {
	it('is true when the effective margin is the CI, not the policy', () => {
		expect(ciFloorIsBinding(0.0001, 0.03)).toBe(true)
	})
	it('is false when the policy set the margin', () => {
		expect(ciFloorIsBinding(0.09, 0.03)).toBe(false)
	})
	it('tolerates numeric noise below display precision', () => {
		expect(ciFloorIsBinding(0.03, 0.030000000000000002)).toBe(false)
	})
})

describe('labels', () => {
	it('renders accuracy as a percentage', () => {
		expect(accuracyLabel(0.945)).toBe('94.5%')
		expect(accuracyLabel(null)).toBe('—')
	})

	it('renders the CI as a range, and the point estimate alone without a half-width', () => {
		expect(ciLabel(0.945, 0.03)).toBe('91.5–97.5%')
		expect(ciLabel(0.945, null)).toBe('94.5%')
		expect(ciLabel(null, 0.03)).toBe('—')
		// clamped: an interval cannot describe a probability outside [0, 1]
		expect(ciLabel(0.99, 0.05)).toBe('94.0–100.0%')
	})

	it('never renders a tie as a rank', () => {
		expect(rankLabel(null, 'tie')).toBe('tied')
		expect(rankLabel(null, 'unranked')).toBe('unranked')
		expect(rankLabel(2, 'winner')).toBe('2')
		expect(rankLabel(null, 'winner')).toBe('—')
	})

	it('distinguishes "outside the margin" from "no order to claim"', () => {
		expect(marginLabel(true, 'winner')).toBe('within')
		expect(marginLabel(false, 'winner')).toBe('outside')
		expect(marginLabel(null, 'winner')).toBe('unmeasured')
		expect(marginLabel(null, 'tie')).toBe('no order')
	})

	it('counts admissible rows out of measured ones', () => {
		expect(admissibleLabel({ admissible: 3, measured: 4 })).toBe('3 of 4')
	})

	it('truncates a digest for a cell', () => {
		expect(shortSha(row().artifact_sha)).toBe('a332308')
		expect(shortSha(null)).toBe('—')
	})

	it('tones a verdict by what it claims', () => {
		expect(verdictTone('winner')).toBe('success')
		expect(verdictTone('tie')).toBe('warning')
		expect(verdictTone('insufficient')).toBe('danger')
		expect(verdictTone('unranked')).toBe('mute')
	})
})

describe('orderedRows', () => {
	it('keeps chain sequence when there is no rank', () => {
		const got = orderedRows([
			row({ model_full_name: 'c', sequence_order: 3 }),
			row({ model_full_name: 'a', sequence_order: 1 }),
			row({ model_full_name: 'b', sequence_order: 2 })
		])
		expect(got.map((r) => r.model_full_name)).toEqual(['a', 'b', 'c'])
	})

	it('puts ranked rows first, in rank order, then the unranked by sequence', () => {
		const got = orderedRows([
			row({ model_full_name: 'unranked', sequence_order: 1 }),
			row({ model_full_name: 'second', sequence_order: 9, rank: 2, verdict: 'winner' }),
			row({ model_full_name: 'first', sequence_order: 9, rank: 1, verdict: 'winner' })
		])
		expect(got.map((r) => r.model_full_name)).toEqual(['first', 'second', 'unranked'])
	})
})
