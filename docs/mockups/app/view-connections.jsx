/* Seiki · view-connections.jsx — provider connections, editable.
   Connect a router (enter key → validate → store in the vault), rotate or
   revoke, set per-router custody (device-local vs gateway-proxied), and add a
   custom / OpenAI-compatible endpoint with its region. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Button, Pill, PageHeader } = window.StrategosUI;
  const { ROUTERS } = window.StrategosAPI;
  const { useState } = React;

  const { ROUTER_ICON, MASKED, REGION0, SCOPES, HEALTH, EXP_DAYS } = window.StrategosAPI.content.connections;

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
      <ViewPad className="rise">
        <PageHeader eyebrow="Connections" title="Provider connections"
          sub="The gateway routes every call through Northwind's own credentials. Keys live in the org vault — members never see them. Set each router's custody, rotate keys, or add a custom endpoint."
          actions={<>
            <Pill icon="keys">{connected} of {rows.length} connected</Pill>
            <Button variant="primary" onClick={() => setAddOpen((v) => !v)}><Icon name="plus" size={15} tone="paper" /> Add router</Button>
          </>} />

        {addOpen && (
          <Card className="rise overflow-hidden mb-6 border border-accent">
            <CardHead><span className="zs-eyebrow">Add a custom · OpenAI-compatible router</span><button onClick={() => setAddOpen(false)} style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} tone="mute" /></button></CardHead>
            <div className="p-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
              <label className="flex flex-col gap-1"><span className="zs-eyebrow m-0">Name</span><input style={inp} value={custom.id} onChange={(e) => setCustom({ ...custom, id: e.target.value })} placeholder="Internal-LLM" /></label>
              <label className="flex flex-col gap-1"><span className="zs-eyebrow m-0">Base URL</span><input style={inp} value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} placeholder="https://llm.internal/v1" /></label>
              <label className="flex flex-col gap-1"><span className="zs-eyebrow m-0">Region</span><select style={inp} value={custom.region} onChange={(e) => setCustom({ ...custom, region: e.target.value })}>{['eu-west-2', 'us-east-1', 'eu-central-1', 'on-box'].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
              <Button variant="primary" onClick={addRouter}><Icon name="plus" size={14} tone="paper" /> Add router</Button>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHead>
            <span className="zs-eyebrow">Routers &amp; credentials</span>
            <span className="flex items-center gap-2"><Icon name="lock" size={13} tone="success" /><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>org vault · eu-west-2</span></span>
          </CardHead>

          <div className="grid-flush-3">
            {rows.map((r, i) => {
              const on = r.keyed;
              return (
                <div className="py-4 px-4 flex flex-col gap-3" key={r.id} style={{ borderRight: i % 3 !== 2 ? '1px solid var(--paper-edge)' : 'none', borderTop: i >= 3 ? '1px solid var(--paper-edge)' : 'none'}}>
                  <div className="flex items-center gap-3">
                    <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center shrink-0 border" style={{ background: on ? 'var(--accent-soft)' : 'var(--paper-mute)' }}>
                      <Icon name={ROUTER_ICON[r.id] || 'router'} size={15} tone={on ? 'accent' : 'mute'} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{r.id}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{r.kind}</div>
                    </div>
                    <span className="status" style={{ color: on ? 'var(--success)' : 'var(--ink-faint)' }}>
                      <span className="dot" style={{ background: on ? 'var(--success)' : 'var(--ink-faint)' }} />
                      {on ? (r.id === 'Ollama' ? 'local' : 'connected') : 'not set'}
                    </span>
                  </div>

                  {connecting === r.id ? (
                    <div className="flex flex-col gap-1.5">
                      {r.oauth && <React.Fragment><Button className="justify-center" variant="primary" size="sm" onClick={() => confirmConnect(r.id, true)}><Icon name="sso" size={13} tone="paper" /> Connect with {r.id} OAuth</Button><div className="flex items-center gap-2"><span className="zs-rule flex-1" /><span className="zs-meta text-[10px]">OR KEY</span><span className="zs-rule flex-1" /></div></React.Fragment>}
                      <input autoFocus value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={r.id === 'Ollama' ? 'localhost:11434' : 'paste API key…'} style={{ ...inp, fontSize: 12 }} />
                      <div className="flex items-center gap-2">
                        <Button className="flex-1 justify-center" variant="primary" size="sm" onClick={() => confirmConnect(r.id)}><Icon name="check" size={13} tone="paper" /> Validate &amp; store</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConnecting(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : on ? (
                    <React.Fragment>
                      <div className="flex items-center gap-2 h-[32px] py-0 px-2.5 rounded-[8px] bg-paper-mute border font-mono text-xs text-ink-mute">
                        <Icon name="lock" size={12} tone="mute" />
                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{flash === r.id ? 'rotated · ' : ''}{r.masked}</span>
                        <button type="button" onClick={() => rotate(r.id)} aria-label="rotate" title="Rotate key" style={{ display: 'grid', placeItems: 'center' }}><Icon name="refresh" size={12} tone="mute" /></button>
                        <button type="button" onClick={() => disconnect(r.id)} aria-label="disconnect" title="Revoke" style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={13} tone="mute" /></button>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="dot" style={{ background: HEALTH[r.health][1] }} />
                        <span style={{ color: HEALTH[r.health][1] }}>{HEALTH[r.health][0]}</span>
                        <span className="text-ink-faint">· {r.expDays == null ? 'no expiry' : (r.expDays < 30 ? 'expires in ' + r.expDays + 'd' : 'rotates in ' + Math.round(r.expDays / 30) + 'mo')}</span>
                        {r.masked.indexOf('oauth') === 0 && <span className="dtag">OAuth</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>scope</span>
                        <select value={r.scope} onChange={(e) => setScope(r.id, e.target.value)} style={{ flex: 1, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-ui)', color: 'var(--ink)', padding: '3px 6px', cursor: 'pointer' }}>{SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', flexShrink: 0 }}>custody</span>
                        <div className="inline-flex border rounded overflow-hidden" style={{ opacity: r.canDevice ? 1 : 0.6 }}>
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
                    <Button className="w-full justify-center" variant="secondary" size="sm" type="button" onClick={() => startConnect(r.id)} style={{ borderStyle: 'dashed' }}>
                      <Icon name="plus" size={13} tone="soft" /> Connect {r.id}
                    </Button>
                  )}

                  <div className="flex items-center justify-between mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>
                    <span>{r.isCustom ? r.url : r.note}</span><span>{r.region}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <CardFoot dashed>
            <Icon name="shield" size={14} tone="success" />
            <span className="leading-[1.45]"><b>Custody</b> decides whether a router’s keys run on-device or proxy through the gateway; <b>scope</b> limits which spaces/roles may use it. Keys show <b>health &amp; expiry</b> so you can rotate before they lapse. Anthropic supports <b>OAuth</b> connect; others take a vault key.</span>
          </CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.ConnectionsView = ConnectionsView;
})();
