// Zen-Sumi type + radius scale — matches the mockup's zs.css (docs/mockups; measured live via
// getComputedStyle on 2026-07-30). 11-based type, with display sizes growing to 40/56. Shared by
// every app's uno.config so the scale is defined ONCE, overriding presetRokkit's defaults
// (type read a step small: xs 12 vs 11 … 3xl 30 vs 40; radius-lg was 8 vs the mock's 10).
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

// Radii — mock's --radius 6 / --radius-lg 10 / pill. Deep-merged over presetRokkit, so only the
// stops that differ are overridden (lg was 8px). `rounded`→DEFAULT, `rounded-lg`→lg, etc.
export const borderRadius = {
	sm: '4px',
	DEFAULT: '6px',
	lg: '10px',
	full: '9999px'
}

// Letter-spacing — so eyebrows use the semantic `tracking-widest`, never an arbitrary
// `tracking-[0.18em]`. `widest` = the mock's measured eyebrow tracking (1.98px @ 11px = 0.18em);
// `tight` = the mock's display-title tracking (~-0.02em).
export const letterSpacing = {
	tight: '-0.02em',
	normal: '0',
	wide: '0.05em',
	wider: '0.1em',
	widest: '0.18em'
}
