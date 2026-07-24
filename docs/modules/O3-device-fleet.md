# O3 · Device fleet & feature governance

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Ops · **Status:** Planned · **Depends on:** F2, D4

## Purpose

Manage enrolled desktop devices and govern which features members see — the admin side of the split-plane and the feature-toggle question.

## What we build

- **Device fleet**: enrolled devices, `devices.last_seen`, app/config version, **offline-buffer health** (usage/audit buffers are signed + idempotent — anti-replay / anti-under-report), **revoke device** (cuts its access via F2). A **per-request device-status check on the C1 proxy hot path** ensures a revoked device with a still-live JWT cannot keep spending.
- **Feature governance**: per feature/module a **4-state** value — `locked` / `default-on` / `default-off` / `user-overridable` — with precedence **workspace → space → role → user** (admin workspace default; space owner overrides within it; role narrows inside the space; user preference applies last, only where `user-overridable`). Reworks the old `modules`/`features`/`feature_states` model: `feature_states` gains **`tenant_id` + RLS and revokes anon writes**, and a new **`user_preferences`** table backs the user layer. Drives which member toggles render (and which render locked).

## UI surfaces

- New **Device fleet** and **Feature management** screens (W1).

## Reuse / source

`strategos_old` `UiModule`/`UiFeature`/`UiFeatureState`; `database/` `modules`/`features`/`feature_states`; F2 device enrollment; gap analysis §1.4 + §5; DECISIONS §4 (4-state governance + workspace→space→role→user precedence), §2 (device-status hot-path check, `feature_states` `tenant_id`+RLS + revoke anon writes, signed/idempotent offline buffers).

## Open questions

- Per-feature vs per-module granularity of the governance state; how the workspace-level defaults seed on tenant creation. _(Precedence is resolved: workspace → space → role → user.)_
