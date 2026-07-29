# Seiki Onboarding M1 — Org Creation + Ownership — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Edit `.svelte` files with the svelte MCP / svelte-file-editor.

**Goal:** Let a signed-in, tenant-less user self-create an organization (becoming its `owner`), transfer ownership, and ensure `owner`/`admin` carry the right capabilities — no domain machinery (that's M2).

**Architecture:** Two gateway `/rpc` writes (`orgs/create`, `orgs/transfer-ownership`) following the existing `authorize`/`audit`/transaction pattern in `services/gateway/src/routes/rpc.rs`; a one-line tightening of `import_role_permissions()` + a prod cleanup for the `admin` grant set; a partial unique index enforcing one `owner` per tenant; a new `/onboarding` route replacing the sign-in callback's "no-org" dead-end; a transfer action on the Organization screen. All privileged writes are gateway-mediated (service-role); the client refreshes its JWT after membership changes.

**Tech Stack:** Rust/Axum + sqlx (gateway) · Postgres via dbd (`database/`) · SvelteKit (Svelte 5 runes) + supabase-js v2 (`apps/admin`) · bun. Code style: **no semicolons, single quotes, tabs** (TS/Svelte); house Rust style (gateway).

**Design spec:** `docs/design/seiki-org-onboarding-m1-org-creation.md`
**Branch:** `develop`. DB via **dbd** (`dbd reset && dbd apply && dbd import` locally — never hand-edit schema through raw psql; see memory `feedback_dbd_workflow`).

**Correction incorporated:** `owner`/`admin` grants already exist — `import_role_permissions()` computes `owner`=all caps, `admin`=all-except-`tenant.manage`. M1 only tightens `admin` to also exclude `role.manage` + `apikey.manage` (the reserved-owner choice) and cleans the already-provisioned prod rows.

---

## File Structure

| File | Change |
|---|---|
| `database/ddl/procedure/staging/import_role_permissions.ddl` | Tighten `admin` exclusion to `('tenant.manage','role.manage','apikey.manage')` |
| `database/import/rework_admin_grants.sql` *(new after-script)* | Idempotent cleanup: delete the two now-reserved grants from the shared `admin` role (fixes already-provisioned DBs) |
| `database/ddl/table/core/profile_roles.ddl` | Add a partial unique index: one `owner` per tenant |
| `database/tests/org_onboarding.sql` *(new)* | Assert effective grants for owner/admin + owner-singularity |
| `services/gateway/src/routes/rpc.rs` | Add `orgs_create` + `orgs_transfer_ownership` handlers + a `slugify` helper (+ Rust unit test) |
| `services/gateway/src/main.rs` | Register `/orgs/create` + `/orgs/transfer-ownership` routes |
| `apps/admin/src/lib/api.ts` | `createOrg`, `transferOwnership`, `refreshSession` |
| `apps/admin/src/routes/onboarding/+page.svelte` *(new)* | Create-organization screen |
| `apps/admin/src/routes/auth/callback/+page.svelte` | `no-org` → `goto('/onboarding')` instead of the terminal message |
| `apps/admin/kavach.config.js` | Add `/onboarding` public rule (reachable while tenant-less) |
| `apps/admin/src/routes/(app)/organization/+page.svelte` | Add a "Transfer ownership" section |

---

### Task 1: Tighten `admin` grants + prod cleanup + DB test

**Files:** Modify `database/ddl/procedure/staging/import_role_permissions.ddl`; Create `database/import/rework_admin_grants.sql`; Create `database/tests/org_onboarding.sql`

- [ ] **Step 1: Tighten the `admin` computation.** In `import_role_permissions.ddl`, replace the admin branch:

```sql
    -- admin: everything except tenant.manage (ownership-level)
    select null::uuid, r.id, c.key
      from core.roles r
      join core.capabilities c on c.key <> 'tenant.manage'
     where r.tenant_id is null and r.key = 'admin'
```

with (reserve the control-plane trio to `owner`):

```sql
    -- admin: everything except the owner-reserved control-plane caps
    select null::uuid, r.id, c.key
      from core.roles r
      join core.capabilities c
        on c.key not in ('tenant.manage', 'role.manage', 'apikey.manage')
     where r.tenant_id is null and r.key = 'admin'
```

Also update the procedure's header comment (`admin = all except tenant.manage`) to `admin = all except tenant.manage / role.manage / apikey.manage`.

- [ ] **Step 2: Cleanup after-script for already-provisioned DBs.** Create `database/import/rework_admin_grants.sql` (dbd runs `database/import/*.sql` after-scripts verbatim; plpgsql is fine here):

```sql
-- Reserve role.manage + apikey.manage to `owner` (M1). import_role_permissions only ADDS
-- (on conflict do nothing), so an admin default role provisioned before this change still
-- holds these two — delete them from the SHARED admin default (tenant_id NULL). Idempotent.
set search_path to core, extensions;

delete from core.role_permissions rp
  using core.roles r
 where rp.role_id = r.id
   and r.tenant_id is null
   and r.key = 'admin'
   and rp.tenant_id is null
   and rp.capability in ('role.manage', 'apikey.manage');
```

- [ ] **Step 3: Write the grant + singularity test.** Create `database/tests/org_onboarding.sql` (mirrors `tests/authz.sql`; run with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/org_onboarding.sql`):

```sql
-- M1 · org-onboarding grants + ownership invariants. Run after apply+import+policies.
\set ON_ERROR_STOP on
\echo '== M1 org-onboarding: role grants + owner singularity =='
do $$
declare
  owner_id uuid := (select id from core.roles where tenant_id is null and key = 'owner');
  admin_id uuid := (select id from core.roles where tenant_id is null and key = 'admin');
  n_caps int := (select count(*) from core.capabilities);
  n_owner int := (select count(*) from core.role_permissions where role_id = owner_id and tenant_id is null);
  n_admin int := (select count(*) from core.role_permissions where role_id = admin_id and tenant_id is null);
begin
  -- owner holds every capability
  if n_owner <> n_caps then
    raise exception 'FAIL owner grants: owner has % of % capabilities', n_owner, n_caps;
  end if;
  -- admin holds every capability EXCEPT the reserved control-plane trio
  if n_admin <> n_caps - 3 then
    raise exception 'FAIL admin grants: admin has % (expected %)', n_admin, n_caps - 3;
  end if;
  if exists (
    select 1 from core.role_permissions
     where role_id = admin_id and tenant_id is null
       and capability in ('tenant.manage', 'role.manage', 'apikey.manage')
  ) then
    raise exception 'FAIL admin grants: admin still holds a reserved capability';
  end if;
end $$;

-- owner-singularity: two owners in one tenant must be rejected by the partial unique index.
begin;
  insert into core.profiles (id) values
    ('aaaaaaaa-0000-0000-0000-000000000001'),
    ('aaaaaaaa-0000-0000-0000-000000000002') on conflict do nothing;
  insert into core.profile_tenants (profile_id, tenant_id, assigned_by) values
    ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','t')
    on conflict do nothing;
  do $$
  declare owner_id uuid := (select id from core.roles where tenant_id is null and key='owner');
  begin
    insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
      values ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000001',owner_id,'t');
    begin
      insert into core.profile_roles(tenant_id, profile_id, role_id, assigned_by)
        values ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000002',owner_id,'t');
      raise exception 'FAIL singularity: a tenant accepted a SECOND owner';
    exception when unique_violation then null; end;
  end $$;
rollback;
\echo 'OK M1 org-onboarding'
```

- [ ] **Step 4: Apply + import + test (local).**

Run: `dbd reset && dbd apply && dbd import` then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/org_onboarding.sql`
Expected: `OK M1 org-onboarding` (Task 2's index must be in place first for the singularity half — if running Task 1 alone, expect the singularity block to fail until Task 2 lands; run Steps 1-3 of Task 2 before Step 4).

- [ ] **Step 5: Commit**

```bash
git add database/ddl/procedure/staging/import_role_permissions.ddl database/import/rework_admin_grants.sql database/tests/org_onboarding.sql
git commit -m "rbac(seiki): reserve role.manage + apikey.manage to owner; grant test"
```

---

### Task 2: One-owner-per-tenant index

**Files:** Modify `database/ddl/table/core/profile_roles.ddl`

- [ ] **Step 1: Add the partial unique index.** Append to `profile_roles.ddl`, after the existing `idx_profile_tenants_tenant`-style index block:

```sql
-- M1: at most one `owner` per tenant. Partial unique over (tenant_id) where the assigned
-- role is the shared-default owner role. Ownership transfer must demote before/with promote.
create unique index if not exists profile_roles_one_owner_per_tenant
  on core.profile_roles (tenant_id)
  where role_id = (select id from core.roles where tenant_id is null and key = 'owner');
```

- [ ] **Step 2: Verify the predicate is IMMUTABLE-safe.** A partial-index predicate cannot contain a subquery. Run: `dbd reset && dbd apply` — if apply errors (`cannot use subquery in index predicate`), fall back to the deterministic form below and re-apply:

```sql
-- Fallback: owner role id is stable (seeded). Look it up once and inline the literal, OR
-- enforce via a trigger. Prefer a BEFORE INSERT/UPDATE trigger that raises when a second
-- active owner would exist, so no hardcoded uuid:
create or replace function core.one_owner_per_tenant() returns trigger
language plpgsql as $$
begin
  if NEW.role_id = (select id from core.roles where tenant_id is null and key='owner')
     and exists (
       select 1 from core.profile_roles pr
        where pr.tenant_id = NEW.tenant_id
          and pr.role_id = NEW.role_id
          and pr.profile_id <> NEW.profile_id
     ) then
    raise unique_violation using message = 'tenant already has an owner';
  end if;
  return NEW;
end $$;
create trigger profile_roles_one_owner
  before insert or update on core.profile_roles
  for each row execute function core.one_owner_per_tenant();
```

Use whichever the local Postgres accepts; the test in Task 1 Step 3 asserts a second owner raises `unique_violation` either way.

- [ ] **Step 3: Verify** — re-run Task 1 Step 4's test; expect `OK M1 org-onboarding`.

- [ ] **Step 4: Commit**

```bash
git add database/ddl/table/core/profile_roles.ddl database/ddl/function/core/one_owner_per_tenant.ddl 2>/dev/null || git add database/ddl/table/core/profile_roles.ddl
git commit -m "rbac(seiki): enforce one owner per tenant"
```

---

### Task 3: `orgs/create` RPC + slug helper

**Files:** Modify `services/gateway/src/routes/rpc.rs` (add handler + `slugify` + a `#[cfg(test)]`); Modify `services/gateway/src/main.rs` (route)

- [ ] **Step 1: Add the `slugify` helper + unit test** near the top of `rpc.rs` (after the imports):

```rust
/// URL-safe slug from a display name: lowercase, non-alphanumerics → single '-', trimmed.
/// Empty input (or all-punctuation) → "org".
fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut prev_dash = false;
    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch);
            prev_dash = false;
        } else if !prev_dash && !s.is_empty() {
            s.push('-');
            prev_dash = true;
        }
    }
    let s = s.trim_end_matches('-').to_string();
    if s.is_empty() { "org".to_string() } else { s }
}

#[cfg(test)]
mod slug_tests {
    use super::slugify;
    #[test]
    fn slugifies() {
        assert_eq!(slugify("Acme, Inc."), "acme-inc");
        assert_eq!(slugify("  Big   Corp  "), "big-corp");
        assert_eq!(slugify("!!!"), "org");
        assert_eq!(slugify(""), "org");
    }
}
```

- [ ] **Step 2: Add the request type + handler.** Add to `rpc.rs`:

```rust
#[derive(Deserialize)]
pub struct CreateOrg {
    pub name: String,
}

/// `POST /rpc/orgs/create` — self-service org creation for a TENANT-LESS caller (no capability
/// gate; any authenticated user without a tenant). One transaction: create the tenant, make the
/// caller its `owner`, seed the fail-closed budget org-root, and bump claims_version so the next
/// token refresh carries the new tenant_id/role_ids. Rejects a caller who already has a tenant
/// (single-membership: profile_tenants.profile_id is PK).
pub async fn orgs_create(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<CreateOrg>,
) -> Response {
    let actor = match Uuid::parse_str(&claims.sub) {
        Ok(a) => a,
        Err(_) => return (StatusCode::UNAUTHORIZED, "bad subject").into_response(),
    };
    let name = body.name.trim();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, "organization name is required").into_response();
    }

    // Single-membership guard.
    let has_tenant: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_tenants where profile_id = $1)",
    )
    .bind(actor)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(true); // fail closed: if the check errors, don't create
    if has_tenant {
        return (StatusCode::CONFLICT, "you already belong to an organization").into_response();
    }

    let owner_role: Uuid = match sqlx::query_scalar(
        "select id from core.roles where tenant_id is null and key = 'owner'",
    )
    .fetch_one(&state.pool)
    .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("orgs_create: owner role lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("orgs_create: begin: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    // Tenant — try the plain slug, fall back to a uuid-suffixed slug on collision.
    let base = slugify(name);
    let mut slug = base.clone();
    let mut tenant_id: Option<Uuid> = None;
    for attempt in 0..2 {
        let res: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            "insert into core.tenants (name, slug, status, modified_by) \
             values ($1, $2, 'trial', $3) returning id",
        )
        .bind(name)
        .bind(&slug)
        .bind(actor.to_string())
        .fetch_one(&mut *tx)
        .await;
        match res {
            Ok(id) => { tenant_id = Some(id); break; }
            Err(e) if attempt == 0 && e.as_database_error().map_or(false, |d| d.is_unique_violation()) => {
                slug = format!("{base}-{}", &Uuid::new_v4().to_string()[..6]);
            }
            Err(e) => {
                tracing::error!("orgs_create: insert tenant: {e}");
                return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
            }
        }
    }
    let tenant = match tenant_id {
        Some(t) => t,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response(),
    };

    // Membership, owner role, budget org-root, freshness bump — all in the same tx.
    let steps: Result<(), sqlx::Error> = async {
        sqlx::query(
            "insert into core.profile_tenants (profile_id, tenant_id, assigned_by) \
             values ($1, $2, 'self_create')",
        ).bind(actor).bind(tenant).execute(&mut *tx).await?;
        sqlx::query(
            "insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
             values ($1, $2, $3, 'self_create')",
        ).bind(tenant).bind(actor).bind(owner_role).execute(&mut *tx).await?;
        sqlx::query(
            "insert into public.budget_nodes (tenant_id, kind, name, cap_amount, enforcement, modified_by) \
             values ($1, 'org', 'Organization', null, 'hard', $2)",
        ).bind(tenant).bind(actor.to_string()).execute(&mut *tx).await?;
        sqlx::query(
            "update core.profiles set claims_version = claims_version + 1 where id = $1",
        ).bind(actor).execute(&mut *tx).await?;
        Ok(())
    }.await;
    if let Err(e) = steps {
        tracing::error!("orgs_create: seed tenant: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("orgs_create: commit: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(&state, tenant, actor, "org.created", "tenant", Some(tenant)).await;
    (StatusCode::OK, Json(json!({ "tenant_id": tenant }))).into_response()
}
```

- [ ] **Step 3: Register the route** in `services/gateway/src/main.rs`, in the `rpc` router block, after the `/rbac/*` routes:

```rust
        .route("/orgs/create", post(routes::rpc::orgs_create))
        .route(
            "/orgs/transfer-ownership",
            post(routes::rpc::orgs_transfer_ownership),
        )
```

(Both routes added now; the transfer handler lands in Task 4.)

- [ ] **Step 4: Build** — Run: `cargo build -p torii-gateway` (or the workspace: `cargo build`) from the repo root.
Expected: compiles. (Task 4 adds `orgs_transfer_ownership`; if building after Task 3 alone, temporarily omit the transfer route line, or do Tasks 3+4 before building.)

- [ ] **Step 5: Run the slug unit test** — Run: `cargo test -p torii-gateway slug_tests`
Expected: `test slug_tests::slugifies ... ok`.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/rpc.rs services/gateway/src/main.rs
git commit -m "orgs(seiki): /rpc/orgs/create — self-service org + owner + budget root"
```

---

### Task 4: `orgs/transfer-ownership` RPC

**Files:** Modify `services/gateway/src/routes/rpc.rs`

- [ ] **Step 1: Add the request type + handler.** Add to `rpc.rs`:

```rust
#[derive(Deserialize)]
pub struct TransferOwnership {
    pub profile_id: Uuid, // the member to make the new owner
}

/// `POST /rpc/orgs/transfer-ownership` — OWNER-ONLY (gated on holding the `owner` role, not a
/// capability). Atomically demote the caller owner→admin and promote an active member→owner,
/// bumping both claims_version. The one-owner index/trigger backstops the invariant.
pub async fn orgs_transfer_ownership(
    Extension(claims): Extension<Claims>,
    State(state): State<SharedState>,
    Json(body): Json<TransferOwnership>,
) -> Response {
    // tenant.manage is owner-only by grant, so this also runs the freshness gate + tenant resolve.
    let (tenant, actor) = match authorize(&state, &claims, "tenant.manage").await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let (owner_role, admin_role): (Uuid, Uuid) = match sqlx::query_as(
        "select \
           (select id from core.roles where tenant_id is null and key = 'owner'), \
           (select id from core.roles where tenant_id is null and key = 'admin')",
    )
    .fetch_one(&state.pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("transfer: role lookup: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
        }
    };

    // Caller must currently hold `owner` in this tenant (belt-and-suspenders over tenant.manage).
    let is_owner: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_roles \
           where tenant_id = $1 and profile_id = $2 and role_id = $3)",
    )
    .bind(tenant).bind(actor).bind(owner_role)
    .fetch_one(&state.pool).await.unwrap_or(false);
    if !is_owner {
        return (StatusCode::FORBIDDEN, "only the owner can transfer ownership").into_response();
    }
    if body.profile_id == actor {
        return (StatusCode::BAD_REQUEST, "you are already the owner").into_response();
    }
    // Target must be an active member of the tenant.
    let target_member: bool = sqlx::query_scalar(
        "select exists(select 1 from core.profile_tenants \
           where profile_id = $1 and tenant_id = $2 and status = 'active')",
    )
    .bind(body.profile_id).bind(tenant)
    .fetch_one(&state.pool).await.unwrap_or(false);
    if !target_member {
        return (StatusCode::NOT_FOUND, "target is not a member of this organization").into_response();
    }

    // Atomic swap: remove owner from caller (→ add admin), remove any admin from target (→ add
    // owner). Demote-first so the one-owner index never sees two owners mid-transaction.
    let swap: Result<(), sqlx::Error> = async {
        sqlx::query("delete from core.profile_roles where tenant_id=$1 and profile_id=$2 and role_id=$3")
            .bind(tenant).bind(actor).bind(owner_role).execute(&state.pool).await?;
        sqlx::query("insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
                     values ($1,$2,$3,'transfer') on conflict do nothing")
            .bind(tenant).bind(actor).bind(admin_role).execute(&state.pool).await?;
        sqlx::query("insert into core.profile_roles (tenant_id, profile_id, role_id, assigned_by) \
                     values ($1,$2,$3,'transfer') on conflict do nothing")
            .bind(tenant).bind(body.profile_id).bind(owner_role).execute(&state.pool).await?;
        // Bump both so stale tokens can't keep the old authority.
        sqlx::query("update core.profiles set claims_version = claims_version + 1 where id = any($1)")
            .bind(vec![actor, body.profile_id]).execute(&state.pool).await?;
        Ok(())
    }.await;
    if let Err(e) = swap {
        tracing::error!("transfer: swap: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, "write failed").into_response();
    }

    audit(&state, tenant, actor, "org.ownership.transferred", "profile", Some(body.profile_id)).await;
    (StatusCode::OK, Json(json!({ "owner": body.profile_id }))).into_response()
}
```

> **Note on atomicity:** the swap above uses `&state.pool` per statement for brevity; wrap in a single `tx` (`state.pool.begin()` → `&mut *tx` → `tx.commit()`) exactly like `orgs_create` Step 2 so a mid-swap failure can't leave the tenant owner-less. Use the `tx` form.

- [ ] **Step 2: Build** — Run: `cargo build -p torii-gateway`. Expected: compiles (both routes now resolve).

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/routes/rpc.rs
git commit -m "orgs(seiki): /rpc/orgs/transfer-ownership — owner-gated atomic swap"
```

---

### Task 5: `api.ts` — createOrg / transferOwnership / refreshSession

**Files:** Modify `apps/admin/src/lib/api.ts`

- [ ] **Step 1: Add the three methods** to the `api` object (near the other `/rpc` writes):

```ts
	// Self-service org creation (tenant-less caller). Returns the new tenant id. Caller must
	// refreshSession() afterwards so the JWT carries the new tenant_id/role_ids.
	createOrg: (name: string) => gwPost<{ tenant_id: string }>('/rpc/orgs/create', { name }),
	// Owner-only: hand ownership to another member.
	transferOwnership: (profileId: string) =>
		gwPost('/rpc/orgs/transfer-ownership', { profile_id: profileId }),
	// Force a new access token so freshly-changed claims (tenant_id/role_ids/claims_version)
	// take effect without a full sign-out.
	refreshSession: async () => {
		const { error } = await sb().auth.refreshSession()
		if (error) throw new Error(error.message)
	},
```

- [ ] **Step 2: Type-check** — Run: `bun run --filter @seiki/admin check`. Expected: `0 ERRORS`.

- [ ] **Step 3: Lint own file** — Run from repo root: `./node_modules/.bin/prettier --check apps/admin/src/lib/api.ts && ./node_modules/.bin/eslint apps/admin/src/lib/api.ts`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/api.ts
git commit -m "orgs(seiki): api.createOrg + transferOwnership + refreshSession"
```

---

### Task 6: Onboarding route + callback wiring

**Files:** Create `apps/admin/src/routes/onboarding/+page.svelte`; Modify `apps/admin/src/routes/auth/callback/+page.svelte`; Modify `apps/admin/kavach.config.js`

- [ ] **Step 1: Create the onboarding page** `apps/admin/src/routes/onboarding/+page.svelte`:

```svelte
<script>
	import { api } from '$lib/api'
	import { BrandMark } from '@torii/ui'

	let name = $state('')
	let error = $state('')
	let loading = $state(false)

	async function create() {
		if (loading || !name.trim()) return
		loading = true
		error = ''
		try {
			await api.createOrg(name.trim())
			// New membership/role are live in the DB; refresh the JWT so the shell sees them.
			await api.refreshSession()
			window.location.assign('/')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			loading = false
		}
	}
</script>

<div class="grid min-h-screen place-items-center bg-paper px-6">
	<div class="w-full max-w-[400px] rounded-lg border border-paper-edge bg-paper-soft p-6">
		<div class="mb-4 flex justify-center"><BrandMark size={32} /></div>
		<h1 class="mb-1 text-center font-heading text-lg text-ink">Create your organization</h1>
		<p class="mb-5 text-center text-sm text-ink-mute">
			You're not part of an organization yet. Create one to get started — you'll be its owner.
		</p>
		<form
			onsubmit={(e) => {
				e.preventDefault()
				create()
			}}
			class="space-y-3"
		>
			<div>
				<span class="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-mute"
					>Organization name</span
				>
				<input
					bind:value={name}
					type="text"
					placeholder="Acme, Inc."
					aria-label="Organization name"
					class="w-full rounded-md border border-paper-edge bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
				/>
			</div>
			{#if error}
				<p class="text-xs text-danger" role="alert">{error}</p>
			{/if}
			<button
				type="submit"
				disabled={loading || !name.trim()}
				class="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-on-primary disabled:opacity-40"
			>
				{loading ? 'Creating…' : 'Create organization'}
			</button>
		</form>
	</div>
</div>
```

- [ ] **Step 2: Point the callback's no-org branch at onboarding.** In `apps/admin/src/routes/auth/callback/+page.svelte`, replace the `no-org` handling: instead of `status = 'no-org'`, navigate to onboarding. Change the `onMount` else-branch:

```svelte
		if (postAuthDestination(who) === 'home') {
			goto('/')
		} else {
			goto('/onboarding')
		}
```

Remove the now-unused `no-org` `{:else if}` markup branch and its state value (keep `working` and the `error` retry branch). `status` becomes `'working' | 'error'`. Leave `signOut` in place (still used by the error branch? no — error uses `retry`; if `signOut` is now unused, delete it and its button is already only in the removed no-org branch). Re-run the svelte-autofixer to confirm no unused-symbol warnings.

- [ ] **Step 3: Make `/onboarding` public** in `apps/admin/kavach.config.js` — add to the `rules` array (a tenant-less user must reach it):

```js
		{ path: '/onboarding', public: true }, // tenant-less users create their org here
```

- [ ] **Step 4: Validate** — svelte-autofixer on both `.svelte` files until clean; then `bun run --filter @seiki/admin check` (0 errors), `bun run --filter @seiki/admin build` (✓ done), and `./node_modules/.bin/prettier --check` on the three changed files (run `--write` on just them if needed). Do NOT run the app-wide lint.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes/onboarding/+page.svelte apps/admin/src/routes/auth/callback/+page.svelte apps/admin/kavach.config.js
git commit -m "orgs(seiki): onboarding create-org screen; callback routes tenant-less → /onboarding"
```

---

### Task 7: Transfer-ownership UI on the Organization screen

**Files:** Modify `apps/admin/src/routes/(app)/organization/+page.svelte`

- [ ] **Step 1: Add a transfer handler** in the `<script>` (next to `assign`/`unassign`):

```js
	/**
	 * Transfer ownership to another member (owner-only). Bumps both users' claims_version;
	 * since this demotes YOU, refresh the session and reload so the shell reflects the new caps.
	 * @param {string} profileId
	 */
	async function transferOwnership(profileId) {
		if (!profileId || busy) return
		if (!confirm('Transfer ownership? You will become an admin and can no longer manage roles, API keys, or org settings.')) return
		busy = profileId
		error = ''
		try {
			await api.transferOwnership(profileId)
			await api.refreshSession()
			window.location.assign('/organization')
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
		} finally {
			busy = ''
		}
	}
```

- [ ] **Step 2: Add a "Transfer ownership" control** in the members section markup — a per-member action available to the current owner. Follow the existing member-row + `Card`/`CardHead` pattern already in the file; render, for each member who is not the current user, a small button:

```svelte
				<button
					type="button"
					onclick={() => transferOwnership(member.profile_id)}
					disabled={busy === member.profile_id}
					class="rounded-md border border-paper-edge px-2 py-1 text-xs font-medium text-ink-mute hover:text-ink disabled:opacity-40"
				>
					Make owner
				</button>
```

Gate the button's visibility on the current user being the owner (derive from `api.whoami()` / the loaded `members`+`roles` — the file already loads roles/members; add a `$derived` `isOwner` from whoami's role or the member's role chips). Match the file's existing role-chip/derivation style; the `member.profile_id` field is on the `Member` type used elsewhere in the file.

- [ ] **Step 3: Validate** — svelte-autofixer until clean; `bun run --filter @seiki/admin check` (0 errors); `./node_modules/.bin/prettier --check apps/admin/src/routes/(app)/organization/+page.svelte` (--write if needed).

- [ ] **Step 4: Commit**

```bash
git add "apps/admin/src/routes/(app)/organization/+page.svelte"
git commit -m "orgs(seiki): transfer-ownership action on the Organization screen"
```

---

### Task 8: Full verification + land

**Files:** none

- [ ] **Step 1: Gateway** — `cargo build -p torii-gateway` (compiles) and `cargo test -p torii-gateway slug_tests` (passes). If the repo has gateway integration tests, run `cargo test -p torii-gateway`.
- [ ] **Step 2: DB** — `dbd reset && dbd apply && dbd import` then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/org_onboarding.sql` → `OK M1 org-onboarding`; also re-run `tests/authz.sql` → passes (no regression).
- [ ] **Step 3: Admin** — `bun run --filter @seiki/admin test` (15/15+), `bun run --filter @seiki/admin check` (0 errors), `bun run --filter @seiki/admin build` (✓ done); prettier + eslint clean on every file this plan touched.
- [ ] **Step 4: Manual browser-verify** — from a tenant-less session (a fresh magic-link user whose domain matches no tenant): land on `/onboarding` → create an org → refresh → `/` as owner with a working shell (all admin screens load, no 403 storm). Then: Organization screen → "Make owner" on a second member → confirm → you become admin (owner-only controls disappear), the other user is owner.
- [ ] **Step 5: Prod grant cleanup** — after deploy, confirm the `rework_admin_grants.sql` after-script ran (or run the DELETE once against prod) so any pre-existing `admin` default no longer holds `role.manage`/`apikey.manage`.
- [ ] **Step 6: Land** — after Steps 1-4 are green and a human has confirmed Step 4: `git push origin develop` then `git push origin develop:main`.

---

## Self-Review

**Spec coverage:** orgs/create (Task 3) ✓ · budget org-root seeded in create (Task 3, fail-closed dep) ✓ · single-membership guard (Task 3) ✓ · transfer-ownership owner-gated + atomic + audited (Task 4) ✓ · owner=all / admin=all−3 grants (Task 1, corrected to edit-not-seed) ✓ · one-owner invariant (Task 2) ✓ · post-create refreshSession (Tasks 5/6) ✓ · onboarding replaces no-org (Task 6) ✓ · transfer UI (Task 7) ✓ · `/onboarding` public rule (Task 6) ✓ · tests: DB grant/singularity + slug unit + manual (Tasks 1/3/8) ✓ · M2 deferrals untouched ✓.

**Placeholder scan:** no TBD/TODO. Two spots flag an implementation choice explicitly rather than leaving a gap: Task 2 (partial-index vs trigger — subquery-in-predicate is not portable, so a trigger fallback is given with the same test asserting the invariant either way) and Task 7 Step 2 (the owner-visibility derivation is described against the file's existing role/member state rather than reprinting the whole 200-line screen — the button code itself is complete).

**Type/name consistency:** `orgs_create`/`orgs_transfer_ownership` handlers ↔ `/orgs/create`/`/orgs/transfer-ownership` routes ↔ `api.createOrg`/`api.transferOwnership`; `authorize`/`audit`/`slugify` match `rpc.rs`; `refreshSession` added in Task 5 and used in Tasks 6 & 7; `postAuthDestination` still governs the callback's home-vs-else branch (Task 6). `member.profile_id` matches the `Member` type used by the existing assign/unassign handlers.
