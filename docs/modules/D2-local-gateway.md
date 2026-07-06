# D2 · Embedded local gateway & model manager

**Plane:** Device · **Status:** Planned · **Depends on:** D1 · external crate `gateway-embedded`

## Purpose

Run local models, embeddings, and reasoning on the device — the desktop's offline/private/$0 superpower.

## What we build

- Integrate **`gateway-embedded`** (feature-gated `llama-cpp` / `fastembed` / `ort`); start with `fastembed` (embeddings) + `llama-cpp` (local chat).
- **Model registry** via the crate's resolvers: managed (`~/.strategos/models`), Ollama read-through, external paths.
- **Model manager**: browse / download / update / remove, storage usage + GC, hardware/capability detection, set local default.
- Expose local inference + registry over Tauri commands to D3.

## Key contracts / data

- `InferenceAdapter`, `ModelResolver`, `ModelEntry`, `ModelSource` (gateway-embedded).

## UI surfaces

- New **Local models & downloads** screen (desktop-only); local-tier markers on the model picker.

## Reuse / source

`gateway-embedded` (`registry/`, `adapters/`); Sensei model/hardware detection + Ollama read-through.

## Open questions

- Which engines ship in v1 (lean `fastembed` + `llama-cpp`).
- Local model catalog source; default local model.
