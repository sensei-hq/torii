import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1, // WKWebView shares one window — no parallelism
  globalSetup: './globalSetup.ts',
  globalTeardown: './globalTeardown.ts',
  projects: [{ name: 'tauri', use: { mode: 'tauri' } }]
})
