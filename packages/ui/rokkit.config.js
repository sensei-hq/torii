// Zen-Sumi skin for Strategos UI
// Palette: washi paper (stone), sumi ink, 朱 vermillion accent.
// Restraint over ornament. Hairlines over shadows. Air over density.
//
// Approach: named-palette approximation (stone/orange/sky) because `vermillion`
// is not a built-in Tailwind palette. The `overrides` block carries the exact
// OKLCH values from docs/mockups/app/zs.css for semantic tokens.
// TODO: define a full `vermillion` palette in `palettes:` + `colorSpace:'oklch'`
// for pixel-perfect shu-500 → oklch(0.580 0.150 35) once the full ramp is needed.

export default {
	skins: {
		default: {
			surface: 'stone',
			ink: 'stone',
			// Closest named Tailwind palette to Zen-Sumi's 朱 vermillion (shu-500)
			primary: 'orange',
			accent: 'orange',
			success: 'green',
			warning: 'yellow',
			danger: 'red',
			error: 'red',
			info: 'sky'
		},
		'zen-sumi': {
			surface: 'stone',
			ink: 'stone',
			primary: 'orange',
			accent: 'orange',
			success: 'green',
			warning: 'yellow',
			danger: 'red',
			error: 'red',
			info: 'sky'
		}
	},

	// Exact Zen-Sumi color values from docs/mockups/app/zs.css
	// These override the palette-derived tokens with the precise OKLCH hues.
	overrides: {
		// 朱 vermillion accent — shu-500
		accent: 'oklch(0.580 0.150 35)',
		'accent-soft': 'oklch(0.580 0.150 35 / 0.12)',
		// Classification hues
		success: 'oklch(0.620 0.080 160)',
		'success-soft': 'oklch(0.620 0.080 160 / 0.14)',
		warning: 'oklch(0.720 0.120 75)',
		'warning-soft': 'oklch(0.720 0.120 75 / 0.15)',
		danger: 'oklch(0.55 0.18 28)',
		'danger-soft': 'oklch(0.55 0.18 28 / 0.12)',
		// Focus ring matches the vermillion accent
		'focus-ring': 'oklch(0.580 0.150 35)'
	},

	icons: {
		lucide: '@iconify-json/lucide/icons.json'
	}
}
