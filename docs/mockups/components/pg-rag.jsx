/* Strategos · pg-rag.jsx — "Chat with your documents", layer by layer.
   Every toggle visibly changes the trace, the answer, and the meters. */
const { Icon: RIcon } = window.StrategosIcons;
const { ModelPicker: RModelPicker, Switch: RSwitch, Bar: RBar, CtrlRow: RCtrlRow } = window.StrategosUI;
const { modelById: rModelById, money: rMoney } = window.StrategosData;
const { useState: rUseState } = React;

const RAG_LEVELS = [
  { k: 'raw',     name: 'Raw embedding',   sub: 'cosine over 512-token chunks',            ic: 'database' },
  { k: 'sentence',name: 'Sentence-window', sub: 'sentence vectors + window expansion',     ic: 'layers' },
  { k: 'content', name: 'Content-aware',   sub: 'layout parse · tables → rows, figs → caps', ic: 'doc' },
  { k: 'sql',     name: 'SQL-RAG',         sub: 'route structured asks to the warehouse',  ic: 'branch' },
];

const RAG_ANSWERS = [
  { grounding: 38, text: <span>A few properties <em>seem</em> to have gone over their service-charge budgets last quarter. The retrieved passages mention overspending on maintenance and cleaning, but I can't reliably tie exact figures to specific properties from the raw text.</span>, sources: ['quarterly-pack-q1.pdf'] },
  { grounding: 63, text: <span>Two properties stand out for service-charge overruns last quarter — <b>Maple Court</b> and <b>Harbour View</b> — both flagged for higher-than-expected maintenance. The precise overage isn't stated consistently across the excerpts.</span>, sources: ['quarterly-pack-q1.pdf', 'maintenance-notes.md'] },
  { grounding: 86, text: <span>Three properties breached their Q1 service-charge budget. From the reconciliation <b>table</b> in the quarterly pack: <b>Maple Court (+£14,200)</b>, <b>Harbour View (+£9,750)</b> and <b>Old Mill Lofts (+£3,110)</b> — driven mostly by lift maintenance and grounds upkeep.</span>, sources: ['q1-reconciliation.pdf · p.4 (table)', 'maintenance-log.csv'] },
  { grounding: 97, text: 'SQL', sources: ['finance.warehouse · service_charges', 'q1-reconciliation.pdf · p.4'] },
];

const RAG_SQL_ROWS = [
  ['Maple Court', '48,200', '62,400', '+14,200'],
  ['Harbour View', '31,000', '40,750', '+9,750'],
  ['Old Mill Lofts', '22,500', '25,610', '+3,110'],
  ['Kingsgate', '18,000', '19,180', '+1,180'],
];

function RagStep({ kind, head, children }) {
  return (
    <div className="step" data-kind={kind}>
      <span className="node"><RIcon name={{ user: 'user', autotune: 'spark', mem: 'history', retr: 'database', sql: 'branch', rerank: 'filter', guard: 'shield', done: 'check' }[kind] || 'dot'} size={14} /></span>
      <div className="head" style={{ fontFamily: 'var(--font-hand)' }}>{head}</div>
      {children && <div className="body">{children}</div>}
    </div>
  );
}

function CitedChip({ n }) {
  return <sup style={{ font: '600 9px var(--font-mono)', color: 'var(--sky)', background: 'var(--sky-soft)', border: '1px solid color-mix(in oklab, var(--sky) 30%, transparent)', borderRadius: 4, padding: '1px 3px', margin: '0 1px', verticalAlign: 'super', lineHeight: 1 }}>{n}</sup>;
}

function RagPlayground() {
  const [model, setModel] = rUseState('sonnet-4.6');
  const [level, setLevel] = rUseState(1);
  const [t, setT] = rUseState({ guardrails: true, citations: true, retention: false, autotune: false, rerank: false });
  const flip = (k) => setT((s) => ({ ...s, [k]: !s[k] }));
  const m = rModelById(model);
  const ans = RAG_ANSWERS[level];

  /* ── derived metrics ── */
  const inTok = [3000, 4200, 6500, 5200][level];
  const costQ = (m.price * (inTok + 600) / 1e6) + (t.rerank ? 0.0009 : 0) + 0.0004 * (level + 1);
  const lat = m.lat + [120, 200, 540, 360][level] + (t.rerank ? 180 : 0) + (t.autotune ? 220 : 0) + (t.guardrails ? 90 : 0) + (t.retention ? 60 : 0);
  let grounding = ans.grounding + (t.rerank ? 6 : 0) + (t.citations ? 2 : 0);
  grounding = Math.min(99, grounding);
  let quality = m.q - [20, 9, 2, 0][level] + (t.autotune ? 3 : 0) + (t.rerank ? 2 : 0);
  quality = Math.max(40, Math.min(99, quality));

  const showCite = t.citations;
  const sources = ans.sources;

  return (
    <div className="appwin">
      <div className="appwin-bar">
        <div className="traffic"><span style={{ background: '#E36355' }}></span><span style={{ background: '#F5BE4F' }}></span><span style={{ background: '#61C554' }}></span></div>
        <span className="wtitle"><RIcon name="doc" size={14} /> RAG · chat with your documents</span>
        <div className="wright">
          <span className="tag"><RIcon name="database" size={12} /> 1,240 docs indexed</span>
          <RModelPicker value={model} onChange={setModel} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', minHeight: 540 }}>
        {/* ── answer canvas ── */}
        <div style={{ borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="stream" style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
            <RagStep kind="user" head={<span style={{ color: 'var(--user)' }}>You asked</span>}>
              <span style={{ font: '500 14.5px/1.5 var(--font-body)', color: 'var(--ink)' }}>Which properties breached their service-charge budget last quarter, and by how much?</span>
            </RagStep>

            {t.autotune && (
              <RagStep kind="autotune" head="tuned the prompt">
                Rewrote → <code>service-charge actual vs budget by property, period = Q1, delta &gt; 0</code>
              </RagStep>
            )}
            {t.retention && (
              <RagStep kind="mem" head="recalled context">
                Carried <b>2 prior turns</b> — you'd scoped the portfolio to the <code>North region</code>.
              </RagStep>
            )}

            <RagStep kind={level === 3 ? 'sql' : 'retr'} head={level === 3 ? 'queried the warehouse' : 'retrieved'}>
              {level === 0 && <span>Embedded the query, cosine match over raw 512-token chunks — <b>6 of 1,240</b> chunks returned. No structure preserved.</span>}
              {level === 1 && <span>Sentence-window retrieval — expanded 6 hits into overlapping windows for cleaner context.</span>}
              {level === 2 && <span>Layout-aware parse: pulled <b>text + 3 tables</b> (→ rows) and <b>2 figures</b> (→ captions). The reconciliation table survived intact.</span>}
              {level === 3 && <span>Classified as analytical → routed to SQL over <code>finance.service_charges</code>.<br/><code style={{ display: 'inline-block', marginTop: 6, whiteSpace: 'normal' }}>SELECT property, budget, actual, actual-budget AS delta … HAVING delta &gt; 0 ORDER BY delta DESC</code></span>}
            </RagStep>

            {t.rerank && <RagStep kind="rerank" head="reranked">Cross-encoder reranked <b>24 → 6</b> passages by answer-relevance.</RagStep>}
            {t.guardrails && <RagStep kind="guard" head="ran guardrails">Input + output scanned · <b>1 tenant name masked</b> · 0 policy hits · grounded-only enforced.</RagStep>}

            {/* ── final answer ── */}
            <div className="final-reply" style={{ marginTop: 6 }}>
              <div className="ft"><RIcon name="spark" size={12} /> Answer · {m.id}</div>
              <div className="body" style={{ font: '400 14px/1.6 var(--font-body)' }}>
                {ans.text === 'SQL' ? (
                  <div>
                    <span><b>4 properties</b> breached their Q1 service-charge budget. Routed to SQL for exact figures{showCite && <CitedChip n={1} />}:</span>
                    <table className="table" style={{ marginTop: 12 }}>
                      <thead><tr><th>Property</th><th className="num">Budget £</th><th className="num">Actual £</th><th className="num">Over £</th></tr></thead>
                      <tbody>
                        {RAG_SQL_ROWS.map((r) => (
                          <tr key={r[0]}><td style={{ fontFamily: 'var(--font-body)' }}>{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td><td className="num" style={{ color: 'var(--warn)' }}>{r[3]}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <span>{ans.text}{showCite && <CitedChip n={1} />}</span>
                )}
              </div>
              {showCite && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
                  <div style={{ font: '500 10px var(--font-mono)', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>Sources</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sources.map((s, i) => (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, font: '500 12px var(--font-mono)', color: 'var(--ink-mute)' }}>
                        <CitedChip n={i + 1} /><RIcon name={s.includes('warehouse') ? 'database' : 'doc'} size={13} />{s}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!showCite && <div className="hand" style={{ marginTop: 12, fontSize: 17 }}>no citations — can you trust it?</div>}
            </div>
          </div>
        </div>

        {/* ── pipeline control rail ── */}
        <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--paper-card)', minWidth: 0 }}>
          <div style={{ padding: '16px 18px 10px' }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Pipeline layers</div>
            {/* retrieval level segmented vertical */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {RAG_LEVELS.map((lv, i) => {
                const on = i === level;
                return (
                  <button key={lv.k} type="button" onClick={() => setLevel(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', cursor: 'pointer', textAlign: 'left',
                      border: '1px solid ' + (on ? 'var(--moss-line)' : 'var(--line)'), borderRadius: 10,
                      background: on ? 'var(--moss-soft)' : 'var(--paper-card)', transition: 'all 120ms' }}>
                    <span style={{ width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0,
                      background: on ? 'var(--moss)' : 'var(--paper-inset)', color: on ? 'var(--moss-fg)' : 'var(--ink-soft)' }}>
                      <RIcon name={lv.ic} size={14} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', font: '600 12.5px var(--font-body)', color: on ? 'var(--moss)' : 'var(--ink)' }}>{lv.name}</span>
                      <span style={{ display: 'block', font: '400 10.5px var(--font-mono)', color: 'var(--ink-soft)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lv.sub}</span>
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>L{i}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '4px 18px 6px', borderTop: '1px solid var(--line)', marginTop: 6 }}>
            <RCtrlRow icon="shield" title="Guardrails" sub="PII mask · grounded-only" active={t.guardrails}><RSwitch on={t.guardrails} onClick={() => flip('guardrails')} label="Guardrails" /></RCtrlRow>
            <RCtrlRow icon="citation" title="Citations" sub="inline + source list" active={t.citations}><RSwitch on={t.citations} onClick={() => flip('citations')} label="Citations" /></RCtrlRow>
            <RCtrlRow icon="filter" title="Reranking" sub="cross-encoder 24 → 6" active={t.rerank}><RSwitch on={t.rerank} onClick={() => flip('rerank')} label="Reranking" /></RCtrlRow>
            <RCtrlRow icon="spark" title="Auto-tune prompt" sub="rewrite for retrieval" active={t.autotune}><RSwitch on={t.autotune} onClick={() => flip('autotune')} label="Auto-tune" /></RCtrlRow>
            <RCtrlRow icon="history" title="Context retention" sub="carry prior turns" active={t.retention}><RSwitch on={t.retention} onClick={() => flip('retention')} label="Retention" /></RCtrlRow>
          </div>

          {/* live impact */}
          <div style={{ marginTop: 'auto', padding: '14px 18px 18px', borderTop: '1px solid var(--line)', background: 'var(--paper)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px' }}>
            <RBar label="Grounding" value={grounding} display={grounding + '%'} tone={grounding > 80 ? 'success' : grounding > 55 ? 'sky' : 'warn'} />
            <RBar label="Answer quality" value={quality} display={quality + '%'} tone={quality > 85 ? 'moss' : 'sky'} />
            <RBar label="Cost / query" value={costQ * 1000} max={120} display={costQ < 0.01 ? '<0.01¢' : (costQ * 100).toFixed(2) + '¢'} tone={costQ > 0.06 ? 'warn' : 'ink'} hint={m.price === 0 ? 'local · free' : rMoney(m.price) + '/M tok'} />
            <RBar label="Latency" value={lat} max={4200} display={(lat / 1000).toFixed(1) + 's'} tone={lat > 2600 ? 'warn' : 'ink'} hint={'~' + inTok.toLocaleString() + ' in-tok'} />
          </div>
        </div>
      </div>
    </div>
  );
}

window.RagPlayground = RagPlayground;
