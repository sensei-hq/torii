//! The registry torii ships (AG-9, torii#46 — SP-REG-4): a planning agent designated the default
//! planner and declaring the five discovery tools, a few role agents, keyword-gated skills, the
//! discovery tools' specs, and `(area, kind)` chain bindings onto the seeded catalog's chains.
//!
//! `torii config init` writes it out for editing (`--dir`) or pushes it as-is (`--push`). The
//! content is compiled into the binary, so `init` works from an installed or containerised
//! `torii` with no source tree beside it.

use std::collections::HashMap;
use std::path::PathBuf;

use include_dir::{include_dir, Dir};
use orchestrator_core::{
    AgentDefinition, ChainBinding, OrchestratorError, Permissions, RegistryConfig, SkillDef,
    ToolSpec,
};

/// The shipped registry directory, `crates/core/defaults/`, in the layout `config push` reads.
static DEFAULTS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/defaults");

/// The shipped registry, parsed file by file with the readers the gateway's
/// `FilesystemConfigSource` (the directory `config push` reads) uses — `from_frontmatter` for
/// `agents/*.md` and `skills/*.md`, serde for `tools/*.json`, `chains.json` and `grants.json`.
/// A test reads the same files through `FilesystemConfigSource` itself and requires the same
/// config, so the two cannot drift.
pub fn config() -> Result<RegistryConfig, OrchestratorError> {
    let load = |what: String, e: &dyn std::fmt::Display| {
        OrchestratorError::RegistryLoad(format!("the built-in defaults: {what}: {e}"))
    };
    let mut cfg = RegistryConfig::default();
    for (path, md) in layer("agents", "md") {
        cfg.agents.push(
            AgentDefinition::from_frontmatter(md)
                .map_err(|e| load(format!("parse agent {}", path.display()), &e))?,
        );
    }
    for (path, md) in layer("skills", "md") {
        cfg.skills.push(
            SkillDef::from_frontmatter(md)
                .map_err(|e| load(format!("parse skill {}", path.display()), &e))?,
        );
    }
    for (path, json) in layer("tools", "json") {
        cfg.tools.push(
            serde_json::from_str::<ToolSpec>(json)
                .map_err(|e| load(format!("parse tool {}", path.display()), &e))?,
        );
    }
    if let Some(json) = root_file("chains.json") {
        cfg.chain_bindings = serde_json::from_str::<Vec<ChainBinding>>(json)
            .map_err(|e| load("parse chains.json".into(), &e))?;
    }
    if let Some(json) = root_file("grants.json") {
        let all: HashMap<String, HashMap<String, Permissions>> =
            serde_json::from_str(json).map_err(|e| load("parse grants.json".into(), &e))?;
        for (agent, grants) in all {
            cfg.agents
                .iter_mut()
                .find(|a| a.name == agent)
                .ok_or_else(|| {
                    load(
                        "grants.json".into(),
                        &format!("names unknown agent {agent}"),
                    )
                })?
                .grants
                .extend(grants);
        }
    }
    Ok(cfg)
}

/// The shipped registry directory's files, relative to its root, in path order.
pub fn files() -> Vec<(PathBuf, &'static str)> {
    let mut out = Vec::new();
    collect(&DEFAULTS, &mut out);
    out.sort();
    out
}

fn collect(dir: &'static Dir<'static>, out: &mut Vec<(PathBuf, &'static str)>) {
    for f in dir.files() {
        if let Some(text) = f.contents_utf8() {
            out.push((f.path().to_path_buf(), text));
        }
    }
    for d in dir.dirs() {
        collect(d, out);
    }
}

/// `<sub>/*.<ext>` — flat, like the directory reader: a file one level deeper is not read.
fn layer(sub: &str, ext: &str) -> Vec<(PathBuf, &'static str)> {
    let mut out: Vec<_> = DEFAULTS
        .get_dir(sub)
        .map(|d| {
            d.files()
                .filter(|f| f.path().extension().and_then(|x| x.to_str()) == Some(ext))
                .filter_map(|f| Some((f.path().to_path_buf(), f.contents_utf8()?)))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

fn root_file(name: &str) -> Option<&'static str> {
    DEFAULTS.get_file(name).and_then(|f| f.contents_utf8())
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchestrator_core::{Activation, EffectClass, Registry, PLANNER_AREA};

    /// The five tools gateway v0.11's `Executor::pinned` composes per run.
    const DISCOVERY_TOOLS: [&str; 5] = [
        "list_agents",
        "list_skills",
        "list_tools",
        "list_chains",
        "validate_plan",
    ];

    fn registry() -> Registry {
        Registry::from_config(config().expect("the defaults parse"))
            .expect("the defaults assemble into a valid registry")
    }

    /// Gate item 3: what ships parses AND assembles — and is not trivially valid by being empty.
    #[test]
    fn the_defaults_assemble_into_a_valid_registry_with_agents_skills_and_tools() {
        let r = registry();
        assert!(r.agents().count() >= 2, "a planner and someone to plan for");
        assert!(r.skills().count() >= 1, "at least one skill ships");
        assert!(r.tools().count() >= DISCOVERY_TOOLS.len());
    }

    /// `PlannerRef::Select` picks among `area: planning` agents: exactly one ships, and it is
    /// the designated default, so an operator's added planner never silently wins by name.
    #[test]
    fn exactly_one_planning_agent_ships_and_it_is_the_designated_default_planner() {
        let r = registry();
        let planners: Vec<_> = r.agents().filter(|a| a.area == PLANNER_AREA).collect();
        assert_eq!(planners.len(), 1, "{:?}", planners);
        assert!(planners[0].default_planner, "{:?}", planners[0].name);
    }

    /// Wired is not granted: the planner can call a discovery tool only if it DECLARES it and
    /// the registry DEFINES its schema. Both, for all five, with the gateway's effect class.
    #[test]
    fn the_planner_declares_every_discovery_tool_and_the_registry_defines_each() {
        let r = registry();
        let planner = r
            .agents()
            .find(|a| a.area == PLANNER_AREA)
            .expect("a planner ships");
        for name in DISCOVERY_TOOLS {
            assert!(
                planner.tools.iter().any(|t| t == name),
                "the planner does not declare {name}: {:?}",
                planner.tools
            );
            let spec = r
                .tool(name)
                .unwrap_or_else(|| panic!("no tools/{name}.json"));
            assert_eq!(spec.effect_class, EffectClass::Pure, "{name}");
            assert_eq!(
                spec.activation,
                Activation::Always,
                "{name} must not hide behind keywords — the planner needs it on every goal"
            );
        }
    }

    /// Every shipped agent routes: an agent that resolves no chain is decorative.
    #[test]
    fn every_shipped_agent_resolves_a_chain() {
        let r = registry();
        assert!(r.agents().count() > 0, "precondition");
        for a in r.agents() {
            r.resolve_chain(a, None)
                .unwrap_or_else(|e| panic!("agent {:?} routes nowhere: {e}", a.name));
        }
    }

    /// Gate item 2's Wrong Gate: keyword sets "a real prompt would hit". Each prompt below is
    /// one an operator would type; each skill must switch on for its own and stay off for the
    /// rest, so a skill is neither dead nor always-on in disguise.
    #[test]
    fn every_shipped_skill_is_keyword_gated_on_the_words_real_prompts_use() {
        let r = registry();
        let prompts: [(&str, &[&str]); 5] = [
            (
                "Summarize this quarterly earnings report in five bullet points",
                &["summarize"],
            ),
            (
                "Investigate the trade-offs between Postgres and SQLite for an offline-first app",
                &["research-method"],
            ),
            (
                "Review the pull request that refactors the retry loop and point out any bug",
                &["code-review"],
            ),
            (
                "Return the list of open invoices as JSON with one object per invoice",
                &["structured-output"],
            ),
            ("Write a short poem about autumn for a greeting card", &[]),
        ];
        let skills: Vec<_> = r.skills().collect();
        assert!(!skills.is_empty(), "precondition");
        for s in &skills {
            assert!(
                matches!(&s.activation, Activation::OnKeywords(kw) if !kw.is_empty()),
                "skill {:?} is unconditional: it would be composed into every prompt",
                s.name
            );
        }
        for (prompt, want) in prompts {
            let mut active: Vec<&str> = skills
                .iter()
                .filter(|s| s.activation.is_active(prompt))
                .map(|s| s.name.as_str())
                .collect();
            active.sort();
            assert_eq!(active, want, "skills active for {prompt:?}");
        }
    }

    /// `init --dir` writes the defaults with `registry_dir::pull`, so the shipped files must be
    /// exactly what that writes: an operator's `git diff` of a fresh `init` against the source
    /// is then empty, and `init`, `pull` and the shipped tree can never disagree.
    #[test]
    fn the_shipped_files_are_exactly_what_config_pull_writes_for_them() {
        let shipped = files();
        assert!(!shipped.is_empty(), "precondition: files ship");
        let rendered: Vec<(PathBuf, String)> =
            crate::registry_dir::render(&config().expect("parse"))
                .expect("render")
                .into_iter()
                .map(|f| (f.path, f.contents))
                .collect();
        let mut rendered = rendered;
        rendered.sort();
        let shipped: Vec<(PathBuf, String)> = shipped
            .into_iter()
            .map(|(p, c)| (p, c.to_string()))
            .collect();
        assert_eq!(shipped, rendered);
    }

    /// The in-binary parse is the directory reader `config push` uses, file for file: the
    /// shipped tree, extracted to disk and read by `FilesystemConfigSource`, is the same config.
    #[tokio::test]
    async fn the_defaults_read_back_identically_through_the_reader_push_uses() {
        use orchestrator_core::ConfigSource;
        let dir = tempfile::tempdir().unwrap();
        let shipped = files();
        assert!(!shipped.is_empty(), "precondition: files ship");
        for (path, contents) in shipped {
            let p = dir.path().join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, contents).unwrap();
        }
        let read = gateway_store::FilesystemConfigSource::new(dir.path())
            .load()
            .await
            .expect("the shipped tree loads");
        let canon = |mut c: RegistryConfig| {
            c.agents.sort_by(|a, b| a.name.cmp(&b.name));
            c.skills.sort_by(|a, b| a.name.cmp(&b.name));
            c.tools.sort_by(|a, b| a.name.cmp(&b.name));
            c.chain_bindings
                .sort_by(|a, b| (&a.area, &a.kind).cmp(&(&b.area, &b.kind)));
            serde_json::to_value(c).unwrap()
        };
        assert_eq!(canon(read), canon(config().expect("parse")));
    }
}
