# W5 · Marketing site

**Plane:** Web · **Status:** Planned · **Depends on:** W4 (light) · **Domain:** `strategos.sensei-hq.com`

## Purpose

The public-facing site: explain the product, show the controls, convert to sign-up / talk-to-sales.

## What we build (SvelteKit, prerendered → Cloudflare Pages)

- Hero ("Every model. One governed doorway."), value props (route / spend / govern), controls showcase, security/compliance (SOC 2, in-region, BYOK), pricing, talk-to-sales / CTA.
- Sign-in links into `app.` and `admin.`.
- SEO-friendly (prerendered/SSR), fast, separate release cadence from the apps.

## UI surfaces

The marketing site.

## Reuse / source

`docs/mockups/Strategos.html` (hero/site), `docs/mockups/assets/site*.css`, screenshots (`hero.png`, `site-cta.png`).

## Open questions

- Static vs CMS-backed content; pricing model; self-serve signup vs sales-led.
