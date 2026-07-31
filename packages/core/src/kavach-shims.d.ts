// Typecheck-only stub for the @kavach/* framework (Jerry's kavach), published SOURCE-ONLY with
// NO bundled type declarations + untyped internals (ramda, extensionless ESM). Without a redirect,
// `tsc` resolves the imports into the dependency's own `.ts` source and errors on ITS internals
// (see docs/code-review.md H1). `tsconfig.json` `paths` maps the three modules core consumes to
// this file, so the typecheck stops here. RUNTIME is unaffected — bun (and vitest's inlined vite
// transform) resolve the real packages. The code already treats these APIs loosely (guard.ts casts
// the sentry shape to the real runtime). Upstream fix: republish @kavach/* with dist/*.d.ts, then
// drop this stub + the `paths` entries.
export const createSentry: (...args: any[]) => any
export const getAdapter: (...args: any[]) => any
export const getActions: (...args: any[]) => any
export const createKavach: (...args: any[]) => any
