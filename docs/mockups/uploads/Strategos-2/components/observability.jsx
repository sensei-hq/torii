/* Strategos · observability.jsx — interaction history + "why this model" trace. */
const { Icon: OIcon } = window.StrategosIcons;
const { ProviderDot: ODot } = window.StrategosUI;
const { modelById: oById, money: oMoney } = window.StrategosData;
const { useState: oUseState } = React;

const HISTORY = [
  {
    t: '09:42', user: 'a.rao', task: 'Chat with docs', ic: 'doc',
    req: 'opus-4.8', served: 'sonnet-4.6', route: 'Anthropic', tok: '4.6k', cost: 0.021, lat: 1.3, status: 'stepped',
    trace: [
      ['user', 'Requested', <span><code>opus-4.8</code> via Bedrock (team default)</span>],
      ['budget', 'Budget check', <span>Support dept at <b>83% MTD</b> · under the 20% floor → step-down triggered</span>],
      ['fallback', 'Fell back', <span><code>opus-4.8</code> → <code>sonnet-4.6</code> · same provider, ~4× cheaper</span>],
      ['guard', 'Guardrails', <span>1 tenant name masked · grounded-only · 0 policy hits</span>],
      ['done', 'Served', <span><code>sonnet-4.6</code> · 4.6k tok · 1.3s · 3 citations</span>],
    ],
  },
  {
    t: '09:38', user: 'j.lee', task: 'Compare models', ic: 'scale',
    req: '3 models', served: '3 models', route: 'mixed', tok: '12.4k', cost: 0.082, lat: 2.4, status: 'ok',
    trace: [
      ['user', 'Requested', <span>Same task across <code>opus-4.8</code>, <code>gemini-3-flash</code>, <code>gemma-4-9b</code></span>],
      ['budget', 'Budget check', <span>Eval budget bucket · <b>fan-out allowed</b> (3 of max 4)</span>],
      ['done', 'Served', <span>3 parallel runs · best-value flagged <code>gemini-3-flash</code></span>],
    ],
  },
  {
    t: '09:30', user: 'm.diaz', task: 'Talk to data', ic: 'database',
    req: 'gpt-5.2', served: 'gpt-5.2', route: 'OpenAI', tok: '3.1k', cost: 0.043, lat: 1.1, status: 'ok',
    trace: [
      ['user', 'Requested', <span><code>gpt-5.2</code> · NL→SQL over <code>finance.*</code></span>],
      ['guard', 'Data policy', <span>read-only role · in-tenant warehouse · no row export</span>],
      ['done', 'Served', <span>SQL ran in 0.2s · 5 rows · charted</span>],
    ],
  },
  {
    t: '09:05', user: 'ops-bot', task: 'Chat with docs', ic: 'doc',
    req: 'opus-4.8', served: 'llama-4-405b', route: 'OpenRouter', tok: '5.0k', cost: 0.011, lat: 1.9, status: 'resilience',
    trace: [
      ['user', 'Requested', <span><code>opus-4.8</code> via Bedrock</span>],
      ['error', 'Provider error', <span>Bedrock returned <b>503</b> twice · retry budget hit</span>],
      ['fallback', 'Resilience hop', <span>routed to <code>llama-4-405b</code> on OpenRouter to finish</span>],
      ['done', 'Served', <span>completed · 5.0k tok · 1.9s</span>],
    ],
  },
  {
    t: '08:51', user: 's.kaur', task: 'Chat with docs', ic: 'doc',
    req: 'sonnet-4.6', served: 'gemma-4-9b', route: 'Ollama', tok: '4.4k', cost: 0, lat: 0.9, status: 'free',
    trace: [
      ['user', 'Requested', <span><code>sonnet-4.6</code></span>],
      ['budget', 'Budget check', <span>personal cap <b>exhausted</b> ($400/$400) → free floor</span>],
      ['fallback', 'Free floor', <span>routed to local <code>gemma-4-9b</code> on Ollama · $0 egress</span>],
      ['done', 'Served', <span>completed locally · 0.9s · no external call</span>],
    ],
  },
];

const STATUS_STYLE = {
  ok:         ['served', 'var(--success)'],
  stepped:    ['stepped down', 'var(--warn)'],
  resilience: ['failed over', 'var(--sky)'],
  free:       ['free floor', 'var(--ink-mute)'],
};

function WhyPanel({ row }) {
  const NODE_ICON = { user: 'user', budget: 'budget', fallback: 'fallback', guard: 'shield', error: 'flag', done: 'check' };
  const NODE_COLOR = { user: 'var(--ink)', budget: 'var(--warn)', fallback: 'var(--moss)', guard: 'var(--success)', error: 'var(--warn)', done: 'var(--success)' };
  return (
    <div className="card" style={{ position: 'sticky', top: 84, overflow: 'hidden' }}>
      <div className="card-hd">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <OIcon name={row.ic} size={15} style={{ color: 'var(--ink-soft)' }} />
          <span style={{ font: '600 13px var(--font-body)', color: 'var(--ink)' }}>Why this model</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>{row.t} · {row.user}</span>
      </div>
      <div style={{ padding: '18px 18px' }}>
        <div className="trace">
          {row.trace.map((s, i) => (
            <div className="tstep" key={i}>
              <span className="tnode"><OIcon name={NODE_ICON[s[0]]} size={14} style={{ color: NODE_COLOR[s[0]] }} /></span>
              <div className="thead">{s[1]}</div>
              <div className="tbody">{s[2]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ObservabilitySection() {
  const [sel, setSel] = oUseState(0);
  return (
    <section className="section" id="observability">
      <div className="shell-max">
        <div className="section-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', maxWidth: 'none', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 620 }}>
            <span className="eyebrow"><span className="tick"></span>Requests &amp; audit</span>
            <h2>Every call, traced and accountable.</h2>
            <p className="lede">A full ledger of who asked what, which model actually served it, and exactly why the router chose it — the same ledger you'll find in the console. Click any row to read the decision.</p>
          </div>
          <span className="btn"><OIcon name="external" size={14} /> Export · CSV</span>
        </div>

        <div className="grid-obs" style={{ marginTop: 48 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
              <span className="eyebrow">Recent interactions</span>
              <span className="tag"><OIcon name="history" size={12} /> live · last 1h</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ minWidth: 560 }}>
                <thead>
                  <tr><th>Time</th><th>Task</th><th>Requested → Served</th><th className="num">Cost</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {HISTORY.map((r, i) => {
                    const sel_on = i === sel;
                    const st = STATUS_STYLE[r.status];
                    return (
                      <tr key={i} onClick={() => setSel(i)} className={sel_on ? 'sel' : ''}>
                        <td className="mono" style={{ color: 'var(--ink-mute)' }}>{r.t}</td>
                        <td style={{ fontFamily: 'var(--font-body)', color: 'var(--ink)' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><OIcon name={r.ic} size={13} style={{ color: 'var(--ink-soft)' }} />{r.task}</span>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 1 }}>{r.user}</div>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: 'var(--ink-mute)' }}>{r.req}</span>
                            <OIcon name="arrow" size={12} style={{ color: 'var(--ink-faint)' }} />
                            <ODot provider={sm_provider(r.served)} size={7} />
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.served}</span>
                          </span>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 1 }}>{r.route} · {r.tok}</div>
                        </td>
                        <td className="num" style={{ color: r.cost === 0 ? 'var(--success)' : 'var(--ink)' }}>{r.cost === 0 ? 'free' : oMoney(r.cost, 3)}</td>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '500 11px var(--font-mono)', color: st[1] }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: st[1] }}></span>{st[0]}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px dashed var(--line)', display: 'flex', gap: 22, flexWrap: 'wrap', font: '500 11.5px var(--font-mono)', color: 'var(--ink-soft)' }}>
              <span>spend 1h · <b style={{ color: 'var(--ink)' }}>$0.157</b></span>
              <span>fallbacks · <b style={{ color: 'var(--warn)' }}>3</b></span>
              <span>egress · <b style={{ color: 'var(--ink)' }}>4 of 5</b></span>
              <span>policy hits · <b style={{ color: 'var(--success)' }}>0</b></span>
              <span>ledger · <b style={{ color: 'var(--ink)' }}>immutable · 24 mo</b></span>
            </div>
          </div>
          <WhyPanel row={HISTORY[sel]} />
        </div>

        <div style={{ marginTop: 22, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="pill"><OIcon name="user" size={12} /> Members · see &amp; export their own activity</span>
          <span className="pill"><OIcon name="shield" size={12} /> Admins · full ledger + immutable audit trail</span>
          <span className="pill"><OIcon name="external" size={12} /> Streamed to your SIEM · CSV / JSON export</span>
        </div>
      </div>
    </section>
  );
}

function sm_provider(id) { const m = oById(id); return m ? m.provider : 'local'; }

window.ObservabilitySection = ObservabilitySection;
