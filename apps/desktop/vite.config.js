import { sveltekit } from '@sveltejs/kit/vite'
import unocss from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [unocss(), sveltekit()],
	clearScreen: false,
	server: { port: 5274, strictPort: true },
	optimizeDeps: { exclude: ['@rokkit/app', '@rokkit/ui', '@rokkit/states', '@rokkit/actions'] }
})
