/* Strategos Console · shell.jsx — window chrome (with persona switch) + left rail. */
(function () {
  const { Icon, Enso } = window.StrategosIcons;
  const { TIERS, wsByTier } = window.StrategosData;
  const EnvChip = () => React.createElement(window.StrategosUI.EnvChip);
  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  /* ── Workspace command palette ─────────────────────────────────────
     Type to filter; ↑↓ to move; ↵ to switch; esc to close. Grouped by
     tier (company → department → team → personal). The one global scope. */
  function WorkspaceSwitcher({ open, current, onPick, onClose }) {
    const [q, setQ] = React.useState('');
    const [active, setActive] = React.useState(0);
    const inputRef = React.useRef(null);

    // flat, filtered, but remembers its tier for section rendering
    const groups = React.useMemo(() => {
      const needle = q.trim().toLowerCase();
      return wsByTier()
        .map((g) => ({ tier: g.tier, items: g.items.filter((w) => !needle || (w.name + ' ' + w.desc + ' ' + g.tier.label).toLowerCase().includes(needle)) }))
        .filter((g) => g.items.length);
    }, [q]);
    const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

    React.useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);
    React.useEffect(() => { setActive(0); }, [q]);

    if (!open) return null;

    const pick = (w) => { if (w) { onPick(w.id); onClose(); } };
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(flat.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(flat[active]); }
    };

    let idx = -1;
    return (
      <div className="cmdk-backdrop" onMouseDown={onClose}>
        <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} role="dialog" aria-label="Switch workspace">
          <div className="cmdk-search">
            <Icon name="search" size={16} tone="mute" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Switch workspace — company, department, team or personal…" />
            <span className="kbd">esc</span>
          </div>
          <div className="cmdk-list">
            {flat.length === 0 && <div className="cmdk-empty">No workspace matches “{q}”.</div>}
            {groups.map((g) => (
              <div className="cmdk-group" key={g.tier.key}>
                <div className="cmdk-grouphd"><Icon name={g.tier.icon} size={12} tone="faint" /><span>{g.tier.label}</span><span className="cmdk-grouphint">{g.tier.hint}</span></div>
                {g.items.map((w) => {
                  idx += 1; const i = idx; const isCur = w.id === current;
                  return (
                    <button key={w.id} className={'cmdk-row' + (i === active ? ' active' : '')}
                      onMouseEnter={() => setActive(i)} onClick={() => pick(w)}>
                      <span className="cmdk-mark">{w.mark}</span>
                      <span className="cmdk-main">
                        <span className="cmdk-name">{w.name}{isCur && <span className="cmdk-cur">current</span>}</span>
                        <span className="cmdk-desc">{w.desc}</span>
                      </span>
                      <span className={'clf clf-' + w.cls}><span className="d" />{CLF_LABEL[w.cls]}</span>
                      <span className="cmdk-meta">{w.items.toLocaleString()} items · {w.people} {w.people === 1 ? 'person' : 'people'}</span>
                      {i === active ? <Icon name="arrow" size={14} tone="accent" /> : <span style={{ width: 14 }} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="cmdk-foot">
            <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
            <span><span className="kbd">↵</span> switch</span>
            <span className="grow" />
            <span>Everything you do is scoped to the active workspace</span>
          </div>
        </div>
      </div>
    );
  }

  function PersonaSwitch({ persona, setPersona }) {
    return (
      <div className="tabs sm" style={{ marginRight: 6 }}>
        {[['admin', 'Admin'], ['member', 'Member']].map(([k, label]) => (
          <button key={k} className={'tab' + (persona === k ? ' on' : '')} onClick={() => setPersona(k)}>{label}</button>
        ))}
      </div>
    );
  }

  function Chrome({ user, role, onSignOut, theme, onToggleTheme, title, onMenu }) {
    return (
      <div className="zs-chrome">
        {onMenu && <button className="chrome-btn chrome-menu" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" size={17} tone="mute" /></button>}
        <div className="zs-traffic"><span /><span /><span /></div>
        <div className="zs-chrome-title">{title}</div>
        <div className="chrome-tools">
          <EnvChip />
          <span style={{ width: 1, height: 18, background: 'var(--paper-edge)', margin: '0 6px' }} />
          <button className="chrome-btn" title="Search"><Icon name="search" size={16} tone="mute" /></button>
          <button className="chrome-btn" title="Notifications"><Icon name="bell" size={16} tone="mute" /></button>
          <button className="chrome-btn" onClick={onToggleTheme} title="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} tone="mute" /></button>
          <span style={{ width: 1, height: 18, background: 'var(--paper-edge)', margin: '0 6px' }} />
          <span className="flex items-center gap-2" title={role} style={{ whiteSpace: 'nowrap' }}>
            <span className="ava" style={{ width: 22, height: 22, background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent', fontSize: 9 }}>{user.initial}</span>
            <span className="chrome-name" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)' }}>{user.name} · {role}</span>
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

  function Rail({ section, setSection, account, workspace, onOpenSwitcher, groups, footer, open, onClose }) {
    const ws = workspace;
    const tier = ws && TIERS.find((t) => t.key === ws.tier);
    return (
      <React.Fragment>
      {open && <div className="rail-backdrop" onClick={onClose} />}
      <aside className={'rail' + (open ? ' open' : '')}>
        <div className="rail-pad" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* brand */}
          <div className="flex items-center gap-3" style={{ padding: '4px 6px 2px' }}>
            <Enso size={22} />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, letterSpacing: '-0.01em' }}>Strategos</span>
          </div>

          {/* active workspace — opens the command palette */}
          {ws ? (
            <button className="ws-trigger" onClick={onOpenSwitcher} title="Switch workspace  ⌘K" style={{ marginTop: 'var(--space-4)' }}>
              <span className="org-mark">{ws.mark}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span className="flex items-center gap-2">
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ws.name}</span>
                  <span className={'wsdot wsdot-' + ws.cls} />
                </span>
                <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tier ? tier.label.toLowerCase() : ws.tier} workspace</span>
              </span>
              <span className="ws-switch"><Icon name="caret" size={14} tone="mute" /></span>
            </button>
          ) : (
            <div className="org" style={{ marginTop: 'var(--space-4)' }}>
              <span className="org-mark">{account.mark}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{account.sub}</div>
              </div>
            </div>
          )}

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
      </React.Fragment>
    );
  }

  /* ── bottom tab bar (phone) — primary destinations + "More" opening the drawer ── */
  function MobileTabs({ items, section, onPick, onMore }) {
    return (
      <nav className="mtabs">
        {items.map((it) => (
          <button key={it.id} className={'mtab' + (section === it.id ? ' on' : '')} onClick={() => onPick(it.id)}>
            <Icon name={it.icon} size={18} tone={section === it.id ? 'accent' : 'mute'} />
            <span>{it.label}</span>
          </button>
        ))}
        {onMore && (
          <button className="mtab" onClick={onMore}>
            <Icon name="more" size={18} tone="mute" />
            <span>More</span>
          </button>
        )}
      </nav>
    );
  }

  window.StrategosShell = { Chrome, Rail, WorkspaceSwitcher, MobileTabs };
})();
