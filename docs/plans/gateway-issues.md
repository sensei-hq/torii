---
title: Gateway crate — enhancement backlog (owned by Torii)
description: Enhancements to sensei-hq/gateway (v0.4.6) that Torii owns; each filed as a gateway-repo issue (create → implement → close) and released via the lockstep tag bump, sequenced before its dependent Torii phase.
type: plan
status: backlog
created: 2026-07-23
depends_on:
  - docs/DECISIONS.md
---

# Gateway crate — enhancement backlog

Per [`../DECISIONS.md`](../DECISIONS.md) §3/§7, crate enhancements are **owned in this project** (not a separate session): each is filed as a **gateway-repo issue → implemented → closed**, released via the lockstep tag bump (`develop → make bump → main → develop`), and **sequenced before its dependent Torii phase**. This is the tracked backlog; issues are filed on GitHub when the dependent phase is scheduled. All line/type references verified against the crate on disk at `v0.4.6` during the 2026-07-23 analysis — re-verify at file time.

| # | Enhancement | Why / dependent Torii work | Blocking? | Sequence before |
|---|-------------|-------------------------------|-----------|-----------------|
| GH-1 | **Per-step `plane` + execution-location on the trace** — add `plane` (`local\|cloud`) to `ChainEntry` (`sensei-kernel::types::config`) and an execution-location field to `Attempt`/`ExecutionTrace` (`kernel::types::trace`). Confirmed absent. | D3 unified split-plane trace; C2 per-step plane binding; C4 "why this model"; O1 ledger `execution_location`; O2 plane-split savings; W2/W1 exec-location badges. | **Yes** | C2 / D3 phase |
| GH-2 | **OAuth/bearer provider-credential support** in `sensei-cloud-providers` — `RouterConfig` carries only `api_key`/`api_key_env` and `base.rs::resolve_api_key` does static `bearer_auth(key)`; no OAuth access/refresh/expiry or 401-triggered refresh. Add first-class bearer/OAuth-token credentials that cooperate with the F3 background refresher. | F3 `router_credentials` `type=oauth` (Anthropic-style accounts) can't make real calls until the adapter accepts a bearer/OAuth credential. | **Yes** | F3 / C1 phase that handles a real OAuth account |
| GH-3 | **Local embedding path — RESOLVED (not a crate enhancement).** Desktop local plane = **embedded in-process**: `sensei-local-providers::EmbeddedLlamaAdapter` (llama.cpp; chat+embed; runs GGUF, reuses Ollama/HF-pulled bytes, no daemon) or `OrtAdapter` (ONNX embed). `sensei-cloud-providers::OllamaAdapter` = HTTP router option. Just pick a 1024-dim embed model + wire the embedding chain; `fastembed` disabled. | C5/D2 local RAG. | No (resolved) | — |
| GH-4 | **Hard budget reserve→commit affordance** — verify the `sensei-gateway` budget filter is soft/affordability-only; if it can't do a concurrency-safe pre-call reserve, either expose a reserve callback / typed budget decision on `Attempt`, or confirm reserve→commit is implemented consumer-side against `inference_calls`. | C3 hard-cap enforcement (DECISIONS §2 W2) — "cannot be exceeded under concurrency". | Decide | C3 phase |
| GH-5 | **`inference_calls` ledger shape** — verify the crate owns/writes the `GatewayStore` `inference_calls` schema; if so, extend with org→dept→team→user attribution columns + a rollup-friendly shape. | F1 single-ledger consolidation; C3 rollup; O1/O2 analytics attribution. | Decide | F1-rework / C3 |
| GH-6 | **Streaming-safe governance/redaction hook** — no in-engine hook exists; redacting `execute_stream` output before egress may need a crate stream-transform/interception point (else buffer-the-whole-response, which defeats streaming). | C4 redaction/DLP (§2 W5) on streamed answers. | Investigate | C4 phase |
| GH-7 | **MCP / tool-calling support** — no `mcp` crate among the six; determine whether the engine exposes a tool-call/MCP interface or hook, or whether X1 builds tool invocation consumer-side in C1/C4 (with allow-list enforcement + SSRF/sandbox). | X1 (MCP in v1). | Investigate | X1 phase |
| GH-8 | **`RerankModel` trait (deferred/optional)** — `TextRerank` is a reserved `Unsupported` variant. Until a trait exists, C5 cross-encoder rerank runs as a **separate C5 service**. | C5 rerank / W3 rerank-model picker. | No (v1 uses C5 service) | later |

## Torii-side crate-migration tasks (NOT gateway-repo issues)

These are Torii code/config fixes to the **v0.4.6** crate reality — do them at the start of the reworked Phase 2a (needs the real API + a compile loop; do not blind-edit in the doc phase):

- **MIG-1 · root `monorepo/Cargo.toml` `[patch]`** — targets `gateway` + `gateway-embedded` at `../gateway/crates/*`. `gateway-embedded` **does not exist**; verify the real package names (the crate dir is `crates/gateway` but its package name may be `sensei-gateway`) and repin the patch to the actual `sensei-*` packages. Local engine = `sensei-local-providers`/`sensei-local-engine` (not `gateway-embedded`).
- **MIG-2 · `services/gateway/src/main.rs`** — uses `gateway::adapters::{AdapterRegistry, InferenceAdapter}`; `InferenceAdapter` is **deleted** (→ capability-segregated traits `ChatModel`/`EmbedModel`/…). Rewrite adapter registration to the v0.4.6 `AdapterRegistry` + `RegisterInto`/capability-trait model. Verify `AdapterRegistry::with_defaults()` (or per-adapter registration) against the crate.
- **MIG-3 · `services/gateway/Cargo.toml` + desktop `src-tauri/Cargo.toml`** — depend on `sensei-gateway` (+ local crates for the desktop embedded path) at the pinned `v0.4.6` git tag; drop `gateway-embedded`. Confirm the git dep + `[patch]` keying resolves.
- **MIG-4 · phase-plan docs (0/1b/2a/2b)** — reconcile all `gateway`/`gateway-embedded`/`InferenceAdapter`/`gemma2:2b`-via-Ollama-read-through wording to the v0.4.6 model (embedded = `EmbeddedLlamaAdapter` in `sensei-local-providers`, in-process GGUF, no daemon). Done as part of Step 4c phase-plan authoring.

> **GH-3 resolved 2026-07-23:** the embedded in-process path (`EmbeddedLlamaAdapter`) already exists — no crate enhancement needed; only a 1024-dim model pick + embedding-chain wiring (no external daemon for the embedded path).
