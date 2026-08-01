---
title: v1 roadmap — completion audit, code-review sweep, and doc gaps
description: What of the canonical P0–P14 roadmap is built vs pending (verified against the live stack), duplication/optimization findings, and doc/code drift to resolve.
type: analysis
status: analysis-complete
created: 2026-07-27
depends_on:
  - docs/plans/roadmap.md
  - docs/DECISIONS.md
related_issues: []
references:
  - services/gateway/src/routes/chat.rs
  - services/gateway/src/vault.rs
  - services/gateway/src/crypto.rs
  - gateway/crates/kernel/src/types/trace.rs
  - database/tests/authz.sql
---

# v1 roadmap — completion audit, code-review sweep, and doc gaps

## Objective
Answer three questions and inform what to build next: (1) of the canonical 14-phase / 23-module
roadmap, what is **done vs pending**? (2) where is there **duplication / optimization** debt? (3) what
**doc gaps** did the actual build surface that we should resolve?

> **Tooling note:** the sensei code-graph is indexed against the `sensei-hq/sensei` tooling repo, **not
> torii** (`get_project_summary` → name="sensei"; `get_duplicates` → 0 over the wrong tree).
> So MCP `search`/`get_patterns`/`get_duplicates` can't see this codebase — findings below come from
> direct inspection + git history + the live stack (gateway on :8788, local Supabase 55322). Re-point
> the sensei index at this repo to make those tools useful here.

## Current state (verified P0–P14)

Legend: ✅ done · 🟡 partial · ⛔ pending.

| Phase | Module(s) | Status | Evidence |
|---|---|---|---|
| P0 Scaffold + design system | W4 | ✅ | bun+Cargo workspaces, `packages/ui`+`core`, Zen-Sumi/Rokkit skin, both apps boot |
| P1a Desktop shell + client auth | D1, F2· | ✅ | Tauri shell, client-only Kavach session, e2e 5/5 |
| P1b Local inference + Ask | D2·, W2·Ask | ✅ | in-process embedded engine, local Ask $0, Local Models screen |
| P2a Central gateway | C1·cloud | ✅ | Axum `services/gateway`, RS256 JWT verify, config from Postgres, `/v1/chat`+SSE, `inference_calls` |
| P2b Split-plane skeleton | D3· | ✅ | desktop per-answer Local/Cloud toggle, Compare screen |
| **P3 F1 security REWORK** | F1 RW1–RW15 | ✅ | `database/policies/rework.sql` + full harness (`authz/rls/budget/routing/dataset/tools/analytics.sql`) |
| P4 Identity/RBAC + Key vault | F2·full, F3 | 🟡 | F2 RBAC matrix + capability JWT + device lifecycle ✅. F3 **crypto/decrypt path built** (`vault.rs`/`crypto.rs`, real AES-GCM DEK/KEK). **Missing:** admin connect/rotate UI, OAuth connect + refresher, prod KMS KEK. `router_keys`=0 rows → vault **dormant**; live keys come from **ENV** |
| P5 Gateway harden + Routing + Budgets | C1·harden, C2, C3 | ✅ | `/rpc/*`-mediated writes, C3 hard reserve→commit (proven live), C2 chains + step enable/disable + `autoFallback` enforced (this session) |
| P6 Governance + Ledger + Quality | C4, O1, C6 | 🟡 | C4 masking/DLP redaction ✅, O1 audit + SIEM streamer ✅, C6 quality signals + LLM-judge ✅. **Gap:** stream path omits the governance `quality_signals` row (see review #4) |
| P7 RAG + Document center | C5 | ⛔ | no ingestion/retrieval service; only referenced in comments. `document_embeddings` table exists (F1) but no pipeline |
| P8 Admin Portal | W1 | ✅ | all 9 screens real + `/rpc/*` writes wired (verified this session) |
| P9 Member Console + Playground | W2·full, W3 | 🟡 | Ask/Playground/Activity real; **W2 Library + full retrieval-mode Playground blocked on C5 (P7)** |
| P10 Device-plane completion | D2·full, D4, D3·full, O3 | 🟡 | O3 device-status enforced ✅; D4 config-sync/Realtime hot-reload, D2 full registry, D3 unified trace pending |
| P11 Tools & MCP | X1 | 🟡 | admin screen + role×tool allow-list DB ✅; **runtime enforcement pending** (no MCP tool-call loop → grants unenforced) |
| P12 Analytics & cost insights | O2 | ⛔ | no `/v1/analytics/*` routes; `analytics.sql` schema only |
| P13 Agents (design-only) | X2 | 🟡 | Workflows screen = v2-preview card; no runtime tables (as intended) |
| P14 Marketing + SSO/SCIM | W5, F2· | ⛔ | fast-follow, not started |

**Headline:** walking skeleton (P0–P2b) and the security rebuild core (P3, P5, most of P6) are **done**;
W1 admin (P8) is done. The **material holes** are F3's credential-storage/OAuth surface (P4), C5 RAG
(P7, which blocks P9 breadth), and the still-open **GH-1 per-step plane** (blocks accurate P10/P12).

## Feasibility
All gaps are additive on the current architecture — no rebuild implied. The one that touches the
**security premise** (and so ranks highest) is P4/F3: the vault crypto is built and correct, but real
provider keys currently live in **env vars** (`2/6 routers have a provider key in env`) while the vault
sits dormant (`router_keys`=0). The roadmap's own gate — *"F3 must precede C1 handling any real
credential"* — is satisfied only in the skeleton sense (env keys), and there's no doc capturing that
interim or its exit.

## Code-review sweep (services/gateway — the changed surface)

1. **Duplication — `post_chat` vs `post_chat_stream`** (`routes/chat.rs`): ~60 lines of the
   `InferenceCall` persist + `record_call_signals` + `exec_loc` heuristic are copy-pasted between the
   two handlers. Extract a shared `persist_call(...)` helper.
2. **Fragile heuristic, duplicated** — `execution_location` is derived from
   `adapter.contains("embedded"|"ollama"|"llama")` in both handlers. This is a stand-in for **GH-1**
   (per-step `plane` on the crate trace, still unbuilt). It mislabels any cloud adapter whose name
   contains those substrings, and feeds C6/O2. Land GH-1, then read the real plane.
3. **Hot-path query fan-out** — each `/v1/chat` issues sequential single-row reads:
   `masking_enabled`, `auto_fallback_enabled` (added this session), `ensure_model_enabled`
   (`tenant_model_state`), plus `judge_enabled` (`feature_policies`). The first two hit the *same*
   `tenant_settings` row-set and could be one `where setting_key in ('masking','autoFallback')`;
   the per-tenant policy set is a caching candidate. Low urgency, but it's avoidable latency on the
   paid path.
4. **Consistency gap (correctness)** — `post_chat_stream` records `record_call_signals` but **not** the
   governance `quality_signals` row (injection scan, `why_model`, redaction counts) that `post_chat`
   writes. Streamed calls are therefore invisible to C4/C6 governance analytics — same class as the
   earlier stream-redaction gap. Should emit parity.

## Doc gaps (to discuss/resolve)

- **G1 — no live completion tracker.** `roadmap.md` (2026-07-23) predates the build and has no
  done/pending column; status lives only in session memory. This audit table is the first repo-side
  reconciliation.
- **G2 — F3 env-key interim undocumented.** Nothing captures that C1 runs on **env provider keys** with
  the vault dormant, nor the exit criterion (when `router_keys` becomes authoritative and the env path
  retires). This is a security-relevant state the roadmap's F3 gate glosses over.
- **G3 — GH-1 placeholder not flagged.** `execution_location` ships as a heuristic; no doc marks it a
  temporary stand-in, risking "plane split = done" when P12/D3 read a guess.
- **G4 — rebrand drift.** Code is torii/seiki; docs, DB `project_id`, env vars, and ~164 prose mentions
  still say "Torii" (deferred per memory). Growing doc/code divergence.
- **G5 — P9 ordering.** W2 Library + full Playground were partially built then blocked-in-place on C5
  (P7); the P9 plan doesn't flag C5 as a hard predecessor for those surfaces.

## Approaches (what to close next — pick one to sequence)

### Option A: Close the security-premise gaps (F3 write-path + retire env keys)
Build admin Connections connect/rotate → store sealed creds in `router_keys`; make the vault the
authoritative credential source on the C1 hot path; wire the Anthropic OAuth connect + refresher; doc
the env→vault cutover (G2).
- Pros: directly serves the core promise (secure budgeted access); closes a live security gap; F3 crypto
  already exists so it's write-path + UI, not new crypto.
- Cons: touches auth/credential handling (careful review); needs the OAuth client (human input, P4 §4).
- Effort: **M** (vault write path + one admin screen + refresher worker).

### Option B: Build C5 RAG document center (P7)
Markdown-first ingestion + versioning + composable retrieval + redact-at-rest, unblocking W2 Library and
the full Playground (P9).
- Pros: largest product-surface unlock; turns two partial phases green.
- Cons: biggest single phase; needs Supabase Storage; no security-gap urgency.
- Effort: **L**.

### Option C: Consolidation + GH-1 (pay down what this review found)
Fix the stream governance-signal gap (#4), extract `persist_call` (#1), consolidate hot-path
`tenant_settings` reads (#3), land GH-1 per-step plane and replace the `exec_loc` heuristic (#2), and add
the live completion tracker (G1) + rebrand-drift pass (G4).
- Pros: low-risk, high-correctness; removes a real analytics blind spot; makes P10/P12 trustworthy.
- Cons: no new user-facing surface; GH-1 is a cross-repo crate change (needs a release bump).
- Effort: **S–M**.

## Recommendation
**Chosen 2026-07-27: Option A** (F3 credential surface) — proceed to `/sensei:blueprint`. Original
recommendation retained below.

Sequence **A → C → B**. A closes the one gap that touches the security premise (the core product
promise) and the crypto is already built, so it's the highest value-to-risk. C is a small, correctness-
focused sweep that also fixes the streamed-call governance blind spot (#4) — worth folding in next. B
(C5) is the biggest breadth unlock but has no urgency and is a phase unto itself; schedule it once the
security surface is closed. Fix **#4 (stream governance-signal parity)** opportunistically regardless —
it's a live correctness gap, not just cleanup.
