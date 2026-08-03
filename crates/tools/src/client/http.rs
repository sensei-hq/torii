//! SSRF-pinned HTTP (streamable) MCP transport.
//!
//! Torii owns the socket: [`EgressFilter::check`] vets + pins the target IP, then the reqwest
//! client is configured with `.resolve(host → pinnedIp)` so it connects **only** to that vetted
//! IP (never a re-resolution — the DNS-rebind defence) and follows **no redirects** (no
//! redirect-based SSRF). We speak minimal JSON-RPC 2.0 (`tools/list` + `tools/call`, v1 = tools
//! only) and accept either a direct `application/json` reply or an SSE-wrapped one.
//!
//! NB (v1 scope): the MCP `initialize` handshake + `Mcp-Session-Id` continuation are a documented
//! follow-up for servers that require them; the security-critical property (IP-pinned egress) is
//! independent of it and fully enforced here.

use std::net::SocketAddr;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::client::{DiscoveredTool, McpClient, RawToolOutput};
use crate::egress::{EgressFilter, Resolver};
use crate::error::ToolError;

pub struct HttpClient {
    http: reqwest::Client,
    url: String,
    /// full `Authorization` header value (e.g. `Bearer <token>`), injected from the F3 vault at
    /// connect time — never logged, never serialized.
    auth: Option<String>,
}

impl HttpClient {
    /// SSRF-checked constructor: vet + pin the URL, then build a client that connects only to the
    /// pinned IP and follows no redirects. Rejects a URL that fails the egress policy.
    pub fn connect<R: Resolver>(
        filter: &EgressFilter<R>,
        url: &str,
        auth: Option<String>,
        timeout: Duration,
    ) -> Result<Self, ToolError> {
        let pinned = filter.check(url)?;
        let addr = SocketAddr::new(pinned.ip, pinned.port);
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            // Pin: reqwest connects to THIS socket for `host`, defeating a later DNS rebind.
            .resolve(&pinned.host, addr)
            .build()
            .map_err(|e| ToolError::Transport(e.to_string()))?;
        Ok(Self {
            http,
            url: url.to_string(),
            auth,
        })
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, ToolError> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let mut req = self
            .http
            .post(&self.url)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .json(&body);
        if let Some(a) = &self.auth {
            req = req.header("authorization", a);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| ToolError::Transport(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ToolError::Transport(format!("http status {}", resp.status())));
        }
        let is_sse = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.contains("text/event-stream"))
            .unwrap_or(false);
        let text = resp
            .text()
            .await
            .map_err(|e| ToolError::Transport(e.to_string()))?;
        let v = if is_sse {
            parse_sse_json(&text)?
        } else {
            serde_json::from_str::<Value>(&text)
                .map_err(|e| ToolError::Transport(format!("invalid json-rpc: {e}")))?
        };
        if let Some(err) = v.get("error") {
            return Err(ToolError::Transport(format!("json-rpc error: {err}")));
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }
}

#[async_trait]
impl McpClient for HttpClient {
    async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, ToolError> {
        let result = self.rpc("tools/list", json!({})).await?;
        Ok(parse_tools(&result))
    }

    async fn call_tool(
        &self,
        tool_name: &str,
        arguments: &str,
    ) -> Result<RawToolOutput, ToolError> {
        // arguments arrives as a JSON string; forward it as a JSON object (fallback: empty).
        let args: Value = serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
        let result = self
            .rpc("tools/call", json!({ "name": tool_name, "arguments": args }))
            .await?;
        Ok(RawToolOutput {
            text: extract_content_text(&result),
            is_error: result
                .get("isError")
                .and_then(|b| b.as_bool())
                .unwrap_or(false),
        })
    }
}

/// Extract the first JSON-RPC response object from an SSE body (`data: {...}` lines).
fn parse_sse_json(text: &str) -> Result<Value, ToolError> {
    for line in text.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            if v.get("result").is_some() || v.get("error").is_some() {
                return Ok(v);
            }
        }
    }
    Err(ToolError::Transport(
        "no json-rpc response found in sse stream".into(),
    ))
}

/// Parse a `tools/list` result into discovered tools (name + description + input schema).
fn parse_tools(result: &Value) -> Vec<DiscoveredTool> {
    result
        .get("tools")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.get("name")?.as_str()?.to_string();
                    Some(DiscoveredTool {
                        name,
                        description: t
                            .get("description")
                            .and_then(|d| d.as_str())
                            .map(String::from),
                        // MCP uses `inputSchema`; keep it verbatim for the offer + cache.
                        input_schema: t.get("inputSchema").cloned().unwrap_or_else(|| json!({})),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Concatenate the text blocks of an MCP `tools/call` result's `content` array.
fn extract_content_text(result: &Value) -> String {
    result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::egress::{EgressFilter, EgressPolicy, Resolver};
    use std::collections::HashMap;
    use std::net::IpAddr;

    struct R(HashMap<String, Vec<IpAddr>>);
    impl Resolver for R {
        fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ToolError> {
            Ok(self.0.get(host).cloned().unwrap_or_default())
        }
    }

    #[test]
    fn connect_rejects_ssrf_target_before_building_a_client() {
        let mut m = HashMap::new();
        m.insert("evil".into(), vec!["169.254.169.254".parse().unwrap()]);
        let f = EgressFilter::new(R(m), EgressPolicy::default());
        // NB: HttpClient deliberately isn't Debug (its auth is a secret), so match rather than
        // unwrap_err (which would require the Ok type to be Debug).
        let res = HttpClient::connect(&f, "https://evil/mcp", None, Duration::from_secs(5));
        assert!(matches!(res, Err(ToolError::Ssrf(_))));
    }

    #[test]
    fn parse_tools_reads_name_description_and_input_schema() {
        let result = json!({
            "tools": [
                { "name": "read_file", "description": "reads a file",
                  "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } } },
                { "name": "noschema" }
            ]
        });
        let tools = parse_tools(&result);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "read_file");
        assert_eq!(tools[0].description.as_deref(), Some("reads a file"));
        assert!(tools[0].input_schema.get("properties").is_some());
        assert_eq!(tools[1].input_schema, json!({})); // missing schema defaults to {}
    }

    #[test]
    fn extract_content_text_joins_text_blocks() {
        let result = json!({
            "content": [
                { "type": "text", "text": "line one" },
                { "type": "image", "data": "..." },
                { "type": "text", "text": "line two" }
            ],
            "isError": false
        });
        assert_eq!(extract_content_text(&result), "line one\nline two");
    }

    #[test]
    fn parse_sse_json_extracts_the_rpc_response() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n\n";
        let v = parse_sse_json(body).unwrap();
        assert!(v.get("result").is_some());
    }

    #[test]
    fn parse_sse_json_errors_when_no_response_present() {
        assert!(parse_sse_json("event: ping\ndata: [DONE]\n\n").is_err());
    }
}
