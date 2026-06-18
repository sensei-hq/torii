# C4 · Governance runtime

**Plane:** Central · **Status:** Planned · **Depends on:** C1

## Purpose
Enforce policy on every call — masking, grounding, confidentiality — and produce the explainable trace + audit events that make the gateway trustworthy.

## Responsibilities
- Run the guardrail pipeline in the request path and emit governance trace + audit.

## What we build
- **PII & tenant masking** on input and output (vetted libraries, secure-by-default).
- **Grounded-only** enforcement (answers must cite retrieved context) and **confidentiality enforcement** (respect space/classification; mask for non-members).
- **Jailbreak / prompt-injection filters**.
- **"Why this model" trace** capture (budget check → fallback → guards → served) for the Requests panel.
- **Audit emission** to O1 (immutable ledger, SIEM-streamable) for config changes, access, exports, policy hits.
- A **policy editor** backend so admins/space-owners can tune masking, classification rules, retention.

## Key contracts / data
- Guardrail result (masked spans, policy hits), governance trace, audit event schema.

## UI surfaces
- Governance (W1), trace panels (W2/W3), Settings/workspace defaults (W1), space settings (W2).

## Reuse / source
`gateway` crate `Attempt`/trace; `database/` audit + classification scheme; gap analysis §1/§2 (3-level control model).

## Open questions
- Masking engine: regex/dictionary vs ML NER (or both).
- Policy granularity (workspace default → space override → user preference).
