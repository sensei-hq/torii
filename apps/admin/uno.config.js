import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize, borderRadius } from '@torii/ui/type-scale'

// Type scale + radii overridden to the mockup's zs.css (11-based type; radius-lg 10px).
// presetRokkit's defaults read a step small (type) and rounded-lg 8px vs the mock's 10px.
export default defineConfig({ presets: [presetRokkit(config)], theme: { fontSize, borderRadius } })
