# X2 · Agents & plans

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Cross-cutting (X) · **Status:** Design-only in v1 (runtime v2) · **Depends on (v1, design):** the W Workflows / agent-builder screens · **Depends on (v2, runtime):** C1, C5, X1

## Purpose

Multi-step automation — ReAct agents and DAG task plans with human-in-the-loop approval. A major capability in the old system. **In v1 this is design-only:** the **Workflows** (`view-workflows.jsx`) and **agent-builder** (`view-workflows-builder.jsx`) screens **already exist in the current mockups** — this corrects the earlier "not in the current mockups" claim. The agent **runtime** ships in v2 and powers the v2 collaborative document editing (§3a) and the interaction-intelligence go-between (§3b).

## What we build

- **v1 (design-only):** keep + own the **Workflows** + **agent-builder** mockup screens; **no** runtime tables (**no** `plans` / `planned_tasks` / `planned_task_interactions` in the F1 v1 cut).
- **v2 (runtime):** **ReAct agent loop** (reason → tool → observe) with step tracking; **Plans** — a DAG of `planned_tasks` with dependencies, parallel groups, per-task model/cost tracking; **HITL** approval requests for sensitive tool calls; the agent runtime that also drives **collaborative document editing** (§3a) and the **interaction-intelligence go-between** (§3b).

## Reuse / source

Mockups `view-workflows.jsx` + `view-workflows-builder.jsx` (v1 design). `strategos_old` `agents` package (coordinator, plan/task tracking, HITL) and `database/` `plans` / `planned_tasks` / `planned_task_interactions` inform the **v2** runtime — these tables are **not** in the v1 cut.

## Decision

**RESOLVED — design-only in v1, runtime in v2** (DECISIONS §1.3). The Workflows + agent-builder screens are kept and assigned to X2; **no** runtime plan/task tables in the v1 cut. The v2 agent runtime also powers collaborative document editing (§3a) and the interaction-intelligence go-between (§3b).
