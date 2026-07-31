/* Seiki · view-apikeys.jsx
   Programmatic access — the gateway is a programmable endpoint for the org's
   own apps. Issue scoped tenant API keys / service-account identities, watch
   usage, and rotate or revoke. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, Tag, CardFoot, Button, Pill, PageHeader } = window.StrategosUI;
  const { money } = window.StrategosAPI;
  const { useState } = React;

  // Service accounts & API keys are first-class identities. Budget binds to the
  // identity's node in the org tree (never to the key); each key is rate-limited.
  const { KEYS0 } = window.StrategosAPI.content.apikeys;

  function ApiKeysView() {
    const [keys, setKeys] = useState(KEYS0);
    const [flash, setFlash] = useState(null);
    const rotate = (id) => { setKeys((k) => k.map((x) => (x.id === id ? { ...x, prefix: 'sk_live_' + Math.random().toString(16).slice(2, 6) + '…', last: 'just now' } : x))); setFlash(id); setTimeout(() => setFlash(null), 1600); };
    const revoke = (id) => setKeys((k) => k.map((x) => (x.id === id ? { ...x, status: 'revoked' } : x)));

    const active = keys.filter((k) => k.status === 'active');
    const totalCalls = active.reduce((s, k) => s + k.calls, 0);
    const totalSpend = active.reduce((s, k) => s + k.spend, 0);

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Tenant" title="API identities" subMax={660}
          sub="Scoped keys and service accounts for the org’s own apps. Each identity is bound to a capability scope, meters against its budget node in the org tree, is rate-limited, and is fully audited — a key never carries its own budget."
          actions={<Button variant="primary"><Icon name="plus" size={15} tone="paper" /> New identity</Button>} />

        <Card className="overflow-hidden mb-6">
          <div className="flex flex-wrap">
            {[['keys', 'Active identities', active.length, 'service accounts & keys'], ['requests', 'Requests · 30d', totalCalls.toLocaleString(), 'across all identities'], ['wallet', 'Spend · 30d', money(totalSpend), 'metered to each identity’s node']].map(([ic, lab, val, sub], i) => (
              <div className="flex-1 min-w-0 p-4" key={lab} style={{ borderRight: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2 mb-2"><Icon name={ic} size={16} tone="soft" /><span className="zs-eyebrow">{lab}</span></div>
                <div className="text-xl font-display font-light text-ink">{val}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHead><span className="flex items-center gap-2"><Icon name="keys" size={15} tone="soft" /><span className="zs-eyebrow">Keys</span></span></CardHead>
          {keys.map((k, i) => (
            <div key={k.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: k.status === 'revoked' ? 0.55 : 1 }}>
              <span className="glyph w-[32px] h-[32px]"><Icon name={k.kind === 'service' ? 'router' : 'keys'} size={15} tone={k.status === 'revoked' ? 'mute' : 'soft'} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{k.name}</span>
                  <Tag>{k.kind === 'service' ? 'service account' : 'API key'}</Tag>
                  <span className="dtag">{k.scope}</span>
                  {flash === k.id && <Pill kind="success"><Icon name="check" size={12} tone="success" />rotated</Pill>}
                </div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{k.prefix} · created {k.created} · last used {k.last} · {k.calls.toLocaleString()} calls</div>
              </div>
              <div style={{ width: 190, flexShrink: 0 }} className="mono">
                <div className="font-mono text-sm text-ink">{k.spend === 0 ? 'free' : money(k.spend)} <span className="text-ink-faint">· 30d</span></div>
                <div className="font-mono text-xs text-ink-mute mt-0.5">→ <b style={{ color: 'var(--ink-soft)' }}>{k.node}</b> budget · {k.rate} rate</div>
              </div>
              {k.status === 'revoked'
                ? <span className="dtag warn">revoked</span>
                : <React.Fragment>
                    <Button variant="ghost" size="sm" onClick={() => rotate(k.id)}><Icon name="refresh" size={13} tone="soft" /> Rotate</Button>
                    <Button variant="ghost" size="sm" onClick={() => revoke(k.id)}><Icon name="lock" size={13} tone="warning" /> Revoke</Button>
                  </React.Fragment>}
            </div>
          ))}
          <CardFoot dashed><Icon name="shield" size={14} tone="mute" /><span>Keys are shown once at creation, then stored hashed. Budget binds to the identity’s node in the org tree — never to the key — and every call is rate-limited, region-pinned, policy-checked and audited like any member call.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.ApiKeysView = ApiKeysView;
})();
