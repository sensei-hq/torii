/* Seiki · view-connections.jsx — provider connections, editable.
   Connect a router (enter key → validate → store in the vault), rotate or
   revoke, set per-router custody (device-local vs gateway-proxied), and add a
   custom / OpenAI-compatible endpoint with its region. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, PageHeader } = window.StrategosUI;
  const { ROUTERS } = window.StrategosData;
  const { useState } = React;

  const ROUTER_ICON = { Anthropic: 'provider', OpenAI: 'provider', Bedrock: 'router', Vercel: 'bolt', OpenRouter: 'globe', Ollama: 'database' };
  const MASKED = { Anthropic: 'sk-ant-•••• 4f2a', OpenAI: 'sk-•••• 9c1e', Bedrock: 'arn:•••• prod', Vercel: 'vc-•••• 7b30', OpenRouter: 'or-•••• 22aa', Ollama: 'localhost:11434' };
  const REGION0 = { Anthropic: 'eu-west-2', OpenAI: 'eu-west-2', Bedrock: 'eu-west-2', Vercel: 'fra1 · edge', OpenRouter: '—', Ollama: 'on-box' };
  const SCOPES = [['all', 'All spaces'], ['finance', 'Finance only'], ['leasing', 'Leasing only'], ['admins', 'Admins only']];
  const HEALTH = { healthy: ['healthy', 'var(--success)'], expiring: ['expiring soon', 'var(--warning)'], expired: ['expired', 'var(--accent)'] };
  const EXP_DAYS = { Anthropic: 210, OpenAI: 120, Bedrock: 365, Vercel: 45, OpenRouter: 9, Ollama: null };

  function ConnectionsView() {
    const [rows, setRows] = useState(() => ROUTERS.map((r) => ({
      ...r, region: REGION0[r.id],
      custody: r.id === 'Ollama' ? 'device' : 'proxied',
      canDevice: r.id === 'Ollama',
      masked: MASKED[r.id] || 'configured',
      oauth: r.id === 'Anthropic',
      scope: 'all',
      health: r.id === 'OpenRouter' ? 'expiring' : 'healthy',
      expDays: EXP_DAYS[r.id] != null ? EXP_DAYS[r.id] : 180,
    })));
    const [connecting, setConnecting] = useState(null);   // router id being connected
    const [keyDraft, setKeyDraft] = useState('');
    const [flash, setFlash] = useState(null);
    const [addOpen, setAddOpen] = useState(false);
    const [custom, setCustom] = useState({ id: '', url: '', region: 'eu-west-2' });

    const connected = rows.filter((r) => r.keyed).length;
    const startConnect = (id) => { setConnecting(id); setKeyDraft(''); };
    const confirmConnect = (id, viaOAuth) => {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, keyed: true, health: 'healthy', masked: viaOAuth ? 'oauth · ' + id.toLowerCase() : (keyDraft.slice(0, 6) || 'key') + '•••• ' + (keyDraft.slice(-4) || 'set') } : r)));
      setConnecting(null);
    };
    const setScope = (id, v) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, scope: v } : r)));
    const disconnect = (id) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, keyed: false } : r)));
    const rotate = (id) => { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, masked: 'sk-•••• ' + Math.random().toString(16).slice(2, 6) } : r))); setFlash(id); setTimeout(() => setFlash(null), 1500); };
    const setCustody = (id, v) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, custody: v } : r)));
    const addRouter = () => {
      if (!custom.id.trim()) return;
      setRows((rs) => [...rs, { id: custom.id, kind: 'custom', note: 'OpenAI-compatible', keyed: false, region: custom.region, custody: 'proxied', canDevice: true, masked: 'configured', url: custom.url, isCustom: true }]);
      setCustom({ id: '', url: '', region: 'eu-west-2' }); setAddOpen(false);
    };

    const inp = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', width: '100%' };

    return (
      <div className="view-pad rise">
        <PageHeader eyebrow="Connections" title="Provider connections"
          sub="The gateway routes every call through Northwind's own credentials. Keys live in the org vault — members never see them. Set each router's custody, rotate keys, or add a custom endpoint."
          actions={<>
            <Pill icon="keys">{connected} of {rows.length} connected</Pill>
            <button className="zs-btn zs-btn-primary" onClick={() => setAddOpen((v) => !v)}><Icon name="plus" size={15} tone="paper" /> Add router</button>
          </>} />

        {addOpen && (
          <div className="card rise" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)', border: '1px solid var(--accent)' }}>
            <div className="card-hd"><span className="zs-eyebrow">Add a custom · OpenAI-compatible router</span><button onClick={() => setAddOpen(false)} style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} tone="mute" /></button></div>
            <div style={{ padding: 'var(--space-5)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)', alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="zs-eyebrow" style={{ margin: 0 }}>Name</span><input style={inp} value={custom.id} onChange={(e) => setCustom({ ...custom, id: e.target.value })} placeholder="Internal-LLM" /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="zs-eyebrow" style={{ margin: 0 }}>Base URL</span><input style={inp} value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} placeholder="https://llm.internal/v1" /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="zs-eyebrow" style={{ margin: 0 }}>Region</span><select style={inp} value={custom.region} onChange={(e) => setCustom({ ...custom, region: e.target.value })}>{['eu-west-2', 'us-east-1', 'eu-central-1', 'on-box'].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <button className="zs-btn zs-btn-primary" onClick={addRouter}><Icon name="plus" size={14} tone="paper" /> Add router</button>
            </div>
          </div>
        )}

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <span className="zs-eyebrow">Routers &amp; credentials</span>
            <span className="flex items-center gap-2"><Icon name="lock" size={13} tone="success" /><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>org vault · eu-west-2</span></span>
          </div>

          <div className="grid-flush-3">
            {rows.map((r, i) => {
              const on = r.keyed;
              return (
                <div key={r.id} style={{ padding: '16px 18px', borderRight: i % 3 !== 2 ? '1px solid var(--paper-edge)' : 'none', borderTop: i >= 3 ? '1px solid var(--paper-edge)' : 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="flex items-center gap-3">
                    <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, border: '1px solid var(--paper-edge)', background: on ? 'var(--accent-soft)' : 'var(--paper-mute)' }}>
                      <Icon name={ROUTER_ICON[r.id] || 'router'} size={15} tone={on ? 'accent' : 'mute'} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.id}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{r.kind}</div>
                    </div>
                    <span className="status" style={{ color: on ? 'var(--success)' : 'var(--ink-faint)' }}>
                      <span className="dot" style={{ background: on ? 'var(--success)' : 'var(--ink-faint)' }} />
                      {on ? (r.id === 'Ollama' ? 'local' : 'connected') : 'not set'}
                    </span>
                  </div>

                  {connecting === r.id ? (
                    <div className="flex flex-col" style={{ gap: 6 }}>
                      {r.oauth && <React.Fragment><button className="zs-btn zs-btn-primary zs-btn-sm" style={{ justifyContent: 'center' }} onClick={() => confirmConnect(r.id, true)}><Icon name="sso" size={13} tone="paper" /> Connect with {r.id} OAuth</button><div className="flex items-center gap-2"><span className="zs-rule" style={{ flex: 1 }} /><span className="zs-meta" style={{ fontSize: 10 }}>OR KEY</span><span className="zs-rule" style={{ flex: 1 }} /></div></React.Fragment>}
                      <input autoFocus value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={r.id === 'Ollama' ? 'localhost:11434' : 'paste API key…'} style={{ ...inp, fontSize: 12 }} />
                      <div className="flex items-center gap-2">
                        <button className="zs-btn zs-btn-primary zs-btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => confirmConnect(r.id)}><Icon name="check" size={13} tone="paper" /> Validate &amp; store</button>
                        <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setConnecting(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : on ? (
                    <React.Fragment>
                      <div className="flex items-center gap-2" style={{ height: 32, padding: '0 10px', borderRadius: 8, background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>
                        <Icon name="lock" size={12} tone="mute" />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{flash === r.id ? 'rotated · ' : ''}{r.masked}</span>
                        <button type="button" onClick={() => rotate(r.id)} aria-label="rotate" title="Rotate key" style={{ display: 'grid', placeItems: 'center' }}><Icon name="refresh" size={12} tone="mute" /></button>
                        <button type="button" onClick={() => disconnect(r.id)} aria-label="disconnect" title="Revoke" style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={13} tone="mute" /></button>
                      </div>
                      <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                        <span className="dot" style={{ background: HEALTH[r.health][1] }} />
                        <span style={{ color: HEALTH[r.health][1] }}>{HEALTH[r.health][0]}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>· {r.expDays == null ? 'no expiry' : (r.expDays < 30 ? 'expires in ' + r.expDays + 'd' : 'rotates in ' + Math.round(r.expDays / 30) + 'mo')}</span>
                        {r.masked.indexOf('oauth') === 0 && <span className="dtag">OAuth</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>scope</span>
                        <select value={r.scope} onChange={(e) => setScope(r.id, e.target.value)} style={{ flex: 1, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-ui)', color: 'var(--ink)', padding: '3px 6px', cursor: 'pointer' }}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>custody</span>
                        <div style={{ display: 'inline-flex', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', overflow: 'hidden', opacity: r.canDevice ? 1 : 0.6 }}>
                          {[['device', 'On-device'], ['proxied', 'Via gateway']].map(([v, lab], j) => {
                            const sel = r.custody === v;
                            const allowed = v === 'proxied' || r.canDevice;
                            return <button key={v} onClick={() => allowed && setCustody(r.id, v)} title={!allowed ? 'This router has no on-device runtime' : ''}
                              style={{ height: 24, padding: '0 8px', fontSize: 10.5, fontWeight: 500, borderLeft: j ? '1px solid var(--paper-edge)' : 'none', cursor: allowed ? 'pointer' : 'not-allowed',
                                background: sel ? (v === 'device' ? 'var(--success)' : 'var(--ink)') : 'transparent', color: sel ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>;
                          })}
                        </div>
                      </div>
                    </React.Fragment>
                  ) : (
                    <button type="button" onClick={() => startConnect(r.id)} className="zs-btn zs-btn-secondary zs-btn-sm" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}>
                      <Icon name="plus" size={13} tone="soft" /> Connect {r.id}
                    </button>
                  )}

                  <div className="flex items-center justify-between mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>
                    <span>{r.isCustom ? r.url : r.note}</span><span>{r.region}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card-foot dashed">
            <Icon name="shield" size={14} tone="success" />
            <span style={{ lineHeight: 1.45 }}><b>Custody</b> decides whether a router’s keys run on-device or proxy through the gateway; <b>scope</b> limits which spaces/roles may use it. Keys show <b>health &amp; expiry</b> so you can rotate before they lapse. Anthropic supports <b>OAuth</b> connect; others take a vault key.</span>
          </div>
        </div>
      </div>
    );
  }

  window.ConnectionsView = ConnectionsView;
})();
