/* Seiki · view-spaces.jsx
   Spaces & knowledge base — the admin/space-owned defaults behind the member
   Library and Playground. Per space: the ingestion & extraction profile, the
   chunking strategy, the retrieval mode + rerank, storage & quotas, and live
   ingestion health. Members see these as defaults; they may experiment above
   the floor in Playground but cannot change a space default here. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Half, Tag, Button, Pill, Switch, Meter, ModelPicker, PageHeader } = window.StrategosUI;
  const { WORKSPACES, WS_DOCS, WS_COLLECTIONS, money } = window.StrategosAPI;
  const { useState } = React;

  /* ── the menus (from the RAG spec) ────────────────────────────────── */
  const { PARSERS, CHUNKS, RETR, ADVANCED, RERANK_MODELS, EMBED_MODELS, TIERS_KB, RET_OPTS, CLF_KB, DEFAULTS, TIER_QUOTA, STAGES, STAGE_META } = window.StrategosAPI.content.spaces;

  /* the recommended default stack, applied to every space unless overridden */

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
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-ink-soft">{label}</span>
          <span className="font-mono text-sm text-ink tabular-nums">{value}{unit}</span>
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
        {rec && !on && <span className="font-mono text-[10px] text-accent">rec</span>}
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
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Gateway" title="Spaces & knowledge base" subMax={660}
          sub="The ingestion, chunking and retrieval defaults behind every space’s documents. Members work against these; they can experiment in the Playground but can’t change a space default."
          actions={<Pill icon="library">{WORKSPACES.length} spaces</Pill>} />

        {/* recommended stack */}
        <Card className="overflow-hidden mb-6">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="spark" size={15} tone="accent" /><span className="zs-eyebrow">Recommended default stack</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>applied unless a space overrides</span>
          </CardHead>
          <div className="flex items-center py-4 px-6 gap-2 flex-wrap">
            {['Markdown-first parse', 'Structural / semantic chunking', 'Contextual + hybrid (dense+BM25)', 'Cross-encoder rerank', 'Grounded generation + citations'].map((s, i, a) => (
              <React.Fragment key={s}>
                <span className="text-sm text-ink font-medium bg-paper-mute border rounded-full py-1 px-3">{s}</span>
                {i < a.length - 1 && <Icon name="caret" size={13} tone="mute" style={{ transform: 'rotate(-90deg)' }} />}
              </React.Fragment>
            ))}
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Advanced modes — RAPTOR, GraphRAG, ColBERT, SQL-RAG, agentic — are opt-in per space below.</span></CardFoot>
        </Card>

        <div className="kb-grid">
          {/* space list */}
          <Card className="overflow-hidden" style={{ alignSelf: 'start' }}>
            <CardHead><span className="zs-eyebrow">Spaces</span></CardHead>
            <div className="p-1.5">
              {WORKSPACES.map((w) => {
                const on = w.id === sel;
                const wd = WS_DOCS[w.id] || [];
                const bad = wd.filter((d) => d.ing === 'failed').length;
                return (
                  <button key={w.id} onClick={() => pick(w.id)} className={'kb-space' + (on ? ' on' : '')}>
                    <span className={'wsdot wsdot-' + w.cls + ' w-[8px] h-[8px] shrink-0'} />
                    <span className="flex-1 min-w-0 text-left">
                      <span className="block text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{w.name}</span>
                      <span className="block font-mono text-xs text-ink-mute">{w.items.toLocaleString()} items{bad ? ' · ' + bad + ' failed' : ''}</span>
                    </span>
                    {bad ? <span className="dot" style={{ background: 'var(--accent)' }} /> : null}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* detail */}
          <div className="min-w-0 flex flex-col gap-6">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="glyph accent w-[34px] h-[34px]"><Icon name="library" size={17} tone="accent" /></span>
              <div className="flex-1 min-w-0">
                <div className="zs-h3 leading-[1.1]">{ws.name}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ws.tier} · {(WS_COLLECTIONS[sel] || []).length} collections · {ws.items.toLocaleString()} items</div>
              </div>
              <Button variant="ghost" size="sm" onClick={resetSpace}><Icon name="history" size={13} tone="soft" /> Reset to stack</Button>
            </div>

            {/* ingestion & extraction */}
            <Card className="overflow-hidden">
              <CardHead><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Ingestion & extraction</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>parse quality · <b style={{ color: parser.q > 90 ? 'var(--success)' : 'var(--warning)' }}>{parser.q}%</b></span></CardHead>
              <div className="p-6">
                <div className="zs-eyebrow mb-2">Parser profile</div>
                <div className="flex flex-col gap-1.5">
                  {PARSERS.map((p) => (
                    <button key={p.k} onClick={() => set({ parser: p.k })} className={'seg' + (kb.parser === p.k ? ' on' : '')}>
                      <span className="seg-ic"><Icon name={p.k === 'ocr' ? 'eye' : 'doc'} size={15} tone={kb.parser === p.k ? 'accent' : 'mute'} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-ink">{p.name}</span>
                        <span className="block text-xs text-ink-mute">{p.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="zs-eyebrow mt-4 mx-0 mb-2">Embedding model</div>
                <select value={kb.embed} onChange={(e) => set({ embed: e.target.value })} style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '8px 10px', cursor: 'pointer' }}>{EMBED_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <div className="zs-body-sm text-[12px] mt-1">Every chunk in a space shares one embedding space — changing the model requires a re-index.</div>
                <div className="zs-eyebrow mt-4 mx-0 mb-2">Extract as separate, queryable assets</div>
                <div className="flex flex-col gap-0.5">
                  {[['tables', 'Tables → markdown + CSV', 'kept queryable, not flattened to prose'], ['images', 'Images & figures → files + captions', 'auto-caption + alt text'], ['formulas', 'Formulas & code → fenced blocks', 'preserved verbatim']].map(([k, t, d]) => (
                    <div key={k} className="flex items-center gap-3 py-2 px-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink">{t}</div>
                        <div className="zs-body-sm text-[12px]">{d}</div>
                      </div>
                      <Switch on={kb.extract[k]} onClick={() => set({ extract: Object.assign({}, kb.extract, { [k]: !kb.extract[k] }) })} label={t} />
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* chunking */}
            <Card className="overflow-hidden">
              <CardHead><span className="flex items-center gap-2"><Icon name="layers" size={15} tone="soft" /><span className="zs-eyebrow">Chunking strategy</span></span></CardHead>
              <div className="p-6">
                <select value={kb.chunk} onChange={(e) => set({ chunk: e.target.value })}
                  style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '600 13px var(--font-ui)', color: 'var(--ink)', padding: '9px 11px', cursor: 'pointer' }}>
                  {CHUNKS.map((c) => <option key={c.k} value={c.k}>{c.name}</option>)}
                </select>
                <div className="zs-body-sm mt-2 mx-0 mb-4 text-[12px]">{(CHUNKS.find((c) => c.k === kb.chunk) || {}).sub}</div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Slider label="Chunk size" value={kb.size} min={128} max={1024} step={64} unit=" tok" onChange={(v) => set({ size: v })} />
                  <Slider label="Overlap / window" value={kb.overlap} min={0} max={256} step={16} unit=" tok" onChange={(v) => set({ overlap: v })} />
                </div>
                <CardFoot dashed className="mt-4" style={{ marginLeft: 'calc(-1 * 24px)', marginRight: 'calc(-1 * 24px)', marginBottom: 'calc(-1 * 24px)' }}><Icon name="eye" size={14} tone="mute" /><span>Members can inspect how a doc was split in the Playground chunk inspector.</span></CardFoot>
              </div>
            </Card>

            {/* retrieval */}
            <Card className="overflow-hidden">
              <CardHead><span className="flex items-center gap-2"><Icon name="filter" size={15} tone="soft" /><span className="zs-eyebrow">Retrieval mode</span></span></CardHead>
              <div className="p-6">
                <div className="flex items-center gap-2" style={{ marginBottom: kb.retr === 'hybrid' ? '16px' : 0 }}>
                  {RETR.map((r) => (
                    <button key={r.k} onClick={() => set({ retr: r.k })} title={r.sub} style={{
                      flex: 1, padding: '10px', borderRadius: 'var(--radius)', border: '1px solid ' + (kb.retr === r.k ? 'var(--ink)' : 'var(--paper-edge)'),
                      background: kb.retr === r.k ? 'var(--paper-mute)' : 'var(--paper)', cursor: 'pointer', textAlign: 'left' }}>
                      <div className="text-sm font-semibold text-ink">{r.name}</div>
                      <div className="text-xs text-ink-mute">{r.sub}</div>
                    </button>
                  ))}
                </div>
                {kb.retr === 'hybrid' && (
                  <div className="mb-4">
                    <Slider label="Dense ↔ Sparse weight" value={kb.hybrid} min={0} max={100} step={5} unit="% dense" onChange={(v) => set({ hybrid: v })} />
                  </div>
                )}
                <div className="flex items-center gap-3 py-2 px-0 border-t">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">Cross-encoder reranking</div>
                    <div className="zs-body-sm text-[12px]">re-scores the top passages by answer-relevance</div>
                  </div>
                  {kb.rerank && (
                    <select value={kb.rerankModel} onChange={(e) => set({ rerankModel: e.target.value })}
                      style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-mono)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
                      {RERANK_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                  <Switch on={kb.rerank} onClick={() => set({ rerank: !kb.rerank })} label="Reranking" />
                </div>
                <div className="zs-eyebrow mt-4 mx-0 mb-2">Advanced modes · opt-in</div>
                <div className="flex gap-2 flex-wrap">
                  {ADVANCED.map((a) => <Chip key={a.k} on={kb.advanced.includes(a.k)} rec={a.rec} onClick={() => toggleAdv(a.k)}>{a.name}</Chip>)}
                </div>
                {kb.advanced.length > 0 && (
                  <div className="flex flex-col gap-1 mt-3">
                    {ADVANCED.filter((a) => kb.advanced.includes(a.k)).map((a) => (
                      <div key={a.k} className="flex items-baseline gap-2 text-xs">
                        <span className="font-semibold text-ink">{a.name}</span>
                        <span className="text-ink-mute">· {a.sub}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* space policy & access */}
            <Card className="overflow-hidden">
              <CardHead><span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Space policy & access</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>tightens workspace policy</span></CardHead>
              <div className="p-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <div className="zs-eyebrow mb-2">Default classification</div>
                    <div className="flex items-center gap-2">
                      <select value={kb.classification} onChange={(e) => set({ classification: e.target.value })} style={{ flex: 1, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-ui)', color: 'var(--ink)', padding: '7px 9px', cursor: 'pointer' }}>{CLF_KB.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <span className={'clf clf-' + kb.classification}><span className="d" />{(CLF_KB.find((c) => c[0] === kb.classification) || [])[1]}</span>
                    </div>
                    <div className="zs-body-sm text-[12px] mt-1.5">New uploads to this space start at this level.</div>
                  </div>
                  <div>
                    <div className="zs-eyebrow mb-2">Retention</div>
                    <select value={kb.retention} onChange={(e) => set({ retention: e.target.value })} style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', cursor: 'pointer' }}>{RET_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-ink">Force PII masking</div><div className="zs-body-sm text-[12px]">always mask here, even if the workspace default is off</div></div>
                      <Switch on={kb.maskStrict} onClick={() => set({ maskStrict: !kb.maskStrict })} label="Force PII masking" />
                    </div>
                  </div>
                </div>
                <div className="zs-eyebrow mt-4 mx-0 mb-2">Allowed model tiers</div>
                <div className="flex gap-2 flex-wrap">
                  {TIERS_KB.map((t) => { const on = kb.tiers.includes(t); return <Chip key={t} on={on} onClick={() => set({ tiers: on ? kb.tiers.filter((x) => x !== t) : [...kb.tiers, t] })}>{t}</Chip>; })}
                </div>
              </div>
              <CardFoot dashed><Icon name="lock" size={14} tone="mute" /><span>A space may <b>tighten</b> workspace policy — raise the classification floor, force masking, or narrow allowed tiers — never loosen it.</span></CardFoot>
            </Card>

            {/* storage & ingestion health */}
            <Half>
              <Card className="overflow-hidden">
                <CardHead><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Storage & quota</span></span><span className="flex items-center gap-2"><Button variant="ghost" size="sm" title="Rebuild all embeddings for this space"><Icon name="refresh" size={13} tone="soft" /> Re-index</Button><Button variant="ghost" size="sm" title="Remove orphaned & duplicate artifacts"><Icon name="trash" size={13} tone="soft" /> Clean up</Button></span></CardHead>
                <div className="p-6">
                  <Meter label="Normalized artifacts + originals" value={usedGB} max={kb.quotaGB} display={usedGB + ' / ' + kb.quotaGB + ' GB'} tone={usedGB / kb.quotaGB > 0.85 ? 'warning' : 'accent'} hint={'tenant storage · scoped to ' + ws.name} />
                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    {[['doc', 'md'], ['sheet', 'CSV'], ['image', 'images'], ['code', 'json']].map(([t, lab]) => (
                      <Tag key={t}>{lab} · {artifacts[t] || 0}</Tag>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>retention · {(RET_OPTS.find((r) => r[0] === kb.retention) || [])[1]} · originals kept</span>
                    <span className="dtag">2 orphans</span><span className="dtag">1 duplicate</span>
                  </div>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <CardHead><span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span className="zs-eyebrow">Ingestion health</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{stageCount.ready}/{docs.length} ready</span></CardHead>
                <div className="flex h-[8px] rounded-full overflow-hidden mt-4 mx-6 mb-0">
                  {STAGES.map((s) => stageCount[s] ? <div key={s} title={s + ' · ' + stageCount[s]} style={{ flex: stageCount[s], background: STAGE_META[s][1] }} /> : null)}
                </div>
                <div className="pt-2.5 px-6 pb-4">
                  {inFlight.length === 0
                    ? <div className="zs-body-sm text-[12px]">All documents parsed, chunked and embedded.</div>
                    : inFlight.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 py-2 px-0 border-t">
                          <span className="flex-1 min-w-0 text-sm text-ink whitespace-nowrap overflow-hidden text-ellipsis">{d.title}</span>
                          <span className="status" style={{ color: STAGE_META[d.ing][1] }}><span className="dot" style={{ background: STAGE_META[d.ing][1] }} />{STAGE_META[d.ing][0]}</span>
                          {d.ing === 'failed' && <Button variant="ghost" size="sm"><Icon name="history" size={12} tone="soft" /> Re-process</Button>}
                        </div>
                      ))}
                </div>
              </Card>
            </Half>
          </div>
        </div>
      </ViewPad>
    );
  }

  window.SpacesKBView = SpacesKBView;
})();
