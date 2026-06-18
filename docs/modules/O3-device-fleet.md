# O3 · Device fleet & feature governance

**Plane:** Ops · **Status:** Planned · **Depends on:** F2, D4

## Purpose
Manage enrolled desktop devices and govern which features members see — the admin side of the split-plane and the feature-toggle question.

## What we build
- **Device fleet**: enrolled devices, last-seen, app/config version, offline-buffer health, **revoke device** (cuts its access via F2).
- **Feature governance**: per feature/module a state of `locked / default-on / default-off / user-overridable`, scoped per role/space — the old `modules`/`features`/`feature_states` model. Drives which member toggles render (and which render locked).

## UI surfaces
- New **Device fleet** and **Feature management** screens (W1).

## Reuse / source
`strategos_old` `UiModule`/`UiFeature`/`UiFeatureState`; `database/` `modules`/`features`/`feature_states`; F2 device enrollment; gap analysis §1.4 + §5.

## Open questions
- Feature-flag granularity; per-space vs per-role precedence.
