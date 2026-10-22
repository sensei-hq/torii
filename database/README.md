# Seiki Database (Supabase / PostgreSQL)

PostgreSQL schema and seed data managed with `dbd` (DB Deploy).
No migrations — DDL is applied directly until the first versioned release.

## Prerequisites

- PostgreSQL 15+ (via Supabase or self-hosted)
- `dbd` CLI at the version CI pins (`DBD_VERSION` in `.github/workflows/coverage.yml`, currently
  0.27.5): `cargo install dbd-cli --version 0.27.5 --locked`
- Database URL in `.env.local`

## Quick Start

Run every command from `database/`.

### 1. A fresh database

`deploy` applies every DDL entity, imports the seeds and applies the RLS policies in one step
(`-e dev` adds the dev seeds, as `database/ci/bootstrap.sh` does):

```bash
dbd -e dev deploy
```

### Updating a database that already has the schema

`dbd apply` re-applies DDL but does not add a column to a table that already exists. Reconcile the
live schema to the design first, then deploy:

```bash
dbd -e dev reconcile --dry-run   # preview: CREATE / ALTER only
dbd -e dev reconcile
dbd -e dev deploy
```

`reconcile` is additive unless you pass `--allow-destructive` (dropping a column, a constraint or
an enum value) or `--prune` (dropping tables no longer in the design). Check the dry run before
either. A second `reconcile --dry-run` reports `Already in sync` once the database matches.

### Re-loading seed data only

`deploy` already imports the seeds. To re-load them alone, import the JSONL files into the staging tables and run the import procedures:

```bash
dbd import
```

The import pipeline (configured in `design.yaml`):

1. Truncates staging tables
2. Runs `import/permissions.sql` (PostgREST grants)
3. Loads JSONL files into `staging.*` tables
4. Runs `import/loader.sql` which calls import procedures in dependency order:
   - Phase 1: providers, routers, capabilities (independent)
   - Phase 2: models (depends on providers)
   - Phase 3: model_endpoints, model_capabilities (depends on models + routers + capabilities)
   - Phase 4: fallback_chains (depends on capabilities)
   - Phase 5: fallback_chain_models (depends on chains + routers + models)
   - Phase 6: modules, features (independent)
   - Phase 7: mcp_servers (independent)

## Schemas

| Schema    | Purpose                                 | Tables                                                                                                                                                                         |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config`  | Reference data (rarely changes)         | config_versions (most reference data has moved to catalog/governance per §D)               |
| `public`  | Runtime data (grows with usage)         | model_capabilities, model_endpoints, gateway_tasks, gateway_task_logs, sessions, session_logs, plans, planned_tasks, planned_task_interactions, documents, document_embeddings |
| `history` | Historization (audit trail)             | past_mcp_servers                                                                                                                                          |
| `staging` | Import staging (truncated before loads) | mirrors of 11 importable tables                                                                                                                                                |

## Folder Structure

```
database/
├── design.yaml              # dbd project config
├── .env.local               # DATABASE_URL
├── ddl/
│   ├── table/
│   │   ├── config/          # Config table DDLs
│   │   ├── public/          # Runtime table DDLs
│   │   ├── staging/         # Staging table DDLs
│   │   └── history/         # Historization table DDLs
│   ├── function/
│   │   ├── config/          # Trigger functions (historize_*)
│   │   └── public/          # Utility functions (similarity_search)
│   └── procedure/
│       └── staging/         # Import procedures (one per entity)
├── import/
│   ├── staging/             # 11 JSONL seed data files
│   ├── loader.sql           # Import orchestrator
│   └── permissions.sql      # PostgREST grants
├── seed/                    # Canonical seed data (JSON, camelCase)
└── loader.sql               # Legacy loader (use dbd import instead)
```

## Import Procedure Pattern

Each `staging.import_*()` procedure:

- Reads from `staging.*` (no constraints, natural keys like names)
- Joins to parent tables to resolve UUIDs
- Upserts into `config.*` or `public.*` via `INSERT ... ON CONFLICT DO UPDATE`
- Silently skips rows with missing parent references (inner join)
- Is idempotent — safe to re-run

## Seed Data

| Table                 | Rows | Source                                                                                     |
| --------------------- | ---- | ------------------------------------------------------------------------------------------ |
| providers             | 5    | OpenAI, Anthropic, Meta, xAI, Alibaba                                                      |
| routers               | 7    | openai, anthropic, azure_openai, aws_bedrock, openrouter, grok, ollama                     |
| capabilities          | 6    | chat, embedding, image, vision, audio, agent                                               |
| models                | 24   | GPT-4/3.5/4o, Claude 3/3.5/4.5, Grok 3, Llama 2/3.1/3.2, Qwen, DALL-E, Whisper, embeddings |
| model_endpoints       | 29   | Router-model bindings with pricing, rate limits, circuit breaker config                    |
| model_capabilities    | 25   | Model-capability mappings with performance metrics and limitations                         |
| fallback_chains       | 6    | chat, generate, fast, demo, cheap, local                                                   |
| fallback_chain_models | 26   | Ordered fallback sequences per chain                                                       |
| modules               | 4    | Curator, Analyst, Operator, Mixologist                                                     |
| features              | 14   | UI features per module                                                                     |
| mcp_servers           | 2    | torii, filesystem                                                                          |

## Design Documentation

See [docs/design/07-supabase.md](../../docs/design/07-supabase.md) for full details on schema design, table reference, and differences from Convex and FizzBot.
