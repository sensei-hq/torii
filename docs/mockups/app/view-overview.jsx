/* Strategos Console · view-overview.jsx — the daily briefing / dashboard. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ProviderDot, Pill } = window.StrategosUI;
  const { money } = window.StrategosData;

  // 14-day blended cost-per-call trend (lower is better)
  const TREND = [0.043, 0.041, 0.044, 0.039, 0.038, 0.040, 0.037, 0.036, 0.034, 0.035, 0.031, 0.030, 0.029, 0.028];

  function Spark({ data }) {
    const w = 196, h = 52, gap = 3;
    const max = Math.max(...data), bw = (w - gap * (data.length - 1)) / data.length;
    return (
      <svg width={w} height={h + 14} style={{ display: 'block', overflow: 'visible' }}>
        {data.map((v, i) => {
          const bh = Math.max(3, (v / max) * h), last = i === data.length - 1;
          return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx="1.5" fill={last ? 'var(--accent)' : 'var(--ink-faint)'} opacity={last ? 1 : 0.6} />;
        })}
        <text x="0" y={h + 11} fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">14d ago</text>
        <text x={w} y={h + 11} fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)" textAnchor="end">today</text>
      </svg>
    );
  }

  function Stat({ label, value, unit, hint, tone }) {
    return (
      <div className="card stat">
        <div className="zs-eyebrow" style={{ marginBottom: 10 }}>{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="num" style={{ color: tone || 'var(--ink)' }}>{value}</span>
          {unit && <span className="unit">{unit}</span>}
        </div>
        {hint && <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>{hint}</div>}
      </div>
    );
  }

  const TOP_MODELS = [
    { id: 'sonnet-4.6',     provider: 'anthropic', share: 52, calls: '1.9k' },
    { id: 'gemini-3-flash', provider: 'google',    share: 23, calls: '840' },
    { id: 'gemma-4-9b',     provider: 'local',     share: 14, calls: '510' },
    { id: 'gpt-5.2',        provider: 'openai',    share: 11, calls: '400' },
  ];

  function OverviewView({ go }) {
    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Wed · 22 Apr · last 24h</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Good morning, Aiko.</h1>
          </div>
          <div className="flex items-center gap-2">
            <Pill icon="check" kind="success">gateway healthy</Pill>
            <button className="zs-btn zs-btn-primary" onClick={() => go('playground')}>Open playground <Icon name="arrow" size={14} tone="paper" /></button>
          </div>
        </div>

        {/* hero insight — the single thing worth knowing today (icon, not kanji) */}
        <div className="card" style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 'var(--space-5)', alignItems: 'center', padding: 'var(--space-5)' }}>
          <span style={{ width: 56, height: 56, borderRadius: 'var(--radius-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', border: '1px solid oklch(0.58 0.15 35 / 0.25)' }}>
            <Icon name="routing" size={28} tone="accent" />
          </span>
          <div>
            <div className="zs-h3" style={{ marginBottom: 4 }}>Routing saved Northwind <b style={{ fontWeight: 600 }}>$2,140</b> this week.</div>
            <p className="zs-body-sm" style={{ maxWidth: 640 }}>Step-downs and the free floor served 38% of calls below the requested tier — with no measurable drop in answer quality. Support hit its 20% budget floor twice; consider raising its cap.</p>
          </div>
          <button className="zs-btn zs-btn-secondary" onClick={() => go('routing')}>Review routing</button>
        </div>

        {/* stat row */}
        <div className="grid grid-cols-4 gap-4" style={{ marginTop: 'var(--space-5)' }}>
          <Stat label="Spend · today" value="$157" unit="/ $1,333 cap" hint="11.8% of daily cap" />
          <Stat label="Calls served" value="3,640" hint="↑ 8% vs yesterday" tone="var(--ink)" />
          <Stat label="Fallbacks" value="47" hint="3 outages · 44 budget" tone="var(--warning)" />
          <Stat label="Avg latency" value="1.3" unit="s" hint="p95 · 2.6s" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 'var(--space-5)', marginTop: 'var(--space-5)', alignItems: 'start' }}>
          {/* cost trend */}
          <div className="card">
            <div className="card-hd"><span className="zs-eyebrow">Blended cost / call · 14d</span><span className="pill success"><Icon name="check" size={13} tone="success" />−35%</span></div>
            <div style={{ padding: '20px 20px 8px' }}>
              <div className="flex items-baseline gap-1" style={{ marginBottom: 14 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-3xl)', lineHeight: 1 }}>$0.028</span>
                <span className="unit" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-sm)' }}>per call</span>
              </div>
              <Spark data={TREND} />
            </div>
            <div className="card-foot dashed" style={{ fontFamily: 'var(--font-mono)' }}>Trending down as more traffic lands on local + flash tiers.</div>
          </div>

          {/* top models */}
          <div className="card">
            <div className="card-hd"><span className="zs-eyebrow">Most-used models</span><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => go('models')}>all models →</button></div>
            <div style={{ padding: '8px 20px 16px' }}>
              {TOP_MODELS.map((m) => (
                <div key={m.id} className="flex items-center gap-3" style={{ padding: '10px 0', borderBottom: '1px solid var(--paper-edge)' }}>
                  <ProviderDot provider={m.provider} size={8} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)', width: 130 }}>{m.id}</span>
                  <div className="meter" style={{ flex: 1 }}><i style={{ width: m.share + '%', background: 'var(--ink-mute)' }} /></div>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', width: 56, textAlign: 'right' }}>{m.calls} · {m.share}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* quick actions */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Jump back in</h2></div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { ic: 'playground', t: 'Chat with documents', s: '1,240 docs indexed · RAG', go: 'playground' },
              { ic: 'requests',   t: 'Inspect recent calls', s: 'live ledger · last 1h', go: 'requests' },
              { ic: 'keys',       t: 'Manage credentials',   s: '4 of 6 routers connected', go: 'keys' },
            ].map((a) => (
              <button key={a.t} className="card" onClick={() => go(a.go)} style={{ padding: 'var(--space-4)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', transition: 'background var(--dur-fast) var(--ease)' }}>
                <span style={{ width: 38, height: 38, borderRadius: 'var(--radius)', display: 'grid', placeItems: 'center', background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', flexShrink: 0 }}><Icon name={a.ic} size={18} tone="soft" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{a.t}</span>
                  <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>{a.s}</span>
                </span>
                <Icon name="arrow" size={15} tone="faint" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.OverviewView = OverviewView;
})();
