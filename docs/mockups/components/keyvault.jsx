/* Strategos · keyvault.jsx — bring-your-own-keys, per tenant. */
const { Icon: KIcon } = window.StrategosIcons;
const { Switch: KSwitch } = window.StrategosUI;
const { ROUTERS: K_ROUTERS } = window.StrategosData;
const { useState: kUseState } = React;

const ROUTER_ICON = { Anthropic: 'provider', OpenAI: 'provider', Bedrock: 'router', Vercel: 'bolt', OpenRouter: 'globe', Ollama: 'database' };
const MASKED = { Anthropic: 'sk-ant-•••• 4f2a', OpenAI: 'sk-•••• 9c1e', Bedrock: 'arn:•••• prod', Vercel: 'vc-•••• 7b30', Ollama: 'localhost:11434' };

function KeyVault() {
  const [keyed, setKeyed] = kUseState(() => {
    const o = {}; K_ROUTERS.forEach((r) => o[r.id] = r.keyed); return o;
  });
  const byokOnly = true;
  const connected = K_ROUTERS.filter((r) => keyed[r.id]).length;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Bring your own keys</div>
          <div style={{ font: '600 17px var(--font-display)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>Your tenant. Your keys. Your egress path.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="pill"><KIcon name="key" size={12} /> {connected} of {K_ROUTERS.length} configured</span>
          <span className="pill moss"><KIcon name="shield" size={12} /> use-only-my-keys</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
        {K_ROUTERS.map((r, i) => {
          const on = keyed[r.id];
          return (
            <div key={r.id} style={{ padding: '16px 18px', borderRight: (i % 3 !== 2) ? '1px solid var(--line)' : 'none', borderTop: i >= 3 ? '1px solid var(--line)' : 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, border: '1px solid var(--line)', background: on ? 'var(--moss-soft)' : 'var(--paper-inset)', color: on ? 'var(--moss)' : 'var(--ink-soft)' }}>
                  <KIcon name={ROUTER_ICON[r.id]} size={15} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: '600 13.5px var(--font-body)', color: 'var(--ink)' }}>{r.id}</div>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{r.kind}</div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '500 10.5px var(--font-mono)', color: on ? 'var(--success)' : 'var(--ink-faint)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--success)' : 'var(--ink-faint)' }}></span>
                  {on ? (r.id === 'Ollama' ? 'local' : 'connected') : 'not set'}
                </span>
              </div>
              {on ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', borderRadius: 8, background: 'var(--paper-inset)', border: '1px solid var(--line)', font: '500 11.5px var(--font-mono)', color: 'var(--ink-mute)' }}>
                  <KIcon name="lock" size={12} style={{ color: 'var(--ink-soft)' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{MASKED[r.id] || 'configured'}</span>
                  <button type="button" onClick={() => setKeyed((s) => ({ ...s, [r.id]: false }))} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', display: 'grid', placeItems: 'center' }} aria-label="remove key"><KIcon name="copy" size={12} /></button>
                </div>
              ) : (
                <button type="button" onClick={() => setKeyed((s) => ({ ...s, [r.id]: true }))} className="btn sm" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}>
                  <KIcon name="plus" size={13} /> Add {r.id} key
                </button>
              )}
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{r.note}</div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px dashed var(--line)', display: 'flex', alignItems: 'center', gap: 10, font: '500 12px/1.45 var(--font-body)', color: 'var(--ink-mute)' }}>
        <KIcon name="shield" size={14} style={{ color: 'var(--moss)', flexShrink: 0 }} />
        {byokOnly
          ? <span>With <b>use-only-my-keys</b> on, no call ever touches a Strategos-owned key — billing and data residency stay entirely inside your accounts.</span>
          : <span>Strategos pooled keys are enabled as a fallback. Switch to <b>use-only-my-keys</b> to guarantee in-tenant egress.</span>}
      </div>
    </div>
  );
}

window.KeyVault = KeyVault;
