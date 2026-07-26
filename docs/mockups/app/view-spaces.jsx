/* Seiki · view-spaces.jsx
   Spaces & knowledge base — the admin/space-owned defaults behind the member
   Library and Playground. Per space: the ingestion & extraction profile, the
   chunking strategy, the retrieval mode + rerank, storage & quotas, and live
   ingestion health. Members see these as defaults; they may experiment above
   the floor in Playground but cannot change a space default here. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, Meter, ModelPicker, PageHeader } = window.StrategosUI;
  const { WORKSPACES, WS_DOCS, WS_COLLECTIONS, money } = window.StrategosData;
  const { useState } = React;

  /* ── the menus (from the RAG spec) ────────────────────────────────── */
  const PARSERS = [
    { k: 'layout', name: 'Layout-aware', sub: 'prose → md · tables → CSV · figures → captions', q: 97 },
    { k: 'fast',   name: 'Fast text',    sub: 'text-only extraction, no table/figure split',      q: 88 },
    { k: 'ocr',    name: 'OCR fallback', sub: 'for scans & image-only PDFs',                       q: 79 },
  ];
  const CHUNKS = [
    { k: 'structural', name: 'Structural / recursive', sub: 'split on heading & section boundaries' },
    { k: 'paragraph',  name: 'Paragraph-level',        sub: 'one chunk per paragraph' },
    { k: 'sentence',   name: 'Sentence-window',        sub: 'sentence vectors + window expansion' },
    { k: 'semantic',   name: 'Semantic',               sub: 'split on embedding-similarity boundaries' },
    { k: 'proposition', name: 'Proposition',           sub: 'atomic facts, one claim per chunk' },
    { k: 'parent',     name: 'Parent-document',        sub: 'retrieve small, return the parent' },
    { k: 'late',       name: 'Late chunking',          sub: 'embed the full doc, then split' },
    { k: 'layout',     name: 'Layout / content-aware', sub: 'tables & figures as their own units' },
  ];
  const RETR = [
    { k: 'dense',  name: 'Dense', sub: 'vector similarity' },
    { k: 'sparse', name: 'Sparse · BM25', sub: 'keyword match' },
    { k: 'hybrid', name: 'Hybrid', sub: 'dense + sparse, weighted' },
  ];
  const ADVANCED = [
    { k: 'contextual', name: 'Contextual retrieval', sub: 'prepend per-chunk context before embedding + BM25 — big recall win', rec: true },
    { k: 'rewrite',    name: 'Query transforms',     sub: 'rewriting · decomposition · HyDE' },
    { k: 'colbert',    name: 'Multi-vector · ColBERT', sub: 'late-interaction — higher accuracy, more storage' },
    { k: 'raptor',     name: 'RAPTOR',               sub: 'hierarchical summary tree for long-doc / global questions' },
    { k: 'graph',      name: 'GraphRAG',             sub: 'entity / relation graph for connect-the-dots queries' },
    { k: 'sqlrag',     name: 'SQL-RAG',              sub: 'text-to-SQL for structured / analytical questions' },
    { k: 'agentic',    name: 'Agentic RAG',          sub: 'retrieve → reason → re-retrieve loop' },
  ];
  const RERANK_MODELS = ['bge-reranker-v2', 'cohere-rerank-3.5', 'jina-reranker-v2'];
  const EMBED_MODELS = [['bge-large-1024', 'BGE-large · 1024-dim'], ['e5-large-1024', 'E5-large · 1024-dim'], ['nomic-768', 'Nomic-embed · 768-dim'], ['openai-3-large-3072', 'OpenAI-3-large · 3072-dim']];
  const TIERS_KB = ['frontier', 'balanced', 'fast', 'local'];
  const RET_OPTS = [['90d', '90 days'], ['12mo', '12 months'], ['24mo', '24 months'], ['forever', 'Keep forever']];
  const CLF_KB = [['public', 'Public'], ['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted']];

  /* the recommended default stack, applied to every space unless overridden */
  const DEFAULTS = {
    parser: 'layout', extract: { tables: true, images: true, formulas: true }, embed: 'bge-large-1024',
    chunk: 'structural', size: 512, overlap: 64,
    retr: 'hybrid', hybrid: 65, rerank: true, rerankModel: 'bge-reranker-v2',
    advanced: ['contextual'], quotaGB: 25,
    classification: 'internal', maskStrict: false, tiers: ['frontier', 'balanced', 'fast', 'local'], retention: '24mo',
  };
  const TIER_QUOTA = { company: 200, department: 80, team: 40, personal: 10 };

  const STAGES = ['queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'];
  const STAGE_META = {
    queued:    ['queued',    'var(--ink-faint)'],
    parsing:   ['parsing',   'var(--ink-mute)'],
    chunking:  ['chunking',  'var(--ink-mute)'],
    embedding: ['embedding', 'var(--warning)'],
    ready:     ['ready',     'var(--success)'],
    failed:    ['failed',    'var(--accent)'],
  };

  function kbKey(id) { return 'zs-kb-' + id; }
  function loadKB(id) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(kbKey(id)) || '{}'); } catch (e) {}
    return Object.assign({}, DEFAULTS, { quotaGB: TIER_QUOTA[(WORKSPACES.find((w) => w.id === id) || {}).tier] || 25 }, saved,
      { extract: Object.assign({}, DEFAULTS.extract, saved.extract) });
  }

  function Slider({ label, value, min, max, step = 1, unit = '', onChange }) {
    return (
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}{unit}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
      </div>
    );
  }

  function Chip({ on, rec, onClick, children }) {
    return (
      <button onClick={onClick} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-xs)', fontWeight: 500, cursor: 'pointer',
        border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'),
        background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)',
        transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease)' }}>
        {on && <Icon name="check" size={12} tone="paper" />}{children}
        {rec && !on && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>rec</span>}
      </button>
    );
  }

  function SpacesKBView() {
    const [sel, setSel] = useState(WORKSPACES.find((w) => w.id === 'q1') ? 'q1' : WORKSPACES[0].id);
    const [kb, setKB] = useState(() => loadKB(sel));
    const pick = (id) => { setSel(id); setKB(loadKB(id)); };
    const set = (patch) => setKB((o) => { const n = Object.assign({}, o, patch); try { localStorage.setItem(kbKey(sel), JSON.stringify(n)); } catch (e) {} return n; });
    const toggleAdv = (k) => set({ advanced: kb.advanced.includes(k) ? kb.advanced.filter((x) => x !== k) : [...kb.advanced, k] });
    const resetSpace = () => { try { localStorage.removeItem(kbKey(sel)); } catch (e) {} setKB(loadKB(sel)); };

    const ws = WORKSPACES.find((w) => w.id === sel);
    const docs = WS_DOCS[sel] || [];
    const parser = PARSERS.find((p) => p.k === kb.parser) || PARSERS[0];
    const usedGB = +(ws.items * 0.0042 + 0.6).toFixed(1);
    const artifacts = docs.reduce((a, d) => { d.norm.forEach(([, t]) => { a[t] = (a[t] || 0) + 1; }); return a; }, {});
    const stageCount = STAGES.reduce((a, s) => (a[s] = docs.filter((d) => d.ing === s).length, a), {});
    const inFlight = docs.filter((d) => d.ing !== 'ready');

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Gateway" title="Spaces & knowledge base" subMax={660}
          sub="The ingestion, chunking and retrieval defaults behind every space’s documents. Members work against these; they can experiment in the Playground but can’t change a space default."
          actions={<Pill icon="library">{WORKSPACES.length} spaces</Pill>} />

        {/* recommended stack */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="spark" size={15} tone="accent" /><span className="zs-eyebrow">Recommended default stack</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>applied unless a space overrides</span>
          </div>
          <div className="flex items-center" style={{ padding: 'var(--space-4) var(--space-5)', gap: 8, flexWrap: 'wrap' }}>
            {['Markdown-first parse', 'Structural / semantic chunking', 'Contextual + hybrid (dense+BM25)', 'Cross-encoder rerank', 'Grounded generation + citations'].map((s, i, a) => (
              <React.Fragment key={s}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontWeight: 500, background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-full)', padding: '5px 12px' }}>{s}</span>
                {i < a.length - 1 && <Icon name="caret" size={13} tone="mute" style={{ transform: 'rotate(-90deg)' }} />}
              </React.Fragment>
            ))}
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Advanced modes — RAPTOR, GraphRAG, ColBERT, SQL-RAG, agentic — are opt-in per space below.</span></div>
        </div>

        <div className="kb-grid">
          {/* space list */}
          <div className="card" style={{ overflow: 'hidden', alignSelf: 'start' }}>
            <div className="card-hd"><span className="zs-eyebrow">Spaces</span></div>
            <div style={{ padding: '6px' }}>
              {WORKSPACES.map((w) => {
                const on = w.id === sel;
                const wd = WS_DOCS[w.id] || [];
                const bad = wd.filter((d) => d.ing === 'failed').length;
                return (
                  <button key={w.id} onClick={() => pick(w.id)} className={'kb-space' + (on ? ' on' : '')}>
                    <span className={'wsdot wsdot-' + w.cls} style={{ width: 8, height: 8, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{w.items.toLocaleString()} items{bad ? ' · ' + bad + ' failed' : ''}</span>
                    </span>
                    {bad ? <span className="dot" style={{ background: 'var(--accent)' }} /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* detail */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
              <span className="glyph accent" style={{ width: 34, height: 34 }}><Icon name="library" size={17} tone="accent" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="zs-h3" style={{ lineHeight: 1.1 }}>{ws.name}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ws.tier} · {(WS_COLLECTIONS[sel] || []).length} collections · {ws.items.toLocaleString()} items</div>
              </div>
              <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={resetSpace}><Icon name="history" size={13} tone="soft" /> Reset to stack</button>
            </div>

            {/* ingestion & extraction */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Ingestion & extraction</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>parse quality · <b style={{ color: parser.q > 90 ? 'var(--success)' : 'var(--warning)' }}>{parser.q}%</b></span></div>
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Parser profile</div>
                <div className="flex flex-col" style={{ gap: 6 }}>
                  {PARSERS.map((p) => (
                    <button key={p.k} onClick={() => set({ parser: p.k })} className={'seg' + (kb.parser === p.k ? ' on' : '')}>
                      <span className="seg-ic"><Icon name={p.k === 'ocr' ? 'eye' : 'doc'} size={15} tone={kb.parser === p.k ? 'accent' : 'mute'} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>
                        <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{p.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="zs-eyebrow" style={{ margin: 'var(--space-4) 0 8px' }}>Embedding model</div>
                <select value={kb.embed} onChange={(e) => set({ embed: e.target.value })} style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '8px 10px', cursor: 'pointer' }}>{EMBED_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <div className="zs-body-sm" style={{ fontSize: 12, marginTop: 4 }}>Every chunk in a space shares one embedding space — changing the model requires a re-index.</div>
                <div className="zs-eyebrow" style={{ margin: 'var(--space-4) 0 8px' }}>Extract as separate, queryable assets</div>
                <div className="flex flex-col" style={{ gap: 2 }}>
                  {[['tables', 'Tables → markdown + CSV', 'kept queryable, not flattened to prose'], ['images', 'Images & figures → files + captions', 'auto-caption + alt text'], ['formulas', 'Formulas & code → fenced blocks', 'preserved verbatim']].map(([k, t, d]) => (
                    <div key={k} className="flex items-center gap-3" style={{ padding: '8px 0' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>{t}</div>
                        <div className="zs-body-sm" style={{ fontSize: 12 }}>{d}</div>
                      </div>
                      <Switch on={kb.extract[k]} onClick={() => set({ extract: Object.assign({}, kb.extract, { [k]: !kb.extract[k] }) })} label={t} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* chunking */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="layers" size={15} tone="soft" /><span className="zs-eyebrow">Chunking strategy</span></span></div>
              <div style={{ padding: 'var(--space-5)' }}>
                <select value={kb.chunk} onChange={(e) => set({ chunk: e.target.value })}
                  style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '600 13px var(--font-ui)', color: 'var(--ink)', padding: '9px 11px', cursor: 'pointer' }}>
                  {CHUNKS.map((c) => <option key={c.k} value={c.k}>{c.name}</option>)}
                </select>
                <div className="zs-body-sm" style={{ margin: '8px 0 var(--space-4)', fontSize: 12 }}>{(CHUNKS.find((c) => c.k === kb.chunk) || {}).sub}</div>
                <div className="grid grid-cols-2 gap-5">
                  <Slider label="Chunk size" value={kb.size} min={128} max={1024} step={64} unit=" tok" onChange={(v) => set({ size: v })} />
                  <Slider label="Overlap / window" value={kb.overlap} min={0} max={256} step={16} unit=" tok" onChange={(v) => set({ overlap: v })} />
                </div>
                <div className="card-foot dashed" style={{ marginTop: 'var(--space-4)', marginLeft: 'calc(-1 * var(--space-5))', marginRight: 'calc(-1 * var(--space-5))', marginBottom: 'calc(-1 * var(--space-5))' }}><Icon name="eye" size={14} tone="mute" /><span>Members can inspect how a doc was split in the Playground chunk inspector.</span></div>
              </div>
            </div>

            {/* retrieval */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="filter" size={15} tone="soft" /><span className="zs-eyebrow">Retrieval mode</span></span></div>
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: kb.retr === 'hybrid' ? 'var(--space-4)' : 0 }}>
                  {RETR.map((r) => (
                    <button key={r.k} onClick={() => set({ retr: r.k })} title={r.sub} style={{
                      flex: 1, padding: '10px', borderRadius: 'var(--radius)', border: '1px solid ' + (kb.retr === r.k ? 'var(--ink)' : 'var(--paper-edge)'),
                      background: kb.retr === r.k ? 'var(--paper-mute)' : 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.sub}</div>
                    </button>
                  ))}
                </div>
                {kb.retr === 'hybrid' && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <Slider label="Dense ↔ Sparse weight" value={kb.hybrid} min={0} max={100} step={5} unit="% dense" onChange={(v) => set({ hybrid: v })} />
                  </div>
                )}
                <div className="flex items-center gap-3" style={{ padding: '8px 0', borderTop: '1px solid var(--paper-edge)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>Cross-encoder reranking</div>
                    <div className="zs-body-sm" style={{ fontSize: 12 }}>re-scores the top passages by answer-relevance</div>
                  </div>
                  {kb.rerank && (
                    <select value={kb.rerankModel} onChange={(e) => set({ rerankModel: e.target.value })}
                      style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-mono)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
                      {RERANK_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <Switch on={kb.rerank} onClick={() => set({ rerank: !kb.rerank })} label="Reranking" />
                </div>
                <div className="zs-eyebrow" style={{ margin: 'var(--space-4) 0 8px' }}>Advanced modes · opt-in</div>
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {ADVANCED.map((a) => <Chip key={a.k} on={kb.advanced.includes(a.k)} rec={a.rec} onClick={() => toggleAdv(a.k)}>{a.name}</Chip>)}
                </div>
                {kb.advanced.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 4, marginTop: 'var(--space-3)' }}>
                    {ADVANCED.filter((a) => kb.advanced.includes(a.k)).map((a) => (
                      <div key={a.k} className="flex items-baseline gap-2" style={{ fontSize: 'var(--text-xs)' }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{a.name}</span>
                        <span style={{ color: 'var(--ink-mute)' }}>· {a.sub}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* space policy & access */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Space policy & access</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>tightens workspace policy</span></div>
              <div style={{ padding: 'var(--space-5)' }}>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Default classification</div>
                    <div className="flex items-center gap-2">
                      <select value={kb.classification} onChange={(e) => set({ classification: e.target.value })} style={{ flex: 1, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-ui)', color: 'var(--ink)', padding: '7px 9px', cursor: 'pointer' }}>{CLF_KB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <span className={'clf clf-' + kb.classification}><span className="d" />{(CLF_KB.find((c) => c[0] === kb.classification) || [])[1]}</span>
                    </div>
                    <div className="zs-body-sm" style={{ fontSize: 12, marginTop: 6 }}>New uploads to this space start at this level.</div>
                  </div>
                  <div>
                    <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Retention</div>
                    <select value={kb.retention} onChange={(e) => set({ retention: e.target.value })} style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', cursor: 'pointer' }}>{RET_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>Force PII masking</div><div className="zs-body-sm" style={{ fontSize: 12 }}>always mask here, even if the workspace default is off</div></div>
                      <Switch on={kb.maskStrict} onClick={() => set({ maskStrict: !kb.maskStrict })} label="Force PII masking" />
                    </div>
                  </div>
                </div>
                <div className="zs-eyebrow" style={{ margin: 'var(--space-4) 0 8px' }}>Allowed model tiers</div>
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {TIERS_KB.map((t) => { const on = kb.tiers.includes(t); return <Chip key={t} on={on} onClick={() => set({ tiers: on ? kb.tiers.filter((x) => x !== t) : [...kb.tiers, t] })}>{t}</Chip>; })}
                </div>
              </div>
              <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>A space may <b>tighten</b> workspace policy — raise the classification floor, force masking, or narrow allowed tiers — never loosen it.</span></div>
            </div>

            {/* storage & ingestion health */}
            <div className="grid-half">
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-hd"><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Storage & quota</span></span><span className="flex items-center gap-2"><button className="zs-btn zs-btn-ghost zs-btn-sm" title="Rebuild all embeddings for this space"><Icon name="refresh" size={13} tone="soft" /> Re-index</button><button className="zs-btn zs-btn-ghost zs-btn-sm" title="Remove orphaned & duplicate artifacts"><Icon name="trash" size={13} tone="soft" /> Clean up</button></span></div>
                <div style={{ padding: 'var(--space-5)' }}>
                  <Meter label="Normalized artifacts + originals" value={usedGB} max={kb.quotaGB} display={usedGB + ' / ' + kb.quotaGB + ' GB'} tone={usedGB / kb.quotaGB > 0.85 ? 'warning' : 'accent'} hint={'tenant storage · scoped to ' + ws.name} />
                  <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
                    {[['doc', 'md'], ['sheet', 'CSV'], ['image', 'images'], ['code', 'json']].map(([t, lab]) => (
                      <span key={t} className="tag">{lab} · {artifacts[t] || 0}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>retention · {(RET_OPTS.find((r) => r[0] === kb.retention) || [])[1]} · originals kept</span>
                    <span className="dtag">2 orphans</span><span className="dtag">1 duplicate</span>
                  </div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-hd"><span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span className="zs-eyebrow">Ingestion health</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{stageCount.ready}/{docs.length} ready</span></div>
                <div style={{ display: 'flex', height: 8, borderRadius: 'var(--radius-full)', overflow: 'hidden', margin: 'var(--space-4) var(--space-5) 0' }}>
                  {STAGES.map((s) => stageCount[s] ? <div key={s} title={s + ' · ' + stageCount[s]} style={{ flex: stageCount[s], background: STAGE_META[s][1] }} /> : null)}
                </div>
                <div style={{ padding: '10px var(--space-5) var(--space-4)' }}>
                  {inFlight.length === 0
                    ? <div className="zs-body-sm" style={{ fontSize: 12 }}>All documents parsed, chunked and embedded.</div>
                    : inFlight.map((d) => (
                        <div key={d.id} className="flex items-center gap-2" style={{ padding: '7px 0', borderTop: '1px solid var(--paper-edge)' }}>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
                          <span className="status" style={{ color: STAGE_META[d.ing][1] }}><span className="dot" style={{ background: STAGE_META[d.ing][1] }} />{STAGE_META[d.ing][0]}</span>
                          {d.ing === 'failed' && <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="history" size={12} tone="soft" /> Re-process</button>}
                        </div>
                      ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const STYLE = `
    .zs .kb-grid { display: grid; grid-template-columns: 248px 1fr; gap: var(--space-5); align-items: start; }
    .zs .kb-space { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: var(--radius);
      transition: background var(--dur-fast) var(--ease); }
    .zs .kb-space:hover { background: var(--paper-mute); }
    .zs .kb-space.on { background: var(--paper-mute); box-shadow: inset 2px 0 0 var(--accent); }
    @media (max-width: 900px) { .zs .kb-grid { grid-template-columns: 1fr; } }
  `;

  function Wrapped() {
    return React.createElement(React.Fragment, null, React.createElement('style', null, STYLE), React.createElement(SpacesKBView));
  }
  window.SpacesKBView = Wrapped;
})();
