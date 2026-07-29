import { describe, expect, it } from 'vitest'
import config from '../../rokkit.config.js'
import { sumiPalette } from '../../sumi-palette.js'

// Foundation guard for the Zen-Sumi tokens (see docs/design/fidelity-audit.md).
// --paper-edge is every hairline/border in the app. Its light value must equal the
// mockup's measured border, oklch(0.880 0.015 85) (docs/mockups/app/zs.css). The
// token resolves through the reserved-name `overrides` map to a kami ramp stop, so
// assert the whole chain — a drift in either the mapping or the stop trips this.
describe('Zen-Sumi tokens', () => {
	it('--paper-edge (light) resolves to the mockup border value', () => {
		const stop = config.overrides['paper-edge'].light // e.g. 'kami.400'
		const [ramp, step] = stop.split('.')
		expect(sumiPalette[ramp][step]).toBe('0.880 0.015 85')
	})
})
