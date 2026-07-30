import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize, borderRadius } from './type-scale.js'

// Type scale + radii overridden to the mockup's zs.css (11-based type; radius-lg 10px).
export default defineConfig({ presets: [presetRokkit(config)], theme: { fontSize, borderRadius } })
