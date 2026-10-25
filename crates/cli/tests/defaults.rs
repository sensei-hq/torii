//! AG-9 (torii#46): the shipped default registry against the gateway's executable side — the
//! two checks `torii-core` cannot make alone, because they need the orchestrator crate.

use std::sync::Arc;

use orchestrator::agent::prompt::assemble_prompt;
use orchestrator::agent::tools::{
    ListAgents, ListChains, ListSkills, ListTools, Tool, ValidatePlan,
};
use orchestrator_core::{Registry, ToolSpec};

fn defaults() -> Registry {
    Registry::from_config(torii_core::defaults::config().expect("the defaults parse"))
        .expect("the defaults assemble")
}

/// A shipped `tools/<name>.json` is the schema the MODEL sees; the gateway's executable answers
/// the call. They must be the same tool — a schema that drifted from its executable is a tool
/// the model calls one way and the runtime serves another.
#[test]
fn every_shipped_discovery_tool_spec_is_the_gateways_own() {
    let reg = Arc::new(Registry::default());
    let executables: Vec<ToolSpec> = vec![
        ListAgents(reg.clone()).spec(),
        ListSkills(reg.clone()).spec(),
        ListTools(reg.clone()).spec(),
        ListChains(reg.clone()).spec(),
        ValidatePlan {
            registry: reg,
            max_nodes: 1,
        }
        .spec(),
    ];
    let shipped = defaults();
    for exe in executables {
        let spec = shipped
            .tool(&exe.name)
            .unwrap_or_else(|| panic!("the defaults ship no tools/{}.json", exe.name));
        assert_eq!(
            serde_json::to_value(spec).unwrap(),
            serde_json::to_value(&exe).unwrap(),
            "tools/{}.json differs from the gateway's executable spec",
            exe.name
        );
    }
}

/// Gate item 2, through the gateway's own prompt assembly: a shipped agent's keyword-gated skill
/// is composed into its system prompt for a goal that names it, and left out for one that does
/// not.
#[test]
fn a_shipped_skill_reaches_the_prompt_only_for_a_goal_that_names_it() {
    let reg = defaults();
    let (agent, skill) = reg
        .agents()
        .find_map(|a| {
            a.skills
                .iter()
                .find(|s| s.as_str() == "summarize")
                .map(|s| (a, reg.skill(s).expect("listed skill exists")))
        })
        .expect("a shipped agent lists the `summarize` skill");
    let body = skill.body.trim();
    assert!(!body.is_empty(), "precondition");

    let (on, _) = assemble_prompt(
        &reg,
        agent,
        &[],
        "Summarize the attached incident report for the leadership channel",
    )
    .expect("assembles");
    assert!(on.contains(body), "matching goal: skill absent\n{on}");

    let (off, _) = assemble_prompt(
        &reg,
        agent,
        &[],
        "Draft a welcome email for new hires starting on Monday",
    )
    .expect("assembles");
    assert!(!off.contains(body), "unrelated goal: skill present\n{off}");
}
