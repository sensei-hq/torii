//! `tools/list` discovery → the `mcp_server_tools` cache (D5).
//!
//! Runs on `register-server` and `refresh-tools`. Upserts each discovered tool (marking it
//! active) and **reconciles removals** by marking any previously-cached tool the server no
//! longer exposes as `is_active = false` (soft — kept for the audit trail + so an existing
//! allow-list grant's FK stays valid). service_role write.

use uuid::Uuid;

use crate::client::McpClient;
use crate::error::ToolError;
use sqlx::PgPool;

/// Discover `server`'s tools and reconcile its cache. Returns the number of active tools discovered.
pub async fn discover_and_cache(
    pool: &PgPool,
    server_id: Uuid,
    client: &dyn McpClient,
) -> Result<usize, ToolError> {
    let tools = client.list_tools().await?;
    let names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();

    for t in &tools {
        sqlx::query(
            "insert into public.mcp_server_tools \
               (mcp_server_id, tool_name, json_schema, is_active, discovered_at) \
             values ($1, $2, $3, true, now()) \
             on conflict (mcp_server_id, tool_name) do update \
                set json_schema = excluded.json_schema, is_active = true, discovered_at = now()",
        )
        .bind(server_id)
        .bind(&t.name)
        .bind(&t.input_schema)
        .execute(pool)
        .await?;
    }

    // Removals: a tool the server no longer lists is deactivated (never hard-deleted — an
    // existing grant references it, and the audit trail matters). An empty discovery deactivates
    // every cached tool for the server.
    sqlx::query(
        "update public.mcp_server_tools set is_active = false \
         where mcp_server_id = $1 and tool_name <> all($2)",
    )
    .bind(server_id)
    .bind(&names)
    .execute(pool)
    .await?;

    Ok(tools.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{DiscoveredTool, RawToolOutput};
    use async_trait::async_trait;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::Row;

    struct FixedClient(Vec<DiscoveredTool>);
    #[async_trait]
    impl McpClient for FixedClient {
        async fn list_tools(&self) -> Result<Vec<DiscoveredTool>, ToolError> {
            Ok(self.0.clone())
        }
        async fn call_tool(&self, _t: &str, _a: &str) -> Result<RawToolOutput, ToolError> {
            unreachable!()
        }
    }
    fn tool(name: &str) -> DiscoveredTool {
        DiscoveredTool {
            name: name.into(),
            description: None,
            input_schema: serde_json::json!({ "type": "object" }),
        }
    }

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    /// Discovery upserts the discovered tools active, and a later discovery that no longer lists
    /// a tool deactivates it (soft) while keeping the still-present ones active.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn discovery_upserts_then_reconciles_removed_tools() {
        let pool = pool().await;
        let tenant = Uuid::new_v4();
        sqlx::query("insert into core.tenants (id, name, slug, modified_by) values ($1,'disc',$2,'disc')")
            .bind(tenant)
            .bind(format!("disc-{tenant}"))
            .execute(&pool)
            .await
            .unwrap();
        let server: Uuid = sqlx::query_scalar(
            "insert into public.mcp_servers (tenant_id, name, transport) values ($1,'web','http') returning id",
        )
        .bind(tenant)
        .fetch_one(&pool)
        .await
        .unwrap();

        // first discovery: two tools, both active.
        let n = discover_and_cache(&pool, server, &FixedClient(vec![tool("read"), tool("write")]))
            .await
            .unwrap();
        assert_eq!(n, 2);
        let active: i64 = sqlx::query(
            "select count(*) from public.mcp_server_tools where mcp_server_id=$1 and is_active",
        )
        .bind(server)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get(0);
        assert_eq!(active, 2);

        // second discovery: 'write' removed → deactivated, 'read' stays active.
        discover_and_cache(&pool, server, &FixedClient(vec![tool("read")]))
            .await
            .unwrap();
        let write_active: bool = sqlx::query_scalar(
            "select is_active from public.mcp_server_tools where mcp_server_id=$1 and tool_name='write'",
        )
        .bind(server)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!write_active, "removed tool is deactivated, not deleted");
        let read_active: bool = sqlx::query_scalar(
            "select is_active from public.mcp_server_tools where mcp_server_id=$1 and tool_name='read'",
        )
        .bind(server)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(read_active);

        // cleanup — delete the server (cascades tools) + the tenant.
        sqlx::query("delete from public.mcp_servers where id=$1")
            .bind(server)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("delete from core.tenants where id=$1")
            .bind(tenant)
            .execute(&pool)
            .await
            .unwrap();
    }
}
