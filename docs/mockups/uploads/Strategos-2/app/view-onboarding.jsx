/* Strategos Admin Portal · view-onboarding.jsx
   Tenant registration & onboarding — the setup checklist a new org works through,
   plus the registered tenant's identity details. Admin-only. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, PageHeader } = window.StrategosUI;
  const { useState } = React;

  const STEPS = [
    { k: 'org',     ic: 'org',        t: 'Organization identity', s: 'Legal name, primary domain, logo and region.', done: true },
    { k: 'sso',     ic: 'sso',        t: 'Single sign-on',        s: 'SAML connected to Okta · 142 seats provisioned.', done: true },
    { k: 'region',  ic: 'globe',      t: 'Data residency',        s: 'eu-west-2 · London. Calls and content never leave region.', done: true },
    { k: 'router',  ic: 'router',     t: 'Connect a router',      s: '4 of 6 routers keyed. Add OpenRouter to unlock 300+ models.', done: false },
    { k: 'budgets', ic: 'wallet',     t: 'Set budgets',           s: 'Org cap set. Department caps pending for Finance & Support.', done: false },
    { k: 'invite',  ic: 'team',       t: 'Invite members',        s: '142 of 150 seats active. Bulk invite by domain available.', done: false },
  ];

  const FIELDS = [
    ['Legal name', 'Northwind Estates Ltd'],
    ['Primary domain', 'northwind.co'],
    ['Tenant ID', 'tn_nw_8f21a'],
    ['Region', 'eu-west-2 · London'],
    ['Plan', 'Enterprise · annual'],
    ['Registered', '14 Jan 2026'],
  ];

  function OnboardingView() {
    const [steps, setSteps] = useState(STEPS);
    const done = steps.filter((s) => s.done).length;
    const pct = Math.round((done / steps.length) * 100);
    const toggle = (k) => setSteps((arr) => arr.map((s) => (s.k === k ? { ...s, done: !s.done } : s)));

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Onboarding" title="Tenant registration" subMax={640}
          sub="Stand up a governed gateway for your organization. Each step provisions one part of the tenant — identity, residency, routing, budgets and people."
          actions={<Pill kind={pct === 100 ? 'success' : 'accent'} icon={pct === 100 ? 'check' : 'info'}>{done} of {steps.length} complete</Pill>} />

        {/* progress bar */}
        <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <span className="zs-eyebrow">Setup progress</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--accent)' }}>{pct}%</span>
          </div>
          <div className="track" style={{ height: 8 }}><i style={{ width: pct + '%', background: 'var(--accent)' }} /></div>
        </div>

        <div className="grid-split">
          {/* checklist */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="check" size={15} tone="soft" /><span className="zs-eyebrow">Setup checklist</span></span></div>
            <div>
              {steps.map((st, i) => (
                <div key={st.k} className="flex items-center gap-4" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <span className={'glyph' + (st.done ? ' accent' : '')} style={{ width: 36, height: 36 }}><Icon name={st.ic} size={17} tone={st.done ? 'accent' : 'mute'} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{st.t}</div>
                    <div className="zs-body-sm" style={{ marginTop: 1 }}>{st.s}</div>
                  </div>
                  {st.done
                    ? <button onClick={() => toggle(st.k)} className="status" style={{ color: 'var(--success)' }}><Icon name="check" size={15} tone="success" /> done</button>
                    : <button onClick={() => toggle(st.k)} className="zs-btn zs-btn-secondary" style={{ height: 30, fontSize: 12, whiteSpace: 'nowrap' }}>Set up <Icon name="arrow" size={13} tone="soft" /></button>}
                </div>
              ))}
            </div>
            <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Steps can be revisited any time. The gateway is usable as soon as identity and a router are connected.</span></div>
          </div>

          {/* registered tenant */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="org" size={15} tone="soft" /><span className="zs-eyebrow">Registered tenant</span></span></div>
            <div style={{ padding: '4px 0' }}>
              {FIELDS.map(([k, v], i) => (
                <div key={k} className="flex items-center justify-between gap-3" style={{ padding: '11px var(--space-5)', borderBottom: i < FIELDS.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                  <span className="zs-eyebrow" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-mute)' }}>{k}</span>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="card-foot" style={{ justifyContent: 'space-between' }}>
              <span className="flex items-center gap-2"><span className="dot" style={{ background: 'var(--success)' }} /> active</span>
              <button className="zs-btn zs-btn-ghost zs-btn-sm">Edit details</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  window.OnboardingView = OnboardingView;
})();
