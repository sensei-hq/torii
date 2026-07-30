import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize, borderRadius, letterSpacing } from '@torii/ui/type-scale'

// Type scale + radii + tracking overridden to the mockup's zs.css (11-based; radius-lg 10; ws 0.18em).
export default defineConfig({
	presets: [presetRokkit(config)],
	theme: { fontSize, borderRadius, letterSpacing }
})
