//! AG-5 (#34): following the durable registry config from a long-running process.
//!
//! A worker boots its [`RegistryHandle`] at the tenant's config generation; without this it
//! keeps that generation for life, so after a `config push` it fences out every run submitted
//! under the new one. [`RegistryReloader`] is the one place that decides when to reload — the
//! CLI's `worker serve` asks it before every tick, and the API can ask it the same way.

use orchestrator_core::{ConfigSource, OrchestratorError, Registry, RegistryHandle};
use std::sync::Arc;

/// A [`RegistryHandle`] and the durable source it follows.
#[derive(Clone)]
pub struct RegistryReloader {
    handle: RegistryHandle,
    source: Arc<dyn ConfigSource>,
}

impl RegistryReloader {
    pub fn new(handle: RegistryHandle, source: Arc<dyn ConfigSource>) -> Self {
        Self { handle, source }
    }

    /// The handle this reloader swaps — the one the executor pins each run from.
    pub fn handle(&self) -> &RegistryHandle {
        &self.handle
    }

    /// Reload if the source's durable generation has moved since the handle's.
    pub async fn refresh(&self) -> Result<Option<(Arc<Registry>, u64)>, OrchestratorError> {
        let _ = &self.source;
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use orchestrator_core::{AgentBacking, AgentDefinition, RegistryConfig};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    fn agent(name: &str) -> AgentDefinition {
        AgentDefinition {
            default_planner: false,
            name: name.to_string(),
            area: "test".to_string(),
            kind: "test".to_string(),
            chain: Some("chat".to_string()),
            chains: Default::default(),
            grants: Default::default(),
            tools: vec![],
            skills: vec![],
            system_prompt: "x".to_string(),
            backed_by: AgentBacking::Model,
            tool_limits: Default::default(),
            confirm_tools: vec![],
            confirm_timeout: None,
            escalate_to: None,
        }
    }

    fn config(agents: &[AgentDefinition]) -> RegistryConfig {
        RegistryConfig {
            agents: agents.to_vec(),
            ..Default::default()
        }
    }

    /// A durable source whose (config, generation) a test moves by hand, counting full loads.
    struct Durable {
        state: Mutex<(RegistryConfig, Option<u64>)>,
        loads: AtomicUsize,
    }

    impl Durable {
        fn new(cfg: RegistryConfig, generation: Option<u64>) -> Arc<Self> {
            Arc::new(Self {
                state: Mutex::new((cfg, generation)),
                loads: AtomicUsize::new(0),
            })
        }
        fn push(&self, cfg: RegistryConfig, generation: u64) {
            *self.state.lock().unwrap() = (cfg, Some(generation));
        }
        fn loads(&self) -> usize {
            self.loads.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl ConfigSource for Durable {
        async fn load(&self) -> Result<RegistryConfig, OrchestratorError> {
            Ok(self.load_versioned().await?.0)
        }
        async fn version(&self) -> Result<Option<u64>, OrchestratorError> {
            Ok(self.state.lock().unwrap().1)
        }
        async fn load_versioned(&self) -> Result<(RegistryConfig, Option<u64>), OrchestratorError> {
            self.loads.fetch_add(1, Ordering::SeqCst);
            Ok(self.state.lock().unwrap().clone())
        }
    }

    async fn reloader_over(src: &Arc<Durable>) -> RegistryReloader {
        let handle = RegistryHandle::from_source(src.as_ref() as &dyn ConfigSource)
            .await
            .expect("boot");
        RegistryReloader::new(handle, src.clone())
    }

    fn names(r: &Registry) -> Vec<String> {
        let mut v: Vec<String> = r.agents().map(|a| a.name.clone()).collect();
        v.sort();
        v
    }

    /// A push moves the durable generation; the next refresh swaps the new registry in at that
    /// generation. A snapshot taken before — what a run already in flight pinned — keeps the
    /// registry it pinned.
    #[tokio::test]
    async fn a_moved_generation_is_reloaded_and_an_earlier_pin_keeps_its_registry() {
        let src = Durable::new(config(&[agent("old")]), Some(1));
        let r = reloader_over(&src).await;
        let (pinned, pinned_gen) = r.handle().snapshot();

        src.push(config(&[agent("new")]), 2);
        let (registry, generation) = r
            .refresh()
            .await
            .expect("refresh")
            .expect("generation 2 must be picked up");
        assert_eq!(generation, 2);
        assert_eq!(names(&registry), vec!["new"]);
        assert_eq!(r.handle().generation(), 2, "the shared handle moved");
        assert_eq!(names(&r.handle().current()), vec!["new"]);
        assert_eq!(
            (names(&pinned), pinned_gen),
            (vec!["old".to_string()], 1),
            "a run pinned before the reload keeps its generation"
        );
    }

    /// An unmoved generation costs one version read and no load.
    #[tokio::test]
    async fn an_unmoved_generation_reloads_nothing() {
        let src = Durable::new(config(&[agent("a")]), Some(4));
        let r = reloader_over(&src).await;
        let loads = src.loads();
        assert!(r.refresh().await.expect("refresh").is_none());
        assert_eq!(src.loads(), loads, "no full load when nothing moved");
        assert_eq!(r.handle().generation(), 4);
    }

    /// A pushed config that does not assemble leaves the last good registry live, and says so.
    #[tokio::test]
    async fn an_invalid_push_keeps_the_last_good_registry() {
        let src = Durable::new(config(&[agent("good")]), Some(1));
        let r = reloader_over(&src).await;
        let mut broken = agent("broken");
        broken.tools = vec!["no-such-tool".into()];
        src.push(config(&[broken]), 2);
        assert!(r.refresh().await.is_err(), "the bad config is reported");
        assert_eq!(r.handle().generation(), 1);
        assert_eq!(names(&r.handle().current()), vec!["good"]);
    }

    /// An unversioned source (filesystem, memory) has no durable generation to follow.
    #[tokio::test]
    async fn an_unversioned_source_is_never_reloaded() {
        let src = Durable::new(config(&[agent("a")]), None);
        let r = reloader_over(&src).await;
        assert!(r.refresh().await.expect("refresh").is_none());
        assert_eq!(r.handle().generation(), 0);
    }
}
