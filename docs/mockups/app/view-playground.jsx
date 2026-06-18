/* Strategos Console · view-playground.jsx — "chat with your documents",
   layer by layer. Every toggle changes the trace, the answer, the meters. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Switch, Meter, CtrlRow, ModelPicker, Tag } = window.StrategosUI;
  const { modelById, money } = window.StrategosData;
  const { useState } = React;

  const LEVELS = [
    { k: 'raw',      name: 'Raw embedding',   sub: 'cosine over 512-token chunks',              ic: 'database' },
    { k: 'sentence', name: 'Sentence-window', sub: 'sentence vectors + window expansion',        ic: 'layers' },
    { k: 'content',  name: 'Content-aware',   sub: 'layout parse · tables → rows, figs → caps',  ic: 'doc' },
    { k: 'sql',      name: 'SQL-RAG',         sub: 'route structured asks to the warehouse',     ic: 'branch' },
  ];

  const ANSWERS = [
    { grounding: 38, sources: ['quarterly-pack-q1.pdf'],
      text: <span>A few properties <em>seem</em> to have gone over their service-charge budgets last quarter. The retrieved passages mention overspending, but I can't reliably tie exact figures to specific properties from the raw text.</span> },
    { grounding: 63, sources: ['quarterly-pack-q1.pdf', 'maintenance-notes.md'],
      text: <span>Two properties stand out for service-charge overruns last quarter — <b>Maple Court</b> and <b>Harbour View</b> — both flagged for higher-than-expected maintenance. The precise overage isn't stated consistently across the excerpts.</span> },
    { grounding: 86, sources: ['q1-reconciliation.pdf · p.4 (table)', 'maintenance-log.csv'],
      text: <span>Three properties breached their Q1 service-charge budget. From the reconciliation <b>table</b>: <b>Maple Court (+£14,200)</b>, <b>Harbour View (+£9,750)</b> and <b>Old Mill Lofts (+£3,110)</b> — driven mostly by lift maintenance and grounds upkeep.</span> },
    { grounding: 97, sources: ['finance.warehouse · service_charges', 'q1-reconciliation.pdf · p.4'], text: 'SQL' },
  ];

  const SQL_ROWS = [
    ['Maple Court', '48,200', '62,400', '+14,200'],
    ['Harbour View', '31,000', '40,750', '+9,750'],
    ['Old Mill Lofts', '22,500', '25,610', '+3,110'],
    ['Kingsgate', '18,000', '19,180', '+1,180'],
  ];

  const NODE_ICON = { user: 'user', autotune: 'spark', mem: 'history', retr: 'database', sql: 'branch', rerank: 'filter', guard: 'shield', done: 'check' };

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

  function PlaygroundView() {
    const [model, setModel] = useState('sonnet-4.6');
    const [level, setLevel] = useState(2);
    const [t, setT] = useState({ guardrails: true, citations: true, retention: false, autotune: false, rerank: false });
    const flip = (k) => setT((s) => ({ ...s, [k]: !s[k] }));
    const m = modelById(model);
    const ans = ANSWERS[level];

    const inTok = [3000, 4200, 6500, 5200][level];
    const costQ = (m.price * (inTok + 600) / 1e6) + (t.rerank ? 0.0009 : 0) + 0.0004 * (level + 1);
    const lat = m.lat + [120, 200, 540, 360][level] + (t.rerank ? 180 : 0) + (t.autotune ? 220 : 0) + (t.guardrails ? 90 : 0) + (t.retention ? 60 : 0);
    let grounding = Math.min(99, ans.grounding + (t.rerank ? 6 : 0) + (t.citations ? 2 : 0));
    let quality = Math.max(40, Math.min(99, m.q - [20, 9, 2, 0][level] + (t.autotune ? 3 : 0) + (t.rerank ? 2 : 0)));
    const sources = ans.sources;

    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Playground</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Chat with your documents</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 620 }}>Build the retrieval pipeline one layer at a time. Every toggle on the right visibly changes the trace, the answer, and the live meters below it.</p>
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="doc" size={15} tone="soft" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>RAG session</span></span>
            <div className="flex items-center gap-3">
              <span className="pill"><Icon name="database" size={13} tone="mute" /> 1,240 docs indexed</span>
              <ModelPicker value={model} onChange={setModel} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)' }}>
            {/* answer canvas */}
            <div style={{ borderRight: '1px solid var(--paper-edge)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ padding: '22px 24px', flex: 1 }}>
                <div className="trace">
                  <TStep kind="user" head="you asked">
                    <span style={{ fontSize: 'var(--text-base)', color: 'var(--ink)' }}>Which properties breached their service-charge budget last quarter, and by how much?</span>
                  </TStep>
                  {t.autotune && <TStep kind="autotune" head="tuned the prompt">Rewrote → <code>service-charge actual vs budget by property, period = Q1, delta &gt; 0</code></TStep>}
                  {t.retention && <TStep kind="mem" head="recalled context">Carried <b>2 prior turns</b> — you'd scoped the portfolio to the <code>North region</code>.</TStep>}
                  <TStep kind={level === 3 ? 'sql' : 'retr'} head={level === 3 ? 'queried the warehouse' : 'retrieved'}>
                    {level === 0 && <span>Embedded the query, cosine match over raw 512-token chunks — <b>6 of 1,240</b> chunks. No structure preserved.</span>}
                    {level === 1 && <span>Sentence-window retrieval — expanded 6 hits into overlapping windows for cleaner context.</span>}
                    {level === 2 && <span>Layout-aware parse: pulled <b>text + 3 tables</b> (→ rows) and <b>2 figures</b> (→ captions). The reconciliation table survived intact.</span>}
                    {level === 3 && <span>Classified as analytical → routed to SQL over <code>finance.service_charges</code>.</span>}
                  </TStep>
                  {t.rerank && <TStep kind="rerank" head="reranked">Cross-encoder reranked <b>24 → 6</b> passages by answer-relevance.</TStep>}
                  {t.guardrails && <TStep kind="guard" head="ran guardrails">Input + output scanned · <b>1 tenant name masked</b> · 0 policy hits · grounded-only enforced.</TStep>}
                </div>

                {/* final answer */}
                <div className="answer" style={{ marginTop: 'var(--space-4)' }}>
                  <div className="answer-hd"><Icon name="spark" size={12} tone="accent" /> Answer · {m.id}</div>
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
                      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--paper-edge)' }}>
                        <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Sources</div>
                        <div className="flex flex-col" style={{ gap: 6 }}>
                          {sources.map((s, i) => (
                            <div key={s} className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-mute)' }}>
                              <Cite n={i + 1} /><Icon name={s.includes('warehouse') ? 'database' : 'doc'} size={13} tone="mute" />{s}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!t.citations && <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warning)' }}>no citations — can you trust it?</div>}
                  </div>
                </div>
              </div>

              <div className="composer">
                <Icon name="plus" size={16} tone="mute" />
                <input placeholder="Ask anything — show data, run reports, edit records, upload files…" readOnly />
                <span className="kbd">⌘↵</span>
              </div>
            </div>

            {/* pipeline control rail */}
            <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--paper-soft)', minWidth: 0 }}>
              <div style={{ padding: '16px 18px 8px' }}>
                <div className="zs-eyebrow" style={{ marginBottom: 10 }}>Pipeline layers</div>
                <div className="flex flex-col" style={{ gap: 6 }}>
                  {LEVELS.map((lv, i) => {
                    const on = i === level;
                    return (
                      <button key={lv.k} type="button" onClick={() => setLevel(i)} className={'seg' + (on ? ' on' : '')}>
                        <span className="seg-ic"><Icon name={lv.ic} size={15} tone={on ? 'accent' : 'mute'} /></span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: on ? 'var(--accent)' : 'var(--ink)' }}>{lv.name}</span>
                          <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lv.sub}</span>
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>L{i}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ padding: '6px 18px 8px', marginTop: 4, borderTop: '1px solid var(--paper-edge)' }}>
                <CtrlRow icon="shield"  title="Guardrails"        sub="PII mask · grounded-only" active={t.guardrails}><Switch on={t.guardrails} onClick={() => flip('guardrails')} label="Guardrails" /></CtrlRow>
                <CtrlRow icon="citation" title="Citations"        sub="inline + source list"     active={t.citations}><Switch on={t.citations} onClick={() => flip('citations')} label="Citations" /></CtrlRow>
                <CtrlRow icon="filter"  title="Reranking"         sub="cross-encoder 24 → 6"     active={t.rerank}><Switch on={t.rerank} onClick={() => flip('rerank')} label="Reranking" /></CtrlRow>
                <CtrlRow icon="spark"   title="Auto-tune prompt"  sub="rewrite for retrieval"    active={t.autotune}><Switch on={t.autotune} onClick={() => flip('autotune')} label="Auto-tune" /></CtrlRow>
                <CtrlRow icon="history" title="Context retention" sub="carry prior turns"        active={t.retention}><Switch on={t.retention} onClick={() => flip('retention')} label="Retention" /></CtrlRow>
              </div>

              <div style={{ marginTop: 'auto', padding: '16px 18px', borderTop: '1px solid var(--paper-edge)', background: 'var(--paper)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 18px' }}>
                <Meter label="Grounding"      value={grounding} display={grounding + '%'} tone={grounding > 80 ? 'success' : grounding > 55 ? 'accent' : 'warning'} />
                <Meter label="Answer quality" value={quality}   display={quality + '%'}   tone={quality > 85 ? 'success' : 'accent'} />
                <Meter label="Cost / query"   value={costQ * 1000} max={120} display={costQ < 0.01 ? '<0.01¢' : (costQ * 100).toFixed(2) + '¢'} tone={costQ > 0.06 ? 'warning' : 'ink'} hint={m.price === 0 ? 'local · free' : money(m.price) + '/M tok'} />
                <Meter label="Latency"        value={lat} max={4200} display={(lat / 1000).toFixed(1) + 's'} tone={lat > 2600 ? 'warning' : 'ink'} hint={'~' + inTok.toLocaleString() + ' in-tok'} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.PlaygroundView = PlaygroundView;
})();
