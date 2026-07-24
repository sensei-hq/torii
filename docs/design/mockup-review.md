# Strategos — Mockup Review & Designer Handoff

> **Living doc.** Design changes so the mockups (`docs/mockups/app/*.jsx`) match the ratified
> [`../DECISIONS.md`](../DECISIONS.md). **Cycle-7 — essentially complete.** Verified 2026-07-23
> (third pass). Only a few minor polish items remain.
>
> **Scope note:** the mock shows the **full designed feature set**; **v1/v2 phasing is managed by
> implementation** (the phase plans / roadmap), *not* by the mockups. So "gate as v2 preview"-type
> asks are intentionally **out of scope** here.

## Ground rules

- **Canonical set:** `app/*.jsx` (member=`app.jsx`, admin=`admin.jsx`). `components/*` = W5 marketing (separate). `_ds/` reference-only. Keep `app/zs.css` **named tokens**; Zen-Sumi (washi/sumi/one vermillion).
- **Cross-cutting:** exec-location badge; desktop-vs-web states; offline banner; device/sync chip; locked-toggle visual.

---

## ✅ Complete

Across cycles 1–7 the mockups now match `DECISIONS.md`. Resolved this cycle: **#30-admin** (Pending budget requests → approve/reject queue in Billing), **C5** (Billing Seats unified to `{Owner,Admin,Editor,Viewer}`), **#11** (Connections OAuth-connect Anthropic + per-router scope + key/token health & expiry), **#37** (editable redaction-rule editor + secret safe-term/allow-list), **#41** (Governance feature 4-state control), **#48** (device enroll → Ed25519 pubkey/fingerprint + device-bound-session + revoke confirm), **#54** (per-model fit indicator vs device RAM/GPU + fit-guarded download), **Q3/C4** (magic-link passwordless sign-in; region as operator-config; SAML/SCIM stubbed), **#22** (retrieval params — chunk size/overlap + hybrid weight + rerank top-k), **Q2** (Compare↔Playground round-trip: "Compare these" + "Open winner in Playground" + promote-to-default), and the minors (Activity date filter wired; Alerts hard-vs-soft copy; Ask chunk-precise deep-link).

Earlier cycles covered the 9 new screens, all editable admin editors, the §3c "ask the data" surface, document workspace + collaboration surfaces, Ask feedback + meters, redaction inspector, budget node editors, playground retrieval lab, and Corrections C1–C3, C6–C9.

---

## Minor polish — ✅ RESOLVED (verified 2026-07-23, Cycle 8)

- **C8** — seed `WORKFLOWS` steps now carry explicit `plane:'local'|'cloud'` (`data.jsx`), so the run-trace per-step ExecBadge is genuinely plane-driven.
- **#55** — the onboarding budget sub-flow now renders the shared `BUDGET_TREE` as the **hierarchical** tree (nesting + cascade + hard/soft caps, "same tree as Organization"), not a flat grid.
- **Devices** — enroll uses unique ids (`new-device-N`) + a full Ed25519 enroll flow (on-device keypair → pubkey → device-bound session + one-time code); revoke has **confirm + `restore`/undo**.
- Remaining nits are cosmetic only (all `view-requests` sample rows are same-day so the wired date filter has nothing to narrow; Playground "Advanced modes" pills are param-less — not required).

## Out of app-mockup scope (tracked in specs, not here)

- **#42** W4 zs.css→Rokkit token map + dark-skin palette (design-system artifact; owned by the W4 spec/build).
- **#43** W5 marketing pricing / talk-to-sales (separate `components/*` app; open product decisions).

## Change log

| Date | By | Change |
|------|----|--------|
| 2026-07-23 | Strategos | Cycles 1–4: seeded to 57 items. |
| 2026-07-23 | Strategos | Cycle 5: cross-verified; ~14 resolved, 9 corrections + confirmations. |
| 2026-07-23 | Strategos | Cycle 6: C1/C2/C3/C6/C7/C9 + ~20 items resolved; focused ~12 remained. |
| 2026-07-23 | Strategos | **Cycle 7:** remaining backlog resolved (#30/#11/#37/#41/#48/#54/#22/Q2/Q3/C4/C5 + minors). Mockups match DECISIONS. Q1 (v1/v2 gating) removed — implementation-managed, not a mock concern. Only optional polish + out-of-scope W4/W5 remain. |
| 2026-07-23 | Strategos | **Cycle 8:** polish resolved (C8 step planes, #55 hierarchical onboarding budget tree, device enroll/undo). **Mockups converged — no open design gaps.** Only out-of-scope W4 token-map/dark-palette + W5 marketing pricing remain (owned by specs, not the mock). |
