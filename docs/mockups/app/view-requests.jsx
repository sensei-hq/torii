/* Torii · view-requests.jsx — interaction ledger + "why this model" trace. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ProviderDot, ExecBadge, Meter, useEnv, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { modelById, money, GATEWAY_REGION, BUDGET_TREE } = window.StrategosData;
  const { useState } = React;

  // the chain of caps the signed-in member inherits from (org → dept → you)
  function cascadePath(node, target, trail) {
    const t = [...(trail || []), node];
    if (node.name === target) return t;
    for (const c of (node.children || [])) { const r = cascadePath(c, target, t); if (r) return r; }
    return null;
  }

  const HISTORY = [
    { t: '09:42', user: 'a.rao', task: 'Chat with docs', ic: 'doc', req: 'opus-4.8', served: 'sonnet-4.6', route: 'Anthropic', tok: '4.6k', cost: 0.021, status: 'stepped',
      trace: [
        ['user', 'Requested', <span><code>opus-4.8</code> via Bedrock (team default)</span>],
        ['budget', 'Budget check', <span>Support dept at <b>83% MTD</b> · under the 20% floor → step-down triggered</span>],
        ['fallback', 'Fell back', <span><code>opus-4.8</code> → <code>sonnet-4.6</code> · same provider, ~4× cheaper</span>],
        ['guard', 'Guardrails', <span>1 tenant name masked · grounded-only · 0 policy hits</span>],
        ['done', 'Served', <span><code>sonnet-4.6</code> · 4.6k tok · 1.3s · 3 citations</span>],
      ] },
    { t: '09:38', user: 'j.lee', task: 'Compare models', ic: 'scale', req: '3 models', served: '3 models', route: 'mixed', plane: 'mixed', tok: '12.4k', cost: 0.082, status: 'ok',
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
    { t: '08:51', user: 's.kaur', task: 'Chat with docs', ic: 'doc', req: 'sonnet-4.6', served: 'gemma-4-9b', route: 'Ollama', plane: 'local', tok: '4.4k', cost: 0, status: 'free',
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

  // admin operational lens — not a ledger. What's falling back, what's used.
  const EXC_GROUP = [
    { kind: 'Budget step-down', n: 44, tone: 'var(--warning)', ic: 'wallet',  note: 'cap floor → cheaper tier' },
    { kind: 'Free-floor',       n: 18, tone: 'var(--ink-mute)', ic: 'models', note: 'cap exhausted → local model' },
    { kind: 'Policy block',     n: 9,  tone: 'var(--danger)',  ic: 'shield',  note: 'tool / share blocked' },
    { kind: 'Provider failover', n: 3, tone: 'var(--accent)',  ic: 'router',  note: '5xx / timeout → resilience hop' },
  ];
  const USAGE = [
    { id: 'sonnet-4.6',     provider: 'anthropic', share: 52, calls: '1.9k' },
    { id: 'gemini-3-flash', provider: 'google',    share: 23, calls: '840' },
    { id: 'gemma-4-9b',     provider: 'local',     share: 14, calls: '510' },
    { id: 'gpt-5.2',        provider: 'openai',    share: 11, calls: '400' },
  ];

  function prov(id) { const m = modelById(id); return m ? m.provider : 'local'; }
  function execRow(r) { return { local: (r.plane || 'cloud') === 'local', mixed: (r.plane || 'cloud') === 'mixed' }; }
  const DEVICE_OF = { 'a.rao': 'aiko-mbp', 'm.okafor': 'leasing-win', 's.kaur': 'web·chrome', 'j.lee': 'web·chrome', 'm.diaz': 'aiko-mbp', 'ops-bot': 'ops-runner' };
  function spaceOf(r) { return r.task.split(' · ')[1] || 'General'; }
  function ageDays(r) { return /yest/i.test(r.t) ? 1 : 0; }
  const DATE_MAX = { today: 0, '7d': 7, '30d': 30 };

  function WhyPanel({ row }) {
    const ex = execRow(row);
    return (
      <div className="card" style={{ overflow: 'hidden', position: 'sticky', top: 0 }}>
        <div className="card-hd">
          <span className="flex items-center gap-2"><Icon name={row.ic} size={15} tone="soft" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Why this model</span></span>
          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{row.t} · {row.user}</span>
        </div>
        <div className="flex items-center gap-2" style={{ padding: '10px 18px', borderBottom: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Executed</span>
          {ex.mixed
            ? <span className="exec"><Icon name="globe" size={12} tone="mute" /><span>mixed</span><span className="reg">· 2 gateway · 1 on device</span></span>
            : <ExecBadge local={ex.local} region={GATEWAY_REGION} verb />}
          <span className="grow" />
          <span className="mono" style={{ fontSize: 11, color: ex.local ? 'var(--success)' : 'var(--ink-faint)' }}>{ex.local ? 'no external call' : 'egress logged'}</span>
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
    const { ws } = useWorkspace();
    const { meta: env } = useEnv();
    const [flt, setFlt] = useState('all');
    const [q, setQ] = useState('');
    const [msp, setMsp] = useState('all');
    const [mdate, setMdate] = useState('7d');
    const baseRows = mine ? HISTORY.filter((r) => r.user === 'm.okafor') : HISTORY.filter((r) => r.status !== 'ok');
    const listRows = baseRows.filter((r) => (flt === 'all' || r.status === flt) && (!q || (r.user + ' ' + r.req + ' ' + r.served + ' ' + r.task).toLowerCase().includes(q.toLowerCase())) && (!mine || msp === 'all' || spaceOf(r) === msp) && (!mine || ageDays(r) <= (DATE_MAX[mdate] != null ? DATE_MAX[mdate] : 30)));
    const [sel, setSel] = useState(0);
    const cur = listRows[Math.min(sel, listRows.length - 1)] || baseRows[0];
    const PATH = cascadePath(BUDGET_TREE, 'm.okafor') || [];
    const ME = PATH[PATH.length - 1] || { spent: 312, cap: 400, name: 'You' };
    const mePct = Math.round((ME.spent / ME.cap) * 100);
    const meTone = mePct >= 100 ? 'warning' : mePct >= 90 ? 'warning' : 'accent';
    const [reqOpen, setReqOpen] = useState(false);
    const [reqAmt, setReqAmt] = useState(250);
    const [reqReason, setReqReason] = useState('');
    const [reqSent, setReqSent] = useState(() => { try { return JSON.parse(localStorage.getItem('zs-budget-request') || 'null'); } catch (e) { return null; } });
    const sendReq = () => { const r = { amount: reqAmt, reason: reqReason, at: Date.now(), status: 'pending' }; setReqSent(r); try { localStorage.setItem('zs-budget-request', JSON.stringify(r)); } catch (e) {} setReqOpen(false); };
    const withdrawReq = () => { setReqSent(null); try { localStorage.removeItem('zs-budget-request'); } catch (e) {} };

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow={mine ? 'Activity' : 'Usage patterns'} chip={mine ? ws : null}
          title={mine ? 'Your activity' : 'Routing & usage health'} subMax={640}
          sub={mine
            ? 'Every call you made in ' + ws.name + ' — which model actually served it, and exactly why the router chose it. Yours to inspect and export, always.'
            : 'Where the gateway is falling back and what’s being used — with the exceptions worth a look. Who-did-what and policy breaches live in Governance; select an exception to trace it.'}
          actions={<button className="zs-btn zs-btn-secondary"><Icon name="upload" size={14} tone="soft" /> Export · CSV</button>} />


        {mine ? (
          <React.Fragment>
            <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
              <div className="grid-half">
                <div>
                  <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Your monthly ceiling</div>
                  <Meter label="Spent this month" value={ME.spent} max={ME.cap} tone={meTone} display={money(ME.spent, 0) + ' / ' + money(ME.cap, 0)} hint={mePct + '% used · resets 1 May'} />
                  <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                    At 100% the gateway keeps you working on the <b>free local model</b> — never a hard stop. Need more headroom this month?
                  </div>
                  {reqSent ? (
                    <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-3)', padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--accent-soft)', border: '1px solid oklch(0.58 0.15 35 / 0.25)' }}>
                      <Icon name="check" size={15} tone="accent" />
                      <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>Requested <b>+{money(reqSent.amount, 0)}</b> · pending with your Support admin</span>
                      <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={withdrawReq}>Withdraw</button>
                    </div>
                  ) : reqOpen ? (
                    <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}>
                      <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Request a higher ceiling</div>
                      <div className="flex gap-2" style={{ marginBottom: 10 }}>
                        {[100, 250, 500].map((amt) => (
                          <button key={amt} onClick={() => setReqAmt(amt)} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', border: '1px solid ' + (reqAmt === amt ? 'var(--accent)' : 'var(--paper-edge)'), background: reqAmt === amt ? 'var(--accent-soft)' : 'var(--paper)', color: reqAmt === amt ? 'var(--accent)' : 'var(--ink-soft)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>+{money(amt, 0)}</button>
                        ))}
                      </div>
                      <div className="zs-input" style={{ marginBottom: 10 }}><input value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="Reason (optional) — e.g. Q2 reporting push" /></div>
                      <div className="flex gap-2">
                        <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={sendReq}><Icon name="arrow" size={13} tone="paper" /> Send to admin</button>
                        <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setReqOpen(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button className="zs-btn zs-btn-secondary zs-btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setReqOpen(true)}><Icon name="wallet" size={14} tone="soft" /> Request increase</button>
                  )}
                </div>
                <div style={{ borderLeft: '1px solid var(--paper-edge)', paddingLeft: 'var(--space-6)' }}>
                  <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>The budget you cascade from</div>
                  <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
                    {PATH.map((n, i) => {
                      const p = Math.round((n.spent / n.cap) * 100);
                      const last = i === PATH.length - 1;
                      return (
                        <div key={n.name} style={{ paddingLeft: i * 16 }}>
                          <div className="flex items-center gap-2" style={{ marginBottom: 5 }}>
                            <Icon name={n.kind === 'org' ? 'org' : n.kind === 'user' ? 'user' : 'dept'} size={14} tone={last ? 'accent' : 'mute'} />
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: last ? 600 : 500, color: last ? 'var(--ink)' : 'var(--ink-soft)' }}>{n.name}</span>
                            <span className="grow" />
                            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{money(n.spent, 0)} / {money(n.cap, 0)}</span>
                          </div>
                          <div className="meter"><i style={{ width: p + '%', background: last ? 'var(--accent)' : 'var(--ink-mute)' }} /></div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-4)' }}>Your ceiling is carved from Support · set by your admin</div>
                </div>
              </div>
            </div>

            <div className="grid-split">
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-hd" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                  <span className="zs-eyebrow">Your recent calls</span>
                  <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <div className="zs-input" style={{ maxWidth: 160, height: 28 }}><Icon name="search" size={13} tone="mute" /><input placeholder="task, model…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                    {[['all', 'All'], ['ok', 'Served'], ['stepped', 'Stepped'], ['free', 'Free-floor']].map(([k, lab]) => (
                      <button key={k} onClick={() => { setFlt(k); setSel(0); }} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (flt === k ? 'var(--ink)' : 'var(--paper-edge)'), background: flt === k ? 'var(--ink)' : 'var(--paper)', color: flt === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
                    ))}
                    <select value={msp} onChange={(e) => { setMsp(e.target.value); setSel(0); }} title="Filter by space" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-ui)', color: 'var(--ink-soft)', padding: '3px 6px', cursor: 'pointer' }}>
                      {['all', ...new Set(baseRows.map(spaceOf))].map((s) => <option key={s} value={s}>{s === 'all' ? 'All spaces' : s}</option>)}
                    </select>
                    <select value={mdate} onChange={(e) => setMdate(e.target.value)} title="Date range" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-mono)', color: 'var(--ink-soft)', padding: '3px 6px', cursor: 'pointer' }}>
                      {[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {!env.online && <span className="pill" style={{ color: 'var(--warning)', background: 'var(--warning-soft)', borderColor: 'oklch(0.72 0.12 75 / 0.30)' }}><Icon name="bolt" size={12} tone="warning" /> 3 queued</span>}
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl tbl-stack" style={{ '--tbl-min': '640px' }}>
                    <thead><tr><th>Time</th><th>Task</th><th>Requested → Served</th><th className="num">Cost</th><th>Outcome</th><th>Device</th></tr></thead>
                    <tbody>
                      {listRows.map((r, i) => {
                        const st = STATUS[r.status];
                        return (
                          <tr key={i} className={'clickable' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                            <td className="mono" data-th="Time" style={{ color: 'var(--ink-mute)' }}>{r.t}</td>
                            <td>
                              <span className="flex items-center gap-2" style={{ color: 'var(--ink)' }}><Icon name={r.ic} size={13} tone="soft" />{r.task}</span>
                              <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 1 }}>{r.user}</div>
                            </td>
                            <td data-th="Route">
                              <span className="flex items-center gap-2">
                                <span style={{ color: 'var(--ink-mute)' }}>{r.req}</span>
                                <Icon name="arrow" size={12} tone="faint" />
                                <ProviderDot provider={prov(r.served)} size={7} />
                                <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.served}</span>
                              </span>
                              <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
                                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.route} · {r.tok}</span>
                                {r.route === 'mixed'
                                  ? <span className="exec"><Icon name="globe" size={11} tone="mute" /><span>mixed</span></span>
                                  : <ExecBadge local={(r.plane || 'cloud') === 'local'} region={GATEWAY_REGION} />}
                              </div>
                            </td>
                            <td className="num" data-th="Cost" style={{ color: r.cost === 0 ? 'var(--success)' : 'var(--ink)' }}>{r.cost === 0 ? 'free' : money(r.cost, 3)}</td>
                            <td data-th="Outcome"><span className="status" style={{ color: st[1] }}><span className="dot" style={{ background: st[1] }} />{st[0]}</span></td>
                            <td data-th="Device"><span className="flex items-center gap-2" style={{ color: 'var(--ink-mute)' }}><Icon name={(r.plane || 'cloud') === 'local' ? 'models' : 'globe'} size={12} tone="mute" /><span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{DEVICE_OF[r.user] || 'leasing-win'}</span></span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="card-foot dashed" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', fontFamily: 'var(--font-mono)' }}>
                  <span>your spend MTD · <b style={{ color: 'var(--ink)' }}>{money(ME.spent, 0)} of {money(ME.cap, 0)}</b></span>
                  <span>policy hits · <b style={{ color: 'var(--success)' }}>0</b></span>
                  <span>retained · <b style={{ color: 'var(--ink)' }}>24 months</b></span>
                  {!env.online && <span style={{ color: 'var(--warning)' }}>offline · <b>3 calls queued</b> · pending sync</span>}
                </div>
              </div>
              <WhyPanel row={cur} />
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
              {[['Calls · 24h', '3,640', 'across the org'], ['Fallback rate', '2.0%', '74 of 3,640'], ['Step-downs', '44', 'hit a budget floor'], ['Failovers', '3', 'provider 5xx'], ['Avg cost', '$0.028', 'per call · ↓35%']].map(([l, v, s]) => (
                <div key={l} className="card" style={{ padding: 'var(--space-4)' }}>
                  <div className="zs-eyebrow" style={{ marginBottom: 8 }}>{l}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-2xl)', lineHeight: 1, color: 'var(--ink)' }}>{v}</div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 6 }}>{s}</div>
                </div>
              ))}
            </div>

            <div className="grid-split">
              <div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="card-hd">
                    <span className="flex items-center gap-2"><Icon name="routing" size={15} tone="soft" /><span className="zs-eyebrow">What’s falling back · 24h</span></span>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>74 of 3,640 calls</span>
                  </div>
                  <div className="grid-flush-2">
                    {EXC_GROUP.map((g, i) => (
                      <div key={g.kind} className="flex items-center gap-3" style={{ padding: '12px var(--space-5)', borderRight: i % 2 === 0 ? '1px solid var(--paper-edge)' : 'none', borderBottom: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                        <Icon name={g.ic} size={16} tone="soft" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{g.kind}</div>
                          <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{g.note}</div>
                        </div>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-xl)', color: g.tone }}>{g.n}</span>
                      </div>
                    ))}
                  </div>
                  <div className="card-hd" style={{ borderTop: '1px solid var(--paper-edge)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    <span className="zs-eyebrow">Instances worth a look</span>
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <div className="zs-input" style={{ maxWidth: 190, height: 28 }}><Icon name="search" size={13} tone="mute" /><input placeholder="user, model, task…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                      {[['all', 'All'], ['stepped', 'Step-downs'], ['resilience', 'Failovers'], ['free', 'Free-floor']].map(([k, lab]) => (
                        <button key={k} onClick={() => { setFlt(k); setSel(0); }} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500,
                          border: '1px solid ' + (flt === k ? 'var(--ink)' : 'var(--paper-edge)'), background: flt === k ? 'var(--ink)' : 'var(--paper)', color: flt === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
                      ))}
                      <select onChange={(e) => { if (e.target.value) { setFlt(e.target.value); setSel(0); } }} value="" title="Saved views"
                        style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper-soft)', font: '500 11px var(--font-mono)', color: 'var(--ink-soft)', padding: '4px 7px', cursor: 'pointer' }}>
                        <option value="">Saved views ▾</option>
                        <option value="stepped">Budget step-downs</option>
                        <option value="resilience">Provider failovers</option>
                        <option value="free">Free-floor calls</option>
                        <option value="all">Everything</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    {listRows.length === 0 && <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 'var(--text-sm)' }}>No calls match this view.</div>}
                    {listRows.map((r, i) => {
                      const st = STATUS[r.status];
                      return (
                        <button key={i} onClick={() => setSel(i)} className="flex items-center gap-3" style={{ width: '100%', textAlign: 'left', padding: '11px var(--space-5)', borderBottom: i < listRows.length - 1 ? '1px solid var(--paper-edge)' : 'none', background: i === sel ? 'var(--paper-mute)' : 'transparent' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: st[1] }} />
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 42 }}>{r.t}</span>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', width: 62 }}>{r.user}</span>
                          <span className="flex items-center gap-2" style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)' }}>
                            <span style={{ color: 'var(--ink-mute)' }}>{r.req}</span>
                            <Icon name="arrow" size={11} tone="faint" />
                            <ProviderDot provider={prov(r.served)} size={6} />
                            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.served}</span>
                          </span>
                          <span className="status" style={{ color: st[1], fontSize: 11, flexShrink: 0 }}>{st[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Healthy calls aren’t listed — only routing exceptions. For who-accessed-what and policy breaches, see <b style={{ color: 'var(--ink)' }}>Governance</b>.</span></div>
                </div>

                <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
                  <div className="card-hd"><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">What’s being used · 24h</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>3,640 calls</span></div>
                  <div style={{ padding: '8px 20px 16px' }}>
                    {USAGE.map((m) => (
                      <div key={m.id} className="flex items-center gap-3" style={{ padding: '10px 0', borderBottom: '1px solid var(--paper-edge)' }}>
                        <ProviderDot provider={m.provider} size={8} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', width: 130 }}>{m.id}</span>
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: m.share + '%', background: 'var(--ink-mute)' }} /></div>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 56, textAlign: 'right' }}>{m.calls} · {m.share}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <WhyPanel row={cur} />
            </div>
          </React.Fragment>
        )}
      </div>
    );
  }

  window.RequestsView = RequestsView;
})();
