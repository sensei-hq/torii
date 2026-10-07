//! Reading the deployed registry back out (AG-6, torii#35): `config show` and `config pull`.
//!
//! [`snapshot`] is the one read: ONE `load_versioned` — the registry and the generation it is
//! at, from the same snapshot — so a UI never pairs a fresh registry with a stale generation.
//!
//! [`pull`] writes that registry as the directory `config push` reads (the gateway's
//! `FilesystemConfigSource`): `agents/*.md` and `skills/*.md` as frontmatter + body,
//! `tools/*.json` as a `ToolSpec`, and `chains.json` / `grants.json` in the root. The format
//! is the controlled frontmatter subset `AgentDefinition::from_frontmatter` parses — not
//! YAML — so not every value is expressible in it (a newline in a name, a list item holding a
//! comma, a sub-second timeout). Every rendered file is parsed back with the very parser
//! `push` uses BEFORE anything is written, and a value that would not read back identically
//! is refused, naming the entity and the field: a pull that silently changed the registry
//! would make the next push of it an unannounced edit.

use std::path::{Path, PathBuf};

use orchestrator_core::{
    AgentDefinition, ConfigSource, OrchestratorError, RegistryConfig, SkillDef,
};
use serde::Serialize;

/// The live registry and the generation it was read at — one `load_versioned` snapshot.
///
/// Entities are in a canonical order (agents, skills and tools by name; chain bindings by
/// `(area, kind)`), so two snapshots of the same registry serialize identically whatever
/// order the store returned them in.
#[derive(Debug, Clone, Serialize)]
pub struct RegistrySnapshot {
    pub generation: u64,
    pub registry: RegistryConfig,
}

/// Read the live registry and its generation in ONE `load_versioned` call.
pub async fn snapshot(src: &dyn ConfigSource) -> Result<RegistrySnapshot, OrchestratorError> {
    let _ = src;
    Ok(RegistrySnapshot {
        generation: 0,
        registry: RegistryConfig::default(),
    })
}

/// One file of a pulled registry directory, relative to its root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistryFile {
    pub path: PathBuf,
    pub contents: String,
}

/// What [`pull`] wrote.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PullReport {
    pub agents: usize,
    pub skills: usize,
    pub tools: usize,
    pub chain_bindings: usize,
    /// Registry-layout files a `--force` pull removed before writing.
    pub removed: usize,
}

/// Why a pull refused or failed. Nothing is written on any refusal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullError {
    /// A value the directory format cannot carry: the next push would change it.
    Unrepresentable(String),
    /// The target directory has entries and `force` was not given.
    NotEmpty(PathBuf),
    /// A filesystem failure (the message names the path).
    Io(String),
}

impl std::fmt::Display for PullError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PullError::Unrepresentable(m) | PullError::Io(m) => f.write_str(m),
            PullError::NotEmpty(p) => write!(f, "{} is not empty", p.display()),
        }
    }
}

impl std::error::Error for PullError {}

/// An agent as the `agents/*.md` file `push` reads. Its `grants` are NOT part of it — they
/// live in the root's `grants.json`.
pub fn render_agent(a: &AgentDefinition) -> Result<String, PullError> {
    let _ = a;
    Ok(String::new())
}

/// A skill as the `skills/*.md` file `push` reads.
pub fn render_skill(s: &SkillDef) -> Result<String, PullError> {
    let _ = s;
    Ok(String::new())
}

/// Every file of the registry directory for `cfg`, validated, in a stable order.
pub fn render(cfg: &RegistryConfig) -> Result<Vec<RegistryFile>, PullError> {
    let _ = cfg;
    Ok(Vec::new())
}

/// Write `cfg` into `dir` as the layout `config push` reads.
///
/// Refuses a non-empty `dir` unless `force`; with `force` it first removes every file `push`
/// would read (`agents/*.md`, `skills/*.md`, `tools/*.json`, `chains.json`, `grants.json`) and
/// leaves anything else alone, so the result pushes back as exactly `cfg`.
pub fn pull(cfg: &RegistryConfig, dir: &Path, force: bool) -> Result<PullReport, PullError> {
    let _ = (cfg, dir, force);
    Ok(PullReport::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchestrator_core::{
        Activation, AgentBacking, ChainBinding, EffectClass, NetworkPolicy, Permissions, ToolSpec,
    };
    use std::collections::HashMap;

    fn agent(name: &str) -> AgentDefinition {
        AgentDefinition {
            name: name.into(),
            area: "research".into(),
            kind: "lead".into(),
            chain: Some("chat".into()),
            chains: HashMap::new(),
            grants: HashMap::new(),
            tools: vec![],
            skills: vec![],
            system_prompt: "You research.\n".into(),
            backed_by: AgentBacking::Model,
            default_planner: false,
            tool_limits: HashMap::new(),
            confirm_tools: vec![],
            confirm_timeout: None,
            escalate_to: None,
        }
    }

    fn skill(name: &str) -> SkillDef {
        SkillDef {
            name: name.into(),
            description: None,
            body: "Be terse.\n".into(),
            activation: Activation::Always,
        }
    }

    fn tool(name: &str) -> ToolSpec {
        ToolSpec {
            name: name.into(),
            description: Some("ship it".into()),
            input_schema: serde_json::json!({"type": "object", "properties": {"n": {"type": "number"}}}),
            effect_class: EffectClass::Mutation,
            ttl_secs: None,
            source: None,
            permissions: Permissions {
                commands: vec!["git".into()],
                ..Permissions::default()
            },
            activation: Activation::OnKeywords(vec!["ship".into()]),
            credentials: vec!["github".into()],
        }
    }

    /// Every key the agent frontmatter carries, AG-15's included.
    fn full_agent() -> AgentDefinition {
        AgentDefinition {
            name: "deployer".into(),
            area: "ops".into(),
            kind: "deploy".into(),
            chain: Some("chat".into()),
            chains: HashMap::from([
                ("plan".to_string(), "chat.plan".to_string()),
                ("act".to_string(), "chat".to_string()),
            ]),
            grants: HashMap::new(),
            tools: vec!["deploy".into(), "shell".into()],
            skills: vec!["concise".into()],
            system_prompt: "You deploy.\n\n---\nCarefully: a rule line is body text.\n".into(),
            backed_by: AgentBacking::Model,
            default_planner: false,
            tool_limits: HashMap::from([("shell".to_string(), 3), ("deploy".to_string(), 1)]),
            confirm_tools: vec!["deploy".into()],
            confirm_timeout: Some(chrono::Duration::hours(2)),
            escalate_to: None,
        }
    }

    fn json<T: Serialize>(t: &T) -> serde_json::Value {
        serde_json::to_value(t).unwrap()
    }

    /// The agent as `push` would read it back, grants aside (they live in `grants.json`).
    fn reparsed_agent(a: &AgentDefinition) -> AgentDefinition {
        let md = render_agent(a).expect("renders");
        AgentDefinition::from_frontmatter(&md)
            .unwrap_or_else(|e| panic!("the rendered agent must parse: {e}\n{md}"))
    }

    #[test]
    fn a_plain_agent_renders_as_the_hand_authored_file() {
        assert_eq!(
            render_agent(&agent("researcher")).unwrap(),
            "---\nname: researcher\narea: research\nkind: lead\nchain: chat\ntools: []\nskills: []\n---\nYou research.\n"
        );
    }

    #[test]
    fn every_agent_key_round_trips_through_the_push_parser() {
        let a = full_agent();
        assert_eq!(json(&reparsed_agent(&a)), json(&a));
        let md = render_agent(&a).unwrap();
        // Map-valued keys render in a stable (sorted) order, so a pull is deterministic.
        assert!(md.contains("chains: [act=chat, plan=chat.plan]\n"), "{md}");
        assert!(md.contains("tool_limits: [deploy=1, shell=3]\n"), "{md}");
        assert!(
            md.contains("confirm_tools: [deploy]\nconfirm_timeout: 2h\n"),
            "{md}"
        );
    }

    #[test]
    fn a_human_backed_agent_keeps_its_sla_escalation_and_planner_mark() {
        let mut a = agent("reviewer");
        a.chain = None;
        a.backed_by = AgentBacking::Human {
            timeout: Some(chrono::Duration::days(2)),
        };
        a.escalate_to = Some("lead".into());
        let md = render_agent(&a).unwrap();
        assert!(md.contains("backed_by: human\ntimeout: 2d\n"), "{md}");
        assert!(md.contains("escalate_to: lead\n"), "{md}");
        assert!(
            !md.contains("chain:"),
            "no chain key when there is none: {md}"
        );
        assert_eq!(json(&reparsed_agent(&a)), json(&a));

        let mut untimed = agent("lead");
        untimed.backed_by = AgentBacking::Human { timeout: None };
        assert_eq!(json(&reparsed_agent(&untimed)), json(&untimed));

        let mut planner = agent("planner");
        planner.area = "planning".into();
        planner.default_planner = true;
        let md = render_agent(&planner).unwrap();
        assert!(md.contains("default_planner: true\n"), "{md}");
        assert_eq!(json(&reparsed_agent(&planner)), json(&planner));
    }

    #[test]
    fn a_duration_renders_in_its_largest_exact_unit() {
        for (d, text) in [
            (chrono::Duration::seconds(45), "45s"),
            (chrono::Duration::minutes(90), "90m"),
            (chrono::Duration::hours(48), "2d"),
            (chrono::Duration::hours(36), "36h"),
            (chrono::Duration::seconds(3_601), "3601s"),
        ] {
            let mut a = agent("a");
            a.tools = vec!["t".into()];
            a.confirm_tools = vec!["t".into()];
            a.confirm_timeout = Some(d);
            let md = render_agent(&a).unwrap();
            assert!(md.contains(&format!("confirm_timeout: {text}\n")), "{md}");
            assert_eq!(json(&reparsed_agent(&a)), json(&a));
        }
    }

    #[test]
    fn skills_render_as_the_hand_authored_file() {
        assert_eq!(
            render_skill(&skill("concise")).unwrap(),
            "---\nname: concise\n---\nBe terse.\n"
        );
        let mut s = skill("summary");
        s.description = Some("Summarize: briefly".into());
        s.activation = Activation::OnKeywords(vec!["summarize".into(), "tldr".into()]);
        let md = render_skill(&s).unwrap();
        assert_eq!(
            md,
            "---\nname: summary\ndescription: Summarize: briefly\nactivate_on: [summarize, tldr]\n---\nBe terse.\n"
        );
        assert_eq!(json(&SkillDef::from_frontmatter(&md).unwrap()), json(&s));

        // An empty description is still a description.
        let mut empty = skill("e");
        empty.description = Some(String::new());
        let md = render_skill(&empty).unwrap();
        assert_eq!(
            json(&SkillDef::from_frontmatter(&md).unwrap()),
            json(&empty)
        );
    }

    /// A value the frontmatter subset cannot carry is refused — naming the entity and the
    /// field — rather than written as something `push` would read back differently.
    #[test]
    fn a_value_the_format_cannot_carry_is_refused_naming_entity_and_field() {
        let refused = |r: Result<String, PullError>, needles: &[&str]| {
            let e = r.expect_err("must refuse");
            assert!(matches!(e, PullError::Unrepresentable(_)), "{e:?}");
            let m = e.to_string();
            for n in needles {
                assert!(m.contains(n), "{n:?} not in: {m}");
            }
        };
        let mut a = agent("leading");
        a.system_prompt = "\nstarts with a blank line".into();
        refused(render_agent(&a), &["agent \"leading\"", "system_prompt"]);

        let mut a = agent("multi");
        a.kind = "two\nlines".into();
        refused(render_agent(&a), &["agent \"multi\"", "kind"]);

        let mut a = agent("comma");
        a.tools = vec!["a,b".into()];
        refused(render_agent(&a), &["agent \"comma\"", "tools"]);

        let mut a = agent("padded");
        a.area = " ops".into();
        refused(render_agent(&a), &["agent \"padded\"", "area"]);

        let mut a = agent("subsecond");
        a.backed_by = AgentBacking::Human {
            timeout: Some(chrono::Duration::milliseconds(1_500)),
        };
        refused(render_agent(&a), &["agent \"subsecond\"", "backed_by"]);

        let mut a = agent("emptychain");
        a.chain = Some(String::new());
        refused(render_agent(&a), &["agent \"emptychain\"", "chain"]);

        let mut s = skill("nokw");
        s.activation = Activation::OnKeywords(vec![]);
        refused(render_skill(&s), &["skill \"nokw\"", "activation"]);

        let mut s = skill("listy");
        s.description = Some("[looks, like, a list]".into());
        refused(render_skill(&s), &["skill \"listy\"", "description"]);
    }

    fn registry() -> RegistryConfig {
        let mut deployer = full_agent();
        deployer.grants = HashMap::from([(
            "shell".to_string(),
            Permissions {
                paths: vec!["/workspace".into()],
                commands: vec!["ls".into()],
                network: NetworkPolicy::Hosts(vec!["example.com".into()]),
                ..Permissions::default()
            },
        )]);
        RegistryConfig {
            agents: vec![agent("researcher"), deployer],
            skills: vec![skill("concise")],
            tools: vec![tool("deploy"), tool("shell")],
            chain_bindings: vec![
                ChainBinding {
                    area: "research".into(),
                    kind: "lead".into(),
                    chain: "chat".into(),
                },
                ChainBinding {
                    area: "ops".into(),
                    kind: "deploy".into(),
                    chain: "chat".into(),
                },
            ],
        }
    }

    /// Canonical form: sorted entities, as JSON — the comparison `config push`'s diff makes.
    fn canonical(cfg: &RegistryConfig) -> serde_json::Value {
        let mut c = cfg.clone();
        c.agents.sort_by(|a, b| a.name.cmp(&b.name));
        c.skills.sort_by(|a, b| a.name.cmp(&b.name));
        c.tools.sort_by(|a, b| a.name.cmp(&b.name));
        c.chain_bindings
            .sort_by(|a, b| (&a.area, &a.kind).cmp(&(&b.area, &b.kind)));
        json(&c)
    }

    async fn load_back(dir: &Path) -> RegistryConfig {
        gateway_store::FilesystemConfigSource::new(dir)
            .load()
            .await
            .expect("the pulled directory loads with push's own reader")
    }

    #[tokio::test]
    async fn a_pulled_directory_loads_back_as_the_same_registry() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("pulled");
        let cfg = registry();
        let report = pull(&cfg, &dir, false).expect("pulls into a fresh dir");
        assert_eq!(
            report,
            PullReport {
                agents: 2,
                skills: 1,
                tools: 2,
                chain_bindings: 2,
                removed: 0,
            }
        );
        for f in [
            "agents/researcher.md",
            "agents/deployer.md",
            "skills/concise.md",
            "tools/deploy.json",
            "tools/shell.json",
            "chains.json",
            "grants.json",
        ] {
            assert!(dir.join(f).is_file(), "{f} was not written");
        }
        assert_eq!(canonical(&load_back(&dir).await), canonical(&cfg));
        // …and the result assembles, exactly as push validates it.
        orchestrator_core::Registry::from_config(load_back(&dir).await).expect("valid");
    }

    #[tokio::test]
    async fn an_empty_registry_pulls_to_a_directory_that_loads_back_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("empty");
        pull(&RegistryConfig::default(), &dir, false).expect("pulls");
        for sub in ["agents", "skills", "tools"] {
            assert!(dir.join(sub).is_dir(), "{sub}/ is part of the layout");
        }
        assert_eq!(
            canonical(&load_back(&dir).await),
            canonical(&RegistryConfig::default())
        );
    }

    #[tokio::test]
    async fn a_non_empty_directory_is_refused_without_force_and_nothing_is_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        std::fs::write(dir.join("notes.txt"), "mine").unwrap();
        let err = pull(&registry(), dir, false).expect_err("must refuse");
        assert_eq!(err, PullError::NotEmpty(dir.to_path_buf()));
        assert!(!dir.join("agents").exists(), "a refusal writes nothing");
        assert_eq!(
            std::fs::read_to_string(dir.join("notes.txt")).unwrap(),
            "mine"
        );
    }

    /// `--force` replaces exactly what push reads: a stale agent from an earlier pull would
    /// otherwise be pushed back as an addition. Anything else in the directory is left alone.
    #[tokio::test]
    async fn force_replaces_the_registry_layout_and_leaves_other_files_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let mut first = registry();
        first.agents.push(agent("stale"));
        first.skills.push(skill("stale"));
        pull(&first, dir, false).unwrap();
        std::fs::write(dir.join("README.md"), "kept").unwrap();
        std::fs::write(dir.join("agents/notes.txt"), "kept too").unwrap();

        let report = pull(&registry(), dir, true).expect("force pulls over it");
        assert_eq!(
            report.removed, 9,
            "3 agents + 2 skills + 2 tools + chains.json + grants.json: {report:?}"
        );
        assert!(!dir.join("agents/stale.md").exists());
        assert!(!dir.join("skills/stale.md").exists());
        assert_eq!(canonical(&load_back(dir).await), canonical(&registry()));
        assert_eq!(
            std::fs::read_to_string(dir.join("README.md")).unwrap(),
            "kept"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("agents/notes.txt")).unwrap(),
            "kept too"
        );
    }

    /// An entity name is free text. It must never steer a write outside the directory, and
    /// two names that differ only in case (one file on a case-insensitive filesystem) must
    /// both survive.
    #[tokio::test]
    async fn entity_names_never_escape_the_directory_or_collide() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("pulled");
        let mut cfg = RegistryConfig::default();
        let mut evil = skill("../../escaped");
        evil.body = "x\n".into();
        cfg.skills = vec![evil, skill("Ops"), skill("ops"), skill(".hidden")];
        pull(&cfg, &dir, false).expect("pulls");
        assert!(!tmp.path().join("escaped.md").exists());
        assert!(!dir.join("escaped.md").exists());
        let files = std::fs::read_dir(dir.join("skills")).unwrap().count();
        assert_eq!(files, 4, "one file per skill");
        assert!(
            std::fs::read_dir(dir.join("skills")).unwrap().all(|e| !e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with('.')),
            "a dot-file would be skipped by nothing but hidden from the operator"
        );
        assert_eq!(canonical(&load_back(&dir).await), canonical(&cfg));
    }

    #[tokio::test]
    async fn a_refused_value_writes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("pulled");
        let mut cfg = registry();
        cfg.agents[0].kind = "two\nlines".into();
        let err = pull(&cfg, &dir, false).expect_err("refuses");
        assert!(matches!(err, PullError::Unrepresentable(_)), "{err:?}");
        assert!(!dir.exists(), "validated in full before the first write");
    }

    /// A source whose three reads disagree: only `load_versioned` is the snapshot.
    struct Torn;

    #[async_trait::async_trait]
    impl ConfigSource for Torn {
        async fn load(&self) -> Result<RegistryConfig, OrchestratorError> {
            Ok(RegistryConfig {
                skills: vec![skill("from-load")],
                ..RegistryConfig::default()
            })
        }
        async fn version(&self) -> Result<Option<u64>, OrchestratorError> {
            Ok(Some(99))
        }
        async fn load_versioned(&self) -> Result<(RegistryConfig, Option<u64>), OrchestratorError> {
            Ok((
                RegistryConfig {
                    skills: vec![skill("zeta"), skill("alpha")],
                    ..RegistryConfig::default()
                },
                Some(3),
            ))
        }
    }

    #[tokio::test]
    async fn the_snapshot_is_one_load_versioned_in_canonical_order() {
        let s = snapshot(&Torn).await.expect("reads");
        assert_eq!(s.generation, 3);
        let names: Vec<_> = s.registry.skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["alpha", "zeta"]);
        let v = json(&s);
        assert_eq!(v["generation"], 3);
        assert_eq!(v["registry"]["skills"][0]["name"], "alpha");
    }
}
