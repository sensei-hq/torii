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

use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};

use orchestrator_core::{
    Activation, AgentBacking, AgentDefinition, ConfigSource, OrchestratorError, Permissions,
    RegistryConfig, SkillDef, ToolSpec,
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

/// Read the live registry and its generation in ONE `load_versioned` call — never a `load`
/// beside a `version`, which a concurrent push can land between.
pub async fn snapshot(src: &dyn ConfigSource) -> Result<RegistrySnapshot, OrchestratorError> {
    let (mut registry, generation) = src.load_versioned().await?;
    canonicalize(&mut registry);
    Ok(RegistrySnapshot {
        generation: generation.unwrap_or(0),
        registry,
    })
}

fn canonicalize(cfg: &mut RegistryConfig) {
    cfg.agents.sort_by(|a, b| a.name.cmp(&b.name));
    cfg.skills.sort_by(|a, b| a.name.cmp(&b.name));
    cfg.tools.sort_by(|a, b| a.name.cmp(&b.name));
    cfg.chain_bindings
        .sort_by(|a, b| (&a.area, &a.kind).cmp(&(&b.area, &b.kind)));
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
    /// Registry-layout files a `force` pull removed before writing.
    pub removed: usize,
}

/// Why a pull refused or failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullError {
    /// A value the directory format cannot carry: the next push would change it. Nothing
    /// was written.
    Unrepresentable(String),
    /// The target directory has entries and `force` was not given. Nothing was written.
    NotEmpty(PathBuf),
    /// A filesystem failure (the message names the path).
    Io(String),
}

impl std::fmt::Display for PullError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PullError::Unrepresentable(m) | PullError::Io(m) => f.write_str(m),
            PullError::NotEmpty(p) => write!(
                f,
                "{} is not empty; refusing to overwrite it. Forcing replaces only the files \
                 a push reads (agents/*.md, skills/*.md, tools/*.json, chains.json, \
                 grants.json) and leaves everything else",
                p.display()
            ),
        }
    }
}

impl std::error::Error for PullError {}

fn io(what: impl std::fmt::Display, e: std::io::Error) -> PullError {
    PullError::Io(format!("{what}: {e}"))
}

/// A frontmatter block in the controlled subset `from_frontmatter` parses: one `key: value`
/// or `key: [a, b]` per line.
#[derive(Default)]
struct Frontmatter(String);

impl Frontmatter {
    fn scalar(&mut self, key: &str, value: &str) {
        if value.is_empty() {
            self.0.push_str(&format!("{key}:\n"));
        } else {
            self.0.push_str(&format!("{key}: {value}\n"));
        }
    }

    fn list<S: AsRef<str>>(&mut self, key: &str, items: impl IntoIterator<Item = S>) {
        let items: Vec<String> = items.into_iter().map(|s| s.as_ref().to_string()).collect();
        self.0.push_str(&format!("{key}: [{}]\n", items.join(", ")));
    }

    /// `key: [k=v, …]`, sorted by key so a pull is deterministic.
    fn pairs<V: std::fmt::Display>(
        &mut self,
        key: &str,
        map: impl IntoIterator<Item = (String, V)>,
    ) {
        let sorted: BTreeMap<String, V> = map.into_iter().collect();
        self.list(key, sorted.into_iter().map(|(k, v)| format!("{k}={v}")));
    }

    fn finish(self, body: &str) -> String {
        format!("---\n{}---\n{body}", self.0)
    }
}

/// A line break inside a frontmatter value would end its line: refuse it by field name
/// (the parse-back check would only see a malformed line, not which field made it).
fn single_line<'a>(
    what: &str,
    field: &str,
    values: impl IntoIterator<Item = &'a str>,
) -> Result<(), PullError> {
    for v in values {
        if v.contains(['\n', '\r']) {
            return Err(PullError::Unrepresentable(format!(
                "{what}: its {field} holds a line break, which the frontmatter format cannot \
                 carry; nothing was written"
            )));
        }
    }
    Ok(())
}

/// `<n><unit>` in the largest unit that is exact — the grammar `timeout` and
/// `confirm_timeout` parse. Sub-second and negative durations have no spelling.
fn duration(what: &str, field: &str, d: chrono::Duration) -> Result<String, PullError> {
    if d.subsec_nanos() != 0 || d < chrono::Duration::zero() {
        return Err(PullError::Unrepresentable(format!(
            "{what}: its {field} ({d}) is not a whole, non-negative number of seconds, which \
             the frontmatter format cannot carry; nothing was written"
        )));
    }
    let s = d.num_seconds();
    Ok(match s {
        _ if s != 0 && s % 86_400 == 0 => format!("{}d", s / 86_400),
        _ if s != 0 && s % 3_600 == 0 => format!("{}h", s / 3_600),
        _ if s != 0 && s % 60 == 0 => format!("{}m", s / 60),
        _ => format!("{s}s"),
    })
}

/// The parse-back check: `rendered` must read back as exactly `expected`, or the field that
/// would change is named and the pull refused.
fn same<T: Serialize>(what: &str, expected: &T, back: &T) -> Result<(), PullError> {
    let (want, got) = (to_json(what, expected)?, to_json(what, back)?);
    if want == got {
        return Ok(());
    }
    let field = match (&want, &got) {
        (serde_json::Value::Object(w), serde_json::Value::Object(g)) => w
            .keys()
            .chain(g.keys())
            .find(|k| w.get(*k) != g.get(*k))
            .cloned()
            .unwrap_or_default(),
        _ => String::new(),
    };
    Err(PullError::Unrepresentable(format!(
        "{what}: its {field} would not read back as stored — the frontmatter format cannot \
         carry it (a leading or trailing space, a comma or '=' inside a list item, a value \
         shaped like a [list], an empty value, or a blank line opening the body); nothing \
         was written"
    )))
}

fn to_json<T: Serialize>(what: &str, t: &T) -> Result<serde_json::Value, PullError> {
    serde_json::to_value(t)
        .map_err(|e| PullError::Unrepresentable(format!("{what}: does not serialize: {e}")))
}

fn unparsable(what: &str, e: OrchestratorError) -> PullError {
    PullError::Unrepresentable(format!(
        "{what}: the frontmatter it would be written as does not parse back ({e}); nothing \
         was written"
    ))
}

/// An agent as the `agents/*.md` file `push` reads. Its `grants` are NOT part of it — they
/// live in the root's `grants.json`.
pub fn render_agent(a: &AgentDefinition) -> Result<String, PullError> {
    // Exhaustive on purpose: a field the gateway adds is a compile error HERE, never a key a
    // pull silently drops and the next push of the pulled directory silently erases.
    let AgentDefinition {
        name,
        area,
        kind,
        chain,
        chains,
        grants: _,
        tools,
        skills,
        system_prompt,
        backed_by,
        default_planner,
        tool_limits,
        confirm_tools,
        confirm_timeout,
        escalate_to,
    } = a;
    let what = format!("agent {name:?}");
    single_line(&what, "name", [name.as_str()])?;
    single_line(&what, "area", [area.as_str()])?;
    single_line(&what, "kind", [kind.as_str()])?;
    single_line(&what, "chain", chain.as_deref())?;
    single_line(
        &what,
        "chains",
        chains.iter().flat_map(|(k, v)| [k.as_str(), v.as_str()]),
    )?;
    single_line(&what, "tools", tools.iter().map(String::as_str))?;
    single_line(&what, "skills", skills.iter().map(String::as_str))?;
    single_line(&what, "tool_limits", tool_limits.keys().map(String::as_str))?;
    single_line(
        &what,
        "confirm_tools",
        confirm_tools.iter().map(String::as_str),
    )?;
    single_line(&what, "escalate_to", escalate_to.as_deref())?;

    let mut fm = Frontmatter::default();
    fm.scalar("name", name);
    fm.scalar("area", area);
    fm.scalar("kind", kind);
    if let Some(c) = chain {
        fm.scalar("chain", c);
    }
    if !chains.is_empty() {
        fm.pairs("chains", chains.clone());
    }
    fm.list("tools", tools);
    fm.list("skills", skills);
    match backed_by {
        AgentBacking::Model => {}
        AgentBacking::Human { timeout } => {
            fm.scalar("backed_by", "human");
            if let Some(t) = timeout {
                fm.scalar("timeout", &duration(&what, "backed_by timeout", *t)?);
            }
        }
    }
    if *default_planner {
        fm.scalar("default_planner", "true");
    }
    if !tool_limits.is_empty() {
        fm.pairs("tool_limits", tool_limits.clone());
    }
    if !confirm_tools.is_empty() {
        fm.list("confirm_tools", confirm_tools);
    }
    if let Some(t) = confirm_timeout {
        fm.scalar("confirm_timeout", &duration(&what, "confirm_timeout", *t)?);
    }
    if let Some(e) = escalate_to {
        fm.scalar("escalate_to", e);
    }
    let md = fm.finish(system_prompt);

    let back = AgentDefinition::from_frontmatter(&md).map_err(|e| unparsable(&what, e))?;
    let mut expected = a.clone();
    expected.grants.clear();
    same(&what, &expected, &back)?;
    Ok(md)
}

/// A skill as the `skills/*.md` file `push` reads.
pub fn render_skill(s: &SkillDef) -> Result<String, PullError> {
    // Exhaustive for the same reason as `render_agent`.
    let SkillDef {
        name,
        description,
        body,
        activation,
    } = s;
    let what = format!("skill {name:?}");
    single_line(&what, "name", [name.as_str()])?;
    single_line(&what, "description", description.as_deref())?;
    let mut fm = Frontmatter::default();
    fm.scalar("name", name);
    if let Some(d) = description {
        fm.scalar("description", d);
    }
    match activation {
        Activation::Always => {}
        Activation::OnKeywords(kw) => {
            single_line(&what, "activation", kw.iter().map(String::as_str))?;
            fm.list("activate_on", kw);
        }
    }
    let md = fm.finish(body);

    let back = SkillDef::from_frontmatter(&md).map_err(|e| unparsable(&what, e))?;
    same(&what, s, &back)?;
    Ok(md)
}

/// A tool as the `tools/*.json` file `push` reads.
fn render_tool(t: &ToolSpec) -> Result<String, PullError> {
    let what = format!("tool {:?}", t.name);
    let json = pretty(&what, t)?;
    let back: ToolSpec = serde_json::from_str(&json)
        .map_err(|e| PullError::Unrepresentable(format!("{what}: does not parse back: {e}")))?;
    same(&what, t, &back)?;
    Ok(json)
}

fn pretty<T: Serialize + ?Sized>(what: &str, t: &T) -> Result<String, PullError> {
    serde_json::to_string_pretty(t)
        .map(|s| s + "\n")
        .map_err(|e| PullError::Unrepresentable(format!("{what}: does not serialize: {e}")))
}

/// Filenames for entity names. The loader never reads a filename back (only its extension),
/// so the name is free to be made safe: an entity name is free text and must never steer a
/// write outside the directory, hide as a dot-file, or — on a case-insensitive filesystem —
/// land on the same file as another entity's.
#[derive(Default)]
struct FileNames(HashSet<String>);

impl FileNames {
    fn for_name(&mut self, name: &str) -> String {
        let mut stem: String = name
            .chars()
            .take(100)
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        if stem.is_empty() || stem.starts_with('.') {
            stem.insert(0, '_');
        }
        let mut candidate = stem.clone();
        let mut n = 2;
        while !self.0.insert(candidate.to_ascii_lowercase()) {
            candidate = format!("{stem}-{n}");
            n += 1;
        }
        candidate
    }
}

/// Every file of the registry directory for `cfg`, validated, in a stable order: agents,
/// skills and tools by name, then `chains.json` and `grants.json` (always both, so the layout
/// is the same for every registry).
pub fn render(cfg: &RegistryConfig) -> Result<Vec<RegistryFile>, PullError> {
    let mut cfg = cfg.clone();
    canonicalize(&mut cfg);
    let mut files = Vec::new();

    let mut names = FileNames::default();
    for a in &cfg.agents {
        files.push(RegistryFile {
            path: Path::new("agents").join(format!("{}.md", names.for_name(&a.name))),
            contents: render_agent(a)?,
        });
    }
    let mut names = FileNames::default();
    for s in &cfg.skills {
        files.push(RegistryFile {
            path: Path::new("skills").join(format!("{}.md", names.for_name(&s.name))),
            contents: render_skill(s)?,
        });
    }
    let mut names = FileNames::default();
    for t in &cfg.tools {
        files.push(RegistryFile {
            path: Path::new("tools").join(format!("{}.json", names.for_name(&t.name))),
            contents: render_tool(t)?,
        });
    }
    files.push(RegistryFile {
        path: PathBuf::from("chains.json"),
        contents: pretty("chain bindings", &cfg.chain_bindings)?,
    });
    let grants: BTreeMap<&str, BTreeMap<&str, &Permissions>> = cfg
        .agents
        .iter()
        .filter(|a| !a.grants.is_empty())
        .map(|a| {
            (
                a.name.as_str(),
                a.grants.iter().map(|(t, p)| (t.as_str(), p)).collect(),
            )
        })
        .collect();
    files.push(RegistryFile {
        path: PathBuf::from("grants.json"),
        contents: pretty("grants", &grants)?,
    });
    Ok(files)
}

/// The files a push reads: `(subdirectory, extension)`, plus the two root files.
const LAYOUT_DIRS: [(&str, &str); 3] = [("agents", "md"), ("skills", "md"), ("tools", "json")];
const LAYOUT_ROOT_FILES: [&str; 2] = ["chains.json", "grants.json"];

/// Write `cfg` into `dir` as the layout `config push` reads.
///
/// Every file is rendered and checked first, so a refusal writes nothing. Refuses a non-empty
/// `dir` unless `force`; with `force` it first removes every file `push` would read
/// (`agents/*.md`, `skills/*.md`, `tools/*.json`, `chains.json`, `grants.json`) and leaves
/// anything else alone, so the result pushes back as exactly `cfg` — a stale agent left from
/// an earlier pull would otherwise come back as an addition.
pub fn pull(cfg: &RegistryConfig, dir: &Path, force: bool) -> Result<PullReport, PullError> {
    let files = render(cfg)?;
    let removed = prepare(dir, force)?;
    for (sub, _) in LAYOUT_DIRS {
        let d = dir.join(sub);
        std::fs::create_dir_all(&d).map_err(|e| io(format!("create {}", d.display()), e))?;
    }
    for f in &files {
        let path = dir.join(&f.path);
        // `create_new`: after `prepare` no layout file exists, so a file already here is one
        // this pull did not expect (e.g. `Foo.md` beside a `foo.md` on a case-insensitive
        // filesystem) — loud, never overwritten.
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .and_then(|mut file| file.write_all(f.contents.as_bytes()))
            .map_err(|e| io(format!("write {}", path.display()), e))?;
    }
    Ok(PullReport {
        agents: cfg.agents.len(),
        skills: cfg.skills.len(),
        tools: cfg.tools.len(),
        chain_bindings: cfg.chain_bindings.len(),
        removed,
    })
}

/// Make `dir` ready to receive a pull; returns how many layout files `force` removed.
fn prepare(dir: &Path, force: bool) -> Result<usize, PullError> {
    match std::fs::metadata(dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(dir).map_err(|e| io(format!("create {}", dir.display()), e))?;
            return Ok(0);
        }
        Err(e) => return Err(io(format!("read {}", dir.display()), e)),
        Ok(m) if !m.is_dir() => {
            return Err(PullError::Io(format!(
                "{} exists and is not a directory",
                dir.display()
            )));
        }
        Ok(_) => {}
    }
    let mut entries =
        std::fs::read_dir(dir).map_err(|e| io(format!("read {}", dir.display()), e))?;
    if entries.next().is_none() {
        return Ok(0);
    }
    if !force {
        return Err(PullError::NotEmpty(dir.to_path_buf()));
    }
    let mut removed = 0;
    for (sub, ext) in LAYOUT_DIRS {
        let d = dir.join(sub);
        match std::fs::symlink_metadata(&d) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(io(format!("read {}", d.display()), e)),
            // Clearing through a symlink would delete files outside the directory.
            Ok(m) if m.file_type().is_symlink() => {
                return Err(PullError::Io(format!(
                    "refusing to clear {}: it is a symlink",
                    d.display()
                )));
            }
            Ok(m) if !m.is_dir() => {
                return Err(PullError::Io(format!("{} is not a directory", d.display())));
            }
            Ok(_) => {}
        }
        let read = std::fs::read_dir(&d).map_err(|e| io(format!("read {}", d.display()), e))?;
        for entry in read {
            let p = entry
                .map_err(|e| io(format!("read {}", d.display()), e))?
                .path();
            if p.extension().and_then(|x| x.to_str()) == Some(ext) {
                std::fs::remove_file(&p).map_err(|e| io(format!("remove {}", p.display()), e))?;
                removed += 1;
            }
        }
    }
    for name in LAYOUT_ROOT_FILES {
        let p = dir.join(name);
        match std::fs::remove_file(&p) {
            Ok(()) => removed += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io(format!("remove {}", p.display()), e)),
        }
    }
    Ok(removed)
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
