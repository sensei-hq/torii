# W1 · Admin Portal

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Web · **Status:** Planned · **Depends on:** W4, F2, F3, C1–C5, O3, X1 · **Domain:** `seiki.sensei-hq.com`

## Purpose

The tenant & gateway administration web app — where admins configure everything the gateway enforces. **Every privileged write goes through the gateway (or a thin authz API) that enforces the permission matrix server-side** — no direct PostgREST writes to privileged tables (roles, budgets, routing chains, governance/classification, `space_members`, catalog overrides). See DECISIONS §2 W1.

## What we build (SvelteKit + Rokkit → Cloudflare Pages)

- **Existing mockup screens**: Overview, Requests & audit, Organization (Members & roles), Onboarding (SSO/SCIM), Models, Routing, Connections, Governance, Budgets & billing, Settings (workspace defaults).
- **Organization owns identity + the single budget tree + programmatic access** (§1.2): the org→dept→team→user hierarchy drives **both** the budget cascade and permissions; the Organization screen hosts the IdP/SCIM directory import, people→teams, the budget tree, and **API keys & service accounts (moved here from Billing)**. `api_keys` authenticate an **identity** — a person or a `service_account` (its own hierarchy leaf, `kind='service'`) — with a hashed secret + public prefix, capability scope, rate-limit, rotate/revoke, and **reveal-once** issuance. **No budget attaches to a key**: budget binds to the caller's identity/node; multiple keys for one identity share that identity's budget (§2 W2).
- **Roles & permission matrix** (§1.4): a new **permission-matrix screen** over `roles`/`role_permissions`/`profile_roles`, replacing the built fixed role enum. Reconcile the three divergent mockup role vocabularies into this one model.
- **Make read-only screens editable** (gap analysis §4): Connections (connect/rotate/revoke, **plus OAuth connect for Anthropic-style accounts alongside paste-a-key**, backed by F3 `router_credentials` `type=api_key|oauth`), Routing (chain editor), Models (add/enable + per-tenant/space/role catalog **overrides** + pricing), Governance (scheme/masking/retention editors **+ secret/PII redaction/DLP config**, §2 W5). Classification stays fixed at 4 levels — Governance may relabel display names, not change the set (§4).
- **New admin surfaces** (gap analysis §5, §6):
  - **Tools & MCP** (X1) — register `mcp_servers`, edit per-(role×space) tool allow-lists; the gateway enforces at tool-call time (SSRF-filter http/sse, sandbox stdio).
  - **Spaces & knowledge base** (C5) — space membership + fixed 4-level classification ACL (the recursive group-ACL is retired, §3); per-space retrieval/chunking defaults; column-sensitivity + allowed-operations policy for sensitive structured data (§3c).
  - **Feature management** — 4-state governance (`locked`/`default-on`/`default-off`/`user-overridable`), precedence workspace→space→role→user (§4).
  - **Device fleet** (O3), **Alerts & notifications** (`alert_rules`/`notification_channels`/`alert_events`), **Prompt/template library**, **Local models `[desktop]`**.
- **Budgets & billing** keeps the spend tree + invoices/licence summary but hands API-keys/service-accounts to Organization; client-facing metering is read-only, backed by the hard-reserve cascade over the single `inference_calls` ledger (§2 W2, §3).

## UI surfaces

The whole admin app.

## Reuse / source

`docs/mockups/app/admin.jsx` + `view-organization/connections/routing/models/governance/billing/onboarding/overview/requests`; Rokkit (W4).

## Open questions

- **Resolved by DECISIONS:** custom roles → full permission matrix in v1 (§1.4); programmatic API → API keys + service accounts in v1, owned by Organization (§1.2); which editors ship → the four read-only editors all become editable in v1 (§4/§6).
- **Residual (builder):** permission-matrix cell granularity (which capabilities are role-gated, and how role narrowing composes with space/user layers); how the admin app authenticates to the gateway authz API for privileged writes.
