---
title: 'Phase 2b · Desktop split-plane router (D3) — implementation plan'
description: Make the desktop Ask answer via the local plane (in-process embedded engine — `sensei-local-providers` `EmbeddedLlamaAdapter`, no daemon) OR the cloud plane (proxy to the C1 service with the Supabase JWT), chosen by a plane selector, with an accurate per-answer ExecBadge. Config sync (D4) + offline buffer are a separate follow-up.
type: plan
status: plan
created: 2026-07-07
depends_on:
  - docs/design/clients-buildout.md
  - docs/plans/phase-1b-local-inference-ask-plan.md
  - docs/plans/phase-2a-central-gateway-plan.md
references:
  - docs/modules/D3-split-plane-router.md
  - docs/modules/W2-member-console.md
milestone: Phase-2b
---

# Phase 2b · Desktop split-plane router (D3) — Implementation Plan

> **Reconciled to [`../DECISIONS.md`](../DECISIONS.md) + [`roadmap.md`](roadmap.md) 2026-07-23 (P2b).** Engine = six `sensei-*` crates @ `v0.4.6`; the local leg is the **in-process `EmbeddedLlamaAdapter`** (`sensei-local-providers`, no daemon), **not** `gateway-embedded` (retired). **Prerequisite: GH-1** (per-step `plane` + execution-location on `ChainEntry`/`Attempt`/`ExecutionTrace`) must be filed + released before the unified per-step ExecBadge is accurate — see [`gateway-issues.md`](gateway-issues.md). Apply MIG-4 crate wording. Full D3/D4 mature in the device-plane completion phase (P10).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. `.svelte` → the **svelte** skill; named Rokkit tokens only. eslint + prettier enforced. **Heavy Tauri E2E builds run via a BACKGROUND shell (controller), not a subagent** (watchdog). Serialize `apps/desktop` implementers (they cross-stage in `git add`).

**Goal:** In the desktop Ask, a user can pick **Local** (answer runs in-process via the embedded engine `EmbeddedLlamaAdapter`, `ExecBadge` "on your device", $0) or **Cloud** (the desktop proxies the request to the **C1** service `POST /v1/chat` with the user's Supabase JWT; `ExecBadge` "via gateway"). One Ask UI, two planes, correct per-answer badge — the split-plane in action.

**Architecture:** Extend Phase 1b. Add a **cloud leg**: `src/lib/cloud.ts` POSTs to C1 (`PUBLIC_GATEWAY_URL`, default `http://127.0.0.1:8787`) `/v1/chat` with `Authorization: Bearer <session.accessToken>`; maps C1's `ChatResponse` → the same `InferResult` shape the local leg returns. A **split-plane router** (`src/lib/plane.ts`) picks the leg from a `plane` state (`local` | `cloud`) and tags the turn's `exec.plane`. The `ask` store calls the router instead of the local `gateway.infer` directly. The Ask UI gains a Local/Cloud toggle and shows the real plane in `ExecBadge`. **Provider keys never touch the desktop** — cloud inference is C1's job.

**Tech Stack:** SvelteKit static/Svelte 5 · `@tauri-apps/api` (local IPC, Phase 1b) · `fetch` → C1 (cloud) · `@strategos/core` session (JWT) · Playwright.

**Scope note (D4 deferred):** Realtime config sync + `update_config` hot-reload + the offline usage buffer are **NOT** in this plan — they're the next slice. Here the desktop just routes to whichever plane the user selects.

**Prerequisites:** Phase 1b (local Ask + `ask.svelte.ts` + `gateway.ts`), Phase 1a (kavach session), Phase 2a (C1 serving `/v1/chat`). Branch **develop**; commit per task; `make clean` + push at the end.

---

## Auth reality (read before Task 1)
- The desktop's cloud leg sends `session.accessToken` (the Supabase JWT) to C1. C1 validates it via JWKS.
- **Local GoTrue signup currently 500s** (a Supabase-local issue — see project memory), so obtaining a *real* in-app session token is blocked. Therefore:
  - **Build** the cloud leg to send `session.accessToken` (correct for production).
  - **E2E**: stub both legs under `VITE_E2E` (deterministic) — no real network.
  - **Manual/contract check** (controller): verify the desktop's cloud-leg *contract* against a running C1 using an **HS256** token (C1's `SUPABASE_JWT_SECRET` fallback) + C1 routed to Ollama gemma ($0) — mirroring the Phase-2a E2E. Full in-app real-token path is gated on the GoTrue fix (a follow-up).

---

## File structure

```
apps/desktop/src/lib/
  env.ts                 # (modify) + PUBLIC_GATEWAY_URL from $env/static/public
  cloud.ts               # NEW: C1 client — postChat(messages) → InferResult
  plane.ts               # NEW: split-plane router — route(messages, plane) → InferResult (tags plane)
  ask.svelte.ts          # (modify) hold `plane` state; send() calls plane.route(...)
apps/desktop/src/routes/(app)/ask/+page.svelte   # (modify) Local/Cloud toggle + ExecBadge shows turn.exec.plane
packages/core/src/auth/session.svelte.ts         # (modify) expose `accessToken`
apps/desktop/e2e/tests/split-plane.spec.ts       # NEW: local vs cloud answer + badge
apps/desktop/.env        # (modify) PUBLIC_GATEWAY_URL=http://127.0.0.1:8787
```

---

## Task 1: `packages/core` — expose the session access token

**Files:** modify `packages/core/src/auth/session.svelte.ts`.

- [ ] **Step 1:** add `accessToken = $state<string | null>(null)` to the `SessionStore`, and in `#apply(session)` set it from the supabase session's `access_token` (the raw session object — `(session as any)?.access_token ?? null`). Clear to `null` when no session.
- [ ] **Step 2:** ensure `init()` (which calls `getSession()`) and `onAuthStateChange` both flow through `#apply`, so `accessToken` stays current.
- [ ] **Step 3:** `bun run --filter @strategos/core test` + `check` clean (the guard tests are unaffected). Commit — `feat(core): expose session accessToken for the cloud leg`.

---

## Task 2: desktop cloud client (`cloud.ts`) + env

**Files:** modify `apps/desktop/src/lib/env.ts`, `apps/desktop/.env`; create `apps/desktop/src/lib/cloud.ts`.

- [ ] **Step 1:** `env.ts` — add `import { PUBLIC_GATEWAY_URL } from '$env/static/public'` and `export const GATEWAY_URL = PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:8787'`. Add `PUBLIC_GATEWAY_URL=http://127.0.0.1:8787` to `apps/desktop/.env`.
- [ ] **Step 2:** `src/lib/cloud.ts`:
```ts
import { GATEWAY_URL } from './env'
import { session } from '@strategos/core'
import type { ChatMessage, InferResult } from './gateway'

interface C1ChatResponse { content: string; model?: string; cost_usd: number; input_tokens?: number; output_tokens?: number }

// Cloud leg: proxy the request to the C1 central gateway with the Supabase JWT.
// Provider keys stay on C1 — the desktop only forwards the token.
export async function cloudInfer(messages: ChatMessage[], opts: { chain?: string } = {}): Promise<InferResult> {
  const token = session.accessToken
  if (!token) throw new Error('not signed in — cloud plane needs a session')
  const res = await fetch(`${GATEWAY_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages, chain: opts.chain ?? 'local' })
  })
  if (!res.ok) throw new Error(`gateway ${res.status}: ${await res.text().catch(() => '')}`)
  const r: C1ChatResponse = await res.json()
  return { content: r.content, model: r.model, plane: 'cloud', cost_usd: r.cost_usd, duration_ms: 0 }
}
```
(Note: `chain` defaults to `'local'` so the demo routes C1→Ollama gemma at $0; production would use a `chat` chain. The `InferResult` shape matches `gateway.ts`.)
- [ ] **Step 3:** `svelte-check` + `lint` clean. Commit — `feat(desktop): C1 cloud client (proxy /v1/chat with JWT)`.

---

## Task 3: split-plane router + ask store

**Files:** create `apps/desktop/src/lib/plane.ts`; modify `apps/desktop/src/lib/ask.svelte.ts`.

- [ ] **Step 1:** `src/lib/plane.ts`:
```ts
import { gateway, type ChatMessage, type InferResult } from './gateway'
import { cloudInfer } from './cloud'

export type Plane = 'local' | 'cloud'

// The split-plane router: pick the execution plane. Local → in-process embedded engine
// (EmbeddedLlamaAdapter, Tauri IPC); Cloud → proxy to the C1 service. Returns a plane-tagged InferResult.
export async function route(messages: ChatMessage[], plane: Plane): Promise<InferResult> {
  if (plane === 'cloud') return cloudInfer(messages)
  const res = await gateway.infer(messages)
  return { ...res, plane: 'local' }
}
```
- [ ] **Step 2:** modify `ask.svelte.ts` — add `plane = $state<Plane>('local')` and a `setPlane(p)` method; change `send()` to call `route(history, this.plane)` instead of `gateway.infer(history)`. The assistant turn's `exec` carries the returned `InferResult` (with `plane`).
- [ ] **Step 3:** `svelte-check` + `lint` clean. Commit — `feat(desktop): split-plane router (local vs cloud) wired into the ask store`.

---

## Task 4: Ask UI — plane toggle + accurate ExecBadge

**Files:** modify `apps/desktop/src/routes/(app)/ask/+page.svelte`.

- [ ] **Step 1:** add a small **Local / Cloud** toggle in the Ask header (two buttons or a Rokkit Toggle) bound to `ask.plane` via `ask.setPlane('local'|'cloud')`. Style with named tokens; mark the active one (`text-primary-500`/`bg-paper-soft`). Add `data-plane-toggle` for the E2E.
- [ ] **Step 2:** the assistant turn's `<ExecBadge plane={turn.exec?.plane ?? 'local'} region={turn.exec?.plane === 'cloud' ? 'eu-west-2' : ''} />` — so cloud answers read "via gateway · …" and local read "on your device". (ExecBadge already handles both planes.)
- [ ] **Step 3:** a subtle cloud hint: when `ask.plane === 'cloud'` and `!session.authenticated`, show "Sign in to use the cloud plane" (since the cloud leg needs a token). Optional but honest.
- [ ] **Step 4:** `svelte-check` + `lint` clean. Commit — `feat(desktop): Ask plane toggle + per-answer ExecBadge`.

---

## Task 5: E2E — split-plane (deterministic stubs)

**Files:** create `apps/desktop/e2e/tests/split-plane.spec.ts`; extend the `VITE_E2E` stubs.

- [ ] **Step 1:** under `VITE_E2E`, stub both legs deterministically. In `gateway.ts` the local `infer` is already stubbed (Phase 1b); in `cloud.ts`, when `import.meta.env.VITE_E2E === 'true'`, `cloudInfer` returns a canned `{ content: 'Hello from the cloud gateway.', model: 'gemma4', plane: 'cloud', cost_usd: 0, duration_ms: 0 }` without `fetch` (and without needing a token). Keep strictly env-gated.
- [ ] **Step 2:** `e2e/tests/split-plane.spec.ts` (seeded member, existing seam):
  - Navigate to `/ask` (NavRail "Ask" button).
  - **Local:** ensure the toggle is on Local, ask a question, assert the answer + `[data-exec-badge][data-plane="local"]` ("on your device").
  - **Cloud:** click the Cloud toggle, ask again, assert the cloud answer text + `[data-exec-badge][data-plane="cloud"]` ("via gateway").
- [ ] **Step 3 (CONTROLLER, background):** `cd apps/desktop && bun run test:e2e` — the full Tauri build (slow) then all specs (shell, auth-shell, ask, split-plane) green. Report.
- [ ] **Step 4:** commit — `test(desktop): E2E — split-plane local vs cloud answer + badge`.

---

## Task 6: contract check + acceptance + push

- [ ] **Step 1 (CONTROLLER):** desktop cloud-leg **contract** against a live C1 — run C1 (with `SUPABASE_JWT_SECRET` + routed to Ollama, as in Phase 2a), then `curl` C1 `/v1/chat` exactly as `cloud.ts` does (Bearer HS256 token, `chain:"local"`) and confirm a real gemma answer. (This proves the desktop→C1 contract; the full in-app real-token path is gated on the GoTrue signup fix — note it.)
- [ ] **Step 2:** `bun run test && bun run check && bun run lint` green; `cargo build` compiles.
- [ ] **Step 3:** update `apps/README.md` — Phase-2b: the Ask has a Local/Cloud plane toggle; cloud proxies to C1 with the JWT; provider keys stay on C1; note D4 (config sync/offline) + the real-token (GoTrue) follow-ups.
- [ ] **Step 4:** `make clean`, commit (`chore(phase2b): acceptance — desktop split-plane Ask (local + cloud via C1)`), and **push `develop`**.

---

## Self-review notes (author)
- **Spec coverage** (blueprint §8 Phase 2 desktop half, D3): cloud leg to C1 (Task 2), split-plane router (Task 3), plane selector + ExecBadge per plane (Task 4), E2E (Task 5), contract check (Task 6). **D4 (Realtime config sync + `update_config` + offline usage buffer) is explicitly deferred** to the next slice.
- **Deferred:** device-scoped token (F2 enrollment — the JWT alone is used now); config sync/hot-reload; offline buffer; a chain that spans both planes in a single trace (here the *user* picks the plane per Ask — true per-step split-plane routing is a later refinement).
- **Type consistency:** `InferResult { content, model?, plane, cost_usd, duration_ms }` is identical across `gateway.ts` (local), `cloud.ts` (cloud), and `route()` — so the `ask` store + Ask UI are plane-agnostic. `session.accessToken` (Task 1) is consumed by `cloud.ts` (Task 2).
- **Auth honesty:** the cloud leg requires a real session token; because local GoTrue signup 500s, the E2E stubs it and the real path is a flagged follow-up — no faking a passing real-token test.
