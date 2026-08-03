# W5 · Marketing site

> Reconciled to [`../DECISIONS.md`](../DECISIONS.md) 2026-07-23.

**Plane:** Web · **Status:** Planned · **Depends on:** W4 (light) · **Domain:** `torii.sensei-hq.com`

## Purpose

The public-facing site: explain the product, show the controls, convert to sign-up / talk-to-sales. A **separate app/codebase** from the app-plane apps (admin/desktop, which share W4 `packages/ui`), built from the marketing mockups in `components/*.jsx`, and sequenced as **its own later phase** (§6 — `components/*` is the W5 marketing app, distinct from the canonical `app/*.jsx` set).

## What we build (SvelteKit, prerendered → Cloudflare Pages)

- Hero ("Every model. One governed doorway."), value props (route / spend / govern), controls showcase, security/compliance (SOC 2, in-region, BYOK), pricing, talk-to-sales / CTA.
- Sign-in links into `app.` and `admin.`.
- SEO-friendly (prerendered/SSR), fast, separate release cadence from the apps.

## UI surfaces

The marketing site.

## Reuse / source

`docs/mockups/components/*.jsx` (the W5 marketing app — canonical per §6); `docs/mockups/Torii.html` (hero/site), `docs/mockups/assets/site*.css`, screenshots (`hero.png`, `site-cta.png`).

## Open questions

- Static vs CMS-backed content; pricing model; self-serve signup vs sales-led.
