import { describe, expect, test } from 'vitest'
import {
	COST_MAX_USD,
	COST_WARN_USD,
	JUDGE_HIGH,
	JUDGE_OK,
	costTone,
	fmtCost,
	judgeVerdict
} from './playground'

// ── fmtCost ──────────────────────────────────────────────────────────────────
describe('fmtCost', () => {
	test('a free (or non-finite / negative) run renders "$0", never "$0.0000"', () => {
		// Local runs cost $0; the meter must say so plainly rather than a padded zero.
		expect(fmtCost(0)).toBe('$0')
		expect(fmtCost(-1)).toBe('$0')
		expect(fmtCost(Number.NaN)).toBe('$0')
	})
	test('a real cost renders to 4dp', () => {
		expect(fmtCost(0.0123)).toBe('$0.0123')
		expect(fmtCost(0.5)).toBe('$0.5000')
	})
	test('a non-zero cost too small to show at 4dp reads "<$0.0001", not a misleading "$0"', () => {
		// The consumer must be able to tell "genuinely free" apart from "cheap but not free".
		expect(fmtCost(0.00001)).toBe('<$0.0001')
	})
})

// ── costTone ─────────────────────────────────────────────────────────────────
describe('costTone', () => {
	test('nominal (ink) at/below the warn threshold, notable (accent) above it', () => {
		expect(costTone(COST_WARN_USD)).toBe('ink')
		expect(costTone(COST_WARN_USD + 0.001)).toBe('accent')
		expect(costTone(0)).toBe('ink')
	})
	test('the warn threshold sits within the meter full-scale (renders as partial fill)', () => {
		expect(COST_WARN_USD).toBeLessThan(COST_MAX_USD)
	})
})

// ── judgeVerdict ─────────────────────────────────────────────────────────────
describe('judgeVerdict', () => {
	test('an unscored answer (null/undefined/NaN) reads as an em dash + neutral tone, not 0%', () => {
		// A judge that couldn't score must NOT be shown as a real 0% verdict.
		for (const v of [null, undefined, Number.NaN]) {
			const r = judgeVerdict(v)
			expect(r.display).toBe('—')
			expect(r.tone).toBe('ink')
			expect(r.pct).toBe(0)
			expect(r.label.toLowerCase()).toContain("couldn't score")
		}
	})

	test('a high score is trustworthy (ink) — boundary at JUDGE_HIGH is inclusive', () => {
		const r = judgeVerdict(JUDGE_HIGH)
		expect(r.tone).toBe('ink')
		expect(r.pct).toBe(Math.round(JUDGE_HIGH * 100))
		expect(r.display).toBe(r.pct + '%')
		expect(r.label.toLowerCase()).toContain('safe to rely on')
	})

	test('a mid score is worth-a-check (accent) between JUDGE_OK and JUDGE_HIGH', () => {
		const r = judgeVerdict(0.7)
		expect(r.tone).toBe('accent')
		expect(r.pct).toBe(70)
	})

	test('the OK boundary is inclusive (accent); just below it is low-confidence (danger)', () => {
		expect(judgeVerdict(JUDGE_OK).tone).toBe('accent')
		expect(judgeVerdict(JUDGE_OK - 0.001).tone).toBe('danger')
	})

	test('a low score is low-confidence (danger) and warns before relying on it', () => {
		const r = judgeVerdict(0.2)
		expect(r.tone).toBe('danger')
		expect(r.label.toLowerCase()).toContain('verify')
	})

	test('an out-of-range score is clamped to 0..1 so the meter + percent stay legible', () => {
		expect(judgeVerdict(1.4).pct).toBe(100)
		expect(judgeVerdict(-0.5).pct).toBe(0)
		expect(judgeVerdict(-0.5).tone).toBe('danger')
	})
})
