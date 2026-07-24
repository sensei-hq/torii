/* Strategos Console · app.jsx — member workspace root.
   The console is now user-focused: workspace, ask, library, playground, plus
   personal activity & settings. All tenant / gateway administration lives in
   the separate Admin Portal (Strategos Admin.html). */
(function () {
  const { Chrome, Rail, WorkspaceSwitcher, MobileTabs } = window.StrategosShell;
  const { Icon } = window.StrategosIcons;
  const { Switch, useWorkspace, PageHeader } = window.StrategosUI;
  const { StrategosWorkspace } = window;
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
        <PageHeader eyebrow="Settings" title="Your preferences" subMax={600}
          sub="Personal preferences for how Strategos behaves for you. Workspace-wide policies are set by an administrator." />
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
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-5)' }}>Strategos · workspace · signed in as mara.okafor@northwind.co</div>
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
      { id: 'workflows', label: 'Workflows', icon: 'refresh' },
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
    footer: React.createElement(window.StrategosUI.DeviceFooter, { scope: 'member' }),
  };

  function renderView(section, go, user) {
    const V = window;
    switch (section) {
      case 'workspace':   return React.createElement(V.WorkspaceView, { go, name: user.name });
      case 'ask':         return React.createElement(V.AskView, { initial: user.initial });
      case 'library':     return React.createElement(V.LibraryView, { go });
      case 'playground':  return React.createElement(V.PlaygroundView);
      case 'workflows':   return React.createElement(V.WorkflowsView);
      case 'activity':    return React.createElement(V.RequestsView, { scope: 'member' });
      case 'settings':    return React.createElement(SettingsView);
      default:            return null;
    }
  }

  function App() {
    const [authed, setAuthed] = useState(false);
    const [section, setSection] = useState(CFG.def);
    const [theme, setTheme] = useState('light');
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const [railOpen, setRailOpen] = useState(false);
    const { id: wsId, ws, set: setWs } = useWorkspace();
    window.__zsTheme = theme; // read by Icon for theme-aware tinting
    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

    // ⌘K / Ctrl-K opens the workspace palette; any view can request it too.
    useEffect(() => {
      const onKey = (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (authed) setSwitcherOpen((v) => !v); }
      };
      window.addEventListener('keydown', onKey);
      const off = StrategosWorkspace.onOpenRequest(() => setSwitcherOpen(true));
      return () => { window.removeEventListener('keydown', onKey); off(); };
    }, [authed]);

    const signIn = () => { setSection(CFG.def); setAuthed(true); };
    const nav = (id) => { setSection(id); setRailOpen(false); };
    const fullBleed = section === 'library' || section === 'ask';
    const title = 'Strategos  ·  ' + ws.name;

    if (!authed) return React.createElement(window.SignInView, { onSignIn: signIn, mode: 'member' });

    return (
      <div className="win has-mtabs">
        <Chrome user={CFG.user} role={CFG.role} onSignOut={() => setAuthed(false)} theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title={title} onMenu={() => setRailOpen((v) => !v)} />
        <div className="win-body">
          <Rail section={section} setSection={nav} workspace={ws} onOpenSwitcher={() => setSwitcherOpen(true)} groups={CFG.nav} footer={CFG.footer} open={railOpen} onClose={() => setRailOpen(false)} />
          <main className="view" key={section + wsId} style={fullBleed ? { overflow: 'hidden' } : undefined}>{renderView(section, nav, CFG.user)}</main>
        </div>
        <MobileTabs section={section} onPick={nav} onMore={() => setRailOpen(true)}
          items={[
            { id: 'workspace', label: 'Home', icon: 'home' },
            { id: 'ask', label: 'Ask', icon: 'ask' },
            { id: 'library', label: 'Library', icon: 'library' },
            { id: 'activity', label: 'Activity', icon: 'history' },
          ]} />
        <WorkspaceSwitcher open={switcherOpen} current={wsId} onPick={setWs} onClose={() => setSwitcherOpen(false)} />
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
