/* ═══════════════════════════════════════════════════════════════════
   TORII · SEIKI — UnoCSS configuration.
   This file IS the styling system. Nothing else styles the app:
     · theme      — semantic colors, the eight-size type scale, radii,
                    shadows, motion. All resolve to the tokens in zs.css.
     · shortcuts  — the component vocabulary (card, nav, tbl, cmdk …),
                    written purely as utilities. Child/state rules use
                    arbitrary variants so there is no CSS to drift from.
     · preflights — element resets only (things a class cannot target).
   Hand-off: this file is the single source of truth, consumable by the browser
   runtime (window.__unocss) and a build (module.exports) alike — copy it into
   the app repo unchanged and add presetUno(). Utilities in markup don't change.
   See docs/DESIGN_PRINCIPLES.md and docs/MIGRATION.md.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
var config = {
  theme: {
    breakpoints: { tiny: '560px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
    colors: {
      paper: { DEFAULT: 'var(--paper)', soft: 'var(--paper-soft)', mute: 'var(--paper-mute)', edge: 'var(--paper-edge)' },
      ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)', mute: 'var(--ink-mute)', faint: 'var(--ink-faint)', hover: 'var(--ink-hover)' },
      accent: { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)' },
      success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)' },
      warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)', ink: 'var(--warning-ink)' },
      danger: 'var(--danger)',
      scrim: 'oklch(0.22 0.012 50 / 0.28)',
      schedule: 'oklch(0.56 0.10 250 / 0.12)',
      /* hairline tints — the only raw color values in the system */
      line: {
        DEFAULT: 'var(--paper-edge)',
        ink: 'oklch(0.22 0.012 50 / 0.12)',
        badge: 'oklch(0.22 0.012 50 / 0.06)',
        accent: 'oklch(0.58 0.15 35 / 0.28)',
        accentsoft: 'oklch(0.58 0.15 35 / 0.25)',
        accentstrong: 'oklch(0.58 0.15 35 / 0.30)',
        accentbold: 'oklch(0.58 0.15 35 / 0.40)',
        success: 'oklch(0.62 0.08 160 / 0.25)',
        successstrong: 'oklch(0.62 0.08 160 / 0.40)',
        warning: 'oklch(0.72 0.12 75 / 0.30)',
        warningstrong: 'oklch(0.72 0.12 75 / 0.45)',
      },
      traffic: { red: 'oklch(0.72 0.14 28)', amber: 'oklch(0.82 0.13 85)', green: 'oklch(0.72 0.11 145)' },
    },
    fontFamily: {
      display: "'Fraunces','Iowan Old Style',Georgia,serif",
      ui: "'Inter',system-ui,-apple-system,'Segoe UI',sans-serif",
      mono: "'JetBrains Mono','SF Mono',Menlo,monospace",
      kanji: "'Shippori Mincho','Yu Mincho','Hiragino Mincho ProN','Songti SC',serif",
    },
    /* SPACING — UnoCSS's default 4px stops (p-4, gap-6, mt-12 …). The
       Zen-Sumi steps all land on them: 4·8·12·16 = 1·2·3·4, then 24·32·48·64·96
       = 6·8·12·16·24. Stay on those; 5/7/9 (20/28/36px) are off-scale. */
    /* named type rhythm — the tokens in zs.css, usable as tracking-wide,
       leading-snug … so the app repo shares the exact same names */
    letterSpacing: { tight: 'var(--tracking-tight)', normal: 'var(--tracking-normal)', wide: 'var(--tracking-wide)' },
    lineHeight: { tight: 'var(--leading-tight)', snug: 'var(--leading-snug)', normal: 'var(--leading-normal)', loose: 'var(--leading-loose)' },
    /* the only weights app/fonts.css loads */
    fontWeight: { light: '300', normal: '400', medium: '500', semibold: '600', bold: '700' },
    /* the eight-size Zen-Sumi scale — the whole budget */
    fontSize: {
      xs: '11px', sm: '13px', base: '15px', lg: '17px',
      xl: '22px', '2xl': '28px', '3xl': '40px', '4xl': '56px',
    },
    borderRadius: { sm: 'var(--radius-sm)', DEFAULT: 'var(--radius)', lg: 'var(--radius-lg)', full: '9999px' },
    boxShadow: { sm: 'var(--shadow-sm)', DEFAULT: 'var(--shadow)', lg: 'var(--shadow-lg)' },
    easing: { DEFAULT: 'var(--ease)' },
    duration: { fast: '120ms', DEFAULT: '180ms', slow: '280ms' },
    animation: {
      keyframes: {
        rise: '{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
        fade: '{from{opacity:0}to{opacity:1}}',
        pop: '{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',
        popfast: '{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',
        flow: '{to{stroke-dashoffset:-95}}',
        spinslow: '{to{transform:rotate(360deg)}}',
      },
      durations: { rise: '180ms', fade: '180ms', pop: '180ms', popfast: '120ms', flow: '2.6s', spinslow: '1.2s' },
      timingFns: { rise: 'var(--ease)', fade: 'var(--ease)', pop: 'var(--ease)', popfast: 'var(--ease)', flow: 'linear', spinslow: 'linear' },
      properties: { rise: { 'animation-fill-mode': 'both' } },
      counts: { flow: 'infinite', spinslow: 'infinite' },
    },
  },

  rules: [],

  shortcuts: {
    /* ─── View + layout compositions ──────────────────────────
       Every responsive composition lives here, not in markup: the runtime
       extractor only compiles arbitrary variants ([&_td]:…) that come from
       this config, so any class string containing one must be a shortcut. */
    /* main + aside, 1.6 : 1 · stacks below lg */
    /* bordered cells, no gap · collapse to a hairline ladder on phones */
    'grid-flush-2': 'grid grid-cols-1 sm:grid-cols-2 [&>*+*]:border-t sm:[&>*+*]:border-t-0 lt-sm:[&>*]:!border-r-0',
    'grid-flush-3': 'grid grid-cols-1 sm:grid-cols-3 [&>*+*]:border-t sm:[&>*+*]:border-t-0 lt-sm:[&>*]:!border-r-0',
    /* icon · body · action row · the action drops below on phones */
    'grid-hero': 'grid items-center gap-4 grid-cols-[56px_minmax(0,1fr)] [&>*:last-child]:col-span-full [&>*:last-child]:justify-self-start sm:gap-6 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:[&>*:last-child]:col-auto sm:[&>*:last-child]:justify-self-auto',
    'pg-split': 'grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]',
    'kb-grid': 'grid grid-cols-1 gap-6 items-start lg:grid-cols-[248px_1fr]',
    /* wide table → stacked, labelled cards on phones (each td needs data-th) */
    'tbl-stack': 'lt-sm:block lt-sm:[&_thead]:hidden lt-sm:[&_tbody]:block lt-sm:[&_tbody_tr]:block lt-sm:[&_tbody_tr]:px-4 lt-sm:[&_tbody_tr]:py-3 lt-sm:[&_tbody_tr]:border-b lt-sm:[&_tbody_tr:last-child]:border-b-0 lt-sm:[&_td]:flex lt-sm:[&_td]:items-center lt-sm:[&_td]:justify-between lt-sm:[&_td]:gap-3 lt-sm:[&_td]:text-left lt-sm:[&_td]:!border-b-0 lt-sm:[&_td]:!px-0 lt-sm:[&_td]:!py-1 lt-sm:[&_td]:before:content-[attr(data-th)] lt-sm:[&_td]:before:font-mono lt-sm:[&_td]:before:text-[10px] lt-sm:[&_td]:before:uppercase lt-sm:[&_td]:before:tracking-wide lt-sm:[&_td]:before:text-ink-faint lt-sm:[&_td]:before:shrink-0 lt-sm:[&_.track]:!min-w-[96px] lt-sm:[&_.meter]:!min-w-[96px] lt-lg:[&_th]:!px-3 lt-lg:[&_th]:!py-2 lt-lg:[&_td]:!px-3 lt-lg:[&_td]:!py-2',

    'zs-h1': 'font-display font-normal text-2xl leading-tight tracking-tight text-ink',
    'zs-h2': 'font-display font-normal text-xl leading-tight tracking-tight text-ink',
    'zs-h3': 'font-display font-normal text-lg leading-snug text-ink',
    'zs-body': 'text-base leading-normal text-ink-soft',
    'zs-body-sm': 'text-sm leading-normal text-ink-soft',
    'zs-meta': 'font-mono text-xs text-ink-mute tabular-nums',
    'zs-eyebrow': 'text-xs tracking-wide uppercase text-ink-mute font-medium',
    'zs-kanji': 'font-kanji font-normal text-accent',
    mono: 'font-mono tabular-nums tracking-[-0.01em]',

    /* ─── Buttons ───────────────────────────────────────────── */
    'zs-btn': 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded border border-transparent bg-transparent text-ink cursor-pointer whitespace-nowrap leading-tight transition-[background-color,border-color,transform] duration-fast active:translate-y-[0.5px]',
    'zs-btn-secondary': 'border-ink text-ink hover:bg-paper-mute',
    /* variant / state names are composed at runtime ('zs-btn-' + variant),
       so they must exist here even though no literal uses them. */
    'zs-btn-primary': 'bg-ink text-paper hover:bg-ink-hover',
    'zs-btn-lg': 'px-4 py-3 text-sm',
    'zs-btn-ghost': 'text-ink-soft hover:bg-paper-mute hover:text-ink',
    'zs-btn-sm': 'px-3 py-1.5 text-xs',

    /* ─── Badges ────────────────────────────────────────────── */

    /* ─── Surfaces ──────────────────────────────────────────── */
    'zs-rule': 'h-px bg-paper-edge border-0 m-0',

    /* ─── Input ─────────────────────────────────────────────── */
    'zs-input': 'inline-flex items-center gap-2 px-3 py-2 w-full bg-paper-soft border rounded text-sm text-ink transition-colors duration-fast focus-within:border-ink [&_input]:flex-1 [&_input]:bg-transparent [&_input]:border-0 [&_input]:outline-none [&_input]:[font-size:inherit] [&_input]:text-inherit [&_input::placeholder]:text-ink-faint',

    /* ─── Status dots ───────────────────────────────────────── */

    /* ─── Tauri window chrome ───────────────────────────────── */
    'zs-chrome': 'h-[38px] flex items-center px-3.5 gap-2 shrink-0 border-b bg-paper',
    'zs-traffic': 'flex gap-2 [&>span]:block [&>span]:w-3 [&>span]:h-3 [&>span]:rounded-full [&>span:nth-child(1)]:bg-traffic-red [&>span:nth-child(2)]:bg-traffic-amber [&>span:nth-child(3)]:bg-traffic-green',
    'zs-chrome-title': 'flex-1 text-center text-xs text-ink-mute tracking-[0.02em] min-w-0 whitespace-nowrap overflow-hidden text-ellipsis',
    'zs-spin': 'animate-spinslow',

    /* ─── Window + shell ────────────────────────────────────── */
    win: 'fixed inset-0 flex flex-col overflow-hidden bg-paper',
    'win-body': 'flex-1 flex min-h-0',
    'chrome-tools': 'flex items-center gap-1',
    'chrome-btn': 'w-7 h-7 grid place-items-center rounded text-ink-mute transition-colors duration-fast hover:bg-paper-mute hover:text-ink',
    'rail-pad': 'py-4 px-3',
    'rail-label': 'px-3 pb-2 text-[10px] tracking-wide uppercase text-ink-mute font-medium',
    nav: 'flex items-center gap-3 w-full py-2 px-3 rounded text-left text-ink-soft text-sm transition-colors duration-fast hover:bg-paper-mute hover:text-ink [&.on]:bg-paper-mute [&.on]:text-ink [&.on]:font-medium [&_.ic]:w-[18px] [&_.ic]:h-[18px] [&_.ic]:shrink-0 [&_.ic]:grid [&_.ic]:place-items-center [&_.ic_img]:w-[18px] [&_.ic_img]:h-[18px] [&_.ic_img]:block [&_.lbl]:flex-1 [&_.lbl]:min-w-0 [&_.lbl]:whitespace-nowrap [&_.lbl]:overflow-hidden [&_.lbl]:text-ellipsis [&_.end]:font-mono [&_.end]:text-xs [&_.end]:text-ink-mute [&_.end]:tabular-nums [&.on_.end]:text-accent',
    org: 'flex items-center gap-3 p-3 border rounded-lg bg-paper-soft',
    'org-mark': 'w-[30px] h-[30px] shrink-0 rounded grid place-items-center bg-paper-mute text-ink font-display text-[15px]',
    daemon: 'mt-auto py-4 px-3 border-t font-mono text-[10px] text-ink-mute leading-[1.7]',
    view: 'flex-1 overflow-y-auto min-w-0',
    'page-hd': 'flex flex-wrap items-start justify-between gap-4 gap-x-6 mb-8 [&>:first-child]:flex-[1_1_340px] [&>:first-child]:min-w-0',
    sec: 'mt-12',
    'sec-hd': 'flex flex-wrap items-baseline justify-between gap-4 mb-4',

    /* ─── Cards ─────────────────────────────────────────────── */
    card: 'bg-paper-soft border rounded-lg',
    stat: 'p-6 [&_.num]:font-display [&_.num]:font-light [&_.num]:text-3xl [&_.num]:leading-none [&_.num]:tracking-tight [&_.unit]:text-sm [&_.unit]:text-ink-mute',

    /* ─── Pills / tags / status ─────────────────────────────── */
    pill: 'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border bg-paper-soft font-mono text-xs text-ink-soft tabular-nums whitespace-nowrap [&_img]:w-[13px] [&_img]:h-[13px] [&.accent]:border-line-accent [&.accent]:bg-accent-soft [&.accent]:text-accent [&.success]:border-line-success [&.success]:bg-success-soft [&.success]:text-success',
    exec: 'inline-flex items-center gap-1 h-5 px-2 rounded-sm border bg-paper-mute font-mono text-xs leading-none tracking-[0.01em] whitespace-nowrap text-ink-mute normal-case [&_img]:w-3 [&_img]:h-3 [&_.reg]:text-ink-faint',
    'exec-local': 'text-success bg-success-soft border-line-success',
    'env-chip': 'inline-flex items-center gap-2 h-[26px] px-2 rounded-full border bg-paper text-xs text-ink-soft whitespace-nowrap cursor-pointer transition-colors duration-fast hover:bg-paper-mute active:translate-y-[0.5px] [&_.env-lbl]:font-mono [&_.env-lbl]:text-xs [&_img]:w-3.5 [&_img]:h-3.5',
    'env-banner': 'flex items-center gap-2.5 px-3.5 py-2.5 rounded border bg-paper-mute text-sm leading-[1.45] text-ink [&.warn]:border-line-warning [&.warn]:bg-warning-soft',
    tag: 'inline-flex items-center gap-1 h-5 px-2 rounded-sm bg-paper-mute font-mono text-[10px] tracking-[0.04em] text-ink-mute whitespace-nowrap shrink-0',
    status: 'inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap',
    dot: 'w-1.5 h-1.5 rounded-full shrink-0 bg-ink-mute',
    pdot: 'inline-block w-2 h-2 rounded-full shrink-0',

    /* ─── Table (hairline rows) ─────────────────────────────── */
    tbl: 'w-full border-collapse [&_th]:text-left [&_th]:font-mono [&_th]:font-medium [&_th]:text-[10px] [&_th]:tracking-wide [&_th]:uppercase [&_th]:text-ink-mute [&_th]:px-4 [&_th]:py-3 [&_th]:border-b [&_th]:whitespace-nowrap [&_td]:px-4 [&_td]:py-3 [&_td]:border-b [&_td]:text-sm [&_td]:text-ink-soft [&_td]:align-middle [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-fast [&_tbody_tr.clickable]:cursor-pointer [&_tbody_tr.clickable:hover]:bg-paper-mute [&_tbody_tr.sel]:bg-paper-mute [&_tbody_tr:last-child_td]:border-b-0 [&_.num]:text-right [&_.num]:font-mono [&_.num]:tabular-nums [&_.mono]:font-mono [&_.mono]:tabular-nums',

    /* ─── Trace timeline ────────────────────────────────────── */
    trace: 'flex flex-col',
    tstep: 'relative pl-10 pb-4 last:pb-0 before:content-[""] before:absolute before:left-[13px] before:top-[26px] before:bottom-0 before:w-px before:bg-paper-edge last:before:hidden',
    tnode: 'absolute left-0 top-0 w-[27px] h-[27px] rounded grid place-items-center border bg-paper-soft [&_img]:w-[15px] [&_img]:h-[15px]',
    thead: 'font-mono text-[10px] tracking-wide uppercase text-ink-mute pt-1',
    tbody: 'text-sm leading-snug text-ink-soft mt-1 [&_b]:text-ink [&_b]:font-semibold [&_code]:font-mono [&_code]:text-xs [&_code]:bg-paper-mute [&_code]:px-1 [&_code]:py-px [&_code]:rounded-sm [&_code]:text-ink [&_code]:border',

    /* ─── Answer block ──────────────────────────────────────── */
    answer: 'border rounded-lg bg-paper overflow-hidden',
    'answer-hd': 'flex items-center gap-2 px-4 py-3 border-b bg-paper-soft font-mono text-[10px] tracking-wide uppercase text-ink-mute',
    'answer-bd': 'p-4 text-base leading-normal text-ink',
    cite: 'font-mono text-[9px] text-accent bg-accent-soft border border-line-accent rounded-[4px] px-1 py-px mx-px align-super leading-none',

    /* ─── Segmented control / toggles ───────────────────────── */
    seg: 'flex items-center gap-3 w-full px-2.5 py-2 rounded-lg border bg-paper text-left transition-[border-color,background-color] duration-fast hover:bg-paper-mute [&.on]:border-accent [&.on]:bg-accent-soft [&.on_.seg-ic]:bg-paper [&.on_.seg-ic]:border-line-accentstrong',
    'seg-ic': 'w-7 h-7 shrink-0 rounded grid place-items-center bg-paper-mute border [&_img]:w-[15px] [&_img]:h-[15px]',
    ctrl: 'flex items-center gap-3 px-0.5 py-2.5 border-t first:border-t-0',
    'ctrl-ic': 'w-[18px] h-[18px] shrink-0 [&_img]:w-[18px] [&_img]:h-[18px] [&_img]:opacity-85',
    sw: 'w-[34px] h-5 rounded-full shrink-0 bg-paper-mute border relative cursor-pointer transition-[background-color,border-color] after:content-[""] after:absolute after:top-px after:left-px after:w-4 after:h-4 after:rounded-full after:bg-paper after:shadow-sm after:transition-transform [&.on]:bg-accent [&.on]:border-accent [&.on]:after:translate-x-3.5',

    /* ─── Meters ────────────────────────────────────────────── */
    'meter-lbl': 'flex items-baseline justify-between mb-1.5 [&_.k]:font-mono [&_.k]:text-[10px] [&_.k]:tracking-[0.06em] [&_.k]:uppercase [&_.k]:text-ink-mute [&_.v]:font-mono [&_.v]:text-xs [&_.v]:font-medium [&_.v]:tabular-nums',
    meter: 'h-[5px] rounded-full bg-paper-mute overflow-hidden [&>i]:block [&>i]:h-full [&>i]:rounded-full [&>i]:transition-[width] [&>i]:duration-slow',
    track: 'h-1.5 rounded-full bg-paper-mute overflow-hidden [&>i]:block [&>i]:h-full [&>i]:rounded-full [&>i]:transition-[width] [&>i]:duration-slow',

    /* ─── Composer / inputs ─────────────────────────────────── */
    composer: 'flex items-center gap-3 px-3.5 py-2.5 border-t bg-paper-soft [&_input]:flex-1 [&_input]:bg-transparent [&_input]:border-0 [&_input]:outline-none [&_input]:text-sm [&_input]:text-ink [&_input::placeholder]:text-ink-faint',
    'tpl-row': 'flex items-center gap-2 w-full px-2 py-2 rounded text-left transition-colors duration-fast hover:bg-paper-mute',
    'tree-name': 'border border-transparent rounded-sm bg-transparent text-ink outline-none px-1 py-0.5 transition-[background-color,border-color] duration-fast hover:bg-paper-mute focus:border-accent focus:bg-paper',
    'tree-cap': 'border border-transparent rounded-sm bg-transparent text-ink outline-none px-1 py-0.5 transition-[background-color,border-color] duration-fast hover:bg-paper-mute focus:border-accent focus:bg-paper [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0',

    /* ─── Tabs ──────────────────────────────────────────────── */
    tabs: 'inline-flex max-w-full overflow-x-auto gap-0.5 p-1 bg-paper-mute rounded-lg [&.sm]:p-0.5 [&.sm]:rounded [&.sm_.tab]:px-2.5 [&.sm_.tab]:py-1 [&.sm_.tab]:text-xs [&.sm_.tab]:rounded-sm',
    tab: 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded text-sm text-ink-mute transition-colors duration-fast hover:text-ink [&.on]:bg-paper [&.on]:text-ink [&.on]:font-medium [&.on]:shadow-sm [&_img]:w-[15px] [&_img]:h-[15px]',
    rise: 'animate-rise',
    vrule: 'w-px self-stretch bg-paper-edge',

    /* ─── Classification badges ─────────────────────────────── */
    clf: 'inline-flex items-center gap-1 h-5 px-2 rounded-sm font-mono text-[10px] tracking-[0.04em] whitespace-nowrap border border-transparent [&_.d]:w-1.5 [&_.d]:h-1.5 [&_.d]:rounded-full',
    'clf-public': 'text-success bg-success-soft border-line-success [&_.d]:bg-success',
    'clf-internal': 'text-ink-mute bg-paper-mute border-paper-edge [&_.d]:bg-ink-mute',
    'clf-confidential': 'text-warning-ink bg-warning-soft border-line-warning [&_.d]:bg-warning',
    'clf-restricted': 'text-accent bg-accent-soft border-line-accentstrong [&_.d]:bg-accent',
    'clf-edit': 'relative cursor-pointer [&_select]:absolute [&_select]:inset-0 [&_select]:opacity-0 [&_select]:cursor-pointer [&_select]:w-full',

    /* ─── Library rows, chips, avatars ──────────────────────── */
    item: 'flex items-center gap-3 px-4 py-3 border-b cursor-pointer transition-colors duration-fast hover:bg-paper-mute [&.sel]:bg-paper-mute',
    'item-ic': 'w-[34px] h-[34px] shrink-0 rounded grid place-items-center bg-paper border',
    'item-main': 'flex items-center gap-3 flex-1 min-w-0 cursor-pointer',
    chip: 'inline-flex items-center gap-1 h-[19px] px-1.5 rounded-sm bg-paper border font-mono text-[10px] text-ink-mute whitespace-nowrap [&_img]:w-[11px] [&_img]:h-[11px]',
    ava: 'w-6 h-6 rounded-full grid place-items-center font-ui text-[10px] font-semibold text-ink bg-paper-mute border-[1.5px] border-paper-soft shrink-0',
    'ava-row': 'flex [&_.ava+.ava]:-ml-2',
    gcard: 'border rounded-lg bg-paper p-4 cursor-pointer flex flex-col gap-3 transition-[background-color,border-color] duration-fast hover:border-ink-faint [&.sel]:border-accent [&.sel]:bg-accent-soft',
    space: 'flex items-center gap-3 w-full px-2.5 py-2 rounded text-left text-ink-soft text-sm transition-colors duration-fast hover:bg-paper-mute hover:text-ink [&.on]:bg-paper-mute [&.on]:text-ink [&.on]:font-medium',
    glyph: 'grid place-items-center shrink-0 rounded bg-paper-mute border [&.accent]:bg-accent-soft [&.accent]:border-line-accentsoft',

    /* ─── Library index rail ────────────────────────────────── */
    'lib-rail': 'w-[216px] shrink-0 border-r py-4 px-3 overflow-y-auto flex flex-col',
    coll: 'flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left text-ink-soft text-sm cursor-pointer transition-colors duration-fast hover:bg-paper-mute hover:text-ink [&.on]:bg-paper-mute [&.on]:text-ink [&.on]:font-medium',
    dtag: 'inline-flex items-center h-[19px] px-2 rounded-full bg-paper-mute border font-mono text-[10px] text-ink-mute whitespace-nowrap [&.warn]:text-warning [&.warn]:bg-warning-soft [&.warn]:border-line-warning [&.ok]:text-success [&.ok]:bg-success-soft [&.ok]:border-line-success',
    'tag-btn': 'cursor-pointer transition-colors duration-fast hover:text-ink [&.on]:text-accent [&.on]:bg-accent-soft [&.on]:border-line-accentstrong',
    store: 'px-2',
    'store-bar': 'h-[5px] rounded-full bg-paper-mute overflow-hidden',
    'store-fill': 'block h-full rounded-full',
    ck: 'w-[18px] h-[18px] shrink-0 rounded-sm border-[1.5px] bg-paper cursor-pointer grid place-items-center transition-all duration-fast hover:border-ink-faint [&.on]:bg-accent [&.on]:border-accent',
    ing: 'inline-flex items-center gap-1 h-5 px-2 rounded-sm font-mono text-[10px] whitespace-nowrap border border-transparent [&_.dot]:w-1.5 [&_.dot]:h-1.5 [&_.dot]:rounded-full',
    'ing-ok': 'text-success bg-success-soft border-line-success',
    'ing-run': 'text-accent bg-accent-soft border-line-accentstrong',
    'ing-wait': 'text-ink-mute bg-paper-mute border-paper-edge',
    'ing-fail': 'text-warning bg-warning-soft border-line-warning',
    bulkbar: 'flex items-center gap-2 px-4 py-2 h-12 rounded bg-paper-soft border border-accent shadow',
    'bulk-act': 'relative inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded border bg-paper text-xs text-ink-soft cursor-pointer transition-colors duration-fast hover:bg-paper-mute [&.danger:hover]:text-warning [&.danger:hover]:border-line-warning [&_select]:absolute [&_select]:inset-0 [&_select]:opacity-0 [&_select]:cursor-pointer',

    /* ─── Document workspace ────────────────────────────────── */
    docws: 'flex flex-col h-full min-h-0',
    'docws-hd': 'flex items-center gap-3 px-8 py-4 border-b',
    'docws-ing': 'flex items-center gap-4 px-8 py-3 border-b bg-paper-soft',
    'docws-body': 'flex-1 min-h-0 overflow-hidden flex flex-col',
    'docws-pad': 'px-8 py-6 overflow-y-auto',
    'docws-preview': 'flex-1 min-h-0 flex',
    pipe: 'flex items-center gap-1.5',
    'pipe-node': 'flex items-center gap-1.5 [&.done_.pipe-dot]:bg-success [&.done_.pipe-dot]:border-success [&.cur_.pipe-dot]:border-accent [&.fail_.pipe-dot]:border-warning [&.fail_.pipe-dot]:bg-warning [&.cur_.pipe-lbl]:text-accent [&.done_.pipe-lbl]:text-ink-soft',
    'pipe-dot': 'w-[18px] h-[18px] rounded-full grid place-items-center border-[1.5px] bg-paper',
    'pipe-spin': 'w-[9px] h-[9px] rounded-full border-[1.5px] border-accent border-t-transparent',
    'pipe-lbl': 'font-mono text-xs text-ink-mute',
    'pipe-bar': 'w-5 h-[1.5px] bg-paper-edge [&.done]:bg-success',
    pq: 'w-16 h-[5px] rounded-full bg-paper-mute overflow-hidden',
    'pq-fill': 'block h-full bg-success rounded-full',
    'assets-rail': 'w-[220px] shrink-0 border-r py-4 px-3 overflow-y-auto',
    arow: 'flex items-center gap-2 w-full px-2 py-2 rounded text-left cursor-pointer text-ink-soft transition-colors duration-fast hover:bg-paper-mute [&.on]:bg-paper-mute [&.on_.arow-name]:text-accent',
    'arow-name': 'flex-1 min-w-0 font-mono text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis text-ink',
    'arow-b': 'text-[10px] text-ink-faint',
    'lineage-mini': 'mt-4 pt-3 border-t flex flex-col gap-0.5 pl-2 text-[10px]',
    'preview-main': 'flex-1 min-w-0 overflow-y-auto px-12 py-8',

    /* ─── Rendered markdown ─────────────────────────────────── */
    md: 'max-w-[680px] [&_code.ic]:font-mono [&_code.ic]:text-[0.86em] [&_code.ic]:bg-paper-mute [&_code.ic]:border [&_code.ic]:rounded-sm [&_code.ic]:px-1 [&_code.ic]:py-px [&_code.ic]:text-ink',
    'md-h2': 'font-display font-normal text-2xl leading-tight tracking-tight text-ink mt-0 mb-4 mx-0',
    'md-h3': 'font-display font-medium text-lg leading-[1.3] text-ink mt-6 mb-2 mx-0',
    'md-h4': 'font-ui font-semibold text-base text-ink mt-4 mb-2 mx-0',
    'md-p': 'font-ui font-normal text-base leading-[1.65] text-ink-soft mt-0 mb-3 mx-0 [text-wrap:pretty]',
    'md-ul': 'mt-0 mb-3 mx-0 pl-6 [&_li]:font-ui [&_li]:font-normal [&_li]:text-base [&_li]:leading-normal [&_li]:text-ink-soft [&_li]:mb-1',
    'md-pre': 'bg-paper-mute border rounded px-4 py-3 mt-0 mb-4 mx-0 overflow-x-auto [&_code]:font-mono [&_code]:text-sm [&_code]:text-ink',

    /* ─── Data grid ─────────────────────────────────────────── */
    'dgrid-wrap': 'max-w-[760px]',
    dgrid: 'w-full border-collapse border rounded overflow-hidden [&_th]:text-left [&_th]:font-ui [&_th]:font-semibold [&_th]:text-xs [&_th]:tracking-[0.04em] [&_th]:uppercase [&_th]:text-ink-mute [&_th]:px-3 [&_th]:py-2 [&_th]:bg-paper-soft [&_th]:border-b [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:font-ui [&_td]:font-normal [&_td]:text-sm [&_td]:text-ink-soft [&_td]:border-b [&_tr:last-child_td]:border-b-0 [&_td.k]:text-ink [&_td.k]:font-medium [&_td.num]:font-mono [&_td.num]:tabular-nums [&_tbody_tr:hover]:bg-paper-mute',
    'dgrid-foot': 'mt-2 text-xs text-ink-faint',

    /* ─── Figures + gallery ─────────────────────────────────── */
    fig: 'm-0 [&.big_.fig-canvas]:h-[300px]',
    'fig-canvas': 'h-[180px] rounded-lg border bg-paper-mute grid place-items-center mb-3 [&_.zs-kanji]:text-4xl [&_.zs-kanji]:text-ink-faint',
    'fig-cap': 'font-ui font-semibold text-sm text-ink mb-1',
    'fig-alt': 'text-xs text-ink-mute max-w-[520px] leading-[1.5]',
    gtile: 'border rounded overflow-hidden cursor-pointer bg-paper transition-colors duration-fast text-left hover:border-ink-faint [&.on]:border-accent',
    'gtile-canvas': 'h-[84px] bg-paper-mute grid place-items-center [&_.zs-kanji]:text-2xl [&_.zs-kanji]:text-ink-faint',
    'gtile-cap': 'block px-2 py-2 text-xs text-ink-soft leading-[1.35]',

    /* ─── Chunks, lineage, versions ─────────────────────────── */
    chunk: 'flex items-center gap-3 px-4 py-3 border-b last:border-b-0 [&.dropped]:opacity-60 [&.dropped_.score-fill]:bg-ink-faint',
    'chunk-id': 'text-[10.5px] text-ink-faint w-10 shrink-0',
    score: 'w-[70px] h-[5px] rounded-full bg-paper-mute overflow-hidden',
    'score-fill': 'block h-full bg-accent rounded-full',
    lineage: 'flex flex-col gap-3 max-w-[560px]',
    'lin-src': 'flex items-center gap-3 p-4 border rounded-lg bg-paper-soft',
    'lin-arrow': 'flex items-center gap-2 pl-4 text-ink-faint [&_img]:rotate-90 [&_.mono]:text-xs',
    'lin-outs': 'flex flex-col gap-px border rounded-lg overflow-hidden',
    'lin-out': 'flex items-center gap-2 px-4 py-3 border-b last:border-b-0 bg-paper',
    vtl: 'max-w-[560px]',
    vrow: 'flex items-center gap-3 px-4 py-3 border rounded mb-2 bg-paper [&.cur]:border-accent [&.cur]:bg-accent-soft [&.cur_.vdot]:bg-accent',
    vdot: 'w-2 h-2 rounded-full bg-ink-faint shrink-0',
    vver: 'text-xs text-ink w-[26px] shrink-0',

    /* ─── Workspace trigger + palette ───────────────────────── */
    'ws-trigger': 'flex items-center gap-3 p-3 border rounded-lg bg-paper-soft w-full cursor-pointer text-left transition-[background-color,border-color] duration-fast hover:bg-paper-mute hover:border-ink-faint [&_.org-mark]:font-mono [&_.org-mark]:text-xs [&_.org-mark]:font-semibold [&_.org-mark]:text-ink-soft [&:hover_.ws-switch]:bg-paper',
    'ws-switch': 'shrink-0 grid place-items-center w-5 h-5 rounded-sm',
    wsdot: 'w-[7px] h-[7px] rounded-full shrink-0',
    'wsdot-public': 'bg-success',
    'wsdot-internal': 'bg-ink-mute',
    'wsdot-confidential': 'bg-warning',
    'wsdot-restricted': 'bg-accent',
    'cmdk-backdrop': 'fixed inset-0 z-100 bg-scrim flex items-start justify-center pt-[12vh] animate-fade',
    cmdk: 'w-[min(640px,calc(100vw-48px))] max-h-[70vh] flex flex-col overflow-hidden bg-paper border rounded-lg shadow-lg animate-pop',
    'cmdk-search': 'flex items-center gap-3 px-6 py-4 border-b [&_input]:flex-1 [&_input]:border-0 [&_input]:outline-none [&_input]:bg-transparent [&_input]:font-ui [&_input]:font-normal [&_input]:text-lg [&_input]:leading-[1.3] [&_input]:text-ink [&_input::placeholder]:text-ink-faint',
    'cmdk-list': 'overflow-y-auto p-3',
    'cmdk-empty': 'p-8 text-center text-ink-mute text-sm',
    'cmdk-group': '[.cmdk-group+&]:mt-3',
    'cmdk-grouphd': 'flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] tracking-wide uppercase text-ink-mute font-medium',
    'cmdk-grouphint': 'font-mono text-[9.5px] tracking-normal normal-case text-ink-faint',
    'cmdk-row': 'flex items-center gap-3 w-full px-2.5 py-2 rounded cursor-pointer text-left border border-transparent bg-transparent [&.active]:bg-paper-mute [&.active]:border-paper-edge [&.active_.cmdk-mark]:bg-accent-soft [&.active_.cmdk-mark]:text-accent',
    'cmdk-mark': 'w-[30px] h-[30px] shrink-0 rounded grid place-items-center bg-paper-mute font-mono text-xs font-semibold text-ink-soft',
    'cmdk-main': 'flex-1 min-w-0',
    'cmdk-name': 'flex items-center gap-2 text-sm font-semibold text-ink',
    'cmdk-cur': 'font-mono text-[9px] uppercase tracking-[0.08em] text-accent bg-accent-soft rounded-sm px-1 py-px',
    'cmdk-desc': 'block text-[11.5px] text-ink-mute whitespace-nowrap overflow-hidden text-ellipsis mt-px',
    'cmdk-meta': 'font-mono text-[10px] text-ink-faint whitespace-nowrap shrink-0',
    'cmdk-foot': 'flex items-center gap-4 px-6 py-2.5 border-t bg-paper-soft text-xs text-ink-mute [&_.kbd]:mr-1',

    /* ─── Workflows ─────────────────────────────────────────── */
    'wf-trig': 'w-[38px] h-[38px] shrink-0 rounded grid place-items-center bg-paper-mute [&.schedule]:bg-schedule [&.event]:bg-accent-soft [&.manual]:bg-paper-mute',
    'wf-card': 'flex flex-col gap-3 p-6 bg-paper-soft border rounded-lg text-left cursor-pointer transition-[border-color,background-color] duration-fast hover:border-ink-faint hover:bg-paper [&.paused]:opacity-70',
    'wf-steps-mini': 'flex items-center gap-1 flex-wrap',
    'wf-pip': 'inline-flex items-center justify-center w-6 h-6 rounded-sm bg-paper-mute border',
    'wf-pip-arrow': 'text-ink-faint text-xs',
    'wf-stat': 'inline-flex items-center gap-1.5 text-xs whitespace-nowrap [&_.dot]:w-[7px] [&_.dot]:h-[7px] [&_.dot]:rounded-full',
    'wf-preview-badge': 'font-mono text-[9px] uppercase tracking-[0.08em] text-accent bg-accent-soft border border-line-accentstrong rounded-sm px-1.5 py-px',
    'wf-list': 'max-w-[720px]',
    'wf-step': 'relative flex items-start gap-3 p-4 bg-paper border rounded-lg [&.trigger]:bg-paper-soft [&.trigger]:border-dashed',
    'wf-conn': 'flex items-center justify-center h-[22px] [&_.line]:w-0.5 [&_.line]:h-full [&_.line]:bg-paper-edge',
    'wf-stepic': 'w-8 h-8 shrink-0 rounded grid place-items-center bg-paper-mute border',
    'wf-stepnum': 'font-mono text-[10px] text-ink-faint',
    'wf-addbtn': 'inline-flex items-center gap-1 h-6 px-2 rounded-full border border-dashed bg-paper text-xs text-ink-mute cursor-pointer hover:text-accent hover:border-line-accentbold',
    'wf-fork': 'ml-11 mt-2 px-4 py-3 border-l-2 border-warning rounded-r bg-warning-soft',
    'wf-canvas': 'relative overflow-auto border rounded-lg bg-paper-soft p-1 bg-[radial-gradient(circle,oklch(0.22_0.012_50_/_0.05)_1px,transparent_1px)] bg-[length:18px_18px]',
    'wf-canvas-inner': 'relative',
    'wf-node': 'absolute w-[188px] box-border px-3 py-2.5 bg-paper border rounded shadow-sm cursor-default transition-[border-color,box-shadow] duration-fast hover:border-ink-faint hover:shadow hover:z-5 [&.trigger]:border-dashed [&.trigger]:bg-paper-soft [&.branch]:border-line-warningstrong [&.fail]:border-line-warningstrong [&.fail]:bg-warning-soft [&.output]:border-line-successstrong',
    'wf-node-hd': 'flex items-center gap-2 mb-1',
    'wf-node-ic': 'w-[22px] h-[22px] rounded-sm grid place-items-center bg-paper-mute shrink-0',
    'wf-node-kind': 'font-mono text-[9px] uppercase tracking-[0.06em] text-ink-faint',
    'wf-node-title': 'text-xs font-semibold text-ink leading-[1.3]',
    'wf-node-detail': 'font-mono text-[9.5px] text-ink-mute mt-1 leading-[1.35]',
    'wf-edge-label': 'absolute font-mono text-[9px] px-1 py-px bg-paper border rounded-sm text-ink-mute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap',
    'wf-tabs': 'flex gap-6 border-b',
    'wf-tab': 'relative px-0.5 py-2.5 text-sm text-ink-mute cursor-pointer border-0 whitespace-nowrap hover:text-ink-soft [&.on]:text-ink [&.on]:font-medium [&.on]:after:content-[""] [&.on]:after:absolute [&.on]:after:left-0 [&.on]:after:right-0 [&.on]:after:-bottom-px [&.on]:after:h-0.5 [&.on]:after:bg-accent',
    'wf-run': 'flex items-center gap-3 w-full px-4 py-3 border-b last:border-b-0 text-left bg-transparent cursor-pointer hover:bg-paper-mute [&.sel]:bg-paper-mute',
    'wf-edit-title': 'w-full border-0 bg-transparent outline-none px-1 py-0.5 -ml-1 rounded-sm font-ui font-semibold text-sm leading-[1.35] text-ink focus:bg-paper-mute focus:shadow-[inset_0_0_0_1px_var(--paper-edge)] placeholder:text-ink-faint',
    'wf-edit-detail': 'w-full border-0 bg-transparent outline-none px-1 py-px -ml-1 rounded-sm font-ui font-normal text-sm leading-[1.35] text-ink-soft focus:bg-paper-mute focus:shadow-[inset_0_0_0_1px_var(--paper-edge)] placeholder:text-ink-faint',
    'wf-typesel': 'h-[22px] border bg-paper rounded-sm font-mono font-medium text-[10px] text-ink-soft px-1 cursor-pointer outline-none',
    'wf-step-ctrl': 'flex flex-col gap-1 shrink-0',
    'wf-mini-btn': 'w-6 h-[22px] border bg-paper rounded-sm grid place-items-center cursor-pointer text-ink-mute text-xs leading-none hover:bg-paper-mute hover:text-ink disabled:opacity-40 disabled:cursor-default',
    'wf-addmenu': 'absolute top-[calc(100%+4px)] left-0 z-20 min-w-[184px] bg-paper border rounded shadow p-1 [&_button]:flex [&_button]:items-center [&_button]:gap-2 [&_button]:w-full [&_button]:px-2 [&_button]:py-2 [&_button]:border-0 [&_button]:bg-transparent [&_button]:rounded-sm [&_button]:cursor-pointer [&_button]:text-sm [&_button]:text-ink [&_button]:text-left [&_button:hover]:bg-paper-mute',
    'wf-dialog': 'w-[min(480px,calc(100vw-48px))] bg-paper border rounded-lg shadow-lg overflow-hidden animate-pop',
    'wf-dialog-bd': 'p-6 flex flex-col gap-4',
    'wf-field-lbl': 'text-[10px] tracking-wide uppercase text-ink-mute font-medium mb-1.5',
    'wf-text': 'w-full box-border h-[38px] px-3 border rounded bg-paper-soft font-ui font-normal text-base text-ink outline-none focus:border-ink-faint focus:bg-paper',
    'wf-sel': 'w-full box-border h-[38px] px-2.5 border rounded bg-paper-soft font-ui font-normal text-sm text-ink cursor-pointer outline-none',
    'wf-pop': 'absolute top-[calc(100%+6px)] right-0 z-40 w-[300px] bg-paper border rounded shadow p-3 animate-popfast',
    'wf-scope': 'flex items-start gap-3 w-full text-left px-2.5 py-2 rounded border border-transparent bg-transparent cursor-pointer hover:bg-paper-mute [&.on]:bg-accent-soft [&.on]:border-line-accentstrong',
    'wf-scope-t': 'text-sm font-semibold text-ink',
    'wf-scope-d': 'text-xs text-ink-mute mt-px',

    /* ─── Admin top bar (Seiki) ─────────────────────────────── */
    atop: 'flex items-center gap-3 border-b bg-paper shrink-0',
    'atop-org': 'flex items-center gap-3 shrink-0',
    'atop-nav': 'flex items-center gap-0.5 min-w-0',
    'atop-dot': 'w-px h-[18px] bg-paper-edge mx-1.5 shrink-0',
    atab: 'inline-flex items-center gap-2 h-[30px] px-2.5 rounded text-ink-soft text-sm whitespace-nowrap shrink-0 transition-colors duration-fast hover:bg-paper-mute hover:text-ink [&.on]:bg-paper-mute [&.on]:text-ink [&.on]:font-medium',
    'atop-more': 'relative shrink-0',
    'atop-scrim': 'fixed inset-0 z-60',
    'atop-menu': 'absolute top-[calc(100%+6px)] right-0 z-61 min-w-[208px] bg-paper border rounded shadow p-1',
    'atop-mi': 'flex items-center gap-2 w-full px-2.5 py-2 rounded-sm text-sm text-ink-soft text-left transition-colors duration-fast hover:bg-paper-mute hover:text-ink [&.on]:bg-paper-mute [&.on]:text-ink [&.on]:font-medium',

    /* ─── Spaces · knowledge base ───────────────────────────── */
    'kb-space': 'flex items-center gap-2.5 w-full px-2.5 py-2 rounded transition-colors duration-fast hover:bg-paper-mute [&.on]:bg-paper-mute [&.on]:shadow-[inset_2px_0_0_var(--accent)]',

    /* ─── Compare ───────────────────────────────────────────── */
    'cmp-win': 'shadow-[inset_0_2px_0_var(--accent)]',
    'cmp-add': 'flex flex-col items-center justify-center gap-2 min-w-[150px] border border-dashed rounded-lg text-ink-mute text-sm relative cursor-pointer transition-[background-color,border-color] duration-fast hover:bg-paper-mute hover:border-ink-mute',

    /* ─── Sign-in ───────────────────────────────────────────── */
    'sgn-root': 'fixed inset-0 bg-paper overflow-auto',
    'sgn-wrap': 'max-w-[1100px] mx-auto px-[clamp(20px,5vw,48px)] py-12',
    'sgn-head': 'pb-2 border-b',
    'sgn-head-row': 'flex items-center justify-between gap-4 flex-wrap',
    'sgn-intro': 'min-w-0',
    'sgn-main': 'flex justify-center min-w-0',
    'sgn-graphic': 'w-full h-auto block',
    'sgn-value': 'flex flex-col gap-4 mt-8',
    'sgn-value-row': 'grid grid-cols-[36px_1fr] gap-3 items-start',
    'sgn-value-ic': 'w-9 h-9 rounded grid place-items-center bg-paper-soft border',
    'sgn-flow': '[stroke-dasharray:5_90] [stroke-dashoffset:0] motion-safe:animate-flow',
  },

  /* Element-level resets — the only things a utility class cannot target. */
  preflights: [
    {
      getCSS: () => `
        html, body { margin: 0; padding: 0; height: 100%; }
        body { background: var(--paper); }
        /* This preflight REPLACES the preset reset, so it must carry the two
           rules everything depends on: box-sizing (without it w-full + px-*
           overflows) and border-style/width (without it every border utility
           silently collapses). */
        *, ::before, ::after { box-sizing: border-box; border-style: solid; border-width: 0; border-color: var(--paper-edge); }
        html, body { margin: 0; padding: 0; height: 100%; }
        body { background: var(--paper); font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.6; color: var(--ink); }
        /* Element resets. Everything a utility could also target is wrapped in
           :where() → zero specificity, so shortcuts and utilities always win and
           the system needs no important. (html/body and ::-webkit-scrollbar are
           not — no utility can target them.) */
        :where(.zs), :where(.zs *), :where(.zs *)::before, :where(.zs *)::after {
          box-sizing: border-box; border: 0 solid var(--paper-edge);
        }
        :where(.zs) {
          font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.6;
          color: var(--ink); background: var(--paper);
          -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
        }
        :where(.zs button) { font: inherit; color: inherit; background: none; padding: 0; cursor: pointer; }
        :where(.zs input, .zs textarea, .zs select) { font: inherit; color: inherit; }
        :where(.zs a) { color: inherit; text-decoration: none; }
        :where(.zs a:hover) { color: var(--accent); }
        :where(.zs h1, .zs h2, .zs h3, .zs h4, .zs p) { margin: 0; }
        :where(.zs h1) { font-family: var(--font-display); font-weight: 400; font-size: var(--text-2xl); line-height: 1.2; letter-spacing: -0.02em; }
        :where(.zs h2) { font-family: var(--font-display); font-weight: 400; font-size: var(--text-xl); line-height: 1.2; letter-spacing: -0.02em; }
        :where(.zs h3) { font-family: var(--font-display); font-weight: 400; font-size: var(--text-lg); line-height: 1.4; }
        :where(.zs button:focus-visible, .zs a:focus-visible) { outline: 1.5px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
        .zs ::-webkit-scrollbar { width: 6px; height: 6px; }
        .zs ::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
        .zs:hover ::-webkit-scrollbar-thumb { background: oklch(0.5 0.01 50 / 0.2); }
        :where(.zs input[type=range]) { appearance: none; -webkit-appearance: none; width: 100%; height: 4px; border-radius: 9999px; background: var(--paper-mute); cursor: pointer; }
        .zs input[type=range]::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); border: 2px solid var(--paper); box-shadow: var(--shadow-sm); }
        :where(.zs input[type=range]:disabled) { opacity: 0.5; }
      `,
    },
  ],

  safelist: ['lt-lg:translate-x-0', 'lt-lg:shadow-lg', 'lt-lg:-translate-x-[102%]'],

  /* Font manifest — exactly what app/fonts.css loads and the only weights the
     system may use. Mirrors theme.fontWeight; read this directly at handoff. */
  fonts: [
    { pkg: '@fontsource/fraunces', family: 'Fraunces', token: 'font-display', subset: 'latin', weights: [300, 400, 500] },
    { pkg: '@fontsource/inter', family: 'Inter', token: 'font-ui', subset: 'latin', weights: [400, 500, 600] },
    { pkg: '@fontsource/jetbrains-mono', family: 'JetBrains Mono', token: 'font-mono', subset: 'latin', weights: [400, 500] },
    { pkg: '@fontsource/shippori-mincho', family: 'Shippori Mincho', token: 'font-kanji', subset: 'japanese', weights: [400, 500, 600, 700] },
  ],
};

/* Runtime integration only — a build-time Uno needs neither line. */
if (typeof window !== 'undefined') window.__unocss = config;
if (typeof module !== 'undefined' && module.exports) module.exports = config;
})();
