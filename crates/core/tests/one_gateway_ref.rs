//! TM-8a: torii never mixes gateway versions. Every `sensei-*` dependency on
//! `github.com/sensei-hq/gateway`, in every manifest of the workspace, pins the SAME git ref —
//! otherwise the API, the CLI and the stores could each build against a different gateway and
//! two copies of its types would meet (the "mixed model" the shared torii-core exists to end).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn manifests(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.join("Cargo.toml")];
    for dir in ["crates", "services", "apps"] {
        let Ok(entries) = std::fs::read_dir(root.join(dir)) else {
            continue;
        };
        for e in entries.flatten() {
            for candidate in [
                e.path().join("Cargo.toml"),
                e.path().join("src-tauri/Cargo.toml"),
            ] {
                if candidate.is_file() {
                    out.push(candidate);
                }
            }
        }
    }
    out
}

/// The `branch = …` / `tag = …` / `rev = …` of each gateway git dependency line.
fn gateway_refs(manifest: &Path) -> Vec<(String, String)> {
    let text = std::fs::read_to_string(manifest).unwrap();
    text.lines()
        .filter(|l| l.contains("git = \"https://github.com/sensei-hq/gateway\""))
        .map(|l| {
            let r = ["tag", "branch", "rev"]
                .iter()
                .find_map(|k| {
                    let key = format!("{k} = \"");
                    l.find(&key).map(|i| {
                        let rest = &l[i + key.len()..];
                        format!("{k}={}", &rest[..rest.find('"').unwrap()])
                    })
                })
                .unwrap_or_else(|| "default-branch".to_string());
            (l.trim().to_string(), r)
        })
        .collect()
}

#[test]
fn every_gateway_dependency_pins_the_same_ref() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut by_ref: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for m in manifests(&root) {
        for (line, r) in gateway_refs(&m) {
            by_ref
                .entry(r)
                .or_default()
                .push(format!("{}: {line}", m.display()));
        }
    }
    assert!(
        by_ref.values().map(Vec::len).sum::<usize>() >= 5,
        "found too few gateway dependencies to mean anything: {by_ref:#?}"
    );
    assert_eq!(
        by_ref.len(),
        1,
        "torii pins the gateway at more than one ref — the API, the CLI and the stores must \
         build against ONE gateway:\n{by_ref:#?}"
    );
}
