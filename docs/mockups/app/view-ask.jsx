/* Strategos Console · view-ask.jsx (member)
   A targeted-task surface over the shared library. Full-bleed: a conversation
   column plus a live context rail (sources · follow-ups · scope). No knobs. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { useState } = React;

  const SPACES = ['Leasing Ops', 'Q1 Reporting', 'Brand Kit'];
  const SPACE_META = {
    'Leasing Ops':  { items: 1204, cls: 'internal',     members: ['M', 'J', 'A', 'S'] },
    'Q1 Reporting': { items: 318,  cls: 'confidential',  members: ['A', 'M'] },
    'Brand Kit':    { items: 96,   cls: 'public',        members: ['S', 'M', 'J'] },
  };
  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  const TASKS = [
    { k: 'find',      label: 'Find',      icon: 'search', ask: 'Find overdue renewals' },
    { k: 'summarize', label: 'Summarize', icon: 'doc',    ask: 'Summarize for the board' },
    { k: 'draft',     label: 'Draft',     icon: 'create', ask: 'Draft a renewal notice' },
    { k: 'compare',   label: 'Compare',   icon: 'scale',  ask: 'Compare to last quarter' },
  ];

  const EXCHANGES = {
    find: {
      q: 'Which units are due for lease renewal in Q3?',
      tools: 'searched 1,204 items · 6 matched',
      a: <span><b>Nine units</b> have leases ending in Q3 — five in Maple Court, three in Harbour View, one in Kingsgate. Maple Court 4B and 7A are already past their 90-day notice window and should be actioned first.</span>,
      src: [['renewals-schedule.csv', 'sheet', 'Q3 lease-end dates · 1,204 rows'], ['lease-register.md', 'doc', 'Master register · all units']],
    },
    summarize: {
      q: 'Summarize the Q1 service-charge variance for the board.',
      tools: 'read 3 docs · 2 tables',
      a: <span>Three properties breached their Q1 budget — Maple Court (+£14,200), Harbour View (+£9,750) and Old Mill Lofts (+£3,110) — driven by lift maintenance and grounds upkeep. Net portfolio variance was <b>+£27,060 (4.1%)</b> against plan.</span>,
      src: [['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table'], ['service-charges.csv', 'sheet', 'Per-property charges']],
    },
    draft: {
      q: 'Draft a renewal notice for Maple Court 4B.',
      tools: 'used template · merged tenant record',
      a: <span>Drafted a renewal notice using the <b>standard renewal template</b>, merged with the 4B tenant record and current schedule-of-rates. Saved to <b>Leasing Ops</b> as a Confidential draft — review the rent uplift figure before sending.</span>,
      src: [['renewal-notice.template.md', 'doc', 'Standard renewal template'], ['tenant-4b.json', 'code', 'Tenant record · Maple Court 4B']],
    },
    compare: {
      q: 'Compare maintenance spend across Maple Court and Harbour View.',
      tools: 'queried warehouse · charted',
      a: <span>Maple Court spent <b>£62,400</b> vs Harbour View's <b>£40,750</b> on maintenance last quarter. The gap is almost entirely lift servicing (£18k at Maple Court, two emergency call-outs). Per-unit, the two are within 6%.</span>,
      src: [['maintenance-log.csv', 'sheet', 'Work orders · last quarter'], ['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table']],
    },
  };

  function AskView({ initial = 'M' }) {
    const [space, setSpace] = useState('Leasing Ops');
    const [task, setTask] = useState('find');
    const ex = EXCHANGES[task];
    const meta = SPACE_META[space];
    const suggestions = TASKS.filter((t) => t.k !== task);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* header */}
        <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)' }}>
          <div className="zs-eyebrow">Ask</div>
          <h1 className="zs-h1" style={{ marginTop: 4 }}>What do you need?</h1>
        </div>

        {/* control bar */}
        <div className="flex items-center gap-3" style={{ padding: '0 var(--space-6) var(--space-4)', flexWrap: 'wrap' }}>
          <div className="flex items-center gap-2" style={{ height: 32, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}>
            <Icon name="library" size={14} tone="accent" />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-mute)' }}>Asking across</span>
            <select value={space} onChange={(e) => setSpace(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', font: '600 13px var(--font-ui)', color: 'var(--ink)', cursor: 'pointer' }}>
              {SPACES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <span className="clf clf-internal"><span className="d" />grounded · in-tenant</span>
          <span className="grow" />
          <div className="tabs sm">
            {TASKS.map((t) => (
              <button key={t.k} className={'tab' + (task === t.k ? ' on' : '')} onClick={() => setTask(t.k)}>
                <Icon name={t.icon} size={14} tone={task === t.k ? 'ink' : 'mute'} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* body: conversation + context rail */}
        <div className="flex" style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--paper-edge)' }}>
          {/* conversation */}
          <section className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }} className="rise">
              <div style={{ maxWidth: 820, margin: '0 auto' }}>
                {/* user turn */}
                <div className="flex items-start gap-3" style={{ marginBottom: 'var(--space-5)' }}>
                  <span className="ava" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent' }}>{initial}</span>
                  <div style={{ paddingTop: 3, fontSize: 'var(--text-lg)', color: 'var(--ink)', lineHeight: 1.5, fontFamily: 'var(--font-display)', fontWeight: 400 }}>{ex.q}</div>
                </div>

                {/* answer */}
                <div className="answer">
                  <div className="answer-hd"><Icon name="spark" size={12} tone="accent" /> Answer <span className="grow" /> <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>{ex.tools}</span></div>
                  <div className="answer-bd" style={{ fontSize: 'var(--text-lg)', lineHeight: 1.65 }}>
                    {ex.a}
                    <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
                      {ex.src.map(([name], i) => (
                        <span key={name} className="chip" style={{ height: 22 }}><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup>{name}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {task === 'draft' && (
                  <div className="flex items-center gap-3" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)', background: 'var(--accent-soft)', border: '1px solid oklch(0.58 0.15 35 / 0.25)' }}>
                    <Icon name="create" size={16} tone="accent" />
                    <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>Draft saved to <b>Leasing Ops</b> · <span className="clf clf-confidential" style={{ verticalAlign: 'middle' }}><span className="d" />Confidential</span></span>
                    <button className="zs-btn zs-btn-secondary zs-btn-sm">Open in library</button>
                  </div>
                )}
              </div>
            </div>

            {/* composer */}
            <div style={{ background: 'var(--paper-soft)', borderTop: '1px solid var(--paper-edge)' }}>
              <div className="composer" style={{ maxWidth: 820, margin: '0 auto', background: 'transparent', borderTop: 'none' }}>
                <Icon name="plus" size={16} tone="mute" />
                <input placeholder={'Ask, find, draft or compare across ' + space + '…'} readOnly />
                <button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="ask" size={13} tone="paper" /> Send <span className="kbd" style={{ marginLeft: 4 }}>⌘↵</span></button>
              </div>
            </div>
          </section>

          {/* context rail */}
          <aside style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--paper-edge)', background: 'var(--paper-soft)', overflowY: 'auto', padding: 'var(--space-5)' }}>
            <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Sources used</div>
            <div className="flex flex-col gap-2">
              {ex.src.map(([name, kind, desc], i) => (
                <div key={name} className="flex items-start gap-3" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', cursor: 'pointer' }}>
                  <span className="item-ic" style={{ width: 30, height: 30 }}><Icon name={kind} size={14} tone="soft" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-1"><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup><span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span></div>
                    <div className="zs-body-sm" style={{ fontSize: 11.5, marginTop: 1 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Suggested next</div>
            <div className="flex flex-col gap-2">
              {suggestions.map((t) => (
                <button key={t.k} onClick={() => setTask(t.k)} className="flex items-center gap-3" style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', textAlign: 'left' }}>
                  <Icon name={t.icon} size={15} tone="mute" />
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{t.ask}</span>
                  <Icon name="arrow" size={13} tone="faint" />
                </button>
              ))}
            </div>

            <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Scope</div>
            <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--paper-edge)', background: 'var(--paper)' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
                <span className="flex items-center gap-2"><Icon name="library" size={15} tone="accent" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{space}</span></span>
                <span className={'clf clf-' + meta.cls}><span className="d" />{CLF_LABEL[meta.cls]}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="ava-row">{meta.members.map((a) => <span key={a} className="ava" style={{ width: 22, height: 22 }}>{a}</span>)}</div>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{meta.items.toLocaleString()} items</span>
              </div>
            </div>

            <p className="zs-body-sm" style={{ marginTop: 'var(--space-4)', fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>Answers are grounded only in documents you can access. Confidential content is masked for members without space access.</p>
          </aside>
        </div>
      </div>
    );
  }

  window.AskView = AskView;
})();
