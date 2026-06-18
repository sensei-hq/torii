/* Strategos Admin Portal · view-billing.jsx
   Budgets & billing — the org → dept → user spend tree plus the license summary.
   Reuses StrategosData.BUDGET_TREE so the numbers match the rest of the gateway. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill } = window.StrategosUI;
  const { BUDGET_TREE, money } = window.StrategosData;

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
    const orgPct = spent / cap;

    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Billing</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Budgets &amp; billing</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 640 }}>One license, governed like thousands. Caps cascade from the org down to each member; spend is metered on every call through the gateway.</p>
          </div>
          <Pill icon="check" kind="success">on plan</Pill>
        </div>

        {/* plan summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' }}>
          {[
            { l: 'Plan', v: 'Enterprise', s: 'annual · auto-renew' },
            { l: 'Seats', v: '142', s: 'of 150 licensed' },
            { l: 'This month', v: money(spent, 0), s: 'of ' + money(cap, 0) + ' cap' },
            { l: 'Next invoice', v: '1 May', s: money(4260, 0) + ' · 142 seats' },
          ].map((x) => (
            <div key={x.l} className="card stat" style={{ minWidth: 0 }}>
              <div className="zs-eyebrow" style={{ marginBottom: 10 }}>{x.l}</div>
              <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-2xl)', lineHeight: 1.05, letterSpacing: 'var(--tracking-tight)', overflowWrap: 'anywhere' }}>{x.v}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>{x.s}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 'var(--space-5)', marginTop: 'var(--space-5)', alignItems: 'start' }}>
          {/* budget tree */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd">
              <span className="flex items-center gap-2"><Icon name="wallet" size={15} tone="soft" /><span className="zs-eyebrow">Budget tree</span></span>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{Math.round(orgPct * 100)}% of org cap</span>
            </div>
            <table className="tbl">
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
                      <td className="num">{money(node.spent, 0)}</td>
                      <td className="num" style={{ color: 'var(--ink-mute)' }}>{money(node.cap, 0)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="track" style={{ flex: 1 }}><i style={{ width: Math.min(100, p * 100) + '%', background: pctTone(p) }} /></div>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: pctTone(p), width: 30, textAlign: 'right' }}>{Math.round(p * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Caps are hard limits — when a scope is exhausted, routing steps down to the free floor automatically.</span></div>
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
                    <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>{iv[0]}</div>
                  </div>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{money(iv[2], 0)}</span>
                  <span className={'clf ' + (iv[3] === 'paid' ? 'clf-public' : 'clf-confidential')} style={{ minWidth: 52, justifyContent: 'center' }}><span className="d" />{iv[3]}</span>
                </div>
              ))}
            </div>
            <div className="card-foot"><Icon name="wallet" size={13} tone="mute" /><span>Visa ending 4218 · billed in USD</span></div>
          </div>
        </div>
      </div>
    );
  }

  window.BillingView = BillingView;
})();
