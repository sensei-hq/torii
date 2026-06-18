/* Strategos Console · view-connections.jsx (admin)
   Provider connections, managed at the org level. The whole gateway runs on
   Northwind's own credentials — there is no per-user key, so no "use my keys". */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill } = window.StrategosUI;
  const { ROUTERS } = window.StrategosData;
  const { useState } = React;

  const ROUTER_ICON = { Anthropic: 'provider', OpenAI: 'provider', Bedrock: 'router', Vercel: 'bolt', OpenRouter: 'globe', Ollama: 'database' };
  const MASKED = { Anthropic: 'sk-ant-•••• 4f2a', OpenAI: 'sk-•••• 9c1e', Bedrock: 'arn:•••• prod', Vercel: 'vc-•••• 7b30', Ollama: 'localhost:11434' };
  const REGION = { Anthropic: 'eu-west-2', OpenAI: 'eu-west-2', Bedrock: 'eu-west-2', Vercel: 'fra1 · edge', OpenRouter: '—', Ollama: 'on-box' };

  function ConnectionsView() {
    const [keyed, setKeyed] = useState(() => { const o = {}; ROUTERS.forEach((r) => (o[r.id] = r.keyed)); return o; });
    const connected = ROUTERS.filter((r) => keyed[r.id]).length;

    return (
      <div className="view-pad rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Connections</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Provider connections</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 620 }}>The gateway routes every call through Northwind's own credentials. Keys live in the org vault — members never see or handle them. Billing and data residency stay inside your accounts.</p>
          </div>
          <Pill icon="keys">{connected} of {ROUTERS.length} connected</Pill>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <span className="zs-eyebrow">Routers &amp; credentials</span>
            <span className="flex items-center gap-2"><Icon name="lock" size={13} tone="success" /><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>org vault · eu-west-2</span></span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {ROUTERS.map((r, i) => {
              const on = keyed[r.id];
              return (
                <div key={r.id} style={{ padding: '16px 18px', borderRight: i % 3 !== 2 ? '1px solid var(--paper-edge)' : 'none', borderTop: i >= 3 ? '1px solid var(--paper-edge)' : 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="flex items-center gap-3">
                    <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, border: '1px solid var(--paper-edge)', background: on ? 'var(--accent-soft)' : 'var(--paper-mute)' }}>
                      <Icon name={ROUTER_ICON[r.id]} size={15} tone={on ? 'accent' : 'mute'} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.id}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{r.kind}</div>
                    </div>
                    <span className="status" style={{ color: on ? 'var(--success)' : 'var(--ink-faint)' }}>
                      <span className="dot" style={{ background: on ? 'var(--success)' : 'var(--ink-faint)' }} />
                      {on ? (r.id === 'Ollama' ? 'local' : 'connected') : 'not set'}
                    </span>
                  </div>
                  {on ? (
                    <div className="flex items-center gap-2" style={{ height: 32, padding: '0 10px', borderRadius: 8, background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-mute)' }}>
                      <Icon name="lock" size={12} tone="mute" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{MASKED[r.id] || 'configured'}</span>
                      <button type="button" onClick={() => setKeyed((s) => ({ ...s, [r.id]: false }))} aria-label="disconnect" style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={13} tone="mute" /></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setKeyed((s) => ({ ...s, [r.id]: true }))} className="zs-btn zs-btn-secondary zs-btn-sm" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}>
                      <Icon name="plus" size={13} tone="soft" /> Connect {r.id}
                    </button>
                  )}
                  <div className="flex items-center justify-between mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)' }}>
                    <span>{r.note}</span><span>{REGION[r.id]}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card-foot dashed">
            <Icon name="shield" size={14} tone="success" />
            <span style={{ lineHeight: 1.45 }}>All egress flows through org-managed keys in <b>eu-west-2</b>. Rotate or revoke any connection here; members and the workspace are unaffected.</span>
          </div>
        </div>
      </div>
    );
  }

  window.ConnectionsView = ConnectionsView;
})();
