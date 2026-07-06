# W3 · Playground & retrieval lab

**Plane:** Web · **Status:** Planned · **Depends on:** W4, C5, C1

## Purpose

The "show by example" surface — demonstrate the controls (retrieval, guardrails, fallback, cost/quality) interactively. The extended concept carried from the old system.

## What we build

- **Retrieval-mode selector** (dense / hybrid / contextual / RAPTOR / GraphRAG / ColBERT / SQL-RAG) + **hybrid weight slider** + **rerank-model picker** + **chunking-strategy selector** (gap analysis §3).
- **Pipeline toggles**: guardrails, citations, reranking, auto-tune, context retention.
- **Retrieval inspector** (retrieved chunks, scores, reranked/dropped) generalizing the live trace; **live meters** (grounding, quality, cost, latency).
- **Model compare** (2–4 models/pipelines side-by-side) with an optional quality-judge.
- **Promote-to-space-default** (admin/space-owner gated); member edits are session-only otherwise.
- Local-vs-cloud indicator on the model picker (desktop).

## UI surfaces

Playground route (member tool; some controls admin-gated).

## Reuse / source

`docs/mockups/components/pg-rag.jsx`, `pg-ask.jsx`, `tweaks-panel.jsx`; `strategos_old` compare/judge.

## Open questions

- Session-only vs persisted experiments; compare as its own screen; which advanced modes exposed.
