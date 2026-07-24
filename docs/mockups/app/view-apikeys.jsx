/* Strategos Admin · view-apikeys.jsx
   Programmatic access — the gateway is a programmable endpoint for the org's
   own apps. Issue scoped tenant API keys / service-account identities, watch
   usage, and rotate or revoke. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, PageHeader } = window.StrategosUI;
  const { money } = window.StrategosData;
  const { useState } = React;

  // Service accounts & API keys are first-class identities. Budget binds to the
  // identity's node in the org tree (never to the key); each key is rate-limited.
  const KEYS0 = [
    { id: 'sk_live_renewals', name: 'Renewals bot', kind: 'service', node: 'Leasing', scope: 'chat · files', rate: '600/min', created: '2mo ago', last: '4m ago', calls: 18420, spend: 62.4, status: 'active', prefix: 'sk_live_4f2a…' },
    { id: 'sk_live_digest',   name: 'Weekly digest', kind: 'service', node: 'Support', scope: 'chat',        rate: '120/min', created: '3mo ago', last: '2d ago', calls: 640,   spend: 3.1,  status: 'active', prefix: 'sk_live_9c81…' },
    { id: 'sk_live_ingest',   name: 'Ingest worker', kind: 'service', node: 'Northwind Estates', scope: 'embeddings', rate: '2,000/min', created: '5mo ago', last: '1m ago', calls: 94200, spend: 41.0, status: 'active', prefix: 'sk_live_2d55…' },
    { id: 'sk_test_sandbox',  name: 'Dev sandbox',   kind: 'key',     node: 'a.rao', scope: 'chat · tools', rate: '60/min', created: '1w ago', last: '—', calls: 12, spend: 0.02, status: 'active', prefix: 'sk_test_7b0e…' },
    { id: 'sk_live_legacy',   name: 'Old exporter',  kind: 'key',     node: 'Finance', scope: 'files',      rate: '—', created: '1y ago', last: '3mo ago', calls: 5100, spend: 0, status: 'revoked', prefix: 'sk_live_1a0f…' },
  ];

  function ApiKeysView() {
    const [keys, setKeys] = useState(KEYS0);
    const [flash, setFlash] = useState(null);
    const rotate = (id) => { setKeys((k) => k.map((x) => (x.id === id ? { ...x, prefix: 'sk_live_' + Math.random().toString(16).slice(2, 6) + '…', last: 'just now' } : x))); setFlash(id); setTimeout(() => setFlash(null), 1600); };
    const revoke = (id) => setKeys((k) => k.map((x) => (x.id === id ? { ...x, status: 'revoked' } : x)));

    const active = keys.filter((k) => k.status === 'active');
    const totalCalls = active.reduce((s, k) => s + k.calls, 0);
    const totalSpend = active.reduce((s, k) => s + k.spend, 0);

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Tenant" title="API identities" subMax={660}
          sub="Scoped keys and service accounts for the org’s own apps. Each identity is bound to a capability scope, meters against its budget node in the org tree, is rate-limited, and is fully audited — a key never carries its own budget."
          actions={<button className="zs-btn zs-btn-primary"><Icon name="plus" size={15} tone="paper" /> New identity</button>} />

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="flex" style={{ flexWrap: 'wrap' }}>
            {[['keys', 'Active identities', active.length, 'service accounts & keys'], ['requests', 'Requests · 30d', totalCalls.toLocaleString(), 'across all identities'], ['wallet', 'Spend · 30d', money(totalSpend), 'metered to each identity’s node']].map(([ic, lab, val, sub], i) => (
              <div key={lab} style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)', borderRight: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name={ic} size={16} tone="soft" /><span className="zs-eyebrow">{lab}</span></div>
                <div style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 300, color: 'var(--ink)' }}>{val}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="keys" size={15} tone="soft" /><span className="zs-eyebrow">Keys</span></span></div>
          {keys.map((k, i) => (
            <div key={k.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: k.status === 'revoked' ? 0.55 : 1 }}>
              <span className="glyph" style={{ width: 32, height: 32 }}><Icon name={k.kind === 'service' ? 'router' : 'keys'} size={15} tone={k.status === 'revoked' ? 'mute' : 'soft'} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{k.name}</span>
                  <span className="tag">{k.kind === 'service' ? 'service account' : 'API key'}</span>
                  <span className="dtag">{k.scope}</span>
                  {flash === k.id && <span className="pill success"><Icon name="check" size={12} tone="success" />rotated</span>}
                </div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{k.prefix} · created {k.created} · last used {k.last} · {k.calls.toLocaleString()} calls</div>
              </div>
              <div style={{ width: 190, flexShrink: 0 }} className="mono">
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{k.spend === 0 ? 'free' : money(k.spend)} <span style={{ color: 'var(--ink-faint)' }}>· 30d</span></div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>→ <b style={{ color: 'var(--ink-soft)' }}>{k.node}</b> budget · {k.rate} rate</div>
              </div>
              {k.status === 'revoked'
                ? <span className="dtag warn">revoked</span>
                : <React.Fragment>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => rotate(k.id)}><Icon name="refresh" size={13} tone="soft" /> Rotate</button>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => revoke(k.id)}><Icon name="lock" size={13} tone="warning" /> Revoke</button>
                  </React.Fragment>}
            </div>
          ))}
          <div className="card-foot dashed"><Icon name="shield" size={14} tone="mute" /><span>Keys are shown once at creation, then stored hashed. Budget binds to the identity’s node in the org tree — never to the key — and every call is rate-limited, region-pinned, policy-checked and audited like any member call.</span></div>
        </div>
      </div>
    );
  }

  window.ApiKeysView = ApiKeysView;
})();
