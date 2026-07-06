# W2 · Member Console

**Plane:** Web · **Status:** Planned · **Depends on:** W4, C1, C3, C5 · **Domain:** `app.strategos.sensei-hq.com` (+ reused in desktop D1)

## Purpose

The member-facing workspace — ask, library, activity — served on web (cloud-only) and reused inside the desktop app (cloud + local).

## What we build (SvelteKit + Rokkit)

- **Screens**: Workspace/Home, Ask, Library (document workspace), Activity, personal Settings.
- **Library → document workspace** (gap analysis §4): collections/tags, versions, lineage, extracted-asset browser (md / tables-as-grid / image gallery), ingestion status, preview pane, bulk actions, space settings.
- **Ask**: execution-location badge per answer, allowed model/tier hint, multi-space ask, citation→open-at-chunk, draft templates.
- **Cross-client awareness**: cloud-only on web; cloud+local + offline states on desktop; "needs the desktop app" affordances for local features.

## UI surfaces

The whole member app (shared with desktop).

## Reuse / source

`docs/mockups/app/app.jsx` + view-workspace/ask/library; Rokkit (W4).

## Open questions

- Which screens are shared verbatim with desktop vs desktop-only (Local models).
- How preference locking (admin-managed) renders.
