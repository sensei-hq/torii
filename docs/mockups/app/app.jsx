/* Torii · app.jsx — member workspace root.
   The console is now user-focused: workspace, ask, library, playground, plus
   personal activity & settings. All tenant / gateway administration lives in
   the separate admin portal, Seiki (Seiki.html). */
(function () {
  const { Chrome, Rail, WorkspaceSwitcher, MobileTabs } = window.StrategosShell;
  const { Icon } = window.StrategosIcons;
  const { CardHead, ViewPad, Card, Switch, useWorkspace, PageHeader, ProviderDot } = window.StrategosUI;
  const { MODELS } = window.StrategosAPI;
  const { StrategosWorkspace } = window;
  const { useState, useEffect } = React;

  const PREFS_KEY = 'zs-prefs';
  const { PREF_DEFAULTS, NAV } = window.StrategosAPI.content.app;

  function Segmented({ value, options, onChange }) {
    return (
      <div className="inline-flex border rounded overflow-hidden bg-paper">
        {options.map((o, i) => {
          const on = value === o.v;
          return (
            <button key={o.v} onClick={() => onChange(o.v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', fontSize: 'var(--text-xs)', fontWeight: 500,
              borderLeft: i ? '1px solid var(--paper-edge)' : 'none', background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--on-primary)' : 'var(--ink-soft)',
              transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)', whiteSpace: 'nowrap' }}>
              {o.ic && <Icon name={o.ic} size={12} tone={on ? 'paper' : 'mute'} />}{o.l}
            </button>
          );
        })}
      </div>
    );
  }

  /* ── personal preferences ─────────────────────────────────── */
  function SettingsView({ theme, setTheme }) {
    const [p, setP] = useState(() => { try { return Object.assign({}, PREF_DEFAULTS, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return { ...PREF_DEFAULTS }; } });
    const set = (k, v) => setP((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)); } catch (e) {} return n; });
    const [themePref, setThemePref] = useState(() => { try { return localStorage.getItem('zs-theme-pref') || 'system'; } catch (e) { return 'system'; } });
    const applyTheme = (pref) => {
      setThemePref(pref); try { localStorage.setItem('zs-theme-pref', pref); } catch (e) {}
      const resolved = pref === 'system' ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
      if (setTheme) setTheme(resolved);
    };

    const Row = ({ ic, t, d, locked, children }) => (
      <div className="flex items-center gap-4 py-4 px-6 border-t">
        <span className="glyph w-[34px] h-[34px]"><Icon name={ic} size={17} tone={locked ? 'mute' : 'soft'} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink">{t}</span>{locked && <span className="dtag" title="Set by your administrator"><Icon name="lock" size={11} tone="mute" /> admin</span>}</div>
          <div className="zs-body-sm mt-px">{d}</div>
        </div>
        {children}
      </div>
    );
    const Head = ({ label }) => <CardHead><span className="zs-eyebrow">{label}</span></CardHead>;
    const selStyle = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '6px 9px', cursor: 'pointer' };

    return (
      <ViewPad className="rise">
        <PageHeader eyebrow="Settings" title="Your preferences" subMax={600}
          sub="How Torii behaves for you. Workspace-wide policies are set by an administrator — those show a lock and can’t be changed here." />

        <Card className="overflow-hidden">
          <Head label="Appearance" />
          <Row ic="moon" t="Theme" d="Light, dark, or follow your OS.">
            <Segmented value={themePref} onChange={applyTheme} options={[{ v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }, { v: 'system', l: 'System' }]} />
          </Row>
          <Row ic="globe" t="Language & region" d="Used for dates, numbers and UI copy.">
            <select value={p.locale} onChange={(e) => set('locale', e.target.value)} style={selStyle}>
              {[['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['es-ES', 'Español']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
        </Card>

        <Card className="overflow-hidden mt-6">
          <Head label="Answering" />
          <Row ic="models" t="Default model" d="Your preferred model — within the tiers your admin allows.">
            <select value={p.model} onChange={(e) => set('model', e.target.value)} style={selStyle}>
              <option value="auto">Auto · let the gateway choose</option>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </Row>
          <Row ic="scale" t="Preferred tier" d="How the gateway balances quality against cost for you.">
            <Segmented value={p.tier} onChange={(v) => set('tier', v)} options={[{ v: 'fast', l: 'Fast' }, { v: 'balanced', l: 'Balanced' }, { v: 'frontier', l: 'Frontier' }]} />
          </Row>
          <Row ic="citation" t="Citation density" d="How many sources to attach to an answer.">
            <Segmented value={p.cites} onChange={(v) => set('cites', v)} options={[{ v: 'off', l: 'Off' }, { v: 'compact', l: 'Compact' }, { v: 'full', l: 'Full' }]} />
          </Row>
          <Row ic="history" t="Context retention" d="Carry prior turns into the next question by default.">
            <Switch on={p.retention} onClick={() => set('retention', !p.retention)} label="Context retention" />
          </Row>
          <Row ic="spark" t="Auto-tune prompts" d="Rewrite prompts for the chosen model before sending.">
            <Switch on={p.autotune} onClick={() => set('autotune', !p.autotune)} label="Auto-tune" />
          </Row>
          <Row ic="shield" t="PII & tenant masking" d="Mask tenant names and PII on every call." locked>
            <Switch on={true} onClick={() => {}} label="Masking (locked)" />
          </Row>
        </Card>

        <Card className="overflow-hidden mt-6">
          <Head label="Notifications & drafts" />
          <Row ic="bell" t="Weekly digest" d="A Monday summary of activity in your spaces.">
            <Switch on={p.digest} onClick={() => set('digest', !p.digest)} label="Weekly digest" />
          </Row>
          <Row ic="create" t="Autosave drafts" d="Keep generated docs as drafts in the active space.">
            <Switch on={p.autosave} onClick={() => set('autosave', !p.autosave)} label="Autosave drafts" />
          </Row>
        </Card>

        <Card className="overflow-hidden mt-6">
          <Head label="On this device" />
          <Row ic="models" t="Local models" d="Manage on-device model downloads, storage and defaults.">
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>see Local models →</span>
          </Row>
        </Card>

        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: '24px' }}>Torii · workspace · signed in as mara.okafor@northwind.co · locked preferences are governed by your admin</div>
      </ViewPad>
    );
  }

  /* ── member navigation ────────────────────────────────────── */

  const CFG = {
    title: 'Torii  ·  workspace', def: 'workspace', nav: NAV, role: 'Member',
    user: { name: 'Mara', initial: 'M' },
    account: { mark: 'M', name: 'Mara Okafor', sub: 'Leasing Ops · member' },
    footer: React.createElement(window.StrategosUI.DeviceFooter, { scope: 'member' }),
  };

  function renderView(section, go, user, ctx) {
    const V = window;
    switch (section) {
      case 'workspace':   return React.createElement(V.WorkspaceView, { go, name: user.name });
      case 'ask':         return React.createElement(V.AskView, { initial: user.initial, go });
      case 'library':     return React.createElement(V.LibraryView, { go });
      case 'playground':  return React.createElement(V.PlaygroundView, { go });
      case 'compare':     return React.createElement(V.CompareView, { go });
      case 'local':       return React.createElement(V.LocalModelsView);
      case 'workflows':   return React.createElement(V.WorkflowsView);
      case 'activity':    return React.createElement(V.RequestsView, { scope: 'member' });
      case 'settings':    return React.createElement(SettingsView, ctx);
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
    const title = 'Torii  ·  ' + ws.name;

    if (!authed) return React.createElement(window.SignInView, { onSignIn: signIn, mode: 'member' });

    return (
      <div className="win">
        <Chrome user={CFG.user} role={CFG.role} onSignOut={() => setAuthed(false)} theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} title={title} onMenu={() => setRailOpen((v) => !v)} />
        <div className="win-body">
          <Rail section={section} setSection={nav} workspace={ws} onOpenSwitcher={() => setSwitcherOpen(true)} groups={CFG.nav} footer={CFG.footer} brand="Torii" open={railOpen} onClose={() => setRailOpen(false)} />
          <main className="view lt-sm:pb-15" key={section + wsId} style={fullBleed ? { overflow: 'hidden' } : undefined}>{renderView(section, nav, CFG.user, { theme, setTheme })}</main>
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
