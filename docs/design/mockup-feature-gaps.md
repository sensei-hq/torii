# Strategos — Mockup Feature-Gap Analysis

> Purpose: a screen-by-screen list of **UI-impacting features** to add or refine in the mockups,
> derived from (a) the agreed architecture, (b) the richer feature set in the old `Old/` system,
> and (c) modern RAG/document techniques. Use this to refine `docs/mockups/`.
>
> **Architecture recap (the lens for every gap below):**
>
> - **Split-plane.** A central Rust gateway (Axum + `gateway` crate) is the authority for all **cloud (BYOK)** calls — keys never leave the server, budgets/audit/residency/governance enforced centrally. The **Tauri desktop app** embeds `gateway-embedded` for **local** inference/embeddings/reasoning and proxies cloud steps to the central gateway.
> - **Two clients, one brain.** Member Console runs as **web (cloud-only)** and **desktop (cloud + local models + offline)**. Admin Portal is web. Fallback chains can span both planes.
> - **Backend:** Supabase (Auth/SSO, Postgres+RLS per tenant, Storage, Realtime for config push), Cloudflare Pages for web/site.
> - **Three control levels:** workspace default (admin) → space override (space owner) → user preference (member, only where admin allows).

Legend: **[M]** Member Console · **[A]** Admin Portal · **[D]** desktop-only · **[NEW]** screen/section not in mockups yet · **(admin-managed)** / **(user)** / **(space)** = who owns the control.

---

## 1. Cross-cutting gaps (affect many screens)

1. **Execution-location awareness (local vs cloud).** The split-plane is invisible in the UI today (only the rail footer hints "all on-device embeddings"). Everywhere a call runs, show **where**: a small badge "ran on your device" vs "via gateway · eu-west-2", local/cloud icon on served-model cells, and on the Models screen mark which models are **local-capable on this device**. _Touches: Ask, Playground, Activity/Requests, Models, Routing._
2. **Desktop vs web capability surfacing.** Web can't run local models. Surface this honestly: a **"Local models" availability indicator** (desktop only), an **offline-mode banner** ("cloud unreachable — local models still work"), and graceful "this feature needs the desktop app" states on web. _Touches: shell/chrome, Workspace, Ask, Playground, Models._
3. **Device & sync status.** Desktop app needs: connection/sync state ("synced · config v412"), offline buffer state ("3 calls queued to report"), and a model-storage indicator. _Touches: shell footer, Settings._
4. **Feature governance (the user-vs-admin question).** Today toggles just exist. Add the concept that **admins decide which controls members see and whether a member may override them** — i.e. a per-feature state of `locked / default-on / default-off / user-overridable` (this is the old system's `UiFeature` + `UiFeatureState` model). Drives a new Admin **Feature management** screen (§5) and changes how member toggles render (some shown as locked).
5. **Space-level policy layer.** Governance text already says "unless a space overrides them," but there's no UI for it. Space owners need a **space settings** surface (classification default, allowed models/tiers, retrieval/chunking defaults, masking, retention). _Touches: Library (space settings), new Admin Spaces screen._

---

## 2. Control-ownership matrix (which controls are user vs admin)

| Control                                                    | Today                                       | Recommended owner                                                                                           | Where it lives                                  |
| ---------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| PII & tenant masking                                       | admin toggle                                | **admin (workspace) + space override**; never user-disengageable                                            | Admin Settings, Space settings                  |
| Automatic fallback                                         | admin toggle                                | **admin**; user cannot disable                                                                              | Admin Settings, Routing                         |
| Grounded-only answers                                      | playground toggle (member)                  | **admin default**, space override; member sees state, can't loosen below policy                             | Admin/Space; read-only in Playground            |
| Reranking / retrieval mode / chunking                      | playground toggles (member)                 | **admin/space default**; member may experiment **session-only** in Playground, cannot change space defaults | Space settings (set) · Playground (experiment)  |
| Citations on/off                                           | playground + personal "always show sources" | **user preference** (within admin floor)                                                                    | Member Settings, Playground                     |
| Context retention                                          | playground toggle (member)                  | **user preference**                                                                                         | Member Settings, Playground                     |
| Auto-tune prompt                                           | playground toggle (member)                  | **user preference**                                                                                         | Playground                                      |
| Weekly digest / theme / autosave drafts                    | member toggles                              | **user**                                                                                                    | Member Settings                                 |
| Anomaly alerts / telemetry                                 | admin toggles                               | **admin**                                                                                                   | Admin Settings                                  |
| SIEM streaming                                             | admin toggle                                | **admin (owner)**                                                                                           | Governance                                      |
| Allowed models / tiers per role/space                      | — (missing)                                 | **admin/space**                                                                                             | New: Model access policy (§4 Models, §5 Spaces) |
| Budget caps & period & hard/soft                           | admin (period only)                         | **admin**; cascade org→dept→team→user                                                                       | Organization, Billing                           |
| Local-model download / enable on device                    | — (missing)                                 | **user on device, within admin allow-list**                                                                 | New: Local models (§5)                          |
| Which routers' keys may run device-local vs server-proxied | — (missing)                                 | **admin**                                                                                                   | Connections                                     |

---

## 3. Document & RAG approaches to support (and their UI footprint)

The current Library/Playground model is "upload → normalize to md/csv/json/images → 4 retrieval levels." That's a good skeleton; here is the fuller menu the product should support, and what each adds to the UI.

### 3a. Ingestion & layout-aware extraction

Parse DOCX/PDF/PPTX/XLSX into **markdown-first** content, separating **prose / tables / images / figures**:

- prose → markdown sections (heading hierarchy preserved),
- tables → markdown table **and** CSV (so they're queryable, not flattened into prose),
- images/figures → extracted files + auto-caption + alt text,
- formulas/code → fenced blocks.
- (Reference-class tools/approaches: Docling, Marker, Unstructured, LlamaParse-style layout models; OCR fallback for scans.)

**UI impact:** ingestion-pipeline **status per document** (queued → parsing → chunking → embedding → ready/failed); a **"Stored as / extracted assets" browser** (the md, the table CSVs, the image gallery) — extends the current "norm chips"; a **re-process** action and a **parse-quality** indicator; per-file **parser/profile** choice (admin/space default).

### 3b. Chunking strategies (replace "simple chunking")

Offer, as **admin/space-level** strategy (member sees it, experiments in Playground):

- recursive/structural (by heading/section), **paragraph-level**, **sentence-window**, **semantic** (embedding-boundary), **proposition** (atomic facts), **parent-document** (retrieve small, return parent), **late chunking** (embed full doc, then split), and **layout/content-aware** (tables and figures as their own units).

**UI impact:** a **chunking-strategy selector** + params (size/overlap/window) at space level; a **chunk inspector** in Playground/Library showing how a doc was split and which chunks matched.

### 3c. Retrieval modes (efficiency + accuracy)

Expand the Playground's 4 "pipeline layers" into a richer, composable set:

- **dense** (vector) · **sparse/BM25** · **hybrid** (dense+sparse with a weight) — _hybrid is the baseline sweet spot_,
- **cross-encoder reranking** (already a toggle) with a **rerank-model picker**,
- **contextual retrieval** (prepend per-chunk context before embedding + BM25) — big recall win, low complexity,
- **query transforms**: rewriting, decomposition (multi-hop), **HyDE**,
- **multi-vector / late-interaction (ColBERT-style)** — higher accuracy, more storage,
- **RAPTOR** (hierarchical summary tree) for long-doc/global questions,
- **GraphRAG** (entity/relation graph) for "connect the dots" queries,
- **SQL-RAG / text-to-SQL** (already a level) for structured/analytical questions,
- **agentic RAG** (retrieve → reason → re-retrieve loop).

**Recommended default stack:** markdown-first parse → structure/semantic chunking → **contextual retrieval + hybrid (dense+BM25)** → **cross-encoder rerank** → grounded generation with citations. RAPTOR / GraphRAG / ColBERT / SQL-RAG as **advanced modes** selectable per space.

**UI impact:** retrieval-mode **selector** + hybrid weight **slider** + rerank-model **picker** in Playground and Space settings; a **retrieval inspector** (retrieved chunks, scores, what was reranked/dropped) — generalizes today's "live trace"; the live meters stay (grounding/quality/cost/latency) and gain a **recall@k / context-precision** read.

### 3d. Document organization & management — beyond RAG

The user explicitly wants cloud doc management beyond retrieval. Add:

- **Collections / folders / tags** within a space; **versions** (re-upload = new version, keep history); **dedup & lineage** (this md/csv/image came from that source); **bulk actions** (reclassify, move, re-process, delete); **document preview** (rendered markdown, table-as-data grid, image gallery) — not just "open".
- **Cloud tenant storage** of normalized artifacts (md + images + CSV/markdown tables) in Supabase Storage, scoped by tenant/space/access-group, with the originals.
- **Structured-data surface:** extracted tables become **queryable datasets** (feeds SQL-RAG and a future "ask the spreadsheet").

**UI impact:** Library becomes a real **document workspace** (collections sidebar, version history, lineage, preview pane, bulk toolbar) and a new Admin **Spaces & knowledge base** screen for ingestion/chunking/retrieval defaults and storage/quotas (§5).

---

## 4. Screen-by-screen UI gaps

### MEMBER CONSOLE

**Workspace / Home [M]**

- Add **local/offline status** chip [D] and "X models on device" quick state.
- "Pick up where you left off" should include **in-progress ingestions** and **failed uploads** needing attention.
- Quick actions: add **"Run a saved prompt/template"** (ties to template library, §5).

**Ask [M]**

- **Execution badge** per answer: ran locally vs via gateway; which model/tier; cost (0 for local).
- **Model/tier hint** the user is allowed to pick (within admin allow-list) — today model choice is invisible on Ask.
- **Multi-source / multi-space ask** (currently single space) and **citation → open document at chunk** (deep-link into Library preview).
- **Offline state** [D]: "cloud models unavailable — answering with local model."
- "Draft saved to space" exists — add **template selection** for Draft and **classification picker** on save.

**Library [M] — biggest expansion**

- **Collections/folders + tags** inside a space; **version history**; **lineage** (source → md/csv/images).
- **Extracted-assets browser** (md, table CSVs as a data grid, image gallery) — beyond today's "norm chips".
- **Ingestion status** per item (parsing/chunking/embedding/ready/failed) + **re-process** + **parse-quality**.
- **Document preview pane** (rendered md / table data / images), not just "Open".
- **Bulk toolbar** (reclassify, move, tag, re-process, delete) and **multi-select**.
- **Space settings** entry (space owner): default classification, allowed models/tiers, chunking/retrieval defaults, masking, retention (the **space override** layer).
- **Storage/qudota** indicator per space.

**Playground [M]**

- Expand **pipeline layers** → full **retrieval-mode** set (§3c) + **hybrid weight slider** + **rerank-model picker** + **chunking-strategy** selector.
- **Retrieval inspector** (retrieved chunks, scores, dropped-by-rerank) — generalize the trace.
- **Model compare** here or as its own screen (run 2–4 models/pipelines side-by-side; old system's "mixologist/compare") with a **quality-judge** toggle.
- **"Promote to space default"** action (gated: space owner/admin) so experiments can become policy — and make clear that member changes are **session-only** otherwise.
- **Local-vs-cloud** indicator on the model picker [D].

**Activity (Requests, member) [M]**

- Add **execution-location** column (local/cloud) and **offline-queued** state for calls awaiting report.
- **Filters** (by space, task, outcome, date) — today it's a flat list.
- Member spend should reconcile with server (note "pending sync").

**Settings (personal) [M]**

- Add **theme = light/dark/system** (today only "match system"), **default model/tier preference** (within allow-list), **citation density**, **context-retention default**, **auto-tune default**, **language/locale**.
- [D] **Local models**: manage downloads, storage path, GC (or link to the new Local Models screen, §5).
- Show **which preferences are locked by admin** (greyed with a tooltip).

### ADMIN PORTAL

**Overview [A]**

- Add **plane split** to stats: cloud vs local call mix, **local savings**, offline/at-risk devices.
- **Health** should include **device fleet** summary and **ingestion queue** health.
- Anomaly/alert surface (budget breach, outage, policy hits) as actionable cards.

**Requests & audit [A]**

- **Filters/search** (user, space, model, route, outcome, date, policy-hit) and **saved views**.
- **Execution-location** + **device** columns; **policy-hit drill-down** (what was masked/blocked).
- Link audit entries to the **immutable ledger** detail.

**Members & roles (Organization) [A]**

- **Custom roles / permission matrix** (today 4 fixed roles) — granular capability grants.
- **Per-role/per-space model & tier allow-lists** (model access policy).
- **Service accounts / API identities** management (for programmatic access, §5).
- Bulk invite by domain; seat usage vs license (ties to Billing).

**Onboarding [A]** _(new screen — good start)_

- Make each checklist step open its **real sub-flow** (org identity, SSO, residency, connect router, budgets, invite).
- Add **device-rollout** step (distribute desktop app / enrollment) and **knowledge-base/space setup** step.

**Models [A]**

- **Add/edit custom model & endpoint** (api_model_id, pricing, context, capabilities) — today it's read-only catalog.
- **Enable/disable per tenant/space/role**; mark **local-capable** models and **device availability**.
- **Capability + pricing** editing; **pull/refresh from router**; "verified" state (old system's capability learning).

**Routing [A]**

- **Chain editor** (create/reorder/add steps, set trigger rules, per-step model/router) — today it's a read-only simulator.
- **Multiple named chains per capability** (chat, generate, cheap, local, demo) and **which chain a space/role uses**.
- **Per-step plane** (local vs cloud) and **per-router device-local vs server-proxied** policy.
- Editable **routing policy** (retry/timeout/region/health) — currently read-only.

**Connections [A]**

- **Add/connect router** real flow (enter key → validate → store in vault); **rotate/revoke**; **key health/expiry**.
- **Per-router scope**: which spaces/roles may use it; **device-local vs server-proxied** toggle (the custody lever).
- **Custom/OpenAI-compatible** router add; **regional endpoint** config.

**Governance [A]**

- **Classification scheme editor** (rename/add levels, set rules per level) — today static.
- **Masking policy editor** (PII types, jailbreak filters, grounded-only) per workspace/space.
- **Retention policy editor** per artifact type; **legal hold**; **export/erase (DSR)** actions.
- **Assign owners** to the "12 unowned items"; **review scheduling**.

**Budgets & billing [A]** _(new screen — good start)_

- **Hard vs soft caps** + **alert thresholds** per node; **free-floor enable** per scope.
- **Per-model / per-provider cost breakdown**; **export usage**; **overage rules**.
- **Seat management** (assign/reclaim licenses) tied to Members.

**Settings (workspace defaults) [A]**

- Becomes the **default layer** of the 3-level model; add **default chunking/retrieval/embedding model**, **default classification**, **default chain**, **data-region**, **default allowed tiers**.

---

## 5. New screens to add (missing entirely)

- **[NEW][M][D] Local models & downloads** — browse available local models (GGUF/ONNX), download/update/remove, storage usage + GC, set local default, see device hardware/capability (the `gateway-embedded` registry surfaced).
- **[NEW][M] Document / asset viewer** — rendered markdown, **tables as a data grid**, **image gallery**, chunk overlay, version/lineage. (Could be Library's preview pane rather than a route.)
- **[NEW][M] Compare** — multi-model / multi-pipeline side-by-side with optional quality-judge (old "mixologist").
- **[NEW][A] Device fleet management** — enrolled devices, last-seen, app/config version, **revoke device** (kills its access), per-device key-sync policy, offline buffer health.
- **[NEW][A] Feature management** — the toggle-governance surface: per feature/module set `locked / default / user-overridable`, per role/space; mirrors old `UiModule`/`UiFeature`/`UiFeatureState`.
- **[NEW][A] Spaces & knowledge base** — all spaces, ingestion-pipeline defaults, chunking/retrieval/embedding model per space, storage/quotas, re-index, orphan/dup cleanup.
- **[NEW][A] Tools & MCP servers** — register MCP servers (stdio for desktop, http/sse for shared) and tool allow-lists per role/space (old system had MCP + tools; mockups dropped it). _Decision: in scope for v1?_
- **[NEW][A] Prompt / template library** — shared prompts/templates for Ask "Draft" and saved workflows; versioned, per-space.
- **[NEW][A] Alerts & notifications** — channels (email/Slack/webhook/SIEM) and rules (budget breach, outage, policy hit, anomaly).
- **[NEW][A] Programmatic access / API keys** — if external apps call the gateway, issue scoped tenant API keys + usage. _Decision: is the gateway also a programmable endpoint for the org's own apps, or only the two first-party clients?_

---

## 6. Suggested order for refining the mockups

1. **Cross-cutting** (execution-location badges, desktop/offline states, device/sync chips) — cheap, high signal, touches everything.
2. **Library → document workspace** (collections, versions, extracted-assets browser, ingestion status, preview) + **Space settings**.
3. **Playground** retrieval-mode expansion + inspector + promote-to-default.
4. **Admin editors** that are currently read-only: Connections (connect/rotate), Routing (chain editor), Models (add/enable), Governance (scheme/masking/retention).
5. **New screens**: Local models, Device fleet, Feature management, Spaces & KB.
6. **Decisions to settle while refining:** (a) MCP/tools in v1? (b) programmatic API access for org apps? (c) agents/plans (old system had ReAct agents + DAG plans) — in scope or later? (d) custom roles vs fixed four?

---

_Next step after mockups are refined: fold the agreed feature set into the north-star requirements + architecture doc, then per-module specs._
