/**
 * Zen/Sumi color palette for Rokkit — OKLCH format.
 *
 * Values are bare "L C H" OKLCH components. Requires colorSpace: 'oklch'.
 * Ported from the sensei design system (Jerry's Zen-Sumi reference) so torii +
 * seiki share the same washi-paper / sumi-ink / 朱-vermillion vocabulary as
 * sensei + dojo. Anchors match docs/mockups/app/zs.css.
 *
 * Dual-surface design:
 *   kami  — warm paper scale (light-mode surface, z1→z9 = lightest→darkest)
 *   sumi  — ink scale (dark-mode surface, two-pole: 50–400 dark inks as
 *           surfaces, 600–950 warm-paper whites as text)
 */

/** kami — warm neutral, washi paper (z1) → sumi ink (z9) */
const kami = {
	50: '0.985 0.005 85',
	100: '0.975 0.008 85', // page bg
	200: '0.955 0.010 85', // card bg (raised)
	300: '0.920 0.012 85', // inset (sunken)
	400: '0.880 0.015 85', // border / hairline (--paper-edge light; matches mockup zs.css)
	500: '0.750 0.008 50', // faint text / placeholder
	600: '0.580 0.010 50', // tertiary text (eyebrows, meta)
	700: '0.380 0.012 50', // secondary text
	800: '0.280 0.012 50',
	900: '0.220 0.012 50', // primary text
	950: '0.170 0.010 50'
}

/** shu — vermillion, the one accent (朱). z6=shu-600 light / shu-400 dark */
const shu = {
	50: '0.970 0.020 35',
	100: '0.940 0.040 35',
	200: '0.880 0.070 35',
	300: '0.800 0.100 35',
	400: '0.700 0.130 35',
	500: '0.580 0.150 35',
	600: '0.500 0.140 35',
	700: '0.420 0.120 35',
	800: '0.350 0.100 35',
	900: '0.280 0.080 35',
	950: '0.220 0.060 35'
}

/** hisui — jade green, success (翡翠) */
const hisui = {
	50: '0.970 0.015 160',
	100: '0.940 0.030 160',
	200: '0.880 0.050 160',
	300: '0.800 0.065 160',
	400: '0.720 0.075 160',
	500: '0.620 0.080 160',
	600: '0.540 0.075 160',
	700: '0.460 0.065 160',
	800: '0.380 0.055 160',
	900: '0.300 0.045 160',
	950: '0.240 0.035 160'
}

/** kohaku — amber, warning (琥珀) */
const kohaku = {
	50: '0.980 0.020 75',
	100: '0.950 0.040 75',
	200: '0.900 0.070 75',
	300: '0.850 0.095 75',
	400: '0.790 0.110 75',
	500: '0.720 0.120 75',
	600: '0.640 0.110 75',
	700: '0.560 0.095 75',
	800: '0.470 0.080 75',
	900: '0.380 0.065 75',
	950: '0.300 0.050 75'
}

/**
 * sumi — dark-mode counterpart to kami, two-pole INVERTED:
 *   50–400 = sumi-ink darks (dark-mode surfaces via paper-* → 50/100/200/400)
 *   600–950 = warm-paper whites (dark-mode text via ink → 900 / ink-* → 700/800)
 */
const sumi = {
	50: '0.170 0.010 50', // page bg (dark)
	100: '0.210 0.012 50', // card bg (dark)
	200: '0.250 0.012 50', // inset (dark)
	300: '0.320 0.012 50',
	400: '0.300 0.010 50', // border (dark; --paper-edge) — subtle hairline just above paper-mute, matches mockup zs.css [data-theme=dark]
	500: '0.570 0.010 50',
	600: '0.420 0.012 85', // ink-faint (dark)
	700: '0.600 0.010 85', // ink-mute (dark)
	800: '0.780 0.008 85', // ink-soft (dark)
	900: '0.940 0.008 85', // primary text (dark)
	950: '0.975 0.008 85'
}

/** beni — deep crimson, danger/error (紅) */
const beni = {
	50: '0.980 0.010 18',
	100: '0.955 0.025 20',
	200: '0.910 0.055 22',
	300: '0.850 0.100 24',
	400: '0.740 0.155 26',
	500: '0.570 0.185 27',
	600: '0.500 0.175 25',
	700: '0.420 0.155 23',
	800: '0.330 0.120 20',
	900: '0.250 0.085 18',
	950: '0.170 0.060 18'
}

/** ai — indigo blue, info (藍) */
const ai = {
	50: '0.970 0.015 250',
	100: '0.945 0.030 251',
	200: '0.905 0.060 252',
	300: '0.845 0.100 253',
	400: '0.750 0.135 254',
	500: '0.590 0.160 254',
	600: '0.510 0.155 254',
	700: '0.430 0.140 254',
	800: '0.330 0.110 254',
	900: '0.250 0.080 254',
	950: '0.180 0.065 255'
}

/** murasaki — muted purple, secondary (紫) */
const murasaki = {
	50: '0.970 0.020 300',
	100: '0.945 0.045 300',
	200: '0.905 0.085 301',
	300: '0.845 0.135 302',
	400: '0.735 0.185 302',
	500: '0.560 0.225 303',
	600: '0.480 0.210 303',
	700: '0.400 0.185 304',
	800: '0.305 0.145 304',
	900: '0.225 0.105 305',
	950: '0.180 0.085 305'
}

export const sumiPalette = { kami, sumi, shu, hisui, kohaku, beni, ai, murasaki }
