/* Strategos Console · atoms.jsx — shared interactive atoms.
   Exposes window.StrategosUI. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { PROVIDER_HUE } = window.StrategosData;

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

  function Pill({ children, kind, icon }) {
    return React.createElement('span', { className: 'pill' + (kind ? ' ' + kind : '') },
      icon && React.createElement(Icon, { name: icon, size: 13, tone: kind === 'accent' ? 'accent' : kind === 'success' ? 'success' : 'mute' }),
      children);
  }

  function Tag({ children }) {
    return React.createElement('span', { className: 'tag' }, children);
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
     The desktop app can run models on-device; the web client cannot, and an
     offline desktop buffers calls and falls back to local models. A single
     switchable state drives every device/sync/offline affordance. */
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
      label: web ? 'Web app' : v === 'offline' ? 'Desktop · offline' : 'Desktop app',
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
      line2 = 'web app · local models need desktop';
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
    const label = meta.web ? 'Web · no local models'
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

  // desktop-only notice for the web client
  function DesktopOnlyNote({ feature = 'Local models' }) {
    const { meta } = useEnv();
    if (!meta.web) return null;
    return React.createElement('div', { className: 'env-banner' },
      React.createElement(Icon, { name: 'globe', size: 16, tone: 'mute' }),
      React.createElement('span', { style: { flex: 1 } }, feature + ' need the desktop app. On the web, every call runs via the gateway.'));
  }

  // model picker (compact select styled)
  function ModelPicker({ value, onChange }) {
    const { MODELS } = window.StrategosData;
    return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)' } },
      React.createElement(ProviderDot, { provider: (window.StrategosData.modelById(value) || {}).provider, size: 7 }),
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
    const m = window.StrategosData.modelById(modelId) || {};
    const { money } = window.StrategosData;
    const costLabel = callCost === 0 ? 'free' : '$' + callCost.toFixed(callCost < 0.1 ? 3 : 2);
    const factor = (k, v) => React.createElement('div', null,
      React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-faint)' } }, k),
      React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)', marginTop: 2, fontVariantNumeric: 'tabular-nums' } }, v));
    return React.createElement('div', { className: 'rise', style: { background: 'var(--paper-soft)', borderBottom: '1px solid var(--paper-edge)', padding: 'var(--space-4)' } },
      React.createElement('div', { className: 'flex items-center gap-2', style: { marginBottom: 8, flexWrap: 'wrap' } },
        React.createElement(ProviderDot, { provider: m.provider, size: 8 }),
        React.createElement('span', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' } }, modelId),
        m.tier && React.createElement('span', { className: 'tag' }, m.tier),
        pinned && React.createElement('span', { className: 'pill accent' }, React.createElement(Icon, { name: 'pin', size: 12, tone: 'accent' }), 'pinned'),
        React.createElement('span', { className: 'grow' }),
        exec && React.createElement(ExecBadge, Object.assign({ verb: true }, exec))),
      React.createElement('div', { style: { fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 12 } }, reason),
      React.createElement('div', { className: 'grid-facts', style: { paddingTop: 12, borderTop: '1px solid var(--paper-edge)' } },
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
  if (!window.StrategosData.wsById(_ws) || window.StrategosData.wsById(_ws).id !== _ws) _ws = 'leasing';
  const _wsListeners = new Set();
  const _wsOpenListeners = new Set();
  const StrategosWorkspace = {
    get: () => _ws,
    ws: () => window.StrategosData.wsById(_ws),
    set(id) { if (!window.StrategosData.wsById(id)) return; _ws = id; try { localStorage.setItem(WS_KEY, id); } catch (e) {} _wsListeners.forEach((f) => f(id)); },
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
    return h('div', { className: 'page-hd', style: align === 'start' ? { alignItems: 'flex-start' } : null },
      h('div', { style: { minWidth: 0 } },
        before || null, eb,
        h('h1', { className: 'zs-h1', style: Object.assign({ marginTop: 4 }, titleStyle || {}) }, title),
        subEl),
      actions ? h('div', { className: 'flex items-center gap-2', style: { flexShrink: 0 } }, actions) : null);
  }

  // Card: paper-soft + hairline + radius. flush => clip children (for a
  // card-hd + list); pad => standard space-5 inner padding.
  function Card({ children, flush, pad, style, className }) {
    const s = Object.assign({}, flush ? { overflow: 'hidden' } : null, pad ? { padding: 'var(--space-5)' } : null, style || {});
    return React.createElement('div', { className: 'card' + (className ? ' ' + className : ''), style: Object.keys(s).length ? s : undefined }, children);
  }

  // CardHead: the hairline-bottomed header strip. Pass title (+optional
  // icon) and meta for the common eyebrow/meta pattern, or left/right nodes.
  function CardHead({ left, right, title, icon, meta }) {
    const h = React.createElement;
    const leftEl = left != null ? left
      : (icon
        ? h('span', { className: 'flex items-center gap-2' }, h(Icon, { name: icon, size: 15, tone: 'soft' }), h('span', { className: 'zs-eyebrow' }, title))
        : h('span', { className: 'zs-eyebrow' }, title));
    const rightEl = right != null ? right : (meta != null ? h('span', { className: 'zs-meta' }, meta) : null);
    return h('div', { className: 'card-hd' }, leftEl, rightEl);
  }

  function useWorkspace() {
    const [id, setId] = React.useState(StrategosWorkspace.get());
    React.useEffect(() => StrategosWorkspace.subscribe(setId), []);
    return {
      id,
      ws: window.StrategosData.wsById(id),
      set: (x) => StrategosWorkspace.set(x),
      open: () => StrategosWorkspace.openSwitcher(),
      all: window.StrategosData.WORKSPACES,
      byTier: window.StrategosData.wsByTier(),
    };
  }

  window.StrategosEnv = StrategosEnv;
  window.StrategosWorkspace = StrategosWorkspace;
  window.StrategosUI = { Switch, ProviderDot, Meter, Pill, Tag, CtrlRow, ModelPicker, ExecBadge,
    useEnv, EnvChip, DeviceFooter, DevicePill, OfflineBanner, DesktopOnlyNote,
    usePinnedModel, getPinnedModel, setPinnedModel, useWorkspace, WorkspaceChip, PageHeader, Card, CardHead,
    useSnippets, getSnippets, saveSnippet, isSnippetSaved, SaveSnippetButton, RoutingPanel,
    Sessions, MyTemplates, Handoff };
})();
