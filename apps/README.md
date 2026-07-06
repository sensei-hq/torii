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
| `packages/ui`   | Rokkit design system — `Pill`, `ExecBadge`, `AppShell`       | —     |
| `packages/core` | Data layer — `DataSource` interface, mock + Supabase adapters | —     |

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
# Unit tests (packages/ui × 4, packages/core × 1)
bun run test

# Type checks (tsc + svelte-check across all packages and apps)
bun run check

# Prettier formatting check
bun run lint

# Web E2E — fast, no build required (~5 s)
cd apps/admin && bun run test:e2e

# Tauri E2E — slow, builds the full Tauri app first (~2–3 min)
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

**Pending follow-up:** project-wide ESLint config (flat config + `eslint-plugin-svelte`) is
deferred to Phase 1. The `lint` scripts currently run `prettier --check .` only.
