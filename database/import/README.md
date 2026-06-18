# Seed import data

## Folder structure

```
database/import/
  staging/   — production catalog data (providers, models, routers, etc.)
  dev/        — dev-only data (platform tenant, DEK, router keys, MCP servers)
  loader.sql  — import procedure calls (run by dbd after staging tables are loaded)
```

## How to seed

**Production catalog only** (providers, models, routers, capabilities, endpoints, chains, modules, features):

```
dbd reset && dbd apply && dbd import
```

**Full dev environment** (catalog + tenant, DEK, router keys, MCP servers):

```
dbd reset && dbd apply && dbd import -e dev
```

The `-e dev` flag tells `dbd` to load `import/dev/*.jsonl` files into the staging
tables in addition to the `import/staging/` files. `loader.sql` then calls the
import procedures for all data including the dev-only tables.

## Dev KEK

The `dev/tenant_keys.jsonl` seed file contains a DEK encrypted with the canonical dev KEK:

```
STRATEGOS_KEK=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
```
(32 zero bytes, base64-encoded)

This is for development and testing only. Production environments must use a
different KEK and re-provision the DEK via `dbd import` with a fresh `tenant_keys.jsonl`.
