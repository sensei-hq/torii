import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  webServer: {
    command: 'bun run dev -- --port 4273',
    url: 'http://localhost:4273',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  use: { baseURL: 'http://localhost:4273' }
})
