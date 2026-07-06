import { kavach } from '@kavach/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import unocss from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [kavach(), unocss(), sveltekit()],
  optimizeDeps: {
    exclude: ['@rokkit/app', '@rokkit/ui', '@rokkit/states', '@rokkit/actions']
  }
})
