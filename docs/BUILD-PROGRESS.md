# Strategos — build progress

> Live status of the autonomous build against [`plans/roadmap.md`](plans/roadmap.md).
> Branch: `develop`. Authoritative decisions: [`DECISIONS.md`](DECISIONS.md).

## Done + verified

| Area | What | Verification |
|------|------|--------------|
| **MIG-1/2/3** | Rust workspace repinned to `sensei-*` v0.4.6; service + desktop migrated off the deleted `InferenceAdapter` → capability traits | `cargo check` green (both members); service boots |
| **P3 · F1-rework (RW1–RW15)** | Full security+scope rework: RBAC permission matrix, gateway-mediated writes, group-ACL retired, budget hard-reserve schema, MCP/api-keys/conversations/credential-vault/routing/quality/datasets/alerts tables, feature_states lockdown, 26-cap+6-role seed | `dbd reset/apply/policies/import` clean (115 entities); `tests/rls.sql` + `tests/authz.sql` |
| **F3 · credential vault** | AES-256-GCM DEK/KEK envelope — seal + unseal | `crypto.rs` 4/4 unit tests |
| **F2 · RBAC** | Server-side capability resolution from `role_ids`; claims-version freshness gate; JWT contract | `core.has_capability` (authz.sql); `capabilities.rs` |
| **C1 · gateway-mediated writes** | 6 `/rpc/*` endpoints (budgets upsert/approve, rbac assign-role, governance set-feature, spaces create) on the authorize() pattern (freshness → capability → service_role → actor-bound audit) | builds; boots; 401 on tokenless `/rpc` |
| **C2 · routing** | `resolve_chain` most-specific binding resolution | `tests/routing.sql` |
| **C3 · budgets** | Concurrency-safe hard `budget_reserve`/`commit`/`release` | `tests/budget.sql` (hard cap un-exceedable) |
| **C4 · governance** | Secret/PII redaction (DLP §2 W5), wired into the inference path | `redact.rs` 4/4; live in `/v1/chat` |
| **C5 · §3c** | Sensitive-data `dataset_safe_schema` (structure not values) + `k_anon_ok` | `tests/dataset.sql` |
| **X1 · MCP** | Default-deny `tool_allowed` allow-list resolver | `tests/tools.sql` |
| **Gateway issues** | GH-1 #37 (trace plane), GH-2 #36 (OAuth adapter) filed on `sensei-hq/gateway` | — |
| **Infra isolation** | Strategos on its **own** Supabase stack (project `strategos`, API 55321 / DB 55322); sensei-dojo untouched + cleaned | both stacks coexist; suite green on isolated DB |
| **🔓 Live auth E2E** | Real GoTrue signup → hook injects `tenant_id`+`role_ids`+`claims_version` → sign-in → **ES256 token → JWKS verify → capability gate** → `POST /rpc/budgets/upsert-node` **200** + actor-bound audit; viewer → 403 | verified against the real stack |
| **fix: signup-500** | RW2 broke `assign_tenant_by_domain` (old profile_tenants shape) → repaired (creates profiles anchor, SECURITY DEFINER, default role) | signup works |
| **☁️ Live cloud inference (C1)** | Real tenant-bound ES256 token → JWKS → auth → chain routing (`chat`) → **C4 redact-in-flight** → **authenticated Anthropic call** → real answer; `inference_calls` ledger row written (adapter/model/api_model_id/tokens/cost/status) | `POST /v1/chat` **200** `"Strategos live."`, $0.000168, ledger `after=1` |
| **fix: router base-url double-`/v1`** | Seeded `api_base_url` carried a trailing `/v1` (`/api/v1` for openrouter), but the sensei adapters append `/v1/messages`\|`/v1/chat/completions` → double `/v1` → provider 404. Stripped the version segment from **anthropic/openai/openrouter/grok** in `routers.jsonl` | anthropic call 200 after fix; others audited + corrected |

Full suite: `DATABASE_URL=postgresql://…@127.0.0.1:55322/postgres database/tests/run.sh` → all 7 harnesses green. **Live auth path now works with real Supabase tokens** (the earlier `/rpc` gate was the only unverified piece — now closed).

## In progress / next (roadmap P5→)

- **C1 hot-path wiring** — the inference path itself is now **proven live** (auth→route→redact→provider→ledger). Remaining: resolve identity→budget node + `budget_reserve`→infer→`budget_commit` (C3 hard-cap) around the call, `inference_calls.subject_id`/`tier` attribution, and per-request F3 vault key injection (replacing the env-key shim).
- **C5 RAG runtime** — ingestion (markdown-first parse, dedup, chunking, embed), retrieval default stack. *(`similarity_search` 1024-dim ready.)*
- **C6 quality signals** capture; **O1** SIEM stream; **O2** rollups; **O3** device fleet.
- **W1–W5 web clients** (SvelteKit + Rokkit) — admin portal, member console, playground, design system, marketing.

## Human inputs still needed (front-load before their phase)

- ✅ ~~Supabase JWKS + auth~~ — RESOLVED (isolated stack, ES256/JWKS, hook enabled; live auth verified).
- ✅ ~~Paid-provider-call approval + provider key~~ — RESOLVED (Anthropic key supplied via `.env.local`; real `/v1/chat` → Anthropic **200** verified, $0.000168, ledger row written; key never surfaced in logs).
- **Anthropic OAuth** client (client_id/secret/redirect/scopes) — with GH-2, when the OAuth connect flow is built.
- **KMS/KEK** for a hosted deploy (local dev uses `STRATEGOS_KEK`; I re-seed `tenant_keys` under a dev KEK for live vault tests).
