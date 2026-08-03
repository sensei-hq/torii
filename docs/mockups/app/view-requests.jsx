/* Torii · view-requests.jsx — interaction ledger + "why this model" trace. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, CardHead, ViewPad, Half, Split, Pill, CardFoot, Stats, Button, Table, ProviderDot, ExecBadge, Meter, useEnv, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { modelById, money, GATEWAY_REGION, BUDGET_TREE } = window.StrategosAPI;
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

  const { STATUS, NODE_ICON, NODE_TONE, EXC_GROUP, USAGE, DEVICE_OF, DATE_MAX } = window.StrategosAPI.content.requests;

  // admin operational lens — not a ledger. What's falling back, what's used.

  function prov(id) { const m = modelById(id); return m ? m.provider : 'local'; }
  function execRow(r) { return { local: (r.plane || 'cloud') === 'local', mixed: (r.plane || 'cloud') === 'mixed' }; }
  function spaceOf(r) { return r.task.split(' · ')[1] || 'General'; }
  function ageDays(r) { return /yest/i.test(r.t) ? 1 : 0; }

  function WhyPanel({ row }) {
    const ex = execRow(row);
    return (
      <Card className="overflow-hidden sticky" style={{ top: 0 }}>
        <CardHead>
          <span className="flex items-center gap-2"><Icon name={row.ic} size={15} tone="soft" /><span className="text-sm font-semibold">Why this model</span></span>
          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{row.t} · {row.user}</span>
        </CardHead>
        <div className="flex items-center gap-2 py-2.5 px-4 border-b bg-paper-soft">
          <span className="text-[11px] tracking-[0.04em] uppercase text-ink-mute">Executed</span>
          {ex.mixed
            ? <span className="exec"><Icon name="globe" size={12} tone="mute" /><span>mixed</span><span className="reg">· 2 gateway · 1 on device</span></span>
            : <ExecBadge local={ex.local} region={GATEWAY_REGION} verb />}
          <span className="flex-1" />
          <span className="mono" style={{ fontSize: 11, color: ex.local ? 'var(--success)' : 'var(--ink-faint)' }}>{ex.local ? 'no external call' : 'egress logged'}</span>
        </div>
        <div className="py-4 px-4">
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
      </Card>
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
      <ViewPad wide className="rise">
        <PageHeader eyebrow={mine ? 'Activity' : 'Usage patterns'} chip={mine ? ws : null}
          title={mine ? 'Your activity' : 'Routing & usage health'} subMax={640}
          sub={mine
            ? 'Every call you made in ' + ws.name + ' — which model actually served it, and exactly why the router chose it. Yours to inspect and export, always.'
            : 'Where the gateway is falling back and what’s being used — with the exceptions worth a look. Who-did-what and policy breaches live in Governance; select an exception to trace it.'}
          actions={<Button variant="secondary"><Icon name="upload" size={14} tone="soft" /> Export · CSV</Button>} />

        {mine ? (
          <React.Fragment>
            <Card className="p-6 mb-6">
              <Half>
                <div>
                  <div className="zs-eyebrow mb-3">Your monthly ceiling</div>
                  <Meter label="Spent this month" value={ME.spent} max={ME.cap} tone={meTone} display={money(ME.spent, 0) + ' / ' + money(ME.cap, 0)} hint={mePct + '% used · resets 1 May'} />
                  <div className="mt-3 text-sm text-ink-soft leading-[1.5]">
                    At 100% the gateway keeps you working on the <b>free local model</b> — never a hard stop. Need more headroom this month?
                  </div>
                  {reqSent ? (
                    <div className="flex items-center gap-2 mt-3 py-2.5 px-3 rounded bg-accent-soft border border-[oklch(0.58_0.15_35_/_0.25)]">
                      <Icon name="check" size={15} tone="accent" />
                      <span className="flex-1 text-sm text-ink">Requested <b>+{money(reqSent.amount, 0)}</b> · pending with your Support admin</span>
                      <Button variant="ghost" size="sm" onClick={withdrawReq}>Withdraw</Button>
                    </div>
                  ) : reqOpen ? (
                    <div className="mt-3 p-4 rounded border bg-paper-soft">
                      <div className="zs-eyebrow mb-2">Request a higher ceiling</div>
                      <div className="flex gap-2 mb-2.5">
                        {[100, 250, 500].map((amt) => (
                          <button key={amt} onClick={() => setReqAmt(amt)} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', border: '1px solid ' + (reqAmt === amt ? 'var(--accent)' : 'var(--paper-edge)'), background: reqAmt === amt ? 'var(--accent-soft)' : 'var(--paper)', color: reqAmt === amt ? 'var(--accent)' : 'var(--ink-soft)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>+{money(amt, 0)}</button>
                        ))}
                      </div>
                      <div className="zs-input mb-2.5"><input value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="Reason (optional) — e.g. Q2 reporting push" /></div>
                      <div className="flex gap-2">
                        <Button variant="primary" size="sm" onClick={sendReq}><Icon name="arrow" size={13} tone="paper" /> Send to admin</Button>
                        <Button variant="ghost" size="sm" onClick={() => setReqOpen(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button className="mt-3" variant="secondary" size="sm" onClick={() => setReqOpen(true)}><Icon name="wallet" size={14} tone="soft" /> Request increase</Button>
                  )}
                </div>
                <div className="border-l pl-8">
                  <div className="zs-eyebrow mb-3">The budget you cascade from</div>
                  <div className="flex flex-col gap-4">
                    {PATH.map((n, i) => {
                      const p = Math.round((n.spent / n.cap) * 100);
                      const last = i === PATH.length - 1;
                      return (
                        <div key={n.name} style={{ paddingLeft: i * 16 }}>
                          <div className="flex items-center gap-2 mb-1">
                            <Icon name={n.kind === 'org' ? 'org' : n.kind === 'user' ? 'user' : 'dept'} size={14} tone={last ? 'accent' : 'mute'} />
                            <span className="text-sm" style={{ fontWeight: last ? 600 : 500, color: last ? 'var(--ink)' : 'var(--ink-soft)' }}>{n.name}</span>
                            <span className="flex-1" />
                            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{money(n.spent, 0)} / {money(n.cap, 0)}</span>
                          </div>
                          <div className="meter"><i style={{ width: p + '%', background: last ? 'var(--accent)' : 'var(--ink-mute)' }} /></div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: '16px' }}>Your ceiling is carved from Support · set by your admin</div>
                </div>
              </Half>
            </Card>

            <Split>
              <Card className="overflow-hidden">
                <CardHead className="flex-wrap gap-3">
                  <span className="zs-eyebrow">Your recent calls</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="zs-input max-w-[160px] h-[28px]"><Icon name="search" size={13} tone="mute" /><input placeholder="task, model…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                    {[['all', 'All'], ['ok', 'Served'], ['stepped', 'Stepped'], ['free', 'Free-floor']].map(([k, lab]) => (
                      <button key={k} onClick={() => { setFlt(k); setSel(0); }} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (flt === k ? 'var(--ink)' : 'var(--paper-edge)'), background: flt === k ? 'var(--ink)' : 'var(--paper)', color: flt === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
                    ))}
                    <select value={msp} onChange={(e) => { setMsp(e.target.value); setSel(0); }} title="Filter by space" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-ui)', color: 'var(--ink-soft)', padding: '3px 6px', cursor: 'pointer' }}>
                      {['all', ...new Set(baseRows.map(spaceOf))].map((s) => <option key={s} value={s}>{s === 'all' ? 'All spaces' : s}</option>)}
                    </select>
                    <select value={mdate} onChange={(e) => setMdate(e.target.value)} title="Date range" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-mono)', color: 'var(--ink-soft)', padding: '3px 6px', cursor: 'pointer' }}>
                      {[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {!env.online && <Pill className="text-warning bg-warning-soft border-[oklch(0.72_0.12_75_/_0.30)]"><Icon name="bolt" size={12} tone="warning" /> 3 queued</Pill>}
                  </div>
                </CardHead>
                <div className="overflow-x-auto">
                  <Table min={640}>
                    <thead><tr><th>Time</th><th>Task</th><th>Requested → Served</th><th className="num">Cost</th><th>Outcome</th><th>Device</th></tr></thead>
                    <tbody>
                      {listRows.map((r, i) => {
                        const st = STATUS[r.status];
                        return (
                          <tr key={i} className={'clickable' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                            <td className="mono" data-th="Time" style={{ color: 'var(--ink-mute)' }}>{r.t}</td>
                            <td>
                              <span className="flex items-center gap-2 text-ink"><Icon name={r.ic} size={13} tone="soft" />{r.task}</span>
                              <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 1 }}>{r.user}</div>
                            </td>
                            <td data-th="Route">
                              <span className="flex items-center gap-2">
                                <span className="text-ink-mute">{r.req}</span>
                                <Icon name="arrow" size={12} tone="faint" />
                                <ProviderDot provider={prov(r.served)} size={7} />
                                <span className="text-ink font-semibold">{r.served}</span>
                              </span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.route} · {r.tok}</span>
                                {r.route === 'mixed'
                                  ? <span className="exec"><Icon name="globe" size={11} tone="mute" /><span>mixed</span></span>
                                  : <ExecBadge local={(r.plane || 'cloud') === 'local'} region={GATEWAY_REGION} />}
                              </div>
                            </td>
                            <td className="num" data-th="Cost" style={{ color: r.cost === 0 ? 'var(--success)' : 'var(--ink)' }}>{r.cost === 0 ? 'free' : money(r.cost, 3)}</td>
                            <td data-th="Outcome"><span className="status" style={{ color: st[1] }}><span className="dot" style={{ background: st[1] }} />{st[0]}</span></td>
                            <td data-th="Device"><span className="flex items-center gap-2 text-ink-mute"><Icon name={(r.plane || 'cloud') === 'local' ? 'models' : 'globe'} size={12} tone="mute" /><span className="mono" style={{ fontSize: 'var(--text-xs)' }}>{DEVICE_OF[r.user] || 'leasing-win'}</span></span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
                <CardFoot dashed className="gap-6 flex-wrap font-mono">
                  <span>your spend MTD · <b style={{ color: 'var(--ink)' }}>{money(ME.spent, 0)} of {money(ME.cap, 0)}</b></span>
                  <span>policy hits · <b style={{ color: 'var(--success)' }}>0</b></span>
                  <span>retained · <b style={{ color: 'var(--ink)' }}>24 months</b></span>
                  {!env.online && <span className="text-warning">offline · <b>3 calls queued</b> · pending sync</span>}
                </CardFoot>
              </Card>
              <WhyPanel row={cur} />
            </Split>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <Stats className="mb-6">
              {[['Calls · 24h', '3,640', 'across the org'], ['Fallback rate', '2.0%', '74 of 3,640'], ['Step-downs', '44', 'hit a budget floor'], ['Failovers', '3', 'provider 5xx'], ['Avg cost', '$0.028', 'per call · ↓35%']].map(([l, v, s]) => (
                <Card className="p-4" key={l}>
                  <div className="zs-eyebrow mb-2">{l}</div>
                  <div className="font-display font-light text-2xl leading-[1] text-ink">{v}</div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 6 }}>{s}</div>
                </Card>
              ))}
            </Stats>

            <Split>
              <div>
                <Card className="overflow-hidden">
                  <CardHead>
                    <span className="flex items-center gap-2"><Icon name="routing" size={15} tone="soft" /><span className="zs-eyebrow">What’s falling back · 24h</span></span>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>74 of 3,640 calls</span>
                  </CardHead>
                  <div className="grid-flush-2">
                    {EXC_GROUP.map((g, i) => (
                      <div key={g.kind} className="flex items-center gap-3 py-3 px-6" style={{ borderRight: i % 2 === 0 ? '1px solid var(--paper-edge)' : 'none', borderBottom: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                        <Icon name={g.ic} size={16} tone="soft" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-ink">{g.kind}</div>
                          <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{g.note}</div>
                        </div>
                        <span className="font-display font-light text-xl" style={{ color: g.tone }}>{g.n}</span>
                      </div>
                    ))}
                  </div>
                  <CardHead className="border-t flex-wrap gap-3">
                    <span className="zs-eyebrow">Instances worth a look</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="zs-input max-w-[190px] h-[28px]"><Icon name="search" size={13} tone="mute" /><input placeholder="user, model, task…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
                  </CardHead>
                  <div>
                    {listRows.length === 0 && <div className="p-8 text-center text-ink-mute text-sm">No calls match this view.</div>}
                    {listRows.map((r, i) => {
                      const st = STATUS[r.status];
                      return (
                        <button key={i} onClick={() => setSel(i)} className="flex items-center gap-3" style={{ width: '100%', textAlign: 'left', padding: '11px 24px', borderBottom: i < listRows.length - 1 ? '1px solid var(--paper-edge)' : 'none', background: i === sel ? 'var(--paper-mute)' : 'transparent' }}>
                          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: st[1] }} />
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 42 }}>{r.t}</span>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', width: 62 }}>{r.user}</span>
                          <span className="flex items-center gap-2 flex-1 min-w-0 text-sm">
                            <span className="text-ink-mute">{r.req}</span>
                            <Icon name="arrow" size={11} tone="faint" />
                            <ProviderDot provider={prov(r.served)} size={6} />
                            <span className="text-ink font-semibold">{r.served}</span>
                          </span>
                          <span className="status text-[11px] shrink-0" style={{ color: st[1]}}>{st[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Healthy calls aren’t listed — only routing exceptions. For who-accessed-what and policy breaches, see <b style={{ color: 'var(--ink)' }}>Governance</b>.</span></CardFoot>
                </Card>

                <Card className="overflow-hidden mt-6">
                  <CardHead><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">What’s being used · 24h</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>3,640 calls</span></CardHead>
                  <div className="pt-2 px-5 pb-4">
                    {USAGE.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 py-2.5 px-0 border-b">
                        <ProviderDot provider={m.provider} size={8} />
                        <span className="font-mono text-sm font-semibold text-ink w-[130px]">{m.id}</span>
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: m.share + '%', background: 'var(--ink-mute)' }} /></div>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 56, textAlign: 'right' }}>{m.calls} · {m.share}%</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
              <WhyPanel row={cur} />
            </Split>
          </React.Fragment>
        )}
      </ViewPad>
    );
  }

  window.RequestsView = RequestsView;
})();
