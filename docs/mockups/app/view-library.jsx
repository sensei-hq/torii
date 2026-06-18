/* Strategos Console · view-library.jsx (member)
   The shared content system. Uploads of any format are normalized to
   md / csv / json / images for consistent embeddings. Members add, reorganize,
   share, and classify. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { useState } = React;

  const CLF = ['public', 'internal', 'confidential', 'restricted'];
  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  const SPACES = [
    { id: 'leasing', name: 'Leasing Ops',   cls: 'internal' },
    { id: 'q1',      name: 'Q1 Reporting',  cls: 'confidential' },
    { id: 'brand',   name: 'Brand Kit',     cls: 'public' },
  ];

  // src = original upload format · norm = what it's stored as (kind drives chip icon)
  const ITEMS = {
    leasing: [
      { id: 'l0', title: 'Building inspection — Harbour View', src: 'PDF', owner: 'm.okafor', cls: 'internal', when: 'normalizing…', busy: true,
        norm: [['report.md', 'doc']] },
      { id: 'l1', title: 'Renewals schedule — Q3', src: 'XLSX', owner: 'm.okafor', cls: 'internal', when: '12m ago',
        norm: [['renewals-schedule.csv', 'sheet'], ['summary.md', 'doc']] },
      { id: 'l2', title: 'Lease register', src: 'MD', owner: 'm.okafor', cls: 'internal', when: '2h ago',
        norm: [['lease-register.md', 'doc'], ['index.json', 'code']] },
      { id: 'l3', title: 'Tenant onboarding checklist v3', src: 'DOCX', owner: 's.kaur', cls: 'internal', when: 'Yesterday',
        norm: [['onboarding.md', 'doc']] },
      { id: 'l4', title: 'Maple Court 4B — renewal notice', src: 'Draft', owner: 'm.okafor', cls: 'confidential', when: '1h ago',
        norm: [['renewal-notice.md', 'doc'], ['tenant-4b.json', 'code']] },
    ],
    q1: [
      { id: 'q0', title: 'Q1 service-charge pack', src: 'PDF', owner: 'a.rao', cls: 'confidential', when: '3d ago',
        norm: [['q1-reconciliation.md', 'doc'], ['service-charges.csv', 'sheet'], ['figures.png', 'image'], ['figures-2.png', 'image']] },
      { id: 'q1d', title: 'Board deck — Q1 review', src: 'PDF', owner: 'a.rao', cls: 'confidential', when: '4d ago',
        norm: [['board-q1.md', 'doc'], ['charts.png', 'image']] },
      { id: 'q2', title: 'Reconciliation workbook', src: 'XLSX', owner: 'a.rao', cls: 'restricted', when: '1w ago',
        norm: [['reconciliation.csv', 'sheet'], ['ledger.csv', 'sheet']] },
    ],
    brand: [
      { id: 'b0', title: 'Logo pack', src: 'ZIP', owner: 's.kaur', cls: 'public', when: '2w ago',
        norm: [['logos.png', 'image'], ['logos-mono.png', 'image']] },
      { id: 'b1', title: 'Voice & tone guide', src: 'DOCX', owner: 's.kaur', cls: 'public', when: '3w ago',
        norm: [['voice.md', 'doc']] },
      { id: 'b2', title: 'Letterhead template', src: 'DOCX', owner: 's.kaur', cls: 'public', when: '1mo ago',
        norm: [['letterhead.md', 'doc']] },
    ],
  };

  const SRC_HINT = { PDF: 'pdf', DOCX: 'docx', XLSX: 'xlsx', MD: 'native', ZIP: 'archive', Draft: 'native' };

  function NormChip({ name, kind }) {
    return <span className="chip"><Icon name={kind} size={11} tone="mute" />{name}</span>;
  }
  function Clf({ cls }) { return <span className={'clf clf-' + cls}><span className="d" />{CLF_LABEL[cls]}</span>; }

  function Detail({ item, cls, setCls, onClose }) {
    return (
      <aside className="card" style={{ width: 340, flexShrink: 0, alignSelf: 'flex-start', position: 'sticky', top: 0, overflow: 'hidden' }}>
        <div className="card-hd">
          <span className="zs-eyebrow">Details</span>
          <button className="chrome-btn" onClick={onClose} aria-label="close"><Icon name="close" size={15} tone="mute" /></button>
        </div>
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
            <span className="glyph accent" style={{ width: 42, height: 42 }}><Icon name="doc" size={20} tone="accent" /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{item.title}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>uploaded as {item.src} · {SRC_HINT[item.src]}</div>
            </div>
          </div>

          {/* normalization */}
          <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Stored as</div>
          <p className="zs-body-sm" style={{ fontSize: 12, marginBottom: 10 }}>Normalized for consistent embeddings &amp; query.</p>
          <div className="flex flex-wrap gap-2" style={{ marginBottom: 'var(--space-5)' }}>
            {item.norm.map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
          </div>

          {/* confidentiality control */}
          <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Confidentiality</div>
          <div className="flex items-center gap-2" style={{ height: 36, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', marginBottom: 'var(--space-5)' }}>
            <Icon name="lock" size={14} tone={cls === 'restricted' || cls === 'confidential' ? 'accent' : 'mute'} />
            <select value={cls} onChange={(e) => setCls(item.id, e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', font: '500 13px var(--font-ui)', color: 'var(--ink)', cursor: 'pointer' }}>
              {CLF.map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}
            </select>
          </div>

          {/* sharing */}
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span className="zs-eyebrow">Shared with</span>
            <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="share" size={13} tone="soft" /> Share</button>
          </div>
          <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="ava-row">{['M', 'A', 'J'].map((a) => <span key={a} className="ava">{a}</span>)}</div>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>+ space members</span>
          </div>

          {/* owner + move */}
          <div className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: '1px solid var(--paper-edge)' }}>
            <span className="zs-body-sm">Owner</span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink)' }}>{item.owner}</span>
          </div>
          <div className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: '1px solid var(--paper-edge)' }}>
            <span className="zs-body-sm">Move to space</span>
            <select defaultValue="" style={{ border: 'none', outline: 'none', background: 'transparent', font: '500 12px var(--font-mono)', color: 'var(--ink-mute)', cursor: 'pointer' }}>
              <option value="">choose…</option>{SPACES.map((s) => <option key={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="flex gap-2" style={{ marginTop: 'var(--space-4)' }}>
            <button className="zs-btn zs-btn-primary" style={{ flex: 1, justifyContent: 'center' }}><Icon name="eye" size={14} tone="paper" /> Open</button>
            <button className="zs-btn zs-btn-secondary"><Icon name="more" size={14} tone="soft" /></button>
          </div>
        </div>
      </aside>
    );
  }

  function LibraryView() {
    const [space, setSpace] = useState('leasing');
    const [layout, setLayout] = useState('list');
    const [sel, setSel] = useState(null);
    const [clsMap, setClsMap] = useState({}); // id → overridden classification
    const setCls = (id, v) => setClsMap((m) => ({ ...m, [id]: v }));

    const items = ITEMS[space];
    const clsOf = (it) => clsMap[it.id] || it.cls;
    const selItem = items.find((i) => i.id === sel);

    return (
      <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
        {/* spaces rail */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--paper-edge)', padding: 'var(--space-4) var(--space-3)', overflowY: 'auto' }}>
          <div className="rail-label" style={{ padding: '0 10px 8px' }}>Spaces</div>
          <div className="flex flex-col" style={{ gap: 2 }}>
            {SPACES.map((s) => (
              <button key={s.id} className={'space' + (space === s.id ? ' on' : '')} onClick={() => { setSpace(s.id); setSel(null); }}>
                <Icon name="library" size={16} tone={space === s.id ? 'accent' : 'mute'} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>{ITEMS[s.id].length}</span>
              </button>
            ))}
          </div>
          <button className="zs-btn zs-btn-ghost zs-btn-sm" style={{ marginTop: 'var(--space-3)', width: '100%', justifyContent: 'flex-start' }}><Icon name="plus" size={14} tone="soft" /> New space</button>
        </div>

        {/* content */}
        <div className="view" style={{ display: 'flex', minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-5) var(--space-6)' }} className="rise">
            <div className="page-hd" style={{ marginBottom: 'var(--space-4)' }}>
              <div>
                <div className="zs-eyebrow">Library</div>
                <h1 className="zs-h1" style={{ marginTop: 4 }}>{SPACES.find((s) => s.id === space).name}</h1>
              </div>
              <div className="flex items-center gap-2">
                <button className="zs-btn zs-btn-secondary"><Icon name="upload" size={15} tone="soft" /> Upload</button>
                <button className="zs-btn zs-btn-primary"><Icon name="create" size={15} tone="paper" /> New doc</button>
              </div>
            </div>

            {/* toolbar */}
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="zs-input" style={{ maxWidth: 280, height: 32 }}>
                <Icon name="search" size={14} tone="mute" /><input placeholder="Search this space…" readOnly />
              </div>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{items.length} items</span>
              <span className="grow" />
              <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="sort" size={14} tone="soft" /> Recent</button>
              <div className="tabs sm">
                <button className={'tab' + (layout === 'list' ? ' on' : '')} onClick={() => setLayout('list')}><Icon name="list" size={14} tone={layout === 'list' ? 'ink' : 'mute'} /></button>
                <button className={'tab' + (layout === 'grid' ? ' on' : '')} onClick={() => setLayout('grid')}><Icon name="grid" size={14} tone={layout === 'grid' ? 'ink' : 'mute'} /></button>
              </div>
            </div>

            {/* upload→normalize hint */}
            <div className="flex items-center gap-3" style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)', background: 'var(--paper-mute)', border: '1px dashed var(--paper-edge)', marginBottom: 'var(--space-4)' }}>
              <Icon name="upload" size={16} tone="mute" />
              <span className="zs-body-sm" style={{ flex: 1 }}>Drop <b>pdf · docx · xlsx · pptx</b> here — Strategos normalizes each into <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>md · csv · json · images</span> for consistent embeddings.</span>
            </div>

            {/* items */}
            {layout === 'list' ? (
              <div className="card" style={{ overflow: 'hidden' }}>
                {items.map((it) => (
                  <div key={it.id} className={'item' + (sel === it.id ? ' sel' : '')} onClick={() => setSel(it.id)}>
                    <span className="item-ic"><Icon name={it.busy ? 'upload' : 'doc'} size={17} tone={it.busy ? 'mute' : 'soft'} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                        <span className="tag">{it.src}</span>
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 5, flexWrap: 'wrap' }}>
                        {it.busy
                          ? <span className="status" style={{ color: 'var(--ink-mute)' }}><span className="dot zs-spin" style={{ background: 'var(--accent)' }} />normalizing…</span>
                          : it.norm.map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                      </div>
                    </div>
                    <Clf cls={clsOf(it)} />
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', width: 76, textAlign: 'right' }}>{it.when}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {items.map((it) => (
                  <div key={it.id} className={'gcard' + (sel === it.id ? ' sel' : '')} onClick={() => setSel(it.id)}>
                    <div className="flex items-center justify-between">
                      <span className="glyph" style={{ width: 36, height: 36 }}><Icon name={it.busy ? 'upload' : 'doc'} size={17} tone="soft" /></span>
                      <span className="tag">{it.src}</span>
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, textWrap: 'pretty' }}>{it.title}</div>
                    <div className="flex flex-wrap gap-2">
                      {it.busy ? <span className="status" style={{ color: 'var(--ink-mute)' }}><span className="dot zs-spin" style={{ background: 'var(--accent)' }} />normalizing…</span> : it.norm.slice(0, 3).map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                    </div>
                    <div className="flex items-center justify-between" style={{ marginTop: 'auto' }}>
                      <Clf cls={clsOf(it)} />
                      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)' }}>{it.when}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selItem && <div style={{ padding: 'var(--space-5) var(--space-5) var(--space-5) 0' }}><Detail item={selItem} cls={clsOf(selItem)} setCls={setCls} onClose={() => setSel(null)} /></div>}
        </div>
      </div>
    );
  }

  window.LibraryView = LibraryView;
})();
