/* Torii · view-library.jsx (member)
   The shared content system, now a document workspace. Uploads of any format
   are normalized to md / csv / json / images for consistent embeddings.
   This is the index: spaces, collections, tags, storage, multi-select + bulk
   actions, and ingestion status. Selecting an item opens the DocWorkspace. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { useSnippets, Sessions, MyTemplates, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { PROMPT_TEMPLATES, WS_DOCS, WS_COLLECTIONS } = window.StrategosData;
  const { useState } = React;
  const Switch = window.StrategosUI.Switch;

  // owner-facing space-override layer — reads the same store admin Spaces & KB writes
  const KB_D = { chunk: 'structural', retr: 'hybrid', embed: 'bge-large-1024', rerank: true, classification: 'internal', maskStrict: false, tiers: ['frontier', 'balanced', 'fast', 'local'], retention: '24mo' };
  function loadSpaceKB(id) { try { return Object.assign({}, KB_D, JSON.parse(localStorage.getItem('zs-kb-' + id) || '{}')); } catch (e) { return Object.assign({}, KB_D); } }
  const RET_LABEL = { '90d': '90 days', '12mo': '12 months', '24mo': '24 months', forever: 'Keep forever' };
  const TIERS_ALL = ['frontier', 'balanced', 'fast', 'local'];
  const CLF_MAP = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  function SpaceSettings({ ws, onBack }) {
    const [kb, setKb] = React.useState(() => loadSpaceKB(ws.id));
    const save = (patch) => setKb((o) => { const n = Object.assign({}, o, patch); try { localStorage.setItem('zs-kb-' + ws.id, JSON.stringify(n)); } catch (e) {} return n; });
    const roStyle = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' };
    const chip = (on, onClick, label) => <button key={label} onClick={onClick} style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{label}</button>;
    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Library" title={ws.name + ' · space settings'} subMax={600}
          before={<button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onBack} style={{ marginBottom: 8 }}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</button>}
          sub="As the space owner, tighten the workspace defaults for everyone in this space. Members inherit these. The ingestion pipeline is set by an administrator." />
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="governance" size={15} tone="soft" /><span className="zs-eyebrow">Classification & masking</span></span></div>
          <div style={{ padding: 'var(--space-5)' }}>
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <span className="zs-eyebrow" style={{ margin: 0 }}>Default classification</span>
              <select value={kb.classification} onChange={(e) => save({ classification: e.target.value })} style={roStyle}>{Object.keys(CLF_MAP).map((c) => <option key={c} value={c}>{CLF_MAP[c]}</option>)}</select>
              <span className={'clf clf-' + kb.classification}><span className="d" />{CLF_MAP[kb.classification]}</span>
            </div>
            <div className="flex items-center gap-3" style={{ marginTop: 'var(--space-4)' }}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>Force PII masking</div><div className="zs-body-sm" style={{ fontSize: 12 }}>always mask in this space, even if the workspace default is off</div></div>
              <Switch on={kb.maskStrict} onClick={() => save({ maskStrict: !kb.maskStrict })} label="Force masking" />
            </div>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="scale" size={15} tone="soft" /><span className="zs-eyebrow">Allowed model tiers</span></span></div>
          <div className="flex" style={{ padding: 'var(--space-5)', gap: 8, flexWrap: 'wrap' }}>
            {TIERS_ALL.map((t) => chip(kb.tiers.includes(t), () => save({ tiers: kb.tiers.includes(t) ? kb.tiers.filter((x) => x !== t) : [...kb.tiers, t] }), t))}
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="filter" size={15} tone="soft" /><span className="zs-eyebrow">Retrieval defaults</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>set by admin</span></div>
          <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
            {[['Chunking', kb.chunk], ['Retrieval', kb.retr + (kb.retr === 'hybrid' ? ' · ' + (kb.hybrid || 65) + '% dense' : '')], ['Reranking', kb.rerank ? 'on' : 'off'], ['Embedding', kb.embed], ['Retention', RET_LABEL[kb.retention] || kb.retention]].map(([k, v], i) => (
              <div key={k} className="flex items-center justify-between" style={{ padding: '9px 0', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{k}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{v}</span>
              </div>
            ))}
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>The parsing, chunking and retrieval pipeline is owned by an administrator in <b>Spaces & knowledge base</b>. Classification, masking and allowed tiers are yours to tighten here.</span></div>
        </div>
      </div>
    );
  }

  const CLF = ['public', 'internal', 'confidential', 'restricted'];
  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  // storage figures derived from the active workspace's tier + item count
  const QUOTA_BY_TIER = { company: 50, department: 20, team: 10, personal: 5 };
  function storageOf(ws) {
    const quota = QUOTA_BY_TIER[ws.tier] || 10;
    const used = Math.min(+(quota * 0.95).toFixed(1), +(ws.items / 180).toFixed(1));
    return { used, quota };
  }

  const ING = {
    ready:     { lbl: 'Ready',     tone: 'success', cls: 'ok' },
    queued:    { lbl: 'Queued',    tone: 'mute',    cls: 'wait' },
    parsing:   { lbl: 'Parsing',   tone: 'accent',  cls: 'run' },
    chunking:  { lbl: 'Chunking',  tone: 'accent',  cls: 'run' },
    embedding: { lbl: 'Embedding', tone: 'accent',  cls: 'run' },
    failed:    { lbl: 'Failed',    tone: 'warning', cls: 'fail' },
  };

  function NormChip({ name, kind }) {
    return <span className="chip"><Icon name={kind} size={11} tone="mute" />{name}</span>;
  }
  function Clf({ cls }) { return <span className={'clf clf-' + cls}><span className="d" />{CLF_LABEL[cls]}</span>; }
  function IngBadge({ state }) {
    const m = ING[state] || ING.ready;
    return (
      <span className={'ing ing-' + m.cls}>
        {m.cls === 'run' ? <span className="dot zs-spin" style={{ background: 'var(--accent)' }} />
          : m.cls === 'ok' ? <Icon name="check" size={11} tone="success" />
          : m.cls === 'fail' ? <Icon name="warning" size={11} tone="warning" />
          : <span className="dot" style={{ background: 'var(--ink-faint)' }} />}
        {m.lbl}
      </span>
    );
  }

  function StorageMeter({ used, quota }) {
    const pct = Math.round((used / quota) * 100);
    const warn = pct >= 80;
    return (
      <div className="store">
        <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
          <span className="rail-label" style={{ padding: 0 }}>Storage</span>
          <span className="mono" style={{ fontSize: 10.5, color: warn ? 'var(--warning)' : 'var(--ink-mute)' }}>{used} / {quota} GB</span>
        </div>
        <div className="store-bar"><span className="store-fill" style={{ width: pct + '%', background: warn ? 'var(--warning)' : 'var(--accent)' }} /></div>
      </div>
    );
  }

  function BulkBar({ n, onClear, onReclassify }) {
    return (
      <div className="bulkbar rise">
        <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontWeight: 600 }}>{n} selected</span>
        <span style={{ width: 1, height: 18, background: 'var(--paper-edge)' }} />
        <label className="bulk-act">
          <Icon name="lock" size={14} tone="soft" /> Reclassify
          <select onChange={(e) => { if (e.target.value) onReclassify(e.target.value); e.target.value = ''; }} defaultValue="">
            <option value="">…</option>{CLF.map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}
          </select>
        </label>
        <button className="bulk-act"><Icon name="library" size={14} tone="soft" /> Move</button>
        <button className="bulk-act"><Icon name="plus" size={14} tone="soft" /> Tag</button>
        <button className="bulk-act"><Icon name="refresh" size={14} tone="soft" /> Re-process</button>
        <button className="bulk-act danger"><Icon name="trash" size={14} tone="warning" /> Delete</button>
        <span className="grow" />
        <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onClear}>Clear</button>
      </div>
    );
  }

  // Reusable assets — the shared home for templates, saved prompts, sessions.
  function ReuseView({ go, onBack }) {
    const snippets = useSnippets();
    const sessions = Sessions.use();
    const myTpls = MyTemplates.use();
    const templates = [...PROMPT_TEMPLATES, ...myTpls];
    const launch = (preset) => { window.StrategosUI.Handoff.set({ preset }); if (go) go('playground'); };
    const empty = (txt) => <div style={{ padding: 'var(--space-5)', border: '1px dashed var(--paper-edge)', borderRadius: 'var(--radius-lg)', color: 'var(--ink-mute)', fontSize: 'var(--text-sm)' }}>{txt}</div>;
    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Library" title="Reusable assets" subMax={600}
          before={<button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onBack} style={{ marginBottom: 8 }}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</button>}
          sub="Templates the team shares, the prompts you’ve saved, and your Playground sessions — in one place. Save a doc or a session to contribute one." />

        <div className="sec" style={{ marginTop: 0 }}>
          <div className="sec-hd"><h2 className="zs-h2">Templates</h2><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{templates.length} available</span></div>
          <div className="grid grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div key={tpl.id} className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="flex items-center justify-between">
                  <span className="glyph accent" style={{ width: 34, height: 34 }}><Icon name="grid" size={16} tone="accent" /></span>
                  <span className={'clf ' + (tpl.shared ? 'clf-internal' : 'clf-public')}><span className="d" />{tpl.shared ? 'Shared' : 'Yours'}</span>
                </div>
                <div>
                  <div className="zs-h3" style={{ fontSize: 'var(--text-base)' }}>{tpl.name}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4, textWrap: 'pretty' }}>“{tpl.body}”</div>
                </div>
                <div className="flex items-center justify-between" style={{ marginTop: 'auto' }}>
                  <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{tpl.space} · {tpl.by}</span>
                  <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => launch(tpl.preset)}><Icon name="playground" size={13} tone="soft" /> Use</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Saved prompts</h2></div>
          {snippets.length === 0 ? empty('Save an answer in Ask — it lands here as a reusable prompt.') : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {snippets.map((s) => (
                <div key={s.id} className="item">
                  <div className="item-main">
                    <span className="item-ic"><Icon name="citation" size={16} tone="soft" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{(s.space || '') + (s.model ? ' · ' + s.model : '')}</div>
                    </div>
                    {go && <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => go('ask')}>Open in Ask</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Playground sessions</h2></div>
          {sessions.length === 0 ? empty('Save a pipeline in Playground — reopen it here any time.') : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {sessions.map((ss) => (
                <div key={ss.id} className="item">
                  <div className="item-main">
                    <span className="item-ic"><Icon name="history" size={16} tone="soft" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{ss.title}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ss.model} · L{ss.level}</div>
                    </div>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => { window.StrategosUI.Handoff.set({ preset: Object.assign({ level: ss.level }, ss.toggles) }); if (go) go('playground'); }}>Open</button>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => Sessions.remove(ss.id)} title="Remove"><Icon name="trash" size={13} tone="mute" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function LibraryView({ go }) {
    const { ws } = useWorkspace();
    const space = ws.id;
    const [reuse, setReuse] = useState(false);
    const [spaceSet, setSpaceSet] = useState(false);
    const [layout, setLayout] = useState('list');
    const [openId, setOpenId] = useState(null);     // null = index, else workspace
    const [sel, setSel] = useState(() => new Set()); // multi-select ids
    const [clsMap, setClsMap] = useState({});
    const [coll, setColl] = useState('All');
    const [tag, setTag] = useState(null);

    // reset filters/selection whenever the active workspace changes
    React.useEffect(() => { setOpenId(null); setSel(new Set()); setColl('All'); setTag(null); setReuse(false); setSpaceSet(false); }, [space]);

    // deep-link from an Ask citation → open that document
    React.useEffect(() => {
      const h = window.StrategosUI.Handoff && window.StrategosUI.Handoff.take();
      if (h && h.openDoc) {
        const d = (WS_DOCS[space] || []).find((x) => x.title === h.openDoc || (x.norm || []).some(([n]) => n === h.openDoc));
        if (d) setOpenId(d.id);
      }
    }, [space]);

    const setCls = (id, v) => setClsMap((m) => ({ ...m, [id]: v }));
    const clsOf = (it) => clsMap[it.id] || it.cls;
    const store = storageOf(ws);

    const allItems = WS_DOCS[space] || [];
    const collections = WS_COLLECTIONS[space] || [];
    const items = allItems.filter((it) => (coll === 'All' || it.coll === coll) && (!tag || it.tags.includes(tag)));
    const spaceTags = [...new Set(allItems.flatMap((it) => it.tags))];

    const openItem = openId && allItems.find((i) => i.id === openId);
    const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const reclassify = (v) => { setClsMap((m) => { const n = { ...m }; sel.forEach((id) => n[id] = v); return n; }); setSel(new Set()); };

    // ── document workspace ──
    if (openItem) {
      return <window.DocWorkspace item={openItem} cls={clsOf(openItem)} setCls={setCls} onBack={() => setOpenId(null)} />;
    }

    // ── reusable assets home ──
    if (reuse) return <ReuseView go={go} onBack={() => setReuse(false)} />;
    if (spaceSet) return <SpaceSettings ws={ws} onBack={() => setSpaceSet(false)} />;

    // ── index · scoped to the active workspace (no spaces sub-rail) ──
    return (
      <div className="view" style={{ minWidth: 0, height: '100%' }}>
        <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-5) var(--space-6) var(--space-8)' }} className="rise">
          <PageHeader align="start"
            eyebrow={<><span className="zs-eyebrow" style={{ margin: 0 }}>Library</span><WorkspaceChip ws={ws} /><span className={'clf clf-' + ws.cls}><span className="d" />{CLF_LABEL[ws.cls]}</span></>}
            title={ws.name} titleStyle={{ marginTop: 4 }} subKind="sm"
            sub={(coll === 'All' ? 'All documents' : coll) + (tag ? ' · ' + tag : '') + ' · ' + allItems.length + ' in this workspace'}
            actions={<>
              <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setReuse(true)}><Icon name="grid" size={14} tone="accent" /> Reusable assets</button>
              <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setSpaceSet(true)} title="Space owner settings"><Icon name="settings" size={14} tone="soft" /> Space settings</button>
              <button className="zs-btn zs-btn-secondary"><Icon name="upload" size={15} tone="soft" /> Upload</button>
              <button className="zs-btn zs-btn-primary"><Icon name="create" size={15} tone="paper" /> New doc</button>
            </>} />

          {/* collection filter — replaces the old sub-rail */}
          <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="tabs sm" style={{ flexWrap: 'wrap' }}>
              {['All', ...collections].map((c) => {
                const cnt = c === 'All' ? allItems.length : allItems.filter((it) => it.coll === c).length;
                return (
                  <button key={c} className={'tab' + (coll === c ? ' on' : '')} onClick={() => setColl(c)}>
                    {c === 'All' ? 'All' : c} <span className="mono" style={{ fontSize: 10, color: coll === c ? 'var(--accent)' : 'var(--ink-faint)', marginLeft: 4 }}>{cnt}</span>
                  </button>
                );
              })}
            </div>
            <span className="grow" />
            <div style={{ minWidth: 150 }}><StorageMeter used={store.used} quota={store.quota} /></div>
          </div>

          {/* tags */}
          {spaceTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 'var(--space-4)' }}>
              <span className="rail-label" style={{ padding: 0 }}>Tags</span>
              {spaceTags.map((t) => (
                <button key={t} className={'dtag tag-btn' + (tag === t ? ' on' : '')} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
              ))}
            </div>
          )}

          {/* toolbar OR bulk bar */}
          {sel.size > 0 ? (
            <div style={{ marginBottom: 'var(--space-4)' }}><BulkBar n={sel.size} onClear={() => setSel(new Set())} onReclassify={reclassify} /></div>
          ) : (
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="zs-input" style={{ maxWidth: 280, height: 32 }}>
                <Icon name="search" size={14} tone="mute" /><input placeholder={'Search ' + ws.name + '…'} readOnly />
              </div>
              <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{items.length} items</span>
              {tag && <button className="dtag on tag-btn" onClick={() => setTag(null)}>{tag} ✕</button>}
              <span className="grow" />
              <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="sort" size={14} tone="soft" /> Recent</button>
              <div className="tabs sm">
                <button className={'tab' + (layout === 'list' ? ' on' : '')} onClick={() => setLayout('list')}><Icon name="list" size={14} tone={layout === 'list' ? 'ink' : 'mute'} /></button>
                <button className={'tab' + (layout === 'grid' ? ' on' : '')} onClick={() => setLayout('grid')}><Icon name="grid" size={14} tone={layout === 'grid' ? 'ink' : 'mute'} /></button>
              </div>
            </div>
          )}

          {/* upload→normalize hint */}
          <div className="flex items-center gap-3" style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius)', background: 'var(--paper-mute)', border: '1px dashed var(--paper-edge)', marginBottom: 'var(--space-4)' }}>
            <Icon name="upload" size={16} tone="mute" />
            <span className="zs-body-sm" style={{ flex: 1 }}>Drop <b>pdf · docx · xlsx · pptx</b> here — Torii parses layout-first into <span className="mono" style={{ fontSize: 12 }}>md · csv · json · images</span>, then chunks and embeds for retrieval.</span>
          </div>

          {/* items */}
          {items.length === 0 ? (
            <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center', border: '1px dashed var(--paper-edge)', borderRadius: 'var(--radius-lg)', color: 'var(--ink-mute)' }}>
              <div style={{ fontSize: 'var(--text-base)', color: 'var(--ink-soft)' }}>Nothing here yet.</div>
              <div className="zs-body-sm" style={{ marginTop: 4 }}>No documents match this filter in {ws.name}.</div>
            </div>
          ) : layout === 'list' ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              {items.map((it) => (
                <div key={it.id} className={'item' + (sel.has(it.id) ? ' sel' : '')}>
                  <button className={'ck' + (sel.has(it.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="select">
                    {sel.has(it.id) && <Icon name="check" size={12} tone="paper" />}
                  </button>
                  <div className="item-main" onClick={() => setOpenId(it.id)}>
                    <span className="item-ic"><Icon name="doc" size={17} tone="soft" /></span>
                    <div style={{ flex: 1, minWidth: 120, overflow: 'hidden' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                        <span className="tag">{it.src}</span>
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                        {it.norm.slice(0, 3).map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                        {it.norm.length > 3 && <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>+{it.norm.length - 3}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
                      {it.ing !== 'ready' && <IngBadge state={it.ing} />}
                      <Clf cls={clsOf(it)} />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>{it.when}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {items.map((it) => (
                <div key={it.id} className={'gcard' + (sel.has(it.id) ? ' sel' : '')} onClick={() => setOpenId(it.id)}>
                  <div className="flex items-center justify-between">
                    <button className={'ck' + (sel.has(it.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="select">
                      {sel.has(it.id) && <Icon name="check" size={12} tone="paper" />}
                    </button>
                    <span className="tag">{it.src}</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35, textWrap: 'pretty' }}>{it.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {it.norm.slice(0, 3).map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                  </div>
                  <div className="flex items-center justify-between" style={{ marginTop: 'auto' }}>
                    {it.ing !== 'ready' ? <IngBadge state={it.ing} /> : <Clf cls={clsOf(it)} />}
                    {it.ing !== 'ready' ? <Clf cls={clsOf(it)} /> : <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{it.when}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  window.LibraryView = LibraryView;
})();
