/* Strategos Console · view-requests.jsx — interaction ledger + "why this model" trace. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ProviderDot } = window.StrategosUI;
  const { modelById, money } = window.StrategosData;
  const { useState } = React;

  const HISTORY = [
    { t: '09:42', user: 'a.rao', task: 'Chat with docs', ic: 'doc', req: 'opus-4.8', served: 'sonnet-4.6', route: 'Anthropic', tok: '4.6k', cost: 0.021, status: 'stepped',
      trace: [
        ['user', 'Requested', <span><code>opus-4.8</code> via Bedrock (team default)</span>],
        ['budget', 'Budget check', <span>Support dept at <b>83% MTD</b> · under the 20% floor → step-down triggered</span>],
        ['fallback', 'Fell back', <span><code>opus-4.8</code> → <code>sonnet-4.6</code> · same provider, ~4× cheaper</span>],
        ['guard', 'Guardrails', <span>1 tenant name masked · grounded-only · 0 policy hits</span>],
        ['done', 'Served', <span><code>sonnet-4.6</code> · 4.6k tok · 1.3s · 3 citations</span>],
      ] },
    { t: '09:38', user: 'j.lee', task: 'Compare models', ic: 'scale', req: '3 models', served: '3 models', route: 'mixed', tok: '12.4k', cost: 0.082, status: 'ok',
      trace: [
        ['user', 'Requested', <span>Same task across <code>opus-4.8</code>, <code>gemini-3-flash</code>, <code>gemma-4-9b</code></span>],
        ['budget', 'Budget check', <span>Eval budget bucket · <b>fan-out allowed</b> (3 of max 4)</span>],
        ['done', 'Served', <span>3 parallel runs · best-value flagged <code>gemini-3-flash</code></span>],
      ] },
    { t: '09:30', user: 'm.diaz', task: 'Talk to data', ic: 'database', req: 'gpt-5.2', served: 'gpt-5.2', route: 'OpenAI', tok: '3.1k', cost: 0.043, status: 'ok',
      trace: [
        ['user', 'Requested', <span><code>gpt-5.2</code> · NL→SQL over <code>finance.*</code></span>],
        ['guard', 'Data policy', <span>read-only role · in-tenant warehouse · no row export</span>],
        ['done', 'Served', <span>SQL ran in 0.2s · 5 rows · charted</span>],
      ] },
    { t: '09:21', user: 'm.okafor', task: 'Ask · Leasing Ops', ic: 'ask', req: 'auto', served: 'sonnet-4.6', route: 'Anthropic', tok: '2.2k', cost: 0.009, status: 'ok',
      trace: [
        ['user', 'Requested', <span>auto-route from <b>Ask</b> · task class: summarize</span>],
        ['fallback', 'Router picked', <span><code>sonnet-4.6</code> · best value for class · 2 cheaper rejected on quality floor</span>],
        ['guard', 'Guardrails', <span>2 tenant names masked · grounded-only · 0 policy hits</span>],
        ['done', 'Served', <span><code>sonnet-4.6</code> · 2.2k tok · 0.8s · 2 citations</span>],
      ] },
    { t: '09:05', user: 'ops-bot', task: 'Chat with docs', ic: 'doc', req: 'opus-4.8', served: 'llama-4-405b', route: 'OpenRouter', tok: '5.0k', cost: 0.011, status: 'resilience',
      trace: [
        ['user', 'Requested', <span><code>opus-4.8</code> via Bedrock</span>],
        ['error', 'Provider error', <span>Bedrock returned <b>503</b> twice · retry budget hit</span>],
        ['fallback', 'Resilience hop', <span>routed to <code>llama-4-405b</code> on OpenRouter to finish</span>],
        ['done', 'Served', <span>completed · 5.0k tok · 1.9s</span>],
      ] },
    { t: '08:51', user: 's.kaur', task: 'Chat with docs', ic: 'doc', req: 'sonnet-4.6', served: 'gemma-4-9b', route: 'Ollama', tok: '4.4k', cost: 0, status: 'free',
      trace: [
        ['user', 'Requested', <span><code>sonnet-4.6</code></span>],
        ['budget', 'Budget check', <span>personal cap <b>exhausted</b> ($400/$400) → free floor</span>],
        ['fallback', 'Free floor', <span>routed to local <code>gemma-4-9b</code> on Ollama · $0 egress</span>],
        ['done', 'Served', <span>completed locally · 0.9s · no external call</span>],
      ] },
    { t: '08:12', user: 'm.okafor', task: 'Draft · lease renewal', ic: 'create', req: 'opus-4.8', served: 'opus-4.8', route: 'Anthropic', tok: '6.8k', cost: 0.054, status: 'ok',
      trace: [
        ['user', 'Requested', <span><code>opus-4.8</code> · long-form draft in <b>Leasing Ops</b></span>],
        ['budget', 'Budget check', <span>personal cap at <b>3% MTD</b> · no step-down</span>],
        ['done', 'Served', <span><code>opus-4.8</code> · 6.8k tok · 3.1s · saved to drafts</span>],
      ] },
  ];

  const STATUS = {
    ok:         ['served',       'var(--success)'],
    stepped:    ['stepped down', 'var(--warning)'],
    resilience: ['failed over',  'var(--accent)'],
    free:       ['free floor',   'var(--ink-mute)'],
  };
  const NODE_ICON = { user: 'user', budget: 'wallet', fallback: 'routing', guard: 'shield', error: 'flag', done: 'check' };
  const NODE_TONE = { user: 'ink', budget: 'warning', fallback: 'accent', guard: 'success', error: 'warning', done: 'success' };

  function prov(id) { const m = modelById(id); return m ? m.provider : 'local'; }

  function WhyPanel({ row }) {
    return (
      <div className="card" style={{ overflow: 'hidden', position: 'sticky', top: 0 }}>
        <div className="card-hd">
          <span className="flex items-center gap-2"><Icon name={row.ic} size={15} tone="soft" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Why this model</span></span>
          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{row.t} · {row.user}</span>
        </div>
        <div style={{ padding: '18px 18px' }}>
          <div className="trace">
            {row.trace.map((s, i) => (
              <div className="tstep" key={i}>
                <span className="tnode"><Icon name={NODE_ICON[s[0]]} size={14} tone={NODE_TONE[s[0]]} /></span>
                <div className="thead">{s[1]}</div>
                <div className="tbody">{s[2]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function RequestsView({ scope = 'org' }) {
    const mine = scope === 'member';
    const rows = mine ? HISTORY.filter((r) => r.user === 'm.okafor') : HISTORY;
    const [sel, setSel] = useState(0);
    const cur = rows[Math.min(sel, rows.length - 1)];
    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">{mine ? 'Activity' : 'Requests'}</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>{mine ? 'Your activity' : 'Every call, traced and accountable'}</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 620 }}>{mine
              ? 'Every call you made — which model actually served it, and exactly why the router chose it. Yours to inspect and export, always.'
              : 'Who asked what, which model actually served it, and exactly why the router chose it. Select any row to read the decision.'}</p>
          </div>
          <button className="zs-btn zs-btn-secondary" style={{ flexShrink: 0 }}><Icon name="upload" size={14} tone="soft" /> Export · CSV</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)', gap: 'var(--space-5)', alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd">
              <span className="zs-eyebrow">{mine ? 'Your recent calls' : 'Recent interactions'}</span>
              <span className="pill"><span className="dot" style={{ background: 'var(--success)' }} /> {mine ? 'this morning' : 'live · last 1h'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 560 }}>
                <thead><tr><th>Time</th><th>Task</th><th>Requested → Served</th><th className="num">Cost</th><th>Outcome</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const st = STATUS[r.status];
                    return (
                      <tr key={i} className={'clickable' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                        <td className="mono" style={{ color: 'var(--ink-mute)' }}>{r.t}</td>
                        <td>
                          <span className="flex items-center gap-2" style={{ color: 'var(--ink)' }}><Icon name={r.ic} size={13} tone="soft" />{r.task}</span>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 1 }}>{r.user}</div>
                        </td>
                        <td>
                          <span className="flex items-center gap-2">
                            <span style={{ color: 'var(--ink-mute)' }}>{r.req}</span>
                            <Icon name="arrow" size={12} tone="faint" />
                            <ProviderDot provider={prov(r.served)} size={7} />
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.served}</span>
                          </span>
                          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 1 }}>{r.route} · {r.tok}</div>
                        </td>
                        <td className="num" style={{ color: r.cost === 0 ? 'var(--success)' : 'var(--ink)' }}>{r.cost === 0 ? 'free' : money(r.cost, 3)}</td>
                        <td><span className="status" style={{ color: st[1] }}><span className="dot" style={{ background: st[1] }} />{st[0]}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-foot dashed" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', fontFamily: 'var(--font-mono)' }}>
              {mine ? (
                <React.Fragment>
                  <span>your spend MTD · <b style={{ color: 'var(--ink)' }}>$12.40 of $400</b></span>
                  <span>policy hits · <b style={{ color: 'var(--success)' }}>0</b></span>
                  <span>retained · <b style={{ color: 'var(--ink)' }}>24 months</b></span>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <span>spend 1h · <b style={{ color: 'var(--ink)' }}>$0.157</b></span>
                  <span>fallbacks · <b style={{ color: 'var(--warning)' }}>3</b></span>
                  <span>egress · <b style={{ color: 'var(--ink)' }}>4 of 5</b></span>
                  <span>policy hits · <b style={{ color: 'var(--success)' }}>0</b></span>
                  <span>ledger · <b style={{ color: 'var(--ink)' }}>immutable · 24 mo</b></span>
                </React.Fragment>
              )}
            </div>
          </div>
          <WhyPanel row={cur} />
        </div>
      </div>
    );
  }

  window.RequestsView = RequestsView;
})();
