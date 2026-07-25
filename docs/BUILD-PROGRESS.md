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
| **💰 Budget subsystem (C1/C3, P5)** | `/v1/chat`(+stream) resolve the caller's budget node (identity leaf via `ref_id` → tenant org root, **fail-closed**), hard-**reserve** worst-case → infer → **commit** actual (release surplus)/**release** on fail; `budget_nodes` amounts → `numeric(14,6)` (sub-cent accrual); default org node/tenant. **Attribution**: `budget_node_id` + denormalized `{org,dept,team,user}_node_id` path + `execution_location` (local/cloud). **Increase-request loop**: 402 returns `budget_node_id` → `/rpc/budgets/request` (cap `budget.request`) → `/rpc/budgets/approve-request`. **Idempotency-Key** honored on reserve. | Live: real call 200 + spend accrues ($0.000204) + attributed; $0.0005-cap leaf → **402**; deny→request→approve→retry→200; no leak |

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

## Unattended run

- **API-key auth (H2)** — ✅ **landed / pushed** to `origin/develop` (HEAD `b701c01`, "consume identity-bound API keys in require_auth"). Fail-closed, parameterized lookup, argon2id constant-time verify, JWT path unchanged; identity/budget/caps from the key's bound identity, never the key. Verified live on the isolated local stack (`chain:"local"`, $0): build clean, 10/10 adversarial assertions PASS, mint→200→revoke→401 round-trip, 0 secret leaks / panics / stray processes. Independently reviewed → APPROVED (one *informational* prefix-timing note, not a vulnerability).
- **Security audit** — full sweep across 8 dimensions (budget-integrity, rpc-privilege, tenant-isolation, auth, redaction-dlp, vault-crypto, secrets-logging, api-key-auth); report in [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md). **15 findings confirmed** (each verified against real code/DDL): **1 critical, 2 high, 6 medium, 6 low.** Top items: (C) idempotency-key hold reuse → K-1 free inferences (budget bypass); (H) reserve ignores input-token cost → hard-cap overshoot; (H) `rbac_assign_role` self-escalation to `owner`.
- **No remediation code was written this run** — findings are report-only. **Human review recommended before acting on findings.** No paid cloud calls; no secrets printed; stayed on `develop` inside the monorepo.
- **Security fixes (post-audit)** — **14/15 remediated + verified** in gated batches (build+tests+live re-verify per group): #1 critical (idempotency budget-bypass removed), #2/#3 high (input-cost reserve; `rbac_assign_role` subset+tenant guards), #4–#11 medium (DLP recall, claims-version fail-closed, JWKS anti-poisoning, cross-tenant RBAC, `has_capability` scope), #13–#15 low (zeroize, generic errors). #12 (audit atomicity) **MITIGATED** (error-level alert on audit-write failure). Consolidated re-verify: build clean, 29/29 unit, DB suite 7/7 (RLS confirmed sound; 2 test-infra bugs fixed).

## P6 — Governance / Audit / Quality (trust spine) — ✅ COMPLETE (no-RAG scope)

| Module | What | Verification |
|---|---|---|
| **C6 · quality capture** | one implicit `quality_signals` row per call (latency/cost/tokens/redactions/plane/success), keyed to the ledger | live: 1 row/call |
| **C6 · LLM-as-judge** | opt-in (default-off), async, self-budgeted, own ledger row; local **gemma4** ($0). Root-caused the empty-output bug: gemma4 is a **reasoning model** → needs `max_tokens≥512` to emit the score | live: judges score 1.0/0.9/1.0 |
| **O1 · append-only audit** | `audit_events` immutable even to `service_role` (trigger `forbid_mutation`) | `authz.sql` |
| **O1 · read surface** | capability-gated `GET /v1/audit` + `/v1/requests` (tenant-scoped, `audit.read`) | live 200 / 401 |
| **O1 · SIEM streaming** | background streamer → `siem` `notification_channels`, per-tenant `(created_at,id)` cursor, at-least-once, resume-after-restart | live: mock sink got 9 events, cursor advanced |
| **C4 · governance** | **output** redaction (model can't echo secrets) + heuristic injection scan + "why-this-model" trace → `governance` signal | live: `input_redactions=1, injection_suspected=true, why_model=…` |

**Deferred to P7 (need C5/RAG):** grounded-only citation coverage + per-space classification. **Follow-ups:** #12 full transactional audit atomicity; audit hash-chain tamper-evidence; a `/rpc` to manage SIEM channels; the heavier `crates/governance` refactor (shared with desktop D2).
