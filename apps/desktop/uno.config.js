import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize } from '@torii/ui/type-scale'

// Type scale overridden to the mockup's zs.css scale (11-based; display grows to 40/56).
export default defineConfig({ presets: [presetRokkit(config)], theme: { fontSize } })
