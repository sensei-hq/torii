// SINGLE gate for E2E test-mode seams (M2). `import.meta.env.VITE_E2E` is statically replaced by
// vite at build time: in a PRODUCTION build (VITE_E2E unset) this constant folds to `false`, so
// every `if (IS_E2E)` branch is dead-code-eliminated and the stubs NEVER ship in the prod bundle.
//
// Why an in-app seam exists at all (rather than Playwright route-interception, per the review):
// the desktop's LOCAL inference is a Tauri IPC command (`invoke('infer')` → in-process Rust
// llama.cpp), which is NOT HTTP and cannot be route-intercepted; the seeded session likewise
// avoids real Supabase auth in the built WKWebView. Deterministic, network-free e2e therefore
// needs an in-app hook. Keeping every test-mode branch behind THIS one constant makes the surface
// a single auditable place instead of scattered `import.meta.env.VITE_E2E` string checks.
export const IS_E2E = import.meta.env.VITE_E2E === 'true'
