/* Seiki · view-alerts.jsx
   Alerts & notifications — delivery channels (email / Slack / webhook / SIEM)
   and the rules that fire into them (budget breach, outage, policy hit,
   anomaly). */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const CHANNELS0 = [
    { id: 'email',   name: 'Email',   ic: 'bell',   target: 'owners@northwind.co', on: true },
    { id: 'slack',   name: 'Slack',   ic: 'share',  target: '#strategos-alerts', on: true },
    { id: 'webhook', name: 'Webhook', ic: 'globe',  target: 'https://hooks.northwind/gw', on: false },
    { id: 'siem',    name: 'SIEM',    ic: 'upload', target: 'splunk · hec', on: true },
  ];
  const SEV = { critical: ['critical', 'var(--accent)'], warning: ['warning', 'var(--warning)'], info: ['info', 'var(--ink-mute)'] };
  const RULES0 = [
    { id: 'budget',  name: 'Budget breach',   desc: 'A node crosses its cap threshold', trigger: 'soft cap \u2192 warn \u00b7 hard cap \u2192 block', sev: 'critical', chans: ['email', 'slack'], on: true,  fired: '2d ago' },
    { id: 'outage',  name: 'Provider outage', desc: 'A router returns sustained 5xx / timeouts', trigger: '3 failures in 60s', sev: 'critical', chans: ['email', 'slack', 'webhook'], on: true, fired: '3w ago' },
    { id: 'policy',  name: 'Policy hit',      desc: 'A guardrail blocks a call', trigger: 'any block', sev: 'warning', chans: ['slack', 'siem'], on: true, fired: '8m ago' },
    { id: 'anomaly', name: 'Usage anomaly',   desc: 'Spend or volume spikes off baseline', trigger: '3σ over 7-day mean', sev: 'warning', chans: ['email'], on: true, fired: '5d ago' },
    { id: 'device',  name: 'Device offline',  desc: 'An enrolled device stops syncing', trigger: 'no heartbeat 24h', sev: 'info', chans: ['slack'], on: false, fired: '—' },
    { id: 'ingest',  name: 'Ingestion failed', desc: 'A document fails to parse or embed', trigger: 'any failure', sev: 'info', chans: ['slack'], on: true, fired: '1h ago' },
  ];

  function AlertsView() {
    const [chans, setChans] = useState(CHANNELS0);
    const [rules, setRules] = useState(RULES0);
    const flipChan = (id) => setChans((c) => c.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
    const flipRule = (id) => setRules((r) => r.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
    const chanOn = (id) => (chans.find((c) => c.id === id) || {}).on;

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Governance" title="Alerts & notifications" subMax={660}
          sub="Where the gateway sends alerts, and what triggers them. Rules route to one or more channels; critical rules can’t be silenced without an owner."
          actions={<Pill icon="check" kind="success">{rules.filter((r) => r.on).length} rules armed</Pill>} />

        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="share" size={15} tone="soft" /><span className="zs-eyebrow">Delivery channels</span></span></div>
          <div className="grid grid-cols-2">
            {chans.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i > 1 ? '1px solid var(--paper-edge)' : 'none', borderLeft: i % 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <span className="glyph" style={{ width: 32, height: 32 }}><Icon name={c.ic} size={15} tone={c.on ? 'accent' : 'mute'} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.target}</div>
                </div>
                <Switch on={c.on} onClick={() => flipChan(c.id)} label={'Enable ' + c.name} />
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="bell" size={15} tone="soft" /><span className="zs-eyebrow">Rules</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{rules.length} rules</span></div>
          {rules.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: r.on ? 1 : 0.6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEV[r.sev][1], flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: SEV[r.sev][1], textTransform: 'uppercase', letterSpacing: '0.06em' }}>{SEV[r.sev][0]}</span>
                </div>
                <div className="zs-body-sm" style={{ fontSize: 12, marginTop: 1 }}>{r.desc} · <span className="mono" style={{ fontSize: 11 }}>{r.trigger}</span></div>
              </div>
              <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                {r.chans.map((cid) => (
                  <span key={cid} title={cid + (chanOn(cid) ? '' : ' · channel off')} style={{ display: 'inline-flex', width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', opacity: chanOn(cid) ? 1 : 0.4 }}>
                    <Icon name={(CHANNELS0.find((c) => c.id === cid) || {}).ic} size={12} tone="mute" />
                  </span>
                ))}
              </div>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', width: 56, textAlign: 'right', flexShrink: 0 }}>{r.fired}</span>
              <Switch on={r.on} onClick={() => flipRule(r.id)} label={'Arm ' + r.name} />
            </div>
          ))}
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Small squares show which channels a rule routes to; dimmed means that channel is currently off. Policy-hit and outage rules also stream to the audit ledger.</span></div>
        </div>
      </div>
    );
  }

  window.AlertsView = AlertsView;
})();
