/* Strategos Console · shell.jsx — window chrome (with persona switch) + left rail. */
(function () {
  const { Icon, Enso } = window.StrategosIcons;

  function PersonaSwitch({ persona, setPersona }) {
    return (
      <div className="tabs sm" style={{ marginRight: 6 }}>
        {[['admin', 'Admin'], ['member', 'Member']].map(([k, label]) => (
          <button key={k} className={'tab' + (persona === k ? ' on' : '')} onClick={() => setPersona(k)}>{label}</button>
        ))}
      </div>
    );
  }

  function Chrome({ user, role, onSignOut, theme, onToggleTheme, title }) {
    return (
      <div className="zs-chrome">
        <div className="zs-traffic"><span /><span /><span /></div>
        <div className="zs-chrome-title">{title}</div>
        <div className="chrome-tools">
          <button className="chrome-btn" title="Search  ⌘K"><Icon name="search" size={16} tone="mute" /></button>
          <button className="chrome-btn" title="Notifications"><Icon name="bell" size={16} tone="mute" /></button>
          <button className="chrome-btn" onClick={onToggleTheme} title="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} tone="mute" /></button>
          <span style={{ width: 1, height: 18, background: 'var(--paper-edge)', margin: '0 6px' }} />
          <span className="flex items-center gap-2" title={role} style={{ whiteSpace: 'nowrap' }}>
            <span className="ava" style={{ width: 22, height: 22, background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent', fontSize: 9 }}>{user.initial}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>{user.name} · {role}</span>
          </span>
          <button className="chrome-btn" onClick={onSignOut} title="Sign out"><Icon name="logout" size={16} tone="mute" /></button>
        </div>
      </div>
    );
  }

  function NavItem({ it, active, onClick }) {
    return (
      <button className={'nav' + (active ? ' on' : '')} onClick={onClick}>
        <span className="ic"><Icon name={it.icon} size={18} tone={active ? 'accent' : 'mute'} /></span>
        <span className="lbl">{it.label}</span>
        {it.end === 'live'
          ? <span className="status"><span className="dot" style={{ background: 'var(--success)' }} /></span>
          : it.end && <span className="end">{it.end}</span>}
      </button>
    );
  }

  function Rail({ section, setSection, account, groups, footer }) {
    return (
      <aside className="rail">
        <div className="rail-pad" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* brand */}
          <div className="flex items-center gap-3" style={{ padding: '4px 6px 2px' }}>
            <Enso size={22} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '-0.01em' }}>Strategos</span>
            <span className="grow" />
            <span className="tag">v2.4</span>
          </div>

          {/* account / context */}
          <div className="org" style={{ marginTop: 'var(--space-4)' }}>
            <span className="org-mark">{account.mark}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>{account.sub}</div>
            </div>
            <Icon name="caret" size={14} tone="mute" />
          </div>

          {/* nav groups */}
          {groups.map((g) => (
            <div className="rail-group" key={g.label} style={{ marginTop: 'var(--space-5)' }}>
              <div className="rail-label">{g.label}</div>
              <div className="flex flex-col" style={{ gap: 2 }}>
                {g.items.map((it) => <NavItem key={it.id} it={it} active={section === it.id} onClick={() => setSection(it.id)} />)}
              </div>
            </div>
          ))}

          <span className="grow" />
          {footer}
        </div>
      </aside>
    );
  }

  window.StrategosShell = { Chrome, Rail };
})();
