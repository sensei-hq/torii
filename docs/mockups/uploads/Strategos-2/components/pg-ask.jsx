/* Strategos · pg-ask.jsx — the END-USER surface (mirrors app/view-ask.jsx).
   No pipeline knobs, no meters: a member picks a space and a task, asks, and
   gets a grounded answer with sources. This is "use", not "configure". */
const { Icon: AKIcon } = window.StrategosIcons;
const { useState: akUseState } = React;

const AK_SPACES = {
  'Leasing Ops':  { items: 1204, cls: 'Internal',     members: ['M', 'J', 'A', 'S'] },
  'Q1 Reporting': { items: 318,  cls: 'Confidential',  members: ['A', 'M'] },
  'Brand Kit':    { items: 96,   cls: 'Public',        members: ['S', 'M', 'J'] },
};

const AK_TASKS = [
  { k: 'find',      label: 'Find',      icon: 'search' },
  { k: 'summarize', label: 'Summarize', icon: 'doc' },
  { k: 'draft',     label: 'Draft',     icon: 'spark' },
  { k: 'compare',   label: 'Compare',   icon: 'scale' },
];

const AK_EXCHANGES = {
  find: {
    q: 'Which units are due for lease renewal in Q3?',
    tools: 'searched 1,204 items · 6 matched',
    a: <span><b>Nine units</b> have leases ending in Q3 — five in Maple Court, three in Harbour View, one in Kingsgate. Maple Court 4B and 7A are already past their 90-day notice window and should be actioned first.</span>,
    src: [['renewals-schedule.csv', 'chart', 'Q3 lease-end dates · 1,204 rows'], ['lease-register.md', 'doc', 'Master register · all units']],
  },
  summarize: {
    q: 'Summarize the Q1 service-charge variance for the board.',
    tools: 'read 3 docs · 2 tables',
    a: <span>Three properties breached their Q1 budget — Maple Court (+£14,200), Harbour View (+£9,750) and Old Mill Lofts (+£3,110) — driven by lift maintenance and grounds upkeep. Net portfolio variance was <b>+£27,060 (4.1%)</b> against plan.</span>,
    src: [['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table'], ['service-charges.csv', 'chart', 'Per-property charges']],
  },
  draft: {
    q: 'Draft a renewal notice for Maple Court 4B.',
    tools: 'used template · merged tenant record',
    a: <span>Drafted a renewal notice using the <b>standard renewal template</b>, merged with the 4B tenant record and current schedule-of-rates. Saved to <b>Leasing Ops</b> as a Confidential draft — review the rent uplift figure before sending.</span>,
    src: [['renewal-notice.template.md', 'doc', 'Standard renewal template'], ['tenant-4b.json', 'doc', 'Tenant record · Maple Court 4B']],
  },
  compare: {
    q: 'Compare maintenance spend across Maple Court and Harbour View.',
    tools: 'queried warehouse · charted',
    a: <span>Maple Court spent <b>£62,400</b> vs Harbour View's <b>£40,750</b> on maintenance last quarter. The gap is almost entirely lift servicing (£18k at Maple Court, two emergency call-outs). Per-unit, the two are within 6%.</span>,
    src: [['maintenance-log.csv', 'chart', 'Work orders · last quarter'], ['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table']],
  },
};

function AskMock() {
  const [space, setSpace] = akUseState('Leasing Ops');
  const [task, setTask] = akUseState('find');
  const ex = AK_EXCHANGES[task];
  const meta = AK_SPACES[space];
  const suggestions = AK_TASKS.filter((t) => t.k !== task);

  return (
    <div className="appwin">
      <div className="appwin-bar">
        <div className="traffic"><span style={{ background: '#E36355' }}></span><span style={{ background: '#F5BE4F' }}></span><span style={{ background: '#61C554' }}></span></div>
        <span className="wtitle"><AKIcon name="user" size={14} /> Ask · what a member sees</span>
        <div className="wright">
          <span className="tag"><AKIcon name="lock" size={12} /> grounded · in-tenant</span>
        </div>
      </div>

      {/* task bar — no pipeline knobs, just what you want to do */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'var(--paper-inset)' }}>
          <AKIcon name="layers" size={14} style={{ color: 'var(--moss)' }} />
          <span style={{ font: '400 12.5px var(--font-body)', color: 'var(--ink-mute)' }}>Asking across</span>
          <select value={space} onChange={(e) => setSpace(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', font: '600 13px var(--font-body)', color: 'var(--ink)', cursor: 'pointer' }}>
            {Object.keys(AK_SPACES).map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <span className="seg" role="tablist" style={{ marginLeft: 'auto' }}>
          {AK_TASKS.map((t) => (
            <button key={t.k} role="tab" aria-selected={t.k === task} className={t.k === task ? 'on' : ''} onClick={() => setTask(t.k)}>
              <span className="si"><AKIcon name={t.icon} size={14} /></span>{t.label}
            </button>
          ))}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', minHeight: 480 }}>
        {/* conversation */}
        <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '22px 24px', flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--moss-soft)', color: 'var(--moss)', font: '600 12px var(--font-mono)' }}>M</span>
              <div style={{ paddingTop: 3, font: '400 18px/1.5 var(--font-display)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>{ex.q}</div>
            </div>

            <div className="final-reply">
              <div className="ft" style={{ display: 'flex', alignItems: 'center' }}><AKIcon name="spark" size={12} /> Answer<span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', font: '500 10px var(--font-mono)' }}>{ex.tools}</span></div>
              <div className="body" style={{ font: '400 15px/1.65 var(--font-body)' }}>
                {ex.a}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {ex.src.map(([name], i) => (
                    <span key={name} className="tag"><sup style={{ font: '600 9px var(--font-mono)', color: 'var(--sky)' }}>{i + 1}</sup> {name}</span>
                  ))}
                </div>
              </div>
              {task === 'draft' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--moss-soft)', border: '1px solid var(--moss-line)' }}>
                  <AKIcon name="spark" size={15} style={{ color: 'var(--moss)' }} />
                  <span style={{ flex: 1, font: '400 13px var(--font-body)', color: 'var(--ink)' }}>Saved to <b>Leasing Ops</b> as a Confidential draft.</span>
                  <span className="btn sm">Open in library</span>
                </div>
              )}
            </div>
          </div>

          {/* composer — the only input a member needs */}
          <div className="appwin-bar" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none', height: 'auto', padding: '12px 16px', background: 'var(--paper-card)' }}>
            <AKIcon name="plus" size={16} style={{ color: 'var(--ink-soft)' }} />
            <span style={{ flex: 1, font: '400 13px var(--font-body)', color: 'var(--ink-faint)' }}>{'Ask, find, draft or compare across ' + space + '…'}</span>
            <span className="btn primary sm"><AKIcon name="send" size={13} /> Send</span>
          </div>
        </div>

        {/* context rail — sources, next steps, scope (read-only) */}
        <div style={{ background: 'var(--paper-card)', minWidth: 0, padding: '16px 18px', overflowY: 'auto' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Sources used</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ex.src.map(([name, kind, desc], i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'var(--paper)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center', border: '1px solid var(--line)', background: 'var(--paper-inset)', color: 'var(--ink-soft)' }}><AKIcon name={kind === 'chart' ? 'chart' : 'doc'} size={13} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '500 12px var(--font-mono)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: 'var(--sky)' }}>{i + 1}</span> {name}</div>
                  <div style={{ font: '400 11px var(--font-body)', color: 'var(--ink-soft)', marginTop: 1 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="eyebrow" style={{ margin: '20px 0 10px' }}>Suggested next</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map((t) => (
              <button key={t.k} onClick={() => setTask(t.k)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'var(--paper)', textAlign: 'left', cursor: 'pointer' }}>
                <AKIcon name={t.icon} size={14} style={{ color: 'var(--ink-soft)' }} />
                <span style={{ flex: 1, font: '400 12.5px var(--font-body)', color: 'var(--ink)' }}>{AK_EXCHANGES[t.k].q}</span>
                <AKIcon name="arrowR" size={12} style={{ color: 'var(--ink-faint)' }} />
              </button>
            ))}
          </div>

          <div className="eyebrow" style={{ margin: '20px 0 10px' }}>Scope</div>
          <div style={{ padding: 14, borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><AKIcon name="layers" size={14} style={{ color: 'var(--moss)' }} /><span style={{ font: '600 13px var(--font-body)', color: 'var(--ink)' }}>{space}</span></span>
              <span className="tag">{meta.cls}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex' }}>{meta.members.map((a, i) => <span key={a} style={{ width: 22, height: 22, borderRadius: '50%', marginLeft: i ? -6 : 0, display: 'grid', placeItems: 'center', background: 'var(--paper-inset)', border: '1px solid var(--paper-card)', font: '600 9px var(--font-mono)', color: 'var(--ink-soft)' }}>{a}</span>)}</span>
              <span style={{ font: '500 11px var(--font-mono)', color: 'var(--ink-mute)' }}>{meta.items.toLocaleString()} items</span>
            </div>
          </div>
          <p style={{ marginTop: 14, font: '400 11.5px/1.5 var(--font-body)', color: 'var(--ink-faint)' }}>Answers are grounded only in documents this person can access. Confidential content is masked for members without space access.</p>
        </div>
      </div>
    </div>
  );
}

window.AskMock = AskMock;
