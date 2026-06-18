# O1 · Request ledger, audit & SIEM

**Plane:** Ops · **Status:** Planned · **Depends on:** C1, C4

## Purpose
A unified, trustworthy record of every call and every governance event — across both planes.

## What we build
- **Request ledger** from `GatewayStore` (C1) covering cloud calls and device-reported local calls; each row carries served model, route, **execution location**, tokens, cost, outcome, and a **"why this model"** trace.
- **Immutable audit log** (config changes, access, exports, sign-ins, policy hits) emitted by C4.
- **SIEM streaming** connector; **CSV export**; filters/search and saved views.

## UI surfaces
- Requests & audit (W1), Activity (W2).

## Reuse / source
`gateway` trace/`GatewayStore`; `database/` audit + `gateway_task(_logs)`; gap analysis §4.

## Open questions
- Retention windows per artifact; SIEM connector format (syslog/HTTP/vendor).
