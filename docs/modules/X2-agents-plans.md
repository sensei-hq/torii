# X2 · Agents & plans _(pending decision #3)_

**Plane:** Pending · **Status:** Decision needed · **Depends on:** C1, C5, X1 (tools)

## Purpose

Multi-step automation — ReAct agents and DAG task plans with human-in-the-loop approval. A major capability in the old system; not in the current mockups.

## What we'd build (if in scope)

- **ReAct agent loop** (reason → tool → observe) with step tracking.
- **Plans**: a DAG of `planned_tasks` with dependencies, parallel groups, and per-task model/cost tracking.
- **HITL**: approval requests for sensitive tool calls.

## Reuse / source

`strategos_old` `agents` package (coordinator, plan/task tracking, HITL); `database/` `plans` / `planned_tasks` / `planned_task_interactions`.

## Decision

**In v1, or later?** (open decision #3). Likely **later** — depends on X1 (tools). If deferred, omit the plan/task tables from the F1 v1 cut.
