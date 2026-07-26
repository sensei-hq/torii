/* Torii · view-compare.jsx (member)
   Run one question across 2–4 models / pipelines side by side, with an
   optional quality-judge that ranks the answers. The old "mixologist". */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Meter, Pill, ProviderDot, ExecBadge, useEnv, useWorkspace, PageHeader } = window.StrategosUI;
  const { MODELS, modelById, money, GATEWAY_REGION } = window.StrategosData;
  const { useState } = React;

  const PROMPT = 'Which properties breached their service-charge budget last quarter, and by how much?';

  // deterministic per-model answer flavor, keyed by tier
  const SNIP = {
    frontier: <span>Three properties breached budget: <b>Maple Court (+£14,200)</b>, <b>Harbour View (+£9,750)</b> and <b>Old Mill Lofts (+£3,110)</b>, from the reconciliation table.</span>,
    balanced: <span>Two clearly over: <b>Maple Court</b> and <b>Harbour View</b>. A third (Old Mill Lofts) is marginal — the excerpt is less explicit on the figure.</span>,
    fast:     <span>Maple Court and Harbour View look over budget on maintenance. Exact figures aren’t stated in the passages I retrieved.</span>,
    local:    <span>Some properties exceeded their service-charge budget — Maple Court is mentioned most. I can’t tie exact amounts to each from the local index.</span>,
  };

  function ColHead({ m, onRemove, removable }) {
    return (
      <div className="flex items-center gap-2" style={{ padding: '10px var(--space-4)', borderBottom: '1px solid var(--paper-edge)' }}>
        <ProviderDot provider={m.provider} size={8} />
        <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id}</span>
        <span className="tag">{m.tier}</span>
        {removable && <button onClick={onRemove} title="Remove" style={{ color: 'var(--ink-mute)' }}><Icon name="close" size={14} tone="mute" /></button>}
      </div>
    );
  }

  function CompareView({ go }) {
    const { ws } = useWorkspace();
    const { meta } = useEnv();
    const [sel, setSel] = useState(() => { const h = window.StrategosUI.Handoff && window.StrategosUI.Handoff.take(); const cm = h && h.compareModel; const base = ['opus-4.8', 'sonnet-4.6', 'gemma-4-9b']; return cm && !base.includes(cm) ? [cm, ...base].slice(0, 4) : base; });
    const [judge, setJudge] = useState(true);
    const [pickOpen, setPickOpen] = useState(false);

    const cols = sel.map((id) => modelById(id)).filter(Boolean);
    const metricsOf = (m) => {
      const local = !!m.localCap || !meta.online;   // plane, not provider name
      const grounding = Math.min(99, m.q - 4);
      const quality = m.q;
      const cost = m.price === 0 ? 0 : +(m.price * 4600 / 1e6).toFixed(4);
      const lat = m.lat + 400;
      return { local, grounding, quality, cost, lat };
    };
    const ranked = [...cols].map((m) => ({ m, s: metricsOf(m) }))
      .sort((a, b) => (b.s.quality + b.s.grounding - b.s.cost * 50) - (a.s.quality + a.s.grounding - a.s.cost * 50));
    const winner = ranked[0] && ranked[0].m.id;

    const remove = (id) => setSel((s) => s.filter((x) => x !== id));
    const add = (id) => { setSel((s) => (s.includes(id) || s.length >= 4 ? s : [...s, id])); setPickOpen(false); };

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Playground" chip={ws} title="Compare"
          sub="Ask once, see how different models and pipelines answer side by side. The judge scores each on grounding, quality and cost."
          actions={<button className="zs-btn zs-btn-secondary" onClick={() => setJudge((v) => !v)}><Icon name={judge ? 'check' : 'scale'} size={15} tone={judge ? 'success' : 'soft'} /> Quality judge {judge ? 'on' : 'off'}</button>} />

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="flex items-center gap-2" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <span className="glyph" style={{ width: 30, height: 30 }}><Icon name="ask" size={15} tone="soft" /></span>
            <span style={{ flex: 1, fontSize: 'var(--text-base)', color: 'var(--ink)' }}>{PROMPT}</span>
            <span className="pill"><Icon name="database" size={13} tone="mute" /> {ws.items.toLocaleString()} indexed</span>
          </div>
        </div>

        <div className="cmp" style={{ '--cols': cols.length }}>
          {ranked.map(({ m, s }) => (
            <div key={m.id} className={'card' + (judge && m.id === winner ? ' cmp-win' : '')} style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ColHead m={m} removable={cols.length > 2} onRemove={() => remove(m.id)} />
              {judge && m.id === winner && <div className="flex items-center gap-2" style={{ padding: '6px var(--space-4)', background: 'var(--accent-soft)', borderBottom: '1px solid var(--paper-edge)' }}><Icon name="star" size={13} tone="accent" /><span className="zs-eyebrow" style={{ margin: 0, color: 'var(--accent)' }}>Judge’s pick</span></div>}
              <div style={{ padding: 'var(--space-4)', flex: 1 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><ExecBadge local={s.local} region={GATEWAY_REGION} verb /></div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', lineHeight: 1.55 }}>{SNIP[m.tier] || SNIP.balanced}</div>
              </div>
              <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--paper-edge)', display: 'grid', gap: 'var(--space-3)' }}>
                <Meter label="Grounding" value={s.grounding} display={s.grounding + '%'} tone={s.grounding > 80 ? 'success' : 'accent'} />
                <Meter label="Quality"   value={s.quality} display={s.quality + '%'} tone={s.quality > 85 ? 'success' : 'accent'} />
                <Meter label="Cost"      value={s.cost * 1000} max={120} display={s.cost === 0 ? 'free' : (s.cost * 100).toFixed(2) + '¢'} tone={s.cost > 0.06 ? 'warning' : 'ink'} />
                <Meter label="Latency"   value={s.lat} max={4200} display={(s.lat / 1000).toFixed(1) + 's'} tone={s.lat > 2600 ? 'warning' : 'ink'} />
              </div>
            </div>
          ))}
          {cols.length < 4 && (
            <button className="cmp-add" onClick={() => setPickOpen((v) => !v)}>
              <Icon name="plus" size={20} tone="mute" />
              <span>Add a model</span>
              {pickOpen && (
                <div className="rise" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', width: 240, zIndex: 30, background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', padding: 4 }} onClick={(e) => e.stopPropagation()}>
                  {MODELS.filter((m) => !sel.includes(m.id)).map((m) => (
                    <button key={m.id} onClick={() => add(m.id)} className="tpl-row">
                      <ProviderDot provider={m.provider} size={7} />
                      <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id}</span>
                      <span className="tag">{m.tier}</span>
                    </button>
                  ))}
                </div>
              )}
            </button>
          )}
        </div>

        {judge && (
          <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="scale" size={15} tone="accent" /><span className="zs-eyebrow">Judge verdict</span></span><button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => { if (winner) { window.StrategosUI.Handoff.set({ preset: { model: winner } }); if (go) go('playground'); } }}><Icon name="playground" size={13} tone="soft" /> Open winner in Playground</button></div>
            <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
              {ranked.map(({ m, s }, i) => (
                <div key={m.id} className="flex items-center gap-3" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-lg)', color: i === 0 ? 'var(--accent)' : 'var(--ink-mute)', width: 22 }}>{i + 1}</span>
                  <span className="mono" style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                  <span className="zs-body-sm" style={{ fontSize: 12 }}>{i === 0 ? 'best grounding-to-cost balance' : s.cost === 0 ? 'cheapest — runs on-device' : s.quality >= 94 ? 'strong, but pricier' : 'weaker grounding here'}</span>
                </div>
              ))}
            </div>
            <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>The judge is a model too — treat its ranking as a fast heuristic, not a verdict. Promote a winner to a space default in the Playground.</span></div>
          </div>
        )}
      </div>
    );
  }

  const STYLE = `
    .zs .cmp { display: grid; grid-template-columns: repeat(var(--cols), 1fr) auto; gap: var(--space-4); align-items: stretch; }
    .zs .cmp-win { box-shadow: inset 0 2px 0 var(--accent); }
    .zs .cmp-add { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-width: 150px;
      border: 1px dashed var(--paper-edge); border-radius: var(--radius-lg); color: var(--ink-mute); font-size: var(--text-sm);
      position: relative; cursor: pointer; transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
    .zs .cmp-add:hover { background: var(--paper-mute); border-color: var(--ink-mute); }
    @media (max-width: 1000px) { .zs .cmp { grid-template-columns: 1fr 1fr; } .zs .cmp-add { min-height: 120px; } }
    @media (max-width: 620px) { .zs .cmp { grid-template-columns: 1fr; } }
  `;
  function Wrapped(props) { return React.createElement(React.Fragment, null, React.createElement('style', null, STYLE), React.createElement(CompareView, props)); }
  window.CompareView = Wrapped;
})();
