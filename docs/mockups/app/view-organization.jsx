/* Seiki · view-organization.jsx (admin)
   Multi-level hierarchy (org → department → team → user) with a budget at every
   level, each enforceable per day / week / month, plus people → team mapping. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, CardHead, CardFoot, Stats, ViewPad, Button, Table, Pill, Tag, Switch, PageHeader } = window.StrategosUI;
  const { money } = window.StrategosAPI;
  const { useState } = React;

  // Single source of truth — the canonical tree lives in data.jsx; Organization
  // edits a working copy of it, Billing and Onboarding render the same tree.
  const TREE = window.StrategosAPI.BUDGET_TREE;

  const { PERIODS, FACTOR, SUFFIX, KIND_ICON, DEPTS, ROLES, PEOPLE0, IDP, DISCOVERED, GROUPS0, CAPS, TIERS_R, ROLE_DEFS0 } = window.StrategosAPI.content.organization;
  const toneFor = (pct) => (pct >= 92 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--success)');

  // ── editable-tree helpers (ids let us mutate by identity, not name) ──
  let _nid = 0;
  function withIds(node) { if (!node.id) node.id = 'n' + (++_nid); (node.children || []).forEach(withIds); return node; }
  function findById(n, id) { if (n.id === id) return n; for (const c of (n.children || [])) { const r = findById(c, id); if (r) return r; } return null; }
  function dropById(n, id) { if (n.children) { n.children = n.children.filter((c) => c.id !== id); n.children.forEach((c) => dropById(c, id)); } }
  function sumCaps(n) { return (n.children || []).reduce((s, c) => s + (c.cap || 0), 0); }

  function Node({ node, depth, periodOf, setPeriod, rename, setCap, addChild, remove, setPol }) {
    const [open, setOpen] = useState(depth < 2);
    const [polOpen, setPolOpen] = useState(false);
    const period = periodOf(node.id);
    const f = FACTOR[period];
    const pct = node.cap ? Math.round((node.spent / node.cap) * 100) : 0;
    const col = toneFor(pct);
    const kids = node.children && node.children.length;
    const isUser = node.kind === 'user';
    const alloc = kids ? sumCaps(node) : 0;
    const over = kids && alloc > node.cap;

    return (
      <div>
        <div className="flex items-center gap-2.5 py-2 px-2.5 rounded" style={{ marginLeft: depth * 20,
          background: isUser ? 'var(--paper)' : 'transparent', border: '1px solid ' + (isUser ? 'var(--paper-edge)' : 'transparent') }}>
          <button type="button" onClick={() => kids && setOpen((o) => !o)} style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', color: 'var(--ink-mute)',
            visibility: kids ? 'visible' : 'hidden', cursor: kids ? 'pointer' : 'default', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }}>
            <Icon name="caret" size={11} tone="mute" />
          </button>
          <span className="w-[26px] h-[26px] rounded-[6px] shrink-0 grid place-items-center border bg-paper-soft">
            <Icon name={KIND_ICON[node.kind]} size={13} tone="soft" />
          </span>
          <div className="min-w-[150px] shrink-0">
            <input className="tree-name" value={node.name} onChange={(e) => rename(node.id, e.target.value)} spellCheck={false}
              style={{ width: '100%', font: (isUser ? '600 13px var(--font-mono)' : '600 13px var(--font-ui)') }} />
            <div className="flex gap-2 items-baseline pl-1">
              <span className="font-mono text-xs tracking-[0.1em] uppercase text-ink-mute">{node.kind}</span>
              {kids ? <span className="font-mono text-xs" style={{ color: over ? 'var(--danger)' : 'var(--ink-faint)' }}>alloc {money(alloc, 0)}/{money(node.cap, 0)}{over ? ' · over' : ''}</span> : null}
            </div>
          </div>
          <div className="flex-1 min-w-[50px]"><div className="track"><i style={{ width: Math.min(100, pct) + '%', background: col }} /></div></div>
          <div className="mono" style={{ minWidth: 132, display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
            <span className="text-ink">{money(node.spent * f, 0)}</span>/
            <input className="tree-cap" type="number" value={Math.round(node.cap * f)} onChange={(e) => setCap(node.id, (+e.target.value || 0) / f)}
              style={{ width: 58, font: '500 11.5px var(--font-mono)', textAlign: 'right' }} />
            <span className="text-ink-faint">/{SUFFIX[period]}</span>
          </div>
          <span className="min-w-[32px] text-right font-mono text-sm font-semibold" style={{ color: col }}>{pct}%</span>
          <div className="tabs sm shrink-0">
            {PERIODS.map(([p, lab]) => (
              <button key={p} className={'tab' + (period === p ? ' on' : '')} style={{ padding: '3px 7px', minWidth: 24, justifyContent: 'center' }} onClick={() => setPeriod(node.id, p)}>{lab}</button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={() => setPolOpen((v) => !v)} title="Budget policy" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)' }}><Icon name="settings" size={13} tone={polOpen ? 'accent' : 'faint'} /></button>
            {!isUser && <button type="button" onClick={() => { addChild(node.id); setOpen(true); }} title="Add a level under this" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)' }}><Icon name="plus" size={14} tone="mute" /></button>}
            {depth > 0 && <button type="button" onClick={() => remove(node.id)} title="Remove" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-sm)' }}><Icon name="trash" size={13} tone="faint" /></button>}
          </div>
        </div>
        {polOpen && (() => { const pol = node.pol || { type: 'hard', alert: 90, floor: true }; return (
          <div className="rise mt-1 mb-1.5 py-2 px-3 border rounded bg-paper-soft flex items-center gap-6 flex-wrap" style={{ marginLeft: depth * 20 + 44}}>
            <span className="flex items-center gap-2"><span className="zs-eyebrow m-0">Cap</span>
              <span className="inline-flex border rounded overflow-hidden">
                {['hard', 'soft'].map((tp, j) => { const on = pol.type === tp; return <button key={tp} onClick={() => setPol(node.id, { type: tp })} style={{ height: 24, padding: '0 10px', fontSize: 11, fontWeight: 500, borderLeft: j ? '1px solid var(--paper-edge)' : 'none', background: on ? (tp === 'hard' ? 'var(--ink)' : 'var(--warning)') : 'transparent', color: on ? 'var(--on-primary)' : 'var(--ink-soft)', textTransform: 'capitalize' }}>{tp}</button>; })}
              </span>
            </span>
            <span className="flex items-center gap-2"><span className="zs-eyebrow m-0">Alert at</span><input type="number" min="0" max="100" value={pol.alert} onChange={(e) => setPol(node.id, { alert: +e.target.value })} style={{ width: 52, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '3px 6px', textAlign: 'right' }} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>%</span></span>
            <span className="flex items-center gap-2"><span className="zs-eyebrow m-0">Free floor</span><Switch on={pol.floor} onClick={() => setPol(node.id, { floor: !pol.floor })} label="Free floor" /></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-faint)' }}>{pol.type === 'hard' ? 'blocks at 100% → free floor' : 'warns, keeps serving'} · {SUFFIX[period]}</span>
          </div>
        ); })()}
        {kids && open && <div className="mt-0.5">{node.children.map((c) => <Node key={c.id} node={c} depth={depth + 1} periodOf={periodOf} setPeriod={setPeriod} rename={rename} setCap={setCap} addChild={addChild} remove={remove} setPol={setPol} />)}</div>}
      </div>
    );
  }

  /* ── people → team mapping ── */
  // one capability model across the product: Owner · Admin · Editor · Viewer

  function Cell({ value, options, onChange }) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '3px 6px', cursor: 'pointer' }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  function People() {
    const [people, setPeople] = useState(PEOPLE0);
    const update = (i, patch) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    return (
      <Card className="overflow-hidden mt-6">
        <CardHead>
          <span className="flex items-center gap-2"><Icon name="role" size={15} tone="soft" /><span className="zs-eyebrow">People → teams</span></span>
          <Button variant="secondary" size="sm"><Icon name="plus" size={13} tone="soft" /> Invite</Button>
        </CardHead>
        <div className="overflow-x-auto">
          <Table min={680}>
            <thead><tr><th>User</th><th>Department</th><th>Team</th><th>Role</th><th className="num">Monthly cap</th><th className="num">MTD</th></tr></thead>
            <tbody>
              {people.map((p, i) => {
                const teams = DEPTS[p.dept] || ['—'];
                const team = teams.includes(p.team) ? p.team : teams[0];
                const pct = Math.round((p.mtd / p.cap) * 100);
                return (
                  <tr key={p.user}>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{p.user}</td>
                    <td data-th="Department"><Cell value={p.dept} options={Object.keys(DEPTS)} onChange={(v) => update(i, { dept: v, team: (DEPTS[v] || ['—'])[0] })} /></td>
                    <td data-th="Team"><Cell value={team} options={teams} onChange={(v) => update(i, { team: v })} /></td>
                    <td data-th="Role"><Cell value={p.role} options={ROLES} onChange={(v) => update(i, { role: v })} /></td>
                    <td className="num" data-th="Monthly cap">{money(p.cap, 0)}</td>
                    <td className="num" data-th="MTD" style={{ color: pct >= 92 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--ink-mute)' }}>{money(p.mtd, 0)} · {pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Reassigning a user moves their spend under the new team's cap immediately. Service accounts don’t take seats — manage them in <b>API identities</b>. Caps cascade upward — a call needs headroom at user, team, department <em>and</em> org.</span></CardFoot>
      </Card>
    );
  }

  /* ── identity provider → directory import ──
     Admins link an existing IdP over SAML, then pull departments, teams, roles
     and people straight from the directory. SCIM keeps them current. */

  function IdentityDirectory() {
    const [provider, setProvider] = useState(null);   // linked IdP, or null
    const [pick, setPick] = useState('okta');          // pre-link selection
    const [picks, setPicks] = useState({ dept: true, team: true, role: true, user: true });
    const [mapping, setMapping] = useState(() => Object.fromEntries(GROUPS0.map((g) => [g.group, g.role])));
    const [syncing, setSyncing] = useState(false);
    const [imported, setImported] = useState(false);

    const selected = IDP.find((p) => p.id === pick);
    const link = () => setProvider(selected);
    const unlink = () => { setProvider(null); setImported(false); };
    const togglePick = (k) => setPicks((p) => ({ ...p, [k]: !p[k] }));
    const runImport = () => {
      setSyncing(true);
      setTimeout(() => { setSyncing(false); setImported(true); }, 900);
    };

    return (
      <Card className="overflow-hidden mb-6">
        <CardHead>
          <span className="flex items-center gap-2"><Icon name="sso" size={15} tone="soft" /><span className="zs-eyebrow">Identity &amp; directory</span></span>
          <span className="flex items-center gap-2">
            <span className="dtag warn">fast-follow</span>
            {provider
              ? <span className="status text-success"><span className="dot" style={{ background: 'var(--success)' }} />linked · {provider.name}</span>
              : <span className="status text-ink-faint"><span className="dot" style={{ background: 'var(--ink-faint)' }} />not yet enabled</span>}
          </span>
        </CardHead>
        <div className="flex items-center gap-2 mt-4 mx-6 mb-0 py-2.5 px-3 rounded bg-paper-mute border text-sm text-ink-soft">
          <Icon name="info" size={15} tone="mute" />
          <span>Live sign-in today is <b style={{ color: 'var(--ink)' }}>email + Google/GitHub OAuth</b>. SAML SSO &amp; SCIM directory sync are <b style={{ color: 'var(--ink)' }}>fast-follow</b> — the flow below is designed, not yet enabled.</span>
        </div>

        {!provider ? (
          /* ── stage A · choose + link an identity provider ── */
          <div className="p-6">
            <p className="zs-body mt-0 mb-6 max-w-[640px]">
              Link your existing SSO over SAML, then pull departments, teams, roles and people straight from your directory — no re-keying. SCIM keeps them in sync as your org changes.
            </p>
            <Stats tight>
              {IDP.map((p) => {
                const on = pick === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setPick(p.id)} style={{ textAlign: 'left', padding: '16px', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 12,
                    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent-soft)' : 'var(--paper)' }}>
                    <span className="flex items-center justify-between">
                      <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center font-display font-semibold text-[14px]" style={{
                        background: on ? 'var(--accent)' : 'var(--paper-mute)', color: on ? 'var(--paper)' : 'var(--ink)' }}>{p.mark}</span>
                      <span className="w-[16px] h-[16px] rounded-full grid place-items-center" style={{ border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)') }}>
                        {on && <span className="w-[8px] h-[8px] rounded-full bg-accent" />}
                      </span>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink">{p.name}</span>
                      <span className="block font-mono text-xs text-ink-mute mt-0.5">{p.proto}</span>
                    </span>
                  </button>
                );
              })}
            </Stats>
            <div className="flex items-center justify-between mt-6 flex-wrap gap-3">
              <span className="zs-body-sm flex items-center gap-2 text-[12px]"><Icon name="lock" size={13} tone="success" /> Read-only directory scope — passwords stay with {selected.name}.</span>
              <Button className="opacity-55" variant="primary" onClick={link} disabled title="Fast-follow — not yet enabled"><Icon name="sso" size={15} tone="paper" /> Link {selected.name} · fast-follow</Button>
            </div>
          </div>
        ) : (
          /* ── stage B · connected · pick what to import + map roles ── */
          <div>
            <div className="flex items-center gap-3 py-4 px-6 border-b">
              <span className="w-[30px] h-[30px] rounded-[8px] grid place-items-center shrink-0 font-display font-semibold text-[14px] bg-accent text-paper">{provider.mark}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">{provider.name}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{provider.domain}</div>
              </div>
              <Tag>SAML 2.0</Tag>
              <Tag>SCIM</Tag>
              <Button variant="secondary" size="sm" onClick={runImport} disabled={syncing}><Icon name="refresh" size={13} tone="soft" /> Sync now</Button>
              <button type="button" onClick={unlink} aria-label="Disconnect provider" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28 }}><Icon name="close" size={15} tone="mute" /></button>
            </div>

            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="zs-eyebrow">Found in directory</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>last sync · {imported ? 'just now' : '—'}</span>
              </div>
              <Stats tight>
                {DISCOVERED.map((d) => {
                  const on = picks[d.k];
                  return (
                    <button key={d.k} type="button" onClick={() => togglePick(d.k)} style={{ textAlign: 'left', padding: '16px', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: 12,
                      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent-soft)' : 'var(--paper)' }}>
                      <span className="w-[18px] h-[18px] rounded-[5px] shrink-0 grid place-items-center" style={{ border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent)' : 'transparent' }}>
                        {on && <Icon name="check" size={12} tone="paper" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display font-light text-xl text-ink leading-[1]">{d.n}</span>
                        <span className="flex items-center gap-1 mt-1"><Icon name={d.ic} size={12} tone="mute" /><span className="text-sm text-ink-mute">{d.label}</span></span>
                      </span>
                    </button>
                  );
                })}
              </Stats>

              <div className="zs-eyebrow mt-6 mx-0 mb-3">Map directory groups → roles</div>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <thead><tr><th>Directory group</th><th className="num">Members</th><th>Seiki role</th></tr></thead>
                  <tbody>
                    {GROUPS0.map((g) => (
                      <tr key={g.group}>
                        <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{g.group}</td>
                        <td className="num">{g.members}</td>
                        <td>
                          <select value={mapping[g.group]} onChange={(e) => setMapping((m) => ({ ...m, [g.group]: e.target.value }))} disabled={!picks.role}
                            style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '3px 6px', cursor: picks.role ? 'pointer' : 'default', opacity: picks.role ? 1 : 0.5 }}>
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </div>

            <CardFoot dashed className="justify-between gap-4">
              {imported
                ? <span className="flex items-center gap-2"><Icon name="check" size={14} tone="success" /><span>Imported <b style={{ color: 'var(--ink)' }}>3 departments</b>, <b style={{ color: 'var(--ink)' }}>4 teams</b>, <b style={{ color: 'var(--ink)' }}>4 roles</b> and <b style={{ color: 'var(--ink)' }}>142 people</b> — mapped into the hierarchy below. SCIM keeps them current.</span></span>
                : <span className="flex items-center gap-2"><Icon name="info" size={14} tone="mute" /><span>Existing budgets and caps are preserved — only structure, roles and people are added.</span></span>}
              <Button className="shrink-0" variant="primary" onClick={runImport} disabled={syncing}>
                <Icon name={imported ? 'refresh' : 'upload'} size={14} tone="paper" /> {syncing ? 'Importing…' : imported ? 'Re-sync' : 'Import directory'}
              </Button>
            </CardFoot>
          </div>
        )}
      </Card>
    );
  }

  /* ── custom roles & permission matrix ──
     Roles are not a fixed four — admins define granular capability grants and
     per-role model-tier allow-lists. Space overrides may tighten, never loosen. */

  function GrantCell({ on, onClick, label }) {
    return (
      <button onClick={onClick} title={label} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 'var(--radius-sm)',
        background: on ? 'var(--success-soft)' : 'var(--paper-mute)', border: '1px solid ' + (on ? 'oklch(0.6 0.08 150 / 0.35)' : 'var(--paper-edge)'), cursor: 'pointer' }}>
        <Icon name={on ? 'check' : 'close'} size={13} tone={on ? 'success' : 'mute'} />
      </button>
    );
  }

  function RolesMatrix() {
    const [roles, setRoles] = useState(() => structuredClone(ROLE_DEFS0));
    const flip = (ri, group, key) => setRoles((rs) => rs.map((r, i) => (i === ri ? { ...r, [group]: { ...r[group], [key]: r[group][key] ? 0 : 1 } } : r)));
    const rename = (ri, name) => setRoles((rs) => rs.map((r, i) => (i === ri ? { ...r, name } : r)));
    const addRole = () => setRoles((rs) => [...rs, { name: 'Custom ' + (rs.filter((r) => r.custom).length + 1), custom: true, caps: { configure: 0, governance: 0, budgets: 0, members: 0, content: 1, share: 0, tools: 1, export: 1, apikeys: 0 }, tiers: { frontier: 0, balanced: 1, fast: 1, local: 1 } }]);
    const removeRole = (ri) => setRoles((rs) => rs.filter((_, i) => i !== ri));

    return (
      <Card className="overflow-hidden mt-6">
        <CardHead>
          <span className="flex items-center gap-2"><Icon name="role" size={15} tone="soft" /><span className="zs-eyebrow">Roles & permissions</span></span>
          <Button variant="secondary" size="sm" onClick={addRole}><Icon name="plus" size={13} tone="soft" /> New role</Button>
        </CardHead>
        <div className="overflow-x-auto">
          <table className="tbl" style={{ minWidth: 200 + roles.length * 92 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Capability</th>
                {roles.map((r, ri) => (
                  <th key={ri} className="num" style={{ minWidth: 88 }}>
                    {r.custom
                      ? <span className="flex items-center gap-1 justify-end">
                          <input value={r.name} onChange={(e) => rename(ri, e.target.value)} spellCheck={false} style={{ width: 66, font: '600 11px var(--font-ui)', textAlign: 'right', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', color: 'var(--ink)', padding: '2px 4px' }} />
                          <button onClick={() => removeRole(ri)} title="Remove role" style={{ display: 'grid', placeItems: 'center' }}><Icon name="trash" size={12} tone="faint" /></button>
                        </span>
                      : r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPS.map(([k, label, sub]) => (
                <tr key={k}>
                  <td><div className="text-ink font-semibold text-sm">{label}</div><div className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{sub}</div></td>
                  {roles.map((r, ri) => (
                    <td key={ri} className="num" style={{ textAlign: 'center' }}><GrantCell on={!!r.caps[k]} onClick={() => flip(ri, 'caps', k)} label={label + ' · ' + r.name} /></td>
                  ))}
                </tr>
              ))}
              <tr><td colSpan={roles.length + 1} style={{ background: 'var(--paper-soft)', padding: '6px 24px' }}><span className="zs-eyebrow">Allowed model tiers</span></td></tr>
              {TIERS_R.map(([k, label]) => (
                <tr key={k}>
                  <td><div className="text-ink font-semibold text-sm">{label} tier</div></td>
                  {roles.map((r, ri) => (
                    <td key={ri} className="num" style={{ textAlign: 'center' }}><GrantCell on={!!r.tiers[k]} onClick={() => flip(ri, 'tiers', k)} label={label + ' tier · ' + r.name} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardFoot dashed><Icon name="lock" size={14} tone="mute" /><span>Capabilities and model-tier access are granted per role here. A space owner may <b>tighten</b> these in Space settings but never loosen them beyond the role’s grant.</span></CardFoot>
      </Card>
    );
  }

  function OrganizationView() {
    const [tree, setTree] = useState(() => withIds(structuredClone(TREE)));
    const [periodMap, setPeriodMap] = useState({});
    const periodOf = (id) => periodMap[id] || 'monthly';
    const setPeriod = (id, p) => setPeriodMap((m) => ({ ...m, [id]: p }));
    const setAll = (p) => { const all = {}; (function walk(n) { all[n.id] = p; (n.children || []).forEach(walk); })(tree); setPeriodMap(all); };
    const edit = (fn) => setTree((prev) => { const c = structuredClone(prev); fn(c); return c; });
    const rename = (id, name) => edit((c) => { const t = findById(c, id); if (t) t.name = name; });
    const setCap = (id, cap) => edit((c) => { const t = findById(c, id); if (t) t.cap = Math.max(0, Math.round(cap)); });
    const setPol = (id, patch) => edit((c) => { const t = findById(c, id); if (t) t.pol = Object.assign({ type: 'hard', alert: 90, floor: true }, t.pol, patch); });
    const addChild = (id) => edit((c) => { const t = findById(c, id); if (t) { const kind = t.kind === 'org' ? 'dept' : t.kind === 'dept' ? 'team' : 'user'; t.children = t.children || []; t.children.push(withIds({ name: kind === 'user' ? 'new.user' : 'New ' + kind, kind, cap: 500, spent: 0 })); } });
    const remove = (id) => edit((c) => dropById(c, id));
    const left = tree.cap - tree.spent;

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Organization" title="Hierarchy & budgets" subMax={640}
          sub={<>Model your org as it really is — add levels, rename them, and set a cap on each. Caps cascade: a call needs headroom at user, team, department <em>and</em> org. Click any name or cap to edit.</>}
          actions={<Pill kind="success"><span className="dot" style={{ background: 'var(--success)' }} />{money(left, 0)} left this month</Pill>} />

        <IdentityDirectory />

        <Card className="overflow-hidden">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="org" size={15} tone="soft" /><span className="zs-eyebrow">Budget hierarchy</span></span>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => addChild(tree.id)}><Icon name="plus" size={13} tone="soft" /> Add department</Button>
              <span className="zs-meta text-[10px]">SET ALL TO</span>
              <div className="tabs sm">
                {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([p, lab]) => (
                  <button key={p} className="tab" onClick={() => setAll(p)}>{lab}</button>
                ))}
              </div>
            </div>
          </CardHead>
          <div className="pt-3 px-4 pb-4">
            <Node node={tree} depth={0} periodOf={periodOf} setPeriod={setPeriod} rename={rename} setCap={setCap} addChild={addChild} remove={remove} setPol={setPol} />
          </div>
          <CardFoot dashed><Icon name="calendar" size={14} tone="mute" /><span>Each level shows <b>alloc</b> — the sum of its children’s caps against its own. Over-allocate and it turns red. Click the <b>gear</b> on any node to set its <b>hard/soft</b> cap, <b>alert threshold</b> and <b>free-floor</b>; <Tag>D</Tag> <Tag>W</Tag> <Tag>M</Tag> set each level’s enforcement window.</span></CardFoot>
        </Card>

        <People />
        <RolesMatrix />
      </ViewPad>
    );
  }

  window.OrganizationView = OrganizationView;
})();
