/* Seiki · view-alerts.jsx
   Alerts & notifications — delivery channels (email / Slack / webhook / SIEM)
   and the rules that fire into them (budget breach, outage, policy hit,
   anomaly). */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const { CHANNELS0, SEV, RULES0 } = window.StrategosAPI.content.alerts;

  function AlertsView() {
    const [chans, setChans] = useState(CHANNELS0);
    const [rules, setRules] = useState(RULES0);
    const flipChan = (id) => setChans((c) => c.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
    const flipRule = (id) => setRules((r) => r.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
    const chanOn = (id) => (chans.find((c) => c.id === id) || {}).on;

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Governance" title="Alerts & notifications" subMax={660}
          sub="Where the gateway sends alerts, and what triggers them. Rules route to one or more channels; critical rules can’t be silenced without an owner."
          actions={<Pill icon="check" kind="success">{rules.filter((r) => r.on).length} rules armed</Pill>} />

        <Card className="overflow-hidden mb-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="share" size={15} tone="soft" /><span className="zs-eyebrow">Delivery channels</span></span></CardHead>
          <div className="grid grid-cols-2">
            {chans.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i > 1 ? '1px solid var(--paper-edge)' : 'none', borderLeft: i % 2 ? '1px solid var(--paper-edge)' : 'none' }}>
                <span className="glyph w-[32px] h-[32px]"><Icon name={c.ic} size={15} tone={c.on ? 'accent' : 'mute'} /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">{c.name}</div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.target}</div>
                </div>
                <Switch on={c.on} onClick={() => flipChan(c.id)} label={'Enable ' + c.name} />
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHead><span className="flex items-center gap-2"><Icon name="bell" size={15} tone="soft" /><span className="zs-eyebrow">Rules</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{rules.length} rules</span></CardHead>
          {rules.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: r.on ? 1 : 0.6 }}>
              <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: SEV[r.sev][1]}} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{r.name}</span>
                  <span className="font-mono text-xs uppercase tracking-[0.06em]" style={{ color: SEV[r.sev][1]}}>{SEV[r.sev][0]}</span>
                </div>
                <div className="zs-body-sm text-[12px] mt-px">{r.desc} · <span className="mono" style={{ fontSize: 11 }}>{r.trigger}</span></div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {r.chans.map((cid) => (
                  <span className="inline-flex w-[24px] h-[24px] items-center justify-center rounded-sm bg-paper-mute border" key={cid} title={cid + (chanOn(cid) ? '' : ' · channel off')} style={{ opacity: chanOn(cid) ? 1 : 0.4 }}>
                    <Icon name={(CHANNELS0.find((c) => c.id === cid) || {}).ic} size={12} tone="mute" />
                  </span>
                ))}
              </div>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', width: 56, textAlign: 'right', flexShrink: 0 }}>{r.fired}</span>
              <Switch on={r.on} onClick={() => flipRule(r.id)} label={'Arm ' + r.name} />
            </div>
          ))}
          <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Small squares show which channels a rule routes to; dimmed means that channel is currently off. Policy-hit and outage rules also stream to the audit ledger.</span></CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.AlertsView = AlertsView;
})();
