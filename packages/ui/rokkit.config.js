// Zen-Sumi design system for torii + seiki — washi paper, sumi ink, 朱 vermillion.
// Restraint over ornament. Hairlines over shadows. Air over density.
//
// Follows the Rokkit skin system (skin-system-rokkit skill) + the sensei reference
// (~/Developer/sensei-hq/sensei/app/rokkit.config.js): a full custom OKLCH palette
// (sumi-palette.js) + reserved-name `overrides` that map paper/ink/accent to exact
// palette stops. Dual-surface skin auto-flips in [data-mode="dark"] — no manual
// inversion. Anchors match docs/mockups/app/zs.css.

import { sumiPalette } from './sumi-palette.js'

export default {
	palettes: sumiPalette,
	colorSpace: 'oklch',

	// Dual-surface skin: surface + ink both pull kami (light) / sumi (dark).
	skin: {
		surface: { light: 'kami', dark: 'sumi' },
		ink: { light: 'kami', dark: 'sumi' },
		primary: 'shu', // vermillion (朱) z-scale accent
		secondary: 'murasaki',
		accent: 'shu',
		success: 'hisui', // jade (翡翠)
		warning: 'kohaku', // amber (琥珀)
		danger: 'beni', // crimson (紅)
		error: 'beni',
		info: 'ai' // indigo (藍)
	},

	// Reserved-name overrides — the preset emits these per mode so [data-mode="dark"]
	// swaps automatically. Maps the semantic tokens my components use to exact stops.
	overrides: {
		// Surface (paper) — washi ramp
		paper: { light: 'kami.100', dark: 'sumi.50' },
		'paper-soft': { light: 'kami.200', dark: 'sumi.100' },
		'paper-mute': { light: 'kami.300', dark: 'sumi.200' },
		'paper-edge': { light: 'kami.400', dark: 'sumi.400' },

		// Ink (text)
		ink: { light: 'kami.900', dark: 'sumi.900' },
		'ink-soft': { light: 'kami.700', dark: 'sumi.800' },
		'ink-mute': { light: 'kami.600', dark: 'sumi.700' },
		'ink-faint': { light: 'kami.500', dark: 'sumi.600' },

		// Accent — vermillion (rationed). --accent = shu-500 light / shu-400 dark.
		accent: { light: 'shu.500', dark: 'shu.400' },
		// accent-soft is an ALPHA wash of the accent (mockup zs.css), not a solid tint — the
		// preset default would emit a solid shu stop; pin the raw alpha value per mode instead.
		'accent-soft': {
			light: 'oklch(0.580 0.150 35 / 0.12)',
			dark: 'oklch(0.700 0.150 35 / 0.18)'
		},

		// Primary named token = ink-colored CTA (design system: --primary = --ink).
		// bg-primary / text-primary render ink; the vermillion is `accent`.
		primary: { light: 'kami.900', dark: 'sumi.900' },
		'on-primary': { light: 'kami.100', dark: 'sumi.50' },

		// Status — lighten one stop in dark mode for legibility.
		success: { light: 'hisui.500', dark: 'hisui.400' },
		warning: { light: 'kohaku.500', dark: 'kohaku.400' },
		danger: { light: 'beni.500', dark: 'beni.400' },
		info: { light: 'ai.500', dark: 'ai.400' }
	},

	typography: {
		sans: "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
		mono: "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Menlo, monospace",
		display: "'Fraunces Variable', 'Fraunces', 'Iowan Old Style', Georgia, serif",
		kanji: "'Shippori Mincho', 'Yu Mincho', 'Hiragino Mincho ProN', 'Songti SC', serif"
	},

	// Zen-Sumi radii: --radius 6px / --radius-lg 10px / pill.
	shape: { radius: 'soft' },

	// Solar (bold-duotone) is the mockup's icon set; lucide kept as a fallback.
	icons: {
		solar: '@iconify-json/solar/icons.json',
		lucide: '@iconify-json/lucide/icons.json'
	},
	switcher: 'manual',
	storageKey: 'torii-theme'
}
