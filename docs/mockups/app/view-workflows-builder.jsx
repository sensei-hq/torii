/* Torii · view-workflows-builder.jsx
   The two builder directions for a workflow — a linear List builder and a
   DAG Canvas — plus the agent (v2 preview) builder. Shared step metadata and
   run-status colors live here and are reused by the index + runs views.
   Exposes window.StrategosWF. */
(function () {
  const { Chip, Split, Card } = window.StrategosUI;
  const { Icon } = window.StrategosIcons;
  const { TOOLS } = window.StrategosAPI;

  // step type → glyph + label
  const { STEP, TRIG, STATUS, STEP_TYPES } = window.StrategosAPI.content.workflowsBuilder;
  const toolName = (id) => { const t = TOOLS.find((x) => x.id === id); return t ? t.name : id; };

  function ToolChip({ id }) {
    const t = TOOLS.find((x) => x.id === id) || {};
    return <Chip><Icon name="router" size={11} tone={t.allowed === false ? 'warning' : 'mute'} />{toolName(id)}</Chip>;
  }

  /* ── List builder ──────────────────────────────────────────────── */
  function StepCard({ step, num, trigger }) {
    const meta = trigger ? TRIG[trigger.kind] : STEP[step.type];
    const isTrigger = !!trigger;
    return (
      <div className={'wf-step' + (isTrigger ? ' trigger' : '')}>
        <span className="wf-stepic"><Icon name={meta.ic} size={16} tone={isTrigger ? 'accent' : step.type === 'branch' ? 'warning' : 'soft'} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="wf-node-kind">{isTrigger ? 'When' : meta.label}</span>
            {!isTrigger && <span className="wf-stepnum">step {num}</span>}
            {step && step.tool && <ToolChip id={step.tool} />}
          </div>
          <div className="text-sm font-semibold text-ink mt-0.5">{isTrigger ? trigger.label : step.title}</div>
          <div className="zs-body-sm mt-px">{isTrigger ? trigger.detail : step.detail}</div>
        </div>
        {!isTrigger && <button className="icon-btn" title="Edit step" style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center' }}><Icon name="settings" size={14} tone="mute" /></button>}
      </div>
    );
  }
  const Conn = () => <div className="wf-conn"><span className="line" /></div>;

  /* step authoring helpers */
  function mkStep(type) {
    const title = { retrieve: 'Retrieve from workspace docs', draft: 'Draft from a template', tool: 'Run a tool', classify: 'Set classification', notify: 'Notify / hand off', branch: 'Condition?', output: 'Save the result' }[type];
    const s = { id: 's' + Date.now() + Math.floor(Math.random() * 9999), type, title, detail: '' };
    if (type === 'tool') s.tool = 'files';
    if (type === 'branch') { s.cond = ''; s.fail = { type: 'notify', title: 'Else — escalate', detail: '' }; }
    return s;
  }

  function AddStepMenu({ onAdd }) {
    const [open, setOpen] = React.useState(false);
    return (
      <div className="relative self-start">
        <button className="wf-addbtn" onClick={() => setOpen((v) => !v)}><Icon name="plus" size={13} tone="mute" /> Add step</button>
        {open && (
          <React.Fragment>
            <div className="fixed z-[19]" style={{ inset: 0}} onClick={() => setOpen(false)} />
            <div className="wf-addmenu">
              {STEP_TYPES.map((t) => (
                <button key={t} onClick={() => { onAdd(mkStep(t)); setOpen(false); }}>
                  <Icon name={STEP[t].ic} size={14} tone={t === 'branch' ? 'warning' : 'soft'} /> {STEP[t].label}
                </button>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>
    );
  }

  function EditStep({ step, num, onChange, onDelete, onMove, canUp, canDown }) {
    const meta = STEP[step.type];
    const set = (patch) => onChange(Object.assign({}, step, patch));
    return (
      <div className="wf-step">
        <span className="wf-stepic"><Icon name={meta.ic} size={16} tone={step.type === 'branch' ? 'warning' : 'soft'} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <select className="wf-typesel" value={step.type} onChange={(e) => { const nt = e.target.value; set(Object.assign({ type: nt, title: step.title }, nt === 'branch' ? { cond: step.cond || '', fail: step.fail || { type: 'notify', title: 'Else — escalate', detail: '' } } : {}, nt === 'tool' ? { tool: step.tool || 'files' } : {})); }}>
              {STEP_TYPES.map((t) => <option key={t} value={t}>{STEP[t].label}</option>)}
            </select>
            <span className="wf-stepnum">step {num}</span>
            {step.type === 'tool' && (
              <select className="wf-typesel" value={step.tool || 'files'} onChange={(e) => set({ tool: e.target.value })}>
                {TOOLS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <input className="wf-edit-title" value={step.title} onChange={(e) => set({ title: e.target.value })} placeholder="Step title" />
          <input className="wf-edit-detail" value={step.detail || ''} onChange={(e) => set({ detail: e.target.value })} placeholder="Add detail (optional)" />
          {step.type === 'branch' && (
            <div className="wf-fork ml-0 mt-1.5">
              <input className="wf-edit-detail" style={{ color: 'var(--warning)' }} value={step.cond || ''} onChange={(e) => set({ cond: e.target.value })} placeholder="Condition — e.g. uplift > 5%" />
              <input className="wf-edit-title" value={(step.fail || {}).title || ''} onChange={(e) => set({ fail: Object.assign({}, step.fail, { title: e.target.value }) })} placeholder="Else — do what?" />
              <input className="wf-edit-detail" value={(step.fail || {}).detail || ''} onChange={(e) => set({ fail: Object.assign({}, step.fail, { detail: e.target.value }) })} placeholder="Else detail" />
            </div>
          )}
        </div>
        <div className="wf-step-ctrl">
          <button className="wf-mini-btn" onClick={() => onMove(-1)} disabled={!canUp} title="Move up">↑</button>
          <button className="wf-mini-btn" onClick={() => onMove(1)} disabled={!canDown} title="Move down">↓</button>
          <button className="wf-mini-btn" onClick={onDelete} title="Remove"><Icon name="trash" size={12} tone="mute" /></button>
        </div>
      </div>
    );
  }

  function TriggerEdit({ trigger, onChange }) {
    const labelFor = { schedule: 'On a schedule', event: 'On an event', manual: 'Run on demand' };
    return (
      <div className="wf-step trigger">
        <span className="wf-stepic"><Icon name={TRIG[trigger.kind].ic} size={16} tone="accent" /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="wf-node-kind">When</span>
            <div className="tabs sm">
              {['schedule', 'event', 'manual'].map((k) => (
                <button key={k} className={'tab' + (trigger.kind === k ? ' on' : '')} onClick={() => onChange(Object.assign({}, trigger, { kind: k, label: trigger.label && trigger.label !== labelFor[trigger.kind] ? trigger.label : labelFor[k] }))}>{TRIG[k].label}</button>
              ))}
            </div>
          </div>
          <input className="wf-edit-title" value={trigger.label} onChange={(e) => onChange(Object.assign({}, trigger, { label: e.target.value }))} placeholder="Trigger label" />
          <input className="wf-edit-detail" value={trigger.detail || ''} onChange={(e) => onChange(Object.assign({}, trigger, { detail: e.target.value }))} placeholder="e.g. Every Mon · 08:00, or: a doc lands in Renewals" />
        </div>
      </div>
    );
  }

  function ListBuilder({ wf, onFlow, onTrigger }) {
    const steps = wf.flow || [];
    // read-only path (no setters)
    if (!onFlow) {
      return (
        <div className="wf-list flex flex-col">
          <StepCard trigger={wf.trigger} />
          {steps.map((s, i) => (
            <React.Fragment key={s.id || i}>
              <Conn />
              <StepCard step={s} num={i + 1} />
              {s.type === 'branch' && s.fail && (
                <div className="wf-fork">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name={STEP[s.fail.type].ic} size={13} tone="warning" />
                    <span className="wf-node-kind text-warning">else — {s.cond}</span>
                  </div>
                  <div className="text-sm font-semibold text-ink">{s.fail.title}</div>
                  <div className="zs-body-sm mt-px">{s.fail.detail}</div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      );
    }
    // editable path
    const update = (i, s) => { const n = steps.slice(); n[i] = s; onFlow(n); };
    const del = (i) => onFlow(steps.filter((_, k) => k !== i));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= steps.length) return; const n = steps.slice(); const t = n[i]; n[i] = n[j]; n[j] = t; onFlow(n); };
    return (
      <div className="wf-list flex flex-col">
        {onTrigger ? <TriggerEdit trigger={wf.trigger} onChange={onTrigger} /> : <StepCard trigger={wf.trigger} />}
        {steps.map((s, i) => (
          <React.Fragment key={s.id || i}>
            <Conn />
            <EditStep step={s} num={i + 1} onChange={(ns) => update(i, ns)} onDelete={() => del(i)} onMove={(d) => move(i, d)} canUp={i > 0} canDown={i < steps.length - 1} />
          </React.Fragment>
        ))}
        {steps.length === 0 && (
          <React.Fragment>
            <Conn />
            <div className="zs-body-sm p-6 border border-dashed rounded-lg text-center">No steps yet — add the first one below.</div>
          </React.Fragment>
        )}
        <Conn />
        <AddStepMenu onAdd={(s) => onFlow(steps.concat([s]))} />
      </div>
    );
  }

  /* ── DAG canvas builder ────────────────────────────────────────── */
  const COLW = 224, ROWH = 120, PADX = 18, PADY = 18, NW = 188, NH = 80;
  function layout(wf) {
    const nodes = [{ id: 'trig', type: 'trigger', title: wf.trigger.label, detail: wf.trigger.detail, kind: wf.trigger.kind, col: 0, row: 0 }];
    wf.flow.forEach((s, i) => nodes.push(Object.assign({}, s, { col: i + 1, row: 0 })));
    wf.flow.forEach((s, i) => { if (s.type === 'branch' && s.fail) nodes.push(Object.assign({ id: s.id + '-f', isFail: true }, s.fail, { col: i + 1, row: 1 })); });
    const edges = [];
    if (wf.flow.length) edges.push({ from: 'trig', to: wf.flow[0].id });
    for (let i = 0; i < wf.flow.length - 1; i++) edges.push({ from: wf.flow[i].id, to: wf.flow[i + 1].id, label: wf.flow[i].type === 'branch' ? 'yes' : undefined });
    wf.flow.forEach((s) => { if (s.type === 'branch' && s.fail) edges.push({ from: s.id, to: s.id + '-f', label: 'no', down: true }); });
    const maxCol = Math.max(...nodes.map((n) => n.col));
    const maxRow = Math.max(...nodes.map((n) => n.row));
    return { nodes, edges, w: PADX * 2 + (maxCol + 1) * COLW - (COLW - NW), h: PADY * 2 + (maxRow + 1) * ROWH };
  }
  const nx = (n) => PADX + n.col * COLW;
  const ny = (n) => PADY + n.row * ROWH;

  function CanvasBuilder({ wf }) {
    const { nodes, edges, w, h } = layout(wf);
    const byId = {}; nodes.forEach((n) => (byId[n.id] = n));
    function path(e) {
      const a = byId[e.from], b = byId[e.to];
      if (e.down) {
        const ax = nx(a) + NW / 2, ay = ny(a) + NH, bx = nx(b) + NW / 2, by = ny(b);
        return { d: `M ${ax},${ay} C ${ax},${ay + 32} ${bx},${by - 32} ${bx},${by}`, lx: (ax + bx) / 2, ly: (ay + by) / 2 };
      }
      const ax = nx(a) + NW, ay = ny(a) + NH / 2, bx = nx(b), by = ny(b) + NH / 2;
      return { d: `M ${ax},${ay} C ${ax + 48},${ay} ${bx - 48},${by} ${bx},${by}`, lx: (ax + bx) / 2, ly: (ay + by) / 2 - 2 };
    }
    return (
      <div className="wf-canvas max-h-[520px]">
        <div className="wf-canvas-inner min-w-full" style={{ width: w, height: h}}>
          <svg className="absolute" width={w} height={h} style={{ inset: 0, pointerEvents: 'none' }}>
            <defs>
              <marker id="wf-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--ink-faint)" />
              </marker>
            </defs>
            {edges.map((e, i) => { const p = path(e); return <path key={i} d={p.d} fill="none" stroke="var(--ink-faint)" strokeWidth="1.4" markerEnd="url(#wf-arrow)" />; })}
          </svg>
          {edges.map((e, i) => { if (!e.label) return null; const p = path(e); return <span key={'l' + i} className="wf-edge-label" style={{ left: p.lx, top: p.ly }}>{e.label}</span>; })}
          {nodes.map((n) => {
            const meta = n.type === 'trigger' ? TRIG[n.kind] : STEP[n.type];
            const cls = n.isFail ? 'fail' : n.type;
            return (
              <div key={n.id} className={'wf-node ' + cls} style={{ left: nx(n), top: ny(n) }}>
                <div className="wf-node-hd">
                  <span className="wf-node-ic"><Icon name={meta.ic} size={13} tone={n.type === 'trigger' ? 'accent' : n.isFail || n.type === 'branch' ? 'warning' : n.type === 'output' ? 'success' : 'soft'} /></span>
                  <span className="wf-node-kind">{n.type === 'trigger' ? 'When' : meta.label}</span>
                </div>
                <div className="wf-node-title">{n.title}</div>
                {n.detail && <div className="wf-node-detail">{n.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ── Agent builder (v2 · preview) ──────────────────────────────── */
  function AgentBuilder({ wf }) {
    const g = wf.guardrails || {};
    return (
      <div>
        <div className="flex items-center gap-3 py-3 px-4 rounded bg-accent-soft border border-[oklch(0.58_0.15_35_/_0.25)] mb-6">
          <Icon name="spark" size={18} tone="accent" />
          <div className="flex-1">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink">Agent</span><span className="wf-preview-badge">v2 · preview</span></div>
            <div className="zs-body-sm mt-px">The agent decides its own steps to reach a goal — within the tools, budget and guardrails you set. Shipping in v2; editing is disabled in this preview.</div>
          </div>
        </div>

        <Split>
          <Card className="p-6">
            <div className="zs-eyebrow mb-2">Goal</div>
            <p className="font-display text-lg leading-[1.5] text-ink [text-wrap:pretty]">{wf.goal}</p>
            <div className="zs-eyebrow mt-6 mx-0 mb-2">Steps it chose · last dry-run</div>
            <div className="wf-list flex flex-col">
              {wf.trace.map((s, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <Conn />}
                  <StepCard step={s} num={i + 1} />
                </React.Fragment>
              ))}
            </div>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="p-6">
              <div className="zs-eyebrow mb-3">Guardrails</div>
              <div className="flex flex-col gap-3">
                {[['Max steps', g.maxSteps + ' per run'], ['Budget cap', '$' + (g.budgetCap || 0).toFixed(2) + ' per run'], ['Grounding', g.grounded ? 'in-tenant only' : 'open']].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="zs-body-sm">{k}</span>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{v}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-6">
              <div className="zs-eyebrow mb-3">Tools it may call</div>
              <div className="flex flex-wrap gap-2">{(wf.tools || []).map((t) => <ToolChip key={t} id={t} />)}</div>
            </Card>
          </div>
        </Split>
      </div>
    );
  }

  window.StrategosWF = { STEP, TRIG, STATUS, STEP_TYPES, mkStep, ToolChip, toolName, ListBuilder, CanvasBuilder, AgentBuilder };
})();
