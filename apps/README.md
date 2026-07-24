# Strategos — Contributor Guide

## Prerequisites

- **Bun** ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
- **Globally bun-linked packages** — `@rokkit/*` and `kavach`/`@kavach/*` must be registered
  before `bun install`. See [`docs/plans/phase-0-prereqs.md`](../docs/plans/phase-0-prereqs.md)
  for the full list and setup steps.
- **Rust + Tauri toolchain** — needed only for desktop builds.
  Install Rust via `rustup`, then `cargo install tauri-cli --version '^2'`.

After the links are in place, install from the monorepo root:

```bash
bun install
```

---

## Layout

| Path            | Description                                                  | Port  |
| --------------- | ------------------------------------------------------------ | ----- |
| `apps/admin`    | Web SaaS portal — SvelteKit → Cloudflare Pages adapter       | 5273  |
| `apps/desktop`  | Native desktop client — Tauri 2 + SvelteKit static adapter   | 5274  |
| `packages/ui`   | Rokkit design system — atoms + shell chrome (`DesktopShell`, ⌘K) | —     |
| `packages/core` | Data layer + auth — `DataSource`, kavach client-only session | —     |

---

## Run

```bash
# Web dev servers (from monorepo root)
bun run dev:admin      # http://localhost:5273
bun run dev:desktop    # http://localhost:5274 (Vite client only)

# Desktop native window (Tauri hot-reload)
cd apps/desktop
bun run tauri dev
```

---

## Test

```bash
# Unit tests (packages/ui × 7, packages/core × 4)
bun run test

# Type checks (tsc + svelte-check across all packages and apps)
bun run check

# Lint — Prettier format-check + ESLint
bun run lint

# Or drive everything via the Makefile
make help          # build / test / check / lint / e2e / clean / clean-cache / clean-all

# Web E2E — fast, no build required (~7 s)
cd apps/admin && bun run test:e2e

# Tauri E2E — builds the full Tauri app first (~3 min incremental; ~20 min cold after `make clean`)
cd apps/desktop && bun run test:e2e
```

---

## Phase-0 status

Foundations complete:

- Bun + Cargo workspace wired
- `packages/ui` — Rokkit Zen-Sumi skin, three components, 4 vitest tests
- `packages/core` — `DataSource` interface, mock + Supabase adapters, tsc-clean
- `apps/admin` — SvelteKit + kavach hybrid auth, svelte-check clean, web E2E passing
- `apps/desktop` — Tauri 2 + SvelteKit static, cargo crate compiles, Tauri E2E passing
- Shared Prettier config (house style: single quotes, no semis, tabs for .svelte/.ts/.js)

## Phase-1a status

Desktop shell + client-only auth complete:

- `packages/ui` — env/device atoms (`EnvChip`, `DeviceFooter`, `OfflineBanner`, `DesktopOnlyNote`) +
  shell chrome (`TitleBar`, `NavRail`, `DesktopShell`, ⌘K command palette)
- `packages/core` — **Kavach client-only session** (supabase `persistSession` + `createKavach` +
  `session.svelte.ts` runes store) + a client-side `@kavach/sentry` route guard
- `apps/desktop` — sign-in screen, guard redirect, `DesktopShell` layout + console nav routes;
  Tauri E2E covers seeded-auth → shell (3/3 passing)
- **ESLint** flat config (TS + Svelte) now enforced in `lint`; **Makefile** added —
  `make clean` reclaims the Rust `target/` + Tauri bundles (run it after heavy builds)

**E2E test seam:** the desktop seeds a fake member session only when built with `VITE_E2E=true`
(set by `apps/desktop/e2e/globalSetup.ts`) — never in production.

## Phase-1b status

Local inference + Ask complete — the desktop answers **on-device, offline, $0**:

- `apps/desktop/src-tauri` — embeds **`gateway-embedded`** (`llama-cpp` feature, Metal-accelerated) via
  the root `[patch]` → sibling `../gateway`; builds an `Arc<Gateway>` at startup
  (`EmbeddedLlamaAdapter` over a `ChainedResolver(~/.strategos/models → ~/.ollama/models)`) held in
  Tauri state. Default local chat model **`gemma2:2b`** (read-through of the Ollama blob — no download).
- IPC commands `infer` / `list_models` / `gateway_status` (`#[tauri::command]`); the frontend calls them
  via `src/lib/gateway.ts` + the `ask.svelte.ts` runes store.
- `apps/desktop` — the real **Ask screen** (composer + conversation + `ExecBadge` "on your device") and a
  **Local Models** screen; the console nav gains `Models`.
- **No streaming** (gateway-embedded limitation) — Ask shows a loading state then the full answer.
- Verified: a Rust `#[ignore]` `infer_smoke` runs a real `gemma2:2b` completion; the Tauri E2E
  (`ask.spec.ts`, with a `VITE_E2E`-stubbed infer for determinism) asserts ask → on-device answer (4/4 passing).

## Phase-2b status

Desktop **split-plane** Ask complete — one Ask UI, two execution planes:

- **Local plane** — in-process embedded engine (`EmbeddedLlamaAdapter` via Tauri IPC), `ExecBadge`
  "on your device", $0.
- **Cloud plane** — `src/lib/cloud.ts` proxies `POST /v1/chat` to the **C1** gateway
  (`PUBLIC_GATEWAY_URL`, default `http://127.0.0.1:8787`) with the Supabase JWT; `ExecBadge`
  "via gateway". **Provider keys never touch the desktop** — cloud inference is C1's job.
- `src/lib/plane.ts` routes per the Ask header's **Local / Cloud** toggle; `ask.svelte.ts` holds the
  `plane` state. Tauri E2E (`split-plane.spec.ts`, both legs `VITE_E2E`-stubbed) asserts each plane's
  answer + badge (**5/5 desktop specs passing**).
- Verified against a live C1: the exact `cloud.ts` request (Bearer JWT + `chain:"local"`) returns a
  real Ollama answer at $0 — the desktop→C1 contract holds with a **real in-app token** (the earlier
  GoTrue signup-500 that forced an HS256 workaround is now fixed).
- **Deferred (D4):** Realtime config sync / hot-reload + the offline usage buffer — the next device slice.

### macOS build note

The desktop's `llama-cpp-sys-2` (vendored llama.cpp) uses `std::filesystem`, which libc++ gates behind
a macOS deployment target ≥ 10.15. `apps/desktop/src-tauri/.cargo/config.toml` sets
`MACOSX_DEPLOYMENT_TARGET=11.0` so the native build works on newer toolchains (Apple clang 17 / cmake 4).
If a build predates that config, clear the stale cmake cache once: `cargo clean -p llama-cpp-sys-2`.

**Next:** central-plane hardening (P4 identity/RBAC + F3 vault live, P5 routing/budgets — some steps
need provider OAuth clients / KMS-KEK inputs) or the W1 Admin Portal on the proven gateway.
