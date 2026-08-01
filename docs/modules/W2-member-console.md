# W2 · Member Console

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Web · **Status:** Planned · **Depends on:** W4, C1, C3, C4, C5 · **Domain:** `app.torii.sensei-hq.com` (+ reused in desktop D1)

## Purpose

The member-facing workspace — ask, library, activity — served on web (cloud-only) and reused inside the desktop app (cloud + local). This module also **owns the design-only Workflows + agent-builder screens** (§1.3 / X2): they ship as v1 designs under the console's **Tools** nav group; the ReAct/DAG runtime is deferred to v2.

## What we build (SvelteKit + Rokkit)

- **Screens**: Workspace/Home, Ask, Library (document workspace), Playground (authored in W3, hosted here), **Workflows/agents (design-only, X2)**, Activity, personal Settings.
- **Library → document workspace** (§3a): collections/folders/tags, versions, source→artifact lineage, dedup (content hash), extracted-asset browser (md / tables-as-grid / image gallery), chunk inspector, ingestion-status pipeline (queued→parsing→chunking→embedding→ready/failed), preview pane, bulk actions, space settings. **Markdown-first ingestion** of PDF/DOCX/PPTX/XLSX/images always keeps + references the original. Documents carry **ownership at org/space/individual levels** layered on the space+classification ACL (group-ACL retired, §3).
- **Ask**: execution-location badge per answer, "why this model" routing trace, allowed model/tier hint, multi-space ask, citation→open-at-chunk, draft templates. Answers grounded only in accessible docs; retrieved context + messages pass the **W5 redaction/DLP check** (§2 W5) before egress; every call emits **quality signals** (§3b, proposed C6) that back the live meters (grounding/quality/cost/latency).
- **Ask the data (sensitive structured data, §3c)** — design-only / v1-direction surface: query CSV/XLSX-derived **datasets** where the model sees **schema + non-sensitive metadata/aggregates only**, emits a computation plan (text-to-SQL/formula), and the **gateway/app executes it inside the trusted boundary**, returning only aggregate/threshold-gated results; sensitive datasets prefer the on-device plane so raw values never leave the machine.
- **Collaborative editing (design-only in v1, runtime v2 via X2)**: comment threads, suggestion/correction review, a **chat-to-edit panel where an agent performs the edits**, per-doc collaborators (owner/editor/commenter/viewer). Screens designed now; the agent-driven edit runtime ships with X2 in v2 (§3a).
- **Cross-client awareness**: cloud-only on web; cloud+local + offline states on desktop; "needs the desktop app" affordances for local features. **Execution badges** appear throughout (Ask answers, Workflows runs, Activity).
- **Personal Settings**: user preferences (`user_preferences`) render governed toggles per the 4-state model — some shown **locked** where not `user-overridable` (§4). A **budget increase-request** affordance (`budget_requests`) surfaces here / in Activity; client-facing metering is read-only.

## UI surfaces

The whole member app (shared with desktop).

## Reuse / source

`docs/mockups/app/app.jsx` + `view-workspace/ask/library/library-doc/workflows/workflows-builder`; Rokkit (W4).

## Open questions

- **Resolved by DECISIONS:** the design-only Workflows/agent screens keep an owning home (the console **Tools** group, X2); Library is the document workspace (§3a); preference locking renders via the 4-state governance model (§4).
- **Residual (builder):** which screens are shared verbatim with desktop vs desktop-only (Local models); the depth of the "Ask the data" structured-data surface in v1 vs v2; nav labelling for Workflows vs Agents.
