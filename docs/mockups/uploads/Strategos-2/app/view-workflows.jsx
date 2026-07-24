/* Strategos Console · view-workflows.jsx (member · Tools)
   Repeatable automation, scoped to the active workspace (+ company-wide
   shared). Create a workflow, author its steps (List ⇄ DAG canvas), share it
   (just me · this workspace · specific people · company-wide), and watch its
   runs. ReAct agents appear as a v2 preview. User edits persist locally. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Switch, Meter, ExecBadge, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { WORKFLOWS, wsById, TOOLS, money, GATEWAY_REGION } = window.StrategosData;
  const { useState, useEffect } = React;
  const WF = window.StrategosWF;
  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  const SHARE = {
    private:   { ic: 'lock',  t: 'Just me',         d: 'Only you can see and run it' },
    workspace: { ic: 'team',  t: 'This workspace',   d: 'Everyone in this workspace' },
    people:    { ic: 'share', t: 'Specific people',  d: 'Pick who can use it' },
    company:   { ic: 'org',   t: 'Company-wide',     d: 'Shared across every workspace' },
  };
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
    return <span className="tag" title={'Shared: ' + m.t}><Icon name={m.ic} size={11} tone="mute" />{label}</span>;
  }

  /* ── index card ── */
  function WorkflowCard({ wf, onToggle, onOpen }) {
    const paused = wf.status !== 'active';
    return (
      <div className={'wf-card' + (paused ? ' paused' : '')} onClick={onOpen}>
        <div className="flex items-start gap-3">
          <span className={'wf-trig ' + wf.trigger.kind}><Icon name={WF.TRIG[wf.trigger.kind].ic} size={18} tone={wf.trigger.kind === 'event' ? 'accent' : 'soft'} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{wf.name}</span>
              {wf.kind === 'agent' && <span className="wf-preview-badge">agent · v2</span>}
            </div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{wf.trigger.label}</div>
          </div>
          {wf.kind !== 'agent' && (
            <span onClick={(e) => { e.stopPropagation(); onToggle(); }} title={paused ? 'Paused' : 'Active'}>
              <Switch on={!paused} label="active" />
            </span>
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

        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <Clf cls={wf.cls} />
          <ShareTag w={wf} />
          {(wf.tools || []).slice(0, 1).map((t) => <WF.ToolChip key={t} id={t} />)}
        </div>

        <div className="flex items-center justify-between" style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--paper-edge)' }}>
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
    if (!runs.length) {
      return <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center', border: '1px dashed var(--paper-edge)', borderRadius: 'var(--radius-lg)', color: 'var(--ink-mute)' }}>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--ink-soft)' }}>No runs yet.</div>
        <div className="zs-body-sm" style={{ marginTop: 4 }}>Once this workflow is active and its trigger fires, each run lands here with its trace, cost and what it touched.</div>
      </div>;
    }
    return (
      <div className="grid-half">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><span className="zs-eyebrow">Run history</span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{runs.length} runs</span></div>
          <div>
            {runs.map((r, i) => (
              <button key={i} className={'wf-run' + (i === sel ? ' sel' : '')} onClick={() => setSel(i)}>
                <RunStat status={r.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{r.at}</div>
                  <div className="zs-body-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.touched}</div>
                </div>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.dur}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: r.cost === 0 ? 'var(--success)' : 'var(--ink)', width: 48, textAlign: 'right' }}>{r.cost === 0 ? 'free' : money(r.cost, 3)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden', position: 'sticky', top: 0 }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>What ran</span></span>
            <RunStat status={cur.status} />
          </div>
          <div className="flex items-center gap-2" style={{ padding: '10px 18px', borderBottom: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}>
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{cur.at} · {cur.dur}</span>
            <span className="grow" />
            <ExecBadge local={false} region={GATEWAY_REGION} verb />
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{cur.cost === 0 ? 'free' : money(cur.cost, 3)}</span>
          </div>
          <div className="wf-list flex flex-col" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            {steps.map((s, i) => {
              const ok = cur.status === 'success' || i < steps.length - 1;
              return (
                <React.Fragment key={s.id || i}>
                  {i > 0 && <div className="wf-conn" style={{ height: 14 }}><span className="line" /></div>}
                  <div className="flex items-start gap-3">
                    <span className="wf-stepic" style={{ width: 28, height: 28 }}>
                      <Icon name={ok ? 'check' : (cur.status === 'failed' ? 'warning' : 'flag')} size={13} tone={ok ? 'success' : 'warning'} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)' }}>{s.title}</div>
                      <div className="zs-body-sm" style={{ marginTop: 1 }}>{s.detail}</div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Every run routes through the gateway — same guardrails, budget and audit trail as a person’s call.</span></div>
        </div>
      </div>
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
      <div className="grid grid-cols-3 gap-5" style={{ alignItems: 'start' }}>
        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Tools it may call</div>
          <div className="flex flex-col gap-2">
            {TOOLS.map((t) => {
              const used = (wf.tools || []).includes(t.id) || (wf.flow || []).some((s) => s.tool === t.id);
              const blocked = t.allowed === false;
              return (
                <div key={t.id} className="flex items-center gap-2" style={{ opacity: used || blocked ? 1 : 0.45 }}>
                  <Icon name={blocked ? 'lock' : 'check'} size={14} tone={blocked ? 'warning' : used ? 'success' : 'faint'} />
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{t.name}</span>
                  <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{blocked ? 'blocked' : used ? 'in use' : 'available'}</span>
                </div>
              );
            })}
          </div>
          <p className="zs-body-sm" style={{ marginTop: 'var(--space-3)', fontSize: 11 }}>Limited to the workspace role’s allow-list. Web fetch stays blocked for Support.</p>
        </div>

        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Budget impact</div>
          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
            <span className="zs-body-sm">Per run</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{bud.perRun === 0 ? 'free' : money(bud.perRun, 3)}</span>
          </div>
          <Meter label={'Est. / month vs ' + ceiling.name.replace(/^You · /, '')} value={bud.monthEst} max={ceiling.cap} tone={monthPct >= 80 ? 'warning' : 'accent'}
            display={money(bud.monthEst, 2) + ' / ' + money(ceiling.cap, 0)} hint={'meters against the workspace ceiling · ' + (monthPct < 1 ? '<1' : monthPct) + '%'} />
          <p className="zs-body-sm" style={{ marginTop: 'var(--space-3)', fontSize: 11 }}>Counts toward the same cascade as people. At the floor, runs step down to the free local model.</p>
        </div>

        <div className="card" style={{ padding: 'var(--space-5)' }}>
          <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Review &amp; approval</div>
          {gates.length ? (
            <div className="flex flex-col gap-2">
              {gates.map((g, i) => (
                <div key={i} className="flex items-start gap-2" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius)', background: 'var(--warning-soft)', border: '1px solid oklch(0.72 0.12 75 / 0.30)' }}>
                  <Icon name="shield" size={14} tone="warning" />
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{g}</span>
                </div>
              ))}
            </div>
          ) : <p className="zs-body-sm">Runs complete unattended — no human gate. Add a <b>Branch</b> step in the builder to hold a run for review.</p>}
          <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--paper-edge)' }}>
            <span className="zs-body-sm">Region pin</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{GATEWAY_REGION}</span>
          </div>
          <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-2)' }}>
            <span className="zs-body-sm">Owner</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{wf.owner}</span>
          </div>
        </div>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={onClose} />
        <div className="wf-pop" onClick={(e) => e.stopPropagation()}>
          <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Share this workflow</div>
          <div className="flex flex-col" style={{ gap: 2 }}>
            {['private', 'workspace', 'people', 'company'].map((k) => (
              <button key={k} className={'wf-scope' + (v === k ? ' on' : '')} onClick={() => setV(k)}>
                <Icon name={SHARE[k].ic} size={16} tone={v === k ? 'accent' : 'mute'} />
                <span style={{ flex: 1 }}><span className="wf-scope-t">{SHARE[k].t}</span><span className="wf-scope-d">{SHARE[k].d}</span></span>
                {v === k && <Icon name="check" size={15} tone="accent" />}
              </button>
            ))}
          </div>
          {v === 'people' && (
            <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--paper-edge)' }}>
              <div className="wf-field-lbl">Pick people</div>
              <div className="flex flex-wrap gap-2">
                {members.map((a) => (
                  <button key={a} className={'dtag tag-btn' + (ppl.includes(a) ? ' on' : '')} onClick={() => toggle(a)}>
                    <span className="ava" style={{ width: 16, height: 16, fontSize: 8, marginRight: 4 }}>{a}</span>{a}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-3)' }}>
            <span className="grow" />
            <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onClose}>Cancel</button>
            <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => { onApply(v, ppl); onClose(); }}>Share</button>
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
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="refresh" size={15} tone="accent" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>New workflow</span></span><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>in {ws.name}</span></div>
          <div className="wf-dialog-bd">
            <div>
              <div className="wf-field-lbl">Name</div>
              <input className="wf-text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly portfolio digest" onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            </div>
            <div>
              <div className="wf-field-lbl">Trigger</div>
              <div className="tabs sm" style={{ marginBottom: 8 }}>
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
            <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-2)' }}>
              <span className="zs-body-sm" style={{ flex: 1 }}>You’ll add steps next.</span>
              <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onClose}>Cancel</button>
              <button className="zs-btn zs-btn-primary zs-btn-sm" disabled={!name.trim()} onClick={create}><Icon name="arrow" size={13} tone="paper" /> Create &amp; build</button>
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
      <div className="view-pad wide rise">
        <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-3)' }}>
          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Workflows</button>
          {wf.createdByUser && <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onDelete} style={{ marginLeft: 'auto' }}><Icon name="trash" size={14} tone="mute" /> Delete</button>}
        </div>
        <div className="page-hd" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <span className={'wf-trig ' + wf.trigger.kind} style={{ width: 30, height: 30 }}><Icon name={WF.TRIG[wf.trigger.kind].ic} size={15} tone={wf.trigger.kind === 'event' ? 'accent' : 'soft'} /></span>
              <Clf cls={wf.cls} />
              <ShareTag w={wf} />
              {isAgent && <span className="wf-preview-badge">agent · v2 preview</span>}
            </div>
            {isAgent
              ? <h1 className="zs-h1">{wf.name}</h1>
              : <input className="wf-edit-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--text-2xl)', color: 'var(--ink)', maxWidth: 560 }} value={wf.name} onChange={(e) => onPatch({ name: e.target.value })} placeholder="Untitled workflow" />}
            <p className="zs-body-sm" style={{ marginTop: 4 }}>{WF.TRIG[wf.trigger.kind].label} · {wf.trigger.detail || 'no detail yet'} · owner {wf.owner}</p>
          </div>
          <div className="flex items-center gap-2" style={{ position: 'relative' }}>
            {!isAgent && (
              <span className="flex items-center gap-2" style={{ marginRight: 2 }}>
                <span className="zs-body-sm">{wf.status === 'paused' ? 'Paused' : wf.status === 'draft' ? 'Draft' : 'Active'}</span>
                <Switch on={isActive} onClick={onToggle} label="active" />
              </span>
            )}
            <button className="zs-btn zs-btn-secondary" onClick={() => setShareOpen((v) => !v)}><Icon name={scMeta.ic} size={15} tone="soft" /> Share</button>
            {shareOpen && <SharePanel value={sc} people={wf.people} members={ws.members} onApply={applyShare} onClose={() => setShareOpen(false)} />}
            <button className="zs-btn zs-btn-primary" disabled={isAgent} onClick={() => { if (isAgent) return; setRan(true); setTimeout(() => setRan(false), 1600); }} title={isAgent ? 'Agents run in v2' : 'Run now'}>
              <Icon name={ran ? 'check' : 'playground'} size={15} tone="paper" /> {ran ? 'Queued' : isAgent ? 'Preview' : 'Run now'}
            </button>
          </div>
        </div>

        <div className="wf-tabs" style={{ marginBottom: 'var(--space-5)' }}>
          {[['builder', 'Builder'], ['runs', 'Runs'], ['gov', 'Governance']].map(([k, l]) => (
            <button key={k} className={'wf-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}{k === 'runs' && wf.runs && wf.runs.length ? ' · ' + wf.runs.length : ''}</button>
          ))}
        </div>

        {tab === 'builder' && (isAgent ? <WF.AgentBuilder wf={wf} /> : (
          <div>
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-5)' }}>
              <span className="zs-body-sm">Build it as a</span>
              <div className="tabs sm">
                <button className={'tab' + (builder === 'list' ? ' on' : '')} onClick={() => setB('list')}><Icon name="list" size={14} tone={builder === 'list' ? 'ink' : 'mute'} /> List</button>
                <button className={'tab' + (builder === 'canvas' ? ' on' : '')} onClick={() => setB('canvas')}><Icon name="branch" size={14} tone={builder === 'canvas' ? 'ink' : 'mute'} /> Canvas</button>
              </div>
              {builder === 'canvas' && <span className="zs-body-sm" style={{ color: 'var(--ink-faint)' }}>· edit steps in List; the canvas mirrors them</span>}
            </div>
            {builder === 'list'
              ? <WF.ListBuilder wf={wf} onFlow={(f) => onPatch({ flow: f })} onTrigger={(t) => onPatch({ trigger: t })} />
              : <WF.CanvasBuilder wf={wf} />}
          </div>
        ))}
        {tab === 'runs' && <RunsTab wf={wf} />}
        {tab === 'gov' && <GovTab wf={wf} ws={ws} />}
      </div>
    );
  }

  /* ── index ── */
  const FILTERS = [['all', 'All'], ['schedule', 'Scheduled'], ['event', 'Event'], ['manual', 'Manual'], ['agent', 'Agents']];

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
      <div className="view-pad wide rise">
        {creating && <NewWorkflowDialog ws={ws} onCreate={create} onClose={() => setCreating(false)} />}
        <PageHeader eyebrow="Workflows" chip={ws} title="Automations"
          sub="Repeatable plans that run on a schedule, on an event, or on demand — each one routed through the gateway with the same guardrails and budget as a person."
          actions={<button className="zs-btn zs-btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} tone="paper" /> New workflow</button>} />

        <div className="grid-stats" style={{ marginBottom: 'var(--space-5)' }}>
          {METRICS.map(([l, v, s]) => (
            <div key={l} className="card" style={{ padding: 'var(--space-4)' }}>
              <div className="zs-eyebrow" style={{ marginBottom: 8 }}>{l}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-2xl)', lineHeight: 1, color: l === 'Needs review' && review ? 'var(--warning)' : 'var(--ink)' }}>{v}</div>
              <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 6 }}>{s}</div>
            </div>
          ))}
        </div>

        <div className="tabs sm" style={{ marginBottom: 'var(--space-5)' }}>
          {FILTERS.map(([k, l]) => <button key={k} className={'tab' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>)}
        </div>

        {mine.length > 0 && renderGroup(mine)}
        {shared.length > 0 && (
          <div style={{ marginTop: mine.length ? 'var(--space-6)' : 0 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-3)' }}>
              <Icon name="org" size={14} tone="faint" />
              <span className="rail-label" style={{ padding: 0 }}>Shared across the company</span>
            </div>
            {renderGroup(shared)}
          </div>
        )}
        {shown.length === 0 && (
          <div style={{ padding: 'var(--space-8) var(--space-5)', textAlign: 'center', border: '1px dashed var(--paper-edge)', borderRadius: 'var(--radius-lg)', color: 'var(--ink-mute)' }}>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--ink-soft)' }}>No workflows here yet.</div>
            <div className="zs-body-sm" style={{ marginTop: 4 }}>Nothing matches this filter in {ws.name}. Start one with <b>New workflow</b>.</div>
          </div>
        )}
      </div>
    );
  }

  window.WorkflowsView = WorkflowsView;
})();
