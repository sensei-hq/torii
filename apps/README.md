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

**Next: Phase 1b** — local inference (`gateway-embedded`) + the real Ask screen (offline, on-device).
