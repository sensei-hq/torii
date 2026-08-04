//! Default-deny `(role × space)` allow-list resolution (central plane / DB only).
//!
//! [`AllowListResolver::resolve`] turns a caller context + optional space into the exact
//! [`AllowedToolSet`] they may use — the union of `tool_allow_lists` grants across the caller's
//! roles, scoped to the space (or role-wide `space_id IS NULL` grants), expanded against the
//! discovered-tool cache (`*`/`tool_name IS NULL` wildcard ⇒ all the server's tools), filtered
//! to tenant-enabled servers, with device-only `stdio` servers dropped on the cloud plane. A
//! caller with no grant gets an empty set — **default-deny**. Absence is the deny.

use uuid::Uuid;

use crate::types::{
    offered_name, AllowedToolSet, Plane, ToolBinding, ToolDef, ToolKey, Transport,
};

/// The caller context for resolution (populated from the gateway's RequestContext).
#[derive(Debug, Clone)]
pub struct ResolveCtx {
    pub tenant_id: Uuid,
    /// the caller's profile id — used for the space-membership gate.
    pub actor_id: Uuid,
    /// every role the caller holds (the allow-list is a union over these).
    pub role_ids: Vec<Uuid>,
    /// the plane resolution is for — `Cloud` drops device-only `stdio` servers.
    pub plane: Plane,
}

/// One `(server, tool)` the allow-list query returned, before plane filtering + set construction.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedRow {
    pub server_id: Uuid,
    pub server_name: String,
    pub transport: Transport,
    pub tool_name: String,
    pub input_schema: serde_json::Value,
}

/// Parse the DB `transport` text; an unknown value drops the row (fail-safe).
pub fn parse_transport(s: &str) -> Option<Transport> {
    match s {
        "stdio" => Some(Transport::Stdio),
        "http" => Some(Transport::Http),
        "sse" => Some(Transport::Sse),
        _ => None,
    }
}

/// Which plane a tool runs on: `stdio` on the device, `http`/`sse` through the gateway.
fn transport_plane(t: Transport) -> Plane {
    match t {
        Transport::Stdio => Plane::Local,
        Transport::Http | Transport::Sse => Plane::Cloud,
    }
}

/// Pure: filter resolved rows by plane (drop device-only `stdio` when resolving for the cloud
/// plane) and build the default-deny [`AllowedToolSet`]. Deterministic + unit-testable with no DB.
pub fn build_allowed_set(rows: Vec<ResolvedRow>, plane: Plane) -> AllowedToolSet {
    let mut defs = Vec::new();
    for r in rows {
        // stdio is device-only — never offer it on the cloud plane (D2).
        if plane == Plane::Cloud && r.transport.is_device_only() {
            continue;
        }
        defs.push(ToolDef {
            offered_name: offered_name(&r.server_name, &r.tool_name),
            description: None,
            input_schema: r.input_schema,
            binding: ToolBinding {
                key: ToolKey {
                    server_id: r.server_id,
                    tool_name: r.tool_name,
                },
                server_name: r.server_name,
                transport: r.transport,
                plane: transport_plane(r.transport),
            },
        });
    }
    AllowedToolSet::new(defs)
}

#[cfg(feature = "db")]
pub use db::AllowListResolver;

#[cfg(feature = "db")]
mod db {
    use super::*;
    use crate::error::ToolError;
    use sqlx::{PgPool, Row};

    /// Expand the caller's grants into concrete `(server, tool)` rows. Default-deny by
    /// construction — only rows a grant produces are returned. `$3` (space) NULL ⇒ only
    /// role-wide (`space_id IS NULL`) grants match. Servers must be visible (platform or own)
    /// and effectively enabled for the tenant.
    const QUERY: &str = "\
        select distinct s.id as server_id, s.name as server_name, s.transport::text as transport, \
               t.tool_name as tool_name, t.json_schema as json_schema \
          from public.tool_allow_lists tal \
          join public.mcp_servers s on s.id = tal.mcp_server_id \
          join public.mcp_server_tools t \
                on t.mcp_server_id = tal.mcp_server_id and t.is_active \
               and (tal.tool_name is null or tal.tool_name = t.tool_name) \
         where tal.tenant_id = $1 \
           and tal.role_id = any($2) \
           and (tal.space_id is null or tal.space_id = $3) \
           and (s.tenant_id is null or s.tenant_id = $1) \
           and coalesce((select tms.enabled from public.tenant_mcp_servers tms \
                          where tms.tenant_id = $1 and tms.mcp_server_id = s.id), s.enabled) = true";

    /// Resolves the default-deny allow-list against Postgres (service_role / RLS-bypassing;
    /// the WHERE clause enforces tenant + visibility explicitly).
    pub struct AllowListResolver<'a> {
        pool: &'a PgPool,
    }

    impl<'a> AllowListResolver<'a> {
        pub fn new(pool: &'a PgPool) -> Self {
            Self { pool }
        }

        /// Resolve the caller's allowed tool set for an optional space. A space-scoped resolve
        /// requires membership — a non-member (or a caller with no roles) gets an empty set.
        pub async fn resolve(
            &self,
            ctx: &ResolveCtx,
            space_id: Option<Uuid>,
        ) -> Result<AllowedToolSet, ToolError> {
            // Space-membership gate: you must be a member of the space to use its tools.
            if let Some(space) = space_id {
                let is_member: bool = sqlx::query_scalar(
                    "select exists(select 1 from public.space_members \
                       where tenant_id = $1 and space_id = $2 and profile_id = $3)",
                )
                .bind(ctx.tenant_id)
                .bind(space)
                .bind(ctx.actor_id)
                .fetch_one(self.pool)
                .await?;
                if !is_member {
                    return Ok(AllowedToolSet::default());
                }
            }
            if ctx.role_ids.is_empty() {
                return Ok(AllowedToolSet::default());
            }

            let rows = sqlx::query(QUERY)
                .bind(ctx.tenant_id)
                .bind(&ctx.role_ids)
                .bind(space_id)
                .fetch_all(self.pool)
                .await?;

            let resolved = rows
                .iter()
                .filter_map(|row| {
                    let transport: String = row.get("transport");
                    Some(ResolvedRow {
                        server_id: row.get("server_id"),
                        server_name: row.get("server_name"),
                        transport: parse_transport(&transport)?,
                        tool_name: row.get("tool_name"),
                        input_schema: row.get("json_schema"),
                    })
                })
                .collect();
            Ok(build_allowed_set(resolved, ctx.plane))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(server: &str, tool: &str, transport: Transport) -> ResolvedRow {
        ResolvedRow {
            server_id: Uuid::nil(),
            server_name: server.into(),
            transport,
            tool_name: tool.into(),
            input_schema: serde_json::json!({ "type": "object" }),
        }
    }

    #[test]
    fn build_set_offers_http_tools_and_indexes_them() {
        let set = build_allowed_set(
            vec![row("web", "fetch", Transport::Http), row("web", "search", Transport::Sse)],
            Plane::Cloud,
        );
        assert_eq!(set.len(), 2);
        assert!(set.binding_for("web__fetch").is_some());
        assert!(set.binding_for("web__search").is_some());
        assert!(set.binding_for("web__delete").is_none()); // default-deny
    }

    #[test]
    fn build_set_drops_stdio_on_the_cloud_plane() {
        let rows = vec![
            row("filesystem", "read_file", Transport::Stdio),
            row("web", "fetch", Transport::Http),
        ];
        // cloud: stdio dropped, http kept.
        let cloud = build_allowed_set(rows.clone(), Plane::Cloud);
        assert_eq!(cloud.len(), 1);
        assert!(cloud.binding_for("filesystem__read_file").is_none());
        assert!(cloud.binding_for("web__fetch").is_some());
        // local (device): stdio kept.
        let local = build_allowed_set(rows, Plane::Local);
        assert_eq!(local.len(), 2);
        assert!(local.binding_for("filesystem__read_file").is_some());
    }

    #[test]
    fn stdio_binding_is_local_plane_http_is_cloud() {
        let local = build_allowed_set(vec![row("fs", "read", Transport::Stdio)], Plane::Local);
        assert_eq!(local.binding_for("fs__read").unwrap().plane, Plane::Local);
        let cloud = build_allowed_set(vec![row("web", "fetch", Transport::Http)], Plane::Cloud);
        assert_eq!(cloud.binding_for("web__fetch").unwrap().plane, Plane::Cloud);
    }
}

#[cfg(all(test, feature = "db"))]
mod db_tests {
    //! Live-DB (55322) resolution semantics. Ignored by default:
    //!   `cargo test -p tools -- --ignored resolve_default_deny`
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> sqlx::PgPool {
        let url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgresql://postgres:postgres@127.0.0.1:55322/postgres".into());
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("connect local Supabase (55322)")
    }

    async fn grant(
        pool: &sqlx::PgPool,
        tenant: Uuid,
        role: Uuid,
        space: Option<Uuid>,
        server: Uuid,
        tool: Option<&str>,
    ) {
        sqlx::query(
            "insert into public.tool_allow_lists \
               (tenant_id, role_id, space_id, mcp_server_id, tool_name) \
             values ($1, $2, $3, $4, $5)",
        )
        .bind(tenant)
        .bind(role)
        .bind(space)
        .bind(server)
        .bind(tool)
        .execute(pool)
        .await
        .unwrap();
    }

    /// The default-deny `(role × space)` allow-list resolves exactly the granted tools:
    /// no grant ⇒ empty; a space grant is scoped to that space; a role-wide grant spans spaces;
    /// a `*` (tool_name NULL) grant expands to all a server's tools; a tenant-disabled server
    /// drops its tools; stdio is dropped on the cloud plane; a non-member and another tenant
    /// get nothing.
    #[tokio::test]
    #[ignore = "requires local Supabase (55322)"]
    async fn resolve_default_deny_role_space_plane_and_tenant_isolated() {
        let pool = pool().await;
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let actor = Uuid::new_v4();

        for t in [a, b] {
            sqlx::query(
                "insert into core.tenants (id, name, slug, modified_by) \
                 values ($1, 'tool-test', $2, 'tool-test')",
            )
            .bind(t)
            .bind(format!("tool-test-{t}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let role: Uuid = sqlx::query_scalar(
            "insert into core.roles (tenant_id, key, name) values ($1, $2, 'Editor') returning id",
        )
        .bind(a)
        .bind(format!("editor-{a}"))
        .fetch_one(&pool)
        .await
        .unwrap();
        let space: Uuid = sqlx::query_scalar(
            "insert into public.spaces (tenant_id, name, modified_by) \
             values ($1, 'Space', 'test') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let space2: Uuid = sqlx::query_scalar(
            "insert into public.spaces (tenant_id, name, modified_by) \
             values ($1, 'Space2', 'test') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        for s in [space, space2] {
            sqlx::query(
                "insert into public.space_members (tenant_id, space_id, profile_id) \
                 values ($1, $2, $3)",
            )
            .bind(a)
            .bind(s)
            .bind(actor)
            .execute(&pool)
            .await
            .unwrap();
        }
        let web: Uuid = sqlx::query_scalar(
            "insert into public.mcp_servers (tenant_id, name, transport) \
             values ($1, 'web', 'http') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        let fs: Uuid = sqlx::query_scalar(
            "insert into public.mcp_servers (tenant_id, name, transport) \
             values ($1, 'fs', 'stdio') returning id",
        )
        .bind(a)
        .fetch_one(&pool)
        .await
        .unwrap();
        for (server, tool) in [(web, "read"), (web, "write"), (fs, "read_file")] {
            sqlx::query(
                "insert into public.mcp_server_tools (mcp_server_id, tool_name) values ($1, $2)",
            )
            .bind(server)
            .bind(tool)
            .execute(&pool)
            .await
            .unwrap();
        }

        let r = AllowListResolver::new(&pool);
        let cloud = ResolveCtx {
            tenant_id: a,
            actor_id: actor,
            role_ids: vec![role],
            plane: Plane::Cloud,
        };
        let clear = |p: &sqlx::PgPool| {
            let p = p.clone();
            async move {
                sqlx::query("delete from public.tool_allow_lists where tenant_id = $1")
                    .bind(a)
                    .execute(&p)
                    .await
                    .unwrap();
            }
        };

        // 1. default-deny: no grants → empty.
        assert!(r.resolve(&cloud, Some(space)).await.unwrap().is_empty());

        // 2. a space grant is scoped to that space only.
        grant(&pool, a, role, Some(space), web, Some("read")).await;
        let s = r.resolve(&cloud, Some(space)).await.unwrap();
        assert_eq!(s.len(), 1);
        assert!(s.binding_for("web__read").is_some());
        assert!(s.binding_for("web__write").is_none()); // not granted
        assert!(r.resolve(&cloud, Some(space2)).await.unwrap().is_empty()); // other space

        // 3. a `*` (tool_name NULL) grant expands to all the server's tools.
        clear(&pool).await;
        grant(&pool, a, role, Some(space), web, None).await;
        assert_eq!(r.resolve(&cloud, Some(space)).await.unwrap().len(), 2);

        // 4. a role-wide grant (space_id NULL) spans every space the caller belongs to.
        clear(&pool).await;
        grant(&pool, a, role, None, web, Some("read")).await;
        assert!(r.resolve(&cloud, Some(space)).await.unwrap().binding_for("web__read").is_some());
        assert!(r.resolve(&cloud, Some(space2)).await.unwrap().binding_for("web__read").is_some());

        // 5. a tenant-disabled server drops its tools.
        sqlx::query(
            "insert into public.tenant_mcp_servers (tenant_id, mcp_server_id, enabled) \
             values ($1, $2, false)",
        )
        .bind(a)
        .bind(web)
        .execute(&pool)
        .await
        .unwrap();
        assert!(r.resolve(&cloud, Some(space)).await.unwrap().is_empty());
        sqlx::query("delete from public.tenant_mcp_servers where tenant_id = $1")
            .bind(a)
            .execute(&pool)
            .await
            .unwrap();

        // 6. stdio is dropped on the cloud plane, present on the local plane.
        clear(&pool).await;
        grant(&pool, a, role, None, fs, Some("read_file")).await;
        assert!(r
            .resolve(&cloud, Some(space))
            .await
            .unwrap()
            .binding_for("fs__read_file")
            .is_none());
        let local = ResolveCtx {
            plane: Plane::Local,
            ..cloud.clone()
        };
        assert!(r
            .resolve(&local, Some(space))
            .await
            .unwrap()
            .binding_for("fs__read_file")
            .is_some());

        // 7. a non-member of the space gets nothing (membership gate).
        let stranger = ResolveCtx {
            actor_id: Uuid::new_v4(),
            ..cloud.clone()
        };
        assert!(r.resolve(&stranger, Some(space)).await.unwrap().is_empty());

        // 8. another tenant sees none of tenant A's grants.
        let other_tenant = ResolveCtx {
            tenant_id: b,
            ..cloud.clone()
        };
        assert!(r.resolve(&other_tenant, Some(space)).await.unwrap().is_empty());
        assert!(r.resolve(&other_tenant, None).await.unwrap().is_empty());

        // cleanup — delete servers (cascades tools + grants) then tenants (cascades the rest).
        for srv in [web, fs] {
            sqlx::query("delete from public.mcp_servers where id = $1")
                .bind(srv)
                .execute(&pool)
                .await
                .unwrap();
        }
        for t in [a, b] {
            sqlx::query("delete from core.tenants where id = $1")
                .bind(t)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}
