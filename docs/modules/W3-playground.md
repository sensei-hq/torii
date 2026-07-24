# W3 · Playground & retrieval lab

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Web · **Status:** Planned · **Depends on:** W4, C5, C1 (gating via W1 permission matrix + feature governance)

## Purpose

The "show by example" surface — demonstrate the controls (retrieval, guardrails, fallback, cost/quality) interactively. The extended concept carried from the old system.

## What we build

- **Retrieval-mode selector** — the full §3a composable set, selectable per space: classic/BM25 · dense · hybrid fusion · contextual · RAPTOR · GraphRAG · multi-vector/ColBERT · SQL-RAG/text-to-SQL · agentic — plus a **hybrid weight slider**, a **rerank-model picker** (cross-encoder rerank is a **C5 service**, not in-engine — the crate's `TextRerank` is still an `Unsupported` variant), and a **semantic/structure-aware chunking-strategy selector**. The §3a **default stack** (markdown-first → semantic chunking → contextual + hybrid → cross-encoder rerank → grounded generation with citations) is the shown baseline. **SQL-RAG** mode is the surface for **sensitive-structured-data compute-without-exposing** (§3c: schema-to-LLM, execute-in-app).
- **Pipeline toggles**: guardrails, citations, reranking, auto-tune, context retention (guardrails = the C4 governance wrapper incl. **secret/PII redaction/DLP**, §2 W5).
- **Retrieval inspector** (retrieved chunks, scores, reranked/dropped) generalizing the live trace; **live meters** (grounding, quality, cost, latency) — all backed by the **`quality_signals` store (§3b)**, keyed to `inference_calls`/`messages`, streamed to the O1 audit ledger and rolled into O2 analytics (signals contract proposed to live in new module **C6**).
- **Model compare** (2–4 models/pipelines side-by-side) with an optional **quality-judge** (LLM-as-judge quality score) and **auto-tune-prompt** — also §3b quality signals.
- **Promote-to-space-default** — gated by the **permission matrix** + **feature governance** (§1.4 / §4), written via the **gateway-mediated write path** (§2 W1; per-space retrieval/chunking config is a privileged, `service_role`-write field on `spaces`/`settings`, not a direct client write); member experiments are **session-only** otherwise.
- Local-vs-cloud indicator (execution-location badge, §6) on the model picker (desktop).

## UI surfaces

Playground route (member tool; some controls admin-gated).

## Reuse / source

**Canonical (§6):** `docs/mockups/app/view-playground.jsx` (pipeline layers + inspector + meters) and `app/view-ask.jsx` (Ask meters). The `docs/mockups/components/pg-rag.jsx` / `pg-ask.jsx` / `tweaks-panel.jsx` are the **W5 marketing-app showcase** versions — **reference-only**, not canonical. `strategos_old` compare/judge for the model-compare + quality-judge surfaces.

## Open questions

- **Resolved by §3a:** member experiments are **session-only**; admins/space-owners **promote** defaults; **all** §3a retrieval modes are selectable per space (feature-governed).
- **Still open (designer):** model-compare as its own screen vs an inline panel; how session-only experiment runs surface in `quality_signals` (logged as real `inference_calls` vs ephemeral).
