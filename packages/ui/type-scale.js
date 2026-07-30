// Zen-Sumi type scale — matches the mockup's zs.css (docs/mockups; measured live via
// getComputedStyle on 2026-07-30). 11-based, with display sizes growing to 40/56. Shared by
// every app's uno.config so the scale is defined ONCE, overriding presetRokkit's 12-based
// default (which read a step small against the mocks: xs 12 vs 11 … 3xl 30 vs 40).
export const fontSize = {
	xs: ['11px', '1.45'],
	sm: ['13px', '1.5'],
	base: ['15px', '1.55'],
	lg: ['17px', '1.45'],
	xl: ['22px', '1.3'],
	'2xl': ['28px', '1.2'],
	'3xl': ['40px', '1.1'],
	'4xl': ['56px', '1.05']
}
