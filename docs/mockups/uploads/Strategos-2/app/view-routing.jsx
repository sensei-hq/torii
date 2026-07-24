/* Strategos Console · view-routing.jsx (admin)
   Routing behaviour: the budget-driven fallback chain + the routing policy.
   Budget *limits* live in Organization; this screen is about what gets served. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Switch, ProviderDot, Pill, Tag, ExecBadge, PageHeader } = window.StrategosUI;
  const { FALLBACK_CHAIN, ROUTERS, modelById, money, GATEWAY_REGION } = window.StrategosData;
  const { useState } = React;

  function tone(pct) { return pct >= 92 ? 'var(--danger)' : pct >= 75 ? 'var(--warning)' : 'var(--success)'; }

  function FallbackChain() {
    const [remaining, setRemaining] = useState(64);
    const [outage, setOutage] = useState(false);
    let idx = outage ? 2 : remaining <= 0 ? 3 : remaining < 20 ? 1 : 0;
    const active = FALLBACK_CHAIN[idx];

    return (
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd">
          <div><div className="zs-eyebrow" style={{ marginBottom: 4 }}>Fallback chain</div><div className="zs-h3">Always finish the task — at the right price</div></div>
          <Tag>RAG · chat with docs</Tag>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <div className="flex items-center" style={{ gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="flex justify-between" style={{ marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Budget remaining</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: tone(100 - remaining) }}>{remaining}%</span>
              </div>
              <input type="range" min="0" max="100" value={remaining} onChange={(e) => setRemaining(+e.target.value)} disabled={outage} />
            </div>
            <button type="button" onClick={() => setOutage((o) => !o)} className="flex items-center" style={{ gap: 9, height: 36, padding: '0 12px', borderRadius: 'var(--radius)',
              border: '1px solid ' + (outage ? 'var(--accent)' : 'var(--paper-edge)'), background: outage ? 'var(--accent-soft)' : 'var(--paper)', color: outage ? 'var(--accent)' : 'var(--ink-mute)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              <Icon name="bolt" size={14} tone={outage ? 'accent' : 'mute'} /> Simulate provider outage
              <Switch on={outage} onClick={() => setOutage((o) => !o)} label="outage" />
            </button>
          </div>

          <div className="flex flex-col">
            {FALLBACK_CHAIN.map((step, i) => {
              const sm = modelById(step.model);
              const on = i === idx;
              const skipped = i < idx && !(outage && i < 2);
              return (
                <div key={step.model}>
                  <div className="flex items-center" style={{ gap: 12, padding: '12px 14px', borderRadius: 'var(--radius-lg)', opacity: skipped ? 0.5 : 1, transition: 'all var(--dur) var(--ease)',
                    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent-soft)' : 'var(--paper)' }}>
                    <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', width: 14 }}>{i + 1}</span>
                    <ProviderDot provider={sm.provider} size={9} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{step.model}</span>
                        <Tag>{step.role}</Tag>
                        {on && <span className="pill accent" style={{ height: 20 }}><span className="dot" style={{ background: 'var(--accent)' }} />serving now</span>}
                        {skipped && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>· skipped</span>}
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{step.rule} · {sm.route}</span>
                        <ExecBadge local={sm.route === 'Ollama'} region={GATEWAY_REGION} />
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: step.price === 0 ? 'var(--success)' : 'var(--ink-mute)' }}>{step.price === 0 ? 'free' : money(step.price) + '/M'}</span>
                  </div>
                  {i < FALLBACK_CHAIN.length - 1 && <div style={{ marginLeft: 21, height: 12, width: 1, background: 'var(--paper-edge)' }} />}
                </div>
              );
            })}
          </div>

          <div className="flex items-center" style={{ marginTop: 16, padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--success)', flexShrink: 0 }}><Icon name="check" size={15} tone="paper" /></span>
            <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.45, color: 'var(--ink)' }}>
              {outage ? <span>Provider error → routed to <b>{active.model}</b> for resilience. The task still completes.</span>
                : remaining <= 0 ? <span>Budget exhausted → dropped to the <b>free floor ({active.model})</b>. Work continues; no surprise bill.</span>
                : remaining < 20 ? <span>Under 20% budget → stepped down to <b>{active.model}</b> to protect the cap.</span>
                : <span>Plenty of headroom → serving the primary <b>{active.model}</b> at full quality.</span>}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const HEALTH = { Anthropic: 'ok', OpenAI: 'ok', Bedrock: 'ok', Vercel: 'ok', OpenRouter: 'degraded', Ollama: 'ok' };

  function RoutingPolicy() {
    const ROWS = [
      ['Retry budget', '2 attempts · 800ms backoff'],
      ['Hard timeout', '30s per call'],
      ['Region pin', 'eu-west-2 only'],
      ['Health check', 'every 10s'],
    ];
    return (
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd"><div><div className="zs-eyebrow" style={{ marginBottom: 4 }}>Routing policy</div><div className="zs-h3">When to retry, wait, or pin</div></div></div>
        <div style={{ padding: '8px 0' }}>
          {ROWS.map((r) => (
            <div key={r[0]} className="flex items-center justify-between" style={{ padding: '11px var(--space-5)', borderBottom: '1px solid var(--paper-edge)' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{r[0]}</span>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{r[1]}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
          <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Provider health</div>
          <div className="flex flex-col gap-2">
            {ROUTERS.map((r) => {
              const ok = HEALTH[r.id] === 'ok';
              return (
                <div key={r.id} className="flex items-center gap-3">
                  <ProviderDot provider={r.id === 'Ollama' ? 'local' : 'anthropic'} size={7} />
                  <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{r.id}</span>
                  <span className="status" style={{ color: ok ? 'var(--success)' : 'var(--warning)' }}>
                    <span className="dot" style={{ background: ok ? 'var(--success)' : 'var(--warning)' }} />{ok ? 'healthy' : 'degraded'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function RoutingView() {
    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Routing" title="Spend it like it's yours" subMax={640}
          sub={<>Fallbacks keep work flowing when money or providers run out. Spend <em>limits</em> live in Organization; this is how the gateway behaves against them.</>}
          actions={<Pill icon="org">budget limits → Organization</Pill>} />
        <div className="grid-split">
          <FallbackChain />
          <RoutingPolicy />
        </div>
      </div>
    );
  }

  window.RoutingView = RoutingView;
})();
