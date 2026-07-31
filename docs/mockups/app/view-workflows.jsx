/* Torii · view-workflows.jsx (member · Tools)
   Repeatable automation, scoped to the active workspace (+ company-wide
   shared). Create a workflow, author its steps (List ⇄ DAG canvas), share it
   (just me · this workspace · specific people · company-wide), and watch its
   runs. ReAct agents appear as a v2 preview. User edits persist locally. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Tag, Half, Card, CardHead, CardFoot, ViewPad, Pill, Stats, Button, Switch, Meter, ExecBadge, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { WORKFLOWS, wsById, TOOLS, money, GATEWAY_REGION } = window.StrategosAPI;
  const { useState, useEffect } = React;
  const WF = window.StrategosWF;
  const { CLF_LABEL, SHARE, FILTERS } = window.StrategosAPI.content.workflows;

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const shareOf = (w) => w.share || (w.shared ? 'company' : w.status === 'draft' ? 'private' : 'workspace');

  function RunStat({ status }) {
    const s = WF.STATUS[status] || WF.STATUS.success;
    return <span className="wf-stat" style={{ color: s[1] }}><span className="dot" style={{ background: s[1] }} />{s[0]}</span>;
  }
  function Clf({ cls }) { return <span className={'clf clf-' + cls}><span className="d" />{CLF_LABEL[cls]}</span>; }
  function ShareTag({ w }) {
    const sc = shareOf(w); const m = SHARE[sc];
    const label = sc === 'people' ? ((w.people || []).length || 0) + ' people' : m.t;
    return <Tag title={'Shared: ' + m.t}><Icon name={m.ic} size={11} tone="mute" />{label}</Tag>;
  }

  /* ── index card ── */
  function WorkflowCard({ wf, onToggle, onOpen }) {
    const paused = wf.status !== 'active';
    return (
      <div className={'wf-card' + (paused ? ' paused' : '')} onClick={onOpen}>
        <div className="flex items-start gap-3">
          <span className={'wf-trig ' + wf.trigger.kind}><Icon name={WF.TRIG[wf.trigger.kind].ic} size={18} tone={wf.trigger.kind === 'event' ? 'accent' : 'soft'} /></span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-ink leading-[1.3]">{wf.name}</span>
              {wf.kind === 'agent' && <span className="wf-preview-badge">agent · v2</span>}
            </div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{wf.trigger.label}</div>
          </div>
          {wf.kind !== 'agent' && (
            <span className="wf-preview-badge">v2 preview</span>
          )}
        </div>

        <div className="wf-steps-mini">
          {wf.flow && wf.flow.length ? wf.flow.map((s, i) => (
            <React.Fragment key={s.id || i}>
              {i > 0 && <span className="wf-pip-arrow">→</span>}
              <span className="wf-pip" title={WF.STEP[s.type].label}><Icon name={WF.STEP[s.type].ic} size={12} tone={s.type === 'branch' ? 'warning' : 'mute'} /></span>
            </React.Fragment>
          )) : <span className="zs-body-sm">{wf.kind === 'agent' ? 'goal-driven · agent decides its steps' : 'no steps yet — open to build it'}</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Clf cls={wf.cls} />
          <ShareTag w={wf} />
          {(wf.tools || []).slice(0, 1).map((t) => <WF.ToolChip key={t} id={t} />)}
        </div>

        <div className="flex items-center justify-between mt-auto pt-3 border-t">
          {wf.lastRun ? (
            <span className="flex items-center gap-2">
              <RunStat status={wf.lastRun.status} />
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>· {wf.lastRun.at}</span>
            </span>
          ) : <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>Not run yet</span>}
          {wf.lastRun && <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{wf.lastRun.cost === 0 ? 'free' : money(wf.lastRun.cost, 3)}/run</span>}
        </div>
      </div>
    );
  }

  /* ── Runs tab ── */
  function RunsTab({ wf }) {
    const [sel, setSel] = useState(0);
    const runs = wf.runs || [];
    const cur = runs[Math.min(sel, runs.length - 1)] || {};
    const steps = (wf.kind === 'agent' ? wf.trace : wf.flow) || [];
    const planeOf = (s) => s.plane || (s.type === 'tool' && s.tool === 'code' ? 'local' : 'cloud');
    if (!runs.length) {
      return <div className="py-16 px-6 text-center border border-dashed rounded-lg text-ink-mute">
        <div className="text-base text-ink-soft">No runs yet.</div>
        <div className="zs-body-sm mt-1">Once this workflow is active and its trigger fires, each run lands here with its trace, cost and what it touched.</div>
      </div>;
    }
    return (
      <Half>
        <Card className="overflow-hidden">
          <CardHead><span className="zs-eyebrow">Run history</span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{runs.length} runs</span></CardHead>
          <div>
            {runs.map((r, i) => (
              <button key={i} className={'wf-run' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                <RunStat status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{r.at}</div>
                  <div className="zs-body-sm whitespace-nowrap overflow-hidden text-ellipsis">{r.touched}</div>
                </div>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.dur}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: r.cost === 0 ? 'var(--success)' : 'var(--ink)', width: 48, textAlign: 'right' }}>{r.cost === 0 ? 'free' : money(r.cost, 3)}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden sticky" style={{ top: 0 }}>
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span className="text-sm font-semibold">What ran</span></span>
            <RunStat status={cur.status} />
          </CardHead>
          <div className="flex items-center gap-2 py-2.5 px-4 border-b bg-paper-soft">
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{cur.at} · {cur.dur}</span>
            <span className="flex-1" />
            {steps.some((s) => planeOf(s) === 'local')
              ? <span className="exec"><Icon name="globe" size={12} tone="mute" /><span>mixed</span><span className="reg">· some on device</span></span>
              : <ExecBadge local={false} region={GATEWAY_REGION} verb />}
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{cur.cost === 0 ? 'free' : money(cur.cost, 3)}</span>
          </div>
          <div className="wf-list flex flex-col py-4 px-6">
            {steps.map((s, i) => {
              const ok = cur.status === 'success' || i < steps.length - 1;
              return (
                <React.Fragment key={s.id || i}>
                  {i > 0 && <div className="wf-conn h-[14px]"><span className="line" /></div>}
                  <div className="flex items-start gap-3">
                    <span className="wf-stepic w-[28px] h-[28px]">
                      <Icon name={ok ? 'check' : (cur.status === 'failed' ? 'warning' : 'flag')} size={13} tone={ok ? 'success' : 'warning'} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink">{s.title}</div>
                      <div className="zs-body-sm mt-px">{s.detail}</div>
                    </div>
                    {planeOf(s) === 'local'
                      ? <span className="exec exec-local shrink-0"><Icon name="models" size={12} tone="success" />on device</span>
                      : <span className="exec shrink-0"><Icon name="globe" size={12} tone="mute" />gateway</span>}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Every run routes through the gateway — same guardrails, budget and audit trail as a person’s call.</span></CardFoot>
        </Card>
      </Half>
    );
  }

  /* ── Governance tab ── */
  function GovTab({ wf, ws }) {
    const ceiling = ws.budget[ws.budget.length - 1];
    const bud = wf.budget || { perRun: 0, monthEst: 0 };
    const monthPct = Math.round((bud.monthEst / ceiling.cap) * 100);
    const gates = [];
    if (wf.flow) wf.flow.forEach((s) => { if (s.type === 'branch' && s.fail && /review|flag|hold|escalate/i.test((s.fail.title || '') + ' ' + (s.fail.detail || ''))) gates.push(s.fail.title + (s.fail.detail ? ' — ' + s.fail.detail : '')); });
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" style={{ alignItems: 'start' }}>
        <Card className="p-6">
          <div className="zs-eyebrow mb-3">Tools it may call</div>
          <div className="flex flex-col gap-2">
            {TOOLS.map((t) => {
              const used = (wf.tools || []).includes(t.id) || (wf.flow || []).some((s) => s.tool === t.id);
              const blocked = t.allowed === false;
              return (
                <div key={t.id} className="flex items-center gap-2" style={{ opacity: used || blocked ? 1 : 0.45 }}>
                  <Icon name={blocked ? 'lock' : 'check'} size={14} tone={blocked ? 'warning' : used ? 'success' : 'faint'} />
                  <span className="flex-1 text-sm text-ink">{t.name}</span>
                  <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{blocked ? 'blocked' : used ? 'in use' : 'available'}</span>
                </div>
              );
            })}
          </div>
          <p className="zs-body-sm mt-3 text-[11px]">Limited to the workspace role’s allow-list. Web fetch stays blocked for Support.</p>
        </Card>

        <Card className="p-6">
          <div className="zs-eyebrow mb-3">Budget impact</div>
          <div className="flex items-center justify-between mb-3">
            <span className="zs-body-sm">Per run</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{bud.perRun === 0 ? 'free' : money(bud.perRun, 3)}</span>
          </div>
          <Meter label={'Est. / month vs ' + ceiling.name.replace(/^You · /, '')} value={bud.monthEst} max={ceiling.cap} tone={monthPct >= 80 ? 'warning' : 'accent'}
            display={money(bud.monthEst, 2) + ' / ' + money(ceiling.cap, 0)} hint={'meters against the workspace ceiling · ' + (monthPct < 1 ? '<1' : monthPct) + '%'} />
          <p className="zs-body-sm mt-3 text-[11px]">Counts toward the same cascade as people. At the floor, runs step down to the free local model.</p>
        </Card>

        <Card className="p-6">
          <div className="zs-eyebrow mb-3">Review &amp; approval</div>
          {gates.length ? (
            <div className="flex flex-col gap-2">
              {gates.map((g, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded bg-warning-soft border border-[oklch(0.72_0.12_75_/_0.30)]">
                  <Icon name="shield" size={14} tone="warning" />
                  <span className="flex-1 text-sm text-ink">{g}</span>
                </div>
              ))}
            </div>
          ) : <p className="zs-body-sm">Runs complete unattended — no human gate. Add a <b>Branch</b> step in the builder to hold a run for review.</p>}
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="zs-body-sm">Region pin</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{GATEWAY_REGION}</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="zs-body-sm">Owner</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{wf.owner}</span>
          </div>
        </Card>
      </div>
    );
  }

  /* ── share popover ── */
  function SharePanel({ value, people, members, onApply, onClose }) {
    const [v, setV] = useState(value);
    const [ppl, setPpl] = useState(people || []);
    const toggle = (a) => setPpl((s) => (s.includes(a) ? s.filter((x) => x !== a) : s.concat([a])));
    return (
      <React.Fragment>
        <div className="fixed z-[39]" style={{ inset: 0}} onClick={onClose} />
        <div className="wf-pop" onClick={(e) => e.stopPropagation()}>
          <div className="zs-eyebrow mb-2">Share this workflow</div>
          <div className="flex flex-col gap-0.5">
            {['private', 'workspace', 'people', 'company'].map((k) => (
              <button key={k} className={'wf-scope' + (v === k ? ' on' : '')} onClick={() => setV(k)}>
                <Icon name={SHARE[k].ic} size={16} tone={v === k ? 'accent' : 'mute'} />
                <span className="flex-1"><span className="wf-scope-t">{SHARE[k].t}</span><span className="wf-scope-d">{SHARE[k].d}</span></span>
                {v === k && <Icon name="check" size={15} tone="accent" />}
              </button>
            ))}
          </div>
          {v === 'people' && (
            <div className="mt-2 pt-2 border-t">
              <div className="wf-field-lbl">Pick people</div>
              <div className="flex flex-wrap gap-2">
                {members.map((a) => (
                  <button key={a} className={'dtag tag-btn' + (ppl.includes(a) ? ' on' : '')} onClick={() => toggle(a)}>
                    <span className="ava w-[16px] h-[16px] text-[8px] mr-1">{a}</span>{a}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => { onApply(v, ppl); onClose(); }}>Share</Button>
          </div>
        </div>
      </React.Fragment>
    );
  }

  /* ── create dialog ── */
  function NewWorkflowDialog({ ws, onCreate, onClose }) {
    const [name, setName] = useState('');
    const [kind, setKind] = useState('schedule');
    const [detail, setDetail] = useState('');
    const [cls, setCls] = useState(ws.cls);
    const labelFor = { schedule: 'On a schedule', event: 'On an event', manual: 'Run on demand' };
    const ph = { schedule: 'e.g. Every Mon · 08:00', event: 'e.g. A doc lands in Renewals', manual: 'e.g. You trigger it from here' };
    const create = () => { if (!name.trim()) return; onCreate({ name: name.trim(), kind, label: labelFor[kind], detail: detail.trim(), cls }); };
    return (
      <div className="cmdk-backdrop" onMouseDown={onClose}>
        <div className="wf-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <CardHead><span className="flex items-center gap-2"><Icon name="refresh" size={15} tone="accent" /><span className="text-sm font-semibold">New workflow</span></span><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>in {ws.name}</span></CardHead>
          <div className="wf-dialog-bd">
            <div>
              <div className="wf-field-lbl">Name</div>
              <input className="wf-text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly portfolio digest" onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            </div>
            <div>
              <div className="wf-field-lbl">Trigger</div>
              <div className="tabs sm mb-2">
                {['schedule', 'event', 'manual'].map((k) => (
                  <button key={k} className={'tab' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}><Icon name={WF.TRIG[k].ic} size={13} tone={kind === k ? 'ink' : 'mute'} /> {WF.TRIG[k].label}</button>
                ))}
              </div>
              <input className="wf-text" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={ph[kind]} />
            </div>
            <div>
              <div className="wf-field-lbl">Classification</div>
              <select className="wf-sel" value={cls} onChange={(e) => setCls(e.target.value)}>
                {['public', 'internal', 'confidential', 'restricted'].map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="zs-body-sm flex-1">You’ll add steps next.</span>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={!name.trim()} onClick={create}><Icon name="arrow" size={13} tone="paper" /> Create &amp; build</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── detail ── */
  function WorkflowDetail({ wf, onPatch, onToggle, onDelete, onBack, ws }) {
    const [tab, setTab] = useState('builder');
    const [builder, setBuilder] = useState(() => load('zs-wf-builder', 'list'));
    const [ran, setRan] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const setB = (v) => { setBuilder(v); save('zs-wf-builder', v); };
    const isAgent = wf.kind === 'agent';
    const isActive = wf.status === 'active';
    const sc = shareOf(wf); const scMeta = SHARE[sc];

    const applyShare = (v, ppl) => onPatch(Object.assign({ share: v, people: ppl }, wf.status === 'draft' && v !== 'private' ? { status: 'active' } : {}));

    return (
      <ViewPad wide className="rise">
        <div className="flex items-center gap-2 mb-3">
          <Button variant="ghost" size="sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Workflows</Button>
          {wf.createdByUser && <Button className="ml-auto" variant="ghost" size="sm" onClick={onDelete}><Icon name="trash" size={14} tone="mute" /> Delete</Button>}
        </div>
        <div className="page-hd items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={'wf-trig ' + wf.trigger.kind + ' w-[30px] h-[30px]'}><Icon name={WF.TRIG[wf.trigger.kind].ic} size={15} tone={wf.trigger.kind === 'event' ? 'accent' : 'soft'} /></span>
              <Clf cls={wf.cls} />
              <ShareTag w={wf} />
              {isAgent && <span className="wf-preview-badge">agent · v2 preview</span>}
            </div>
            {isAgent
              ? <h1 className="zs-h1">{wf.name}</h1>
              : <input className="wf-edit-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--text-2xl)', color: 'var(--ink)', maxWidth: 560 }} value={wf.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="Untitled workflow" />}
            <p className="zs-body-sm mt-1">{WF.TRIG[wf.trigger.kind].label} · {wf.trigger.detail || 'no detail yet'} · owner {wf.owner}</p>
          </div>
          <div className="flex items-center gap-2 relative">
            {!isAgent && (
              <span className="flex items-center gap-2 mr-0.5">
                <span className="zs-body-sm">{wf.status === 'paused' ? 'Paused' : wf.status === 'draft' ? 'Draft' : 'Active'}</span>
                <Switch on={isActive} onClick={onToggle} label="active" />
              </span>
            )}
            <Button variant="secondary" onClick={() => setShareOpen((v) => !v)}><Icon name={scMeta.ic} size={15} tone="soft" /> Share</Button>
            {shareOpen && <SharePanel value={sc} people={wf.people} members={ws.members} onApply={applyShare} onClose={() => setShareOpen(false)} />}
            <Button variant="primary" disabled={isAgent} onClick={() => { if (isAgent) return; setRan(true); setTimeout(() => setRan(false), 1600); }} title={isAgent ? 'Agents run in v2' : 'Run now'}>
              <Icon name="playground" size={15} tone="paper" /> Preview · v2
            </Button>
          </div>
        </div>

        <div className="wf-tabs mb-6">
          {[['builder', 'Builder'], ['runs', 'Runs'], ['gov', 'Governance']].map(([k, l]) => (
            <button key={k} className={'wf-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}{k === 'runs' && wf.runs && wf.runs.length ? ' · ' + wf.runs.length : ''}</button>
          ))}
        </div>

        {tab === 'builder' && (isAgent ? <WF.AgentBuilder wf={wf} /> : (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="zs-body-sm">Build it as a</span>
              <div className="tabs sm">
                <button className={'tab' + (builder === 'list' ? ' on' : '')} onClick={() => setB('list')}><Icon name="list" size={14} tone={builder === 'list' ? 'ink' : 'mute'} /> List</button>
                <button className={'tab' + (builder === 'canvas' ? ' on' : '')} onClick={() => setB('canvas')}><Icon name="branch" size={14} tone={builder === 'canvas' ? 'ink' : 'mute'} /> Canvas</button>
              </div>
              {builder === 'canvas' && <span className="zs-body-sm text-ink-faint">· edit steps in List; the canvas mirrors them</span>}
            </div>
            {builder === 'list'
              ? <WF.ListBuilder wf={wf} onFlow={(f) => onPatch({ flow: f })} onTrigger={(t) => onPatch({ trigger: t })} />
              : <WF.CanvasBuilder wf={wf} />}
          </div>
        ))}
        {tab === 'runs' && <RunsTab wf={wf} />}
        {tab === 'gov' && <GovTab wf={wf} ws={ws} />}
      </ViewPad>
    );
  }

  /* ── index ── */

  function WorkflowsView() {
    const { ws } = useWorkspace();
    const [overrides, setOverrides] = useState(() => load('zs-wf-over', {}));
    const [drafts, setDrafts] = useState(() => load('zs-wf-drafts', []));
    const [openId, setOpenId] = useState(null);
    const [filter, setFilter] = useState('all');
    const [creating, setCreating] = useState(false);

    useEffect(() => { save('zs-wf-over', overrides); }, [overrides]);
    useEffect(() => { save('zs-wf-drafts', drafts); }, [drafts]);
    useEffect(() => { setOpenId(null); setFilter('all'); }, [ws.id]);

    const resolve = (wf) => Object.assign({}, wf, overrides[wf.id] || {});
    const patch = (id, p) => setOverrides((o) => ({ ...o, [id]: Object.assign({}, o[id], p) }));
    const all = [...WORKFLOWS, ...drafts].map(resolve);
    const inWs = all.filter((w) => shareOf(w) === 'company' || w.ws === ws.id);

    const open = openId && inWs.find((w) => w.id === openId);
    if (open) {
      return <WorkflowDetail wf={open} ws={ws}
        onPatch={(p) => patch(open.id, p)}
        onToggle={() => patch(open.id, { status: open.status === 'active' ? 'paused' : 'active' })}
        onDelete={() => { setDrafts((d) => d.filter((x) => x.id !== open.id)); setOverrides((o) => { const n = { ...o }; delete n[open.id]; return n; }); setOpenId(null); }}
        onBack={() => setOpenId(null)} />;
    }

    const create = (form) => {
      const id = 'wf-' + Date.now();
      const draft = { id, name: form.name, ws: ws.id, kind: 'flow', status: 'draft', createdByUser: true,
        trigger: { kind: form.kind, label: form.label, detail: form.detail }, cls: form.cls, owner: 'm.okafor',
        flow: [], tools: [], budget: { perRun: 0, monthEst: 0 }, lastRun: null, runs: [], share: 'private' };
      setDrafts((d) => [draft, ...d]); setCreating(false); setOpenId(id);
    };

    const shown = inWs.filter((w) => filter === 'all' || (filter === 'agent' ? w.kind === 'agent' : w.trigger.kind === filter));
    const mine = shown.filter((w) => shareOf(w) !== 'company');
    const shared = shown.filter((w) => shareOf(w) === 'company');

    const active = inWs.filter((w) => w.status === 'active' && w.kind !== 'agent').length;
    const runs7d = inWs.reduce((a, w) => a + (w.runs ? w.runs.length : 0), 0);
    const spent7d = inWs.reduce((a, w) => a + (w.lastRun ? w.lastRun.cost * (w.runs ? w.runs.length : 1) : 0), 0);
    const review = inWs.filter((w) => w.lastRun && w.lastRun.status === 'review').length;
    const METRICS = [['Active', active + '', 'running now'], ['Runs · 7d', runs7d + '', 'across this workspace'], ['Spent · 7d', money(spent7d, 2), 'by automations'], ['Needs review', review + '', review ? 'awaiting a human' : 'all clear']];

    const renderGroup = (items) => (
      <div className="grid grid-cols-2 gap-4">
        {items.map((wf) => <WorkflowCard key={wf.id} wf={wf} onToggle={() => patch(wf.id, { status: wf.status === 'active' ? 'paused' : 'active' })} onOpen={() => setOpenId(wf.id)} />)}
      </div>
    );

    return (
      <ViewPad wide className="rise">
        {creating && <NewWorkflowDialog ws={ws} onCreate={create} onClose={() => setCreating(false)} />}
        <PageHeader eyebrow="Workflows" chip={ws} title="Workflows"
          sub="Repeatable plans — schedules, events, on-demand — routed through the gateway with the same guardrails and budget as a person. The builder and live runs arrive in v2; this is a preview."
          actions={<Pill className="text-accent bg-accent-soft border-[oklch(0.58_0.15_35_/_0.28)]"><Icon name="spark" size={13} tone="accent" /> v2 preview</Pill>} />

        <Stats className="mb-6">
          {METRICS.map(([l, v, s]) => (
            <Card className="p-4" key={l}>
              <div className="zs-eyebrow mb-2">{l}</div>
              <div className="font-display font-light text-2xl leading-[1]" style={{ color: l === 'Needs review' && review ? 'var(--warning)' : 'var(--ink)' }}>{v}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 6 }}>{s}</div>
            </Card>
          ))}
        </Stats>

        <div className="tabs sm mb-6">
          {FILTERS.map(([k, l]) => <button key={k} className={'tab' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
        </div>

        {mine.length > 0 && renderGroup(mine)}
        {shared.length > 0 && (
          <div style={{ marginTop: mine.length ? '32px' : 0 }}>
            <div className="flex items-center gap-2 mb-3">
              <Icon name="org" size={14} tone="faint" />
              <span className="rail-label p-0">Shared across the company</span>
            </div>
            {renderGroup(shared)}
          </div>
        )}
        {shown.length === 0 && (
          <div className="py-16 px-6 text-center border border-dashed rounded-lg text-ink-mute">
            <div className="text-base text-ink-soft">No workflows here yet.</div>
            <div className="zs-body-sm mt-1">Nothing matches this filter in {ws.name}. Start one with <b>New workflow</b>.</div>
          </div>
        )}
      </ViewPad>
    );
  }

  window.WorkflowsView = WorkflowsView;
})();
