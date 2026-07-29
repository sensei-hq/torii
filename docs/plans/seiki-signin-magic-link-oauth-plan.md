# Seiki Magic-Link Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Edit `.svelte` files with the svelte MCP / svelte-file-editor and re-validate.

**Goal:** Make the Seiki admin sign-in magic-link-primary (passwordless, doubling as domain-based self-register), keep password as a secondary option, and wire the now-enabled GitHub OAuth — riding the existing `core.assign_tenant_by_domain()` trigger with no schema change.

**Architecture:** Pure decision logic in `src/lib/auth-flow.ts` (unit-tested). Thin supabase-js wrappers added to `src/lib/api.ts`. Both magic-link and OAuth redirect back to a new public `/auth/callback` route that establishes the session, calls `whoami`, and either routes home or shows a terminal "no organization" state. The sign-in page is reworked to magic-link-primary presentation. Confirmed: the gateway accepts a tenant-less token and `whoami` returns `{tenant_id: null}`, so no gateway change is needed.

**Tech Stack:** SvelteKit (Svelte 5 runes) · `@supabase/supabase-js` v2 · Kavach · vitest (node, pure-logic) · bun workspaces. Code style: **no semicolons, single quotes, tabs** (prettier-enforced).

**Design spec:** `docs/design/seiki-signin-magic-link-oauth.md`
**Branch:** work on `develop` (house practice). Package manager: `bun`. Run admin scripts via `bun run --filter @seiki/admin <script>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/admin/src/lib/auth-flow.ts` *(new)* | Pure helpers: `normalizeEmail`, `emailDomain`, `looksLikeEmail`, `postAuthDestination`. No framework/`$env` deps. |
| `apps/admin/src/lib/auth-flow.spec.ts` *(new)* | Unit tests for the above (node vitest). |
| `apps/admin/src/lib/api.ts` *(modify)* | Add `signInWithMagicLink(email)` and `signInWithOAuth('github')` to the `api` object. |
| `apps/admin/kavach.config.js` *(modify)* | Add `/auth/callback` public rule; add `github` provider for config alignment. |
| `apps/admin/src/routes/auth/callback/+page.svelte` *(new)* | Single landing point for magic-link + OAuth returns; routes home or shows no-org. |
| `apps/admin/src/routes/signin/+page.svelte` *(modify)* | Magic-link-primary UI, "check inbox" state, password-secondary toggle, GitHub enabled. |

Operator prerequisites (not code — do before browser-verify): add `https://seiki.sensei-hq.com/auth/callback` + `http://localhost:5273/auth/callback` to Supabase Auth → URL Configuration → Redirect URLs; set `core.tenants.domain` for the test tenant.

---

### Task 1: Pure auth-flow helpers

**Files:**
- Create: `apps/admin/src/lib/auth-flow.ts`
- Test: `apps/admin/src/lib/auth-flow.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/lib/auth-flow.spec.ts`:

```ts
import { expect, test } from 'vitest'
import { emailDomain, looksLikeEmail, normalizeEmail, postAuthDestination } from './auth-flow'

test('normalizeEmail lowercases and trims', () => {
	expect(normalizeEmail('  Alice@Company.COM ')).toBe('alice@company.com')
})

test('emailDomain extracts the domain, or empty for malformed input', () => {
	expect(emailDomain('alice@company.com')).toBe('company.com')
	expect(emailDomain('Alice@Sub.Company.CO ')).toBe('sub.company.co')
	expect(emailDomain('not-an-email')).toBe('')
})

test('looksLikeEmail accepts dotted work addresses, rejects the rest', () => {
	expect(looksLikeEmail('alice@company.com')).toBe(true)
	expect(looksLikeEmail('alice@localhost')).toBe(false)
	expect(looksLikeEmail('nope')).toBe(false)
	expect(looksLikeEmail('')).toBe(false)
})

test('postAuthDestination: a tenant → home; tenant-less or null → no-org', () => {
	expect(
		postAuthDestination({ sub: 'u', tenant_id: 't1', role: 'member', capabilities: [] })
	).toBe('home')
	expect(
		postAuthDestination({ sub: 'u', tenant_id: null, role: null, capabilities: [] })
	).toBe('no-org')
	expect(postAuthDestination(null)).toBe('no-org')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --filter @seiki/admin test`
Expected: FAIL — `auth-flow.spec.ts` cannot resolve `./auth-flow` (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/admin/src/lib/auth-flow.ts`:

```ts
import type { WhoAmI } from './api'

/** Lowercased, whitespace-trimmed email. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase()
}

/** The domain part of an email (normalized), or '' when there is no '@'. */
export function emailDomain(email: string): string {
	const e = normalizeEmail(email)
	const at = e.lastIndexOf('@')
	return at === -1 ? '' : e.slice(at + 1)
}

/** Basic shape check: a local part, an '@', and a dotted domain. */
export function looksLikeEmail(email: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(email))
}

export type AuthDestination = 'home' | 'no-org'

/**
 * Where to send the user after a completed sign-in. A resolved whoami carrying a
 * tenant_id → the app home; a tenant-less whoami OR a failed lookup (null) → the
 * no-org state. The callback passes `null` when whoami throws, so this is the one
 * branch point for both magic-link and OAuth returns.
 */
export function postAuthDestination(whoami: WhoAmI | null): AuthDestination {
	return whoami?.tenant_id ? 'home' : 'no-org'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run --filter @seiki/admin test`
Expected: PASS — all `auth-flow.spec.ts` tests green; existing `filters.spec.ts` / `identity.spec.ts` still green.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/auth-flow.ts apps/admin/src/lib/auth-flow.spec.ts
git commit -m "feat(seiki): pure auth-flow helpers (email + post-auth destination)"
```

---

### Task 2: Magic-link + OAuth API wrappers

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (add two methods to the exported `api` object, next to `signIn`)

No unit test: these are thin `supabase-js` wrappers with side effects (email dispatch, full-page redirect). The repo's vitest is pure-logic only (`vitest.config.js`: *"Unit tests for PURE logic only … Component/e2e testing is separate"*); the branch logic they feed lives in `auth-flow.ts` (Task 1, tested) and the wrappers are covered by the browser-verify in Task 6.

- [ ] **Step 1: Add the two methods**

In `apps/admin/src/lib/api.ts`, locate the `signIn` method inside the `export const api = {` object:

```ts
	signIn: async (email: string, password: string) => {
		const { error } = await sb().auth.signInWithPassword({ email, password })
		if (error) throw new Error(error.message)
	},
```

Insert immediately after it:

```ts
	// Passwordless magic link — also the register path: Supabase creates the user when
	// new, and the core.assign_tenant_by_domain trigger auto-joins them by email domain.
	// The emailed link lands back on /auth/callback (implicit flow → tokens in the URL,
	// parsed by detectSessionInUrl).
	signInWithMagicLink: async (email: string) => {
		const { error } = await sb().auth.signInWithOtp({
			email,
			options: {
				shouldCreateUser: true,
				emailRedirectTo: `${window.location.origin}/auth/callback`
			}
		})
		if (error) throw new Error(error.message)
	},
	// OAuth (GitHub v1). Convenience login; the same domain trigger applies on first
	// signup. Best-effort tenant match — a personal GitHub email falls into the no-org
	// path. Triggers a full-page redirect to the provider, then back to /auth/callback.
	signInWithOAuth: async (provider: 'github') => {
		const { error } = await sb().auth.signInWithOAuth({
			provider,
			options: { redirectTo: `${window.location.origin}/auth/callback` }
		})
		if (error) throw new Error(error.message)
	},
```

- [ ] **Step 2: Type-check**

Run: `bun run --filter @seiki/admin check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/lib/api.ts
git commit -m "feat(seiki): api.signInWithMagicLink + api.signInWithOAuth wrappers"
```

---

### Task 3: Make `/auth/callback` a public route

**Files:**
- Modify: `apps/admin/kavach.config.js`

- [ ] **Step 1: Add the callback rule and the github provider**

Current file:

```js
export default {
	adapter: 'supabase',
	env: { url: 'PUBLIC_SUPABASE_URL', anonKey: 'PUBLIC_SUPABASE_ANON_KEY' },
	providers: [
		{ name: 'google', label: 'Continue with Google' },
		{ mode: 'password', name: 'password', label: 'Email & password' }
	],
	logging: { level: 'error', table: 'audit_events' },
	routes: { auth: '/signin', data: '/data', logout: '/logout', home: '/' },
	rules: [
		{ path: '/signin', public: true }, // the real login page — auth redirects land here, not a 404 /auth
		{ path: '/', public: true } // Phase 0: shell boots publicly. Phase 1 tightens to roles:'*' + server-side session.
	]
}
```

Replace the `providers` and `rules` arrays with:

```js
	providers: [
		{ name: 'github', label: 'Continue with GitHub' },
		{ name: 'google', label: 'Continue with Google' },
		{ mode: 'password', name: 'password', label: 'Email & password' }
	],
	logging: { level: 'error', table: 'audit_events' },
	routes: { auth: '/signin', data: '/data', logout: '/logout', home: '/' },
	rules: [
		{ path: '/signin', public: true }, // the real login page — auth redirects land here, not a 404 /auth
		{ path: '/auth/callback', public: true }, // magic-link + OAuth return; not auth-guarded (would loop)
		{ path: '/', public: true } // Phase 0: shell boots publicly. Phase 1 tightens to roles:'*' + server-side session.
	]
```

- [ ] **Step 2: Verify JSONC/JS still parses (build sync)**

Run: `bun run --filter @seiki/admin check`
Expected: `0 ERRORS 0 WARNINGS` (a syntax error here fails `svelte-kit sync`).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/kavach.config.js
git commit -m "feat(seiki): public /auth/callback rule + github provider in kavach.config"
```

---

### Task 4: The `/auth/callback` route

**Files:**
- Create: `apps/admin/src/routes/auth/callback/+page.svelte`

- [ ] **Step 1: Create the callback page**

Create `apps/admin/src/routes/auth/callback/+page.svelte`:

```svelte
<script>
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { api } from '$lib/api'
	import { postAuthDestination } from '$lib/auth-flow'
	import { BrandMark } from '@torii/ui'

	// 'working' → establishing session + resolving org; 'no-org' → terminal message.
	let status = $state('working')

	onMount(async () => {
		// supabase-js parses the returned tokens (detectSessionInUrl); getSession awaits
		// that init and returns the persisted session.
		const signedIn = await api.hasSession()
		if (!signedIn) {
			goto('/signin')
			return
		}
		let who = null
		try {
			who = await api.whoami()
		} catch {
			who = null
		}
		if (postAuthDestination(who) === 'home') {
			goto('/')
		} else {
			status = 'no-org'
		}
	})

	async function signOut() {
		await api.signOut()
		goto('/signin')
	}
</script>

<div class="grid min-h-screen place-items-center bg-paper px-6">
	<div class="w-full max-w-[400px] rounded-lg border border-paper-edge bg-paper-soft p-6 text-center">
		<div class="mb-4 flex justify-center"><BrandMark size={32} /></div>
		{#if status === 'working'}
			<h1 class="font-heading text-lg text-ink">Signing you in…</h1>
			<p class="mt-2 text-sm text-ink-mute">Confirming your access.</p>
		{:else}
			<h1 class="font-heading text-lg text-ink">No organization for this email</h1>
			<p class="mt-2 text-sm leading-relaxed text-ink-mute">
				Your email domain isn't linked to an organization yet. Ask your admin to add it, then
				sign in again with your work email.
			</p>
			<button
				onclick={signOut}
				class="mt-5 flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-on-primary"
			>
				Back to sign in
			</button>
		{/if}
	</div>
</div>
```

- [ ] **Step 2: Validate the Svelte component**

Use the svelte MCP `svelte-autofixer` on the file, then run: `bun run --filter @seiki/admin check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 3: Build to confirm the route compiles**

Run: `bun run --filter @seiki/admin build`
Expected: `✓ built` and `Using @sveltejs/adapter-cloudflare ✔ done` (an `auth/callback` entry appears in the server output).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/routes/auth/callback/+page.svelte
git commit -m "feat(seiki): /auth/callback route — resolve session, route home or show no-org"
```

---

### Task 5: Magic-link-primary sign-in page

**Files:**
- Modify: `apps/admin/src/routes/signin/+page.svelte` (replace the `<script>` block and the right-hand `<main>` block; leave the left `<section>` diagram, the `PROVIDERS`/`PATH`/`VALUE` consts, and the `<style>` untouched)

- [ ] **Step 1: Replace the `<script>` block**

Replace the current `<script>` … `</script>` (the state + `submit()` function; keep `PROVIDERS`, `PATH`, `VALUE`) with:

```svelte
<script>
	// Seiki admin sign-in — magic-link-primary. Passwordless email link is the primary
	// path (and the domain-based register path); password is a secondary, revealed option;
	// GitHub OAuth is a convenience login. All flows land on /auth/callback.
	import { api } from '$lib/api'
	import { looksLikeEmail } from '$lib/auth-flow'
	import { BrandMark } from '@torii/ui'

	let email = $state('')
	let password = $state('')
	let error = $state('')
	let loading = $state(false)
	let sent = $state(false) // magic link dispatched → "check your inbox"
	let showPassword = $state(false) // reveal the secondary password path

	async function sendMagicLink() {
		if (loading || !looksLikeEmail(email)) return
		loading = true
		error = ''
		try {
			await api.signInWithMagicLink(email)
			sent = true
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	async function signInWithPassword() {
		if (loading) return
		loading = true
		error = ''
		try {
			await api.signIn(email, password)
			// On success supabase persists the session; go to the shell (it resolves the tenant).
			window.location.assign('/')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}

	async function continueWithGitHub() {
		error = ''
		try {
			await api.signInWithOAuth('github') // full-page redirect to GitHub on success
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		}
	}

	const PROVIDERS = [
		{ key: 'anthropic', label: 'anthropic', y: 38, hue: 'oklch(0.70 0.13 45)' },
		{ key: 'google', label: 'google', y: 92, hue: 'oklch(0.62 0.16 254)' },
		{ key: 'openai', label: 'openai', y: 146, hue: 'oklch(0.62 0.08 160)' },
		{ key: 'local', label: 'local', y: 200, hue: 'oklch(0.58 0.01 50)' }
	]
	const PATH = {
		38: 'M160 38 C 232 38, 244 116, 272 116',
		92: 'M160 92 C 222 92, 244 116, 272 116',
		146: 'M160 146 C 222 146, 244 116, 272 116',
		200: 'M160 200 C 232 200, 244 116, 272 116'
	}
	const VALUE = [
		{
			ic: 'i-solar-routing-2-bold-duotone',
			t: 'Route across every provider',
			s: 'One endpoint. Step-down routing and a free-tier floor pick the cheapest model that still answers well.'
		},
		{
			ic: 'i-solar-wallet-2-bold-duotone',
			t: 'Spend with intent',
			s: 'Org, team and user budgets with hard caps — every call reserved and committed against a ledger.'
		},
		{
			ic: 'i-solar-shield-check-bold-duotone',
			t: 'Govern with confidence',
			s: 'Role-based access and a full request ledger — every call traceable, every key accounted for.'
		}
	]
</script>
```

- [ ] **Step 2: Replace the right-hand `<main>` block**

Replace the entire `<main class="flex min-w-0 justify-center md:justify-end"> … </main>` block with:

```svelte
				<!-- right · sign in -->
				<main class="flex min-w-0 justify-center md:justify-end">
					<div class="w-full max-w-[400px]">
						<div class="rounded-lg border border-paper-edge bg-paper-soft p-6">
							<h1 class="mb-5 text-center font-heading text-xl text-ink">Sign in to the admin portal</h1>

							{#if sent}
								<div class="text-center">
									<span class="i-solar-letter-bold-duotone mx-auto mb-3 block h-8 w-8 text-accent"></span>
									<p class="text-sm text-ink">Check your inbox</p>
									<p class="mt-1 text-sm leading-relaxed text-ink-mute">
										We sent a sign-in link to <span class="font-medium text-ink">{email}</span>. Open it
										on this device to continue.
									</p>
									<button
										type="button"
										onclick={() => (sent = false)}
										class="mt-4 text-xs font-medium text-accent hover:underline"
									>
										Use a different email
									</button>
								</div>
							{:else}
								<form
									onsubmit={(e) => {
										e.preventDefault()
										sendMagicLink()
									}}
									class="space-y-3"
								>
									<div>
										<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
											>Work email</span
										>
										<input
											bind:value={email}
											type="email"
											placeholder="you@company.com"
											autocomplete="username"
											aria-label="Work email"
											class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
										/>
									</div>

									{#if showPassword}
										<div>
											<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
												>Password</span
											>
											<input
												bind:value={password}
												type="password"
												placeholder="••••••••"
												autocomplete="current-password"
												aria-label="Password"
												class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
											/>
										</div>
									{/if}

									{#if error}
										<p class="text-xs text-danger">{error}</p>
									{/if}

									{#if showPassword}
										<button
											type="button"
											onclick={signInWithPassword}
											disabled={loading || !email || !password}
											class="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-on-primary disabled:opacity-40"
										>
											{loading ? 'Signing in…' : 'Sign in'}
										</button>
									{:else}
										<button
											type="submit"
											disabled={loading || !looksLikeEmail(email)}
											class="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-on-primary disabled:opacity-40"
										>
											{loading ? 'Sending link…' : 'Email me a magic link'}
										</button>
									{/if}
								</form>

								<button
									type="button"
									onclick={() => (showPassword = !showPassword)}
									class="mt-2 block w-full text-center text-xs font-medium text-ink-mute hover:text-ink"
								>
									{showPassword ? 'Use a magic link instead' : 'Prefer a password? Sign in with a password'}
								</button>

								<div class="my-4 flex items-center gap-3">
									<span class="h-px flex-1 bg-paper-edge"></span>
									<span class="font-mono text-[10px] uppercase tracking-wider text-ink-mute">or</span>
									<span class="h-px flex-1 bg-paper-edge"></span>
								</div>

								<div class="flex flex-col gap-2">
									<button
										type="button"
										onclick={continueWithGitHub}
										class="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-paper-edge text-sm text-ink hover:border-ink"
									>
										<span class="i-lucide-github h-4 w-4"></span> Continue with GitHub
									</button>
									<button
										disabled
										title="Fast-follow — not yet enabled"
										class="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-paper-edge text-sm text-ink-soft opacity-60"
									>
										<span class="i-solar-global-bold-duotone h-4 w-4"></span> Continue with Google
									</button>
								</div>
							{/if}
						</div>

						<p class="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-faint">
							<span class="i-solar-shield-check-bold-duotone h-3 w-3"></span>
							Passwordless by default · new work-email users are set up automatically
						</p>
					</div>
				</main>
```

- [ ] **Step 3: Validate the Svelte component**

Use the svelte MCP `svelte-autofixer` on the file, then run: `bun run --filter @seiki/admin check`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/routes/signin/+page.svelte
git commit -m "feat(seiki): magic-link-primary sign-in — password secondary, GitHub enabled"
```

---

### Task 6: Full verification + landing on main

**Files:** none (verification + release)

- [ ] **Step 1: Run the full admin gate**

```bash
bun run --filter @seiki/admin test
bun run --filter @seiki/admin check
bun run --filter @seiki/admin build
```
Expected: tests all pass (incl. `auth-flow.spec.ts`); check `0 ERRORS`; build `✓ built … ✔ done`.

- [ ] **Step 2: Format + lint the files this plan touched**

```bash
PB="$PWD/node_modules/.bin/prettier"; EB="$PWD/node_modules/.bin/eslint"
"$PB" --write apps/admin/src/lib/auth-flow.ts apps/admin/src/lib/auth-flow.spec.ts apps/admin/src/lib/api.ts apps/admin/kavach.config.js apps/admin/src/routes/auth/callback/+page.svelte apps/admin/src/routes/signin/+page.svelte
"$PB" --check apps/admin/src/lib/auth-flow.ts apps/admin/src/lib/auth-flow.spec.ts apps/admin/src/lib/api.ts apps/admin/kavach.config.js apps/admin/src/routes/auth/callback/+page.svelte apps/admin/src/routes/signin/+page.svelte
"$EB" apps/admin/src/lib/auth-flow.ts apps/admin/src/lib/auth-flow.spec.ts apps/admin/src/lib/api.ts apps/admin/src/routes/auth/callback/+page.svelte apps/admin/src/routes/signin/+page.svelte
```
Expected: `All matched files use Prettier code style!` and eslint clean. Commit any format-only changes.

- [ ] **Step 3: Manual browser-verify (operator prerequisites first)**

Ensure the Supabase redirect URLs are set and `core.tenants.domain` is populated for a test tenant. Then `bun run --filter @seiki/admin dev` and verify at `http://localhost:5273/signin`:
  1. **Magic link (known domain):** enter a work email whose domain matches a tenant → "Check your inbox" → open the link → `/auth/callback` → lands on `/` signed in.
  2. **Magic link (unknown domain):** enter an email with no tenant domain → open the link → `/auth/callback` shows "No organization for this email" with a working "Back to sign in".
  3. **Password:** click "Prefer a password?", sign in with a seeded account → lands on `/`.
  4. **GitHub:** click "Continue with GitHub" → GitHub → `/auth/callback` → home (matching domain) or no-org (personal email).

- [ ] **Step 4: Land on develop → main**

```bash
git push origin develop
git push origin develop:main
```
Only push after Step 1 is green (never merge on red) and Step 3 is confirmed by a human.

---

## Self-Review

**Spec coverage:** magic-link-primary (Task 5) ✓ · password kept/secondary (Task 5) ✓ · magic-link register via existing trigger, no schema change (design + Task 2 `shouldCreateUser`) ✓ · soft work-email + no-org message (Task 4) ✓ · GitHub best-effort + soft fallback (Tasks 2/4/5) ✓ · Google disabled (Task 5) ✓ · callback route (Tasks 3/4) ✓ · identity-linking + e2e deferred (design non-goals) ✓ · gateway unchanged, confirmed via `require_auth`/`whoami` ✓.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `WhoAmI` (`{ sub, tenant_id: string | null, tenant_name?, role, capabilities }`) matches `api.ts`; `postAuthDestination(WhoAmI | null)` used consistently in Tasks 1 and 4; `signInWithMagicLink`/`signInWithOAuth`/`api.hasSession`/`api.whoami`/`api.signIn`/`api.signOut` names match `api.ts`; `looksLikeEmail` used in Tasks 1 and 5.
