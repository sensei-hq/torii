/* Strategos Console · app.jsx — member workspace root.
   The console is now user-focused: workspace, ask, library, playground, plus
   personal activity & settings. All tenant / gateway administration lives in
   the separate Admin Portal (Strategos Admin.html). */
(function () {
  const { Chrome, Rail } = window.StrategosShell;
  const { Icon } = window.StrategosIcons;
  const { Switch } = window.StrategosUI;
  const { useState, useEffect } = React;

  /* ── personal preferences ─────────────────────────────────── */
  function SettingsView() {
    const ROWS = [
      { k: 'cites',    ic: 'citation', t: 'Always show sources',  d: 'Attach library citations to every answer.' },
      { k: 'digest',   ic: 'bell',     t: 'Weekly digest',        d: 'A Monday summary of activity in your spaces.' },
      { k: 'sysTheme', ic: 'moon',     t: 'Match system theme',   d: 'Follow light or dark from your OS.' },
      { k: 'autosave', ic: 'create',   t: 'Autosave drafts',      d: 'Keep generated docs as drafts in the active space.' },
    ];
    const [s, setS] = useState(() => Object.fromEntries(ROWS.map((r, i) => [r.k, i < 2])));
    const flip = (k) => setS((o) => ({ ...o, [k]: !o[k] }));
    return (
      <div className="view-pad rise">
        <div className="page-hd"><div>
          <div className="zs-eyebrow">Settings</div>
          <h1 className="zs-h1" style={{ marginTop: 4 }}>Your preferences</h1>
          <p className="zs-body" style={{ marginTop: 6, maxWidth: 600 }}>Personal preferences for how Strategos behaves for you. Workspace-wide policies are set by an administrator.</p>
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
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', marginTop: 'var(--space-5)' }}>Strategos · workspace · signed in as mara.okafor@northwind.co</div>
      </div>
    );
  }

  /* ── member navigation ────────────────────────────────────── */
  const NAV = [
    { label: 'Workspace', items: [
      { id: 'workspace', label: 'Home', icon: 'home' },
      { id: 'ask', label: 'Ask', icon: 'ask' },
      { id: 'library', label: 'Library', icon: 'library' },
    ]},
    { label: 'Tools', items: [
      { id: 'playground', label: 'Playground', icon: 'playground' },
    ]},
    { label: 'You', items: [
      { id: 'activity', label: 'Activity', icon: 'history' },
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ]},
  ];

  const CFG = {
    title: 'Strategos  ·  workspace', def: 'workspace', nav: NAV, role: 'Member',
    user: { name: 'Mara', initial: 'M' },
    account: { mark: 'M', name: 'Mara Okafor', sub: 'Leasing Ops · member' },
    footer: (
      <div className="daemon">
        <div className="flex items-center gap-2"><span className="dot" style={{ background: 'var(--success)' }} /><span>3 spaces · 1,618 items</span></div>
        <div style={{ color: 'var(--ink-faint)', marginTop: 2 }}>synced · all on-device embeddings</div>
      </div>
    ),
  };

  function renderView(section, go, user) {
    const V = window;
    switch (section) {
      case 'workspace':   return React.createElement(V.WorkspaceView, { go, name: user.name });
      case 'ask':         return React.createElement(V.AskView, { initial: user.initial });
      case 'library':     return React.createElement(V.LibraryView);
      case 'playground':  return React.createElement(V.PlaygroundView);
      case 'activity':    return React.createElement(V.RequestsView, { scope: 'member' });
      case 'settings':    return React.createElement(SettingsView);
      default:            return null;
    }
  }

  function App() {
    const [authed, setAuthed] = useState(false);
    const [section, setSection] = useState(CFG.def);
    const [theme, setTheme] = useState('light');
    window.__zsTheme = theme; // read by Icon for theme-aware tinting
    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

    const signIn = () => { setSection(CFG.def); setAuthed(true); };
    const fullBleed = section === 'library' || section === 'ask';

    if (!authed) return React.createElement(window.SignInView, { onSignIn: signIn, mode: 'member' });

    return (
      <div className="win">
        <Chrome user={CFG.user} role={CFG.role} onSignOut={() => setAuthed(false)} theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title={CFG.title} />
        <div className="win-body">
          <Rail section={section} setSection={setSection} account={CFG.account} groups={CFG.nav} footer={CFG.footer} />
          <main className="view" key={section} style={fullBleed ? { overflow: 'hidden' } : undefined}>{renderView(section, setSection, CFG.user)}</main>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
