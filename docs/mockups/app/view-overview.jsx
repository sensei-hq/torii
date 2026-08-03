/* Seiki · view-overview.jsx — the daily briefing / dashboard. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, ViewPad, CardHead, CardFoot, Half, Button, ProviderDot, Pill, PageHeader } = window.StrategosUI;
  const { money } = window.StrategosAPI;

  // 14-day blended cost-per-call trend (lower is better)
  const { TREND, TOP_MODELS, SETUP } = window.StrategosAPI.content.overview;

  function Spark({ data }) {
    const w = 196, h = 52, gap = 3;
    const max = Math.max(...data), bw = (w - gap * (data.length - 1)) / data.length;
    return (
      <svg className="block overflow-visible" width={w} height={h + 14}>
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
      <Card className="stat">
        <div className="zs-eyebrow mb-2.5">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="num" style={{ color: tone || 'var(--ink)' }}>{value}</span>
          {unit && <span className="unit">{unit}</span>}
        </div>
        {hint && <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 8 }}>{hint}</div>}
      </Card>
    );
  }

  // the connect → register → route spine, with end-to-end coverage

  const ALERTS = [
    { sev: 'accent', ic: 'flag',   when: '8m', go: 'governance', text: <span><b>web-fetch</b> blocked 9× for Support — a member may need it on the allow-list.</span> },
    { sev: 'warn',   ic: 'wallet', when: '2h', go: 'billing',    text: <span><b>Support</b> hit its 20% budget floor twice today — consider raising the cap.</span> },
    { sev: 'warn',   ic: 'router', when: '1h', go: 'routing',    text: <span><b>Bedrock</b> returned 503 twice — resilience hop covered it, but watch the provider.</span> },
  ];

  function OverviewView({ go }) {
    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Wed · 22 Apr · last 24h" title="Good morning, Aiko."
          actions={<>
            <Pill icon="check" kind="success">gateway healthy</Pill>
            <Button variant="primary" onClick={() => go('playground')}>Open playground <Icon name="arrow" size={14} tone="paper" /></Button>
          </>} />

        {/* hero insight — the single thing worth knowing today (icon, not kanji) */}
        <Card className="grid-hero p-6">
          <span className="w-[56px] h-[56px] rounded-lg grid place-items-center bg-accent-soft border border-[oklch(0.58_0.15_35_/_0.25)]">
            <Icon name="routing" size={28} tone="accent" />
          </span>
          <div>
            <div className="zs-h3 mb-1">Routing saved Northwind <b style={{ fontWeight: 600 }}>$2,140</b> this week.</div>
            <p className="zs-body-sm max-w-[640px]">Step-downs and the free floor served 38% of calls below the requested tier — with no measurable drop in answer quality. Support hit its 20% budget floor twice; consider raising its cap.</p>
          </div>
          <Button variant="secondary" onClick={() => go('routing')}>Review routing</Button>
        </Card>

        {/* proactive alerts — thresholds raise them here, not buried in the ledger */}
        <Card className="overflow-hidden mt-6">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="bell" size={15} tone="soft" /><span className="zs-eyebrow">Alerts · needs attention</span></span>
            <Pill className="text-warning bg-warning-soft border-[oklch(0.72_0.12_75_/_0.30)]">{ALERTS.length} open</Pill>
          </CardHead>
          <div className="py-1 px-0">
            {ALERTS.map((a, i) => (
              <button key={i} onClick={() => go(a.go)} className="flex items-center gap-3" style={{ width: '100%', textAlign: 'left', padding: '11px 24px', borderBottom: i < ALERTS.length - 1 ? '1px solid var(--paper-edge)' : 'none', transition: 'background var(--dur-fast) var(--ease)' }}>
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: a.sev === 'warn' ? 'var(--warning)' : 'var(--accent)' }} />
                <Icon name={a.ic} size={15} tone="soft" />
                <span className="zs-body-sm flex-1 text-ink">{a.text}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{a.when}</span>
                <Icon name="arrow" size={14} tone="faint" />
              </button>
            ))}
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Thresholds on budget, policy blocks and provider health raise alerts here — no more scrolling the ledger to find trouble.</span></CardFoot>
        </Card>

        {/* stat row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
          <Stat label="Spend · today" value="$157" unit="/ $1,333 cap" hint="11.8% of daily cap" />
          <Stat label="Calls served" value="3,640" hint="↑ 8% vs yesterday" tone="var(--ink)" />
          <Stat label="Fallbacks" value="47" hint="3 outages · 44 budget" tone="var(--warning)" />
          <Stat label="Avg latency" value="1.3" unit="s" hint="p95 · 2.6s" />
        </div>

        {/* execution plane — cloud vs on-device split, savings, fleet & ingestion health */}
        <Card className="overflow-hidden mt-6">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">Execution plane · 24h</span></span>
            <Pill kind="success"><Icon name="check" size={13} tone="success" />local kept $1,180 off the bill</Pill>
          </CardHead>
          <div className="p-6">
            <div className="flex h-[10px] rounded-full overflow-hidden mb-4">
              <div className="w-[78%] bg-ink-mute" title="via gateway" />
              <div className="w-[22%] bg-success" title="on device" />
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              <span className="exec"><Icon name="globe" size={12} tone="mute" />via gateway<span className="reg">· 2,840 · 78%</span></span>
              <span className="exec exec-local"><Icon name="models" size={12} tone="success" />on device<span className="reg">· 800 · 22%</span></span>
              <span className="flex-1" />
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>on-device calls · $0 egress · never leave the machine</span>
            </div>
          </div>
          <div className="grid-flush-2">
            <button onClick={() => go('devices')} style={{ textAlign: 'left', padding: '16px 24px', borderTop: '1px solid var(--paper-edge)', borderRight: '1px solid var(--paper-edge)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'background var(--dur-fast) var(--ease)' }}>
              <Icon name="models" size={16} tone="soft" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">Device fleet</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>5 enrolled · 3 on-device · <span className="text-warning">1 offline · 3 queued</span></div>
              </div>
              <Icon name="arrow" size={14} tone="faint" />
            </button>
            <button onClick={() => go('spaces')} style={{ textAlign: 'left', padding: '16px 24px', borderTop: '1px solid var(--paper-edge)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'background var(--dur-fast) var(--ease)' }}>
              <Icon name="upload" size={16} tone="soft" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink">Ingestion queue</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>1,240 indexed · 2 embedding · <span className="text-accent">1 failed</span></div>
              </div>
              <Icon name="arrow" size={14} tone="faint" />
            </button>
          </div>
        </Card>

        {/* gateway setup spine + coverage — connect → register → route */}
        <Card className="overflow-hidden mt-6">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="router" size={15} tone="soft" /><span className="zs-eyebrow">Gateway setup &amp; coverage</span></span>
            <span className="status text-success"><span className="dot" style={{ background: 'var(--success)' }} />all advertised models reachable</span>
          </CardHead>
          <div className="grid-flush-3">
            {SETUP.map((s, i) => (
              <button key={s.go} onClick={() => go(s.go)} style={{ textAlign: 'left', padding: '24px', borderRight: i < 2 ? '1px solid var(--paper-edge)' : 'none', display: 'flex', flexDirection: 'column', gap: 10, transition: 'background var(--dur-fast) var(--ease)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-[20px] h-[20px] rounded-full shrink-0 grid place-items-center bg-paper-mute border font-mono text-xs text-ink-mute">{i + 1}</span>
                  <Icon name={s.ic} size={15} tone="soft" />
                  <span className="text-sm font-semibold text-ink">{s.title}</span>
                  <span className="flex-1" />
                  <Icon name="arrow" size={14} tone="faint" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-display font-light text-2xl leading-[1] text-ink">{s.stat}</span>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{s.unit}</span>
                </div>
                <div className="track"><i style={{ width: s.pct + '%', background: s.tone }} /></div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{s.sub}</div>
              </button>
            ))}
          </div>
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Connect a router, register its models, then route. Coverage confirms every advertised model resolves end-to-end — <b style={{ color: 'var(--ink)' }}>8 of 8</b> reachable now.</span></CardFoot>
        </Card>

        <Half className="mt-6">
          {/* cost trend */}
          <Card>
            <CardHead><span className="zs-eyebrow">Blended cost / call · 14d</span><Pill kind="success"><Icon name="check" size={13} tone="success" />−35%</Pill></CardHead>
            <div className="pt-5 px-5 pb-2">
              <div className="flex items-baseline gap-1 mb-3.5">
                <span className="font-display font-light text-3xl leading-[1]">$0.028</span>
                <span className="unit" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-sm)' }}>per call</span>
              </div>
              <Spark data={TREND} />
            </div>
            <CardFoot dashed className="font-mono">Trending down as more traffic lands on local + flash tiers.</CardFoot>
          </Card>

          {/* top models */}
          <Card>
            <CardHead><span className="zs-eyebrow">Most-used models</span><Button variant="ghost" size="sm" onClick={() => go('models')}>all models →</Button></CardHead>
            <div className="pt-2 px-5 pb-4">
              {TOP_MODELS.map((m) => (
                <div key={m.id} className="flex items-center gap-3 py-2.5 px-0 border-b">
                  <ProviderDot provider={m.provider} size={8} />
                  <span className="font-mono text-sm font-semibold text-ink w-[130px]">{m.id}</span>
                  <div className="meter" style={{ flex: 1 }}><i style={{ width: m.share + '%', background: 'var(--ink-mute)' }} /></div>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 56, textAlign: 'right' }}>{m.calls} · {m.share}%</span>
                </div>
              ))}
            </div>
          </Card>
        </Half>

        {/* quick actions */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Jump back in</h2></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { ic: 'playground', t: 'Chat with documents', s: '1,240 docs indexed · RAG', go: 'playground' },
              { ic: 'requests',   t: 'Inspect recent calls', s: 'live ledger · last 1h', go: 'requests' },
              { ic: 'keys',       t: 'Manage credentials',   s: '4 of 6 routers connected', go: 'keys' },
            ].map((a) => (
              <button key={a.t} className="card" onClick={() => go(a.go)} style={{ padding: '16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', transition: 'background var(--dur-fast) var(--ease)' }}>
                <span className="w-[38px] h-[38px] rounded grid place-items-center bg-paper-mute border shrink-0"><Icon name={a.ic} size={18} tone="soft" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink">{a.t}</span>
                  <span className="block font-mono text-xs text-ink-mute mt-0.5">{a.s}</span>
                </span>
                <Icon name="arrow" size={15} tone="faint" />
              </button>
            ))}
          </div>
        </div>
      </ViewPad>
    );
  }

  window.OverviewView = OverviewView;
})();
