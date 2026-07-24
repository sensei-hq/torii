# D2 · Embedded local gateway & model manager

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Device · **Status:** Planned · **Depends on:** D1 · the `sensei-local-engine` / `sensei-local-providers` wing of the `sensei-*` crates (`v0.4.6`)

## Purpose

Run local models, embeddings, and reasoning on the device — the desktop's offline/private/$0 superpower.

## What we build

- Integrate the **local engine wing** of the `sensei-*` crates (`v0.4.6`): **`sensei-local-engine`** (resolvers + model pull) and **`sensei-local-providers`** (in-process adapters), driven through the `sensei-gateway` `local` wing. Local chat + embeddings run via **embedded Ollama** — the crate resolves/pulls the model and serves it locally. **`fastembed` is a disabled placeholder — do not reference or use it.**
- **Model registry** via the crate's resolvers (`kernel::registry`): managed (`~/.strategos/models`), Ollama read-through, external paths — composed via `ChainedResolver`; model pull handled by the engine (HF-hub puller + provisioning supervisor).
- **Model manager**: browse / download / update / remove, storage usage + GC, hardware/capability detection, set local default. The **embedding model must be 1024-dim** (e.g. `mxbai-embed-large` / `bge-large`) to match F1 `document_embeddings vector(1024)`.
- Expose local inference + registry over Tauri commands to D3.

## Key contracts / data

- Capability traits **`ChatModel`** / **`EmbedModel`** (`kernel::adapters::capability`) — there is no `InferenceAdapter`.
- Model vocabulary **`ModelResolver`** / **`ModelEntry`** / **`ModelSource`** (`kernel::registry`; `ModelSource` = Managed / Ollama / External).
- Provisioning via the `sensei-local-engine` supervisor (`EnsureOpts` / `ProvisionPlan`) + resolvers.

## UI surfaces

- New **Local models & downloads** screen (desktop-only; a new screen for designer handoff, DECISIONS §6); local-tier markers on the model picker.

## Reuse / source

`sensei-local-engine` (`registry/`, supervisor) + `sensei-local-providers` (`adapters/`); Sensei model/hardware detection + Ollama read-through.

## Open questions

- Local model catalog source; default local **chat** model (embed model is constrained to 1024-dim — e.g. `mxbai-embed-large` / `bge-large`).
