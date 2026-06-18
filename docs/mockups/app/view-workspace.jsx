/* Strategos Console · view-workspace.jsx (member home)
   Task-focused. Pick up recent work, jump into a space, start something new. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill } = window.StrategosUI;

  const RECENT = [
    { ic: 'ask',    kind: 'Thread', title: 'Which units are due for lease renewal in Q3?', space: 'Leasing Ops', when: '12m ago' },
    { ic: 'create', kind: 'Draft',  title: 'Maple Court — service-charge variance memo',   space: 'Q1 Reporting', when: '1h ago' },
    { ic: 'doc',    kind: 'Doc',    title: 'Tenant onboarding checklist v3',                space: 'Leasing Ops', when: 'Yesterday' },
  ];

  const SPACES = [
    { name: 'Leasing Ops',   cls: 'internal',     items: 1204, members: ['M', 'J', 'A', 'S'], desc: 'Renewals, viewings, tenant comms' },
    { name: 'Q1 Reporting',  cls: 'confidential', items: 318,  members: ['A', 'M'],           desc: 'Quarterly packs, reconciliations' },
    { name: 'Brand Kit',     cls: 'public',       items: 96,   members: ['S', 'M', 'J'],      desc: 'Logos, templates, voice' },
  ];

  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  function Avatars({ list }) {
    return <div className="ava-row">{list.slice(0, 4).map((a, i) => <span key={i} className="ava">{a}</span>)}</div>;
  }

  function WorkspaceView({ go, name = 'Mara' }) {
    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Wed · 22 Apr</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>{'Good morning, ' + name + '.'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="zs-btn zs-btn-secondary" onClick={() => go('library')}><Icon name="upload" size={15} tone="soft" /> Upload</button>
            <button className="zs-btn zs-btn-primary" onClick={() => go('ask')}><Icon name="ask" size={15} tone="paper" /> Ask</button>
          </div>
        </div>

        {/* Continue */}
        <div className="sec" style={{ marginTop: 0 }}>
          <div className="sec-hd"><h2 className="zs-h2">Pick up where you left off</h2></div>
          <div className="grid grid-cols-3 gap-4">
            {RECENT.map((r) => (
              <button key={r.title} className="gcard" onClick={() => go(r.ic === 'ask' ? 'ask' : 'library')} style={{ textAlign: 'left' }}>
                <div className="flex items-center justify-between">
                  <span className="glyph" style={{ width: 34, height: 34 }}><Icon name={r.ic} size={17} tone="soft" /></span>
                  <span className="tag">{r.kind}</span>
                </div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, textWrap: 'pretty' }}>{r.title}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)' }}>{r.space} · {r.when}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Spaces */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Your spaces</h2><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => go('library')}>open library →</button></div>
          <div className="grid grid-cols-3 gap-4">
            {SPACES.map((s) => (
              <button key={s.name} className="card" onClick={() => go('library')} style={{ padding: 'var(--space-5)', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="flex items-center justify-between">
                  <span className="glyph accent" style={{ width: 38, height: 38 }}><Icon name="library" size={18} tone="accent" /></span>
                  <span className={'clf clf-' + s.cls}><span className="d" />{CLF_LABEL[s.cls]}</span>
                </div>
                <div>
                  <div className="zs-h3">{s.name}</div>
                  <div className="zs-body-sm" style={{ marginTop: 2 }}>{s.desc}</div>
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 'auto' }}>
                  <Avatars list={s.members} />
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{s.items.toLocaleString()} items</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Start something */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Start something new</h2></div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { ic: 'ask',    t: 'Ask across your docs', s: 'summarize · find · compare', go: 'ask' },
              { ic: 'create', t: 'Draft a document',     s: 'memo, report, checklist', go: 'library' },
              { ic: 'upload', t: 'Upload files',         s: 'pdf · docx · xlsx → normalized', go: 'library' },
            ].map((a) => (
              <button key={a.t} className="card" onClick={() => go(a.go)} style={{ padding: 'var(--space-4)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span className="glyph" style={{ width: 38, height: 38 }}><Icon name={a.ic} size={18} tone="soft" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{a.t}</span>
                  <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>{a.s}</span>
                </span>
                <Icon name="arrow" size={15} tone="faint" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.WorkspaceView = WorkspaceView;
})();
