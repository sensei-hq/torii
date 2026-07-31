/* Seiki · view-routing.jsx — routing behaviour, now editable.
   Named chains per capability, an editable + reorderable fallback chain
   (add/remove/move steps, per-step model & trigger), which chain a space/role
   uses, and an editable routing policy. Budget *limits* live in Organization. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, CardHead, CardFoot, ViewPad, Split, Button, Table, Switch, ProviderDot, Pill, Tag, PageHeader } = window.StrategosUI;
  const { FALLBACK_CHAIN, ROUTERS, MODELS, modelById, money, GATEWAY_REGION } = window.StrategosAPI;
  const { useState } = React;

  function tone(pct) { return pct >= 92 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--success)'; }
  const { ROLES, ASSIGN0, HEALTH } = window.StrategosAPI.content.routing;

  const CHAINS0 = {
    chat:  { label: 'Chat with docs', steps: FALLBACK_CHAIN.map((s) => ({ ...s })) },
    cheap: { label: 'Cheap / bulk', steps: [
      { model: 'gemini-3-flash', rule: 'default for bulk', price: 0.45, role: 'primary' },
      { model: 'gemma-4-9b', rule: 'if budget < 20%', price: 0, role: 'step-down' },
      { model: 'mistral-small-free', rule: 'if provider error', price: 0, role: 'resilience' },
    ] },
    local: { label: 'Local-only', steps: [
      { model: 'gemma-4-9b', rule: 'always on-device', price: 0, role: 'primary' },
      { model: 'mistral-small-free', rule: 'if unavailable', price: 0, role: 'resilience' },
    ] },
    demo:  { label: 'Demo', steps: [
      { model: 'sonnet-4.6', rule: 'demo default', price: 4.5, role: 'primary' },
      { model: 'gemma-4-9b', rule: 'if budget exhausted', price: 0, role: 'free floor' },
    ] },
  };

  function idxFor(steps, remaining, outage) {
    const byRole = (r) => steps.findIndex((s) => s.role === r);
    if (outage) { const i = byRole('resilience'); return i >= 0 ? i : steps.length - 1; }
    if (remaining <= 0) { const i = byRole('free floor'); return i >= 0 ? i : steps.length - 1; }
    if (remaining < 20) { const i = byRole('step-down'); return i >= 0 ? i : 0; }
    return 0;
  }

  function ChainEditor() {
    const [chains, setChains] = useState(() => structuredClone(CHAINS0));
    const [key, setKey] = useState('chat');
    const [remaining, setRemaining] = useState(64);
    const [outage, setOutage] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const steps = chains[key].steps;
    const idx = idxFor(steps, remaining, outage);
    const active = steps[idx] || steps[0];

    const mut = (fn) => setChains((c) => { const n = structuredClone(c); fn(n[key].steps); return n; });
    const move = (i, d) => mut((s) => { const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; });
    const remove = (i) => mut((s) => s.splice(i, 1));
    const setRule = (i, v) => mut((s) => { s[i].rule = v; });
    const setRole = (i, v) => mut((s) => { s[i].role = v; });
    const setPlane = (i, v) => mut((s) => { s[i].plane = v; });
    const addChain = () => { const nk = 'chain' + Date.now(); setChains((c) => ({ ...c, [nk]: { label: 'New chain', steps: [{ model: 'sonnet-4.6', rule: 'default', price: 4.5, role: 'primary' }] } })); setKey(nk); };
    const addStep = (id) => { const m = modelById(id); mut((s) => s.push({ model: id, rule: 'if …', price: m ? m.price : 0, role: 'step-down' })); setAddOpen(false); };

    return (
      <Card className="overflow-hidden">
        <CardHead>
          <div><div className="zs-eyebrow mb-1">Fallback chain</div><div className="zs-h3">Always finish the task — at the right price</div></div>
          <span className="flex items-center gap-2">
            <select value={key} onChange={(e) => setKey(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '600 12px var(--font-ui)', color: 'var(--ink)', padding: '6px 9px', cursor: 'pointer' }}>
              {Object.entries(chains).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={addChain}><Icon name="plus" size={13} tone="soft" /> New chain</Button>
          </span>
        </CardHead>
        <div className="py-4 px-5">
          <div className="flex items-center gap-4 flex-wrap mb-4">
            <div className="flex-1 min-w-[220px]">
              <div className="flex justify-between mb-2">
                <span className="font-mono text-xs tracking-[0.06em] uppercase text-ink-mute">Budget remaining · simulate</span>
                <span className="font-mono text-sm font-semibold" style={{ color: tone(100 - remaining) }}>{remaining}%</span>
              </div>
              <input type="range" min="0" max="100" value={remaining} onChange={(e) => setRemaining(+e.target.value)} disabled={outage} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <button type="button" onClick={() => setOutage((o) => !o)} className="flex items-center" style={{ gap: 9, height: 36, padding: '0 12px', borderRadius: 'var(--radius)',
              border: '1px solid ' + (outage ? 'var(--accent)' : 'var(--paper-edge)'), background: outage ? 'var(--accent-soft)' : 'var(--paper)', color: outage ? 'var(--accent)' : 'var(--ink-mute)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              <Icon name="bolt" size={14} tone={outage ? 'accent' : 'mute'} /> Simulate outage
              <Switch on={outage} onClick={() => setOutage((o) => !o)} label="outage" />
            </button>
          </div>

          <div className="flex flex-col">
            {steps.map((step, i) => {
              const sm = modelById(step.model) || { provider: 'local', route: 'Ollama' };
              const on = i === idx;
              return (
                <div key={i}>
                  <div className="flex items-center gap-2.5 py-2.5 px-3 rounded-lg" style={{ transition: 'all var(--dur) var(--ease)',
                    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent-soft)' : 'var(--paper)' }}>
                    <div className="flex flex-col gap-px">
                      <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={{ opacity: i === 0 ? 0.3 : 1, display: 'grid', placeItems: 'center', height: 14 }}><Icon name="caret" size={11} tone="mute" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down" style={{ opacity: i === steps.length - 1 ? 0.3 : 1, display: 'grid', placeItems: 'center', height: 14, transform: 'rotate(180deg)' }}><Icon name="caret" size={11} tone="mute" /></button>
                    </div>
                    <ProviderDot provider={sm.provider} size={9} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-ink">{step.model}</span>
                        <select value={step.role} onChange={(e) => setRole(i, e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-full)', background: 'var(--paper-mute)', font: '500 10.5px var(--font-mono)', color: 'var(--ink-soft)', padding: '1px 6px', cursor: 'pointer' }}>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {on && <Pill kind="accent" className="h-[20px]"><span className="dot" style={{ background: 'var(--accent)' }} />serving now</Pill>}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <input value={step.rule} onChange={(e) => setRule(i, e.target.value)} style={{ flex: 1, minWidth: 80, maxWidth: 220, font: '11px var(--font-mono)', color: 'var(--ink-mute)', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', background: 'transparent', padding: '2px 4px' }} onFocus={(e) => e.target.style.borderColor = 'var(--paper-edge)'} onBlur={(e) => e.target.style.borderColor = 'transparent'} />
                        {(() => { const pl = step.plane || ((modelById(step.model) || {}).localCap ? 'local' : 'cloud'); return (
                          <div className="inline-flex border rounded overflow-hidden" title="Per-step execution plane">
                            {[['local', 'Local'], ['cloud', 'Cloud']].map(([v, lab], j) => { const sel = pl === v; return <button key={v} onClick={() => setPlane(i, v)} style={{ height: 22, padding: '0 8px', fontSize: 10.5, fontWeight: 500, borderLeft: j ? '1px solid var(--paper-edge)' : 'none', background: sel ? (v === 'local' ? 'var(--success)' : 'var(--ink)') : 'transparent', color: sel ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>; })}
                          </div>
                        ); })()}
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold" style={{ color: step.price === 0 ? 'var(--success)' : 'var(--ink-mute)' }}>{step.price === 0 ? 'free' : money(step.price) + '/M'}</span>
                    <button onClick={() => remove(i)} disabled={steps.length <= 1} title="Remove step" style={{ display: 'grid', placeItems: 'center', opacity: steps.length <= 1 ? 0.3 : 1 }}><Icon name="trash" size={13} tone="faint" /></button>
                  </div>
                  {i < steps.length - 1 && <div className="ml-8 h-[10px] w-[1px] bg-paper-edge" />}
                </div>
              );
            })}
          </div>

          <div className="relative mt-3">
            <Button variant="secondary" size="sm" style={{ borderStyle: 'dashed' }} onClick={() => setAddOpen((v) => !v)}><Icon name="plus" size={13} tone="soft" /> Add step</Button>
            {addOpen && (
              <div className="rise absolute z-[20] w-[220px] max-h-[260px] overflow-y-auto bg-paper border rounded-lg shadow p-1" style={{ top: 'calc(100% + 6px)', left: 0}}>
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => addStep(m.id)} className="tpl-row"><ProviderDot provider={m.provider} size={7} /><span className="flex-1 min-w-0 font-mono text-sm text-ink text-left">{m.id}</span><Tag>{m.tier}</Tag></button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center mt-4 py-3 px-3.5 rounded bg-paper-mute border gap-2.5">
            <span className="w-[28px] h-[28px] rounded-[7px] grid place-items-center bg-success shrink-0"><Icon name="check" size={15} tone="paper" /></span>
            <span className="text-sm leading-[1.45] text-ink">
              {outage ? <span>Provider error → routed to <b>{active.model}</b> for resilience.</span>
                : remaining <= 0 ? <span>Budget exhausted → dropped to <b>{active.model}</b>. No surprise bill.</span>
                : remaining < 20 ? <span>Under 20% budget → stepped down to <b>{active.model}</b>.</span>
                : <span>Plenty of headroom → serving <b>{active.model}</b> at full quality.</span>}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  function RoutingPolicy() {
    const [p, setP] = useState({ retries: 2, backoff: 800, timeout: 30, region: 'eu-west-2', health: 10 });
    const set = (k, v) => setP((o) => ({ ...o, [k]: v }));
    const numInp = { width: 64, border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '4px 6px', textAlign: 'right' };
    return (
      <Card className="overflow-hidden">
        <CardHead><div><div className="zs-eyebrow mb-1">Routing policy</div><div className="zs-h3">When to retry, wait, or pin</div></div></CardHead>
        <div className="py-2 px-0">
          <div className="flex items-center justify-between py-2.5 px-6 border-b">
            <span className="text-sm text-ink-soft">Retry budget</span>
            <span className="flex items-center gap-2"><input type="number" min="0" max="5" value={p.retries} onChange={(e) => set('retries', +e.target.value)} style={numInp} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>attempts ·</span><input type="number" step="100" value={p.backoff} onChange={(e) => set('backoff', +e.target.value)} style={numInp} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>ms backoff</span></span>
          </div>
          <div className="flex items-center justify-between py-2.5 px-6 border-b">
            <span className="text-sm text-ink-soft">Hard timeout</span>
            <span className="flex items-center gap-2"><input type="number" value={p.timeout} onChange={(e) => set('timeout', +e.target.value)} style={numInp} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>s per call</span></span>
          </div>
          <div className="flex items-center justify-between py-2.5 px-6 border-b">
            <span className="text-sm text-ink-soft">Region pin</span>
            <select value={p.region} onChange={(e) => set('region', e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
              {['eu-west-2', 'eu-central-1', 'us-east-1', 'any'].map((r) => <option key={r} value={r}>{r}{r === 'any' ? '' : ' only'}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between py-2.5 px-6">
            <span className="text-sm text-ink-soft">Health check</span>
            <span className="flex items-center gap-2"><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>every</span><input type="number" value={p.health} onChange={(e) => set('health', +e.target.value)} style={numInp} /><span className="mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>s</span></span>
          </div>
        </div>
        <div className="py-4 px-6 border-t">
          <div className="zs-eyebrow mb-3">Provider health</div>
          <div className="flex flex-col gap-2">
            {ROUTERS.map((r) => {
              const ok = HEALTH[r.id] === 'ok';
              return (
                <div key={r.id} className="flex items-center gap-3">
                  <ProviderDot provider={r.id === 'Ollama' ? 'local' : 'anthropic'} size={7} />
                  <span className="flex-1 font-mono text-sm text-ink">{r.id}</span>
                  <span className="status" style={{ color: ok ? 'var(--success)' : 'var(--warning)' }}><span className="dot" style={{ background: ok ? 'var(--success)' : 'var(--warning)' }} />{ok ? 'healthy' : 'degraded'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    );
  }

  function ChainAssignments() {
    const [rows, setRows] = useState(ASSIGN0);
    const set = (i, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, chain: v } : r)));
    return (
      <Card className="overflow-hidden mt-6">
        <CardHead><span className="flex items-center gap-2"><Icon name="routing" size={15} tone="soft" /><span className="zs-eyebrow">Chain assignments</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>which chain a space or role uses</span></CardHead>
        <div className="overflow-x-auto">
          <Table min={520}>
            <thead><tr><th>Scope</th><th>Kind</th><th>Chain</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.scope}>
                  <td style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.scope}</td>
                  <td data-th="Kind"><span className="dtag">{r.kind}</span></td>
                  <td data-th="Chain">
                    <select value={r.chain} onChange={(e) => set(i, e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
                      {Object.entries(CHAINS0).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>A space or role uses its assigned chain; unassigned scopes inherit the workspace default (<b style={{ color: 'var(--ink)' }}>Chat with docs</b>).</span></CardFoot>
      </Card>
    );
  }

  function RoutingView() {
    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Routing" title="Spend it like it's yours" subMax={640}
          sub={<>Build named fallback chains, reorder their steps, and assign them per space or role. Spend <em>limits</em> live in Organization; this is how the gateway behaves against them.</>}
          actions={<Pill icon="org">budget limits → Organization</Pill>} />
        <Split>
          <ChainEditor />
          <RoutingPolicy />
        </Split>
        <ChainAssignments />
      </ViewPad>
    );
  }

  window.RoutingView = RoutingView;
})();
