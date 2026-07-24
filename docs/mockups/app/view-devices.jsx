/* Strategos Admin · view-devices.jsx
   Device fleet — every enrolled device, where it executes, its app/config
   version, sync & offline-buffer health, and the revoke lever (kills a
   device's gateway access + key sync). */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Meter, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const DEVICES0 = [
    { id: 'aiko-mbp',    user: 'a.rao',    platform: 'macOS 15 · M3 Pro',  app: '0.4.2', cfg: 412, exec: 'local', models: 2, sync: 'synced',   buffer: 0, last: 'now',  keySync: 'on', fp: 'ed25519:9f2a·c41d' },
    { id: 'leasing-win', user: 'm.okafor', platform: 'Windows 11 · RTX',   app: '0.4.2', cfg: 412, exec: 'local', models: 2, sync: 'synced',   buffer: 0, last: '3m',   keySync: 'on', fp: 'ed25519:3b7e·88a0' },
    { id: 'web·chrome',  user: 's.kaur',   platform: 'Web · Chrome 141',   app: '—',     cfg: 412, exec: 'gateway', models: 0, sync: 'session', buffer: 0, last: '12m', keySync: 'n/a', fp: '—' },
    { id: 'ops-runner',  user: 'ops-bot',  platform: 'Linux · headless',   app: '0.4.1', cfg: 408, exec: 'local', models: 1, sync: 'offline',  buffer: 3, last: '1h',   keySync: 'on', fp: 'ed25519:1a0f·d52c' },
    { id: 'kaur-ipad',   user: 's.kaur',   platform: 'iPadOS · web',       app: '—',     cfg: 412, exec: 'gateway', models: 0, sync: 'session', buffer: 0, last: '2d',  keySync: 'n/a', fp: '—' },
  ];

  function DevicesView() {
    const [devs, setDevs] = useState(DEVICES0);
    const [confirm, setConfirm] = useState(null);   // device id pending revoke
    const [enroll, setEnroll] = useState(false);
    const [enrollN, setEnrollN] = useState(0);
    const revoke = (id) => setDevs((d) => d.map((x) => (x.id === id ? { ...x, revoked: true, sync: 'revoked', keySync: 'revoked' } : x)));
    const restore = (id) => setDevs((d) => d.map((x) => (x.id === id ? { ...x, revoked: false, sync: x.exec === 'local' ? 'synced' : 'session', keySync: x.exec === 'local' ? 'on' : 'n/a' } : x)));
    const doEnroll = () => { const n = Math.random().toString(16).slice(2, 6) + '·' + Math.random().toString(16).slice(2, 6); const nid = 'new-device-' + (enrollN + 1); setEnrollN((c) => c + 1); setDevs((d) => [{ id: nid, user: 'a.rao', platform: 'macOS 15 · pending', app: '0.4.2', cfg: 412, exec: 'local', models: 0, sync: 'synced', buffer: 0, last: 'just now', keySync: 'on', fp: 'ed25519:' + n, fresh: true }, ...d]); setEnroll(false); };
    const active = devs.filter((d) => !d.revoked);
    const local = active.filter((d) => d.exec === 'local').length;
    const offline = active.filter((d) => d.sync === 'offline').length;
    const stale = active.filter((d) => d.cfg < 412).length;
    const queued = active.reduce((s, d) => s + d.buffer, 0);

    const tile = (ic, label, value, sub, tone) => (
      <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)', borderRight: '1px solid var(--paper-edge)' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name={ic} size={16} tone={tone || 'soft'} /><span className="zs-eyebrow">{label}</span></div>
        <div style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 300, color: 'var(--ink)' }}>{value}</div>
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
      </div>
    );

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Governance" title="Device fleet" subMax={640}
          sub="Every enrolled device, where its calls execute, and its sync health. Revoking a device cuts its gateway access and stops key sync immediately."
          actions={<><button className="zs-btn zs-btn-primary" onClick={() => setEnroll(true)}><Icon name="plus" size={15} tone="paper" /> Enroll device</button><Pill icon="models">{active.length} enrolled</Pill></>} />

        {enroll && (
          <div className="card rise" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)', border: '1px solid var(--accent)' }}>
            <div className="card-hd"><span className="zs-eyebrow">Enroll a device</span><button onClick={() => setEnroll(false)} style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} tone="mute" /></button></div>
            <div style={{ padding: 'var(--space-5)' }}>
              <ol className="zs-body-sm" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>The desktop app generates an <b>Ed25519</b> keypair on-device — the private key never leaves it.</li>
                <li>It presents the <b>public key</b> to the gateway with a one-time enrolment code.</li>
                <li>The gateway binds a <b>device session</b> to that pubkey; every call is signed by it.</li>
              </ol>
              <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)' }}>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>enrolment code · <b style={{ color: 'var(--ink)' }}>NW-7F2A-C41D</b> · expires 10m</span>
                <span className="grow" />
                <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => setEnroll(false)}>Cancel</button>
                <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={doEnroll}><Icon name="check" size={13} tone="paper" /> Bind device session</button>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="flex" style={{ flexWrap: 'wrap' }}>
            {tile('models', 'On-device', local, 'run models locally', 'success')}
            {tile('globe', 'Via gateway', active.length - local, 'no local runtime')}
            {tile('bolt', 'Offline', offline, queued ? queued + ' calls queued' : 'all synced', offline ? 'warning' : 'soft')}
            <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)' }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name="history" size={16} tone={stale ? 'warning' : 'soft'} /><span className="zs-eyebrow">Config drift</span></div>
              <div style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 300, color: 'var(--ink)' }}>{stale}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>behind config v412</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">Enrolled devices</span></span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '820px' }}>
              <thead><tr><th>Device</th><th>User</th><th>Executes</th><th className="num">Local</th><th>Device key</th><th>Sync</th><th className="num">Seen</th><th></th></tr></thead>
              <tbody>
                {devs.map((d) => (
                  <tr key={d.id} style={{ opacity: d.revoked ? 0.5 : 1 }}>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.id}<div style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontWeight: 400 }}>{d.platform}</div></td>
                    <td className="mono" data-th="User">{d.user}</td>
                    <td data-th="Executes">{d.exec === 'local'
                      ? <span className="exec exec-local"><Icon name="models" size={12} tone="success" />on device</span>
                      : <span className="exec"><Icon name="globe" size={12} tone="mute" />via gateway</span>}</td>
                    <td className="num" data-th="Local">{d.models}</td>
                    <td className="mono" data-th="Device key" style={{ fontSize: 11, color: d.keySync === 'revoked' ? 'var(--accent)' : 'var(--ink-mute)' }}>{d.fp}{d.cfg < 412 && <span className="dtag warn" style={{ marginLeft: 6 }}>cfg stale</span>}{d.fresh && <span className="dtag" style={{ marginLeft: 6 }}>new</span>}</td>
                    <td className="mono" data-th="Sync" style={{ fontSize: 11, color: d.sync === 'offline' ? 'var(--warning)' : d.sync === 'revoked' ? 'var(--accent)' : 'var(--ink-mute)' }}>{d.sync}{d.buffer ? ' · ' + d.buffer + ' queued' : ''}</td>
                    <td className="num" data-th="Seen" style={{ color: 'var(--ink-mute)' }}>{d.last}</td>
                    <td>{d.revoked ? <span className="flex items-center gap-2"><span className="dtag warn">revoked</span><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => restore(d.id)}>Restore</button></span>
                      : confirm === d.id
                        ? <span className="flex items-center gap-1"><button className="zs-btn zs-btn-primary zs-btn-sm" style={{ background: 'var(--accent)' }} onClick={() => { revoke(d.id); setConfirm(null); }}>Confirm</button><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setConfirm(null)}>Cancel</button></span>
                        : <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setConfirm(d.id)}><Icon name="lock" size={12} tone="warning" /> Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Each device holds an <b>Ed25519</b> keypair; the gateway binds a session to its public key. Revoking is confirmed, then cuts the session and key sync immediately. Desktop devices run models on-box; the web client routes via the gateway and never holds keys.</span></div>
        </div>
      </div>
    );
  }

  window.DevicesView = DevicesView;
})();
