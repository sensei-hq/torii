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
| **🖥️ Walking skeleton (P0–P2b)** | Desktop client done: shell + Kavach client-only auth (P1a), in-process local Ask (P1b), C1 cloud passthrough (P2a), and **D3 split-plane** (P2b) — Ask Local/Cloud toggle; cloud leg proxies `/v1/chat` to C1 with the JWT (keys stay on C1); per-plane `ExecBadge` | 5/5 desktop Tauri E2E green; live desktop→C1 contract check (real token, $0) |
| **fix: desktop macOS build** | `llama-cpp-sys-2` (vendored llama.cpp `std::filesystem`) needs macOS deploy target ≥ 10.15 → set `MACOSX_DEPLOYMENT_TARGET=11.0` in `src-tauri/.cargo/config.toml` (was blocking the whole Tauri build on clang 17/cmake 4) | Tauri app builds + bundles; E2E runs |
| **💰 Budget hot-path (C1/C3, P5)** | `/v1/chat`(+stream) resolve the caller's budget node (identity leaf via `ref_id` → tenant org root, **fail-closed**), hard-**reserve** worst-case → infer → **commit** actual (release surplus)/**release** on fail; `subject_id := budget_node_id` persisted; `budget_nodes` amounts → `numeric(14,6)` (sub-cent accrual); default org node seeded per tenant | Live: real call 200 + spend accrues ($0.000204) + reserved released + ledger attributed; $0.0005-cap leaf → **402**; no reserve leak |

Full suite: `DATABASE_URL=postgresql://…@127.0.0.1:55322/postgres database/tests/run.sh` → all 7 harnesses green. **Live auth path now works with real Supabase tokens** (the earlier `/rpc` gate was the only unverified piece — now closed).

## In progress / next (roadmap P5→)

- **C1 hot-path wiring** — ✅ **done + proven live** (auth→route→redact→**reserve→provider→commit**→attributed ledger; hard cap enforced, fail-closed). Remaining follow-ups: full GH-5 ledger columns (`{org,dept,team,user}_node_id` path + `execution_location` + `hold_id` — only `budget_node_id` populated now), reserve idempotency key, API-key identity (H2), and per-request F3 vault key injection (replacing the env-key shim). Soft-overshoot / free-floor / `budget_requests` are separate C3 features.
- **C5 RAG runtime** — ingestion (markdown-first parse, dedup, chunking, embed), retrieval default stack. *(`similarity_search` 1024-dim ready.)*
- **C6 quality signals** capture; **O1** SIEM stream; **O2** rollups; **O3** device fleet.
- **W1–W5 web clients** (SvelteKit + Rokkit) — admin portal, member console, playground, design system, marketing.

## Human inputs still needed (front-load before their phase)

- ✅ ~~Supabase JWKS + auth~~ — RESOLVED (isolated stack, ES256/JWKS, hook enabled; live auth verified).
- ✅ ~~Paid-provider-call approval + provider key~~ — RESOLVED (Anthropic key supplied via `.env.local`; real `/v1/chat` → Anthropic **200** verified, $0.000168, ledger row written; key never surfaced in logs).
- **Anthropic OAuth** client (client_id/secret/redirect/scopes) — with GH-2, when the OAuth connect flow is built.
- **KMS/KEK** for a hosted deploy (local dev uses `STRATEGOS_KEK`; I re-seed `tenant_keys` under a dev KEK for live vault tests).
