# W1 · Admin Portal

**Plane:** Web · **Status:** Planned · **Depends on:** W4, F2, C1–C5 · **Domain:** `admin.strategos.sensei-hq.com`

## Purpose
The tenant & gateway administration web app — where admins configure everything the gateway enforces.

## What we build (SvelteKit + Rokkit → Cloudflare Pages)
- **Existing mockup screens**: Overview, Requests & audit, Members & roles, Onboarding (SSO/SCIM), Models, Routing, Connections, Governance, Budgets & billing, Settings (workspace defaults).
- **Make read-only screens editable** (gap analysis §4): Connections (connect/rotate/revoke), Routing (chain editor), Models (add/enable, pricing), Governance (scheme/masking/retention editors).
- **New admin surfaces** (gap analysis §5): Device fleet (O3), Feature management (O3), Spaces & knowledge base (C5 defaults), model/provider catalog editing, alerts & notifications, programmatic API keys (if decision #2).
- Per-role/per-space **model & tier allow-lists**; the 3-level control model (workspace default → space override → user preference).

## UI surfaces
The whole admin app.

## Reuse / source
`docs/mockups/app/admin.jsx` + view-*; Rokkit (W4).

## Open questions
- Which admin editors are v1 vs later; custom roles (decision #4); programmatic API (decision #2).
