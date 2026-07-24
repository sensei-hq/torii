/* Strategos Admin Portal · view-billing.jsx
   Budgets & billing — the org → dept → user spend tree plus the license summary.
   Reuses StrategosData.BUDGET_TREE so the numbers match the rest of the gateway. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, PageHeader } = window.StrategosUI;
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

  // programmatic access — tenant API keys + service-account identities,
  // each scoped and metered against the same cascade as people.
  const API_KEYS = [
    { name: 'leasing-portal', kind: 'service account', scope: 'Leasing Ops · read',     spent: 142, cap: 400,  last: '2m ago',  state: 'active' },
    { name: 'finance-etl',    kind: 'service account', scope: 'Finance · warehouse',     spent: 980, cap: 1200, last: '1h ago',  state: 'active' },
    { name: 'ci-eval',        kind: 'API key',         scope: 'Eval bucket · fan-out',   spent: 64,  cap: 200,  last: '4h ago',  state: 'active' },
    { name: 'legacy-bot',     kind: 'API key',         scope: 'Support · read',          spent: 0,   cap: 100,  last: '14d ago', state: 'revoked' },
  ];

  function BillingView() {
    const rows = flatten(BUDGET_TREE, 0, []);
    const spent = BUDGET_TREE.spent, cap = BUDGET_TREE.cap;
    const orgPct = spent / cap;

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Billing" title="Budgets & billing" subMax={640}
          sub="One license, governed like thousands. Caps cascade from the org down to each member; spend is metered on every call through the gateway."
          actions={<Pill icon="check" kind="success">on plan</Pill>} />

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

        {/* programmatic access — API keys & service accounts */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="keys" size={15} tone="soft" /><span className="zs-eyebrow">API keys &amp; service accounts</span></span>
            <button className="zs-btn zs-btn-secondary" style={{ height: 28, fontSize: 12 }}><Icon name="plus" size={13} tone="soft" /> New key</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '680px' }}>
              <thead><tr><th>Identity</th><th>Type</th><th>Scope</th><th style={{ width: 160 }}>Spend vs cap</th><th className="num">Last used</th><th>Status</th></tr></thead>
              <tbody>
                {API_KEYS.map((k) => {
                  const p = k.cap ? k.spent / k.cap : 0;
                  const revoked = k.state === 'revoked';
                  return (
                    <tr key={k.name} style={{ opacity: revoked ? 0.55 : 1 }}>
                      <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{k.name}</td>
                      <td data-th="Type"><span className="tag">{k.kind}</span></td>
                      <td className="mono" data-th="Scope" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-xs)' }}>{k.scope}</td>
                      <td data-th="Spend vs cap">
                        <div className="flex items-center gap-2">
                          <div className="track" style={{ flex: 1 }}><i style={{ width: Math.min(100, p * 100) + '%', background: pctTone(p) }} /></div>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>{money(k.spent, 0)}/{money(k.cap, 0)}</span>
                        </div>
                      </td>
                      <td className="num mono" data-th="Last used" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-xs)' }}>{k.last}</td>
                      <td data-th="Status">{revoked
                        ? <span className="status" style={{ color: 'var(--ink-faint)' }}><span className="dot" style={{ background: 'var(--ink-faint)' }} />revoked</span>
                        : <span className="status" style={{ color: 'var(--success)' }}><span className="dot" style={{ background: 'var(--success)' }} />active</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Your own apps call the gateway with scoped keys — each meters against the same budget cascade as people, so programmatic spend never escapes the caps.</span></div>
        </div>
      </div>
    );
  }

  window.BillingView = BillingView;
})();
