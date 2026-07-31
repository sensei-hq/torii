/* Seiki · view-billing.jsx
   Budgets & billing — the org → dept → user spend tree plus the license summary.
   Reuses StrategosData.BUDGET_TREE so the numbers match the rest of the gateway. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Stats, Card, CardHead, CardFoot, Split, Half, Tag, Button, Table, Pill, Switch, ProviderDot, PageHeader } = window.StrategosUI;
  const { BUDGET_TREE, money } = window.StrategosAPI;
  const { useState } = React;

  const { SEATS0, PROVIDER_SPEND, MODEL_SPEND, KIND_IC, INVOICES } = window.StrategosAPI.content.billing;

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
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Billing" title="Budgets & billing" subMax={640}
          sub="One license, governed like thousands. Caps cascade from the org down to each member; spend is metered on every call through the gateway."
          actions={<><Button variant="secondary"><Icon name="upload" size={14} tone="soft" /> Export usage</Button><Pill icon="check" kind="success">on plan</Pill></>} />

        {/* plan summary */}
        <Stats>
          {[
            { l: 'Plan', v: 'Enterprise', s: 'annual · auto-renew' },
            { l: 'Seats', v: '142', s: 'of 150 licensed' },
            { l: 'This month', v: money(spent, 0), s: 'of ' + money(cap, 0) + ' cap' },
            { l: 'Next invoice', v: '1 May', s: money(4260, 0) + ' · 142 seats' },
          ].map((x) => (
            <Card className="stat min-w-0" key={x.l}>
              <div className="zs-eyebrow mb-2.5">{x.l}</div>
              <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-2xl)', lineHeight: 1.05, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{x.v}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 8 }}>{x.s}</div>
            </Card>
          ))}
        </Stats>

        {req && (
          <Card className="overflow-hidden mt-6" style={{ borderColor: req.status === 'pending' ? 'var(--accent)' : 'var(--paper-edge)' }}>
            <CardHead><span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="accent" /><span className="zs-eyebrow">Pending budget requests</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>from members</span></CardHead>
            <div className="flex items-center gap-3 py-4 px-6">
              <span className="ava w-[30px] h-[30px]">M</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink"><b>m.okafor</b> requested <b>+{money(req.amount, 0)}</b> monthly headroom{req.reason ? ' — “' + req.reason + '”' : ''}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>Support · Leasing · current cap {money(700, 0)}/mo</div>
              </div>
              {req.status === 'pending'
                ? <React.Fragment><Button variant="ghost" size="sm" onClick={() => resolveReq('rejected')}>Reject</Button><Button variant="primary" size="sm" onClick={() => resolveReq('approved')}><Icon name="check" size={13} tone="paper" /> Approve</Button></React.Fragment>
                : <span className="status" style={{ color: req.status === 'approved' ? 'var(--success)' : 'var(--ink-mute)' }}><span className="dot" style={{ background: req.status === 'approved' ? 'var(--success)' : 'var(--ink-faint)' }} />{req.status}</span>}
            </div>
            <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Approving raises the member’s node cap in the hierarchy; the member is notified. Requests come from <b>Activity → Request increase</b>.</span></CardFoot>
          </Card>
        )}

        <Split className="mt-6">
          {/* budget tree */}
          <Card className="overflow-hidden">
            <CardHead>
              <span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="soft" /><span className="zs-eyebrow">Budget tree</span></span>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{Math.round(orgPct * 100)}% of org cap</span>
            </CardHead>
            <Table>
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
            </Table>
            <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Hard caps block at the limit; soft caps warn and keep serving. When a hard cap is exhausted, routing steps down to the free floor automatically.</span></CardFoot>
          </Card>

          {/* invoices */}
          <Card className="overflow-hidden">
            <CardHead>
              <span className="flex items-center gap-2"><Icon name="doc" size={15} tone="soft" /><span className="zs-eyebrow">Invoices</span></span>
              <Button className="h-[28px] text-[12px]" variant="secondary"><Icon name="upload" size={13} tone="soft" /> Export</Button>
            </CardHead>
            <div className="py-1 px-0">
              {INVOICES.map((iv, i) => (
                <div key={i} className="flex items-center gap-3 py-3 px-6" style={{ borderBottom: i < INVOICES.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink">{iv[1]}</div>
                    <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{iv[0]}</div>
                  </div>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>{money(iv[2], 0)}</span>
                  <span className={'clf ' + (iv[3] === 'paid' ? 'clf-public' : 'clf-confidential') + ' min-w-[52px] justify-center'}><span className="d" />{iv[3]}</span>
                </div>
              ))}
            </div>
            <CardFoot><Icon name="wallet" size={13} tone="mute" /><span>Visa ending 4218 · billed in USD</span></CardFoot>
          </Card>
        </Split>

        {/* cost breakdown by provider & model */}
        <Card className="overflow-hidden mt-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="soft" /><span className="zs-eyebrow">Cost breakdown · 30d</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{money(provTotal, 0)} metered</span></CardHead>
          <Half>
            <div className="p-6 border-r">
              <div className="zs-eyebrow mb-3">By provider</div>
              <div className="flex h-[10px] rounded-full overflow-hidden mb-4">
                {PROVIDER_SPEND.filter((p) => p[1] > 0).map(([prov, amt]) => <div key={prov} title={prov} style={{ width: (amt / provTotal) * 100 + '%', background: window.StrategosAPI.PROVIDER_HUE[prov] }} />)}
              </div>
              <div className="flex flex-col gap-2">
                {PROVIDER_SPEND.map(([prov, amt]) => (
                  <div key={prov} className="flex items-center gap-2">
                    <ProviderDot provider={prov} size={8} />
                    <span className="flex-1 text-sm text-ink" style={{ textTransform: 'capitalize' }}>{prov}</span>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: amt === 0 ? 'var(--success)' : 'var(--ink-mute)' }}>{amt === 0 ? 'free' : money(amt, 0)} · {Math.round((amt / provTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6">
              <div className="zs-eyebrow mb-3">By model</div>
              <div className="flex flex-col gap-2">
                {MODEL_SPEND.map(([id, prov, amt]) => (
                  <div key={id} className="flex items-center gap-3">
                    <ProviderDot provider={prov} size={7} />
                    <span className="font-mono text-sm text-ink w-[120px]">{id}</span>
                    <div className="meter" style={{ flex: 1 }}><i style={{ width: (amt / provTotal) * 100 + '%', background: 'var(--ink-mute)' }} /></div>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 52, textAlign: 'right' }}>{amt === 0 ? 'free' : money(amt, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Half>
        </Card>

        {/* cap policy & overage — read-only mirror; edited per node in Organization */}
        <Card className="overflow-hidden mt-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Cap policy</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>set per node in Organization</span></CardHead>
          <div className="overflow-x-auto">
            <Table min={640}>
              <thead><tr><th>Scope</th><th>Cap type</th><th className="num">Alert at</th><th>Free floor</th></tr></thead>
              <tbody>
                {caps.map((c, i) => (
                  <tr key={c.name}>
                    <td style={{ color: 'var(--ink)', fontWeight: i === 0 ? 600 : 500 }}><span className="flex items-center gap-2"><Icon name={i === 0 ? 'org' : 'dept'} size={14} tone={i === 0 ? 'accent' : 'mute'} />{c.name}</span></td>
                    <td data-th="Cap type">
                      <Tag style={{ textTransform: 'capitalize', color: c.type === 'soft' ? 'var(--warning)' : 'var(--ink)' }}>{c.type}</Tag>
                    </td>
                    <td className="num" data-th="Alert at"><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{c.alert}%</span></td>
                    <td data-th="Free floor"><span className="status" style={{ color: c.floor ? 'var(--success)' : 'var(--ink-faint)' }}><span className="dot" style={{ background: c.floor ? 'var(--success)' : 'var(--ink-faint)' }} />{c.floor ? 'on' : 'off'}</span></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <CardFoot dashed className="justify-between gap-4">
            <span className="flex items-center gap-2"><Icon name="info" size={14} tone="mute" /><span>Cap type, alert threshold and free-floor are set <b>per node</b> in <b style={{ color: 'var(--ink)' }}>Organization → Hierarchy &amp; budgets</b>. When a <b>hard</b> cap is exhausted —</span></span>
            <select value={overage} onChange={(e) => setOverage(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 8px', cursor: 'pointer' }}>
              {[['floor', 'Step down to the free floor'], ['block', 'Block new calls'], ['notify', 'Allow overage + notify owner']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </CardFoot>
        </Card>

        {/* seat management */}
        <Card className="overflow-hidden mt-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="team" size={15} tone="soft" /><span className="zs-eyebrow">Seats</span></span><span className="flex items-center gap-3"><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{seatsUsed} of 150 assigned</span><Button className="h-[28px] text-[12px]" variant="secondary"><Icon name="plus" size={13} tone="soft" /> Assign seat</Button></span></CardHead>
          <div className="pt-4 px-6 pb-0">
            <div className="track" style={{ height: 8 }}><i style={{ width: (seatsUsed / 150) * 100 + '%', background: 'var(--accent)' }} /></div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 6 }}>{150 - seatsUsed} free · idle seats can be reclaimed</div>
          </div>
          <div className="pt-2 px-0 pb-1">
            {seats.map((s, i) => {
              const idle = /d|mo/.test(s.last) && s.active;
              return (
                <div key={s.user} className="flex items-center gap-3 py-2 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: s.active ? 1 : 0.5 }}>
                  <span className="ava w-[26px] h-[26px]">{s.user[0].toUpperCase()}</span>
                  <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{s.user}</span>
                  <span className="dtag">{s.role}</span>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: idle ? 'var(--warning)' : 'var(--ink-mute)', width: 54, textAlign: 'right' }}>{s.last}</span>
                  {s.active
                    ? <Button variant="ghost" size="sm" onClick={() => setSeats((ss) => ss.map((x, j) => (j === i ? { ...x, active: false } : x)))}><Icon name="logout" size={12} tone="soft" /> Reclaim</Button>
                    : <Button variant="ghost" size="sm" onClick={() => setSeats((ss) => ss.map((x, j) => (j === i ? { ...x, active: true } : x)))}>Restore</Button>}
                </div>
              );
            })}
          </div>
          <CardFoot dashed><Icon name="keys" size={14} tone="mute" /><span>Programmatic identities don’t consume seats — manage those in <b style={{ color: 'var(--ink)' }}>API identities</b>. Reclaiming a seat signs the member out and frees the license.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.BillingView = BillingView;
})();
