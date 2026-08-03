// C5 RAG frontend browser smoke (chromium). Verifies the W2 Library + W3 retrieval-inspector
// screens at runtime against the VITE_E2E stubs, WITHOUT building the Tauri binary.
//
// Why this exists alongside the Tauri harness (e2e/tests/rag.spec.ts): the full desktop e2e builds
// the native binary, which embeds llama.cpp (sensei `local-llama-cpp` → `llama-cpp-sys-2`). On the
// current macOS-26 toolchain that native build fails ('std::filesystem::path' unavailable —
// deployment-target regression in the bumped llama-cpp-sys-2 v0.1.152), blocking the WHOLE desktop
// e2e suite regardless of app code. The RAG screens use the cloud gateway path + IS_E2E stubs (never
// the local llama.cpp engine), so a plain-browser run of the same SvelteKit app verifies them
// faithfully. Once the native build is unblocked, e2e/tests/rag.spec.ts drives the identical hooks
// in the WKWebView.
//
// Run:
//   VITE_E2E=true bunx vite dev --port 5299 &     # from apps/desktop
//   BASE=http://localhost:5299 bun e2e/browser-smoke.mjs
import { chromium } from '@playwright/test'

const BASE = process.env.BASE || 'http://localhost:5299'
const assert = (c, m) => {
  if (!c) throw new Error('FAIL: ' + m)
}

const browser = await chromium.launch()
const page = await browser
  .newContext({ viewport: { width: 1200, height: 800 } })
  .then((c) => c.newPage())
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

try {
  // ── W2 Library ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-desktop-shell]', { timeout: 20_000 })
  await page.waitForSelector('[data-library]', { timeout: 10_000 })
  const rows = await page.locator('[data-doc-row]').count()
  assert(rows === 3, `expected 3 doc rows, got ${rows}`)
  assert(
    await page.locator('[data-ingest-status]').first().isVisible(),
    'ingest-status badge visible'
  )
  assert(await page.locator('[data-ingesting-note]').isVisible(), 'ingesting note visible')
  await page.locator('[data-doc-row]').first().click()
  await page.waitForSelector('[data-doc-detail]', { timeout: 5_000 })
  const detail = await page.locator('[data-doc-detail]').innerText()
  assert(/Ingestion pipeline/i.test(detail), 'detail drawer shows the ingestion pipeline')
  assert(/Extracted assets/i.test(detail), 'detail drawer shows extracted assets')
  console.log(
    '  ✓ Library — 3 docs with status badges, ingesting note, detail drawer (pipeline + assets)'
  )

  // ── W3 Retrieval inspector ──────────────────────────────────────────────
  await page.goto(`${BASE}/retrieval`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-retrieval]', { timeout: 10_000 })
  await page.waitForSelector('[data-space-select]', { timeout: 5_000 })
  await page.locator('[data-query]').fill('widget migration rollback')
  await page.locator('[data-retrieve-run]').click()
  await page.waitForSelector('[data-chunk]', { timeout: 5_000 })
  const chunks = await page.locator('[data-chunk]').count()
  assert(chunks === 2, `expected 2 retrieved chunks, got ${chunks}`)
  assert(
    /grounding ready/i.test(await page.locator('[data-grounding]').innerText()),
    'grounding-ready pill'
  )
  assert(await page.locator('[data-score]').first().isVisible(), 'per-chunk score bars')
  assert(/embed/i.test(await page.locator('[data-stage]').innerText()), 'pipeline stages')
  const body = await page.locator('[data-retrieval]').innerText()
  assert(/\[REDACTED:/.test(body), 'redaction placeholder shown')
  assert(!/sk-[A-Za-z0-9]{20}/.test(body), 'no raw secret rendered')
  console.log('  ✓ Retrieval — 2 scored chunks (dense/bm25/fused), grounding, stages, redacted')

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('; ')}`)
  console.log('✅ RAG FRONTEND BROWSER E2E PASSED')
} finally {
  await browser.close()
}
