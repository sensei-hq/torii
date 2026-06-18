# C3 · Budgets, metering & reconciliation

**Plane:** Central · **Status:** Planned · **Depends on:** C1, F1

## Purpose
Enforce spend authoritatively so there are never surprise bills — cascading caps with automatic step-down and a free floor.

## Responsibilities
- Pre-call budget checks, per-call metering, cross-device reconciliation, alerts.

## What we build
- **Budget tree** (org→dept→team→user) with **caps, period (D/W/M), hard vs soft, alert thresholds, free-floor enablement** per node.
- **Pre-call check**: a call is allowed only if every level (user, team, dept, org) has headroom; under pressure the engine's budget filter triggers step-down; at zero it drops to the free floor (local on desktop).
- **Metering** from `GatewayStore` (actual cost/tokens) → spend rollups.
- **Reconciliation** of device-reported local/cloud usage into authoritative totals; push updated remaining via Realtime (D4).
- Optional **synchronous hard-stop** for critical caps.

## Key contracts / data
- Budget node schema; `get_spend_since` / `get_spend_by_model_since` (GatewayStore); usage-report payload (from devices).

## UI surfaces
- Organization (budget hierarchy) + Budgets & billing (W1); spend chips + Activity (W2).

## Reuse / source
`gateway` crate budget filtering; `database/` budget tree; gap analysis §4 (hard/soft caps, alerts).

## Open questions
- Soft (eventually-consistent) vs synchronous hard caps per node.
- Billing/invoice integration (Stripe?) — Billing screen exists in mockups.
