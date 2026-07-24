---
title: 'Phase 0 · Foundations — implementation plan'
description: Scaffold the bun + Cargo monorepo, the Rokkit design system (packages/ui), the swappable data layer (packages/core on the Kavach Supabase adapter), link the gateway + kavach stepping-stones, and boot both apps (admin web + desktop) on a shared shell + skin.
type: plan
status: plan
created: 2026-07-06
depends_on:
  - docs/design/clients-buildout.md
references:
  - docs/modules/W4-design-system.md
  - docs/modules/W1-admin-portal.md
  - docs/modules/D1-desktop-shell.md
  - docs/mockups/app/zs.css
  - docs/mockups/app/shell.jsx
milestone: Phase-0
---

# Phase 0 · Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Consult the **rokkit skills** (`rokkit-components`, `semantic-styles-rokkit`, `skin-system-rokkit`, `command-system-rokkit`) at the Rokkit steps and the **svelte** MCP/skills for any `.svelte` file.

**Goal:** Stand up the Strategos monorepo so both front-of-house apps (web **Admin** + desktop **Member Console** client) boot on a shared Rokkit design system and a swappable data layer, with the `gateway` crates and `kavach` linked dev-in-place — the foundation every later phase builds on.

**Architecture:** A `bun` workspace (`apps/*`, `packages/*`, `services/*`) plus a Cargo workspace (`services/gateway`, `apps/desktop/src-tauri`) that `[patch]`-es the sibling `gateway/` engine repo. `packages/ui` ports the mockups' Zen-Sumi visual language onto Rokkit (UnoCSS `presetRokkit` + a skin); `packages/core` exposes a `DataSource` interface with a mock adapter (seeded from the mockups) and a real adapter built on the Kavach Supabase adapter. `apps/admin` (SvelteKit → Cloudflare, kavach hybrid auth) and `apps/desktop` (SvelteKit static + Tauri 2 shell) both render a shared `AppShell`.

**Tech Stack:** bun · SvelteKit 2.55 / Svelte 5.55 · Vite 8 · UnoCSS 66 + `@rokkit/unocss` `presetRokkit` · Rokkit (`@rokkit/*`, bun-linked) · Kavach (`kavach`, `@kavach/*`, bun-linked) · `@supabase/supabase-js` · Tauri 2 (Rust) · the `sensei-*` gateway crates (`v0.4.6`, git-pinned + path-patched for dev; consumed only from Phase 1b/2a onward) · Vitest · Playwright.

**Prerequisites (verify before Task 1):**

- The sibling repos exist: `~/Developer/strategos/gateway` (the shared `sensei-*` engine repo — checked out at tag `v0.4.6`; **sibling of `monorepo/`**, hence the `../gateway` `[patch]` path in Task 1), `~/Developer/kavach`, and the Rokkit repo (the source of `@rokkit/*`).
- `bun`, Rust stable + `cargo`, and the Tauri 2 system deps are installed.
- A Supabase project / local stack is reachable. `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_ANON_KEY` are known (see `.env.local` at the strategos repo root). **Schema note:** Phase 0's default data path is the **mock** adapter; the Supabase adapter is a stub read (Task 4 Step 8). The `models` table it reads — and every privileged table — is reshaped by **F1-rework (P3)** per `DECISIONS.md §5` (role/permission matrix, `router_credentials`, `similarity_search`→`vector(1024)`, consolidated `inference_calls`). Do **not** harden or depend on the current insecure F1 schema in P0; the real data layer lands after P3.

> **Crate reality (MIG-1, per `DECISIONS.md §3` + `gateway-issues.md`):** the engine is the six `sensei-*` crates at `v0.4.6` — `sensei-kernel`, `sensei-gateway`, `sensei-cloud-providers`, `sensei-local-engine`, `sensei-local-providers`, `sensei-kokoro`. There is **no** `gateway-embedded` crate and **no** `InferenceAdapter` type (deleted → capability-segregated traits `ChatModel`/`EmbedModel`/…). The desktop local plane is **in-process** (`sensei-local-providers::EmbeddedLlamaAdapter` / `OrtAdapter`, GGUF, **no daemon** — *not* "embedded Ollama"). P0 only wires the `[patch]` scaffolding (Task 1); the engine crates are first consumed in P1b (desktop embedded) / P2a (`services/gateway`).

**Working branch:** `develop` (per project branch strategy — never work on `main`). Commit after each task.

---

## File structure (created in this phase)

```
monorepo/
  package.json                     # bun workspace root (apps/*, packages/*, services/*)
  bunfig.toml                      # bun config (linkWorkspacePackages)
  tsconfig.base.json               # shared TS config
  Cargo.toml                       # Rust workspace + [patch] → ../gateway/crates/*
  .gitignore                       # + node_modules, .svelte-kit, target, build
  packages/
    ui/
      package.json
      uno.config.js                # presetRokkit(rokkit.config)
      rokkit.config.js             # Zen-Sumi → Rokkit palette/skin/tokens
      src/app.css                  # Rokkit theme imports + Zen-Sumi token layer
      src/index.js                 # re-exports Rokkit + Strategos atoms
      src/lib/Pill.svelte          # first migrated atom (has test)
      src/lib/Pill.spec.svelte.js
      src/lib/ExecBadge.svelte     # split-plane badge atom (has test)
      src/lib/ExecBadge.spec.svelte.js
      src/lib/AppShell.svelte      # shared shell (title bar + nav rail + slot)
      src/lib/AppShell.spec.svelte.js
    core/
      package.json
      src/index.ts
      src/types.ts                 # DataSource interface + zod schemas
      src/mock/index.ts            # mock adapter seeded from mockups
      src/mock/fixtures.ts         # MODELS/ROUTERS/... fixtures
      src/supabase/index.ts        # real adapter on the Kavach Supabase adapter
      src/types.spec.ts
      src/mock/mock.spec.ts
  apps/
    admin/                         # SvelteKit → Cloudflare, kavach hybrid auth
      package.json svelte.config.js vite.config.js uno.config.js rokkit.config.js
      kavach.config.js src/hooks.server.js src/app.html src/app.css
      src/routes/+layout.server.ts src/routes/+layout.svelte
      src/routes/(app)/+layout.svelte src/routes/(app)/+page.svelte
      .env
    desktop/                       # SvelteKit static + Tauri 2 shell
      package.json svelte.config.js vite.config.js uno.config.js rokkit.config.js
      src/app.html src/app.css src/routes/+layout.ts src/routes/+layout.svelte
      src/routes/+page.svelte
      src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/build.rs
      src-tauri/src/main.rs src-tauri/src/lib.rs
      .env
```

> **Atom scope (YAGNI):** migrate only the atoms the shell needs to boot (`Pill`, `ExecBadge`, `AppShell`). The remaining ~27 mockup atoms are migrated in later phases as the screens that use them are built.

---

## Task 1: Monorepo workspace skeleton

**Files:**

- Create: `package.json`, `bunfig.toml`, `tsconfig.base.json`, `Cargo.toml`
- Modify: `.gitignore`

- [ ] **Step 1: Create the bun workspace root `package.json`**

```json
{
  "name": "strategos-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.10",
  "workspaces": ["packages/*", "apps/*", "services/*"],
  "scripts": {
    "dev:admin": "bun run --filter @strategos/admin dev",
    "dev:desktop": "bun run --filter @strategos/desktop dev",
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test",
    "lint": "bun run --filter '*' lint",
    "check": "bun run --filter '*' check"
  }
}
```

- [ ] **Step 2: Create `bunfig.toml`**

```toml
[install]
linkWorkspacePackages = true
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Create the Rust workspace `Cargo.toml` with the engine patch**

```toml
[workspace]
members = ["services/gateway", "apps/desktop/src-tauri"]
resolver = "2"

# Dev-in-place against the sibling `sensei-*` engine repo (production consumes the pinned
# git tag `v0.4.6` from https://github.com/sensei-hq/gateway; this [patch] redirects those
# git deps to the local checkout while developing). Package names are `sensei-*`; the crate
# DIRS under crates/ are unprefixed (kernel, gateway, cloud-providers, …). There is NO
# `gateway-embedded` and NO `InferenceAdapter` (MIG-1 / DECISIONS §3). kokoro (TTS) is not
# consumed by Strategos v1 — omit it.
[patch."https://github.com/sensei-hq/gateway"]
sensei-kernel          = { path = "../gateway/crates/kernel" }
sensei-gateway         = { path = "../gateway/crates/gateway" }
sensei-cloud-providers = { path = "../gateway/crates/cloud-providers" }
sensei-local-engine    = { path = "../gateway/crates/local-engine" }
sensei-local-providers = { path = "../gateway/crates/local-providers" }

[profile.release]
opt-level = 3
lto = "thin"
strip = true
```

> Note: `members` reference dirs created in Tasks 4/6/later. Until they exist, do NOT run a workspace-wide `cargo build` (it will error on missing members). Task 6 adds `apps/desktop/src-tauri`. `services/gateway` lands in the Phase 2a plan — leave it in `members` only once created; for Phase 0, comment out the `services/gateway` line.
>
> **`[patch]` is dormant in P0.** No Phase-0 member depends on a `sensei-*` crate yet (the desktop `src-tauri` is a bare Tauri app in P0; the engine is wired in P1b, and `services/gateway` in P2a). `cargo` will therefore emit an *"unused [patch]"* warning — this is expected in P0 and is not a failure. The patch keying (git URL ⇄ `sensei-*` package names) is validated for real when P1b/P2a first add the dependency (MIG-3). Keep the `[patch]` block in place so those phases inherit it.

Adjust the members list for Phase 0:

```toml
members = ["apps/desktop/src-tauri"]
# "services/gateway" added in the Phase 2 plan
```

- [ ] **Step 5: Extend `.gitignore`**

Append:

```gitignore
# JS / SvelteKit
node_modules/
.svelte-kit/
build/
dist/
.vercel/
.wrangler/

# Rust / Tauri
target/

# env
.env
.env.*
!.env.example
```

- [ ] **Step 6: Verify the workspace resolves**

Run: `bun install`
Expected: completes without error; creates `bun.lock`. (No workspace members yet beyond the root, so it installs nothing but validates the manifest.)

- [ ] **Step 7: Commit**

```bash
git add package.json bunfig.toml tsconfig.base.json Cargo.toml .gitignore bun.lock
git commit -m "chore(phase0): monorepo workspace skeleton (bun + cargo, engine patch)"
```

---

## Task 2: Link the stepping-stones (rokkit + kavach)

**Files:** none (registers bun links). Documents the dev prerequisite.

- [ ] **Step 1: Register the Rokkit packages as bun links**

In the Rokkit repo (the source of `@rokkit/*`), from each published package dir, `bun link` registers it globally. Do this once per machine:

Run (from the rokkit repo root):

```bash
for p in core states actions unocss themes ui app data forms blocks; do \
  (cd "packages/$p" 2>/dev/null && bun link) ; done
```

Expected: each prints `Success! Registered "@rokkit/<name>"`. (Adjust the dir list to the repo's actual package layout; the required set for Phase 0 is `core states actions unocss themes ui app`.)

- [ ] **Step 2: Register the Kavach packages as bun links**

Run (from `~/Developer/kavach`):

```bash
for p in auth adapter-supabase logger ui vite query cookie sentry; do \
  (cd "packages/$p" 2>/dev/null || cd "adapters/$p" 2>/dev/null; [ -f package.json ] && bun link) ; done
```

Expected: registers `kavach`, `@kavach/adapter-supabase`, `@kavach/logger`, `@kavach/ui`, `@kavach/vite`, `@kavach/sentry`, etc. (The core package's name is `kavach`; confirm each `bun link` prints the expected registered name.)

- [ ] **Step 3: Record the prerequisite**

Create `docs/plans/phase-0-prereqs.md` noting the exact `bun link` names required, so a fresh clone can reproduce the linked dev environment. (Consumers reference these via `"@rokkit/core": "link:@rokkit/core"` / `"kavach": "link:kavach"` in each app's `package.json`, matching `strategos_old`.)

- [ ] **Step 4: Commit**

```bash
git add docs/plans/phase-0-prereqs.md
git commit -m "docs(phase0): record rokkit + kavach bun-link prerequisites"
```

---

## Task 3: `packages/ui` — Rokkit design system foundation

**Files:**

- Create: `packages/ui/package.json`, `uno.config.js`, `rokkit.config.js`, `src/app.css`, `src/index.js`
- Test: `packages/ui/src/lib/Pill.svelte` + `packages/ui/src/lib/Pill.spec.svelte.js`

- [ ] **Step 1: Create `packages/ui/package.json`**

```json
{
  "name": "@strategos/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "svelte": "./src/index.js",
  "exports": {
    ".": { "svelte": "./src/index.js", "default": "./src/index.js" },
    "./app.css": "./src/app.css",
    "./uno.config": "./uno.config.js",
    "./rokkit.config": "./rokkit.config.js"
  },
  "scripts": {
    "test": "vitest run",
    "lint": "prettier --check . && eslint .",
    "check": "svelte-check"
  },
  "dependencies": {
    "@rokkit/core": "link:@rokkit/core",
    "@rokkit/states": "link:@rokkit/states",
    "@rokkit/actions": "link:@rokkit/actions",
    "@rokkit/ui": "link:@rokkit/ui",
    "@rokkit/app": "link:@rokkit/app",
    "@rokkit/themes": "link:@rokkit/themes",
    "@rokkit/unocss": "link:@rokkit/unocss"
  },
  "devDependencies": {
    "@testing-library/svelte": "^5.3.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@unocss/reset": "^66.6.7",
    "jsdom": "^29.0.1",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "unocss": "^66.6.7",
    "vite": "^8.0.3",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Read the real Zen-Sumi token values**

Run: `grep -nE "\-\-(paper|ink|accent|warning|success|danger|moss|sky)\b" docs/mockups/app/zs.css`
Expected: the oklch/hex values for each Zen-Sumi token. Record them — they are the source of truth for the skin.

- [ ] **Step 3: Create `packages/ui/rokkit.config.js`** (structure mirrors `strategos_old`; consult `semantic-styles-rokkit` for the extended-token / `overrides` mechanism to carry the exact Zen-Sumi values)

```js
// Zen-Sumi → Rokkit. paper = warm neutral surface, sumi = ink text, vermillion = single accent.
// Exact color values are ported from docs/mockups/app/zs.css (Step 2) via `overrides`.
export default {
  colors: {
    surface: 'stone', // washi paper / sumi ink neutral ramp
    primary: 'vermillion', // the single accent (custom palette, see overrides)
    secondary: 'sky'
  },
  skins: {
    'zen-sumi': { surface: 'stone', primary: 'vermillion', secondary: 'sky' }
  },
  // Extended tokens carry the mockup's classification + provider hues + exact accent.
  // See semantic-styles-rokkit for `tokens: 'extended'` + `overrides`.
  overrides: {
    // vermillion: { 500: 'oklch(... from zs.css --accent ...)', ... }
  },
  icons: {
    lucide: '@iconify-json/lucide/icons.json'
  }
}
```

- [ ] **Step 4: Create `packages/ui/uno.config.js`**

```js
import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'

export default defineConfig({
  presets: [presetRokkit(config)]
})
```

- [ ] **Step 5: Create `packages/ui/src/app.css`** (Rokkit theme layers + apply the skin; mirrors `strategos_old/apps/ui/src/app.css`)

```css
@import '@rokkit/themes/base.css';
@import '@unocss/reset/tailwind.css';
@import '@rokkit/themes/dist/base';
@import '@rokkit/themes/dist/rokkit';

@layer base {
  :root {
    --scroll-width: 0.5rem;
    @apply skin-zen-sumi;
  }
  html {
    height: 100%;
  }
  body {
    @apply flex h-full w-full flex-col;
  }
  app {
    @apply bg-surface-z1 text-surface-z8 h-full w-full;
  }
}
```

- [ ] **Step 6: Write the failing test for the first atom (`Pill`)**

Create `packages/ui/src/lib/Pill.spec.svelte.js`:

```js
import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import Pill from './Pill.svelte'

test('Pill renders its label and tone class', () => {
  const { getByText } = render(Pill, { props: { label: 'Connected', tone: 'success' } })
  const el = getByText('Connected')
  expect(el).toBeTruthy()
  expect(el.closest('[data-pill]')?.getAttribute('data-tone')).toBe('success')
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd packages/ui && bun run test`
Expected: FAIL — `Cannot find module './Pill.svelte'`.

- [ ] **Step 8: Implement `packages/ui/src/lib/Pill.svelte`** (Svelte 5 runes; port the mockup `Pill` atom)

```svelte
<script>
  let { label, tone = 'ink', icon = null } = $props()
</script>

<span
  data-pill
  data-tone={tone}
  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
>
  {#if icon}<span class={`i-lucide:${icon} h-3 w-3`}></span>{/if}
  {label}
</span>
```

- [ ] **Step 9: Create the Vitest config + `src/index.js`**

Create `packages/ui/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: { environment: 'jsdom', include: ['src/**/*.spec.svelte.js'] }
})
```

Create `packages/ui/src/index.js`:

```js
export { default as Pill } from './lib/Pill.svelte'
```

Add `@sveltejs/vite-plugin-svelte` to devDependencies:

Run: `cd packages/ui && bun add -d @sveltejs/vite-plugin-svelte@^7.0.0`

- [ ] **Step 10: Run the test to verify it passes**

Run: `cd packages/ui && bun run test`
Expected: PASS (1 test).

- [ ] **Step 11: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): Rokkit design-system foundation (Zen-Sumi skin + Pill atom)"
```

---

## Task 4: `packages/core` — swappable data layer

**Files:**

- Create: `packages/core/package.json`, `src/index.ts`, `src/types.ts`, `src/mock/fixtures.ts`, `src/mock/index.ts`, `src/supabase/index.ts`
- Test: `src/mock/mock.spec.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@strategos/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "lint": "prettier --check . && eslint .",
    "check": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@kavach/adapter-supabase": "link:@kavach/adapter-supabase",
    "@supabase/supabase-js": "^2.101.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: Define the `DataSource` interface + zod schemas in `src/types.ts`**

```ts
import { z } from 'zod'

export const ModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  route: z.string(),
  tier: z.enum(['frontier', 'balanced', 'fast', 'local']),
  price: z.number(),
  context: z.number(),
  localCapable: z.boolean().default(false)
})
export type Model = z.infer<typeof ModelSchema>

// One narrow read surface per entity; grows as screens need it. Adapters implement this.
export interface DataSource {
  listModels(): Promise<Model[]>
}
```

- [ ] **Step 3: Write the failing test for the mock adapter**

Create `packages/core/src/mock/mock.spec.ts`:

```ts
import { expect, test } from 'vitest'
import { createMockDataSource } from './index'
import { ModelSchema } from '../types'

test('mock data source returns validated models seeded from the mockups', async () => {
  const ds = createMockDataSource()
  const models = await ds.listModels()
  expect(models.length).toBeGreaterThan(0)
  // every row conforms to the schema
  for (const m of models) expect(() => ModelSchema.parse(m)).not.toThrow()
  expect(models.some((m) => m.localCapable)).toBe(true)
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd packages/core && bun run test`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 5: Create the fixtures in `src/mock/fixtures.ts`** (seed from `docs/mockups/app/data.jsx` MODELS)

```ts
import type { Model } from '../types'

export const MODELS: Model[] = [
  {
    id: 'claude-opus',
    provider: 'anthropic',
    route: 'anthropic',
    tier: 'frontier',
    price: 15,
    context: 200000,
    localCapable: false
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    route: 'openai',
    tier: 'balanced',
    price: 5,
    context: 128000,
    localCapable: false
  },
  {
    // Desktop local plane = in-process embedded engine (EmbeddedLlamaAdapter, GGUF, no daemon).
    // `route: 'embedded'` reflects that — NOT an external Ollama HTTP daemon (MIG-4 / DECISIONS §3).
    id: 'gemma-2b',
    provider: 'local',
    route: 'embedded',
    tier: 'local',
    price: 0,
    context: 8192,
    localCapable: true
  }
]
```

> Replace/extend with the real rows from `docs/mockups/app/data.jsx` during implementation (keep the shape). If a mockup row labels a local model's route as `ollama`, normalize it to `embedded` — the v1 desktop local path is in-process (`sensei-local-providers`), not an Ollama daemon. (`sensei-cloud-providers::OllamaAdapter` — Ollama over HTTP to a running server — is a separate router option, not the desktop-embedded plane.)

- [ ] **Step 6: Implement the mock adapter in `src/mock/index.ts`**

```ts
import type { DataSource } from '../types'
import { MODELS } from './fixtures'

export function createMockDataSource(): DataSource {
  return {
    async listModels() {
      return structuredClone(MODELS)
    }
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/core && bun run test`
Expected: PASS (1 test).

- [ ] **Step 8: Implement the real adapter stub in `src/supabase/index.ts`** (on the Kavach Supabase adapter)

```ts
import { getActions } from '@kavach/adapter-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ModelSchema, type DataSource } from '../types'

// Real reads go through the kavach adapter's PostgREST actions (RLS enforced by Postgres).
export function createSupabaseDataSource(client: SupabaseClient): DataSource {
  const actions = getActions(client)
  return {
    async listModels() {
      const { data } = await actions.get('models', { columns: '*' })
      return (data ?? []).map((row) => ModelSchema.parse(row))
    }
  }
}
```

- [ ] **Step 9: Export the public surface in `src/index.ts`**

```ts
export * from './types'
export { createMockDataSource } from './mock/index'
export { createSupabaseDataSource } from './supabase/index'
```

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "feat(core): swappable DataSource — mock + kavach-supabase adapters (models)"
```

---

## Task 5: `apps/admin` — SvelteKit web app booting the shared shell

**Files:** create the full SvelteKit app under `apps/admin/` (see file structure). Auth uses the kavach hybrid wiring (works OOB with a server).

- [ ] **Step 1: Create `apps/admin/package.json`**

```json
{
  "name": "@strategos/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 5273",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-kit sync && svelte-check",
    "lint": "prettier --check . && eslint ."
  },
  "dependencies": {
    "@strategos/ui": "workspace:*",
    "@strategos/core": "workspace:*",
    "kavach": "link:kavach",
    "@kavach/adapter-supabase": "link:@kavach/adapter-supabase",
    "@kavach/logger": "link:@kavach/logger",
    "@kavach/ui": "link:@kavach/ui",
    "@kavach/vite": "link:@kavach/vite",
    "@kavach/sentry": "link:@kavach/sentry",
    "@supabase/supabase-js": "^2.101.1",
    "@rokkit/states": "link:@rokkit/states",
    "@rokkit/actions": "link:@rokkit/actions",
    "@rokkit/app": "link:@rokkit/app",
    "@rokkit/ui": "link:@rokkit/ui"
  },
  "devDependencies": {
    "@sveltejs/adapter-cloudflare": "^7.0.0",
    "@sveltejs/kit": "^2.55.0",
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "unocss": "^66.6.7",
    "@unocss/reset": "^66.6.7",
    "vite": "^8.0.3"
  }
}
```

- [ ] **Step 2: Config files** — create `svelte.config.js`, `uno.config.js`, `rokkit.config.js`, `vite.config.js`

`apps/admin/svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-cloudflare'
export default { kit: { adapter: adapter() } }
```

`apps/admin/rokkit.config.js`:

```js
export { default } from '@strategos/ui/rokkit.config'
```

`apps/admin/uno.config.js`:

```js
import { defineConfig } from 'unocss'
import { presetRokkit } from '@rokkit/unocss'
import config from './rokkit.config.js'
export default defineConfig({ presets: [presetRokkit(config)] })
```

`apps/admin/vite.config.js` (kavach first, per the demo):

```js
import { kavach } from '@kavach/vite'
import { sveltekit } from '@sveltejs/kit/vite'
import unocss from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [kavach(), unocss(), sveltekit()],
  optimizeDeps: { exclude: ['@rokkit/app', '@rokkit/ui', '@rokkit/states', '@rokkit/actions'] }
})
```

- [ ] **Step 3: Create `apps/admin/kavach.config.js`** (Supabase adapter + admin route rules — private by default)

```js
export default {
  adapter: 'supabase',
  env: { url: 'PUBLIC_SUPABASE_URL', anonKey: 'PUBLIC_SUPABASE_ANON_KEY' },
  providers: [
    { name: 'google', label: 'Continue with Google' },
    { mode: 'password', name: 'password', label: 'Email & password' }
  ],
  logging: { level: 'error', table: 'audit_events' },
  routes: { auth: '/auth', data: '/data', logout: '/logout', home: '/' },
  rules: [
    { path: '/auth', public: true },
    { path: '/', public: true } // Phase 0: shell boots publicly. Phase 1a tightens to roles:'*' + a real /auth page.
  ]
}
```

> **Auth alignment (DECISIONS §2 W3/W4, §3 F2).** P0 is a **public shell boot only** — no login, no JWT verification, no provider keys. Do not add server-side JWT checks here. The gating/auth ladder: **P1a** wires the Kavach client-only session + route guard (email + Google/GitHub OAuth login); **P2a (C1)** introduces JWT verification, which is **RS256/JWKS verify-only** against the Supabase JWKS endpoint — **never a shared HS256 secret** (front-loaded human input: confirm/enable asymmetric signing + `SUPABASE_JWT_*` before P2a). Real BYOK/OAuth **provider** keys are gated behind the **F3 vault (P4)** — the "F3-before-real-keys" build gate (§2 W4); no P0–P2 phase holds plaintext provider credentials. Keep P0's `logging.table: 'audit_events'` as-is, but note F1-rework (P3) binds `audit_events.actor_id` and makes it `service_role`/gateway-emitted (§2) — P0's client-side audit writes are placeholder-only.

- [ ] **Step 4: Create `apps/admin/src/hooks.server.js`** and `src/app.html`

`src/hooks.server.js`:

```js
import { kavach } from '$kavach/auth'
export const handle = ({ event, resolve }) => kavach.handle({ event, resolve })
```

`src/app.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <app data-style="rokkit" class="flex size-full flex-col overflow-hidden">%sveltekit.body%</app>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/admin/src/app.css`** (re-export the shared token layer)

```css
@import '@strategos/ui/app.css';
```

- [ ] **Step 6: Create the layout + a home route rendering the shared shell**

`src/routes/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types'
export const load: LayoutServerLoad = ({ locals }) => ({
  session: locals.session,
  user: locals.session?.user ?? null
})
```

`src/routes/+layout.svelte`:

```svelte
<script>
  import 'uno.css'
  import '../app.css'
  import { vibe } from '@rokkit/states'
  import { themable } from '@rokkit/actions'
  let { children } = $props()
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'strategos-admin-theme' }} />
{@render children()}
```

`src/routes/(app)/+layout.svelte`:

```svelte
<script>
  import { setContext, onMount } from 'svelte'
  import { page } from '$app/state'
  import { invalidateAll } from '$app/navigation'
  let { children } = $props()
  const kavach = $state({})
  setContext('kavach', kavach)
  onMount(async () => {
    const { createKavach } = await import('kavach')
    const { adapter, logger } = await import('$kavach/auth')
    Object.assign(kavach, createKavach(adapter, { logger, invalidateAll }))
    kavach.onAuthChange(page.url)
  })
</script>

{@render children()}
```

`src/routes/(app)/+page.svelte`:

```svelte
<script>
  import { AppShell } from '@strategos/ui'
</script>

<AppShell app="admin" title="Overview">
  <p class="p-4 text-surface-z6">Strategos Admin — shell booted.</p>
</AppShell>
```

- [ ] **Step 7: Create `apps/admin/.env`** (local dev; git-ignored)

```bash
PUBLIC_SUPABASE_URL=<from repo .env.local>
PUBLIC_SUPABASE_ANON_KEY=<from repo .env.local>
```

- [ ] **Step 8: Install and boot**

Run: `bun install`
Then: `bun run --filter @strategos/admin dev`
Expected: Vite serves on `http://localhost:5273`; the page renders the `AppShell` with the Zen-Sumi skin (paper background, ink text). No console errors from kavach/rokkit resolution.

- [ ] **Step 9: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): SvelteKit app boots shared shell + skin (kavach hybrid auth wired)"
```

> `AppShell` is created in Task 7; if executing strictly in order, do Task 7 before Step 8's render check (or stub `AppShell` to a `<div><slot/></div>` and replace in Task 7). Recommended order: Task 3 → 7 → 4 → 5 → 6.

---

## Task 6: `apps/desktop` — SvelteKit static + Tauri 2 shell

**Files:** create `apps/desktop/` SvelteKit (static adapter, SPA) + `src-tauri/` Tauri 2 project (added to the Cargo workspace).

- [ ] **Step 1: Create `apps/desktop/package.json`**

```json
{
  "name": "@strategos/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 5274",
    "build": "vite build",
    "tauri": "tauri",
    "check": "svelte-kit sync && svelte-check",
    "lint": "prettier --check . && eslint ."
  },
  "dependencies": {
    "@strategos/ui": "workspace:*",
    "@strategos/core": "workspace:*",
    "@rokkit/states": "link:@rokkit/states",
    "@rokkit/actions": "link:@rokkit/actions",
    "@rokkit/app": "link:@rokkit/app",
    "@rokkit/ui": "link:@rokkit/ui"
  },
  "devDependencies": {
    "@sveltejs/adapter-static": "^3.0.0",
    "@sveltejs/kit": "^2.55.0",
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@tauri-apps/cli": "^2.0.0",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "unocss": "^66.6.7",
    "@unocss/reset": "^66.6.7",
    "vite": "^8.0.3"
  }
}
```

- [ ] **Step 2: SvelteKit static config (SPA for Tauri)**

`apps/desktop/svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-static'
export default { kit: { adapter: adapter({ fallback: 'index.html' }) } }
```

`apps/desktop/src/routes/+layout.ts`:

```ts
export const ssr = false
export const prerender = false
```

`apps/desktop/vite.config.js` (no kavach vite plugin yet — client-only auth lands in Phase 1):

```js
import { sveltekit } from '@sveltejs/kit/vite'
import unocss from 'unocss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [unocss(), sveltekit()],
  clearScreen: false,
  server: { port: 5274, strictPort: true },
  optimizeDeps: { exclude: ['@rokkit/app', '@rokkit/ui', '@rokkit/states', '@rokkit/actions'] }
})
```

`apps/desktop/uno.config.js`, `rokkit.config.js`, `src/app.html`, `src/app.css` — identical to the admin versions (Task 5 Steps 2, 4, 5), with `storageKey: 'strategos-desktop-theme'`.

- [ ] **Step 3: Layout + home route (shared shell, desktop chrome)**

`apps/desktop/src/routes/+layout.svelte`:

```svelte
<script>
  import 'uno.css'
  import '../app.css'
  import { vibe } from '@rokkit/states'
  import { themable } from '@rokkit/actions'
  let { children } = $props()
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'strategos-desktop-theme' }} />
{@render children()}
```

`apps/desktop/src/routes/+page.svelte`:

```svelte
<script>
  import { AppShell } from '@strategos/ui'
</script>

<AppShell app="console" title="Workspace">
  <p class="p-4 text-surface-z6">Strategos Console — desktop shell booted.</p>
</AppShell>
```

- [ ] **Step 4: Initialize Tauri 2 into `src-tauri/`**

Run: `cd apps/desktop && bunx @tauri-apps/cli@2 init --ci \
  --app-name strategos --window-title Strategos \
  --frontend-dist ../build --dev-url http://localhost:5274 \
  --before-dev-command "" --before-build-command ""`
Expected: creates `apps/desktop/src-tauri/` with `Cargo.toml`, `tauri.conf.json`, `src/main.rs`, `src/lib.rs`, `build.rs`.

- [ ] **Step 5: Wire `src-tauri` into the Cargo workspace (no engine deps in P0)**

Edit `apps/desktop/src-tauri/Cargo.toml` to inherit the workspace — for Phase 0, **do not add any `sensei-*` engine deps yet**; keep it a bare Tauri app that compiles as a member. (The embedded engine deps — `sensei-local-providers`/`sensei-local-engine` at the `v0.4.6` git tag, resolved through the root `[patch]` — are added in **P1b** per MIG-3, not here.) Confirm `apps/desktop/src-tauri` is listed in the root `Cargo.toml` `members` (Task 1 Step 4).

Run: `cargo build -p strategos` (the src-tauri crate name from `tauri init`)
Expected: compiles (a bare Tauri app, no custom commands yet).

- [ ] **Step 6: Boot the web frontend (Tauri window is optional in Phase 0)**

Run: `bun install && bun run --filter @strategos/desktop dev`
Expected: Vite serves on `http://localhost:5274`; renders `AppShell` with the Zen-Sumi skin.

Optional native window: `bun run --filter @strategos/desktop tauri dev` → a Tauri window loading the same UI.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop Cargo.toml
git commit -m "feat(desktop): SvelteKit static + Tauri 2 shell boots shared shell + skin"
```

---

## Task 7: Shared `AppShell` + `ExecBadge` in `packages/ui`

**Files:**

- Create: `packages/ui/src/lib/ExecBadge.svelte` (+ spec), `packages/ui/src/lib/AppShell.svelte` (+ spec)
- Modify: `packages/ui/src/index.js`

- [ ] **Step 1: Write the failing test for `ExecBadge`**

Create `packages/ui/src/lib/ExecBadge.spec.svelte.js`:

```js
import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import ExecBadge from './ExecBadge.svelte'

test('ExecBadge shows on-device text for the local plane', () => {
  const { getByText } = render(ExecBadge, { props: { plane: 'local' } })
  expect(getByText(/on your device/i)).toBeTruthy()
})

test('ExecBadge shows the region for the cloud plane', () => {
  const { getByText } = render(ExecBadge, { props: { plane: 'cloud', region: 'eu-west-2' } })
  expect(getByText(/via gateway · eu-west-2/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/ui && bun run test`
Expected: FAIL — `Cannot find module './ExecBadge.svelte'`.

- [ ] **Step 3: Implement `ExecBadge.svelte`** (port the mockup atom)

```svelte
<script>
  let { plane, region = '' } = $props()
  const local = $derived(plane === 'local')
</script>

<span
  data-exec-badge
  data-plane={plane}
  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-surface-z6"
>
  <span class={local ? 'i-lucide:cpu h-3 w-3' : 'i-lucide:cloud h-3 w-3'}></span>
  {local ? 'on your device' : `via gateway · ${region}`}
</span>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/ui && bun run test`
Expected: PASS (3 tests total).

- [ ] **Step 5: Write the failing test for `AppShell`**

Create `packages/ui/src/lib/AppShell.spec.svelte.js`:

```js
import { render } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import AppShell from './AppShell.svelte'

test('AppShell renders the title and the nav rail landmark', () => {
  const { getByText, getByRole } = render(AppShell, { props: { app: 'admin', title: 'Overview' } })
  expect(getByText('Overview')).toBeTruthy()
  expect(getByRole('navigation')).toBeTruthy()
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/ui && bun run test`
Expected: FAIL — `Cannot find module './AppShell.svelte'`.

- [ ] **Step 7: Implement `AppShell.svelte`** (title bar + nav rail + content slot; nav items differ by `app`)

```svelte
<script>
  let { app = 'admin', title = '', children } = $props()
  const NAV = {
    admin: [
      'Overview',
      'Requests',
      'Organization',
      'Models',
      'Routing',
      'Connections',
      'Governance',
      'Billing',
      'Settings'
    ],
    console: ['Workspace', 'Ask', 'Library', 'Playground', 'Workflows', 'Activity', 'Settings']
  }
  const items = $derived(NAV[app] ?? [])
</script>

<div data-app-shell class="grid h-full grid-cols-[13rem_1fr]">
  <nav
    aria-label="Primary"
    class="flex flex-col gap-1 border-r border-surface-z3 bg-surface-z1 p-3"
  >
    <div class="mb-3 text-sm font-semibold text-primary-500">Strategos</div>
    {#each items as item}
      <a
        href={`#${item.toLowerCase()}`}
        class="rounded px-2 py-1 text-sm text-surface-z6 hover:bg-surface-z2">{item}</a
      >
    {/each}
  </nav>
  <section class="flex h-full flex-col">
    <header class="flex items-center border-b border-surface-z3 px-4 py-3">
      <h1 class="text-base font-medium text-surface-z8">{title}</h1>
    </header>
    <div class="flex-1 overflow-auto">{@render children?.()}</div>
  </section>
</div>
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd packages/ui && bun run test`
Expected: PASS (4 tests total).

- [ ] **Step 9: Export both from `src/index.js`**

```js
export { default as Pill } from './lib/Pill.svelte'
export { default as ExecBadge } from './lib/ExecBadge.svelte'
export { default as AppShell } from './lib/AppShell.svelte'
```

- [ ] **Step 10: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): shared AppShell + ExecBadge atoms"
```

---

## Task 7.5: E2E Playwright harness + shell smoke tests

Desktop uses the **Tauri socket harness** (`@srsholmes/tauri-playwright` + `tauri-plugin-playwright`, per the `tauri-playwright-testing` skill and the Sensei app at `~/Developer/sensei-hq/sensei/app/e2e`). Admin uses **web-mode Playwright**. Strategos has no separate daemon, so the desktop globalSetup is build → spawn → wait-for-socket → assert (no daemon-port / DB-isolation checks).

### Desktop (Tauri)

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/package.json`
- Create: `apps/desktop/e2e/{playwright.config.ts,globalSetup.ts,globalTeardown.ts,fixtures.ts,helpers.ts,tests/shell.spec.ts}`

- [ ] **Step 1: Add the `e2e-testing` feature + plugin to `src-tauri/Cargo.toml`**

```toml
[features]
e2e-testing = ["dep:tauri-plugin-playwright"]

[dependencies]
tauri-plugin-playwright = { version = "0.2", optional = true }
```

- [ ] **Step 2: Init the plugin only under the feature** — in `src-tauri/src/lib.rs`, where the Tauri `Builder` is constructed (before `.run(...)`):

```rust
#[cfg(feature = "e2e-testing")]
let builder = builder.plugin(tauri_plugin_playwright::init());
```

- [ ] **Step 3: Add devDeps + script to `apps/desktop/package.json`**

```json
"scripts": { "test:e2e": "playwright test --config e2e/playwright.config.ts --project=tauri" },
"devDependencies": {
  "@playwright/test": "^1.59.1",
  "@srsholmes/tauri-playwright": "^0.2.2"
}
```

- [ ] **Step 4: `apps/desktop/e2e/playwright.config.ts`**

```ts
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
```

- [ ] **Step 5: `apps/desktop/e2e/fixtures.ts`**

```ts
import { createTauriTest } from '@srsholmes/tauri-playwright'

export const { test, expect } = createTauriTest({
  devUrl: 'tauri://localhost', // required by the type; unused in socket mode
  mcpSocket: '/tmp/tauri-playwright.sock'
})
```

- [ ] **Step 6: `apps/desktop/e2e/globalSetup.ts`** (build with the feature, spawn, wait for socket)

```ts
import { execFileSync, spawn } from 'child_process'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const APP_REPO = resolve(__dirname, '..')
// Adjust the bundle name if tauri.conf.json productName differs.
const APP_BINARY = join(
  APP_REPO,
  'src-tauri/target/debug/bundle/macos/strategos.app/Contents/MacOS/strategos'
)
const SOCKET = '/tmp/tauri-playwright.sock'
const PID_FILE = '/tmp/strategos-e2e-pid'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForSocket(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${path}`)
}

export default async function globalSetup() {
  // Build the e2e bundle (frontend + Rust). First run compiles Rust — slow.
  execFileSync('bunx', ['tauri', 'build', '--debug', '--features', 'e2e-testing'], {
    cwd: APP_REPO,
    stdio: 'inherit'
  })
  try {
    execFileSync('/usr/bin/pkill', ['-f', 'strategos.app'], { stdio: 'ignore' })
  } catch {}
  await sleep(500)
  try {
    unlinkSync(SOCKET)
  } catch {}
  const proc = spawn(APP_BINARY, [], { detached: true, stdio: 'ignore' })
  await new Promise((res, rej) => {
    proc.once('error', rej)
    proc.once('spawn', res)
  })
  proc.unref()
  writeFileSync(PID_FILE, String(proc.pid))
  await waitForSocket(SOCKET, 60_000)
}
```

- [ ] **Step 7: `apps/desktop/e2e/globalTeardown.ts`**

```ts
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'

const PID_FILE = '/tmp/strategos-e2e-pid'
const SOCKET = '/tmp/tauri-playwright.sock'

export default async function globalTeardown() {
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
    }
    unlinkSync(PID_FILE)
  }
  try {
    execFileSync('/usr/bin/pkill', ['-f', 'strategos.app'], { stdio: 'ignore' })
  } catch {}
  try {
    unlinkSync(SOCKET)
  } catch {}
}
```

- [ ] **Step 8: `apps/desktop/e2e/helpers.ts`** (WKWebView-safe navigation, from the skill)

```ts
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function navigateTo(tauriPage, route) {
  await tauriPage.evaluate(`
    (async function () {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const nav = await import('/node_modules/@sveltejs/kit/src/runtime/app/navigation.js')
        await nav.goto(${JSON.stringify(route)})
      } catch {
        const a = document.createElement('a')
        a.href = ${JSON.stringify(route)}
        document.body.appendChild(a)
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        document.body.removeChild(a)
      }
    })()
  `)
  await sleep(800)
}
```

- [ ] **Step 9: `apps/desktop/e2e/tests/shell.spec.ts`** (smoke: the Console shell renders)

```ts
import { test, expect } from '../fixtures'

test.describe('Desktop shell', () => {
  test('boots and renders the Console shell', async ({ tauriPage }) => {
    await expect(tauriPage.locator('[data-app-shell]')).toBeVisible({ timeout: 20_000 })
    await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
    const title = await tauriPage.locator('header h1').textContent()
    expect(title).toContain('Workspace')
  })
})
```

- [ ] **Step 10: Run the desktop E2E**

Run: `cd apps/desktop && bunx playwright install chromium && bun run test:e2e`
Expected: globalSetup builds the app (first run compiles Rust — minutes), launches it, the socket appears, the shell smoke test passes.

### Admin (web-mode)

**Files:** `apps/admin/playwright.config.ts`, `apps/admin/e2e/shell.spec.ts`, `apps/admin/package.json` (devDeps + script).

- [ ] **Step 11: devDeps + script in `apps/admin/package.json`**

```json
"scripts": { "test:e2e": "playwright test" },
"devDependencies": { "@playwright/test": "^1.59.1" }
```

- [ ] **Step 12: `apps/admin/playwright.config.ts`** (runs the dev server)

```ts
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
```

- [ ] **Step 13: `apps/admin/e2e/shell.spec.ts`** (unauthenticated → sign-in gate renders with the skin)

```ts
import { test, expect } from '@playwright/test'

test('admin boots and renders the shell with the Zen-Sumi skin', async ({ page }) => {
  await page.goto('/') // Phase 0: '/' is public → shell renders directly
  await expect(page.locator('app[data-style="rokkit"]')).toBeVisible()
  await expect(page.locator('[data-app-shell]')).toBeVisible()
})
```

> The admin dev server needs `apps/admin/.env` (Supabase URL + anon key) so the kavach vite plugin / hooks initialise. Locally that file exists (Task 5 Step 7); in CI it needs those as secrets. This is a render smoke test only — no real login (auth gating + the `/auth` sign-in page land in Phase 1).

- [ ] **Step 14: Run** `cd apps/admin && bunx playwright install chromium && bun run test:e2e`. Expected: dev server boots, smoke test passes.

- [ ] **Step 15: Commit**

```bash
git add apps/desktop/e2e apps/desktop/src-tauri apps/desktop/package.json apps/admin/e2e apps/admin/playwright.config.ts apps/admin/package.json
git commit -m "test(phase0): E2E Playwright — Tauri socket harness (desktop) + web smoke (admin)"
```

---

## Task 8: Phase-0 acceptance — both apps boot green

**Files:** none (verification + a short README).

- [ ] **Step 1: Full install + lint + test across the workspace**

Run: `bun install && bun run test && bun run lint`
Expected: all package tests pass; lint clean (zero-errors policy).

- [ ] **Step 2: Boot both apps and confirm the shared shell + skin**

Run (two terminals): `bun run dev:admin` and `bun run dev:desktop`
Expected: admin on `:5273`, desktop on `:5274`; both render `AppShell` with the Zen-Sumi skin and their own nav rails; no resolution errors for `@rokkit/*`, `@kavach/*`, `@strategos/*`.

- [ ] **Step 3: Confirm the desktop crate compiles in the workspace**

Run: `cargo build -p strategos`
Expected: success.

- [ ] **Step 4: Write `apps/README.md`** documenting: prerequisites (bun-linked rokkit + kavach), how to run each app, and the workspace layout. (Content: the "Prerequisites" + file-structure sections of this plan, condensed.)

- [ ] **Step 5: Commit**

```bash
git add apps/README.md
git commit -m "chore(phase0): acceptance — both apps boot on shared shell + skin; docs"
```

---

## Self-review notes (author)

- **Spec coverage:** Phase 0 of `clients-buildout.md` = bun+Cargo workspace (Task 1), design system Zen-Sumi→Rokkit + atoms + (palette) (Task 3, 7), `packages/core` swappable data layer on the kavach adapter (Task 4), kavach linked + route rules (Task 2, 5), both apps boot shared shell + skin (Tasks 5–8). Command palette (⌘K) and the full 30-atom migration are intentionally deferred to the phases whose screens need them (noted under "Atom scope").
- **Execution order:** build `packages/ui` atoms (Tasks 3 + 7) and `packages/core` (Task 4) before the apps (Tasks 5–6) that import them. The recommended order is 1 → 2 → 3 → 7 → 4 → 5 → 6 → 8.
- **Type consistency:** `AppShell` prop `app` takes `'admin' | 'console'` in both the component (Task 7) and the app pages (Tasks 5/6). `DataSource.listModels()` is the single method defined (Task 4) and consumed nowhere else yet.
- **Known implementer judgement calls (grounded, not placeholders):** the exact Zen-Sumi color values come from `docs/mockups/app/zs.css` (Task 3 Step 2) and the extended-token syntax from the `semantic-styles-rokkit` skill; the Rokkit package dir list for `bun link` (Task 2) is confirmed against the actual rokkit repo layout. These are "read the real source" steps, not TBDs.
