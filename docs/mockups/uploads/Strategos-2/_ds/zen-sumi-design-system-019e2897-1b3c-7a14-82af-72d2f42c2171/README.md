# Zen-Sumi Design System

A design system for **Sensei** — a local-first desktop companion that observes your AI-assisted coding sessions and quietly surfaces patterns. The brand name internally referenced as **Zen-Sumi** ("zen" + 墨/sumi, ink).

The aesthetic is washi paper, sumi ink, and a single rationed vermillion accent (朱 *shu*). It borrows from Japanese restraint: hairlines over shadows, generous negative space (間 *ma*), kanji as small functional marks, and "less, but better" copy.

> The master observes for a long time before teaching.

## Source materials

This system was distilled from a working prototype in **`sensei_src/`** (extracted from `uploads/Sensei.zip`). It contains:

- **`Sensei Observatory.html`** — the desktop app design canvas with ~30+ artboards across four flows (bootstrap, wizard, observatory collective, project window) plus supporting screens (Sessions, Learnings, Instruments, Libraries, etc.)
- **`Sensei Site.html`** — three marketing-site variants (Same-world, Confident-continuity, Marketing-forward)
- **`lib/tokens.css` + `site/tokens.css`** — original token set (kept for reference; this system reorganises and tightens it)
- 50+ JSX files implementing components, screens, and data

The prototype's implementation used **30+ font sizes** (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 17, 19, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 46, 56, 80, 96…) and similarly chaotic spacing. **This design system reduces both to tight, semantic scales** while preserving the visual character. See `colors_and_type.css`.

## Products

| Product | What it is | UI kit |
|---|---|---|
| **Sensei Observatory** | Tauri desktop app · the daily "morning briefing", sessions, learnings, instruments, libraries, project window | `ui_kits/observatory/` |
| **Sensei Site** | Marketing website · hero, gallery, philosophy, privacy, pricing, FAQ | `ui_kits/site/` |

---

## VISUAL FOUNDATIONS

### The vibe

Washi paper, sumi ink, vermillion brush mark. Quiet, calm, generous with whitespace. The interface feels like a notebook you'd keep on your desk, not a SaaS dashboard. No data-slop, no animated gradients, no rounded-corner emoji cards. The product *is* restraint.

### Color

A **paper / ink / accent** semantic system, on top of a raw `washi`, `sumi`, `shu` (vermillion) palette in OKLCH.

- **`--paper`** is the page (warm off-white, oklch 0.975 / chroma 0.008 / hue 85 — yellow-warm).
- **`--paper-2`** raises a step (cards, inputs).
- **`--paper-3`** sinks a step (hover, inset).
- **`--edge`** is hairlines.
- **`--ink`** → `--ink-2` → `--ink-3` → `--ink-4` is the four-step ink ladder (primary text → faint text). Hue is slightly warm (50), low chroma (0.008–0.012). Never pure black; never pure grey.
- **`--accent`** is 朱 vermillion — the *only* hue in the system. Rationed: kanji marks, the active dot, primary CTAs, sometimes a focus ring. Never used as background fill at scale, never used twice in the same view if possible.
- **`--success`** (jade) and **`--warning`** (amber) exist for status, but appear sparingly. There is no separate "info" or "danger" stack — the system trusts the writer.

Both light and dark themes use the same semantic names; the values flip. Light is the canonical mode.

### Type

- **Display:** *Fraunces* (variable serif). Weights 300–500. Used at every size above `--text-lg`. Slight `ss01` feature on for the characterful "a" and "g". Always tight tracking (`-0.02em`).
- **UI:** *Inter*. Weights 400–600. Default body and chrome.
- **Mono:** *JetBrains Mono*. Used for numbers (tabular figures on), IDs, paths, keyboard hints, version strings. Never for paragraphs.
- **Kanji:** *Yu Mincho / Hiragino Mincho ProN / Songti SC* (system stack). Used at every size for the small functional kanji marks scattered through the UI.

The **type scale is 8 sizes total**: `xs 11 / sm 13 / base 15 / lg 17 / xl 22 / 2xl 28 / 3xl 40 / 4xl 56`. Below `xs` is disallowed; between sizes is disallowed.

There's a `kanji` font family that always renders Japanese characters in a Mincho-style serif. Latin runs in the regular UI/display stack. **The two never share a glyph run** — kanji are always wrapped in `<span class="zs-kanji">…</span>` (or the React `<Kanji/>` component) so the font switches cleanly.

### Spacing

A **9-stop scale** on a 4px base: `0 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96`. That is the entire budget. No `18px`, no `26px`, no `5px`. Always use a stop; if it doesn't fit, the design is wrong, not the scale.

Component padding tends to land at `--space-3` (12) inside small UI, `--space-4` (16) inside cards, `--space-5` (24) inside section headers, and `--space-7` (48) between sections.

### Backgrounds

Almost always solid paper (`--paper` or `--paper-2`). The system does **not** use full-bleed photography, gradients, repeating patterns, or generative texture. If a section needs more presence, it gets a `--paper-2` lift and a hairline border — not a colored background.

The one exception: very rare large kanji glyphs at high opacity, used as a watermark. Never decorative SVG.

### Animation

Quiet. Default duration is `--dur` (180ms) on a calm `cubic-bezier(0.2, 0.6, 0.2, 1)` ease. Three durations exist (`fast 120 / dur 180 / slow 280`) and that's all.

- **Hover** = subtle background lift to `--paper-3`, or a 1-step darker ink color. Never scale, never colored glow.
- **Press** = `translateY(0.5px)`. No shrink, no flash.
- **Enter** = `opacity` + 4px `translateY`, that's the recipe. No spring, no bounce, no stagger.
- No skeleton loaders — the system uses faint text ("Still listening…") instead.

### Borders, hairlines, and shadows

The system **prefers hairlines to shadows.** `--hairline` is a 1px line in `--edge` (a paper-warm grey just darker than `--paper`). It separates rows, divides sections, and outlines cards. Shadows are used **only** for things that *physically* lift off the page: modals, command palettes, focus overlays. Cards do not shadow. Buttons do not shadow.

When a shadow is used, it's a 2-layer ink shadow with very low opacity: `--shadow` (default), `--shadow-lg` (modals).

### Radii

`4 / 6 / 10 / 9999`. Most UI uses `--radius` (6px). Cards use `--radius-lg` (10px). Pills and avatars use `--radius-full`. Square corners are also valid for hairline-only sections.

### Transparency & blur

Used sparingly. Two recipes:
- **Modal overlay**: `oklch(0.22 0.012 50 / 0.28)` plus 1px blur on what's beneath.
- **Soft tint backgrounds for badges**: `--accent-soft`, `--success-soft`, `--warning-soft` — the accent at low alpha.

No `backdrop-filter` blur on chrome by default; the system is happier on opaque paper.

### Layout

- Marketing site: 1100px content width, 48px gutters. One generous column.
- Desktop app: full-bleed, with a 220–260px sidebar and main view, all separated by hairlines.
- Grids on the marketing site break to 1 column at narrow widths but the *system itself* is desktop-first; the prototype targets 1280–1600 wide.
- The Tauri window chrome (`.zs-chrome`) is always 38px tall, traffic-lights left, centered subtitle.

### Iconography

**Not Material, not Lucide, not emoji.** Sensei's "icons" are **kanji** — single Mincho-style Japanese characters used as small functional marks. See `Iconography` below.

When a true glyph is needed (status dot, sparkline endpoint, sliders), the system uses **hand-drawn inline SVGs** in a 16-grid, 1.2–1.4 stroke, `currentColor` fill or stroke, round joins, round caps. These live in `lib/primitives.jsx` in the source as `EventGlyph` (start, end, context, edit, test, correction).

### Imagery

The system does not ship stock photography. The marketing site uses **interactive miniature mockups of the product itself** as illustration — see `MockToday`, `MockSessions`, `MockInsights`, `MockMemory`, `MockInstruments` in `sensei_src/site/mockups.jsx`. This avoids the "happy hands on laptop" trope and reinforces the product's calm density.

### Cards

A card is: `background: var(--paper-2)` + `border: var(--hairline)` + `border-radius: var(--radius-lg)` + `padding: var(--space-5)`. That's the whole specification. **No shadow on cards.** No colored left-borders. No header background fill.

### Tables, lists, rows

Rows are separated by `--hairline` borders, not zebra striping. Selected rows lift to `--paper-3`. Hover rows lift to `--paper-3`. The hairline ladder is the system's primary list pattern.

---

## CONTENT FUNDAMENTALS

### Voice

**Patient, quiet, observant.** Sensei sounds like a wise old teacher who speaks rarely. It almost never uses the word "AI", almost never says "powered by", and never uses exclamation marks. It does not "love" things. It does not "want to help you crush your goals."

When sensei has nothing to say, it stays silent. The empty state is content. *"Still listening."* is a feature.

### Person & casing

- **Second person.** "Your sessions stay on your machine." "You decide what's signal."
- Sensei speaks **about itself in lowercase third person** — "sensei watches", "sensei has learned" — never "I" and never "Sensei said". This is intentional: the product is a presence, not a personality.
- **Sentence case** everywhere except the proprietary mark "Sensei" itself and the kanji-titled phases (Watch · Notice · Adopt).
- Eyebrow labels use UPPERCASE with `0.18em` letter-spacing — but only the eyebrow, not the heading beneath it.
- Section headings are sentence-cased fragments, not titles: "One desktop app. One quiet promise." not "About Sensei".

### Tone examples (from the prototype)

| Surface | Copy |
|---|---|
| Hero | "A quiet companion for AI-assisted work." |
| Hero sub | "Sensei watches your sessions with AI assistants — then surfaces the patterns you're too close to see. Not a chatbot. Not a copilot. A patient observer." |
| CTA | "Download for macOS" (single OS-auto-detected button — no "Get started", no "Try free") |
| Pricing | "Free. Pay what feels right." |
| Privacy headline | "Your sessions stay on your machine." |
| Hero koan (in-app) | "The AI does not know your auth." |
| Empty state | "Still listening." |
| Footer | `先生 Sensei v0.4.2` |

Note the structure: a kanji as anchor, a one-line fragment that lands, a calm second sentence that explains. Periods, not exclamations.

### What sensei does NOT say

- "Unlock", "supercharge", "10x", "revolutionize"
- "AI-powered", "AI-native", "AI-first"
- "Welcome!", "Hi there!", "Let's get started!"
- "Loading…" (uses "Still listening" instead, contextually)
- Emoji, ever. The kanji do the affective work.

### Emoji & special characters

- **No emoji.** Anywhere. Ever.
- **Kanji marks** stand in for icons — see *Iconography* below.
- Numbers in body copy spell out one through nine (most of the time); use digits for stats and IDs.
- Em dashes ( — ) for parentheticals; en dashes (–) for ranges. ASCII `--` is wrong.
- Curly quotes (" "), not straight.
- The lowercase center-dot ( · ) is used liberally as a separator: `lumen-auth · 38m · 3 corrections`.
- Arrows are unicode: `↓ ↑ → ←` not `>` or `>>`.

### Microcopy

Numbers are *meaningful*. Don't show "1,247 patterns recognized" when "3rd time" tells you more. Sensei's UI deliberately *replaces* big-number stats with small, specific phrases:

> "Cache invalidation missed again in session s-2891. **3rd time.**"

That `3rd time` badge tells you everything. Don't dilute it with another count.

---

## ICONOGRAPHY

Sensei has **three layers** of iconographic vocabulary, in priority order:

### 1 · Kanji (the brand layer)

Single Japanese characters in Mincho-style serif, rendered via the `--font-kanji` stack. Each kanji has a fixed meaning in the product. The full active set is documented in `assets/kanji.md`. Highlights:

| Kanji | Romaji | Meaning | Usage |
|---|---|---|---|
| 先生 | sensei | teacher | Brand mark / logo |
| 観 | kan | observe | Observatory / Watch phase |
| 察 | satsu | notice | Notice phase / patterns |
| 覚 | kaku | adopt | Adopt phase / memories |
| 場 | ba | place | Projects index |
| 動 | dō | active | Active filter |
| 眠 | nemuri | dormant | Dormant filter |
| 蔵 | kura | storehouse | Archived / Privacy |
| 静 | sei | stillness | Philosophy |
| 工 | kō | craft | Projects (Lumen Studio) |
| 雲 | kumo | cloud | Projects (Lumen Cloud) |
| 紋 | mon | crest | Projects (Brand Kit) |
| 刻 | koku | moment | Sessions |
| 具 | gu | instrument | Tools / MCP |
| 探 | saguri | seek | Search |
| 試 | kokoromi | try | Test / experiment |
| 空 | kū | empty | Empty state |
| 志 | kokorozashi | intention | Support / sponsorship |

Kanji are typically `--accent` (vermillion) when they're functional (in a nav, on a card), `--ink-3` when they're decorative, and `--ink-4` when they're disabled. **They are always wrapped** in `<span class="zs-kanji">…</span>` so the Mincho font kicks in.

### 2 · Solar Icons Duotone (the working icon set)

For everyday UI affordances — close, search, add, settings, download, archive, notify, check, warning — the system uses **[Solar Icons Bold Duotone](https://solariconset.com/)** loaded from the Iconify CDN. Two-tone, rounded, slightly stuffed silhouettes that read softer on washi paper than the typical line/stroke icon set.

Loaded per-icon as a fetchable SVG:

```html
<img src="https://api.iconify.design/solar:eye-bold-duotone.svg?color=%232A2925"
     alt="" width="24" height="24"/>
```

Tint via the `?color=` URL param so the icon picks up the ink/accent scale:

| Token | Hex |
|---|---|
| `--ink` | `#2A2925` |
| `--accent` | `#A83D1F` |
| `--success` | `#578D70` |
| `--warning` | `#B9893A` |

The duotone's secondary fill is automatic — it renders at reduced opacity against the same hue. **Use the `-bold-duotone` variant only.** The system does NOT use Solar's Linear, Outline, or Bold variants — they're too sharp and break tone.

### 3 · Custom brush marks (the three locked zen-garden anchors)

For the three central practice phases — **observe**, **notice**, **memory** — the system uses hand-built brush-stroke SVGs that reference zen-garden elements. They live in `assets/glyphs.svg` and are referenced via `<use href="#zen-…"/>`:

| Concept | Symbol | Glyph | Rationale |
|---|---|---|---|
| **observe** | `#zen-bonsai` | bonsai | A thing cultivated by sustained attention. |
| **notice** | `#zen-rake` | sand-rake (kumade) | The moment a pattern emerges from raked sand. |
| **memory** | `#zen-pagoda` | pagoda | Stored teachings, stacked in layered tiers. |

These three are **the brand anchors** — they should always render in `--accent` when they represent the active phase, in `--ink` when documentary, and `--ink-3` when disabled. Stroke and fill both use `currentColor`, so tinting is a single CSS rule.

```html
<svg width="32" height="32" style="color: var(--accent)">
  <use href="/assets/glyphs.svg#zen-bonsai"/>
</svg>
```

### What is forbidden

- Emoji (anywhere)
- Material Icons / Font Awesome / Phosphor / Heroicons / Lucide / Feather
- Any icon with rounded-corner colored squares behind it
- Gradient-filled icons
- 3D / isometric illustrations
- Stock photography
- Mixing Solar variants (only `-bold-duotone`)

---

## Substitutions / open questions

- **Fonts**: Fraunces, Inter, JetBrains Mono, and the system Japanese stack are all loaded from Google Fonts at runtime (`fonts/load.css`). No self-hosted webfonts were shipped in the source archive. If the production app prefers self-hosted, please supply `.woff2` files and we'll swap.
- **Kanji font**: the system stack (Yu Mincho → Hiragino Mincho ProN → Songti SC → serif) works on most platforms. On Windows without Yu Mincho installed, the fallback to MS Mincho or generic serif is acceptable but slightly less elegant. A self-hosted *Shippori Mincho* or *Klee One* would be the upgrade.

---

## Index

- `README.md` — this file
- `colors_and_type.css` — the single CSS dependency. All tokens, all utilities, all component classes.
- `SKILL.md` — agent-skill manifest (also usable in Claude Code)
- `assets/` — kanji reference, glyphs SVG, brand mark
- `preview/` — design-system preview cards (registered for the Design System tab)
- `ui_kits/observatory/` — UI kit for the desktop app
- `ui_kits/site/` — UI kit for the marketing site
- `sensei_src/` — the original prototype source (kept for reference)

### How to use this system

1. Drop `colors_and_type.css` into your project.
2. Wrap your app root in `<div class="zs">`. All tokens, utilities, and component classes are scoped to `.zs`.
3. Use the **semantic** classes (`text-ink-2`, `bg-paper-2`, `zs-card`, `zs-btn-primary`), not raw values.
4. If you need a value that's not in the scale — don't add it. Pick the nearest stop, or simplify the design. **The constraint is the system.**
