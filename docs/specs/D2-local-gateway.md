# D2 · Embedded local gateway & model manager — Spec

**Module:** [D2](../modules/D2-local-gateway.md) · **Plane:** Device (in-process, no daemon) · **Status:** Planned — build-ready
**Depends on:** [D1](../modules/D1-desktop-shell.md) (Tauri shell + local store + OS keychain), [F1](F1-data-model.md) (catalog: `model_endpoints.local_capable` / `model_capabilities`; the `document_embeddings vector(1024)` dim contract), [C2](C2-routing-resilience.md) (chain shape + per-step `plane`), [C5](C5-rag-document-intelligence.md) (embedding-chain contract + 1024-dim requirement + local RAG/ingestion) · engine crates `sensei-*` @ **`v0.4.6`** — the **local wing**: `sensei-local-engine` (resolvers + supervisor), `sensei-local-providers` (in-process adapters), `sensei-kernel` (registry vocab + capability traits + readiness), through `sensei-gateway`'s `local` wing.
**Enables:** [D3](../modules/D3-split-plane-router.md) (the local execution plane for `plane=local` chain steps), [C5](C5-rag-document-intelligence.md) desktop local plane (local embed / retrieve / §3c compute), [D4](../modules/D4-config-sync.md) (logs local `$0` calls into the offline usage buffer), W2/W3 (exec-location badges + the **Local models & downloads** screen, mockup-review §A.9).
**Date:** 2026-07-23 · **Language:** Rust (Tauri sidecar/in-process) + SvelteKit (screen) · **Crate facts verified against** the `v0.4.6` checkout at `../gateway/crates/{kernel,local-engine,local-providers}` (`kernel/src/registry.rs`, `kernel/src/readiness.rs`, `kernel/src/adapters/{mod,capability}.rs`, `local-engine/src/{supervisor,registry/*}.rs`, `local-providers/src/adapters/{embedded_llama,ort}.rs`).

---

> **Reading order.** D2 is the desktop's **local inference plane**: it runs models in-process (`$0`, private, offline-capable) and manages their bytes on disk. It sits **under** D3 (which decides local-vs-cloud per step and merges the unified trace) and **beside** C5's desktop local plane (which drives ingestion/retrieval/§3c compute on-device). It composes the `sensei-*` **local wing** — it does **not** own the split-plane routing decision (D3), config sync/Realtime (D4), the Tauri shell/local store (D1), central cloud inference or provider credentials (C1/F3), or the retrieval pipeline (C5). **GH-3 is resolved** (DECISIONS §3): the embedded in-process path already exists; D2 only picks a 1024-dim embed model and wires the embedding chain — **no crate enhancement, no external daemon**.

---

## 1. Purpose & scope

Define how the desktop app runs **local chat/reasoning and embeddings in-process** on the device, and how it **manages the model bytes** those adapters need (browse / fit-check / download / update / remove / GC), detects device hardware limits, and surfaces all of it as the **Local models & downloads** screen. This is the desktop's offline / private / `$0` superpower and the `plane=local` end of every split-plane chain.

**In scope**
- Compose the `sensei-*` **local wing** into an in-process **local engine**: build the model **registry** (`ChainedResolver` = Managed → Ollama read-through → External), register the **in-process adapters** (`EmbeddedLlamaAdapter` for chat **and** embed; `OrtAdapter` for embed) into an `AdapterRegistry`, and attach the `ProvisioningSupervisor` as the `ReadinessProbe` the engine consults.
- **Model manager**: enumerate registered + pullable models, resource **fit-check** (`FitReport`), **download** (HF-hub puller / provisioning supervisor with streamed phase progress), **update/remove**, **storage usage + GC**, **set local default** (per capability).
- **Local capability chains**: bind the local adapters into the `plane=local` steps of the chains C2 resolves (chat/reasoning + a **1024-dim embedding** chain), so D3 can walk them and C5 can embed on-device.
- **Device hardware/capability detection** (RAM/disk via the crate's `sysinfo`-backed pre-flight; CPU; best-effort accelerator advisory) gating which models are offerable.
- Expose the local engine + registry to (a) **D3** as an in-process Rust API and (b) the **SvelteKit UI** as Tauri IPC commands + a phase-event channel.

**Out of scope** (owned elsewhere)
- The **local-vs-cloud decision per step**, chain-spanning walk, and the merged `ExecutionTrace` → **D3**.
- **Config sync / Realtime / usage-buffer flush + reconciliation** → **D4** (D2 emits `$0` local call records into the buffer D4 owns).
- The **Tauri host, local store (SQLite/pgvector), OS keychain, offline banners/sync chips** → **D1**.
- **Cloud inference, provider credentials, the `inference_calls` service-role ledger, gateway-mediated writes** → **C1/F3** (credentials never touch the device).
- **Chain CRUD / binding / resilience policy** → **C2** (D2 consumes the resolved chain, never writes it).
- **Ingestion / chunking / retrieval / rerank / §3c compute** → **C5** (D2 only provides the local embed capability + in-process execution those flows run on).

---

## 2. Responsibilities

1. **Assemble the local engine at boot** — construct the `ChainedResolver`, the `EmbeddedLlamaAdapter` (shared llama.cpp backend, chat+embed) and `OrtAdapter` (ONNX embed), register them into an `AdapterRegistry`, and wire the `ProvisioningSupervisor` as the local `ReadinessProbe`.
2. **Own the on-device model registry** — resolve a stable model id to on-disk bytes across Managed (`~/.torii/models`, app-owned), Ollama (read-through of an existing `~/.ollama` cache — never written), and External (user-pointed paths) sources.
3. **Manage model lifecycle** — fit-check → pull (HF-hub, revision-pinned, hash-verified) → verify → load → register, with **streamed provisioning phases**; update; remove (managed bytes only); GC unreferenced managed files; report storage usage.
4. **Serve local inference in-process** — chat/reasoning + streaming, and **1024-dim embeddings**, at `$0`, offline-capable, via the capability adapters; enforce the 1024-dim contract at registration.
5. **Provide readiness/degradation signal** — expose per-model `ProvisionPhase` so D3/C2's local steps degrade (fall through) when a model isn't `Ready` instead of blocking a request.
6. **Detect device capability** — disk + RAM (crate pre-flight), CPU, best-effort accelerator advisory — to gate which models are offerable and to drive the screen's hardware panel.
7. **Set + persist device-local defaults** — the default local chat and embed models (per capability), consumed by D3's free-floor/local steps.
8. **Expose the surface** — an in-process Rust `LocalEngine` API for D3 and a Tauri IPC command set + phase-event channel for the Local models screen.

---

## 3. Data model (F1 tables owned / used)

D2 is **schema-light on the central plane**: it owns **no F1 table** and never writes the tenant DB. The on-device **model registry index** (which models are downloaded, their source/format/size/sha, the device defaults, per-model GC refcount) lives in the **D1 local store** (SQLite), not in F1 — model bytes are a device artifact, not tenant data.

### 3.1 Used (read-only, arrives via the D4 config snapshot — never queried directly by D2)

| Table (via D4 snapshot) | Owner | D2 use |
|---|---|---|
| `config.models`, `config.model_endpoints.local_capable`, `config.model_capabilities` | F1 / C2 | Which catalog models are **local-capable** and each model's **capabilities** (chat/embed) — capability is a **model attribute** (DECISIONS §3). D2 offers a model as local only when it is `local_capable`, and binds it to a chain step only for a capability its `model_capabilities` grants. |
| `fallback_chains` / `fallback_chain_models` (+ `plane`) | C2 | The chain steps flagged `plane='local'` that D2's adapters fulfil (D3 walks them). |
| Per-tenant **catalog override** tables (F1 RW10) | F1/W1 | Which local models are **enabled** per tenant/space/role (operator-governed catalog), layered over platform defaults. |
| `feature_states` / `user_preferences` (4-state) | O3/C4 | Feature governance over "local models allowed" and the user's chosen device default (where `user-overridable`), resolved workspace→space→role→user. |

### 3.2 Written (indirectly, via D4's buffer — not by D2's own DDL)

| Target | Owner | D2 contribution |
|---|---|---|
| `public.inference_calls` (single ledger) | C1/O1 | Every **local** call D2 serves is recorded into D4's signed, idempotent offline buffer as an `inference_calls` record with **`execution_location='local'`, `cost_usd=0`** (unified budget accounting; DECISIONS §3 "local calls = `$0` but logged"). D4 flushes it as `service_role`; D2 never touches the ledger directly. |

**Owns no F1 DDL, no RLS policy, no `service_role` connection.** All privileged writes and the ledger are C1/F3/D4 concerns.

### 3.3 Crate registry vocabulary (the "schema" D2 actually owns — device-side)

From `sensei-kernel::registry` (verified):

```rust
enum ModelFormat { Gguf, Onnx, Safetensors }               // #[serde snake_case]
enum ModelSource {                                          // #[serde tag="kind"]
    Managed  { path: PathBuf },                             // app-owned, GC-able (~/.torii/models)
    Ollama   { manifest: PathBuf, blob_digest: String, blob_path: PathBuf }, // read-through, never written
    External { path: PathBuf },                             // user-pointed, linked in place
}
struct ModelEntry { id: String, name: String, format: ModelFormat,
                    source: ModelSource, sha256: Option<String>, size_bytes: Option<u64> }
```

The device-store index persists one row per known `ModelEntry` plus D2-added columns: `capabilities text[]` (chat/embed, from `model_capabilities`), `is_default_chat bool`, `is_default_embed bool`, `refcount int` (local-RAG/default references — GC gate), `last_used_at`.

---

## 4. Contracts

### 4.1 Engine types consumed (from `sensei-*` @ `v0.4.6` — verified)

```rust
// kernel::registry — the resolver port + vocabulary (§3.3)
#[async_trait] trait ModelResolver { async fn resolve(&self, id:&str) -> Result<Option<ModelEntry>, ResolveError>;
                                     async fn list(&self) -> Result<Vec<ModelEntry>, ResolveError>; }

// local_engine::registry — concrete resolvers, composed Managed→Ollama→External
struct ChainedResolver;   // .push(Arc<dyn ModelResolver>) — first Some wins; list() = deduped union
struct ManagedResolver;   // ::new(root)  — app-owned store; add()/GC live here
struct OllamaResolver;    // ::new(root)  — read-through of ~/.ollama; never writes
struct ExternalResolver;  // ::new()      — user-registered paths
// feature "hf-download":
struct HfHubPuller;       // ::new(managed: ManagedResolver, token: Option<String>)
#[async_trait] trait ModelPuller { async fn pull(&self,&PullSpec) -> Result<ModelEntry,PullError>;
                                   async fn check_fit(&self,&PullSpec) -> Result<FitReport,PullError>; }
struct PullSpec { repo:String, revision:Option<String>, id:String, name:Option<String>,
                  format:ModelFormat, files:Vec<String> }   // files[0] = model, rest siblings
struct FitReport { model_bytes:u64, disk_available:u64, ram_total:u64, ram_available:u64,
                   fits:bool, reason:Option<String> }
enum PullError { Hub, Io, Registry, EmptySpec, WontFit(String) /*actionable*/ }

// local_engine::supervisor — readiness state machine
struct ProvisioningSupervisor;               // ensure(model,&EnsureOpts)->ProvisionHandle; status/status_all
struct EnsureOpts { wait: bool }             // ensure is ALWAYS non-blocking; wait rides intent
#[non_exhaustive] enum ProvisionPlan {       // external match MUST carry a wildcard arm
    Scripted(ScriptedPlan),
    HfGguf { spec: PullSpec },               // feature hf-download + llama-cpp: pull → coldboot → register
    EmbeddedGguf,                            // feature llama-cpp: coldboot an already-resolvable GGUF
    Ort { config: OrtConfig },               // feature ort: load ONNX embed model + register
    /* Fastembed(DISABLED), Kokoro, HfKokoro — not built by D2 */
}
struct ProvisionHandle;                      // phase(); events()->Stream<ProvisionEvent>; wait_ready()

// kernel::readiness — the port the engine consults; supervisor implements it
#[serde tag="phase", snake_case]
enum ProvisionPhase { Absent, Queued, Downloading{done:u64,total:Option<u64>}, Verifying, Loading,
                      Ready, Failed{error:String} }         // .is_in_flight()
struct ProvisionEvent { model:String, phase:ProvisionPhase }
#[async_trait] trait ReadinessProbe { async fn phase(&self,model:&str)->ProvisionPhase;
                                      async fn status_all(&self)->Vec<(String,ProvisionPhase)>; }

// kernel::adapters — the capability-segregated registration model (NO InferenceAdapter)
struct AdapterRegistry;                      // register(Arc<A: RegisterInto>); register_chat/register_embed; list()
trait RegisterInto { async fn register_into(self:Arc<Self>, reg:&AdapterRegistry); }
// kernel::adapters::capability
trait Model { fn id(&self)->&str; }
#[async_trait] trait ChatModel: Model { async fn chat(&self,&RouterConfig,&ChatRequest)->Result<ChatResponse,_>;
                                        async fn chat_stream(...) /*opt-in; default Unsupported*/ }
#[async_trait] trait EmbedModel: Model { async fn embed(&self,&RouterConfig,&EmbedRequest)->Result<EmbedResponse,_>; }
struct EmbedRequest { model:Option<String>, texts:Vec<String> }
struct EmbedResponse { embeddings:Vec<Vec<f32>>, usage:Option<TokenUsage>, degraded:bool } // dim NOT validated by crate

// local_providers::adapters — the in-process adapters
struct EmbeddedLlamaAdapter;  // ::with_shared_backend(id, resolver: Arc<dyn ModelResolver>) -> Result<Self,_>
                              // impl ChatModel + EmbedModel; RegisterInto → BOTH maps; lazy per-(model,mode) workers
struct OrtAdapter;            // ::load(&ModelEntry, OrtConfig) -> Result<Self,_>; impl EmbedModel
enum OrtPoolingStrategy { Mean, Cls }
struct OrtConfig;             // ::bert(id) (Mean) / ::bert_cls(id) (Cls)
// LlamaCppConfig::embed(id) => n_ctx 512 ;  ::chat(id) => n_ctx 4096  (mode-specific defaults)
```

### 4.2 Tauri IPC (Local models & downloads screen — mockup-review §A.9)

Consumed by the SvelteKit UI; all run in-process on-device, no auth beyond the local device session (no tenant DB access).

| Command | Returns | Effect |
|---|---|---|
| `local_models_list()` | `[{ id, name, format, source_kind:"managed"\|"ollama"\|"external", size_bytes, capabilities:[..], phase:ProvisionPhase, is_default_chat, is_default_embed, last_used_at }]` | `ChainedResolver::list()` ∪ `supervisor.status_all()`; the screen's model table. |
| `local_model_catalog()` | `[{ id, name, repo, format, capabilities, approx_bytes, enabled, fit:FitReport }]` | Pullable, **operator-governed** catalog (platform defaults + catalog overrides from the D4 snapshot), each with a fit pre-flight. |
| `local_model_check_fit(id)` | `FitReport` | `ModelPuller::check_fit` — disk/RAM verdict **without** downloading. |
| `local_model_pull(id)` | `{ handle_id }` (+ streamed events) | Resolve the catalog `PullSpec` → `supervisor.ensure(id, EnsureOpts{wait:false})` with `ProvisionPlan::HfGguf`/`Ort`; phases stream on the event channel (§4.4). Refuses if `!fit.fits`. |
| `local_model_remove(id)` | `{ freed_bytes }` | Delete **Managed** bytes + index row when `refcount==0`; **refuse** for `Ollama`/`External` (not owned) and when referenced (returns a typed error). |
| `local_storage_usage()` | `{ managed_bytes, model_count, disk_available, disk_total }` | Sum of managed sizes + `sysinfo` disk figures. |
| `local_gc()` | `{ removed:[id], freed_bytes }` | Remove **unreferenced** managed files (`refcount==0`, not a device default). |
| `local_set_default(capability, model_id)` | `{ ok }` | Persist the device default chat **or** embed model (per capability); embed default must be a 1024-dim model (§8.3). Feeds D3's local/free-floor step. |
| `local_device_capabilities()` | `{ cpu_count, ram_total, ram_available, disk_available, accelerator:{kind:"cpu"\|"metal"\|"cuda"\|"vulkan"\|"unknown", advisory:bool} }` | Hardware panel + offer-gating (§6.8). |

### 4.3 Rust API (in-process, consumed by D3 and C5's desktop plane)

```rust
/// D2's local plane, composed over the sensei-* local wing. Built once at boot, held by the Tauri app.
pub struct LocalEngine {
    registry: ChainedResolver,
    adapters: AdapterRegistry,          // EmbeddedLlamaAdapter (chat+embed) + OrtAdapter (embed)
    supervisor: Arc<ProvisioningSupervisor>,  // also the ReadinessProbe the engine consults
    store: LocalStore,                  // D1 SQLite — index, defaults, refcounts
}

impl LocalEngine {
    /// Boot: build resolver + adapters + supervisor; register; return the assembled engine. (Flow 1)
    pub async fn boot(cfg: &LocalConfig) -> Result<Self, LocalError>;

    /// Run a local chat/embed step for a resolved chain step whose plane == local (called by D3).
    /// Returns a $0 result + a local Attempt (execution_location=local) for D3's unified trace.
    pub async fn chat(&self, model:&str, req:&ChatRequest) -> Result<(ChatResponse, LocalAttempt), LocalError>;
    pub async fn chat_stream(&self, model:&str, req:&ChatRequest)
        -> Result<impl Stream<Item=Result<StreamChunk, LocalError>>, LocalError>;
    /// 1024-dim embeddings for C5 local ingestion/query; asserts dim==1024 (§8.3).
    pub async fn embed(&self, model:&str, texts:&[String]) -> Result<EmbedResponse, LocalError>;

    /// Readiness for D3/C2 local-step degradation (no block).
    pub fn phase(&self, model:&str) -> ProvisionPhase;

    /// Registry/manager operations backing the IPC layer (§4.2).
    pub async fn list(&self) -> Result<Vec<LocalModel>, LocalError>;
    pub async fn pull(&self, spec:&PullSpec) -> Result<ProvisionHandle, LocalError>;
    pub async fn remove(&self, id:&str) -> Result<u64, LocalError>;   // managed-only; freed bytes
    pub async fn storage_usage(&self) -> Result<StorageUsage, LocalError>;
    pub async fn gc(&self) -> Result<GcReport, LocalError>;
    pub fn device_capabilities(&self) -> DeviceCapabilities;
    pub async fn set_default(&self, cap:LocalCapability, model:&str) -> Result<(), LocalError>;
}
```

### 4.4 Events

- **`local-model://phase`** (Tauri event) — one `ProvisionEvent { model, phase }` per transition while a pull/coldboot runs, relayed from `ProvisionHandle::events()`; backs the screen's per-model progress bar. Late subscribers see the current phase (watch semantics); very fast transitions may coalesce.
- **`local-model://registry-changed`** — emitted after pull-complete / remove / GC so the screen refreshes `local_models_list`.
- **Usage record → D4 buffer** — each completed local call hands D4 a `{ execution_location:"local", cost_usd:0, model, tokens, tenant_id, subject_node_id }` record for the signed, idempotent buffer (not a Tauri event; an in-process handoff).

---

## 5. Security & RLS

- **No provider credentials on the device — ever (DECISIONS §2 W4).** D2 holds no `router_credentials`, no BYOK key, no OAuth token; the local adapters call **no network provider**. Any chain step needing a provider credential is `plane=cloud` and is proxied to C1 by D3. D2 must not read, cache, or log a provider secret; the OS keychain (D1) holds only the **device session token**, never provider keys.
- **No `service_role`, no direct tenant-DB access.** D2 owns no F1 table and opens no `service_role` connection. Governance over "which local models are allowed" arrives **read-only** via the D4 config snapshot (catalog overrides + `feature_states`, resolved workspace→space→role→user); D2 enforces the resolved verdict client-side but the authoritative gate is server-side (offering a disabled model is refused, and a cloud step is never fulfilled locally).
- **Local calls are `$0` but attributed + logged.** Every local inference is recorded into D4's **signed, idempotent** offline buffer as an `inference_calls` row with `execution_location='local'`, `cost_usd=0`, bound to the caller's identity/subject node — so a device cannot forge or under-report spend (DECISIONS §2 apply-without-asking) and budgets stay unified even though local is free.
- **Device revocation.** Local inference is deliberately **offline-capable** and continues on a network partition; but a **revoked device** loses config sync (D4) and cannot proxy cloud steps (C1 hot-path device check). D2 respects the last-known governance snapshot when offline and stops honoring org-scoped local features once D4 reports revocation.
- **Model-bytes supply-chain integrity.** HF pulls pin a `revision` and verify `ModelEntry.sha256` on load where present; a hash/format mismatch is a hard registration error (the model is not offered). Managed bytes live under an app-owned root (`~/.torii/models`) the app controls; Ollama/External sources are **read-only** (never mutated).
- **Redaction still applies on the local plane (DECISIONS §2 W5).** On-device ingestion/inference runs through C5's redact-at-rest and C4's redact-in-flight exactly as the cloud plane — a local model is not a bypass for secret/PII egress controls; §3c sensitive datasets **prefer** the local plane precisely so raw values never leave the machine.
- **Single-user device boundary.** The local store + local RAG index belong to the enrolled user/tenant session (D1); there is no multi-tenant data co-resident on a device. Tenant isolation on the central plane is unaffected (D2 never queries it).
- **No secret in logs.** Provisioning/hardware logs emit model ids, sizes, phases, and fit verdicts only — never a keychain token or any credential (asserted by a log-scan test).

---

## 6. Key flows

**Flow 1 — Boot the local engine (app start).**
1. Read `LocalConfig` (managed root default `~/.torii/models`, enabled features, device defaults) from the D1 local store.
2. Build `ChainedResolver` = `ManagedResolver::new(root)` → `OllamaResolver::new(~/.ollama)` (if present) → `ExternalResolver::new()` (Managed→Ollama→External precedence).
3. Construct `EmbeddedLlamaAdapter::with_shared_backend("local-llama", Arc<resolver>)` (implements **chat+embed**) and, if an ONNX embed model is chosen, `OrtAdapter::load(entry, OrtConfig::bert(id))`.
4. `AdapterRegistry::register(Arc::new(embedded_llama))` (lands in both chat+embed maps) and `register(Arc::new(ort))` (embed map).
5. Create the `ProvisioningSupervisor`; expose it as the `Arc<dyn ReadinessProbe>` the `sensei-gateway` local wing consults so unready models degrade instead of blocking.

**Flow 2 — List local models (screen open).** `ChainedResolver::list()` (deduped union, earlier source shadows later) joined with `supervisor.status_all()` → each row's `source_kind`, `size_bytes`, `capabilities`, and live `ProvisionPhase`; joined with the store's defaults/refcounts.

**Flow 3 — Download a model.**
1. UI picks a catalog entry (operator-governed) → `local_model_check_fit` → `FitReport`.
2. If `fits==false`, show `reason` (e.g. "won't fit — needs 6.1 GB, 3.2 GB free") and **do not download**.
3. If it fits, `supervisor.ensure(id, EnsureOpts{wait:false})` with `ProvisionPlan::HfGguf{spec}` (GGUF, embed or chat) or `ProvisionPlan::Ort{config}` (ONNX embed).
4. Phases stream `Absent→Queued→Downloading{done,total}→Verifying→Loading→Ready` on `local-model://phase`; `HfHubPuller` pins `revision`, verifies bytes, and registers a Managed `ModelEntry`.
5. On `Ready`, emit `registry-changed`; on `Failed{error}`, surface the actionable reason and leave nothing half-registered.

**Flow 4 — Local chat/reasoning (via D3).** D3 resolves a chain step with `plane=local` and calls `LocalEngine::chat(model, req)`. If `phase(model) != Ready`, D3 is told to fall through to the next step (degradation). On success, D2 returns the `ChatResponse` + a `LocalAttempt` (execution_location=local) for D3's unified trace, and hands D4 a `$0` `inference_calls` record.

**Flow 5 — Local embedding for RAG (via C5).** C5's desktop ingestion/query requests the **embedding chain**; its local step calls `LocalEngine::embed(model, texts)`. D2 asserts each returned vector is **exactly 1024-dim** (matching `document_embeddings vector(1024)`); a mismatch is a hard error (the embed model was mis-registered). Sensitive datasets (`plane_pin='local'`, C5 §3c) run entirely here.

**Flow 6 — Remove / GC.** `local_model_remove(id)` deletes Managed bytes + index row when `refcount==0`; refuses Ollama/External (not owned) and referenced models. `local_gc()` sweeps unreferenced managed files. Both recompute storage usage and emit `registry-changed`.

**Flow 7 — Set device default.** `local_set_default(capability, model_id)` persists the default chat or embed model; the embed default is validated 1024-dim. D3 uses these for the local/free-floor step; the value is a `user-overridable` preference only where governance allows (else the admin-locked default wins).

**Flow 8 — Hardware/capability detection.** `local_device_capabilities()` returns CPU count + `sysinfo` RAM/disk (the same figures the crate's `check_fit` uses) and a **best-effort accelerator advisory** (`metal`/`cuda`/`vulkan`/`cpu`/`unknown`, flagged `advisory`). Fit-gating in v1 relies on the crate's **disk+RAM** guard; accelerator info is informational only (§8.5 / open question 1).

---

## 7. Gateway-crate dependencies

Consumes the six `sensei-*` crates @ pinned **`v0.4.6`** (dev-in-place via `[patch]`; lib import name stays `gateway` for the routing wing). D2 specifically uses **`sensei-local-engine`** (`registry::{ChainedResolver, ManagedResolver, OllamaResolver, ExternalResolver, HfHubPuller, PullSpec, FitReport, ModelPuller}`, `supervisor::{ProvisioningSupervisor, EnsureOpts, ProvisionPlan, ProvisionHandle}`), **`sensei-local-providers`** (`adapters::{EmbeddedLlamaAdapter, OrtAdapter, OrtConfig, OrtPoolingStrategy, LlamaCppConfig}`), and **`sensei-kernel`** (`registry::{ModelEntry, ModelSource, ModelFormat, ModelResolver}`, `readiness::{ProvisionPhase, ProvisionEvent, ReadinessProbe}`, `adapters::{AdapterRegistry, RegisterInto, capability::{Model, ChatModel, EmbedModel}}`).

**Cargo feature flags (desktop `src-tauri`):** enable **`llama-cpp`** (EmbeddedLlamaAdapter + HfGguf/EmbeddedGguf plans), **`ort`** (OrtAdapter + Ort plan), **`hf-download`** (HfHubPuller + PullingResolver). **Disable `fastembed`** (DECISIONS §3 — `FastembedAdapter`/`ProvisionPlan::Fastembed` must not compile in). `kokoro` (TTS) is out of D2 scope.

| Issue | Status for D2 |
|---|---|
| **GH-3** — local embedding path | **RESOLVED, no crate change** (DECISIONS §3, gateway-issues.md). The embedded in-process path exists (`EmbeddedLlamaAdapter` GGUF embed / `OrtAdapter` ONNX); D2 only picks a **1024-dim** embed model + wires the embedding chain, **no external daemon, no `fastembed`**. |
| **GH-1** — per-step `plane` + execution-location on the trace | **Referenced (owned by the C2/D3 phase).** D2 tags each local call `execution_location='local'` and returns a `LocalAttempt`; the *unified* split-plane `ExecutionTrace` merge is D3 and depends on GH-1. D2's local **execution** does not block on GH-1 (it runs standalone); the unified-trace acceptance criteria do. |

**No new gateway issue is filed by D2.** Note (crate reality → open question 1): the `v0.4.6` fit pre-flight (`FitReport`) covers **disk + RAM only** (`sysinfo`); there is **no GPU/accelerator detection** in the crate. D2's accelerator advisory is app-side/best-effort in v1; a first-class accelerator-detection affordance would be a later, optional crate issue — not filed now.

---

## 8. Decisions resolved

Settling D2's residuals per the RESOLVED ARCHITECTURE DEFAULTS and the crate reality:

1. **"Embedded" = `EmbeddedLlamaAdapter` (llama.cpp, in-process) — NOT "embedded Ollama".** The desktop local plane runs models **in-process via `EmbeddedLlamaAdapter`** (chat+embed) and `OrtAdapter` (embed). **`OllamaResolver` is a read-through** that reuses bytes already in an existing `~/.ollama` cache (no daemon call for inference); `sensei-cloud-providers::OllamaAdapter` (HTTP-to-a-server) is a **cloud/router** option, not this path. *This corrects the D2 seed's and mockup §A.9's "embedded Ollama" wording (crate_issues / mockup_gaps).* *Rationale: verified — there is no embedded-Ollama inference path in `v0.4.6`; "embedded" means the in-process llama.cpp adapter.*
2. **Managed model root = `~/.torii/models` (app-configurable), not the crate default `~/.sensei/models`.** Set explicitly via `ManagedResolver::new(root)`. *Rationale: no-hardcoded-ops + product isolation; the crate default is a sensei-CLI convention, overridable by construction.*
3. **Default embed model = a 1024-dim GGUF for `EmbeddedLlamaAdapter` (e.g. `mxbai-embed-large` / `bge-large`), with `OrtAdapter` (ONNX, `OrtConfig::bert`, Mean pooling) as the alternate embed path.** D2 **asserts output dim == 1024** at registration and per-call; mismatch is a hard error. *Rationale: matches `document_embeddings vector(1024)` (F1 §9b, C5 §7.1) so the device and cloud indexes are interchangeable; a single llama backend already serves chat, so a GGUF embed model avoids a second runtime.*
4. **Default local chat model = a small instruct GGUF (operator-curated catalog; e.g. Llama-3.2-3B-Instruct / gemma2:2b-class), not a baked constant.** The catalog is operator-governed via the D4 snapshot (catalog overrides + feature governance). *Rationale: no-hardcoded-ops (DECISIONS §3 / project-gateway-no-hardcoded-ops); device RAM varies, so the offered/default model must be config, gated by fit.*
5. **v1 fit-gating uses the crate's disk+RAM pre-flight (`FitReport`); GPU/accelerator detection is best-effort advisory only.** A model is offered/pullable iff `FitReport.fits`; the accelerator field is informational. *Rationale: the crate provides only `sysinfo` disk+RAM (verified); a robust cross-platform GPU probe is out of v1's crate surface — advisory now, first-class later (open question 1).*
6. **`fastembed` disabled.** The `fastembed` Cargo feature is off; neither `FastembedAdapter` nor `ProvisionPlan::Fastembed` compiles into the desktop build. *Rationale: DECISIONS §3 explicitly disables it.*
7. **Local calls are `$0` but always logged + attributed** into D4's signed/idempotent buffer as `inference_calls (execution_location='local', cost_usd=0)`. *Rationale: DECISIONS §3 unified ledger + §2 anti-under-report; budgets stay unified across planes.*
8. **Remove/GC applies to Managed bytes only; Ollama read-through and External paths are never deleted.** *Rationale: the crate model — sensei owns only Managed; the Ollama daemon and the user own the other two.*
9. **`ProvisionPlan` matches carry a wildcard arm.** The enum is `#[non_exhaustive]` (feature-gated variants). *Rationale: crate contract — external matches must not assume the variant set.*

---

## 9. Acceptance criteria (observable, testable)

1. **Boot & registration.** After `LocalEngine::boot`, `AdapterRegistry::list()` includes the `EmbeddedLlamaAdapter` id under **both** the chat and embed capability maps and the `OrtAdapter` id under embed; the build compiles with `llama-cpp`+`ort`+`hf-download` and **without** the `fastembed` feature (no `FastembedAdapter` symbol); there is **no** `InferenceAdapter` reference.
2. **Registry enumeration.** `local_models_list` returns each known model with the correct `source_kind` (`managed`/`ollama`/`external`), size, capabilities, and a live `ProvisionPhase`; a model present only in the read-through Ollama cache appears as `ollama` and is not deletable.
3. **Fit pre-flight.** `local_model_check_fit` on an oversized model returns `fits=false` with a non-empty actionable `reason` and downloads **no** bytes; `local_model_pull` refuses it.
4. **Download lifecycle.** Pulling a fitting 1024-dim embed GGUF drives phases `Absent→Queued→Downloading{done,total}→Verifying→Loading→Ready`, each observable on `local-model://phase`; on completion a Managed `ModelEntry` with a verified `sha256` and a pinned `revision` is registered; a forced failure lands `Failed{error}` and registers nothing.
5. **Embedding dim contract.** `LocalEngine::embed` on the default embed model returns vectors of length **exactly 1024**; registering an embed model whose output is not 1024-dim is rejected at registration (hard error), and no non-1024 model can be set as the embed default.
6. **Local chat is `$0` and logged.** `LocalEngine::chat` returns a real local completion offline; exactly one `inference_calls` record with `execution_location='local'` and `cost_usd=0`, bound to the caller's subject node, is handed to the D4 buffer.
7. **Degradation, not block.** With a local model not `Ready`, D3's local step is told to fall through (via `phase()`), rather than the request hanging; a `Ready` model serves normally.
8. **Storage & GC.** `local_model_remove` on a Managed model deletes its bytes and drops `local_storage_usage.managed_bytes` accordingly; removing a referenced model or an Ollama/External entry returns a typed refusal; `local_gc` removes only unreferenced managed files.
9. **Managed root.** Managed models are written under `~/.torii/models` (configurable), not `~/.sensei/models`.
10. **No credentials on device.** No `router_credentials`/provider secret is read, stored, or logged by D2; a chain step requiring a credential is never fulfilled locally (it is proxied to C1 by D3); a log-scan test finds no secret.
11. **Offline capability.** With the network down, `local_models_list`, load, `chat`, and `embed` all succeed on already-downloaded models; a cloud-only chain degrades to the local free-floor step (via D3) at `$0`.
12. **Hardware detection.** `local_device_capabilities` reports CPU count + `sysinfo` RAM/disk consistent with `FitReport`, plus an accelerator advisory flagged `advisory:true`.
13. **Governance respected.** A local model disabled by the operator catalog / a `locked` feature (per the D4 snapshot) is not offered as pullable/default; a `user-overridable` default can be changed by the user only where governance permits.

---

## 10. Open questions (genuine)

1. **GPU/accelerator detection & acceleration selection.** The `v0.4.6` crate pre-flight is disk+RAM only; v1 treats the accelerator as advisory. Do we add a cross-platform GPU probe (Metal/CUDA/Vulkan) — app-side or as a later crate issue — and let it gate offer/fit and pick GPU layers, or stay CPU-guarded for v1? (Leaning advisory-only for v1; revisit for perf.)
2. **Local model catalog source.** Is the pullable catalog a curated in-app list, entirely operator-driven via central config (catalog overrides), or HF-search-backed? (v1: operator-governed catalog from the D4 snapshot + a curated default set; free HF search is a later add.)
3. **Device embed-model dim parity.** DECISIONS mandates 1024 on both planes so a single index is interchangeable; F1 §6 hedges that "device-local embeddings use a separate index (different dim)". Confirm the chosen local embed model is **exactly 1024** so the local and cloud RAG indexes are interoperable — and if a device must fall back to a non-1024 model, whether C5's local index tolerates a separate dim.
4. **GC reference model.** How `refcount` is maintained against local-RAG usage + device defaults + in-flight sessions, and when a model counts as safely unreferenced (interaction with C5's local index lifecycle).
5. **Multi-model memory ceiling.** The shared llama backend lazily loads per-(model,mode) workers; on modest devices holding a chat + an embed model simultaneously may exceed RAM. Do we need an LRU eviction / single-resident policy, and who owns it (D2 vs the crate's worker cache)?
