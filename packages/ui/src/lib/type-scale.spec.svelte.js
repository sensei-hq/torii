import { describe, expect, test } from 'vitest'
import { fontSize, borderRadius } from '../../type-scale.js'

// Guards the design-system FOUNDATION at the unit level: the type + radius scale must equal the
// mockup's zs.css (measured live via getComputedStyle on 2026-07-30, docs/mockups). A scale
// regression fails here fast — before the page-level fidelity harness (e2e/fidelity.spec.ts).
const MOCK_FONT_PX = {
	xs: '11px',
	sm: '13px',
	base: '15px',
	lg: '17px',
	xl: '22px',
	'2xl': '28px',
	'3xl': '40px',
	'4xl': '56px'
}
const MOCK_RADIUS = { sm: '4px', DEFAULT: '6px', lg: '10px', full: '9999px' }

describe('Zen-Sumi type + radius scale = the mock', () => {
	test('every font-size stop equals the mock zs.css value', () => {
		for (const [k, px] of Object.entries(MOCK_FONT_PX)) {
			const v = Array.isArray(fontSize[k]) ? fontSize[k][0] : fontSize[k]
			expect(v, `text-${k}`).toBe(px)
		}
	})

	test('radius stops match the mock (lg = 10px, not presetRokkit 8px)', () => {
		for (const [k, px] of Object.entries(MOCK_RADIUS))
			expect(borderRadius[k], `rounded-${k}`).toBe(px)
	})
})
