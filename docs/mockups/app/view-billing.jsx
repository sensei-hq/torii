/* Seiki · view-billing.jsx
   Budgets & billing — the org → dept → user spend tree plus the license summary.
   Reuses StrategosData.BUDGET_TREE so the numbers match the rest of the gateway. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, ProviderDot, PageHeader } = window.StrategosUI;
  const { BUDGET_TREE, money } = window.StrategosData;
  const { useState } = React;

  const SEATS0 = [
    { user: 'a.rao', role: 'Admin', last: 'now', active: true },
    { user: 'm.okafor', role: 'Viewer', last: '3m', active: true },
    { user: 's.kaur', role: 'Editor', last: '2h', active: true },
    { user: 't.bauer', role: 'Viewer', last: '21d', active: true },
    { user: 'j.lee', role: 'Viewer', last: '3mo', active: true },
  ];
  const PROVIDER_SPEND = [['anthropic', 14200], ['openai', 6100], ['google', 3400], ['meta', 1200], ['local', 0]];
  const MODEL_SPEND = [['sonnet-4.6', 'anthropic', 9800], ['opus-4.8', 'anthropic', 4400], ['gpt-5.2', 'openai', 6100], ['gemini-3-pro', 'google', 3400], ['llama-4-405b', 'meta', 1200], ['gemma-4-9b', 'local', 0]];

  const KIND_IC = { org: 'org', dept: 'dept', user: 'user' };

  // flatten the tree into indented rows for a single hairline table
  function flatten(node, depth, out) {
    out.push({ node, depth });
    (node.children || []).forEach((c) => flatten(c, depth + 1, out));
    return out;
  }

  function pctTone(p) {
    if (p >= 0.9) return 'var(--accent)';
    if (p >= 0.75) return 'var(--warning)';
    return 'var(--ink-mute)';
  }

  const INVOICES = [
    ['Apr 2026', 'Platform license · 142 seats', 4260, 'open'],
    ['Mar 2026', 'Platform license · 138 seats', 4140, 'paid'],
    ['Mar 2026', 'Usage overage · routing', 318, 'paid'],
    ['Feb 2026', 'Platform license · 138 seats', 4140, 'paid'],
  ];

  function BillingView() {
    const rows = flatten(BUDGET_TREE, 0, []);
    const spent = BUDGET_TREE.spent, cap = BUDGET_TREE.cap;
    const [req, setReq] = useState(() => { try { return JSON.parse(localStorage.getItem('zs-budget-request') || 'null'); } catch (e) { return null; } });
    const resolveReq = (status) => { setReq((r) => { const n = r ? Object.assign({}, r, { status }) : r; try { localStorage.setItem('zs-budget-request', JSON.stringify(n)); } catch (e) {} return n; }); };
    const orgPct = spent / cap;
    const [caps, setCaps] = useState(() => [{ name: BUDGET_TREE.name, type: 'hard', alert: 85, floor: true }, ...BUDGET_TREE.children.map((c) => ({ name: c.name, type: c.name === 'Support' ? 'soft' : 'hard', alert: 90, floor: true }))]);
    const setCap = (i, patch) => setCaps((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    const [overage, setOverage] = useState('floor');
    const [seats, setSeats] = useState(SEATS0);
    const reclaimed = seats.filter((s) => !s.active).length;
    const seatsUsed = 142 - reclaimed;
    const provTotal = PROVIDER_SPEND.reduce((s, p) => s + p[1], 0) || 1;
    const numInp = { width: 52, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '3px 6px', textAlign: 'right' };

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Billing" title="Budgets & billing" subMax={640}
          sub="One license, governed like thousands. Caps cascade from the org down to each member; spend is metered on every call through the gateway."
          actions={<><button className="zs-btn zs-btn-secondary"><Icon name="upload" size={14} tone="soft" /> Export usage</button><Pill icon="check" kind="success">on plan</Pill></>} />

        {/* plan summary */}
        <div className="grid-stats">
          {[
            { l: 'Plan', v: 'Enterprise', s: 'annual · auto-renew' },
            { l: 'Seats', v: '142', s: 'of 150 licensed' },
            { l: 'This month', v: money(spent, 0), s: 'of ' + money(cap, 0) + ' cap' },
            { l: 'Next invoice', v: '1 May', s: money(4260, 0) + ' · 142 seats' },
          ].map((x) => (
            <div key={x.l} className="card stat" style={{ minWidth: 0 }}>
              <div className="zs-eyebrow" style={{ marginBottom: 10 }}>{x.l}</div>
              <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-2xl)', lineHeight: 1.05, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{x.v}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 8 }}>{x.s}</div>
            </div>
          ))}
        </div>

        {req && (
          <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)', borderColor: req.status === 'pending' ? 'var(--accent)' : 'var(--paper-edge)' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="accent" /><span className="zs-eyebrow">Pending budget requests</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>from members</span></div>
            <div className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)' }}>
              <span className="ava" style={{ width: 30, height: 30 }}>M</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}><b>m.okafor</b> requested <b>+{money(req.amount, 0)}</b> monthly headroom{req.reason ? ' — “' + req.reason + '”' : ''}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>Support · Leasing · current cap {money(700, 0)}/mo</div>
              </div>
              {req.status === 'pending'
                ? <React.Fragment><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => resolveReq('rejected')}>Reject</button><button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => resolveReq('approved')}><Icon name="check" size={13} tone="paper" /> Approve</button></React.Fragment>
                : <span className="status" style={{ color: req.status === 'approved' ? 'var(--success)' : 'var(--ink-mute)' }}><span className="dot" style={{ background: req.status === 'approved' ? 'var(--success)' : 'var(--ink-faint)' }} />{req.status}</span>}
            </div>
            <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Approving raises the member’s node cap in the hierarchy; the member is notified. Requests come from <b>Activity → Request increase</b>.</span></div>
          </div>
        )}

        <div className="grid-split" style={{ marginTop: 'var(--space-5)' }}>
          {/* budget tree */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd">
              <span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="soft" /><span className="zs-eyebrow">Budget tree</span></span>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{Math.round(orgPct * 100)}% of org cap</span>
            </div>
            <table className="tbl tbl-stack">
              <thead><tr><th>Scope</th><th className="num">Spent</th><th className="num">Cap</th><th style={{ width: 150 }}>Used</th></tr></thead>
              <tbody>
                {rows.map(({ node, depth }) => {
                  const p = node.spent / node.cap;
                  return (
                    <tr key={node.name + depth}>
                      <td style={{ color: 'var(--ink)', fontWeight: depth === 0 ? 600 : 500 }}>
                        <span className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
                          <Icon name={KIND_IC[node.kind]} size={14} tone={depth === 0 ? 'accent' : 'mute'} />
                          {node.name}
                        </span>
                      </td>
                      <td className="num" data-th="Spent">{money(node.spent, 0)}</td>
                      <td className="num" data-th="Cap" style={{ color: 'var(--ink-mute)' }}>{money(node.cap, 0)}</td>
                      <td data-th="Used">
                        <div className="flex items-center gap-2">
                          <div className="track" style={{ flex: 1 }}><i style={{ width: Math.min(100, p * 100) + '%', background: pctTone(p) }} /></div>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: pctTone(p), width: 30, textAlign: 'right' }}>{Math.round(p * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Hard caps block at the limit; soft caps warn and keep serving. When a hard cap is exhausted, routing steps down to the free floor automatically.</span></div>
          </div>

          {/* invoices */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd">
              <span className="flex items-center gap-2"><Icon name="doc" size={15} tone="soft" /><span className="zs-eyebrow">Invoices</span></span>
              <button className="zs-btn zs-btn-secondary" style={{ height: 28, fontSize: 12 }}><Icon name="upload" size={13} tone="soft" /> Export</button>
            </div>
            <div style={{ padding: '4px 0' }}>
              {INVOICES.map((iv, i) => (
                <div key={i} className="flex items-center gap-3" style={{ padding: '11px var(--space-5)', borderBottom: i < INVOICES.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>{iv[1]}</div>
                    <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{iv[0]}</div>
                  </div>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>{money(iv[2], 0)}</span>
                  <span className={'clf ' + (iv[3] === 'paid' ? 'clf-public' : 'clf-confidential')} style={{ minWidth: 52, justifyContent: 'center' }}><span className="d" />{iv[3]}</span>
                </div>
              ))}
            </div>
            <div className="card-foot"><Icon name="wallet" size={13} tone="mute" /><span>Visa ending 4218 · billed in USD</span></div>
          </div>
        </div>

        {/* cost breakdown by provider & model */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="soft" /><span className="zs-eyebrow">Cost breakdown · 30d</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{money(provTotal, 0)} metered</span></div>
          <div className="grid-half">
            <div style={{ padding: 'var(--space-5)', borderRight: '1px solid var(--paper-edge)' }}>
              <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>By provider</div>
              <div style={{ display: 'flex', height: 10, borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
                {PROVIDER_SPEND.filter((p) => p[1] > 0).map(([prov, amt]) => <div key={prov} title={prov} style={{ width: (amt / provTotal) * 100 + '%', background: window.StrategosData.PROVIDER_HUE[prov] }} />)}
              </div>
              <div className="flex flex-col gap-2">
                {PROVIDER_SPEND.map(([prov, amt]) => (
                  <div key={prov} className="flex items-center gap-2">
                    <ProviderDot provider={prov} size={8} />
                    <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)', textTransform: 'capitalize' }}>{prov}</span>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: amt === 0 ? 'var(--success)' : 'var(--ink-mute)' }}>{amt === 0 ? 'free' : money(amt, 0)} · {Math.round((amt / provTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: 'var(--space-5)' }}>
              <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>By model</div>
              <div className="flex flex-col gap-2">
                {MODEL_SPEND.map(([id, prov, amt]) => (
                  <div key={id} className="flex items-center gap-3">
                    <ProviderDot provider={prov} size={7} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', width: 120 }}>{id}</span>
                    <div className="meter" style={{ flex: 1 }}><i style={{ width: (amt / provTotal) * 100 + '%', background: 'var(--ink-mute)' }} /></div>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 52, textAlign: 'right' }}>{amt === 0 ? 'free' : money(amt, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* cap policy & overage — read-only mirror; edited per node in Organization */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Cap policy</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>set per node in Organization</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '640px' }}>
              <thead><tr><th>Scope</th><th>Cap type</th><th className="num">Alert at</th><th>Free floor</th></tr></thead>
              <tbody>
                {caps.map((c, i) => (
                  <tr key={c.name}>
                    <td style={{ color: 'var(--ink)', fontWeight: i === 0 ? 600 : 500 }}><span className="flex items-center gap-2"><Icon name={i === 0 ? 'org' : 'dept'} size={14} tone={i === 0 ? 'accent' : 'mute'} />{c.name}</span></td>
                    <td data-th="Cap type">
                      <span className="tag" style={{ textTransform: 'capitalize', color: c.type === 'soft' ? 'var(--warning)' : 'var(--ink)' }}>{c.type}</span>
                    </td>
                    <td className="num" data-th="Alert at"><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{c.alert}%</span></td>
                    <td data-th="Free floor"><span className="status" style={{ color: c.floor ? 'var(--success)' : 'var(--ink-faint)' }}><span className="dot" style={{ background: c.floor ? 'var(--success)' : 'var(--ink-faint)' }} />{c.floor ? 'on' : 'off'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed" style={{ justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <span className="flex items-center gap-2"><Icon name="info" size={14} tone="mute" /><span>Cap type, alert threshold and free-floor are set <b>per node</b> in <b style={{ color: 'var(--ink)' }}>Organization → Hierarchy &amp; budgets</b>. When a <b>hard</b> cap is exhausted —</span></span>
            <select value={overage} onChange={(e) => setOverage(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 8px', cursor: 'pointer' }}>
              {[['floor', 'Step down to the free floor'], ['block', 'Block new calls'], ['notify', 'Allow overage + notify owner']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* seat management */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="team" size={15} tone="soft" /><span className="zs-eyebrow">Seats</span></span><span className="flex items-center gap-3"><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{seatsUsed} of 150 assigned</span><button className="zs-btn zs-btn-secondary" style={{ height: 28, fontSize: 12 }}><Icon name="plus" size={13} tone="soft" /> Assign seat</button></span></div>
          <div style={{ padding: 'var(--space-4) var(--space-5) 0' }}>
            <div className="track" style={{ height: 8 }}><i style={{ width: (seatsUsed / 150) * 100 + '%', background: 'var(--accent)' }} /></div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 6 }}>{150 - seatsUsed} free · idle seats can be reclaimed</div>
          </div>
          <div style={{ padding: '8px 0 4px' }}>
            {seats.map((s, i) => {
              const idle = /d|mo/.test(s.last) && s.active;
              return (
                <div key={s.user} className="flex items-center gap-3" style={{ padding: '9px var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: s.active ? 1 : 0.5 }}>
                  <span className="ava" style={{ width: 26, height: 26 }}>{s.user[0].toUpperCase()}</span>
                  <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{s.user}</span>
                  <span className="dtag">{s.role}</span>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: idle ? 'var(--warning)' : 'var(--ink-mute)', width: 54, textAlign: 'right' }}>{s.last}</span>
                  {s.active
                    ? <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setSeats((ss) => ss.map((x, j) => (j === i ? { ...x, active: false } : x)))}><Icon name="logout" size={12} tone="soft" /> Reclaim</button>
                    : <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setSeats((ss) => ss.map((x, j) => (j === i ? { ...x, active: true } : x)))}>Restore</button>}
                </div>
              );
            })}
          </div>
          <div className="card-foot dashed"><Icon name="keys" size={14} tone="mute" /><span>Programmatic identities don’t consume seats — manage those in <b style={{ color: 'var(--ink)' }}>API identities</b>. Reclaiming a seat signs the member out and frees the license.</span></div>
        </div>
      </div>
    );
  }

  window.BillingView = BillingView;
})();
