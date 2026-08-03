/* Seiki · view-tools.jsx
   Tools & MCP servers — register MCP servers (stdio for desktop, http/sse
   for shared) and set tool allow-lists per role. v1 scope. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, Tag, CardFoot, Button, Table, Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const { SERVERS0, ROLES, TOOLS, TRANSPORT, SPACES } = window.StrategosAPI.content.tools;

  function ToolsView() {
    const [servers, setServers] = useState(SERVERS0);
    const [grants, setGrants] = useState(() => Object.fromEntries(TOOLS.map((t) => [t.id, { ...t.grants }])));
    const flip = (tid, role) => setGrants((g) => ({ ...g, [tid]: { ...g[tid], [role]: !g[tid][role] } }));
    const toggleServer = (id) => setServers((s) => s.map((x) => (x.id === id ? { ...x, status: x.status === 'off' ? 'healthy' : x.status === 'restricted' ? 'off' : 'off' } : x)));
    // per-space overrides tighten the role default (a space may only remove a grant)
    const [space, setSpace] = useState('all');
    const [spaceOff, setSpaceOff] = useState({});   // space → tool → role → true(disallowed)
    const roleAllows = (tid, role) => grants[tid][role];
    const cellAllowed = (tid, role) => { if (!roleAllows(tid, role)) return false; if (space === 'all') return true; return !((spaceOff[space] || {})[tid] || {})[role]; };
    const clickCell = (tid, role) => {
      if (space === 'all') { flip(tid, role); return; }
      if (!roleAllows(tid, role)) return;   // can't grant what the role denies
      setSpaceOff((o) => { const n = { ...o }; n[space] = { ...(n[space] || {}) }; n[space][tid] = { ...(n[space][tid] || {}) }; n[space][tid][role] = !n[space][tid][role]; return n; });
    };

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Gateway" title="Tools & MCP servers" subMax={660}
          sub="Register the MCP servers your org exposes — stdio for on-device desktop tools, http/sse for shared gateway tools — and decide which roles may call each tool."
          actions={<Button variant="primary"><Icon name="plus" size={15} tone="paper" /> Register server</Button>} />

        <Card className="overflow-hidden mb-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="router" size={15} tone="soft" /><span className="zs-eyebrow">MCP servers</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{servers.filter((s) => s.status !== 'off').length} of {servers.length} active</span></CardHead>
          {servers.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: s.status === 'off' ? 0.55 : 1 }}>
              <span className="glyph w-[32px] h-[32px]"><Icon name={s.exec === 'on-device' ? 'models' : 'globe'} size={16} tone={s.exec === 'on-device' ? 'success' : 'soft'} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{s.id}</span>
                  <Tag>{TRANSPORT[s.transport][0]}</Tag>
                  <span className="dtag">{s.scope}</span>
                  {s.exec === 'on-device'
                    ? <span className="exec exec-local"><Icon name="models" size={12} tone="success" />on device</span>
                    : <span className="exec"><Icon name="globe" size={12} tone="mute" />gateway</span>}
                </div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{s.url} · {s.tools} tools · {s.note}</div>
              </div>
              {s.status === 'restricted' && <span className="dtag warn">restricted</span>}
              <span className="status" style={{ color: s.status === 'off' ? 'var(--ink-faint)' : 'var(--success)' }}><span className="dot" style={{ background: s.status === 'off' ? 'var(--ink-faint)' : 'var(--success)' }} />{s.status === 'off' ? 'disabled' : 'healthy'}</span>
              <Switch on={s.status !== 'off'} onClick={() => toggleServer(s.id)} label={'Enable ' + s.id} />
            </div>
          ))}
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span><b>stdio</b> servers run inside Torii (on-device, no egress). <b>http/sse</b> servers are shared and run via the gateway.</span></CardFoot>
        </Card>

        <Card className="overflow-hidden">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Tool allow-list</span></span>
            <span className="flex items-center gap-2 flex-wrap">
              <span className="zs-eyebrow mr-0.5">Space</span>
              {SPACES.map(([id, lab]) => { const on = space === id; return <button key={id} onClick={() => setSpace(id)} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>; })}
            </span>
          </CardHead>
          <div className="overflow-x-auto">
            <Table min={640}>
              <thead><tr><th>Tool</th>{ROLES.map((r) => <th key={r} className="num">{r}</th>)}</tr></thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.id}>
                    <td><div className="text-ink font-semibold text-sm">{t.name}</div><div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t.server}</div></td>
                    {ROLES.map((r) => {
                      const allowed = cellAllowed(t.id, r);
                      const locked = space !== 'all' && !roleAllows(t.id, r);   // role denies → space can't grant
                      const overridden = space !== 'all' && roleAllows(t.id, r) && !allowed;
                      return (
                        <td key={r} className="num" data-th={r} style={{ textAlign: 'center' }}>
                          <button onClick={() => clickCell(t.id, r)} disabled={locked} title={locked ? 'Denied by role — a space can’t grant it' : overridden ? 'Removed for this space' : (allowed ? 'Allowed' : 'Blocked') + ' for ' + r}
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 'var(--radius-sm)', cursor: locked ? 'not-allowed' : 'pointer',
                              background: allowed ? 'var(--success-soft)' : 'var(--paper-mute)', border: '1px solid ' + (allowed ? 'oklch(0.6 0.08 150 / 0.35)' : 'var(--paper-edge)'), opacity: locked ? 0.5 : 1 }}>
                            <Icon name={allowed ? 'check' : locked ? 'lock' : 'close'} size={13} tone={allowed ? 'success' : 'mute'} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <CardFoot dashed><Icon name="lock" size={14} tone="mute" /><span>{space === 'all' ? <>Editing the <b>role default</b>. Pick a space to tighten it — a space may remove a tool a role allows, but never grant one the role denies.</> : <>Editing <b style={{ color: 'var(--ink)' }}>{(SPACES.find((s) => s[0] === space) || [])[1]}</b>. Greyed cells are denied by the role and can’t be granted here.</>}</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.ToolsView = ToolsView;
})();
