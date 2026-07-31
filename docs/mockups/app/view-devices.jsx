/* Seiki · view-devices.jsx
   Device fleet — every enrolled device, where it executes, its app/config
   version, sync & offline-buffer health, and the revoke lever (kills a
   device's gateway access + key sync). */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Button, Table, Pill, Meter, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const { DEVICES0 } = window.StrategosAPI.content.devices;

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
      <div className="flex-1 min-w-0 p-4 border-r">
        <div className="flex items-center gap-2 mb-2"><Icon name={ic} size={16} tone={tone || 'soft'} /><span className="zs-eyebrow">{label}</span></div>
        <div className="text-xl font-display font-light text-ink">{value}</div>
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
      </div>
    );

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Governance" title="Device fleet" subMax={640}
          sub="Every enrolled device, where its calls execute, and its sync health. Revoking a device cuts its gateway access and stops key sync immediately."
          actions={<><Button variant="primary" onClick={() => setEnroll(true)}><Icon name="plus" size={15} tone="paper" /> Enroll device</Button><Pill icon="models">{active.length} enrolled</Pill></>} />

        {enroll && (
          <Card className="rise overflow-hidden mb-6 border border-accent">
            <CardHead><span className="zs-eyebrow">Enroll a device</span><button onClick={() => setEnroll(false)} style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} tone="mute" /></button></CardHead>
            <div className="p-6">
              <ol className="zs-body-sm m-0 pl-4 leading-[1.9]">
                <li>Torii generates an <b>Ed25519</b> keypair on-device — the private key never leaves it.</li>
                <li>It presents the <b>public key</b> to the gateway with a one-time enrolment code.</li>
                <li>The gateway binds a <b>device session</b> to that pubkey; every call is signed by it.</li>
              </ol>
              <div className="flex items-center gap-2 mt-4">
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>enrolment code · <b style={{ color: 'var(--ink)' }}>NW-7F2A-C41D</b> · expires 10m</span>
                <span className="flex-1" />
                <Button variant="secondary" size="sm" onClick={() => setEnroll(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={doEnroll}><Icon name="check" size={13} tone="paper" /> Bind device session</Button>
              </div>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden mb-6">
          <div className="flex flex-wrap">
            {tile('models', 'On-device', local, 'run models locally', 'success')}
            {tile('globe', 'Via gateway', active.length - local, 'no local runtime')}
            {tile('bolt', 'Offline', offline, queued ? queued + ' calls queued' : 'all synced', offline ? 'warning' : 'soft')}
            <div className="flex-1 min-w-0 p-4">
              <div className="flex items-center gap-2 mb-2"><Icon name="history" size={16} tone={stale ? 'warning' : 'soft'} /><span className="zs-eyebrow">Config drift</span></div>
              <div className="text-xl font-display font-light text-ink">{stale}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>behind config v412</div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHead><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">Enrolled devices</span></span></CardHead>
          <div className="overflow-x-auto">
            <Table min={820}>
              <thead><tr><th>Device</th><th>User</th><th>Executes</th><th className="num">Local</th><th>Device key</th><th>Sync</th><th className="num">Seen</th><th></th></tr></thead>
              <tbody>
                {devs.map((d) => (
                  <tr key={d.id} style={{ opacity: d.revoked ? 0.5 : 1 }}>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.id}<div className="text-[10.5px] text-ink-faint font-normal">{d.platform}</div></td>
                    <td className="mono" data-th="User">{d.user}</td>
                    <td data-th="Executes">{d.exec === 'local'
                      ? <span className="exec exec-local"><Icon name="models" size={12} tone="success" />on device</span>
                      : <span className="exec"><Icon name="globe" size={12} tone="mute" />via gateway</span>}</td>
                    <td className="num" data-th="Local">{d.models}</td>
                    <td className="mono" data-th="Device key" style={{ fontSize: 11, color: d.keySync === 'revoked' ? 'var(--accent)' : 'var(--ink-mute)' }}>{d.fp}{d.cfg < 412 && <span className="dtag warn ml-1.5">cfg stale</span>}{d.fresh && <span className="dtag ml-1.5">new</span>}</td>
                    <td className="mono" data-th="Sync" style={{ fontSize: 11, color: d.sync === 'offline' ? 'var(--warning)' : d.sync === 'revoked' ? 'var(--accent)' : 'var(--ink-mute)' }}>{d.sync}{d.buffer ? ' · ' + d.buffer + ' queued' : ''}</td>
                    <td className="num" data-th="Seen" style={{ color: 'var(--ink-mute)' }}>{d.last}</td>
                    <td>{d.revoked ? <span className="flex items-center gap-2"><span className="dtag warn">revoked</span><Button variant="ghost" size="sm" onClick={() => restore(d.id)}>Restore</Button></span>
                      : confirm === d.id
                        ? <span className="flex items-center gap-1"><Button className="bg-accent" variant="primary" size="sm" onClick={() => { revoke(d.id); setConfirm(null); }}>Confirm</Button><Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>Cancel</Button></span>
                        : <Button variant="ghost" size="sm" onClick={() => setConfirm(d.id)}><Icon name="lock" size={12} tone="warning" /> Revoke</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Each device holds an <b>Ed25519</b> keypair; the gateway binds a session to its public key. Revoking is confirmed, then cuts the session and key sync immediately. Desktop devices run models on-box; the web client routes via the gateway and never holds keys.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.DevicesView = DevicesView;
})();
