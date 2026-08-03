/* Torii · view-playground.jsx — "chat with your documents",
   layer by layer. Every toggle changes the trace, the answer, the meters. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, Pill, Kbd, Half, Button, Switch, Meter, CtrlRow, ModelPicker, Tag, ExecBadge, OfflineBanner, useEnv, ProviderDot, Sessions, MyTemplates, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { modelById, money, GATEWAY_REGION, TOOLS, PROMPT_TEMPLATES } = window.StrategosAPI;
  const { useState } = React;

  const { LEVELS, RETRIEVED, SQL_ROWS, NODE_ICON, RETR_MODES, RERANK_MODELS, CHUNKS_PG, ADV_MODES } = window.StrategosAPI.content.playground;

  // what the retrieve step actually pulled — surfaced by the inspector
  const SQL_TEXT = "SELECT property, budget, actual, actual - budget AS over\nFROM finance.service_charges\nWHERE period = 'Q1' AND actual > budget\nORDER BY over DESC";

  const ANSWERS = [
    { grounding: 38, sources: ['quarterly-pack-q1.pdf'],
      text: <span>A few properties <em>seem</em> to have gone over their service-charge budgets last quarter. The retrieved passages mention overspending, but I can't reliably tie exact figures to specific properties from the raw text.</span> },
    { grounding: 63, sources: ['quarterly-pack-q1.pdf', 'maintenance-notes.md'],
      text: <span>Two properties stand out for service-charge overruns last quarter — <b>Maple Court</b> and <b>Harbour View</b> — both flagged for higher-than-expected maintenance. The precise overage isn't stated consistently across the excerpts.</span> },
    { grounding: 86, sources: ['q1-reconciliation.pdf · p.4 (table)', 'maintenance-log.csv'],
      text: <span>Three properties breached their Q1 service-charge budget. From the reconciliation <b>table</b>: <b>Maple Court (+£14,200)</b>, <b>Harbour View (+£9,750)</b> and <b>Old Mill Lofts (+£3,110)</b> — driven mostly by lift maintenance and grounds upkeep.</span> },
    { grounding: 97, sources: ['finance.warehouse · service_charges', 'q1-reconciliation.pdf · p.4'], text: 'SQL' },
  ];

  function spaceKB(wsId) { try { return JSON.parse(localStorage.getItem('zs-kb-' + wsId) || '{}'); } catch (e) { return {}; } }

  function TStep({ kind, head, children }) {
    return (
      <div className="tstep">
        <span className="tnode"><Icon name={NODE_ICON[kind] || 'info'} size={15} tone={kind === 'user' ? 'ink' : kind === 'guard' ? 'success' : 'accent'} /></span>
        <div className="thead">{head}</div>
        {children && <div className="tbody">{children}</div>}
      </div>
    );
  }

  function Cite({ n }) { return <sup className="cite">{n}</sup>; }

  function PlaygroundView({ go }) {
    const [model, setModel] = useState('sonnet-4.6');
    const { ws } = useWorkspace();
    const [level, setLevel] = useState(2);
    const { meta } = useEnv();
    const [t, setT] = useState({ guardrails: true, citations: true, retention: false, autotune: false, rerank: false });
    const kbDef = spaceKB(ws.id);
    const [retr, setRetr] = useState(kbDef.retr || 'hybrid');
    const [hybridW, setHybridW] = useState(kbDef.hybrid != null ? kbDef.hybrid : 65);
    const [rerankModel, setRerankModel] = useState(kbDef.rerankModel || 'bge-reranker-v2');
    const [chunk, setChunk] = useState('Structural');
    const [csize, setCsize] = useState(512);
    const [coverlap, setCoverlap] = useState(64);
    const [topk, setTopk] = useState(6);
    const [adv, setAdv] = useState(() => new Set(['contextual']));
    const toggleAdv = (k) => setAdv((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const [judge, setJudge] = useState(false);
    const flip = (k) => setT((s) => ({ ...s, [k]: !s[k] }));
    const [tplOpen, setTplOpen] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);
    const [inspect, setInspect] = useState(false);
    const sessions = Sessions.use();
    const myTpls = MyTemplates.use();
    const allTpls = [...PROMPT_TEMPLATES, ...myTpls];
    const applyTemplate = (tpl) => { const p = tpl.preset || {}; if (p.level != null) setLevel(p.level); setT((s) => ({ ...s, guardrails: !!p.guardrails, citations: !!p.citations, rerank: !!p.rerank, autotune: !!p.autotune, retention: !!p.retention })); setTplOpen(false); };
    const applySession = (ss) => { if (ss.level != null) setLevel(ss.level); if (ss.model) setModel(ss.model); if (ss.toggles) setT({ ...ss.toggles }); setTplOpen(false); };
    const saveSession = () => { Sessions.add({ kind: 'session', model, level, toggles: t, title: LEVELS[level].name + ' · ' + (t.citations ? 'cited' : 'no cites') + (t.rerank ? ' · reranked' : '') }); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
    React.useEffect(() => {
      const h = window.StrategosUI.Handoff && window.StrategosUI.Handoff.take();
      if (h && h.preset) { const p = h.preset; if (p.model) setModel(p.model); if (p.level != null) setLevel(p.level); setT((s) => ({ ...s, guardrails: !!p.guardrails, citations: !!p.citations, rerank: !!p.rerank, autotune: !!p.autotune, retention: !!p.retention })); }
    }, []);
    const m = modelById(model);
    const ans = ANSWERS[level];
    const runsLocal = !!m.localCap || !meta.online;   // plane: local-capable model or offline fallback

    const inTok = [3000, 4200, 6500, 5200][level];
    const costQ = (m.price * (inTok + 600) / 1e6) + (t.rerank ? 0.0009 : 0) + 0.0004 * (level + 1);
    const lat = m.lat + [120, 200, 540, 360][level] + (t.rerank ? 180 : 0) + (t.autotune ? 220 : 0) + (t.guardrails ? 90 : 0) + (t.retention ? 60 : 0) + (retr === 'hybrid' ? 80 : retr === 'sparse' ? 20 : 0);
    let grounding = Math.min(99, ans.grounding + (t.rerank ? 6 : 0) + (t.citations ? 2 : 0));
    let quality = Math.max(40, Math.min(99, m.q - [20, 9, 2, 0][level] + (t.autotune ? 3 : 0) + (t.rerank ? 2 : 0)));
    const recall = Math.min(99, [55, 68, 82, 95][level] + (retr === 'hybrid' ? 6 : retr === 'sparse' ? -3 : 0) + (t.rerank ? 5 : 0));
    const ctxPrec = Math.min(99, [48, 62, 80, 93][level] + (t.rerank ? 8 : 0) + (retr === 'hybrid' ? 4 : 0));
    const sources = ans.sources;

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Playground" chip={ws} title="Chat with your documents"
          sub="Build the retrieval pipeline one layer at a time. Every toggle on the right visibly changes the trace, the answer, and the live meters below it."
          actions={<div className="flex items-center gap-2 relative">
            <Button variant="secondary" onClick={() => { window.StrategosUI.Handoff.set({ compareModel: model }); if (go) go('compare'); }}><Icon name="scale" size={15} tone="soft" /> Compare these</Button>
            <Button variant="secondary" onClick={() => setJudge((v) => !v)}><Icon name="scale" size={15} tone={judge ? 'accent' : 'soft'} /> Judge {judge ? 'on' : 'off'}</Button>
            <Button variant="secondary" onClick={() => setTplOpen((v) => !v)}><Icon name="grid" size={15} tone="soft" /> Templates <Icon name="caret" size={13} tone="mute" /></Button>
            <Button variant="primary" onClick={saveSession}><Icon name={savedFlash ? 'check' : 'citation'} size={15} tone="paper" /> {savedFlash ? 'Saved' : 'Save session'}</Button>
            {tplOpen && (
              <div className="rise" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 'min(320px, calc(100vw - 48px))', zIndex: 30, background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', padding: '12px' }}>
                <div className="zs-eyebrow" style={{ padding: '4px 8px' }}>Shared templates</div>
                {allTpls.map((tpl) => (
                  <button key={tpl.id} onClick={() => applyTemplate(tpl)} className="tpl-row">
                    <Icon name="grid" size={14} tone="accent" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tpl.name}</span>
                      <span className="mono" style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{tpl.space} · {tpl.by}{tpl.shared ? '' : ' · yours'}</span>
                    </span>
                    <Icon name="arrow" size={13} tone="faint" />
                  </button>
                ))}
                {sessions.length > 0 && (
                  <div>
                    <div className="zs-eyebrow" style={{ padding: '8px 8px 4px' }}>Your saved sessions</div>
                    {sessions.map((ss) => (
                      <button key={ss.id} onClick={() => applySession(ss)} className="tpl-row">
                        <Icon name="history" size={14} tone="mute" />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ss.title}</span>
                        <Icon name="arrow" size={13} tone="faint" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>} />

        <div style={{ marginBottom: meta.online ? 0 : '16px' }}><OfflineBanner context="playground" /></div>

        <Card className="overflow-hidden">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="doc" size={15} tone="soft" /><span className="text-sm font-semibold">RAG session</span></span>
            <div className="flex items-center gap-3">
              <Pill><Icon name="database" size={13} tone="mute" /> 1,240 docs indexed</Pill>
              <ModelPicker value={model} onChange={setModel} />
              <ExecBadge local={runsLocal} region={GATEWAY_REGION} />
            </div>
          </CardHead>

          <div className="pg-split">
            {/* answer canvas */}
            <div className="border-b lg:border-b-0 lg:border-r flex flex-col min-w-0">
              <div className="py-6 px-6 flex-1">
                <div className="trace">
                  <TStep kind="user" head="you asked">
                    <span className="text-base text-ink">Which properties breached their service-charge budget last quarter, and by how much?</span>
                  </TStep>
                  {t.autotune && <TStep kind="autotune" head="tuned the prompt">Rewrote → <code>service-charge actual vs budget by property, period = Q1, delta &gt; 0</code></TStep>}
                  {t.retention && <TStep kind="mem" head="recalled context">Carried <b>2 prior turns</b> — you'd scoped the portfolio to the <code>North region</code>.</TStep>}
                  <TStep kind={level === 3 ? 'sql' : 'retr'} head={level === 3 ? 'queried the warehouse' : 'retrieved'}>
                    {level === 0 && <span>Embedded the query, cosine match over raw 512-token chunks — <b>6 of 1,240</b> chunks. No structure preserved.</span>}
                    {level === 1 && <span>Sentence-window retrieval — expanded 6 hits into overlapping windows for cleaner context.</span>}
                    {level === 2 && <span>Layout-aware parse: pulled <b>text + 3 tables</b> (→ rows) and <b>2 figures</b> (→ captions). The reconciliation table survived intact.</span>}
                    {level === 3 && <span>Classified as analytical → routed to SQL over <code>finance.service_charges</code>.</span>}
                    <button onClick={() => setInspect((v) => !v)} style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: inspect ? 'var(--accent)' : 'var(--ink-mute)', cursor: 'pointer' }}>
                      <Icon name="eye" size={13} tone={inspect ? 'accent' : 'mute'} /> {inspect ? 'hide inspector' : 'inspect what ran'}
                      <Icon name="caret" size={11} tone={inspect ? 'accent' : 'mute'} style={{ transform: inspect ? 'rotate(180deg)' : 'none' }} />
                    </button>
                    {inspect && (
                      <div className="rise mt-2 border rounded overflow-hidden">
                        {level === 3 ? (
                          <div>
                            <div className="flex items-center gap-2 py-2 px-2.5 border-b bg-paper-soft">
                              <Icon name="branch" size={13} tone="accent" />
                              <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>Finance warehouse · MCP http</span>
                              <span className="flex-1" />
                              <ExecBadge local={false} region={GATEWAY_REGION} />
                            </div>
                            <pre className="md-pre m-0 rounded-[0px] border-0"><code>{SQL_TEXT}</code></pre>
                          </div>
                        ) : (
                          <div>
                            {RETRIEVED.slice(0, level === 0 ? 2 : 3).map((r, ri) => (
                              <div key={r.id} className="flex items-center gap-2 py-2 px-2.5 border-b">
                                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{r.id}</span>
                                <span className="flex-1 min-w-0 text-sm text-ink whitespace-nowrap overflow-hidden text-ellipsis">{r.head}</span>
                                <button className="mono" title="Highlight this passage at the source" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)', color: 'var(--accent)', cursor: 'pointer' }}><Icon name="pin" size={11} tone="accent" />p.{ri + 4} · bbox</button>
                                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.src}</span>
                                <div className="score w-[40px]"><span className="score-fill" style={{ width: (r.score * 100) + '%' }} /></div>
                              </div>
                            ))}
                            {t.rerank && (
                              <div className="flex items-center gap-2 py-2 px-2.5 border-b opacity-55">
                                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>c-07</span>
                                <span className="flex-1 min-w-0 text-sm text-ink-mute whitespace-nowrap overflow-hidden text-ellipsis" style={{ textDecoration: 'line-through'}}>Old note — prior quarter</span>
                                <span className="dtag warn">dropped by rerank</span>
                                <div className="score w-[40px]"><span className="score-fill" style={{ width: '42%', background: 'var(--ink-faint)' }} /></div>
                              </div>
                            )}
                            <div className="mono" style={{ padding: '6px 10px', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>top {level === 0 ? 2 : 3} of {level === 0 ? '1,240 chunks' : '24 candidates'} · {retr === 'hybrid' ? 'hybrid · dense ' + hybridW + ' / sparse ' + (100 - hybridW) : retr === 'sparse' ? 'sparse · BM25' : 'dense · vector'}{t.rerank ? ' · reranked · ' + rerankModel : ''}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </TStep>
                  {t.rerank && <TStep kind="rerank" head="reranked">Cross-encoder reranked <b>24 → 6</b> passages by answer-relevance.</TStep>}
                  {t.guardrails && <TStep kind="guard" head="ran guardrails">Input + output scanned · <b>1 tenant name masked</b> · 0 policy hits · grounded-only enforced.</TStep>}
                </div>

                {/* final answer */}
                <div className="answer mt-4">
                  <div className="answer-hd"><Icon name="spark" size={12} tone="accent" /> Answer · {m.id} <span className="flex-1" /> <ExecBadge local={runsLocal} region={GATEWAY_REGION} verb /></div>
                  <div className="answer-bd">
                    {ans.text === 'SQL' ? (
                      <div>
                        <span><b>4 properties</b> breached their Q1 service-charge budget. Routed to SQL for exact figures{t.citations && <Cite n={1} />}:</span>
                        <table className="tbl" style={{ marginTop: 12 }}>
                          <thead><tr><th>Property</th><th className="num">Budget £</th><th className="num">Actual £</th><th className="num">Over £</th></tr></thead>
                          <tbody>
                            {SQL_ROWS.map((r) => (
                              <tr key={r[0]}><td style={{ color: 'var(--ink)' }}>{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td><td className="num" style={{ color: 'var(--warning)' }}>{r[3]}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (<span>{ans.text}{t.citations && <Cite n={1} />}</span>)}

                    {t.citations && (
                      <div className="mt-4 pt-3 border-t border-dashed">
                        <div className="zs-eyebrow mb-2">Sources</div>
                        <div className="flex flex-col gap-1.5">
                          {sources.map((s, i) => (
                            <div key={s} className="flex items-center gap-2 font-mono text-sm text-ink-mute">
                              <Cite n={i + 1} /><Icon name={s.includes('warehouse') ? 'database' : 'doc'} size={13} tone="mute" />{s}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!t.citations && <div className="mt-3 font-mono text-sm text-warning">no citations — can you trust it?</div>}
                    {judge && <div className="mt-4 pt-3 border-t border-dashed"><div className="flex items-center gap-2 mb-1.5"><Icon name="scale" size={13} tone="accent" /><span className="zs-eyebrow m-0">Quality judge</span></div><div className="zs-body-sm text-[12.5px]">Grounding <b style={{ color: 'var(--ink)' }}>{grounding}%</b> · supported by {sources.length} in-tenant source{sources.length !== 1 ? 's' : ''}. {grounding >= 85 ? 'Well-grounded — safe to rely on.' : grounding >= 60 ? 'Partially grounded — spot-check the figures.' : 'Weakly grounded — verify before use.'}</div></div>}
                  </div>
                </div>
              </div>

              <div className="composer">
                <Icon name="plus" size={16} tone="mute" />
                <input placeholder="Ask anything — show data, run reports, edit records, upload files…" readOnly />
                <Kbd>⌘↵</Kbd>
              </div>
            </div>

            {/* pipeline control rail */}
            <div className="flex flex-col bg-paper-soft min-w-0">
              <div className="pt-4 px-4 pb-2">
                <div className="zs-eyebrow mb-2.5">Pipeline layers</div>
                <div className="flex flex-col gap-1.5">
                  {LEVELS.map((lv, i) => {
                    const on = i === level;
                    return (
                      <button key={lv.k} type="button" onClick={() => setLevel(i)} className={'seg' + (on ? ' on' : '')}>
                        <span className="seg-ic"><Icon name={lv.ic} size={15} tone={on ? 'accent' : 'mute'} /></span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold" style={{ color: on ? 'var(--accent)' : 'var(--ink)' }}>{lv.name}</span>
                          <span className="block font-mono text-xs text-ink-mute mt-px whitespace-nowrap overflow-hidden text-ellipsis">{lv.sub}</span>
                        </span>
                        <span className="font-mono text-xs text-ink-faint">L{i}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 py-2 px-2.5 rounded bg-accent-soft border border-[oklch(0.58_0.15_35_/_0.20)]">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="info" size={12} tone="accent" />
                    <span className="zs-eyebrow m-0 text-accent">Use when</span>
                  </div>
                  <span className="text-xs text-ink-soft leading-[1.45]">{LEVELS[level].use}</span>
                </div>
              </div>

              <div className="pt-2.5 px-4 pb-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <span className="zs-eyebrow m-0">Retrieval mode</span>
                  <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>session only</span>
                </div>
                <div className="flex items-center gap-2" style={{ marginBottom: retr === 'hybrid' ? 10 : 0 }}>
                  {RETR_MODES.map((rm) => (
                    <button key={rm.k} onClick={() => setRetr(rm.k)} title={rm.sub} style={{ flex: 1, padding: '7px 4px', borderRadius: 'var(--radius)', border: '1px solid ' + (retr === rm.k ? 'var(--ink)' : 'var(--paper-edge)'), background: retr === rm.k ? 'var(--paper-mute)' : 'var(--paper)', cursor: 'pointer' }}>
                      <span className="block text-xs font-semibold text-ink">{rm.name}</span>
                      <span className="block font-mono text-[10px] text-ink-mute">{rm.sub}</span>
                    </button>
                  ))}
                </div>
                {retr === 'hybrid' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-ink-soft">dense ↔ sparse</span>
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{hybridW}% dense</span>
                    </div>
                    <input type="range" min="0" max="100" step="5" value={hybridW} onChange={(e) => setHybridW(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </div>
                )}
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 8 }}>space default · {kbDef.retr || 'hybrid'}{(!kbDef.retr || kbDef.retr === 'hybrid') ? ' ' + (kbDef.hybrid != null ? kbDef.hybrid : 65) + '%' : ''} · fixed by admin</div>
                <div className="zs-eyebrow mt-3 mx-0 mb-1.5">Chunking · session</div>
                <select value={chunk} onChange={(e) => setChunk(e.target.value)} style={{ width: '100%', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '7px 9px', cursor: 'pointer' }}>{CHUNKS_PG.map((c) => <option key={c}>{c}</option>)}</select>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs text-ink-soft">Size</span><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{csize} tok</span></div>
                    <input type="range" min="128" max="1024" step="64" value={csize} onChange={(e) => setCsize(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs text-ink-soft">Overlap</span><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{coverlap} tok</span></div>
                    <input type="range" min="0" max="256" step="16" value={coverlap} onChange={(e) => setCoverlap(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </div>
                </div>
                {t.rerank && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1"><span className="text-xs text-ink-soft">Rerank keeps top-k</span><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{topk}</span></div>
                    <input type="range" min="3" max="12" step="1" value={topk} onChange={(e) => setTopk(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </div>
                )}
                <div className="zs-eyebrow mt-3 mx-0 mb-1.5">Advanced modes · session</div>
                <div className="flex gap-1.5 flex-wrap">{ADV_MODES.map(([k, lab]) => { const on = adv.has(k); return <button key={k} onClick={() => toggleAdv(k)} style={{ padding: '4px 9px', borderRadius: 'var(--radius-full)', fontSize: 10.5, fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>; })}</div>
                <Button className="w-full justify-center mt-3 opacity-60" variant="secondary" size="sm" disabled title="Space owner or admin only"><Icon name="lock" size={13} tone="mute" /> Promote to space default</Button>
              </div>

              <div className="pt-1.5 px-4 pb-2 mt-1 border-t">
                <CtrlRow icon="shield"  title="Guardrails"        sub="PII mask · grounded-only" active={t.guardrails}><Switch on={t.guardrails} onClick={() => flip('guardrails')} label="Guardrails" /></CtrlRow>
                <CtrlRow icon="citation" title="Citations"        sub="inline + source list"     active={t.citations}><Switch on={t.citations} onClick={() => flip('citations')} label="Citations" /></CtrlRow>
                <CtrlRow icon="filter"  title="Reranking"         sub={t.rerank ? 'cross-encoder · ' + rerankModel : 'cross-encoder 24 → 6'}     active={t.rerank}>{t.rerank && <select value={rerankModel} onChange={(e) => setRerankModel(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 10.5px var(--font-mono)', color: 'var(--ink)', padding: '3px 5px', cursor: 'pointer' }}>{RERANK_MODELS.map((rmn) => <option key={rmn} value={rmn}>{rmn}</option>)}</select>}<Switch on={t.rerank} onClick={() => flip('rerank')} label="Reranking" /></CtrlRow>
                <CtrlRow icon="spark"   title="Auto-tune prompt"  sub="rewrite for retrieval"    active={t.autotune}><Switch on={t.autotune} onClick={() => flip('autotune')} label="Auto-tune" /></CtrlRow>
                <CtrlRow icon="history" title="Context retention" sub="carry prior turns"        active={t.retention}><Switch on={t.retention} onClick={() => flip('retention')} label="Retention" /></CtrlRow>
              </div>

              <div className="pt-2 px-4 pb-3 border-t">
                <div className="zs-eyebrow mb-2">Tools · your allow-list</div>
                <div className="flex flex-col gap-2">
                  {TOOLS.map((tool) => (
                    <div key={tool.id} className="flex items-center gap-2" style={{ opacity: tool.allowed ? 1 : 0.65 }}>
                      <Icon name={tool.allowed ? 'check' : 'lock'} size={14} tone={tool.allowed ? 'success' : 'mute'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink font-medium">{tool.name}</span>
                        <span className="mono" style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool.allowed ? tool.sub + ' · ' + tool.via : tool.reason}</span>
                      </span>
                      {tool.allowed ? <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', textTransform: 'uppercase' }}>{tool.mcp}</span> : <span className="dtag warn">blocked</span>}
                    </div>
                  ))}
                </div>
              </div>

              <Half tight className="mt-auto py-4 px-6 border-t bg-paper">
                <Meter label="Grounding"      value={grounding} display={grounding + '%'} tone={grounding > 80 ? 'success' : grounding > 55 ? 'accent' : 'warning'} />
                <Meter label="Answer quality" value={quality}   display={quality + '%'}   tone={quality > 85 ? 'success' : 'accent'} />
                <Meter label="Cost / query"   value={costQ * 1000} max={120} display={costQ < 0.01 ? '<0.01¢' : (costQ * 100).toFixed(2) + '¢'} tone={costQ > 0.06 ? 'warning' : 'ink'} hint={m.price === 0 ? 'local · free' : money(m.price) + '/M tok'} />
                <Meter label="Latency"        value={lat} max={4200} display={(lat / 1000).toFixed(1) + 's'} tone={lat > 2600 ? 'warning' : 'ink'} hint={'~' + inTok.toLocaleString() + ' in-tok'} />
                <Meter label="Recall @k"      value={recall} display={recall + '%'} tone={recall > 80 ? 'success' : recall > 60 ? 'accent' : 'warning'} />
                <Meter label="Context precision" value={ctxPrec} display={ctxPrec + '%'} tone={ctxPrec > 80 ? 'success' : 'accent'} />
              </Half>
            </div>
          </div>
        </Card>
      </ViewPad>
    );
  }

  window.PlaygroundView = PlaygroundView;
})();
