---
title: 'Phase 1b · Local inference + Ask — implementation plan'
description: Embed gateway-embedded (llama-cpp + Ollama read-through of gemma2:2b) in-process in the Tauri desktop app, expose infer/list_models over IPC, and build the real Ask screen answering offline/$0 with an on-device ExecBadge.
type: plan
status: plan
created: 2026-07-06
depends_on:
  - docs/design/clients-buildout.md
  - docs/plans/phase-1a-shell-auth-plan.md
references:
  - docs/modules/D2-local-gateway.md
  - docs/modules/D3-split-plane-router.md
  - docs/modules/W2-member-console.md
  - docs/mockups/app/view-ask.jsx
  - docs/mockups/app/view-models.jsx
milestone: Phase-1b
---

# Phase 1b · Local inference + Ask — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. For `.svelte` files use the **svelte** skill/MCP; named Rokkit tokens only (`data-skin`, no `-z{n}`). eslint + prettier are enforced (`bun run lint` = 0 errors). **Heavy Rust/Tauri builds (llama-cpp compile, tauri build) must be run via a BACKGROUND shell, not inside a subagent** — the cold build exceeds the subagent watchdog (~10 min) and the llama.cpp compile is longer. Dispatch the code, but let the controller run the long `cargo build`/`test:e2e` in the background and report the result.

**Goal:** The desktop client answers a question **on-device, offline, $0**. `gateway-embedded` runs `gemma2:2b` in-process (llama-cpp, via the Ollama read-through of the already-downloaded blob); the real Ask screen sends a prompt over Tauri IPC to the engine and renders the answer with an `ExecBadge` reading "on your device" — with the network off. This is the walking-skeleton payoff of the whole client.

**Architecture:** Mirror Sensei's engine construction but **in-process** (no daemon): `apps/desktop/src-tauri` depends on `gateway` + `gateway-embedded` (feature `llama-cpp`), builds an `Arc<Gateway>` at startup (AdapterRegistry + `NoopAdapter` + `EmbeddedLlamaAdapter` over a `ChainedResolver(ManagedResolver(~/.strategos/models) → OllamaResolver(~/.ollama/models))` + a baseline `GatewayConfig` with a `gemma2:2b` chat model), holds it in `tauri::State`, and exposes `infer` / `list_models` as `#[tauri::command]`s. The SvelteKit frontend calls them via `@tauri-apps/api` `invoke`, wrapped in an `ask.svelte.ts` runes store. `gateway-embedded` has no streaming → Ask is non-streaming (full response). Everything is the "local" plane in 1b; the cloud plane + split-plane router are Phase 2.

**Tech Stack:** Rust · Tauri 2 · `gateway` + `gateway-embedded` (`llama-cpp` feature, via git dep + root `[patch]` → sibling `../gateway`) · `@tauri-apps/api` `invoke` · SvelteKit static/Svelte 5 · Rokkit · Playwright.

**Reference (copy the real wiring):** Sensei at `/Users/Jerry/Developer/sensei-hq/sensei`:
- `crates/senseid/src/api/gateway_init.rs` — `init_gateway()` (AdapterRegistry, Noop, embedded llama registration, `Gateway::new`, `baseline_production_config`).
- `crates/senseid/src/api/gateway_embedded.rs` — the `#[cfg(feature)]` `EmbeddedLlamaAdapter::with_shared_backend(id, ChainedResolver(...))` registration + the ManagedResolver/OllamaResolver dirs.
- `crates/senseid/src/api/handlers/gateway.rs` — the `infer`/`embed` request→`InferenceRequest`→`gateway.execute()` mapping (`Capability::TextChat`, `Payload::Chat { messages, system, max_tokens }`).
- `crates/senseid/src/api/state.rs` — `Arc<Gateway>` in shared state.

**Prerequisites:** Phase 1a complete (desktop shell + auth, on `develop`). Ollama models present (`gemma2:2b`, `all-minilm`). Rust + the native build toolchain for `llama-cpp-2` (cmake + a C/C++ compiler — present since this machine builds sensei). Branch **develop**; commit per task; `make clean` + push at the end.

---

## File structure (created/modified)

```
apps/desktop/
  src-tauri/
    Cargo.toml                    # + gateway, gateway-embedded (feature llama-cpp)
    src/gateway.rs                # build Arc<Gateway> (init_gateway-style) + baseline config
    src/commands/infer.rs         # #[tauri::command] infer, list_models, gateway_status
    src/commands/mod.rs
    src/lib.rs                    # .manage(build_gateway()) + generate_handler![...]
  src/lib/
    gateway.ts                    # typed invoke() wrappers: infer(), listModels()
    ask.svelte.ts                 # runes store: messages, send(), loading, lastExec
  src/routes/(app)/
    +page.svelte                  # Workspace: quick "Ask" entry (light touch)
    ask/+page.svelte              # REAL Ask screen (replaces placeholder)
    models/+page.svelte           # Local Models screen (new route; add 'Models' consideration)
  e2e/tests/ask.spec.ts           # E2E: ask → local answer + ExecBadge (VITE_E2E stubbed infer)
packages/ui/src/lib/
  Composer.svelte                 # chat composer atom (+ maybe reuse)  (optional, or inline)
```

> **Model note:** default local chat model = **`gemma2:2b`** (resolved from `~/.ollama` via `OllamaResolver`). Embeddings (`all-minilm`) are NOT needed for 1b (no local RAG yet) — skip fastembed for now; add only the `llama-cpp` feature.

---

## Task 1: `src-tauri` — embed `gateway-embedded` + build the engine

**Files:** modify `apps/desktop/src-tauri/Cargo.toml`; create `src/gateway.rs`; modify `src/lib.rs`.

- [ ] **Step 1: add engine deps to `apps/desktop/src-tauri/Cargo.toml`.** Depend on `gateway` + `gateway-embedded` via the SAME git URL the root `[patch]` targets so the patch redirects them to the local sibling `../gateway`:
```toml
[dependencies]
# ... existing tauri deps ...
gateway          = { git = "https://github.com/sensei-hq/gateway" }
gateway-embedded = { git = "https://github.com/sensei-hq/gateway", features = ["llama-cpp"] }
tokio            = { version = "1", features = ["rt-multi-thread", "macros", "sync"] }
serde            = { version = "1", features = ["derive"] }
```
The root `Cargo.toml` already has `[patch."https://github.com/sensei-hq/gateway"] → ../gateway/crates/*`, so these resolve to the local path. **If cargo can't resolve the git dep** (needs a tag/rev, or network), read how the root patch is keyed and either add a matching `tag`/`rev` OR — as a dev fallback — use direct **path deps** (`gateway = { path = "../../../gateway/crates/gateway" }`, `gateway-embedded = { path = "../../../gateway/crates/gateway-embedded", features = ["llama-cpp"] }`) and note it. Report which worked. Confirm the root patch's unused-warning is now GONE (the crates are used).

- [ ] **Step 2: create `src/gateway.rs`** — mirror sensei's `crates/senseid/src/api/gateway_init.rs` + `gateway_embedded.rs`. READ those two files and copy the construction, adapting:
  - `AdapterRegistry::new()`; register `NoopAdapter`; register the embedded llama adapter: `EmbeddedLlamaAdapter::with_shared_backend("embedded-llama", Arc::new(ChainedResolver::new().push(Arc::new(ManagedResolver::new(strategos_models_dir()))).push(Arc::new(OllamaResolver::new(ollama_models_dir())))) )?` where `strategos_models_dir()` = `~/.strategos/models` (create if missing) and `ollama_models_dir()` = `~/.ollama/models`.
  - Build a **baseline `GatewayConfig`** with one chat model wired to the embedded adapter. Copy the exact `ModelConfig`/`RouterConfig`/`FallbackChainConfig` shape from sensei's `baseline_production_config()` (or the gateway crate's builder). The model: id `gemma2:2b`, `provider = "embedded-llama"` (must match the registered adapter id), `capabilities = [Capability::TextChat]`, a context window (e.g. 8192) + max output (e.g. 1024). Add a chain for `TextChat` referencing it. (If a `RouterConfig` is required for `embedded-llama`, add a minimal enabled one per the gateway crate's expectations — check whether the engine looks up `AdapterRegistry::get(candidate.router)` by the model's `provider` or a separate `router` field, and wire accordingly. This is the key integration detail — get it from the gateway crate source + sensei's config.)
  - `Gateway::new(config, adapters, CircuitBreakerManager::new(CircuitBreakerConfig::default()))`. Expose `pub async fn build_gateway() -> Arc<Gateway>`.

- [ ] **Step 3: hold it in Tauri state** — in `src/lib.rs`, build the gateway at startup and `.manage(gateway)` it. Since `build_gateway` is async and Tauri's `run()` is sync, build it on a tokio runtime before `.run()` (mirror how sensei bootstraps), e.g. a `tauri::async_runtime::block_on(build_gateway())`. Keep the `#[cfg(feature = "e2e-testing")]` playwright plugin init.

- [ ] **Step 4: compile (CONTROLLER runs this in the background — do NOT run inside the subagent).** The implementer writes the code; the controller runs `cargo build -p app` via a background shell (the `llama-cpp-2` native compile of llama.cpp is slow, several+ minutes). Expected: compiles; the `gateway`/`gateway-embedded` `[patch]` unused-warnings are gone. Report build result.

- [ ] **Step 5: a Rust smoke test** — `src-tauri/src/gateway.rs` `#[cfg(test)] mod tests` with a `#[tokio::test]` that calls `build_gateway().await` and asserts `gateway.list_adapters().await` contains `"embedded-llama"` (does NOT run inference — just construction). (Controller runs `cargo test -p app` in the background.)

- [ ] **Step 6: commit** — `feat(desktop): embed gateway-embedded engine (gemma2:2b via Ollama read-through)`

---

## Task 2: `src-tauri` — `infer` / `list_models` IPC commands

**Files:** create `src/commands/infer.rs`, `src/commands/mod.rs`; modify `src/lib.rs` (`generate_handler!`).

- [ ] **Step 1: define the IPC contract types** (serde, in `infer.rs`) — mirror sensei's `handlers/gateway.rs` request/response shapes but as Tauri command args:
```rust
#[derive(serde::Deserialize)]
pub struct ChatMessage { pub role: String, pub content: String }

#[derive(serde::Deserialize)]
pub struct InferArgs { pub messages: Vec<ChatMessage>, pub model: Option<String>, pub system: Option<String>, pub max_tokens: Option<u32> }

#[derive(serde::Serialize)]
pub struct InferResult {
    pub content: String,
    pub model: Option<String>,
    pub plane: String,       // "local"
    pub cost_usd: f64,       // 0.0 for local
    pub duration_ms: u64,
}

#[derive(serde::Serialize)]
pub struct ModelInfo { pub id: String, pub name: String, pub local: bool }
```

- [ ] **Step 2: `infer` command** — build an `InferenceRequest { capability: Capability::TextChat, model: args.model.or(default "gemma2:2b"), router: None, chain: <the chat chain id>, payload: Payload::Chat { messages, system, max_tokens }, budget: None }` and call `state.gateway.execute(&req).await`. Map the `InferenceResponse` → `InferResult` (content, model, `plane: "local"`, `cost_usd: 0.0`, duration). Map errors to `Result<InferResult, String>`. Use `tauri::State<'_, Arc<Gateway>>`. Follow sensei's `handlers/gateway.rs` for the exact `Payload::Chat`/message construction.
```rust
#[tauri::command]
pub async fn infer(state: tauri::State<'_, Arc<Gateway>>, args: InferArgs) -> Result<InferResult, String> { /* ... */ }
```

- [ ] **Step 3: `list_models` + `gateway_status` commands** — `list_models` returns `Vec<ModelInfo>` from the resolver/`gateway.list_models()` (mark `local: true`); `gateway_status` returns `{ configured, adapters }` from `gateway.is_configured()` + `gateway.list_adapters()`.

- [ ] **Step 4: register** in `src/lib.rs` `tauri::generate_handler![commands::infer::infer, commands::infer::list_models, commands::infer::gateway_status]` (keep any existing handlers).

- [ ] **Step 5: build (CONTROLLER, background) + a real inference smoke.** After it compiles, the controller runs a background check that actually loads `gemma2:2b` and runs one inference (e.g. a `cargo test -p app -- --ignored infer_smoke` that calls `build_gateway()` then `execute()` a "Say hello" chat, asserting a non-empty content). **This loads the model and is slow** — run in the background. Mark the test `#[ignore]` so it isn't in the default `cargo test`. Report the actual answer text.

- [ ] **Step 6: commit** — `feat(desktop): infer/list_models Tauri commands over the embedded engine`

---

## Task 3: desktop `$lib` — gateway client + ask store

**Files:** create `apps/desktop/src/lib/gateway.ts`, `apps/desktop/src/lib/ask.svelte.ts`.

- [ ] **Step 1: `src/lib/gateway.ts`** — typed `invoke` wrappers:
```ts
import { invoke } from '@tauri-apps/api/core'

export interface ChatMessage { role: 'user' | 'assistant' | 'system'; content: string }
export interface InferResult { content: string; model?: string; plane: 'local' | 'cloud'; cost_usd: number; duration_ms: number }
export interface ModelInfo { id: string; name: string; local: boolean }

export const gateway = {
  infer: (messages: ChatMessage[], opts: { model?: string } = {}) =>
    invoke<InferResult>('infer', { args: { messages, model: opts.model ?? null, system: null, max_tokens: 1024 } }),
  listModels: () => invoke<ModelInfo[]>('list_models'),
  status: () => invoke<{ configured: boolean; adapters: string[] }>('gateway_status')
}
```
(Confirm the Tauri arg-wrapping: Tauri passes command args under the parameter name — since the Rust command takes `args: InferArgs`, the JS payload key is `args`. Verify against how Tauri 2 maps `invoke('infer', { args })`.)

- [ ] **Step 2: `src/lib/ask.svelte.ts`** — the Ask runes store:
```ts
import { gateway, type ChatMessage, type InferResult } from './gateway'

export interface Turn { role: 'user' | 'assistant'; content: string; exec?: InferResult }

class AskStore {
  turns = $state<Turn[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  async send(text: string) {
    const q = text.trim()
    if (!q || this.loading) return
    this.turns.push({ role: 'user', content: q })
    this.loading = true
    this.error = null
    try {
      const history: ChatMessage[] = this.turns.map((t) => ({ role: t.role, content: t.content }))
      const res = await gateway.infer(history)
      this.turns.push({ role: 'assistant', content: res.content, exec: res })
    } catch (e) {
      this.error = String(e)
    } finally {
      this.loading = false
    }
  }
  reset() { this.turns = []; this.error = null }
}
export const ask = new AskStore()
```

- [ ] **Step 3: `svelte-check` + `lint`** clean for the desktop app (no Tauri build needed for TS). Commit — `feat(desktop): gateway IPC client + Ask runes store`.

---

## Task 4: Ask screen (real, local)

**Files:** replace `apps/desktop/src/routes/(app)/ask/+page.svelte`.

- [ ] **Step 1: build the Ask screen** — port the layout of `docs/mockups/app/view-ask.jsx`: a header (eyebrow + title + workspace/classification chip), a conversation column (each user turn + each assistant answer showing the model + an `<ExecBadge plane={turn.exec?.plane ?? 'local'} />` reading "on your device" + `$0`), and a minimal composer (input + send button, ⌘↵). Wire it to the `ask` store: the composer calls `ask.send(text)`; render `ask.turns`; show a loading indicator while `ask.loading`; show `ask.error` if set. Use `ExecBadge` + named tokens. Keep the context rail minimal/optional for 1b (the real sources rail is Phase 1b RAG-less → a simple "answered on-device" note).

- [ ] **Step 2: verify (web dev, no Tauri build)** — `bun run --filter @strategos/desktop check` + `lint` clean. The real inference only works in the Tauri window (IPC), but the screen must compile + render. Optionally the controller runs `bun run --filter @strategos/desktop tauri dev` in the background to eyeball a real gemma2:2b answer (manual, optional).

- [ ] **Step 3: commit** — `feat(desktop): real Ask screen wired to local inference`

---

## Task 5: Local Models screen

**Files:** create `apps/desktop/src/routes/(app)/models/+page.svelte`; add `Models` to the shell nav OR surface under Settings (decide — the mockup has Models in the console). Keep the existing nav list; if adding `Models`, update the `items` array in `apps/desktop/src/routes/(app)/+layout.svelte` and `DesktopShell`'s default.

- [ ] **Step 1: build the Local Models screen** — port `docs/mockups/app/view-models.jsx` (table: model name + provider dot + tier + context + a "local · on device" `ExecBadge`). Data from `gateway.listModels()` (call in `onMount`, hold in a `$state`). Show which is the default local chat model (`gemma2:2b`). A "set default" control can persist to `localStorage` (a real device-default pref; wiring it into `infer`'s model arg is a nice-to-have — at minimum display it).

- [ ] **Step 2: verify** `check` + `lint` clean. Commit — `feat(desktop): Local Models screen (gateway-embedded registry)`.

---

## Task 6: E2E — ask → local answer (deterministic)

**Files:** create `apps/desktop/e2e/tests/ask.spec.ts`; add a `VITE_E2E` infer stub.

- [ ] **Step 1: deterministic infer in e2e.** Real model inference in E2E is slow + non-deterministic. Stub it under the existing `VITE_E2E` flag: in `src/lib/gateway.ts`, when `import.meta.env.VITE_E2E === 'true'`, `infer()` returns a canned `InferResult` (`content: 'Hello from your on-device model.'`, `plane: 'local'`, `cost_usd: 0`) without calling `invoke`. Keep it strictly env-gated.

- [ ] **Step 2: `e2e/tests/ask.spec.ts`** — seeded member (existing seam) → navigate to `/ask` (click the Ask nav button, per the skill) → type a question in the composer → send → assert the answer text renders AND an `[data-exec-badge][data-plane="local"]` with "on your device" is visible.

- [ ] **Step 3: run (CONTROLLER, background).** The controller runs `bun run --filter @strategos/desktop test:e2e` in a background shell (full Tauri rebuild — slow). Expect all specs (Phase-0 shell, Phase-1a auth-shell, this ask) green. Report the summary.

- [ ] **Step 4: commit** — `test(desktop): E2E — ask → on-device answer (stubbed infer)`

---

## Task 7: Acceptance + cleanup + push

- [ ] **Step 1:** `bun run test && bun run check && bun run lint` — all green. `cargo build -p app` compiles (controller/background if needed).
- [ ] **Step 2:** confirm the walking-skeleton demo works in the real Tauri window (controller runs `tauri dev` in the background, or relies on the ignored `infer_smoke` test from Task 2): a question returns a real `gemma2:2b` answer **with the network off**. Record the evidence.
- [ ] **Step 3:** update `apps/README.md` — Phase-1b status (local inference + Ask; the `infer`/`list_models` IPC; default model `gemma2:2b`).
- [ ] **Step 4:** `make clean` (reclaim the target/ + Tauri bundle), then commit (`chore(phase1b): acceptance — local Ask on-device green`) and **`git push origin develop`**.

---

## Self-review notes (author)
- **Spec coverage** (blueprint §8 Phase 1, engine slice): gateway-embedded in src-tauri (Task 1), infer/list_models IPC (Task 2), gateway client + ask store (Task 3), real Ask offline/$0 + ExecBadge (Task 4), Local Models screen / D2 registry (Task 5), E2E walking-skeleton (Task 6). Split-plane router + cloud plane (C1) are **Phase 2**.
- **Biggest risk = Task 1** — the `llama-cpp` native build + the exact `GatewayConfig`→embedded-adapter routing. Mitigation: copy sensei's real `gateway_init.rs`/`gateway_embedded.rs`/`baseline_production_config`; run the heavy build via background shell; path-dep fallback if the git+patch won't resolve.
- **Streaming:** none (gateway-embedded limitation) — Ask shows a loading state then the full answer. Fine for the skeleton; token-streaming is a later enhancement (possibly upstream in the engine).
- **Type consistency:** `InferResult`/`ModelInfo` shapes match across Rust (Task 2), the TS client (Task 3), the Ask store/screen (Task 3/4), and the e2e stub (Task 6). `plane: 'local'` drives `ExecBadge`.
- **Deferred:** embeddings/fastembed (no local RAG in 1b), model download UI (read-through only), split-plane routing, offline usage buffer, device token.
