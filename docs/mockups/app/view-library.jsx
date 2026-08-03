/* Torii · view-library.jsx (member)
   The shared content system, now a document workspace. Uploads of any format
   are normalized to md / csv / json / images for consistent embeddings.
   This is the index: spaces, collections, tags, storage, multi-select + bulk
   actions, and ingestion status. Selecting an item opens the DocWorkspace. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Chip, Tag, Button, useSnippets, Sessions, MyTemplates, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { PROMPT_TEMPLATES, WS_DOCS, WS_COLLECTIONS } = window.StrategosAPI;
  const { useState } = React;
  const Switch = window.StrategosUI.Switch;

  // owner-facing space-override layer — reads the same store admin Spaces & KB writes
  const { KB_D, RET_LABEL, TIERS_ALL, CLF_MAP, CLF, CLF_LABEL, QUOTA_BY_TIER, ING } = window.StrategosAPI.content.library;
  function loadSpaceKB(id) { try { return Object.assign({}, KB_D, JSON.parse(localStorage.getItem('zs-kb-' + id) || '{}')); } catch (e) { return Object.assign({}, KB_D); } }

  function SpaceSettings({ ws, onBack }) {
    const [kb, setKb] = React.useState(() => loadSpaceKB(ws.id));
    const save = (patch) => setKb((o) => { const n = Object.assign({}, o, patch); try { localStorage.setItem('zs-kb-' + ws.id, JSON.stringify(n)); } catch (e) {} return n; });
    const roStyle = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' };
    const chip = (on, onClick, label) => <button key={label} onClick={onClick} style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{label}</button>;
    return (
      <ViewPad wide className="rise">
        <PageHeader className="mb-2" eyebrow="Library" title={ws.name + ' · space settings'} subMax={600}
          before={<Button variant="ghost" size="sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</Button>}
          sub="As the space owner, tighten the workspace defaults for everyone in this space. Members inherit these. The ingestion pipeline is set by an administrator." />
        <Card className="overflow-hidden mb-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="governance" size={15} tone="soft" /><span className="zs-eyebrow">Classification & masking</span></span></CardHead>
          <div className="p-6">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="zs-eyebrow m-0">Default classification</span>
              <select value={kb.classification} onChange={(e) => save({ classification: e.target.value })} style={roStyle}>{Object.keys(CLF_MAP).map((c) => <option key={c} value={c}>{CLF_MAP[c]}</option>)}</select>
              <span className={'clf clf-' + kb.classification}><span className="d" />{CLF_MAP[kb.classification]}</span>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-ink">Force PII masking</div><div className="zs-body-sm text-[12px]">always mask in this space, even if the workspace default is off</div></div>
              <Switch on={kb.maskStrict} onClick={() => save({ maskStrict: !kb.maskStrict })} label="Force masking" />
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden mb-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="scale" size={15} tone="soft" /><span className="zs-eyebrow">Allowed model tiers</span></span></CardHead>
          <div className="flex p-6 gap-2 flex-wrap">
            {TIERS_ALL.map((t) => chip(kb.tiers.includes(t), () => save({ tiers: kb.tiers.includes(t) ? kb.tiers.filter((x) => x !== t) : [...kb.tiers, t] }), t))}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHead><span className="flex items-center gap-2"><Icon name="filter" size={15} tone="soft" /><span className="zs-eyebrow">Retrieval defaults</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>set by admin</span></CardHead>
          <div className="py-4 px-6">
            {[['Chunking', kb.chunk], ['Retrieval', kb.retr + (kb.retr === 'hybrid' ? ' · ' + (kb.hybrid || 65) + '% dense' : '')], ['Reranking', kb.rerank ? 'on' : 'off'], ['Embedding', kb.embed], ['Retention', RET_LABEL[kb.retention] || kb.retention]].map(([k, v], i) => (
              <div key={k} className="flex items-center justify-between py-2 px-0" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <span className="text-sm text-ink-soft">{k}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{v}</span>
              </div>
            ))}
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>The parsing, chunking and retrieval pipeline is owned by an administrator in <b>Spaces & knowledge base</b>. Classification, masking and allowed tiers are yours to tighten here.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  // storage figures derived from the active workspace's tier + item count
  function storageOf(ws) {
    const quota = QUOTA_BY_TIER[ws.tier] || 10;
    const used = Math.min(+(quota * 0.95).toFixed(1), +(ws.items / 180).toFixed(1));
    return { used, quota };
  }

  function NormChip({ name, kind }) {
    return <Chip><Icon name={kind} size={11} tone="mute" />{name}</Chip>;
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
        <div className="flex items-center justify-between mb-1">
          <span className="rail-label p-0">Storage</span>
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
        <span className="w-[1px] h-[18px] bg-paper-edge" />
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
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
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
    const empty = (txt) => <div className="p-6 border border-dashed rounded-lg text-ink-mute text-sm">{txt}</div>;
    return (
      <ViewPad wide className="rise">
        <PageHeader className="mb-2" eyebrow="Library" title="Reusable assets" subMax={600}
          before={<Button variant="ghost" size="sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</Button>}
          sub="Templates the team shares, the prompts you’ve saved, and your Playground sessions — in one place. Save a doc or a session to contribute one." />

        <div className="sec mt-0">
          <div className="sec-hd"><h2 className="zs-h2">Templates</h2><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{templates.length} available</span></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <Card className="p-6 flex flex-col gap-3" key={tpl.id}>
                <div className="flex items-center justify-between">
                  <span className="glyph accent w-[34px] h-[34px]"><Icon name="grid" size={16} tone="accent" /></span>
                  <span className={'clf ' + (tpl.shared ? 'clf-internal' : 'clf-public')}><span className="d" />{tpl.shared ? 'Shared' : 'Yours'}</span>
                </div>
                <div>
                  <div className="zs-h3 text-base">{tpl.name}</div>
                  <div className="font-display text-sm text-ink-soft mt-1 leading-snug [text-wrap:pretty]" style={{ fontStyle: 'italic'}}>“{tpl.body}”</div>
                </div>
                <div className="flex items-center justify-between mt-auto">
                  <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{tpl.space} · {tpl.by}</span>
                  <Button variant="secondary" size="sm" onClick={() => launch(tpl.preset)}><Icon name="playground" size={13} tone="soft" /> Use</Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Saved prompts</h2></div>
          {snippets.length === 0 ? empty('Save an answer in Ask — it lands here as a reusable prompt.') : (
            <Card className="overflow-hidden">
              {snippets.map((s) => (
                <div key={s.id} className="item">
                  <div className="item-main">
                    <span className="item-ic"><Icon name="citation" size={16} tone="soft" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{s.title}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{(s.space || '') + (s.model ? ' · ' + s.model : '')}</div>
                    </div>
                    {go && <Button variant="ghost" size="sm" onClick={() => go('ask')}>Open in Ask</Button>}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Playground sessions</h2></div>
          {sessions.length === 0 ? empty('Save a pipeline in Playground — reopen it here any time.') : (
            <Card className="overflow-hidden">
              {sessions.map((ss) => (
                <div key={ss.id} className="item">
                  <div className="item-main">
                    <span className="item-ic"><Icon name="history" size={16} tone="soft" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{ss.title}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ss.model} · L{ss.level}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { window.StrategosUI.Handoff.set({ preset: Object.assign({ level: ss.level }, ss.toggles) }); if (go) go('playground'); }}>Open</Button>
                    <Button variant="ghost" size="sm" onClick={() => Sessions.remove(ss.id)} title="Remove"><Icon name="trash" size={13} tone="mute" /></Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </ViewPad>
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
      <div className="view min-w-0 h-full">
        <div className="rise flex-1 min-w-0 pt-6 px-8 pb-16">
          <PageHeader align="start"
            eyebrow={<><span className="zs-eyebrow m-0">Library</span><WorkspaceChip ws={ws} /><span className={'clf clf-' + ws.cls}><span className="d" />{CLF_LABEL[ws.cls]}</span></>}
            title={ws.name} titleStyle={{ marginTop: 4 }} subKind="sm"
            sub={(coll === 'All' ? 'All documents' : coll) + (tag ? ' · ' + tag : '') + ' · ' + allItems.length + ' in this workspace'}
            actions={<>
              <Button variant="ghost" size="sm" onClick={() => setReuse(true)}><Icon name="grid" size={14} tone="accent" /> Reusable assets</Button>
              <Button variant="ghost" size="sm" onClick={() => setSpaceSet(true)} title="Space owner settings"><Icon name="settings" size={14} tone="soft" /> Space settings</Button>
              <Button variant="secondary"><Icon name="upload" size={15} tone="soft" /> Upload</Button>
              <Button variant="primary"><Icon name="create" size={15} tone="paper" /> New doc</Button>
            </>} />

          {/* collection filter — replaces the old sub-rail */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="tabs sm flex-wrap">
              {['All', ...collections].map((c) => {
                const cnt = c === 'All' ? allItems.length : allItems.filter((it) => it.coll === c).length;
                return (
                  <button key={c} className={'tab' + (coll === c ? ' on' : '')} onClick={() => setColl(c)}>
                    {c === 'All' ? 'All' : c} <span className="mono" style={{ fontSize: 10, color: coll === c ? 'var(--accent)' : 'var(--ink-faint)', marginLeft: 4 }}>{cnt}</span>
                  </button>
                );
              })}
            </div>
            <span className="flex-1" />
            <div className="min-w-[150px]"><StorageMeter used={store.used} quota={store.quota} /></div>
          </div>

          {/* tags */}
          {spaceTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="rail-label p-0">Tags</span>
              {spaceTags.map((t) => (
                <button key={t} className={'dtag tag-btn' + (tag === t ? ' on' : '')} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
              ))}
            </div>
          )}

          {/* toolbar OR bulk bar */}
          {sel.size > 0 ? (
            <div className="mb-4"><BulkBar n={sel.size} onClear={() => setSel(new Set())} onReclassify={reclassify} /></div>
          ) : (
            <div className="flex items-center gap-3 mb-4">
              <div className="zs-input max-w-[280px] h-[32px]">
                <Icon name="search" size={14} tone="mute" /><input placeholder={'Search ' + ws.name + '…'} readOnly />
              </div>
              <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{items.length} items</span>
              {tag && <button className="dtag on tag-btn" onClick={() => setTag(null)}>{tag} ✕</button>}
              <span className="flex-1" />
              <Button variant="ghost" size="sm"><Icon name="sort" size={14} tone="soft" /> Recent</Button>
              <div className="tabs sm">
                <button className={'tab' + (layout === 'list' ? ' on' : '')} onClick={() => setLayout('list')}><Icon name="list" size={14} tone={layout === 'list' ? 'ink' : 'mute'} /></button>
                <button className={'tab' + (layout === 'grid' ? ' on' : '')} onClick={() => setLayout('grid')}><Icon name="grid" size={14} tone={layout === 'grid' ? 'ink' : 'mute'} /></button>
              </div>
            </div>
          )}

          {/* upload→normalize hint */}
          <div className="flex items-center gap-3 py-3 px-4 rounded bg-paper-mute border border-dashed mb-4">
            <Icon name="upload" size={16} tone="mute" />
            <span className="zs-body-sm flex-1">Drop <b>pdf · docx · xlsx · pptx</b> here — Torii parses layout-first into <span className="mono" style={{ fontSize: 12 }}>md · csv · json · images</span>, then chunks and embeds for retrieval.</span>
          </div>

          {/* items */}
          {items.length === 0 ? (
            <div className="py-16 px-6 text-center border border-dashed rounded-lg text-ink-mute">
              <div className="text-base text-ink-soft">Nothing here yet.</div>
              <div className="zs-body-sm mt-1">No documents match this filter in {ws.name}.</div>
            </div>
          ) : layout === 'list' ? (
            <Card className="overflow-hidden">
              {items.map((it) => (
                <div key={it.id} className={'item' + (sel.has(it.id) ? ' sel' : '')}>
                  <button className={'ck' + (sel.has(it.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="select">
                    {sel.has(it.id) && <Icon name="check" size={12} tone="paper" />}
                  </button>
                  <div className="item-main" onClick={() => setOpenId(it.id)}>
                    <span className="item-ic"><Icon name="doc" size={17} tone="soft" /></span>
                    <div className="flex-1 min-w-[120px] overflow-hidden">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{it.title}</span>
                        <Tag>{it.src}</Tag>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-nowrap overflow-hidden">
                        {it.norm.slice(0, 3).map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                        {it.norm.length > 3 && <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', whiteSpace: 'nowrap' }}>+{it.norm.length - 3}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {it.ing !== 'ready' && <IngBadge state={it.ing} />}
                      <Clf cls={clsOf(it)} />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>{it.when}</span>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => (
                <div key={it.id} className={'gcard' + (sel.has(it.id) ? ' sel' : '')} onClick={() => setOpenId(it.id)}>
                  <div className="flex items-center justify-between">
                    <button className={'ck' + (sel.has(it.id) ? ' on' : '')} onClick={(e) => { e.stopPropagation(); toggle(it.id); }} aria-label="select">
                      {sel.has(it.id) && <Icon name="check" size={12} tone="paper" />}
                    </button>
                    <Tag>{it.src}</Tag>
                  </div>
                  <div className="text-sm font-semibold text-ink leading-[1.35] [text-wrap:pretty]">{it.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {it.norm.slice(0, 3).map(([n, k]) => <NormChip key={n} name={n} kind={k} />)}
                  </div>
                  <div className="flex items-center justify-between mt-auto">
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
