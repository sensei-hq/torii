/* Torii · atoms.jsx — shared interactive atoms.
   Exposes window.StrategosUI. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { PROVIDER_HUE } = window.StrategosAPI;

  function Switch({ on, onClick, label }) {
    return React.createElement('button', {
      type: 'button', role: 'switch', 'aria-checked': !!on, 'aria-label': label,
      onClick, className: 'sw' + (on ? ' on' : ''),
    });
  }

  function ProviderDot({ provider, size = 8 }) {
    return React.createElement('span', {
      className: 'pdot',
      style: { width: size, height: size, background: PROVIDER_HUE[provider] || PROVIDER_HUE.local },
    });
  }

  // tone → fill color for meters
  const METER_TONE = {
    accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)',
    ink: 'var(--ink)', mute: 'var(--ink-mute)',
  };

  function Meter({ label, value, max = 100, display, tone = 'ink', hint }) {
    const pct = Math.max(2, Math.min(100, (value / max) * 100));
    const col = METER_TONE[tone] || tone;
    return React.createElement('div', null,
      React.createElement('div', { className: 'meter-lbl' },
        React.createElement('span', { className: 'k' }, label),
        React.createElement('span', { className: 'v', style: { color: col } }, display),
      ),
      React.createElement('div', { className: 'meter' },
        React.createElement('i', { style: { width: pct + '%', background: col } })),
      hint && React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 4 } }, hint),
    );
  }

  function Pill({ children, kind, icon, className, style, ...rest }) {
    const TONE = { accent: 'border-line-accent bg-accent-soft text-accent', success: 'border-line-success bg-success-soft text-success' };
    return React.createElement('span', Object.assign({ style, className: 'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border bg-paper-soft font-mono text-xs text-ink-soft tabular-nums whitespace-nowrap ' + (TONE[kind] || '') + ' ' + (className || '') }, rest),
      icon && React.createElement(Icon, { name: icon, size: 13, tone: kind === 'accent' ? 'accent' : kind === 'success' ? 'success' : 'mute' }),
      children);
  }

  function Tag({ children, className, style, ...rest }) {
    return React.createElement('span', Object.assign({ style, className: 'inline-flex items-center gap-1 h-5 px-2 rounded-sm bg-paper-mute font-mono text-[10px] tracking-[0.04em] text-ink-mute whitespace-nowrap shrink-0 ' + (className || '') }, rest), children);
  }

  // a control row with icon + title + sub + a trailing control (switch)
  function CtrlRow({ icon, title, sub, active, children }) {
    return React.createElement('div', { className: 'ctrl' },
      React.createElement('span', { className: 'ctrl-ic' }, React.createElement(Icon, { name: icon, size: 18, tone: active ? 'accent' : 'mute' })),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 'var(--text-sm)', fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-soft)' } }, title),
        React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 1 } }, sub),
      ),
      children);
  }

  // execution-location badge: where a call ran (on-device vs via the gateway).
  // local calls never leave the machine; cloud calls carry the pinned region.
  function ExecBadge({ local, region = 'eu-west-2', verb = false }) {
    const label = local
      ? (verb ? 'ran on your device' : 'on your device')
      : (verb ? 'via gateway' : 'gateway');
    return React.createElement('span', {
      className: 'exec' + (local ? ' exec-local' : ''),
      title: local ? 'Executed on-device · no external call' : 'Executed via gateway · region ' + region,
    },
      React.createElement(Icon, { name: local ? 'models' : 'globe', size: 12, tone: local ? 'success' : 'mute' }),
      React.createElement('span', null, label),
      !local && React.createElement('span', { className: 'reg' }, '· ' + region),
    );
  }

  /* ── execution environment (prototype state: desktop / offline / web) ──
     Torii on the desktop can run models on-device; Torii in a browser cannot,
     and an offline desktop buffers calls and falls back to local models. A
     single switchable state drives every device/sync/offline affordance. */
  const ENV_ORDER = ['desktop', 'offline', 'web'];
  let _env = 'desktop';
  try { _env = localStorage.getItem('zs-env') || 'desktop'; } catch (e) {}
  const _envListeners = new Set();
  function envMeta(v) {
    v = v || _env;
    const web = v === 'web';
    const online = v !== 'offline';
    return {
      id: v, web, desktop: !web, online,
      label: web ? 'Web' : v === 'offline' ? 'Desktop · offline' : 'Desktop',
      sync: online ? 'synced' : 'offline · buffering',
      config: 'v412',
      buffer: online ? 0 : 3,        // calls queued to report
      localModels: web ? 0 : 2,      // models available on this device
      localDefault: 'gemma-4-9b',
    };
  }
  const StrategosEnv = {
    get: () => _env,
    meta: (v) => envMeta(v),
    set(v) { _env = v; try { localStorage.setItem('zs-env', v); } catch (e) {} _envListeners.forEach((f) => f(v)); },
    cycle() { const i = ENV_ORDER.indexOf(_env); this.set(ENV_ORDER[(i + 1) % ENV_ORDER.length]); },
    subscribe(fn) { _envListeners.add(fn); return () => _envListeners.delete(fn); },
  };
  function useEnv() {
    const [v, setV] = React.useState(StrategosEnv.get());
    React.useEffect(() => StrategosEnv.subscribe(setV), []);
    return { env: v, meta: envMeta(v), set: (x) => StrategosEnv.set(x), cycle: () => StrategosEnv.cycle() };
  }

  // chrome switcher — cycles desktop → offline → web (prototype affordance)
  function EnvChip() {
    const { meta, cycle } = useEnv();
    return React.createElement('button', {
      className: 'env-chip', onClick: cycle, type: 'button',
      title: 'Simulate environment · desktop / offline / web',
    },
      React.createElement(Icon, { name: meta.web ? 'globe' : 'models', size: 14, tone: meta.online ? (meta.web ? 'mute' : 'success') : 'warning' }),
      React.createElement('span', { className: 'env-lbl' }, meta.label),
      React.createElement('span', { className: 'dot', style: { background: meta.online ? 'var(--success)' : 'var(--warning)' } }),
    );
  }

  // rail footer — sync state, config version, offline buffer, local-model count
  function DeviceFooter({ scope = 'member', spaces, items }) {
    const { meta } = useEnv();
    const admin = scope === 'admin';
    const line1 = admin
      ? React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'dot', style: { background: meta.online ? 'var(--success)' : 'var(--warning)' } }),
          React.createElement('span', null, meta.online ? 'gateway · healthy' : 'gateway · unreachable'))
      : React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'dot', style: { background: meta.online ? 'var(--success)' : 'var(--warning)' } }),
          React.createElement('span', null, meta.online ? meta.sync + ' · config ' + meta.config : meta.sync));
    let line2;
    if (admin) {
      line2 = '4 of 6 routers connected · config ' + meta.config;
    } else if (meta.web) {
      line2 = 'in a browser · local models need Torii for desktop';
    } else {
      line2 = meta.localModels + ' models on device · embeddings on-device' + (meta.buffer ? ' · ' + meta.buffer + ' calls queued' : '');
    }
    return React.createElement('div', { className: 'daemon' },
      React.createElement('div', { className: 'flex items-center gap-2' }, line1),
      React.createElement('div', { style: { color: 'var(--ink-faint)', marginTop: 2 } }, line2),
    );
  }

  // inline status pill — "X models on device" / "Web · no local models" / offline
  function DevicePill() {
    const { meta } = useEnv();
    const label = meta.web ? 'Browser · no local models'
      : meta.online ? meta.localModels + ' models on device'
      : 'Offline · ' + meta.localModels + ' local · ' + meta.buffer + ' queued';
    const cls = 'pill' + (meta.web ? '' : meta.online ? ' success' : '');
    const style = (!meta.web && !meta.online) ? { color: 'var(--warning)', background: 'var(--warning-soft)', borderColor: 'oklch(0.72 0.12 75 / 0.30)' } : undefined;
    return React.createElement('span', { className: cls, style },
      React.createElement(Icon, { name: meta.web ? 'globe' : 'models', size: 13, tone: meta.web ? 'mute' : meta.online ? 'success' : 'warning' }),
      label);
  }

  // offline notice (desktop, no cloud) — answering with the local model
  function OfflineBanner({ context = 'ask' }) {
    const { meta } = useEnv();
    if (meta.online) return null;
    const msg = context === 'playground'
      ? 'Cloud unreachable — the pipeline runs against the local model. Cloud-only models are disabled until you reconnect.'
      : 'Cloud models unavailable — answering on-device with ' + meta.localDefault + '. Nothing leaves this machine.';
    return React.createElement('div', { className: 'env-banner warn' },
      React.createElement(Icon, { name: 'bolt', size: 16, tone: 'warning' }),
      React.createElement('span', { style: { flex: 1 } }, msg),
      React.createElement('span', { className: 'exec exec-local' },
        React.createElement(Icon, { name: 'models', size: 12, tone: 'success' }), 'on your device'));
  }

  // desktop-only notice for Torii in a browser
  function DesktopOnlyNote({ feature = 'Local models' }) {
    const { meta } = useEnv();
    if (!meta.web) return null;
    return React.createElement('div', { className: 'env-banner' },
      React.createElement(Icon, { name: 'globe', size: 16, tone: 'mute' }),
      React.createElement('span', { style: { flex: 1 } }, feature + ' need Torii for desktop. In a browser, every call runs via the gateway.'));
  }

  // model picker (compact select styled)
  function ModelPicker({ value, onChange }) {
    const { MODELS } = window.StrategosAPI;
    return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)' } },
      React.createElement(ProviderDot, { provider: (window.StrategosAPI.modelById(value) || {}).provider, size: 7 }),
      React.createElement('select', {
        value, onChange: (e) => onChange(e.target.value),
        style: { border: 'none', outline: 'none', background: 'transparent', font: '500 12px var(--font-mono)', color: 'var(--ink)', cursor: 'pointer' },
      }, MODELS.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.id))),
    );
  }

  /* ── preferred-model pin (persisted) ───────────────────────────────
     A member can pin a model so the gateway stops auto-routing for them.
     Empty string = "let the gateway choose". */
  const PIN_KEY = 'zs-pinned-model';
  const _pinListeners = new Set();
  function getPinnedModel() { try { return localStorage.getItem(PIN_KEY) || ''; } catch (e) { return ''; } }
  function setPinnedModel(id) {
    try { if (id) localStorage.setItem(PIN_KEY, id); else localStorage.removeItem(PIN_KEY); } catch (e) {}
    _pinListeners.forEach((f) => f(id));
  }
  function usePinnedModel() {
    const [v, setV] = React.useState(getPinnedModel());
    React.useEffect(() => { _pinListeners.add(setV); return () => _pinListeners.delete(setV); }, []);
    return [v, setPinnedModel];
  }

  /* ── saved snippets (persisted) ────────────────────────────────────
     Members can keep an answer as a reusable snippet. Keyed by source so
     the save control can show an already-saved state. */
  const SNIP_KEY = 'zs-snippets';
  const _snipListeners = new Set();
  function getSnippets() { try { return JSON.parse(localStorage.getItem(SNIP_KEY) || '[]'); } catch (e) { return []; } }
  function isSnippetSaved(key) { return getSnippets().some((s) => s.key === key); }
  function saveSnippet(s) {
    const all = getSnippets();
    if (!all.some((x) => x.key === s.key)) all.unshift(Object.assign({ id: 's-' + Date.now(), at: Date.now() }, s));
    try { localStorage.setItem(SNIP_KEY, JSON.stringify(all.slice(0, 50))); } catch (e) {}
    _snipListeners.forEach((f) => f());
    return all;
  }
  function useSnippets() {
    const [, force] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => { _snipListeners.add(force); return () => _snipListeners.delete(force); }, []);
    return getSnippets();
  }
  function SaveSnippetButton({ snippet, label = 'Save snippet' }) {
    const [saved, setSaved] = React.useState(() => isSnippetSaved(snippet.key));
    React.useEffect(() => { setSaved(isSnippetSaved(snippet.key)); }, [snippet.key]);
    return React.createElement('button', {
      className: 'zs-btn zs-btn-ghost zs-btn-sm', onClick: () => { if (saved) return; saveSnippet(snippet); setSaved(true); },
    },
      React.createElement(Icon, { name: saved ? 'check' : 'citation', size: 13, tone: saved ? 'success' : 'soft' }),
      saved ? 'Saved to snippets' : label);
  }

  /* ── generic persisted list store (sessions, member templates) ─────── */
  function listStore(key) {
    const listeners = new Set();
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } };
    const write = (arr) => { try { localStorage.setItem(key, JSON.stringify(arr.slice(0, 50))); } catch (e) {} listeners.forEach((f) => f()); };
    return {
      read,
      add(item) { const a = read(); a.unshift(Object.assign({ id: key + '-' + Date.now(), at: Date.now() }, item)); write(a); return a; },
      remove(id) { write(read().filter((x) => x.id !== id)); },
      use() { const [, f] = React.useReducer((x) => x + 1, 0); React.useEffect(() => { listeners.add(f); return () => listeners.delete(f); }, []); return read(); },
    };
  }
  const Sessions = listStore('zs-pg-sessions');     // saved Playground pipelines
  const MyTemplates = listStore('zs-my-templates');  // member-contributed prompt templates

  // in-memory handoff so one view can launch another with a preset (no reload)
  const Handoff = { _v: null, set(v) { this._v = v; }, take() { const v = this._v; this._v = null; return v; } };

  /* ── routing explanation panel ─────────────────────────────────────
     Makes auto-routing legible: which model answered, why, what it cost,
     and a control to pin it. Reused by Ask and Playground. */
  function RoutingPanel({ modelId, reason, callCost = 0, pinned, onTogglePin, exec }) {
    const m = window.StrategosAPI.modelById(modelId) || {};
    const { money } = window.StrategosAPI;
    const costLabel = callCost === 0 ? 'free' : '$' + callCost.toFixed(callCost < 0.1 ? 3 : 2);
    const factor = (k, v) => React.createElement('div', null,
      React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)' } }, k),
      React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)', marginTop: 2, fontVariantNumeric: 'tabular-nums' } }, v));
    return React.createElement('div', { className: 'rise', style: { background: 'var(--paper-soft)', borderBottom: '1px solid var(--paper-edge)', padding: '16px' } },
      React.createElement('div', { className: 'flex items-center gap-2', style: { marginBottom: 8, flexWrap: 'wrap' } },
        React.createElement(ProviderDot, { provider: m.provider, size: 8 }),
        React.createElement('span', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' } }, modelId),
        m.tier && React.createElement('span', { className: 'tag' }, m.tier),
        pinned && React.createElement('span', { className: 'pill accent' }, React.createElement(Icon, { name: 'pin', size: 12, tone: 'accent' }), 'pinned'),
        React.createElement('span', { className: 'flex-1' }),
        exec && React.createElement(ExecBadge, Object.assign({ verb: true }, exec))),
      React.createElement('div', { style: { fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 12 } }, reason),
      React.createElement('div', { className: 'grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))]', style: { paddingTop: 12, borderTop: '1px solid var(--paper-edge)' } },
        factor('Tier', m.tier || '—'),
        factor('Quality', m.q != null ? m.q + '' : '—'),
        factor('Latency', m.lat ? (m.lat / 1000).toFixed(1) + 's' : '—'),
        factor('Price', m.price != null ? money(m.price, 2) + '/M' : '—'),
        factor('This call', costLabel)),
      onTogglePin && React.createElement('button', { className: 'zs-btn zs-btn-secondary zs-btn-sm', style: { marginTop: 12 }, onClick: onTogglePin },
        React.createElement(Icon, { name: 'pin', size: 13, tone: pinned ? 'accent' : 'soft' }),
        pinned ? 'Unpin — let the gateway choose' : 'Pin ' + modelId + ' as my default'));
  }

  /* ── active workspace (persisted) ──────────────────────────────────
     One global scope the member works inside — company / department /
     team / personal. Drives Library, Ask, Activity, Playground, Home.
     openSwitcher() lets any view summon the command palette. */
  const WS_KEY = 'zs-workspace';
  let _ws = 'leasing';
  try { _ws = localStorage.getItem(WS_KEY) || 'leasing'; } catch (e) {}
  if (!window.StrategosAPI.wsById(_ws) || window.StrategosAPI.wsById(_ws).id !== _ws) _ws = 'leasing';
  const _wsListeners = new Set();
  const _wsOpenListeners = new Set();
  const StrategosWorkspace = {
    get: () => _ws,
    ws: () => window.StrategosAPI.wsById(_ws),
    set(id) { if (!window.StrategosAPI.wsById(id)) return; _ws = id; try { localStorage.setItem(WS_KEY, id); } catch (e) {} _wsListeners.forEach((f) => f(id)); },
    subscribe(fn) { _wsListeners.add(fn); return () => _wsListeners.delete(fn); },
    openSwitcher() { _wsOpenListeners.forEach((f) => f()); },
    onOpenRequest(fn) { _wsOpenListeners.add(fn); return () => _wsOpenListeners.delete(fn); },
  };
  // Canonical "current scope · click to switch" chip. The one true switcher
  // trigger — rides next to a page eyebrow / section label everywhere.
  function WorkspaceChip({ ws }) {
    const w = ws || StrategosWorkspace.ws();
    if (!w) return null;
    return React.createElement('button', {
      className: 'dtag tag-btn', onClick: () => StrategosWorkspace.openSwitcher(),
      title: 'Switch workspace  ⌘K', style: { height: 19 },
    },
      React.createElement('span', { className: 'wsdot wsdot-' + w.cls, style: { width: 6, height: 6, marginRight: 4 } }),
      w.name + ' ↓');
  }

  // ── Shared page chrome ───────────────────────────────────────────
  // PageHeader: the canonical view header. eyebrow + optional workspace
  // chip, display title, optional sub, and right-aligned actions.
  function PageHeader({ eyebrow, chip, title, sub, subKind, subMax, actions, align, before, titleStyle }) {
    const h = React.createElement;
    const eb = h('div', { className: 'flex items-center gap-2', style: { marginBottom: 2 } },
      typeof eyebrow === 'string' ? h('span', { className: 'zs-eyebrow', style: { margin: 0 } }, eyebrow) : eyebrow,
      chip ? h(WorkspaceChip, { ws: chip === true ? undefined : chip }) : null);
    const subEl = sub == null ? null
      : h('p', { className: subKind === 'sm' ? 'zs-body-sm' : 'zs-body', style: { marginTop: subKind === 'sm' ? 4 : 6, maxWidth: subMax || 620 } }, sub);
    return h('div', { className: 'flex flex-wrap items-start justify-between gap-4 gap-x-6 mb-8', style: align === 'start' ? { alignItems: 'flex-start' } : null },
      h('div', { className: 'flex-[1_1_340px] min-w-0' },
        before || null, eb,
        h('h1', { className: 'zs-h1', style: Object.assign({ marginTop: 4 }, titleStyle || {}) }, title),
        subEl),
      actions ? h('div', { className: 'flex items-center gap-2', style: { flexShrink: 0 } }, actions) : null);
  }

  // Card: paper-soft + hairline + radius. flush => clip children (for a
  // card head + list); pad => standard inner padding.
  const CARD = 'bg-paper-soft border rounded-lg';
  function Card({ children, flush, pad, style, className }) {
    const cls = [CARD, flush ? 'overflow-hidden' : '', pad ? 'p-6' : '', className || ''].filter(Boolean).join(' ');
    return React.createElement('div', { className: cls, style }, children);
  }

  // CardHead: the hairline-bottomed header strip. Pass children, or title
  // (+optional icon) and meta for the common eyebrow/meta pattern.
  function CardHead({ left, right, title, icon, meta, children, className }) {
    const h = React.createElement;
    const cls = 'flex items-center justify-between gap-3 px-6 py-4 border-b ' + (className || '');
    if (children != null) return h('div', { className: cls }, children);
    const leftEl = left != null ? left
      : (icon
        ? h('span', { className: 'flex items-center gap-2' }, h(Icon, { name: icon, size: 15, tone: 'soft' }), h('span', { className: 'zs-eyebrow' }, title))
        : h('span', { className: 'zs-eyebrow' }, title));
    const rightEl = right != null ? right : (meta != null ? h('span', { className: 'zs-meta' }, meta) : null);
    return h('div', { className: cls }, leftEl, rightEl);
  }

  // CardFoot: the quiet footnote strip under a card.
  function CardFoot({ children, dashed, className, style }) {
    const cls = ['flex items-center gap-2 px-6 py-3 border-t text-xs text-ink-mute',
      dashed ? 'border-dashed' : '', className || ''].filter(Boolean).join(' ');
    return React.createElement('div', { className: cls, style }, children);
  }

  /* ── Layout ────────────────────────────────────────────────────────
     The view shell and the three column rhythms. Compositions live in
     these components, not in a class vocabulary. */
  function ViewPad({ children, wide, className, style }) {
    const cls = ['mx-auto', wide ? '' : 'max-w-[1180px]',
      'px-4 pt-4 pb-12 sm:px-6 sm:pt-6 xl:px-12 xl:pt-8 xl:pb-16', className || '']
      .filter(Boolean).join(' ');
    return React.createElement('div', { className: cls, style }, children);
  }
  // main + aside, 1.6 : 1 · stacks below lg
  function Split({ children, className, style }) {
    return React.createElement('div', { className: 'grid grid-cols-1 gap-6 items-start lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] ' + (className || ''), style }, children);
  }
  function Half({ children, tight, className, style }) {
    const cls = tight ? 'grid grid-cols-2 gap-4 gap-x-6 items-stretch'
      : 'grid grid-cols-1 gap-6 items-start lg:grid-cols-2';
    return React.createElement('div', { className: cls + ' ' + (className || ''), style }, children);
  }
  function Stats({ children, tight, className, style }) {
    const cls = 'grid grid-cols-2 ' + (tight ? 'gap-3' : 'gap-4') + ' sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]';
    return React.createElement('div', { className: cls + ' ' + (className || ''), style }, children);
  }
  function Facts({ children, className, style }) {
    return React.createElement('div', { className: 'grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(96px,1fr))] ' + (className || ''), style }, children);
  }

  /* ── Component kit ───────────────────────────────────────────────
     One primitive per pattern, so an artboard never re-states the class
     vocabulary. All of them pass unknown props straight through. */

  // Button: the only way to render a button. variant primary|secondary|ghost,
  // size sm|md|lg, optional leading icon.
  const BTN_ICON_TONE = { primary: 'paper', secondary: 'soft', ghost: 'mute' };
  function Button(props) {
    const { variant = 'ghost', size = 'md', icon, iconSize, iconTone, children, className, ...rest } = props;
    const cls = ['zs-btn', 'zs-btn-' + variant, size !== 'md' ? 'zs-btn-' + size : '', className || '']
      .filter(Boolean).join(' ');
    return React.createElement('button', Object.assign({ type: 'button', className: cls }, rest),
      icon ? React.createElement(Icon, { name: icon, size: iconSize || (size === 'sm' ? 13 : 15), tone: iconTone || BTN_ICON_TONE[variant] }) : null,
      children);
  }

  // Table: hairline table. `min` keeps a wide table readable inside a
  // scroller on desktop and stacks it into labelled rows on phones
  // (each <td> needs data-th). `scroll` adds the overflow wrapper.
  function Table({ min, scroll, className, children, ...rest }) {
    const cls = ['tbl', 'tbl-stack', min ? 'sm:min-w-[' + min + 'px]' : '', className || '']
      .filter(Boolean).join(' ');
    const table = React.createElement('table', Object.assign({ className: cls }, rest), children);
    return scroll ? React.createElement('div', { style: { overflowX: 'auto' } }, table) : table;
  }

  // Section: `.sec` + optional hairline section header.
  function Section({ title, meta, actions, children, style, className }) {
    const h = React.createElement;
    return h('div', { className: 'mt-12 ' + (className || ''), style },
      (title || actions || meta) ? h('div', { className: 'flex flex-wrap items-baseline justify-between gap-4 mb-4' },
        h('span', { className: 'zs-eyebrow' }, title),
        actions || (meta != null ? h('span', { className: 'zs-meta' }, meta) : null)) : null,
      children);
  }

  // Stat: display number + unit + label, inside a card.
  function Stat({ label, value, unit, sub, className, style }) {
    const h = React.createElement;
    return h('div', { className: 'p-6 ' + (className || ''), style },
      h('div', { className: 'zs-eyebrow', style: { marginBottom: 6 } }, label),
      h('div', { className: 'flex items-baseline gap-2' },
        h('span', { className: 'font-display font-light text-3xl leading-none tracking-tight' }, value),
        unit ? h('span', { className: 'text-sm text-ink-mute' }, unit) : null),
      sub != null ? h('div', { className: 'zs-meta', style: { marginTop: 4 } }, sub) : null);
  }

  function Chip({ icon, children, className, style, ...rest }) {
    return React.createElement('span', Object.assign({ style, className: 'inline-flex items-center gap-1 h-[19px] px-1.5 rounded-sm bg-paper border font-mono text-[10px] text-ink-mute whitespace-nowrap ' + (className || '') }, rest),
      icon ? React.createElement(Icon, { name: icon, size: 11, tone: 'mute' }) : null, children);
  }

  // StatusDot: dot + word, one tone vocabulary everywhere.
  const DOT_TONE = { success: 'var(--success)', warning: 'var(--warning)', accent: 'var(--accent)', mute: 'var(--ink-mute)', faint: 'var(--ink-faint)' };
  function StatusDot({ tone = 'mute', children, className }) {
    return React.createElement('span', { className: 'inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap ' + (className || '') },
      React.createElement('span', { className: 'w-1.5 h-1.5 rounded-full shrink-0', style: { background: DOT_TONE[tone] || tone } }),
      children);
  }

  function Kbd({ children, className, style }) { return React.createElement('span', { style, className: 'font-mono text-[10px] text-ink-mute border rounded-sm px-1 py-0.5 bg-paper ' + (className || '') }, children); }

  // Track: a budget/usage bar. value + max, tone from the meter vocabulary.
  function Track({ value, max = 100, tone = 'accent', className }) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return React.createElement('span', { className: 'block h-1.5 rounded-full bg-paper-mute overflow-hidden ' + (className || '') },
      React.createElement('i', { className: 'block h-full rounded-full transition-[width] duration-slow', style: { width: pct + '%', background: METER_TONE[tone] || tone } }));
  }

  // Tabs: segmented control. items = [{id,label,icon}] | [[id,label]].
  function Tabs({ items, value, onChange, size, style }) {
    const norm = items.map((it) => (Array.isArray(it) ? { id: it[0], label: it[1] } : it));
    return React.createElement('div', { className: 'tabs' + (size === 'sm' ? ' sm' : ''), style },
      norm.map((it) => React.createElement('button', {
        key: it.id, type: 'button',
        className: 'tab' + (value === it.id ? ' on' : ''),
        onClick: () => onChange && onChange(it.id),
      }, it.icon ? React.createElement(Icon, { name: it.icon, size: 15, tone: value === it.id ? 'accent' : 'mute' }) : null, it.label)));
  }

  // EmptyState: the system's silence. Kanji mark + one calm line.
  function EmptyState({ kanji = '空', title = 'Nothing here yet.', sub, actions }) {
    const h = React.createElement;
    return h('div', { className: 'py-16 px-6 text-center' },
      h('div', { className: 'font-kanji text-[32px] text-ink-faint mb-3' }, kanji),
      h('div', { className: 'text-sm font-semibold text-ink' }, title),
      sub ? h('div', { className: 'zs-body-sm mt-1 max-w-[420px] mx-auto' }, sub) : null,
      actions ? h('div', { className: 'flex items-center justify-center gap-2 mt-4' }, actions) : null);
  }

  function useWorkspace() {
    const [id, setId] = React.useState(StrategosWorkspace.get());
    React.useEffect(() => StrategosWorkspace.subscribe(setId), []);
    return {
      id,
      ws: window.StrategosAPI.wsById(id),
      set: (x) => StrategosWorkspace.set(x),
      open: () => StrategosWorkspace.openSwitcher(),
      all: window.StrategosAPI.WORKSPACES,
      byTier: window.StrategosAPI.wsByTier(),
    };
  }

  window.StrategosEnv = StrategosEnv;
  window.StrategosWorkspace = StrategosWorkspace;
  window.StrategosUI = { Switch, ProviderDot, Meter, Pill, Tag, CtrlRow, ModelPicker, ExecBadge,
    useEnv, EnvChip, DeviceFooter, DevicePill, OfflineBanner, DesktopOnlyNote,
    usePinnedModel, getPinnedModel, setPinnedModel, useWorkspace, WorkspaceChip, PageHeader, Card, CardHead,
    useSnippets, getSnippets, saveSnippet, isSnippetSaved, SaveSnippetButton, RoutingPanel,
    Sessions, MyTemplates, Handoff,
    /* component kit */
    Button, Table, Section, Stat, Chip, StatusDot, Kbd, Track, Tabs, EmptyState,
    CardFoot, ViewPad, Split, Half, Stats, Facts };

  /* Class recipes are shortcuts in app/uno.config.js — the runtime only
     compiles arbitrary variants ([&_td]:…) declared there, never from markup.
     Kept as a name map for callers that build a class string by hand. */
  const TW = { stackTable: 'tbl-stack' };
  window.StrategosUI.TW = TW;
})();
