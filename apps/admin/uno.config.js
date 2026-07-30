import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
import { fontSize } from '@torii/ui/type-scale'

// Type scale is overridden to the mockup's zs.css scale (11-based; display grows to 40/56).
// presetRokkit's default is 12-based, which reads a step small vs docs/mockups.
export default defineConfig({ presets: [presetRokkit(config)], theme: { fontSize } })
