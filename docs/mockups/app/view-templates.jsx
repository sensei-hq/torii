/* Strategos Admin · view-templates.jsx
   Prompt & template library — the shared, versioned prompts that power Ask's
   "Draft" and saved workflows, scoped per space. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, PageHeader } = window.StrategosUI;
  const { PROMPT_TEMPLATES } = window.StrategosData;
  const { useState } = React;

  // enrich the shared catalog with library metadata
  const BASE = PROMPT_TEMPLATES.map((t, i) => ({
    id: t.id, name: t.name, space: t.space, by: t.by, body: t.body,
    version: [3, 2, 4][i] || 1, uses: [128, 64, 210][i] || 12, published: true,
    scope: t.shared ? 'space' : 'private', updated: ['3d ago', '1w ago', '2d ago'][i] || 'today',
  }));
  const EXTRA = [
    { id: 'tpl-notice', name: 'Renewal notice', space: 'Leasing Ops', by: 'm.okafor', body: 'Draft a renewal notice for {unit} at {rent}, effective {date}.', version: 5, uses: 340, published: true, scope: 'space', updated: '5d ago' },
    { id: 'tpl-cfo',    name: 'CFO variance brief', space: 'Finance', by: 'a.rao', body: 'Summarize the month’s budget variance in five bullets for the CFO.', version: 2, uses: 41, published: false, scope: 'private', updated: 'today' },
    { id: 'tpl-tenant', name: 'Tenant reply — empathetic', space: 'Support', by: 'a.rao', body: 'Reply to the tenant’s complaint about {issue}, acknowledge and give next steps.', version: 7, uses: 512, published: true, scope: 'tenant', updated: '1d ago' },
  ];
  const ALL = [...BASE, ...EXTRA];
  const SCOPE = { private: ['private', 'var(--ink-mute)'], space: ['space', 'var(--accent)'], tenant: ['tenant', 'var(--success)'] };

  function TemplatesView() {
    const [rows, setRows] = useState(ALL);
    const [q, setQ] = useState('');
    const [scope, setScope] = useState('all');
    const publish = (id) => setRows((r) => r.map((x) => (x.id === id ? { ...x, published: !x.published, scope: x.published ? 'private' : 'space' } : x)));

    const shown = rows.filter((r) => (scope === 'all' || r.scope === scope) && (!q || (r.name + r.space + r.body).toLowerCase().includes(q.toLowerCase())));
    const published = rows.filter((r) => r.published).length;
    const totalUses = rows.reduce((s, r) => s + r.uses, 0);

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Gateway" title="Prompt library" subMax={660}
          sub="The shared, versioned prompts behind Ask’s Draft and saved workflows. Publish one to a space or the whole tenant so members reuse it instead of starting cold."
          actions={<button className="zs-btn zs-btn-primary"><Icon name="plus" size={15} tone="paper" /> New template</button>} />

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="flex" style={{ flexWrap: 'wrap' }}>
            {[['grid', 'Templates', rows.length, 'in the library'], ['check', 'Published', published, 'live to members'], ['history', 'Uses · 30d', totalUses.toLocaleString(), 'across Ask & workflows']].map(([ic, lab, val, sub], i) => (
              <div key={lab} style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)', borderRight: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name={ic} size={16} tone="soft" /><span className="zs-eyebrow">{lab}</span></div>
                <div style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-display)', fontWeight: 300, color: 'var(--ink)' }}>{val}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <div className="zs-input" style={{ maxWidth: 260, height: 30 }}><Icon name="search" size={14} tone="mute" /><input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="flex items-center gap-2">
              {[['all', 'All'], ['space', 'Space'], ['tenant', 'Tenant'], ['private', 'Private']].map(([k, lab]) => (
                <button key={k} onClick={() => setScope(k)} style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500,
                  border: '1px solid ' + (scope === k ? 'var(--ink)' : 'var(--paper-edge)'), background: scope === k ? 'var(--ink)' : 'var(--paper)', color: scope === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
              ))}
            </div>
          </div>
          {shown.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
              <span className="glyph accent" style={{ width: 34, height: 34 }}><Icon name="grid" size={16} tone="accent" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>v{r.version}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', padding: '1px 7px', borderRadius: 'var(--radius-full)', background: 'var(--paper-mute)', color: SCOPE[r.scope][1], border: '1px solid var(--paper-edge)' }}>{SCOPE[r.scope][0]}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 'var(--text-sm)', color: 'var(--ink-soft)', marginTop: 3, lineHeight: 1.4, textWrap: 'pretty', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>“{r.body}”</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 3 }}>{r.space} · {r.by} · {r.uses.toLocaleString()} uses · updated {r.updated}</div>
              </div>
              <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="history" size={13} tone="soft" /> Versions</button>
              <button className={'zs-btn zs-btn-sm ' + (r.published ? 'zs-btn-ghost' : 'zs-btn-secondary')} onClick={() => publish(r.id)}>
                <Icon name={r.published ? 'check' : 'upload'} size={13} tone={r.published ? 'success' : 'soft'} /> {r.published ? 'Published' : 'Publish'}
              </button>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 'var(--text-sm)' }}>No templates match.</div>}
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Publishing surfaces a template in members’ Templates picker in Ask and Playground. Every edit keeps a version — members always pull the latest published one.</span></div>
        </div>
      </div>
    );
  }

  window.TemplatesView = TemplatesView;
})();
