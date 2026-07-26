# W5 · Marketing site — Spec

**Module:** [W5](../modules/W5-marketing-site.md) · **Status:** Planned (own later phase) · **Depends on:** W4 (light — token vocabulary only) · **Enables:** top-of-funnel conversion into F2 sign-up / sales pipeline
**Date:** 2026-07-23 · **Plane:** Web (public) · **Tech:** SvelteKit (prerendered/SSR) → Cloudflare Pages · **Domain:** `strategos.sensei-hq.com`

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) (RATIFIED 2026-07-23). This is the **public marketing app** built from the mockups under `docs/mockups/components/*.jsx` — a **separate codebase** from the product apps (`app/*.jsx` admin/desktop consoles). Per DECISIONS §6, `components/*` is the W5 marketing app and is explicitly **out of** the canonical product-UI set. This module carries **zero tenant data and zero F1 database access**; the three product calls it depends on (content model, pricing model, funnel model) are flagged in §8/§10 as **pre-build product decisions** and gate the phase.

---

## 1. Purpose & scope

Ship the public-facing site that explains Torii, shows the controls, and converts visitors into sign-ups or sales conversations. Anonymous, unauthenticated, cache-first, SEO-optimized, released on a cadence **independent** of the product apps.

**In scope (v1):**
- Marketing pages: hero, value props (route / spend / govern), Playground showcase, Governance showcase, Requests & audit (observability) showcase, Enterprise (security/deployment/whitelabel), **pricing**, closing CTA, footer.
- Legal/informational stubs linked from footer: Privacy, Terms, Status.
- **Sign-in / sign-up deep links** into the product apps (`app.` console, `admin.` portal).
- A **Talk-to-sales / contact (lead-capture)** flow.
- Prerendered static output on Cloudflare Pages; bot-protected contact form.

**Out of scope (v1):**
- Any authenticated product surface (that is W1/W2/W3).
- Any read/write against the F1/Supabase schema (see §3, §5).
- Blog / docs portal / changelog (may be added later; not part of the ratified surface).
- Self-serve billing/checkout runtime (deferred; gated by the pricing/funnel product decision — §8).

**Depends on:** W4 (light) — reuses only the **named-token vocabulary** (`app/zs.css` → Rokkit tokens per DECISIONS §6) for brand consistency; it does **not** consume `packages/ui` product components wholesale (the marketing app has its own lighter chrome derived from `components/*.jsx`).
**Enables:** the acquisition funnel — every CTA lands in F2 sign-up (`app.`) or a sales lead. No product module depends on W5.

---

## 2. Responsibilities

1. **Present the product story** — render the ratified marketing sections (§6 flows, §1) as fast, accessible, prerendered pages.
2. **Route the funnel** — Nav + hero + closing CTA drive to `app.`/`admin.` sign-in/sign-up and to the contact flow; links are environment-configurable (dev/staging/prod domains).
3. **Capture leads safely** — accept a talk-to-sales submission, bot-filter it (Turnstile), and hand it to an external sink (email/CRM webhook) **without** touching the product database.
4. **Own its release cadence** — deploy on Cloudflare Pages separately from W1/W2/W3; a content change never triggers a product-app release and vice-versa.
5. **SEO & performance** — prerendered HTML, meta/OpenGraph tags, sitemap, robots, fast LCP; no client-side auth or heavy product bundles.
6. **Stay brand-consistent** — apply the W4 token vocabulary + light/dark skin so the site and product feel like one system.

---

## 3. Data model (F1 tables owned/used)

**None.** W5 owns no F1 tables and has **no PostgREST / Supabase client** on the product schema. This is a deliberate isolation boundary: a public, cache-first marketing app must not embed product data-plane credentials.

- **Content:** ships as **static content** in-repo for v1 (see §8 decision D1). No `documents`/`spaces`/catalog reads.
- **Pricing display:** rendered from **static in-repo content**, not from the F1 `models`/pricing catalog (the marketing price list is editorial, not the operational per-token catalog — DECISIONS "no hardcoded ops" applies to the *gateway library*, not to editorial marketing copy).
- **Lead capture:** a talk-to-sales submission is **not** written to F1. It goes to an **external sink** — a transactional email (Cloudflare Email / Email Routing) and/or a CRM webhook — via a Pages Function (§4). If a persisted lead store is later wanted, it is a **separate marketing datastore**, never the tenant schema, and is deferred behind the funnel product decision (§8 D3).

---

## 4. Contracts (HTTP / functions / config — concrete)

### 4.1 Public routes (prerendered SvelteKit, `prerender = true`)

| Route | Content | Notes |
|-------|---------|-------|
| `/` | Hero, StatBand, Playground/Governance/Observability/Enterprise showcases, ClosingCTA, Footer | Single long-scroll landing (mirrors `components/app.jsx` composition) |
| `/pricing` | Pricing page (tiers/CTA) | **New surface** — not yet in the mockups (§9); shape gated by pricing decision (§8 D2) |
| `/enterprise` | Deep-dive on security/deployment/whitelabel | Optional split-out of the `#enterprise` section |
| `/contact` (or `/talk-to-sales`) | Lead-capture form + Turnstile widget | Posts to `/api/lead` |
| `/privacy`, `/terms`, `/status` | Legal/status stubs | `/status` may redirect to an external status page |
| `/sitemap.xml`, `/robots.txt` | SEO assets | Generated at build |

All routes are **statically prerendered**; there is no per-request server rendering of user data. Anchor navigation (`#playground`, `#governance`, `#observability`, `#enterprise`) is preserved from the mockup for the single-page scroll.

### 4.2 Outbound funnel links (environment-configured, not hardcoded)

Resolved from build/runtime env (Cloudflare Pages env vars), never string-literals in components:

- `PUBLIC_APP_URL` → console sign-in / **Open console** / **Sign in** (`components/chrome.jsx` Nav).
- `PUBLIC_ADMIN_URL` → **Admin** link.
- `PUBLIC_SIGNUP_URL` → primary "Get started / sign up" CTA (points at F2 sign-up on `app.`).
- `PUBLIC_STATUS_URL`, `PUBLIC_DOCS_URL` → footer links.
- `PUBLIC_TURNSTILE_SITE_KEY` → contact form widget.

### 4.3 `POST /api/lead` (Cloudflare Pages Function — the only server surface)

Request (JSON):
```
{ name, workEmail, company, teamSize?, message?, turnstileToken }
```
Behavior:
1. Verify `turnstileToken` server-side via Cloudflare Turnstile siteverify (secret in `TURNSTILE_SECRET_KEY`, a Pages secret).
2. Validate + normalize fields; reject on missing/invalid email or failed Turnstile with `400`.
3. Deliver the lead to the configured sink(s): transactional email to `SALES_INBOX` and/or `LEAD_WEBHOOK_URL` (CRM). Secrets held as Pages env secrets.
4. Return `202 { ok: true }` on accept; never echo back stored data; no PII in logs (§5).

Responses: `202` accepted · `400` validation/turnstile · `429` rate-limited (per-IP) · `502` sink-unavailable (with a graceful "email us at …" fallback shown client-side).

### 4.4 Build/deploy contract

- SvelteKit `adapter-cloudflare` (Pages); `prerender` on all content routes; `/api/lead` runs as a Pages Function.
- Separate CI pipeline + separate Cloudflare Pages project from the product apps; independent release cadence (Responsibility 4).

---

## 5. Security & RLS (capabilities, tenant isolation, secrets, redaction)

- **No tenant data, no RLS surface.** W5 has no Supabase/PostgREST client on the product schema and no `service_role` key. Tenant isolation is achieved by **absence of access** — the marketing app is architecturally incapable of reading F1. This sidesteps the W1 privilege-escalation class entirely.
- **Anonymous only.** No authentication happens on the marketing domain; sign-in/sign-up is delegated to F2 on `app.`/`admin.` via links. No JWT is minted or read here.
- **Secrets:** the only server secrets are `TURNSTILE_SECRET_KEY`, `SALES_INBOX`/`LEAD_WEBHOOK_URL` credentials — held as **Cloudflare Pages secrets**, never in the client bundle or repo. No provider keys, no KEK, no Supabase keys ever present in this app.
- **Bot / abuse protection:** Cloudflare Turnstile on the contact form + server-side siteverify (use the `turnstile-spin` skill at build time); per-IP rate-limit on `/api/lead`.
- **PII / redaction:** lead submissions contain user-provided PII (name/email/company). Handling: transit over TLS only, **no PII written to F1**, **no PII in application logs** (log only status codes + a request id). This is the marketing-side analogue of DECISIONS §2 W5 — the marketing app is a *source* of PII that must not leak into logs or the product data plane. The DLP/redaction runtime (C4/C5) does not run here; the control is "don't persist/log it."
- **Content-Security-Policy & headers:** strict CSP (self + Turnstile + the analytics domain if any), HSTS, `X-Content-Type-Options`, `Referrer-Policy` set via Pages `_headers`. No inline product tokens/data.
- **Analytics/consent:** privacy-respecting, cookie-light analytics (e.g. Cloudflare Web Analytics) with a consent banner if any cookies are set; gated by the Privacy page. (Vendor choice is a minor open item, §10.)

---

## 6. Key flows (numbered)

1. **Landing → showcase scroll.** Visitor hits `/`; prerendered HTML paints hero ("Every model. One governed doorway.") + stat band, then Playground/Governance/Observability/Enterprise showcases and the closing CTA, all from static content. Anchor nav jumps between sections.
2. **Convert to sign-up (self-serve path).** Visitor clicks "Get started" / "Open console" → redirected to `PUBLIC_SIGNUP_URL` (F2 sign-up on `app.`). W5's job ends at the redirect. *(Whether this path is primary is the funnel product decision — §8 D3.)*
3. **Convert to sales (sales-led path).** Visitor clicks "Talk to sales" → `/contact` → fills the lead form → Turnstile challenge → `POST /api/lead` → siteverify → email/CRM delivery → success state ("We'll be in touch"). Graceful fallback to a mailto if the sink is down.
4. **Pricing evaluation.** Visitor opens `/pricing`, reads tiers, and clicks a tier CTA that routes to either sign-up (self-serve tier) or contact (enterprise tier) — the mix depends on §8 D2/D3.
5. **Existing-customer sign-in.** Nav "Sign in"/"Admin" → deep-link to `PUBLIC_APP_URL` / `PUBLIC_ADMIN_URL`.
6. **Content update & release.** An editor edits static content in-repo (v1) → PR → CI prerenders → deploys to the W5 Cloudflare Pages project, with **no** product-app rebuild. *(If CMS is chosen — §8 D1 — this becomes an editor-driven publish + webhook rebuild.)*

---

## 7. Gateway-crate dependencies (+ GH-issue refs)

**None.** W5 is a static marketing site with no inference, routing, budget, or credential path. It does not depend on any `sensei-*` crate and introduces no gateway-repo issues. (Listed explicitly to confirm the boundary, per the required section set.)

---

## 8. Decisions resolved (settled per DEFAULTS; residuals settled here with rationale)

These three were flagged in the seed and mockup-review §43 as **pre-build product calls**. They gate the W5 phase and must be confirmed by the product owner before build; the spec sets a **recommended default** for each so the phase is buildable if no override is given.

- **D1 — Content model: static-in-repo for v1 (CMS deferred).**
  *Rationale:* the ratified surface is a small, editorial set of pages that changes rarely; static-in-repo keeps the app dependency-free, fully prerenderable, and trivially cache-first, and avoids standing up/securing a CMS before there is content velocity to justify it. **Revisit → headless CMS** (e.g. a git-backed or hosted headless CMS with a build webhook) once blog/case-studies/localization create real editorial churn. Architecture keeps content behind a thin loader so the swap is localized.
- **D2 — Pricing model: publish tiers, enterprise "contact us"; no live checkout in v1.**
  *Rationale:* v1 has no self-serve billing runtime (none is specced), and enterprise/BYOK/deployment-mode pricing is inherently quote-shaped (single- vs multi-tenant per `components/enterprise.jsx`). Show named tiers with per-tier CTAs; the top/enterprise tier routes to Talk-to-sales. A live checkout/self-serve subscription surface is **deferred** and would be its own module/phase (Stripe-style), separate from the tenant schema.
- **D3 — Funnel: hybrid, sales-led-primary for v1.**
  *Rationale:* the product is a governed, budget/BYOK, multi-tenant platform aimed at orgs — the natural v1 motion is sales-led (Talk-to-sales primary) with a **self-serve sign-up link available** for smaller teams/trials via F2 email+OAuth (DECISIONS §3 identity). Both CTAs are present; emphasis (which is the primary hero button) is a copy/config choice, not an architecture change.

Additional settled points:
- **Isolation:** W5 has **no product-DB access** (§3/§5) — consistent with DECISIONS §2 W1 (privileged writes gateway-mediated; a public app gets neither).
- **Separate app/codebase & cadence:** confirmed per seed + DECISIONS §6 (`components/*` ≠ product `app/*`).
- **Sequencing:** W5 is its **own later phase**, after the product apps and F2 sign-up exist (so CTAs land somewhere real). It is not on the critical path for any product module.

---

## 9. Acceptance criteria (observable)

1. `strategos.sensei-hq.com/` serves prerendered HTML (view-source shows hero copy + section content without JS execution) and passes a Lighthouse SEO+perf check (LCP within target on a cold cache).
2. All ratified sections render: hero, stat band, Playground/Governance/Observability/Enterprise showcases, pricing, closing CTA, footer — matching the `components/*.jsx` composition and using W4 brand tokens in both light and dark skins.
3. Nav/CTA links resolve to the **env-configured** `PUBLIC_APP_URL`/`PUBLIC_ADMIN_URL`/`PUBLIC_SIGNUP_URL` (verifiable by changing an env var and re-deploying — no hardcoded product URLs in the bundle).
4. `/contact` submission with a valid Turnstile token returns `202` and delivers a lead to the configured sink; a submission with a missing/invalid token returns `400` and is **not** delivered.
5. Grep of the built client bundle finds **no** Supabase URL/key, `service_role`, provider key, or KEK; the app makes no request to the product PostgREST/Supabase origin.
6. Application/function logs for a lead submission contain a request id + status code but **no** submitter name/email/company (PII-free logs).
7. `/sitemap.xml`, `/robots.txt`, and per-page OpenGraph/meta tags are present; `/privacy`, `/terms`, `/status` resolve.
8. A content-only change deploys via the W5 Pages pipeline **without** rebuilding or redeploying the product apps (and vice-versa) — separate cadence demonstrated.
9. Strict CSP + security headers are served (verifiable via response headers); Turnstile and analytics origins are the only third-party allowances.

---

## 10. Open questions (genuine)

1. **Pricing tier definition (copy, not architecture).** The concrete tier names, feature-splits, and price points for `/pricing` require product/marketing input — there is **no pricing page in the current mockups** (mockup-review §43 flags it as `TODO`); this spec defines the surface and CTA routing (D2) but not the editorial tier content. *This is the one genuine content gap blocking the pricing page.*
2. **Sales sink target.** Which CRM/inbox `/api/lead` delivers to (plain transactional email vs a specific CRM webhook) — an ops/GTM choice; the contract (§4.3) is sink-agnostic.
3. **Analytics/consent vendor.** Cloudflare Web Analytics (cookieless, no banner) vs a cookie-based tool (needs a consent banner) — minor; defaults to cookieless.
4. **Domain/subdomain final form.** Seed uses `strategos.sensei-hq.com`; confirm apex vs `www` and the `app.`/`admin.` product subdomains for the env links.

## Mockup grounding

Built from `docs/mockups/components/*.jsx` (canonical W5 marketing app per DECISIONS §6): `app.jsx` (page composition), `chrome.jsx` (Nav / Hero "Every model. One governed doorway." / StatBand / Footer), `enterprise.jsx` (security features, single-/multi-tenant deployment modes, whitelabel, CTA), `governance.jsx`, `observability.jsx`, `pg-*.jsx` (Playground showcase), `data.jsx`, `icons.jsx`/`logo-marks.jsx`, plus `Strategos.html` and `assets/site*.css`. **Gap:** the mockups have **no pricing page** — it is a new surface this spec introduces (§4.1, §9, §10 Q1). Do **not** invent product screens beyond this ratified marketing surface.
