/* Strategos Admin Portal · admin.jsx — root.
   Tenant & gateway administration, split out of the member console. Offers two
   layouts to compare via Tweaks: a left sidebar rail, or a horizontal top bar. */
(function () {
  const { Chrome, Rail } = window.StrategosShell;
  const { Icon, Mark } = window.StrategosIcons;
  const { Switch } = window.StrategosUI;
  const { useState, useEffect } = React;

  /* ── workspace defaults (admin settings) ──────────────────── */
  function SettingsView() {
    const ROWS = [
      { k: 'masking',      ic: 'shield',  t: 'PII & tenant masking',  d: 'Scan input and output on every call, across the workspace.' },
      { k: 'autoFallback', ic: 'routing', t: 'Automatic fallback',    d: 'Step down on budget or provider error without asking.' },
      { k: 'alerts',       ic: 'bell',    t: 'Anomaly alerts',        d: 'Notify owners on budget breach, outage, or policy hit.' },
      { k: 'telemetry',    ic: 'history', t: 'Anonymous telemetry',   d: 'Share aggregate routing metrics to improve defaults.' },
    ];
    const [s, setS] = useState(() => Object.fromEntries(ROWS.map((r, i) => [r.k, i < 2])));
    const flip = (k) => setS((o) => ({ ...o, [k]: !o[k] }));
    return (
      <div className="view-pad rise">
        <div className="page-hd"><div>
          <div className="zs-eyebrow">Settings</div>
          <h1 className="zs-h1" style={{ marginTop: 4 }}>Workspace defaults</h1>
          <p className="zs-body" style={{ marginTop: 6, maxWidth: 600 }}>Policies that apply to every member of Northwind Estates unless a space overrides them.</p>
        </div></div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {ROWS.map((r, i) => (
            <div key={r.k} className="flex items-center gap-4" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
              <span className="glyph" style={{ width: 34, height: 34 }}><Icon name={r.ic} size={17} tone={s[r.k] ? 'accent' : 'mute'} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.t}</div>
                <div className="zs-body-sm" style={{ marginTop: 1 }}>{r.d}</div>
              </div>
              <Switch on={s[r.k]} onClick={() => flip(r.k)} label={r.t} />
            </div>
          ))}
        </div>
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', marginTop: 'var(--space-5)' }}>Strategos · gateway v2.4 · daemon running · last heartbeat 2s ago</div>
      </div>
    );
  }

  /* ── admin navigation ─────────────────────────────────────── */
  const NAV = [
    { label: 'Overview', items: [
      { id: 'overview', label: 'Overview', icon: 'overview' },
      { id: 'requests', label: 'Requests & audit', icon: 'requests', end: 'live' },
    ]},
    { label: 'Tenant', items: [
      { id: 'organization', label: 'Members & roles', icon: 'org' },
      { id: 'onboarding', label: 'Onboarding', icon: 'sso' },
    ]},
    { label: 'Gateway', items: [
      { id: 'models', label: 'Models', icon: 'models', end: '8' },
      { id: 'routing', label: 'Routing', icon: 'routing' },
      { id: 'connections', label: 'Connections', icon: 'keys' },
    ]},
    { label: 'Govern', items: [
      { id: 'governance', label: 'Governance', icon: 'governance' },
      { id: 'billing', label: 'Budgets & billing', icon: 'wallet' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ]},
  ];

  const ACCOUNT = { mark: 'N', name: 'Northwind Estates', sub: 'org · 142 seats' };
  const USER = { name: 'Aiko', initial: 'A' };
  const FOOTER = (
    <div className="daemon">
      <div className="flex items-center gap-2"><span className="dot" style={{ background: 'var(--success)' }} /><span>gateway · healthy</span></div>
      <div style={{ color: 'var(--ink-faint)', marginTop: 2 }}>4 of 6 routers connected</div>
    </div>
  );

  function renderView(section, go) {
    const V = window;
    switch (section) {
      case 'overview':     return React.createElement(V.OverviewView, { go });
      case 'requests':     return React.createElement(V.RequestsView);
      case 'organization': return React.createElement(V.OrganizationView);
      case 'onboarding':   return React.createElement(V.OnboardingView);
      case 'models':       return React.createElement(V.ModelsView);
      case 'routing':      return React.createElement(V.RoutingView);
      case 'connections':  return React.createElement(V.ConnectionsView);
      case 'governance':   return React.createElement(V.GovernanceView);
      case 'billing':      return React.createElement(V.BillingView);
      case 'settings':     return React.createElement(SettingsView);
      default:             return null;
    }
  }

  /* ── horizontal top-bar nav (layout option B) ─────────────── */
  function TopNav({ section, setSection, groups }) {
    return (
      <div className="atop">
        <div className="atop-org">
          <span className="org-mark" style={{ width: 26, height: 26, fontSize: 13 }}>{ACCOUNT.mark}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{ACCOUNT.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>{ACCOUNT.sub}</div>
          </div>
        </div>
        <span className="vrule" style={{ margin: '0 var(--space-2)' }} />
        <nav className="atop-nav">
          {groups.map((g, gi) => (
            <React.Fragment key={g.label}>
              {gi > 0 && <span className="atop-dot" />}
              {g.items.map((it) => (
                <button key={it.id} className={'atab' + (section === it.id ? ' on' : '')} onClick={() => setSection(it.id)}>
                  <Icon name={it.icon} size={16} tone={section === it.id ? 'accent' : 'mute'} />
                  <span>{it.label}</span>
                  {it.end === 'live' && <span className="dot" style={{ background: 'var(--success)' }} />}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
      </div>
    );
  }

  const ATOP_STYLE = `
    .zs .atop { display: flex; align-items: center; gap: var(--space-3); padding: 8px var(--space-5);
      border-bottom: 1px solid var(--paper-edge); background: var(--paper); overflow-x: auto; flex-shrink: 0; }
    .zs .atop-org { display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0; }
    .zs .atop-nav { display: flex; align-items: center; gap: 2px; }
    .zs .atop-dot { width: 1px; height: 18px; background: var(--paper-edge); margin: 0 6px; flex-shrink: 0; }
    .zs .atab { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 10px;
      border-radius: var(--radius); color: var(--ink-soft); font-size: var(--text-sm); white-space: nowrap; flex-shrink: 0;
      transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .zs .atab:hover { background: var(--paper-mute); color: var(--ink); }
    .zs .atab.on { background: var(--paper-mute); color: var(--ink); font-weight: 500; }
  `;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "layout": "rail",
    "dark": false
  }/*EDITMODE-END*/;

  function App() {
    const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
    const [authed, setAuthed] = useState(false);
    const [section, setSection] = useState('overview');
    const theme = t.dark ? 'dark' : 'light';
    window.__zsTheme = theme;
    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

    const go = (s) => setSection(s === 'playground' ? 'requests' : s === 'keys' ? 'connections' : s);
    const layout = t.layout === 'topbar' ? 'topbar' : 'rail';

    if (!authed) return React.createElement(window.SignInView, { onSignIn: () => { setSection('overview'); setAuthed(true); }, mode: 'admin' });

    return (
      <React.Fragment>
        <style>{ATOP_STYLE}</style>
        <div className="win">
          <Chrome user={USER} role="Administrator" onSignOut={() => setAuthed(false)} theme={theme} onToggleTheme={() => setTweak('dark', !t.dark)} title="Strategos  ·  admin portal" />
          {layout === 'topbar' && <TopNav section={section} setSection={setSection} groups={NAV} />}
          <div className="win-body">
            {layout === 'rail' && <Rail section={section} setSection={setSection} account={ACCOUNT} groups={NAV} footer={FOOTER} />}
            <main className="view" key={layout + section}>{renderView(section, go)}</main>
          </div>
        </div>

        <window.TweaksPanel title="Tweaks">
          <window.TweakSection label="Layout" />
          <window.TweakRadio label="Navigation" value={t.layout} options={[{ value: 'rail', label: 'Sidebar' }, { value: 'topbar', label: 'Top bar' }]}
            onChange={(v) => setTweak('layout', v)} />
          <window.TweakSection label="Theme" />
          <window.TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        </window.TweaksPanel>
      </React.Fragment>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
