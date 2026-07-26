---
title: 'Phase 1a · Desktop shell + Kavach client-only session — implementation plan'
description: Build the real desktop Member Console shell (title bar, nav rail, EnvChip, DeviceFooter, ⌘K palette) and the Kavach client-only session mode (sign-in, persisted session, client-side route protection) on the Phase-0 scaffold.
type: plan
status: plan
created: 2026-07-06
depends_on:
  - docs/design/clients-buildout.md
  - docs/plans/phase-0-foundations-plan.md
references:
  - docs/modules/D1-desktop-shell.md
  - docs/modules/F2-identity-auth-rbac.md
  - docs/modules/W2-member-console.md
  - docs/mockups/app/shell.jsx
  - docs/mockups/components/chrome.jsx
  - docs/mockups/app/view-signin.jsx
milestone: Phase-1a
---

# Phase 1a · Desktop shell + Kavach client-only session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. For `.svelte` files use the **svelte** skill/MCP; for the ⌘K palette use **command-system-rokkit**; for skins/tokens use **skin-system-rokkit**/**semantic-styles-rokkit** (remember: `data-skin` + named tokens, no `-z{n}`). For E2E use **tauri-playwright-testing** (the harness already exists at `apps/desktop/e2e`).

**Goal:** The Torii desktop client gets its real Member Console shell and working client-only authentication: an unauthenticated user lands on Sign-in; after signing in, the session persists across restarts and they see the shell (title bar + nav rail + device footer + ⌘K workspace palette) with the console routes gated behind the session — all in the Tauri SPA with no SvelteKit server.

**Architecture:** Auth is Kavach's **client-only session mode** (the first upstream kavach enhancement): a `supabase-js` client with `persistSession: true` wrapped by `@kavach/adapter-supabase`'s `getAdapter`, driven by `createKavach` on the client, with a runes `session.svelte.ts` store and a `@kavach/sentry` guard evaluated client-side (no `hooks.server`, no `/auth/session` endpoint). The shell chrome is ported from the mockups (`shell.jsx`/`chrome.jsx`) into `packages/ui` and composed in the desktop `(app)` layout; a `ToriiEnv`-style runes store drives desktop/offline/web gating.

**Tech Stack:** SvelteKit static (SPA) + Svelte 5 · `@supabase/supabase-js` (persistSession) · `kavach` + `@kavach/adapter-supabase` + `@kavach/sentry` + `@kavach/ui` · `@rokkit/states` (commands/vibe) + `@rokkit/actions` (shortcuts/themable) + `@rokkit/ui` (CommandPalette) · Tauri 2 · Playwright (existing harness).

**Prerequisites:** Phase 0 complete (`apps/desktop` boots the shared `AppShell`; `apps/desktop/.env` has `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` — reuse admin's values). Branch **develop**; commit after each task. Reuse the Task-0 conventions (bun, named Rokkit tokens, `data-skin`).

---

## File structure (created/modified in this phase)

```
packages/
  core/
    src/auth/
      client.ts               # createToriiKavach(): supabase(persistSession) + getAdapter + createKavach
      session.svelte.ts       # runes store: session/user/role, signIn/signOut, onAuthChange
      guard.ts                # createGuard(rules): client-side @kavach/sentry protect(path)
      auth.spec.ts
  ui/
    src/lib/
      EnvChip.svelte          # desktop/offline/web cycler (+ spec)
      DeviceFooter.svelte     # sync state · config version · local models · offline buffer (+ spec)
      OfflineBanner.svelte    # dismissible offline notice
      DesktopOnlyNote.svelte  # "needs the desktop app"
      TitleBar.svelte         # brand · EnvChip · search · theme · user menu
      NavRail.svelte          # brand+version · nav groups · DeviceFooter
      DesktopShell.svelte     # composes TitleBar + NavRail + ⌘K palette + content slot
      env.svelte.ts           # ToriiEnv runes store (mode + capabilities)
      commands.ts             # ⌘K command + workspace registry (@rokkit/states)
apps/desktop/
  src/routes/
    +layout.svelte            # (modified) themable + mount client kavach + guard redirect
    signin/+page.svelte       # Sign-in screen (@kavach/ui, ported from view-signin.jsx)
    (app)/+layout.svelte      # DesktopShell wrapper (guarded)
    (app)/+page.svelte        # Workspace placeholder (moves under (app))
    (app)/ask/+page.svelte    # placeholder (real Ask = Phase 1b)
    (app)/library/+page.svelte …  # placeholder routes for the console nav
  src/lib/env.ts              # supabase url/key from $env/static/public
  e2e/tests/auth-shell.spec.ts  # E2E: signin → shell; unauth → signin
```

> **Scope (YAGNI):** placeholder pages for the non-Ask console routes (Library/Playground/Workflows/Activity/Settings) are one-liners here; their real screens come in Phase 3. Ask's real implementation is Phase 1b — a placeholder here.

---

## Task 1: `packages/ui` — env + device atoms

**Files:** create `src/lib/env.svelte.ts`, `EnvChip.svelte`(+spec), `DeviceFooter.svelte`(+spec), `OfflineBanner.svelte`, `DesktopOnlyNote.svelte`; modify `src/index.js`.

- [ ] **Step 1: `src/lib/env.svelte.ts`** — the ToriiEnv runes store (ports `window.ToriiEnv`; modes desktop/offline/web)

```ts
// Capability/env state shared by the shell. Mirrors the mockups' ToriiEnv.
type Mode = 'desktop' | 'offline' | 'web'
const ORDER: Mode[] = ['desktop', 'offline', 'web']

class Env {
  mode = $state<Mode>('desktop')
  get desktop() { return this.mode === 'desktop' || this.mode === 'offline' }
  get web() { return this.mode === 'web' }
  get offline() { return this.mode === 'offline' }
  cycle() { this.mode = ORDER[(ORDER.indexOf(this.mode) + 1) % ORDER.length] }
  set(mode: Mode) { this.mode = mode }
}
export const env = new Env()
```

- [ ] **Step 2: failing test** `src/lib/EnvChip.spec.svelte.js`

```js
import { render, fireEvent } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import EnvChip from './EnvChip.svelte'

test('EnvChip shows the mode and cycles on click', async () => {
  const { getByRole, getByText } = render(EnvChip)
  expect(getByText(/desktop/i)).toBeTruthy()
  await fireEvent.click(getByRole('button'))
  expect(getByText(/offline/i)).toBeTruthy()
})
```

- [ ] **Step 3: run → FAIL**, then implement `src/lib/EnvChip.svelte`

```svelte
<script>
  import { env } from './env.svelte.js'
</script>
<button type="button" onclick={() => env.cycle()}
  data-env-chip data-mode={env.mode}
  class="inline-flex items-center gap-1 rounded-full border border-paper-edge px-2 py-0.5 text-xs text-ink-soft">
  <span class={env.offline ? 'i-lucide:cloud-off h-3 w-3' : env.web ? 'i-lucide:globe h-3 w-3' : 'i-lucide:monitor h-3 w-3'}></span>
  {env.mode}
</button>
```

- [ ] **Step 4: run → PASS.**

- [ ] **Step 5: `DeviceFooter.svelte`** (+ spec asserting it renders sync + model-count text). Props: `{ synced = true, configVersion = 0, localModels = 0, offlineBuffer = 0 }`. Renders a compact footer: `● synced · config v{configVersion}` (or `○ offline` when `env.offline`), `{localModels} on device`, and `{offlineBuffer} queued` when `offlineBuffer > 0`. Use named tokens (`text-ink-mute`, `bg-paper-mute`). Spec: `render(DeviceFooter, { props: { localModels: 2, configVersion: 412 } })` → asserts `2 on device` and `config v412` visible.

- [ ] **Step 6: `OfflineBanner.svelte`** — dismissible; shows only when `env.offline`. `<div data-offline-banner>` "Cloud unreachable — local models still work." with a dismiss button (local `$state` dismissed flag). `DesktopOnlyNote.svelte` — `<span data-desktop-only>` "Needs the desktop app" shown when `env.web`.

- [ ] **Step 7: export all four + the store from `src/index.js`**, run the full `packages/ui` test suite (expect Pill/ExecBadge/AppShell 4 + EnvChip 1 + DeviceFooter 1 = 6 passing).

- [ ] **Step 8: commit** — `feat(ui): env/device atoms (EnvChip, DeviceFooter, OfflineBanner, DesktopOnlyNote)`

---

## Task 2: `packages/core` — Kavach client-only session

**Files:** create `src/auth/client.ts`, `src/auth/session.svelte.ts`, `src/auth/guard.ts`, `src/auth/auth.spec.ts`; export from `src/index.ts`. Add `@kavach/sentry` dep.

- [ ] **Step 1: add deps** — `cd packages/core && bun add @kavach/sentry@link:@kavach/sentry` (and confirm `kavach`, `@kavach/adapter-supabase` are present — add via `link:` if not). Update `package.json` dependencies accordingly.

- [ ] **Step 2: `src/auth/client.ts`** — construct kavach client-side (no server handle)

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from '@kavach/adapter-supabase'
import { createKavach } from 'kavach'

export interface ToriiKavach {
  client: SupabaseClient
  kavach: ReturnType<typeof createKavach>
}

// Client-only session: supabase-js persists + refreshes the session in localStorage
// (persistSession/autoRefreshToken). No SvelteKit server hook, no /auth/session endpoint.
export function createToriiKavach(url: string, anonKey: string): ToriiKavach {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  })
  const adapter = getAdapter(client)
  const kavach = createKavach(adapter, {})
  return { client, kavach }
}
```

- [ ] **Step 3: `src/auth/session.svelte.ts`** — the runes session store

```ts
import type { ToriiKavach } from './client'

export interface SessionUser { id: string; email?: string; name?: string; role: string }

class SessionStore {
  ready = $state(false)
  user = $state<SessionUser | null>(null)
  get authenticated() { return this.user !== null }
  get role() { return this.user?.role ?? 'anon' }

  #sk: ToriiKavach | null = null

  // Hydrate from the persisted supabase session, then subscribe to changes.
  async init(sk: ToriiKavach) {
    this.#sk = sk
    const { data } = await sk.client.auth.getSession()
    this.#apply(data.session)
    sk.client.auth.onAuthStateChange((_event, session) => this.#apply(session))
    this.ready = true
  }

  #apply(session: unknown) {
    // Supabase Session | null. Claims (role/tenant) come from app_metadata via the JWT hook.
    const s = session as { user?: { id: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } } | null
    if (!s?.user) { this.user = null; return }
    const app = s.user.app_metadata ?? {}
    this.user = {
      id: s.user.id,
      email: s.user.email,
      name: (s.user.user_metadata?.name as string) ?? s.user.email,
      role: (app.role as string) ?? 'member'
    }
  }

  async signInWithPassword(email: string, password: string) {
    if (!this.#sk) throw new Error('session not initialised')
    return this.#sk.client.auth.signInWithPassword({ email, password })
  }
  async signOut() { await this.#sk?.client.auth.signOut() }
}

export const session = new SessionStore()
```

- [ ] **Step 4: `src/auth/guard.ts`** — client-side route protection via `@kavach/sentry`

```ts
import { createSentry } from '@kavach/sentry'

export interface Rule { path: string; public?: boolean; roles?: string | string[] }

// Client-side guard: given the rules + current role, decide access for a path.
// Mirrors kavach's server sentry but runs in the SPA (no locals.session).
export function createGuard(rules: Rule[], app = { login: '/signin', home: '/' }) {
  const sentry = createSentry({ app, rules })
  return {
    protect(path: string, session: { user: { role: string } } | null) {
      sentry.setSession(session ?? undefined)
      return sentry.protect(path) // { status, redirect? }
    }
  }
}
```

- [ ] **Step 5: failing test** `src/auth/auth.spec.ts` — the guard (pure, no network)

```ts
import { expect, test } from 'vitest'
import { createGuard } from './guard'

const rules = [
  { path: '/signin', public: true },
  { path: '/', roles: '*' },
  { path: '/admin', roles: ['admin'] }
]

test('guard redirects anonymous users to signin for private routes', () => {
  const g = createGuard(rules)
  const r = g.protect('/', null)
  expect(r.status).not.toBe(200)
  expect(r.redirect).toBe('/signin')
})

test('guard allows an authenticated member to the home route', () => {
  const g = createGuard(rules)
  const r = g.protect('/', { user: { role: 'member' } })
  expect(r.status).toBe(200)
})

test('guard forbids a member from an admin-only route', () => {
  const g = createGuard(rules)
  const r = g.protect('/admin', { user: { role: 'member' } })
  expect(r.status).toBe(403)
})
```

- [ ] **Step 6: run → verify** (adjust to `@kavach/sentry`'s real `protect` return shape if it differs — the scan showed `{ status: 200|401|403|302, redirect? }`; if `setSession(undefined)` vs `null` matters, match its API). Make the three assertions pass. If sentry's exact status codes differ, assert the *semantics* (200 = allowed; non-200 with a redirect for the others) rather than exact numbers.

- [ ] **Step 7: export** `createToriiKavach`, `session`, `createGuard`, types from `src/index.ts`. Run `bun run test` + `bun run check` (tsc) — clean.

- [ ] **Step 8: commit** — `feat(core): kavach client-only session + client-side route guard`

> **Upstream note:** this client-only composition (supabase persistSession + createKavach + client-side sentry, no server handle) is the first Torii→Kavach contribution. Leave a `// UPSTREAM(kavach): package as a client-only session mode` comment in `client.ts`.

---

## Task 3: `packages/ui` — shell chrome (TitleBar, NavRail, DesktopShell) + ⌘K

**Files:** create `src/lib/TitleBar.svelte`, `NavRail.svelte`, `DesktopShell.svelte`, `commands.ts`; export from `src/index.js`. Consult **command-system-rokkit** for the palette.

- [ ] **Step 1: `src/lib/commands.ts`** — register the ⌘K command + workspace registry via `@rokkit/states` (follow the `command-system-rokkit` skill for the exact `commands` API + `mod+k` binding). Expose `registerShellCommands({ goto })` that adds navigation commands (Go to Workspace/Ask/Library/…) and returns the palette-bound command list.

- [ ] **Step 2: `TitleBar.svelte`** — port the mockup title bar (`docs/mockups/app/shell.jsx` / `components/chrome.jsx`). Props: `{ user, onCommand }`. Regions: brand mark (left), `EnvChip`, a search button that opens the ⌘K palette (`onCommand`), a theme toggle (`ThemeSwitcherToggle` from `@rokkit/app`), and a user menu (avatar initials + name + role + sign-out). Use named tokens. Emit `onsignout`. Keep markup faithful to the mockup but Svelte-5 idiomatic.

- [ ] **Step 3: `NavRail.svelte`** — port the nav rail. Props: `{ items, active, appName = 'Torii', version, footer }` where `items` is the console nav (`Workspace/Ask/Library/Playground/Workflows/Activity/Settings`), `active` highlights the current route, `footer` is a `DeviceFooter` snippet. Brand + version at top; nav group in the middle; `{@render footer?.()}` at the bottom. Links `goto` via an `onnavigate` callback (or `href`). Named tokens.

- [ ] **Step 4: `DesktopShell.svelte`** — compose the real shell: `TitleBar` (top) + a two-column body (`NavRail` left, routed content right via `{@render children?.()}`) + a `CommandPalette` (`@rokkit/ui`) bound to `mod+k` (via `@rokkit/actions` `shortcuts` / the `command-system-rokkit` pattern). Props: `{ user, items, active, version, localModels, onnavigate, onsignout }`. Renders `DeviceFooter` in the nav footer with `localModels`. This supersedes the bare `AppShell` for the desktop (admin keeps `AppShell` for now).

- [ ] **Step 5: test** `DesktopShell.spec.svelte.js` — `render(DesktopShell, { props: { user: { name: 'Alex', role: 'member' }, items: ['Workspace','Ask'], active: 'Workspace', version: 1 } })` asserts: the user name renders, the nav landmark exists, `[data-env-chip]` is present, and `Workspace`/`Ask` nav items render. (Palette open-on-⌘K is covered in E2E, not the unit test.)

- [ ] **Step 6: export** `TitleBar`, `NavRail`, `DesktopShell` from `src/index.js`; run the `packages/ui` suite (expect all prior + DesktopShell green). Validate each `.svelte` with the Svelte MCP autofixer.

- [ ] **Step 7: commit** — `feat(ui): desktop shell chrome — TitleBar, NavRail, DesktopShell, ⌘K palette`

---

## Task 4: `apps/desktop` — sign-in route + client kavach wiring

**Files:** create `src/lib/env.ts`, `src/routes/signin/+page.svelte`; modify `src/routes/+layout.svelte`. Add `@kavach/ui` + kavach deps to the desktop `package.json`.

- [ ] **Step 1: deps** — add to `apps/desktop/package.json` dependencies: `"@torii/core": "workspace:*"` (already present), `"kavach": "link:kavach"`, `"@kavach/adapter-supabase": "link:@kavach/adapter-supabase"`, `"@kavach/ui": "link:@kavach/ui"`, `"@kavach/sentry": "link:@kavach/sentry"`, `"@supabase/supabase-js": "^2.101.1"`. Run `bun install`.

- [ ] **Step 2: `src/lib/env.ts`** — expose the Supabase config from static public env (works in the SPA build)

```ts
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
export const SUPABASE_URL = PUBLIC_SUPABASE_URL
export const SUPABASE_ANON_KEY = PUBLIC_SUPABASE_ANON_KEY
```

(Ensure `apps/desktop/.env` has both `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` — copy from `apps/admin/.env`.)

- [ ] **Step 3: modify `src/routes/+layout.svelte`** — init the client kavach + session, set context, run the guard redirect

```svelte
<script>
  import 'uno.css'
  import '../app.css'
  import { onMount, setContext } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { vibe } from '@rokkit/states'
  import { themable } from '@rokkit/actions'
  import { createToriiKavach, session, createGuard } from '@torii/core'
  import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/env'

  let { children } = $props()

  const rules = [
    { path: '/signin', public: true },
    { path: '/', roles: '*' }
  ]
  const guard = createGuard(rules, { login: '/signin', home: '/' })
  const sk = createToriiKavach(SUPABASE_URL, SUPABASE_ANON_KEY)
  setContext('kavach', sk.kavach)

  onMount(async () => {
    await session.init(sk)
    check(page.url.pathname)
  })

  function check(path) {
    if (!session.ready) return
    const r = guard.protect(path, session.user ? { user: { role: session.role } } : null)
    if (r.status !== 200 && r.redirect && r.redirect !== path) goto(r.redirect)
  }

  // Re-guard on navigation + when auth state settles.
  $effect(() => { if (session.ready) check(page.url.pathname) })
</script>

<svelte:body use:themable={{ theme: vibe, storageKey: 'torii-desktop-theme' }} />
{@render children()}
```

- [ ] **Step 4: `src/routes/signin/+page.svelte`** — the Sign-in screen (port `docs/mockups/app/view-signin.jsx` structure). Use `@kavach/ui` `AuthPassword` (bind email/password) + a sign-in button calling `session.signInWithPassword(email, password)`; on success `goto('/')`. Two-column layout from the mockup (routing graphic left, sign-in card right) — keep it faithful but minimal. Show `AuthError` on failure. Consult the **svelte** skill.

- [ ] **Step 5: verify boot** — `bun install`, `bun run --filter @torii/desktop dev`, confirm: visiting `/` while unauthenticated redirects to `/signin` (the sign-in screen renders with the skin); `bun run --filter @torii/desktop check` clean. (A real login needs a valid Supabase user — that's exercised in E2E Task 6 with a seeded/test session; here just confirm the redirect + render.)

- [ ] **Step 6: commit** — `feat(desktop): client-only auth wiring + sign-in screen`

---

## Task 5: `apps/desktop` — move home under `(app)`, wire the DesktopShell + nav routes

**Files:** create `src/routes/(app)/+layout.svelte`, `(app)/+page.svelte`, and placeholder `(app)/{ask,library,playground,workflows,activity,settings}/+page.svelte`; remove the old top-level `src/routes/+page.svelte`.

- [ ] **Step 1: `(app)/+layout.svelte`** — wrap routed content in `DesktopShell`

```svelte
<script>
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { DesktopShell, DeviceFooter } from '@torii/ui'
  import { session } from '@torii/core'
  let { children } = $props()
  const items = ['Workspace', 'Ask', 'Library', 'Playground', 'Workflows', 'Activity', 'Settings']
  const active = $derived(items.find((i) => page.url.pathname.replace('/', '') === i.toLowerCase()) ?? 'Workspace')
  const user = $derived(session.user ?? { name: 'Member', role: 'member' })
</script>

<DesktopShell
  {user}
  {items}
  {active}
  version={1}
  localModels={0}
  onnavigate={(item) => goto(item === 'Workspace' ? '/' : `/${item.toLowerCase()}`)}
  onsignout={async () => { await session.signOut(); goto('/signin') }}
>
  {@render children()}
</DesktopShell>
```

- [ ] **Step 2: `(app)/+page.svelte`** — the Workspace placeholder (real Workspace = Phase 3): a `PageHeader`-style title "Workspace" + a "Pick up where you left off" placeholder card. Use named tokens.

- [ ] **Step 3: placeholder routes** — each of `(app)/{ask,library,playground,workflows,activity,settings}/+page.svelte` renders a simple `<h1>` with the screen name + "Coming in a later phase." (Ask is Phase 1b; the rest Phase 3.) These make the nav links live.

- [ ] **Step 4: delete** the old `src/routes/+page.svelte` (its content moved to `(app)/+page.svelte`). Confirm the guard's `home` (`/`) resolves to the `(app)` group's index.

- [ ] **Step 5: verify** — `bun run --filter @torii/desktop check` clean; dev server: authenticated view shows the `DesktopShell` (title bar + nav rail + device footer), nav links switch routes, sign-out returns to `/signin`. (Use a real Supabase login or the E2E test session.)

- [ ] **Step 6: commit** — `feat(desktop): DesktopShell layout + console nav routes (placeholders)`

---

## Task 6: E2E — auth + shell

**Files:** create `apps/desktop/e2e/tests/auth-shell.spec.ts`; possibly a small test-mode seam.

- [ ] **Step 1: decide the test-session seam.** A full Supabase login in E2E is flaky (needs a real user + network). Use a **build-time e2e seam**: in `+layout.svelte`, when `import.meta.env.VITE_E2E === 'true'`, seed `session` with a fake authenticated member (skip the network `session.init` and set `session.user` directly) so the shell is reachable deterministically. Guard this strictly behind the env flag (never in production). Add `VITE_E2E: 'true'` to the `globalSetup` build env in `apps/desktop/e2e/globalSetup.ts` (the `execFileSync('bunx', ['tauri','build',...])` call → add `env: { ...process.env, VITE_E2E: 'true' }`).

```svelte
<!-- inside onMount, before session.init -->
{#if false}{/if}
```
```ts
// in +layout.svelte onMount:
if (import.meta.env.VITE_E2E === 'true') {
  session.ready = true
  session.user = { id: 'e2e', email: 'e2e@torii.test', name: 'E2E Member', role: 'member' }
} else {
  await session.init(sk)
}
check(page.url.pathname)
```

- [ ] **Step 2: `apps/desktop/e2e/tests/auth-shell.spec.ts`**

```ts
import { test, expect } from '../fixtures'
import { navigateTo } from '../helpers'

test.describe('Desktop auth + shell', () => {
  test('authenticated member sees the DesktopShell with nav + user', async ({ tauriPage }) => {
    // e2e build seeds a member session → home route shows the shell.
    await expect(tauriPage.locator('[data-app-shell], [data-desktop-shell]')).toBeVisible({ timeout: 20_000 })
    await expect(tauriPage.locator('nav[aria-label="Primary"]')).toBeVisible()
    await expect(tauriPage.locator('[data-env-chip]')).toBeVisible()
    await expect(tauriPage.getByText('E2E Member')).toBeVisible()
  })

  test('nav to Ask switches route', async ({ tauriPage }) => {
    await navigateTo(tauriPage, '/ask')
    await expect(tauriPage.locator('h1')).toContainText(/ask/i)
  })
})
```

(Add `data-desktop-shell` to `DesktopShell.svelte`'s root if not already present. Adjust the `navigateTo`/selectors to what the shell renders.)

- [ ] **Step 3: run** `cd apps/desktop && bun run test:e2e` — globalSetup rebuilds the app with `VITE_E2E=true` + `e2e-testing` (slow first build), then the two tests pass.

- [ ] **Step 4: commit** — `test(desktop): E2E — client-only auth + DesktopShell`

---

## Task 7: Acceptance

- [ ] **Step 1:** `bun install && bun run test && bun run check && bun run lint` at root — all green (packages/ui suite grew: env/device + DesktopShell; packages/core grew: auth guard). Record counts.
- [ ] **Step 2:** `cargo build -p app` — still compiles (no Rust changes this phase, but confirm).
- [ ] **Step 3:** desktop dev boot: unauth → `/signin` (skinned); with the e2e seam OR a real login → `DesktopShell` with title bar + nav rail + device footer + ⌘K palette (press `mod+k` → palette opens). `svelte-check` clean.
- [ ] **Step 4:** update `apps/README.md` — note the desktop now has auth (client-only session) + the real shell; document the `VITE_E2E` seam.
- [ ] **Step 5:** commit — `chore(phase1a): acceptance — desktop shell + client auth green`.

---

## Self-review notes (author)
- **Spec coverage** (blueprint §8 Phase 1, shell+auth slice): shell chrome (Task 1,3), EnvChip/DeviceFooter/OfflineBanner (Task 1), ⌘K palette (Task 3), Kavach **client-only session mode** (Task 2 — the upstream enhancement), Sign-in screen (Task 4), route protection (Task 2 guard + Task 4 wiring), console nav (Task 5), E2E (Task 6). **Local inference + Ask are explicitly Phase 1b** (not here).
- **Deferred to 1b/later:** the in-process embedded engine (`EmbeddedLlamaAdapter`, `sensei-local-*`), `infer`/`list_models` IPC, Local Models screen, real Ask, split-plane router, offline usage buffer, device enrollment token.
- **Risk/uncertainty:** `@kavach/sentry`'s exact `protect()` return + `setSession` signature (Task 2 Step 6 says match the real API and assert semantics). The ⌘K wiring (Task 3) leans on the `command-system-rokkit` skill — consult it rather than guessing the `@rokkit/states` commands API. The E2E test-session seam (Task 6) must be strictly env-gated.
- **Type consistency:** `session.role`/`session.user` shape (Task 2) is consumed by the guard (Task 2), the `(app)` layout (Task 5), and E2E seeding (Task 6) — all use `{ user: { role } }`. `DesktopShell` props (`user/items/active/version/localModels/onnavigate/onsignout`) are defined in Task 3 and passed in Task 5.
