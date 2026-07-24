# C4 · Governance runtime

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Central · **Status:** Planned · **Depends on:** C1

## Purpose

Enforce policy on every call — masking, grounding, confidentiality — and produce the explainable trace + audit events that make the gateway trustworthy.

## Responsibilities

- Wrap the crate's `execute` / `execute_stream` **consumer-side** (the `sensei-*` engine has **no in-request governance hook** — §3) to run the guardrail pipeline around each call and emit the governance trace + audit.

## What we build

- **Secret/credential + PII redaction/DLP (§2 W5)** — the headline guardrail. Two layers, both **consumer-side**: **(1) redact-at-rest** during **C5 ingestion** (detect + redact secrets/keys/tokens/passwords/PII in the normalized markdown **before embedding**, so the vector store never holds raw secrets — store placeholders; any reversible mapping lives in a `service_role`-only encrypted store); **(2) redact-in-flight** — scan + redact prompts, retrieved context, agent messages, and **MCP tool inputs/outputs** before they egress to any model or tool. Enforced at three points: C5 ingestion, **C1/C4 inference**, **X1 tool egress**. Detectors are **vetted libraries** (high-recall secret scanners: API-key/token patterns + entropy) + PII classifiers — **not hand-rolled regex**. Every redaction is a quality/audit signal (§3b).
- **PII & tenant masking** on input and output (secure-by-default), and **classification enforcement** — respect the fixed 4-level scheme (`public`/`internal`/`confidential`/`restricted`) + space membership; mask for non-members. ACL = **space + classification only**; the group-ACL tables are **retired** (§3).
- **Grounded-only** enforcement (answers must cite retrieved context).
- **Jailbreak / prompt-injection filters**.
- **"Why this model" trace** capture (budget check → fallback → guards → served) for the Requests panel — reads the crate's `ChainEntry`/`Attempt` trace (per-step `plane`/execution-location is a **gateway-repo enhancement**, §3).
- **Audit emission** to O1 (immutable ledger, SIEM-streamable) for config changes, access, exports, policy hits; governance application (masking, redaction, grounded-only, classification) also emits **quality signals** to the `quality_signals` store (§3b, proposed **C6**) → O1/O2.
- **Sensitive-structured-data guard (§3c)** — for queryable datasets, the model sees **schema + non-sensitive metadata only**; the app/gateway executes the computation plan inside the trusted boundary (aggregate-only / k-anonymity thresholds), and the result passes the **W5 redaction check** before reaching the model or user. Column sensitivity + allowed operations are space/admin policy.
- A **policy editor** backend so admins/space-owners can tune masking, classification (**display relabel only** — the set is fixed, §4), retention, and per-space redaction/DLP settings.

## Key contracts / data

- Guardrail result (masked/redacted spans, secret/PII hits, policy hits), governance trace, audit event schema, `quality_signals` record (§3b), redaction-mapping entry (`service_role`-only, §2 W5).

## UI surfaces

- Governance (W1 — becomes an **editable** masking/retention/redaction editor, §6), trace panels (W2/W3), Settings/workspace defaults (W1), space settings (W2).

## Reuse / source

The `sensei-*` engine (`v0.4.6`) `Attempt`/`ChainEntry` trace, consumed **around** `execute`/`execute_stream` (no in-engine hook, §3); `database/` audit + classification scheme; vetted secret/PII detector libraries (§2 W5); gap analysis §1/§2. Feature-governance precedence is now **workspace → space → role → user** (4-state), superseding the older 3-level control model (§4).

## Open questions

- ~~Masking engine: regex/dictionary vs ML NER~~ — **resolved (§2 W5):** use **vetted libraries** — high-recall secret scanners (pattern + entropy) **and** PII classifiers; no hand-rolled regex.
- ~~Policy granularity~~ — **resolved (§4):** 4-state feature governance (`locked` / `default-on` / `default-off` / `user-overridable`), precedence **workspace → space → role → user** (role layer added; `user_preferences` for the user layer).
