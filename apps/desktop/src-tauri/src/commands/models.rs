//! Local-models management backend — the Tauri IPC surface behind the desktop
//! "Models" screen (Phase 1b, local plane).
//!
//! Six commands let the frontend inventory, provision, and manage the local
//! model catalogue entirely in-process:
//!
//! * [`list_local_models`] — what's on this machine right now (managed + Ollama).
//! * [`available_models`]  — a curated, pullable catalogue with fit verdicts.
//! * [`device_info`]       — chip / RAM / disk / footprint for the header.
//! * [`set_default_model`] — persist the chat default (read back by `infer`).
//! * [`remove_model`]      — delete a managed model file (traversal-guarded).
//! * [`pull_model`]        — download a curated model from HF with progress events.
//!
//! Two sources back the catalogue, mirroring [`crate::gateway`]'s resolver chain:
//! Torii's own managed store (`~/.torii/models`, read-write) and a read-through
//! view of the local Ollama cache (`~/.ollama/models`, never written). Model
//! bytes are located and pulled through the engine's registry types
//! (`gateway::local::*` / `gateway::registry::*`, feature `local-hf-download`),
//! so this module never re-implements the HF pull or Ollama manifest walk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter};

// Extern engine crate (`sensei-gateway`, aliased `gateway`) — same import shape as
// `commands::infer`. `ModelResolver` / `ModelPuller` are traits brought in for their
// `.list()` / `.check_fit()` methods; `pull_with_progress` is inherent on `HfHubPuller`.
use gateway::local::{HfHubPuller, ManagedResolver, ModelPuller, OllamaResolver, PullSpec};
use gateway::registry::{ModelFormat, ModelResolver};

// Local module (`src/gateway.rs`) — the `~/.torii` + Ollama roots it already owns.
use crate::gateway::{home_dir, managed_models_dir, ollama_models_dir};

// ── Serde contract types (frozen — match the Svelte screen's expectations) ─────

/// A model already present on this machine.
#[derive(Serialize)]
pub struct LocalModel {
    id: String,
    name: String,
    /// `"gguf"` | `"onnx"` | `"safetensors"`.
    format: String,
    size_bytes: u64,
    /// `"managed"` (Torii-owned, removable) | `"ollama"` (read-through).
    source: String,
    is_default: bool,
    removable: bool,
    /// `"chat"` | `"embedding"` | `"unknown"` (inferred from the name).
    capability: String,
}

/// A curated model the user can pull, with a per-machine fit verdict.
#[derive(Serialize)]
pub struct AvailableModel {
    id: String,
    name: String,
    format: String,
    size_bytes: u64,
    ctx: u32,
    quant: String,
    installed: bool,
    fits: bool,
    need_gb: f64,
}

/// This machine's inventory for the Models screen header.
#[derive(Serialize)]
pub struct DeviceInfo {
    chip: String,
    ram_gb: f64,
    /// `"Metal"` on Apple Silicon, else `"CPU"`.
    accel: String,
    disk_total_gb: f64,
    models_gb: f64,
    models_count: u32,
}

// ── Constants ──────────────────────────────────────────────────────────────────

/// Bytes per GiB — the unit all `*_gb` fields report in.
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// Working-set multiplier over the on-disk model size: a GGUF loads roughly its
/// file size resident, plus a KV/context margin. Matches the engine's own gross
/// RAM guard (`evaluate_fit` uses 1.2); we surface 1.25 as the displayed estimate.
const WORKING_SET: f64 = 1.25;

/// Fallback chat model id when no default is persisted — the baseline the gateway
/// config ships with (`crate::gateway::baseline_local_config`).
const DEFAULT_MODEL_FALLBACK: &str = "gemma2:2b";

// ── Curated pull catalogue ─────────────────────────────────────────────────────

/// A known-good, pullable model. `id` doubles as the managed registry id and the
/// chat/embedding handle the frontend and `infer` address it by.
struct Curated {
    id: &'static str,
    name: &'static str,
    /// HF repo, e.g. `"bartowski/Llama-3.2-3B-Instruct-GGUF"`.
    repo: &'static str,
    /// Git revision to pin; `None` ⇒ `main`.
    revision: Option<&'static str>,
    /// Files to fetch; `files[0]` is the model file.
    files: &'static [&'static str],
    format: ModelFormat,
    /// Approximate on-disk size, used for the offline fit fallback + display.
    size_bytes: u64,
    ctx: u32,
    quant: &'static str,
}

/// The bundled catalogue. Deliberately small and curated: `pull_model` only ever
/// fetches an id present here, so no arbitrary HF repo can be pulled from the UI.
const CURATED: &[Curated] = &[
    Curated {
        id: "gemma2:2b",
        name: "Gemma 2 2B Instruct",
        repo: "bartowski/gemma-2-2b-it-GGUF",
        revision: None,
        files: &["gemma-2-2b-it-Q4_K_M.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 1_708_582_688, // ~1.6 GiB
        ctx: 8_192,
        quant: "Q4_K_M",
    },
    Curated {
        id: "llama3.2:1b",
        name: "Llama 3.2 1B Instruct",
        repo: "bartowski/Llama-3.2-1B-Instruct-GGUF",
        revision: None,
        files: &["Llama-3.2-1B-Instruct-Q4_K_M.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 808_000_000, // ~0.75 GiB
        ctx: 131_072,
        quant: "Q4_K_M",
    },
    Curated {
        id: "llama3.2:3b",
        name: "Llama 3.2 3B Instruct",
        repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
        revision: None,
        files: &["Llama-3.2-3B-Instruct-Q4_K_M.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 2_019_000_000, // ~1.9 GiB
        ctx: 131_072,
        quant: "Q4_K_M",
    },
    Curated {
        id: "qwen2.5-coder:1.5b",
        name: "Qwen2.5 Coder 1.5B Instruct",
        repo: "bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF",
        revision: None,
        files: &["Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 1_100_000_000, // ~1.0 GiB
        ctx: 32_768,
        quant: "Q4_K_M",
    },
    Curated {
        id: "mxbai-embed-large",
        name: "mxbai-embed-large v1 (1024-dim)",
        repo: "mixedbread-ai/mxbai-embed-large-v1",
        revision: None,
        files: &["gguf/mxbai-embed-large-v1-f16.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 670_000_000, // ~0.62 GiB
        ctx: 512,
        quant: "F16",
    },
    Curated {
        id: "nomic-embed-text",
        name: "Nomic Embed Text v1.5",
        repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
        revision: None,
        files: &["nomic-embed-text-v1.5.f16.gguf"],
        format: ModelFormat::Gguf,
        size_bytes: 274_000_000, // ~0.26 GiB
        ctx: 8_192,
        quant: "F16",
    },
];

// ── Commands ───────────────────────────────────────────────────────────────────

/// List every model present on this machine: Torii's managed store (removable)
/// plus a read-through view of the local Ollama cache (read-only).
///
/// Best-effort and never fails the whole call because one source is missing or
/// unreadable — an absent `~/.torii/models` or `~/.ollama/models` simply yields
/// nothing from that leg. De-duplicated by id (managed shadows Ollama).
#[tauri::command]
pub async fn list_local_models() -> Result<Vec<LocalModel>, String> {
    Ok(collect_local_models().await)
}

/// Return the curated, pullable catalogue annotated per this machine:
/// `installed` (already present locally) and a fit verdict (`fits` + `need_gb`).
///
/// The verdict comes from the engine's `check_fit` (a ranged size probe against
/// HF, no body download). When offline / the probe fails, it falls back to the
/// catalogue's bundled size estimate and assumes the model fits.
#[tauri::command]
pub async fn available_models() -> Result<Vec<AvailableModel>, String> {
    let installed: HashSet<String> = collect_local_models()
        .await
        .into_iter()
        .map(|m| m.id)
        .collect();

    let puller = HfHubPuller::new(ManagedResolver::new(managed_models_dir()), None);

    let mut out = Vec::with_capacity(CURATED.len());
    for c in CURATED {
        let (fits, need_gb) = match puller.check_fit(&pull_spec_for(c)).await {
            Ok(fit) => {
                let need_bytes = fit.model_bytes as f64 * WORKING_SET;
                (need_bytes <= fit.ram_total as f64, round2(need_bytes / GIB))
            }
            // Offline / probe failed: estimate from the bundled size, assume it fits.
            Err(_) => (true, round2(c.size_bytes as f64 * WORKING_SET / GIB)),
        };
        out.push(AvailableModel {
            id: c.id.to_string(),
            name: c.name.to_string(),
            format: format_str(c.format),
            size_bytes: c.size_bytes,
            ctx: c.ctx,
            quant: c.quant.to_string(),
            installed: installed.contains(c.id),
            fits,
            need_gb,
        });
    }
    Ok(out)
}

/// Report this machine's inventory: chip, total RAM, accelerator, total disk,
/// and the on-disk footprint (`models_gb`) + count of local models.
#[tauri::command]
pub async fn device_info() -> Result<DeviceInfo, String> {
    let models = collect_local_models().await;
    let models_count = models.len() as u32;
    let models_bytes: u64 = models.iter().map(|m| m.size_bytes).sum();

    let mut sys = System::new();
    sys.refresh_memory();
    let ram_gb = round2(sys.total_memory() as f64 / GIB);

    let disk_total_gb = round2(disk_total_for(&managed_models_dir()) as f64 / GIB);

    let accel = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "Metal"
    } else {
        "CPU"
    }
    .to_string();

    Ok(DeviceInfo {
        chip: detect_chip(),
        ram_gb,
        accel,
        disk_total_gb,
        models_gb: round2(models_bytes as f64 / GIB),
        models_count,
    })
}

/// Persist the default chat model id, read back by `infer` on requests that
/// don't name a model. The id must be a model currently present on this machine
/// (managed or Ollama); an unknown id is rejected rather than silently stored.
#[tauri::command]
pub async fn set_default_model(id: String) -> Result<(), String> {
    let known = collect_local_models().await.into_iter().any(|m| m.id == id);
    if !known {
        return Err(format!(
            "cannot set default: '{id}' is not a local model on this machine"
        ));
    }
    write_default(&id)
}

/// Delete a **managed** model's file from `~/.torii/models`.
///
/// Refuses to remove an Ollama model (the daemon owns those bytes) or the
/// current default. SECURITY: the resolved file path is canonicalized and
/// prefix-checked against the canonical managed root, so nothing outside it can
/// be deleted even via a `..` id or a symlink escaping the store.
#[tauri::command]
pub async fn remove_model(id: String) -> Result<(), String> {
    if id == read_default() {
        return Err(format!("cannot remove '{id}': it is the current default model"));
    }

    // Locate the on-disk file for this managed id, and confirm it IS managed.
    let managed_root = managed_models_dir();
    let managed = ManagedResolver::new(managed_root.clone());
    let target: PathBuf = match managed.resolve(&id).await.map_err(|e| e.to_string())? {
        Some(entry) => entry.source.path().to_path_buf(),
        // Not in the index: it may be a hand-dropped loose file, or an Ollama id.
        None => match scan_model_files(&managed_root)
            .into_iter()
            .find(|p| p.file_stem().and_then(|s| s.to_str()) == Some(id.as_str()))
        {
            Some(p) => p,
            None => {
                return Err(format!(
                    "cannot remove '{id}': not a managed model (Ollama models are read-only)"
                ))
            }
        },
    };

    // Traversal guard: the file (symlinks resolved) must live inside the managed
    // root (symlinks resolved). Canonicalize both; reject anything that escapes.
    let root_canon = std::fs::canonicalize(&managed_root).map_err(|e| e.to_string())?;
    let target_canon = std::fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&root_canon) {
        return Err(format!(
            "refusing to remove '{id}': resolved path escapes the managed model directory"
        ));
    }

    // Pulled models live in a per-id subdirectory (`<root>/<id>/<file>` — may hold
    // siblings like a tokenizer); remove the whole subdir. A loose top-level file
    // is removed on its own. Either way the deletion target stays inside the root.
    match target_canon.parent() {
        Some(parent) if parent != root_canon && parent.starts_with(&root_canon) => {
            std::fs::remove_dir_all(parent).map_err(|e| e.to_string())?;
        }
        _ => std::fs::remove_file(&target_canon).map_err(|e| e.to_string())?,
    }

    // Drop it from the managed index too (best-effort — the bytes are already gone).
    let _ = managed.remove(&id).await;
    Ok(())
}

/// Pull a curated model from the Hugging Face Hub into the managed store.
///
/// Only ids present in [`CURATED`] are accepted — no arbitrary repo can be
/// fetched from the UI. Progress is streamed to the frontend as Tauri events:
/// `model-pull-progress` `{id, done, total, pct}` ticks during the download,
/// then `model-pull-done` `{id}` on success or `model-pull-error` `{id, error}`
/// on failure (the latter also returns `Err`). The engine's `check_fit` runs
/// first, so a model that can't run here fails fast before any bytes are fetched.
#[tauri::command]
pub async fn pull_model(app: AppHandle, id: String) -> Result<(), String> {
    let Some(curated) = CURATED.iter().find(|c| c.id == id) else {
        return Err(format!("unknown model id '{id}' (not in the curated catalogue)"));
    };
    let spec = pull_spec_for(curated);

    let puller = HfHubPuller::new(ManagedResolver::new(managed_models_dir()), None);

    // Emit a coarse progress tick per staged file; `total` is the size check_fit
    // ranged-probed. Emit failures are ignored — a dropped tick is cosmetic.
    let mut on_progress = {
        let app = app.clone();
        let id = id.clone();
        move |done: u64, total: Option<u64>| {
            let pct = total.map(|t| if t > 0 { done * 100 / t } else { 0 });
            let _ = app.emit(
                "model-pull-progress",
                serde_json::json!({ "id": id, "done": done, "total": total, "pct": pct }),
            );
        }
    };

    match puller.pull_with_progress(&spec, &mut on_progress).await {
        Ok(_) => {
            let _ = app.emit("model-pull-done", serde_json::json!({ "id": id }));
            Ok(())
        }
        Err(e) => {
            let error = e.to_string();
            let _ = app.emit(
                "model-pull-error",
                serde_json::json!({ "id": id, "error": error }),
            );
            Err(error)
        }
    }
}

// ── Default-model persistence (`~/.torii/config.json`) ──────────────────────────

/// The desktop config blob. Kept intentionally tiny; new keys can be added with
/// `#[serde(default)]` without breaking existing files.
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct DesktopConfig {
    #[serde(default)]
    default_model: Option<String>,
}

/// Path to the desktop config file, `~/.torii/config.json` (sibling of `models/`).
fn config_path() -> PathBuf {
    home_dir().join(".torii").join("config.json")
}

/// The persisted default chat model id, or [`DEFAULT_MODEL_FALLBACK`] when unset
/// or unreadable. `pub(crate)` so `commands::infer` reads the same default.
pub(crate) fn read_default() -> String {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str::<DesktopConfig>(&s).ok())
        .and_then(|c| c.default_model)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL_FALLBACK.to_string())
}

/// Persist `id` as the default chat model via write-tmp-then-rename (so a partial
/// write can't corrupt the config).
fn write_default(id: &str) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let cfg = DesktopConfig {
        default_model: Some(id.to_string()),
    };
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Internals ────────────────────────────────────────────────────────────────

/// Gather the local catalogue from both sources. Shared by `list_local_models`,
/// `available_models`, `device_info`, `set_default_model`, and `remove_model`.
async fn collect_local_models() -> Vec<LocalModel> {
    let default = read_default();
    let mut out: Vec<LocalModel> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    // 1. Managed models from the authoritative index.json — the set `infer` can
    //    actually resolve, with correct registered ids and on-disk paths.
    let managed_root = managed_models_dir();
    let managed = ManagedResolver::new(managed_root.clone());
    if let Ok(entries) = managed.list().await {
        for e in entries {
            let path = e.source.path().to_path_buf();
            let size = e.size_bytes.unwrap_or_else(|| file_len(&path));
            if let Ok(c) = std::fs::canonicalize(&path) {
                seen_paths.insert(c);
            }
            let capability = capability_from_name(&e.name);
            seen_ids.insert(e.id.clone());
            out.push(LocalModel {
                is_default: e.id == default,
                id: e.id,
                name: e.name,
                format: format_str(e.format),
                size_bytes: size,
                source: "managed".to_string(),
                removable: true,
                capability,
            });
        }
    }

    // 2. Supplemental: loose *.gguf / *.onnx files under the managed root not in
    //    the index (e.g. a hand-dropped GGUF). De-duped by canonical path so a
    //    pulled model (already indexed) is never double-counted.
    for path in scan_model_files(&managed_root) {
        let canon = std::fs::canonicalize(&path).ok();
        if let Some(c) = &canon {
            if seen_paths.contains(c) {
                continue;
            }
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let id = stem.to_string();
        if !seen_ids.insert(id.clone()) {
            continue;
        }
        if let Some(c) = canon {
            seen_paths.insert(c);
        }
        let format = match path.extension().and_then(|e| e.to_str()) {
            Some(e) if e.eq_ignore_ascii_case("onnx") => "onnx",
            _ => "gguf",
        }
        .to_string();
        out.push(LocalModel {
            is_default: id == default,
            capability: capability_from_name(&id),
            name: id.clone(),
            id,
            format,
            size_bytes: file_len(&path),
            source: "managed".to_string(),
            removable: true,
        });
    }

    // 3. Ollama read-through cache (read-only; managed ids shadow it).
    let ollama = OllamaResolver::new(ollama_models_dir());
    if let Ok(entries) = ollama.list().await {
        for e in entries {
            if !seen_ids.insert(e.id.clone()) {
                continue;
            }
            let size = e.size_bytes.unwrap_or_else(|| file_len(e.source.path()));
            out.push(LocalModel {
                is_default: e.id == default,
                capability: capability_from_name(&e.name),
                id: e.id,
                name: e.name,
                format: format_str(e.format),
                size_bytes: size,
                source: "ollama".to_string(),
                removable: false,
            });
        }
    }

    out
}

/// Build a [`PullSpec`] from a curated catalogue entry.
fn pull_spec_for(c: &Curated) -> PullSpec {
    PullSpec {
        repo: c.repo.to_string(),
        revision: c.revision.map(str::to_string),
        id: c.id.to_string(),
        name: Some(c.name.to_string()),
        format: c.format,
        files: c.files.iter().map(|f| f.to_string()).collect(),
    }
}

/// Recursively collect every `*.gguf` / `*.onnx` file under `root` (case-insensitive
/// extension). Best-effort: unreadable directories are skipped, not errored.
fn scan_model_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() {
                stack.push(path);
            } else if ft.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("gguf") || ext.eq_ignore_ascii_case("onnx") {
                        out.push(path);
                    }
                }
            }
        }
    }
    out
}

/// Total space on the filesystem holding `path` (the disk whose mount point is the
/// longest prefix of the nearest existing ancestor of `path`). `0` if none matches.
fn disk_total_for(path: &Path) -> u64 {
    let probe = nearest_existing(path);
    Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| probe.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.total_space())
        .unwrap_or(0)
}

/// Canonicalize the nearest existing ancestor of `path` (the managed root may not
/// exist yet, but a parent filesystem does).
fn nearest_existing(path: &Path) -> PathBuf {
    let mut probe = path;
    loop {
        if let Ok(c) = probe.canonicalize() {
            return c;
        }
        match probe.parent() {
            Some(p) => probe = p,
            None => return path.to_path_buf(),
        }
    }
}

/// The CPU/chip brand string. On macOS reads `sysctl -n machdep.cpu.brand_string`
/// (returns e.g. `"Apple M2"`); falls back to `sysinfo`'s CPU brand elsewhere.
fn detect_chip() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
        {
            if out.status.success() {
                let brand = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !brand.is_empty() {
                    return brand;
                }
            }
        }
    }
    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown".to_string())
}

/// File length in bytes, or `0` if the file is missing / unreadable.
fn file_len(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// Serialize a [`ModelFormat`] to the frontend's lowercase string.
fn format_str(f: ModelFormat) -> String {
    match f {
        ModelFormat::Gguf => "gguf",
        ModelFormat::Onnx => "onnx",
        ModelFormat::Safetensors => "safetensors",
    }
    .to_string()
}

/// Infer a capability class from a model name/id: anything containing `embed`
/// is an embedding model, everything else is treated as chat.
fn capability_from_name(name: &str) -> String {
    if name.to_ascii_lowercase().contains("embed") {
        "embedding"
    } else {
        "chat"
    }
    .to_string()
}

/// Round to two decimals for the `*_gb` display fields.
fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_str_maps_all_variants() {
        assert_eq!(format_str(ModelFormat::Gguf), "gguf");
        assert_eq!(format_str(ModelFormat::Onnx), "onnx");
        assert_eq!(format_str(ModelFormat::Safetensors), "safetensors");
    }

    #[test]
    fn capability_is_inferred_from_name() {
        assert_eq!(capability_from_name("mxbai-embed-large"), "embedding");
        assert_eq!(capability_from_name("nomic-embed-text"), "embedding");
        assert_eq!(capability_from_name("gemma2:2b"), "chat");
    }

    #[test]
    fn curated_ids_are_unique_and_specs_have_files() {
        let mut ids = HashSet::new();
        for c in CURATED {
            assert!(ids.insert(c.id), "duplicate curated id: {}", c.id);
            let spec = pull_spec_for(c);
            assert_eq!(spec.id, c.id);
            assert!(!spec.files.is_empty(), "{} has no files", c.id);
        }
        // The four ids the contract requires are present.
        for required in ["gemma2:2b", "llama3.2:3b", "mxbai-embed-large"] {
            assert!(
                CURATED.iter().any(|c| c.id == required),
                "missing required curated id: {required}"
            );
        }
        assert!(CURATED.iter().any(|c| c.id.starts_with("qwen2.5-coder")));
    }
}
