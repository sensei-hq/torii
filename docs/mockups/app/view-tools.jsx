/* Strategos Admin · view-tools.jsx
   Tools & MCP servers — register MCP servers (stdio for desktop, http/sse
   for shared) and set tool allow-lists per role. v1 scope. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const SERVERS0 = [
    { id: 'finance-warehouse', transport: 'http', scope: 'shared',  exec: 'gateway',   tools: 4, status: 'healthy', url: 'https://mcp.northwind/finance', note: 'SQL over finance.*' },
    { id: 'file-export',       transport: 'sse',  scope: 'shared',  exec: 'gateway',   tools: 3, status: 'healthy', url: 'https://mcp.northwind/files',   note: 'csv · xlsx · pdf' },
    { id: 'code-interpreter',  transport: 'stdio', scope: 'desktop', exec: 'on-device', tools: 1, status: 'healthy', url: 'stdio://sandboxed-python',      note: 'sandboxed python · on-box' },
    { id: 'web-fetch',         transport: 'http', scope: 'shared',  exec: 'gateway',   tools: 1, status: 'restricted', url: 'https://mcp.northwind/web',    note: 'external URLs · off by default' },
  ];
  const ROLES = ['Owner', 'Admin', 'Editor', 'Viewer'];
  const TOOLS = [
    { id: 'sql',    name: 'Warehouse SQL',    server: 'finance-warehouse', grants: { Owner: true, Admin: true, Editor: true, Viewer: false } },
    { id: 'export', name: 'File export',      server: 'file-export',       grants: { Owner: true, Admin: true, Editor: true, Viewer: true } },
    { id: 'code',   name: 'Code interpreter', server: 'code-interpreter',  grants: { Owner: true, Admin: true, Editor: false, Viewer: false } },
    { id: 'web',    name: 'Web fetch',        server: 'web-fetch',         grants: { Owner: true, Admin: false, Editor: false, Viewer: false } },
  ];
  const TRANSPORT = { stdio: ['stdio', 'var(--ink-mute)'], http: ['http', 'var(--ink-mute)'], sse: ['sse', 'var(--ink-mute)'] };
  const SPACES = [['all', 'Role default'], ['leasing', 'Leasing Ops'], ['finance', 'Finance'], ['support', 'Support']];

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
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Gateway" title="Tools & MCP servers" subMax={660}
          sub="Register the MCP servers your org exposes — stdio for on-device desktop tools, http/sse for shared gateway tools — and decide which roles may call each tool."
          actions={<button className="zs-btn zs-btn-primary"><Icon name="plus" size={15} tone="paper" /> Register server</button>} />

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="router" size={15} tone="soft" /><span className="zs-eyebrow">MCP servers</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{servers.filter((s) => s.status !== 'off').length} of {servers.length} active</span></div>
          {servers.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: s.status === 'off' ? 0.55 : 1 }}>
              <span className="glyph" style={{ width: 32, height: 32 }}><Icon name={s.exec === 'on-device' ? 'models' : 'globe'} size={16} tone={s.exec === 'on-device' ? 'success' : 'soft'} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{s.id}</span>
                  <span className="tag">{TRANSPORT[s.transport][0]}</span>
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
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span><b>stdio</b> servers run inside the desktop app (on-device, no egress). <b>http/sse</b> servers are shared and run via the gateway.</span></div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Tool allow-list</span></span>
            <span className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <span className="zs-eyebrow" style={{ marginRight: 2 }}>Space</span>
              {SPACES.map(([id, lab]) => { const on = space === id; return <button key={id} onClick={() => setSpace(id)} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>; })}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '640px' }}>
              <thead><tr><th>Tool</th>{ROLES.map((r) => <th key={r} className="num">{r}</th>)}</tr></thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.id}>
                    <td><div style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t.name}</div><div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t.server}</div></td>
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
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>{space === 'all' ? <>Editing the <b>role default</b>. Pick a space to tighten it — a space may remove a tool a role allows, but never grant one the role denies.</> : <>Editing <b style={{ color: 'var(--ink)' }}>{(SPACES.find((s) => s[0] === space) || [])[1]}</b>. Greyed cells are denied by the role and can’t be granted here.</>}</span></div>
        </div>
      </div>
    );
  }

  window.ToolsView = ToolsView;
})();
