# Phase 0 Prerequisites: Global Bun Links

Before running `bun install` in any Strategos app or package, two sibling repos must be registered as global bun links. The `link:` protocol in `package.json` dependencies resolves to these registrations.

## Required repos

| Repo | Path |
|------|------|
| rokkit | `~/Developer/rokkit` |
| kavach | `~/Developer/kavach` |

---

## Registered packages

### `@rokkit/*` (from `~/Developer/rokkit`)

Already registered (do not re-link unless rebuilding the machine):

- `@rokkit/core`
- `@rokkit/states`
- `@rokkit/actions`
- `@rokkit/unocss`
- `@rokkit/themes`
- `@rokkit/ui`
- `@rokkit/app`

### `kavach` / `@kavach/*` (from `~/Developer/kavach`)

| Package name | Source dir |
|---|---|
| `kavach` | `packages/auth` |
| `@kavach/cookie` | `packages/cookie` |
| `@kavach/logger` | `packages/logger` |
| `@kavach/query` | `packages/query` |
| `@kavach/sentry` | `packages/sentry` |
| `@kavach/ui` | `packages/ui` |
| `@kavach/vite` | `packages/vite` |
| `@kavach/adapter-supabase` | `adapters/supabase` |

---

## Reproducing on a fresh machine

Run these commands once after cloning both sibling repos:

```bash
# kavach
for pkg in packages/auth packages/cookie packages/logger packages/query packages/sentry packages/ui packages/vite adapters/supabase; do
  (cd ~/Developer/kavach/$pkg && bun link)
done

# rokkit — the workspace registers its packages automatically; re-link if needed:
# (cd ~/Developer/rokkit && bun install && bun link)
```

Verify with:

```bash
ls ~/.bun/install/global/node_modules/@rokkit
ls ~/.bun/install/global/node_modules/@kavach
ls ~/.bun/install/global/node_modules/ | grep "^kavach$"
```

---

## Global links path

`~/.bun/install/global/node_modules/`
