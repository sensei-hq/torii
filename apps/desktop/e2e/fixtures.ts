import { createTauriTest } from '@srsholmes/tauri-playwright'

export const { test, expect } = createTauriTest({
  devUrl: 'tauri://localhost',       // required by the type; unused in socket mode
  mcpSocket: '/tmp/tauri-playwright.sock'
})
