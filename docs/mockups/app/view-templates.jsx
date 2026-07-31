/* Seiki · view-templates.jsx
   Prompt & template library — the shared, versioned prompts that power Ask's
   "Draft" and saved workflows, scoped per space. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Button, Pill, Switch, PageHeader } = window.StrategosUI;
  const { PROMPT_TEMPLATES } = window.StrategosAPI;
  const { useState } = React;

  // enrich the shared catalog with library metadata
  const BASE = PROMPT_TEMPLATES.map((t, i) => ({
    id: t.id, name: t.name, space: t.space, by: t.by, body: t.body,
    version: [3, 2, 4][i] || 1, uses: [128, 64, 210][i] || 12, published: true,
    scope: t.shared ? 'space' : 'private', updated: ['3d ago', '1w ago', '2d ago'][i] || 'today',
  }));
  const { EXTRA, SCOPE } = window.StrategosAPI.content.templates;
  const ALL = [...BASE, ...EXTRA];

  function TemplatesView() {
    const [rows, setRows] = useState(ALL);
    const [q, setQ] = useState('');
    const [scope, setScope] = useState('all');
    const publish = (id) => setRows((r) => r.map((x) => (x.id === id ? { ...x, published: !x.published, scope: x.published ? 'private' : 'space' } : x)));

    const shown = rows.filter((r) => (scope === 'all' || r.scope === scope) && (!q || (r.name + r.space + r.body).toLowerCase().includes(q.toLowerCase())));
    const published = rows.filter((r) => r.published).length;
    const totalUses = rows.reduce((s, r) => s + r.uses, 0);

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Gateway" title="Prompt library" subMax={660}
          sub="The shared, versioned prompts behind Ask’s Draft and saved workflows. Publish one to a space or the whole tenant so members reuse it instead of starting cold."
          actions={<Button variant="primary"><Icon name="plus" size={15} tone="paper" /> New template</Button>} />

        <Card className="overflow-hidden mb-6">
          <div className="flex flex-wrap">
            {[['grid', 'Templates', rows.length, 'in the library'], ['check', 'Published', published, 'live to members'], ['history', 'Uses · 30d', totalUses.toLocaleString(), 'across Ask & workflows']].map(([ic, lab, val, sub], i) => (
              <div className="flex-1 min-w-0 p-4" key={lab} style={{ borderRight: i < 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2 mb-2"><Icon name={ic} size={16} tone="soft" /><span className="zs-eyebrow">{lab}</span></div>
                <div className="text-xl font-display font-light text-ink">{val}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHead>
            <div className="zs-input max-w-[260px] h-[30px]"><Icon name="search" size={14} tone="mute" /><input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="flex items-center gap-2">
              {[['all', 'All'], ['space', 'Space'], ['tenant', 'Tenant'], ['private', 'Private']].map(([k, lab]) => (
                <button key={k} onClick={() => setScope(k)} style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500,
                  border: '1px solid ' + (scope === k ? 'var(--ink)' : 'var(--paper-edge)'), background: scope === k ? 'var(--ink)' : 'var(--paper)', color: scope === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
              ))}
            </div>
          </CardHead>
          {shown.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
              <span className="glyph accent w-[34px] h-[34px]"><Icon name="grid" size={16} tone="accent" /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>v{r.version}</span>
                  <span className="font-mono text-xs py-px px-2 rounded-full bg-paper-mute border" style={{ color: SCOPE[r.scope][1]}}>{SCOPE[r.scope][0]}</span>
                </div>
                <div className="font-display text-sm text-ink-soft mt-1 leading-snug [text-wrap:pretty] whitespace-nowrap overflow-hidden text-ellipsis" style={{ fontStyle: 'italic'}}>“{r.body}”</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 3 }}>{r.space} · {r.by} · {r.uses.toLocaleString()} uses · updated {r.updated}</div>
              </div>
              <Button variant="ghost" size="sm"><Icon name="history" size={13} tone="soft" /> Versions</Button>
              <Button size="sm" variant={(r.published ? 'ghost' : 'secondary')} onClick={() => publish(r.id)}>
                <Icon name={r.published ? 'check' : 'upload'} size={13} tone={r.published ? 'success' : 'soft'} /> {r.published ? 'Published' : 'Publish'}
              </Button>
            </div>
          ))}
          {shown.length === 0 && <div className="p-12 text-center text-ink-mute text-sm">No templates match.</div>}
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Publishing surfaces a template in members’ Templates picker in Ask and Playground. Every edit keeps a version — members always pull the latest published one.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.TemplatesView = TemplatesView;
})();
