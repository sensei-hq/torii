/* Torii · shell.jsx — window chrome (with persona switch) + left rail. */
(function () {
  const { Kbd } = window.StrategosUI;
  const { Icon, Enso } = window.StrategosIcons;
  const { TIERS, wsByTier } = window.StrategosAPI;
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
      <div className="cmdk-backdrop lt-sm:!px-3 lt-sm:!pt-[8vh]" onMouseDown={onClose}>
        <div className="cmdk lt-sm:!w-full lt-sm:!max-h-[78vh]" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey} role="dialog" aria-label="Switch workspace">
          <div className="cmdk-search">
            <Icon name="search" size={16} tone="mute" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Switch workspace — company, department, team or personal…" />
            <Kbd>esc</Kbd>
          </div>
          <div className="cmdk-list">
            {flat.length === 0 && <div className="cmdk-empty">No workspace matches “{q}”.</div>}
            {groups.map((g) => (
              <div className="cmdk-group" key={g.tier.key}>
                <div className="cmdk-grouphd"><Icon name={g.tier.icon} size={12} tone="faint" /><span>{g.tier.label}</span><span className="cmdk-grouphint lt-tiny:!hidden">{g.tier.hint}</span></div>
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
                      <span className="cmdk-meta lt-tiny:!hidden">{w.items.toLocaleString()} items · {w.people} {w.people === 1 ? 'person' : 'people'}</span>
                      {i === active ? <Icon name="arrow" size={14} tone="accent" /> : <span className="w-[14px]" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="cmdk-foot">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
            <span><Kbd>↵</Kbd> switch</span>
            <span className="flex-1" />
            <span>Everything you do is scoped to the active workspace</span>
          </div>
        </div>
      </div>
    );
  }

  function PersonaSwitch({ persona, setPersona }) {
    return (
      <div className="tabs sm mr-1.5">
        {[['admin', 'Admin'], ['member', 'Member']].map(([k, label]) => (
          <button key={k} className={'tab' + (persona === k ? ' on' : '')} onClick={() => setPersona(k)}>{label}</button>
        ))}
      </div>
    );
  }

  function Chrome({ user, role, onSignOut, theme, onToggleTheme, title, onMenu, showEnv = true }) {
    return (
      <div className="zs-chrome">
        {onMenu && <button className="chrome-btn lg:!hidden" onClick={onMenu} aria-label="Open navigation"><Icon name="menu" size={17} tone="mute" /></button>}
        <div className="zs-traffic hidden lg:flex"><span /><span /><span /></div>
        <div className="zs-chrome-title">{title}</div>
        <div className="chrome-tools">
          {showEnv && <EnvChip />}
          <span className="w-[1px] h-[18px] bg-paper-edge my-0 mx-1.5" />
          <button className="chrome-btn lt-sm:!hidden" title="Search"><Icon name="search" size={16} tone="mute" /></button>
          <button className="chrome-btn lt-sm:!hidden" title="Notifications"><Icon name="bell" size={16} tone="mute" /></button>
          <button className="chrome-btn" onClick={onToggleTheme} title="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} tone="mute" /></button>
          <span className="w-[1px] h-[18px] bg-paper-edge my-0 mx-1.5" />
          <span className="flex items-center gap-2 whitespace-nowrap" title={role}>
            <span className="ava w-[22px] h-[22px] bg-accent-soft text-accent border-transparent text-[9px]">{user.initial}</span>
            <span className="chrome-name lt-sm:hidden text-xs text-ink-soft">{user.name} · {role}</span>
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

  function Rail({ section, setSection, account, workspace, onOpenSwitcher, groups, footer, open, onClose, brand = 'Torii' }) {
    const ws = workspace;
    const tier = ws && TIERS.find((t) => t.key === ws.tier);
    return (
      <React.Fragment>
      {open && <div className="fixed inset-x-0 top-[38px] bottom-0 z-[89] bg-[oklch(0.22_0.012_50/0.28)] lg:hidden" onClick={onClose} />}
      {/* desktop: a 248px hairline rail · below lg: an off-canvas drawer */}
      <aside className={'rail flex flex-col w-[248px] shrink-0 overflow-y-auto bg-paper border-r lt-lg:fixed lt-lg:top-[38px] lt-lg:bottom-0 lt-lg:left-0 lt-lg:z-[90] lt-lg:w-[min(300px,84vw)] lt-lg:transition-transform '
        + (open ? 'lt-lg:translate-x-0 lt-lg:shadow-lg' : 'lt-lg:-translate-x-[102%]')}>
        <div className="rail-pad flex flex-col flex-1">
          {/* brand */}
          <div className="flex items-center gap-3 pt-1 px-1.5 pb-0.5">
            <Enso size={22} />
            <span className="font-display text-[17px] tracking-[-0.01em]">{brand}</span>
          </div>

          {/* active workspace — opens the command palette */}
          {ws ? (
            <button className="ws-trigger" onClick={onOpenSwitcher} title="Switch workspace  ⌘K" style={{ marginTop: '16px' }}>
              <span className="org-mark">{ws.mark}</span>
              <span className="flex-1 min-w-0 text-left">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{ws.name}</span>
                  <span className={'wsdot wsdot-' + ws.cls} />
                </span>
                <span className="block font-mono text-xs text-ink-mute whitespace-nowrap overflow-hidden text-ellipsis">{tier ? tier.label.toLowerCase() : ws.tier} workspace</span>
              </span>
              <span className="ws-switch"><Icon name="caret" size={14} tone="mute" /></span>
            </button>
          ) : (
            <div className="org mt-4">
              <span className="org-mark">{account.mark}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{account.name}</div>
                <div className="font-mono text-xs text-ink-mute">{account.sub}</div>
              </div>
            </div>
          )}

          {/* nav groups */}
          {groups.map((g) => (
            <div className="rail-group mt-6" key={g.label}>
              <div className="rail-label">{g.label}</div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((it) => <NavItem key={it.id} it={it} active={section === it.id} onClick={() => setSection(it.id)} />)}
              </div>
            </div>
          ))}

          <span className="flex-1" />
          {footer}
        </div>
      </aside>
      </React.Fragment>
    );
  }

  /* ── bottom tab bar (phone) — primary destinations + "More" opening the drawer ── */
  function MobileTabs({ items, section, onPick, onMore }) {
    return (
      <nav className="fixed left-0 right-0 bottom-0 z-[80] flex items-stretch border-t bg-paper px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] sm:hidden">
        {items.map((it) => (
          <button key={it.id} className={'flex-1 min-h-12 flex flex-col items-center justify-center gap-1 rounded text-xs leading-none active:bg-paper-mute '
              + (section === it.id ? 'text-accent font-medium' : 'text-ink-mute')} onClick={() => onPick(it.id)}>
            <Icon name={it.icon} size={18} tone={section === it.id ? 'accent' : 'mute'} />
            <span>{it.label}</span>
          </button>
        ))}
        {onMore && (
          <button className="flex-1 min-h-12 flex flex-col items-center justify-center gap-1 rounded text-xs leading-none text-ink-mute active:bg-paper-mute" onClick={onMore}>
            <Icon name="more" size={18} tone="mute" />
            <span>More</span>
          </button>
        )}
      </nav>
    );
  }

  window.StrategosShell = { Chrome, Rail, WorkspaceSwitcher, MobileTabs };
})();
