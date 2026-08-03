import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize, borderRadius, letterSpacing } from '@torii/ui/type-scale'

// Type scale + radii + tracking overridden to the mockup's zs.css (11-based type; radius-lg 10px;
// tracking-widest 0.18em). presetRokkit's defaults read a step small and tighter than the mock.
export default defineConfig({
	presets: [presetRokkit(config)],
	theme: { fontSize, borderRadius, letterSpacing }
})
