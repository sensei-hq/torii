//! Money caps need priced models (AG-12 follow-up, torii#55).
//!
//! Under a money cap the engine refuses a model call on any chain whose worst-case price it
//! cannot compute (`Gateway::worst_case_pricing` → `None`): the gateway reports no cost for a
//! model without `pricing`, so the cap would be blind to it. That refusal lands MID-RUN, as a
//! failed node, after the run was submitted and possibly after it spent money elsewhere.
//! [`unpriced_chains`] finds the same condition before anything is submitted, over the chains
//! a graph can reach, so `run submit --budget-usd` (and the API's submit, through this one
//! implementation) can refuse up front and name the chain, the model and who uses it.
//!
//! **Which chains a graph can use**, conservatively:
//! - every `ModelCall` chain, at any depth (`Map`/`Consolidate`/`Loop` bodies, `Subgraph`,
//!   every `Branch` arm and its default);
//! - every MODEL-backed agent a node, a `Map`/`Consolidate`/`Loop` body or a `Loop`'s agent gate
//!   names, through the chain the engine resolves for it (`Registry::resolve_chain`, with the
//!   node's phase). Human-backed agents — and their escalation targets, which must be human —
//!   call no model;
//! - for a graph with an `Expand` anywhere, every chain every model-backed agent in the registry
//!   can route through (base route and every per-phase override): a plan may run any of them.
//!
//! What this cannot see: a planned graph's raw `ModelCall` naming a chain no agent uses. The
//! engine still fails that closed at call time; this check only moves the common case earlier.

use std::collections::{BTreeMap, BTreeSet};

use gateway::types::config::GatewayConfig;
use orchestrator_core::{
    AgentBacking, AgentDefinition, Graph, LoopBody, MapBody, NodeKind, PlannerRef, Registry,
};

/// Why a chain cannot be priced, mirroring `Gateway::worst_case_pricing`'s `None` cases.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unpriced {
    /// The gateway config does not define the chain.
    UnknownChain,
    /// None of the chain's entries names a model the gateway config defines.
    NoModels,
    /// These models (by config id, sorted) declare no `pricing`.
    Models(Vec<String>),
}

/// One chain the graph can use that a money cap cannot price, and who reaches it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpricedChain {
    pub chain: String,
    /// Sorted, deduplicated: `node "x"`, `agent "y"`, `an Expand node's plan (agent "z")`.
    pub used_by: Vec<String>,
    pub why: Unpriced,
}

/// Every chain `graph` can use (see the module doc) whose worst-case price `gw` cannot give,
/// sorted by chain id. Empty means a money cap can meter every call the graph can make.
pub fn unpriced_chains(
    graph: &Graph,
    registry: &Registry,
    gw: &GatewayConfig,
) -> Vec<UnpricedChain> {
    let mut uses: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut expands = false;
    walk(graph, registry, &mut uses, &mut expands);
    if expands {
        for agent in registry.agents().filter(|a| model_backed(a)) {
            let who = format!("an Expand node's plan (agent {:?})", agent.name);
            for chain in all_routes(registry, agent) {
                uses.entry(chain).or_default().insert(who.clone());
            }
        }
    }
    uses.into_iter()
        .filter_map(|(chain, who)| {
            why_unpriced(&chain, gw).map(|why| UnpricedChain {
                chain,
                used_by: who.into_iter().collect(),
                why,
            })
        })
        .collect()
}

/// `None` when the chain prices — exactly when `Gateway::worst_case_pricing` returns `Some`:
/// entries naming a model the config lacks are skipped there, and so here.
fn why_unpriced(chain: &str, gw: &GatewayConfig) -> Option<Unpriced> {
    let Some(c) = gw.chains.get(chain) else {
        return Some(Unpriced::UnknownChain);
    };
    let known: Vec<_> = c
        .models
        .iter()
        .filter_map(|e| gw.models.get(&e.model).map(|m| (&e.model, m)))
        .collect();
    if known.is_empty() {
        return Some(Unpriced::NoModels);
    }
    let unpriced: BTreeSet<String> = known
        .into_iter()
        .filter(|(_, m)| m.pricing.is_none())
        .map(|(id, _)| id.clone())
        .collect();
    (!unpriced.is_empty()).then(|| Unpriced::Models(unpriced.into_iter().collect()))
}

fn model_backed(agent: &AgentDefinition) -> bool {
    matches!(agent.backed_by, AgentBacking::Model)
}

/// Every chain a model-backed agent can route through: its base route and each per-phase
/// override. An agent with no base route has none (the registry refuses that at load).
fn all_routes(registry: &Registry, agent: &AgentDefinition) -> BTreeSet<String> {
    let mut out: BTreeSet<String> = agent.chains.values().cloned().collect();
    if let Ok(base) = registry.resolve_chain(agent, None) {
        out.insert(base.to_string());
    }
    out
}

fn walk(
    graph: &Graph,
    registry: &Registry,
    uses: &mut BTreeMap<String, BTreeSet<String>>,
    expands: &mut bool,
) {
    for node in &graph.nodes {
        let here = format!("node {:?}", node.id.0);
        let mut chain = |c: &str, who: String| {
            uses.entry(c.to_string()).or_default().insert(who);
        };
        // A model-backed agent's chain for `phase`, as the engine resolves it. An unknown agent
        // or one with no route is not a pricing problem: the run refuses it for that reason.
        let agent_chain = |name: &str, phase: Option<&str>| {
            registry
                .agent(name)
                .filter(|a| model_backed(a))
                .and_then(|a| registry.resolve_chain(a, phase).ok())
                .map(|c| (c.to_string(), format!("agent {name:?}")))
        };
        match &node.kind {
            NodeKind::ModelCall { chain: c, .. } => chain(c, here),
            NodeKind::Agent { agent, phase, .. } => {
                if let Some((c, who)) = agent_chain(&agent.0, phase.as_deref()) {
                    chain(&c, who);
                }
            }
            NodeKind::Map { body, .. } | NodeKind::Consolidate { body, .. } => match body {
                MapBody::ModelCall { chain: c } => chain(c, here),
                MapBody::Agent(a) => {
                    if let Some((c, who)) = agent_chain(&a.0, None) {
                        chain(&c, who);
                    }
                }
            },
            NodeKind::Loop { body, gate, .. } => {
                match body {
                    LoopBody::ModelCall { chain: c } => chain(c, here),
                    LoopBody::Agent(a) => {
                        if let Some((c, who)) = agent_chain(&a.0, None) {
                            chain(&c, who);
                        }
                    }
                    LoopBody::Subgraph(g) => walk(g, registry, uses, expands),
                    LoopBody::Expand { planner } => {
                        *expands = true;
                        planner_chain(planner, registry, uses);
                    }
                }
                if let orchestrator_core::GateSpec::Agent { agent, .. } = gate {
                    if let Some((c, who)) = agent_chain(&agent.0, None) {
                        uses.entry(c).or_default().insert(who);
                    }
                }
            }
            NodeKind::Subgraph { graph } => walk(graph, registry, uses, expands),
            NodeKind::Branch { arms, default, .. } => {
                for (_, arm) in arms {
                    walk(arm, registry, uses, expands);
                }
                walk(default, registry, uses, expands);
            }
            NodeKind::Expand { planner, .. } => {
                *expands = true;
                planner_chain(planner, registry, uses);
            }
            NodeKind::AwaitSignal { .. } | NodeKind::HumanGate { .. } => {}
        }
    }
}

/// A named planner agent runs before its plan does, on every route it has.
fn planner_chain(
    planner: &PlannerRef,
    registry: &Registry,
    uses: &mut BTreeMap<String, BTreeSet<String>>,
) {
    if let PlannerRef::Agent(a) = planner {
        if let Some(agent) = registry.agent(&a.0).filter(|a| model_backed(a)) {
            for c in all_routes(registry, agent) {
                uses.entry(c)
                    .or_default()
                    .insert(format!("planner agent {:?}", agent.name));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gateway::types::capability::Capability;
    use gateway::types::config::{ChainEntry, FallbackChainConfig, ModelConfig, ModelPricing};
    use orchestrator_core::{AgentRef, Node, NodeId, RegistryConfig};

    fn model(id: &str, pricing: Option<f64>) -> ModelConfig {
        serde_json::from_value(serde_json::json!({
            "id": id, "provider": "ollama", "capabilities": ["text_chat"],
            "context_window": 8192, "max_output_tokens": 1024,
        }))
        .map(|mut m: ModelConfig| {
            m.pricing = pricing.map(|p| ModelPricing {
                input_per_1k: p,
                output_per_1k: p,
                per_request: None,
            });
            m
        })
        .unwrap()
    }

    fn chain(id: &str, models: &[&str]) -> FallbackChainConfig {
        FallbackChainConfig {
            id: id.into(),
            capability: Capability::TextChat,
            models: models
                .iter()
                .map(|m| {
                    serde_json::from_value::<ChainEntry>(
                        serde_json::json!({"model": m, "router": "ollama", "priority": 1}),
                    )
                    .unwrap()
                })
                .collect(),
            fallback_triggers: vec![],
        }
    }

    /// Chains: `priced` (one priced model), `free` (an explicit zero), `local` (one priced, one
    /// unpriced), `ghost` (an entry naming no defined model).
    fn gw() -> GatewayConfig {
        GatewayConfig {
            models: [
                ("paid".to_string(), model("paid", Some(0.01))),
                ("zero".to_string(), model("zero", Some(0.0))),
                ("llama".to_string(), model("llama", None)),
            ]
            .into(),
            chains: [
                ("priced".to_string(), chain("priced", &["paid"])),
                ("free".to_string(), chain("free", &["zero"])),
                ("local".to_string(), chain("local", &["paid", "llama"])),
                ("ghost".to_string(), chain("ghost", &["nowhere"])),
            ]
            .into(),
            ..Default::default()
        }
    }

    fn agent(name: &str, chain: &str, phases: &[(&str, &str)], human: bool) -> serde_json::Value {
        let mut a = serde_json::json!({
            "name": name, "area": "research", "kind": name, "chain": chain,
            "chains": phases.iter().map(|(p, c)| (p.to_string(), serde_json::json!(c)))
                .collect::<serde_json::Map<_, _>>(),
            "tools": [], "skills": [], "system_prompt": "x",
        });
        if human {
            // A human-backed agent may not declare a chain (the registry refuses it).
            a.as_object_mut().unwrap().remove("chain");
            a["backed_by"] = serde_json::json!({"Human": {"timeout": null}});
        }
        a
    }

    fn registry(agents: Vec<serde_json::Value>) -> Registry {
        registry_bound(agents, serde_json::json!([]))
    }

    fn registry_bound(agents: Vec<serde_json::Value>, bindings: serde_json::Value) -> Registry {
        let cfg: RegistryConfig = serde_json::from_value(serde_json::json!({
            "agents": agents, "skills": [], "tools": [], "chain_bindings": bindings,
        }))
        .unwrap();
        Registry::from_config(cfg).unwrap()
    }

    fn node(id: &str, kind: NodeKind) -> Node {
        Node {
            id: NodeId(id.into()),
            kind,
            deps: vec![],
        }
    }

    fn agent_node(id: &str, agent: &str, phase: Option<&str>) -> Node {
        node(
            id,
            NodeKind::Agent {
                agent: AgentRef(agent.into()),
                input: serde_json::json!("go"),
                phase: phase.map(str::to_string),
            },
        )
    }

    fn chains_of(found: &[UnpricedChain]) -> Vec<&str> {
        found.iter().map(|u| u.chain.as_str()).collect()
    }

    #[test]
    fn an_agent_on_a_chain_with_an_unpriced_model_is_reported_naming_the_model_and_the_agent() {
        let reg = registry(vec![agent("researcher", "local", &[], false)]);
        let g = Graph {
            nodes: vec![agent_node("r", "researcher", None)],
        };
        assert_eq!(
            unpriced_chains(&g, &reg, &gw()),
            vec![UnpricedChain {
                chain: "local".into(),
                used_by: vec!["agent \"researcher\"".into()],
                why: Unpriced::Models(vec!["llama".into()]),
            }]
        );
    }

    #[test]
    fn an_explicit_zero_price_prices_and_so_does_a_fully_priced_chain() {
        let reg = registry(vec![
            agent("a", "free", &[], false),
            agent("b", "priced", &[], false),
        ]);
        let g = Graph {
            nodes: vec![agent_node("a", "a", None), agent_node("b", "b", None)],
        };
        assert!(unpriced_chains(&g, &reg, &gw()).is_empty());
    }

    #[test]
    fn model_calls_at_any_depth_are_checked_and_unknown_or_empty_chains_do_not_price() {
        let reg = registry(vec![]);
        let inner = Graph {
            nodes: vec![node(
                "deep",
                NodeKind::ModelCall {
                    chain: "ghost".into(),
                    payload: serde_json::json!({}),
                },
            )],
        };
        let g = Graph {
            nodes: vec![
                node(
                    "sub",
                    NodeKind::Subgraph {
                        graph: Box::new(inner),
                    },
                ),
                node(
                    "fan",
                    NodeKind::Map {
                        body: MapBody::ModelCall {
                            chain: "missing".into(),
                        },
                        over: vec![],
                        concurrency: 1,
                        aggregation: serde_json::from_value(serde_json::json!("FailFast")).unwrap(),
                    },
                ),
            ],
        };
        let found = unpriced_chains(&g, &reg, &gw());
        assert_eq!(chains_of(&found), vec!["ghost", "missing"]);
        assert_eq!(found[0].why, Unpriced::NoModels);
        assert_eq!(found[0].used_by, vec!["node \"deep\"".to_string()]);
        assert_eq!(found[1].why, Unpriced::UnknownChain);
    }

    #[test]
    fn the_nodes_phase_picks_the_chain_and_an_unused_phase_is_not_checked() {
        let reg = registry(vec![agent("r", "priced", &[("draft", "local")], false)]);
        let unphased = Graph {
            nodes: vec![agent_node("n", "r", None)],
        };
        assert!(unpriced_chains(&unphased, &reg, &gw()).is_empty());
        let drafting = Graph {
            nodes: vec![agent_node("n", "r", Some("draft"))],
        };
        assert_eq!(
            chains_of(&unpriced_chains(&drafting, &reg, &gw())),
            vec!["local"]
        );
    }

    #[test]
    fn a_human_backed_agent_calls_no_model() {
        // Its (area, kind) binding resolves to the unpriced chain — and is never called.
        let reg = registry_bound(
            vec![agent("person", "", &[], true)],
            serde_json::json!([{"area": "research", "kind": "person", "chain": "local"}]),
        );
        let g = Graph {
            nodes: vec![agent_node("ask", "person", None)],
        };
        assert!(unpriced_chains(&g, &reg, &gw()).is_empty());
    }

    #[test]
    fn a_loops_agent_gate_and_a_named_planners_routes_are_checked() {
        let reg = registry(vec![
            agent("judge", "local", &[], false),
            agent("planner", "priced", &[("plan", "ghost")], false),
        ]);
        let g = Graph {
            nodes: vec![node(
                "refine",
                NodeKind::Loop {
                    body: LoopBody::Expand {
                        planner: PlannerRef::Agent(AgentRef("planner".into())),
                    },
                    input: serde_json::json!("draft"),
                    gate: orchestrator_core::GateSpec::Agent {
                        agent: AgentRef("judge".into()),
                        stop_when: orchestrator_core::LoopGate::TextContains("done".into()),
                    },
                    max_iters: 3,
                },
            )],
        };
        let found = unpriced_chains(&g, &reg, &gw());
        assert_eq!(chains_of(&found), vec!["ghost", "local"], "{found:?}");
        assert!(
            found[0]
                .used_by
                .contains(&"planner agent \"planner\"".to_string()),
            "{found:?}"
        );
        assert!(
            found[1].used_by.contains(&"agent \"judge\"".to_string()),
            "{found:?}"
        );
    }

    #[test]
    fn an_expand_can_run_any_model_backed_agent_on_any_of_its_routes() {
        // `person` is human-backed: its binding to the unpriced `ghost` is never called.
        let reg = registry_bound(
            vec![
                agent("writer", "priced", &[("draft", "local")], false),
                agent("person", "", &[], true),
            ],
            serde_json::json!([{"area": "research", "kind": "person", "chain": "ghost"}]),
        );
        let g = Graph {
            nodes: vec![node(
                "plan",
                NodeKind::Expand {
                    input: serde_json::json!("goal"),
                    planner: PlannerRef::Select,
                },
            )],
        };
        let found = unpriced_chains(&g, &reg, &gw());
        assert_eq!(chains_of(&found), vec!["local"], "{found:?}");
        assert_eq!(
            found[0].used_by,
            vec!["an Expand node's plan (agent \"writer\")".to_string()]
        );
    }
}
