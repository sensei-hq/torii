use std::sync::Arc;

use gateway::types::capability::Capability;
use gateway::types::request::{InferenceRequest, Message, MessageRole, Payload};
use gateway::Gateway;

// ── Serde contract types (match the frontend's InferResult / ModelInfo) ──────

#[derive(serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(serde::Deserialize)]
pub struct InferArgs {
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
    pub system: Option<String>,
    pub max_tokens: Option<u32>,
}

#[derive(serde::Serialize)]
pub struct InferResult {
    pub content: String,
    pub model: Option<String>,
    pub plane: String,    // always "local" for the embedded engine
    pub cost_usd: f64,    // 0.0 for local inference
    pub duration_ms: u64,
}

#[derive(serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub local: bool,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Run a text-chat inference request through the embedded in-process engine.
///
/// The frontend invokes this as `invoke('infer', { args: { messages, ... } })`.
/// The single `args` param maps directly to the JS key by Tauri's convention.
#[tauri::command]
pub async fn infer(
    state: tauri::State<'_, Arc<Gateway>>,
    args: InferArgs,
) -> Result<InferResult, String> {
    let messages: Vec<Message> = args
        .messages
        .iter()
        .map(|m| {
            let role = match m.role.as_str() {
                "system" => MessageRole::System,
                "assistant" => MessageRole::Assistant,
                "tool" => MessageRole::Tool,
                _ => MessageRole::User,
            };
            Message::text(role, m.content.clone())
        })
        .collect();

    let req = InferenceRequest {
        capability: Capability::TextChat,
        model: args.model.or_else(|| Some("gemma2:2b".into())),
        router: None,
        chain: Some("local-chat".into()),
        payload: Payload::Chat {
            messages,
            system: args.system,
            max_tokens: args.max_tokens.or(Some(1024)),
            temperature: None,
            tools: Vec::new(),
        },
        budget: None,
        // MIG-3 (v0.4.6): AUTH/panel/consensus addressing — unused on the local plane.
        auth: None,
        panel: None,
        consensus: None,
    };

    let start = std::time::Instant::now();
    let response = state.execute(&req).await.map_err(|e| e.to_string())?;
    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(InferResult {
        content: response.content.unwrap_or_default(),
        model: response.model,
        plane: "local".into(),
        cost_usd: 0.0,
        duration_ms,
    })
}

/// List all models configured in the embedded gateway.
#[tauri::command]
pub async fn list_models(
    state: tauri::State<'_, Arc<Gateway>>,
) -> Result<Vec<ModelInfo>, String> {
    let models = state.list_models().await.map_err(|e| e.to_string())?;
    let result = models
        .into_iter()
        .filter_map(|v| {
            let id = v["id"].as_str().map(|s| s.to_string())?;
            Some(ModelInfo {
                name: id.clone(),
                id,
                local: true,
            })
        })
        .collect();
    Ok(result)
}

/// Return the gateway's configuration and adapter status.
#[tauri::command]
pub async fn gateway_status(
    state: tauri::State<'_, Arc<Gateway>>,
) -> Result<serde_json::Value, String> {
    let configured = state.is_configured().await;
    let adapters = state.list_adapters().await;
    Ok(serde_json::json!({
        "configured": configured,
        "adapters": adapters,
    }))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use gateway::types::capability::Capability;
    use gateway::types::request::{InferenceRequest, Message, MessageRole, Payload};

    #[tokio::test]
    #[ignore] // loads gemma2:2b — slow; run explicitly: cargo test -p app -- --ignored infer_smoke
    async fn infer_smoke() {
        let gw = crate::gateway::build_gateway().await;

        let req = InferenceRequest {
            capability: Capability::TextChat,
            model: Some("gemma2:2b".into()),
            router: None,
            chain: Some("local-chat".into()),
            payload: Payload::Chat {
                messages: vec![Message::text(
                    MessageRole::User,
                    "Reply with the single word: hello",
                )],
                system: None,
                max_tokens: Some(64),
                temperature: None,
                tools: Vec::new(),
            },
            budget: None,
            // MIG-3 (v0.4.6): AUTH/panel/consensus addressing — unused on the local plane.
            auth: None,
            panel: None,
            consensus: None,
        };

        let res = gw.execute(&req).await.expect("infer ok");
        assert!(
            res.content.as_deref().map(|s| !s.is_empty()).unwrap_or(false),
            "expected non-empty content from local inference, got: {:?}",
            res.content
        );
    }
}
