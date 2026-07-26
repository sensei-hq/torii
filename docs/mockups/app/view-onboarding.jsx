/* Seiki · view-onboarding.jsx
   Tenant registration & onboarding — the setup checklist a new org works through,
   plus the registered tenant's identity details. Admin-only. */
(function () {
  const { Icon, BrandIcon } = window.StrategosIcons;
  const { Pill, PageHeader } = window.StrategosUI;
  const { BUDGET_TREE, money } = window.StrategosData;
  const { useState } = React;

  const STEPS = [
    { k: 'org',     ic: 'org',        t: 'Organization identity', s: 'Legal name, primary domain, logo and region.', done: true },
    { k: 'sso',     ic: 'sso',        t: 'Single sign-on',        s: 'Email + Google/GitHub OAuth live · SAML SSO + SCIM fast-follow.', done: true },
    { k: 'region',  ic: 'globe',      t: 'Data residency',        s: 'Set the tenant\u2019s processing region. Calls and content never leave it.', done: true },
    { k: 'router',  ic: 'router',     t: 'Connect a router',      s: '4 of 6 routers keyed. Add OpenRouter to unlock 300+ models.', done: false },
    { k: 'budgets', ic: 'wallet',     t: 'Set budgets',           s: 'Org cap set. Department caps pending for Finance & Support.', done: false },
    { k: 'invite',  ic: 'team',       t: 'Invite members',        s: '142 of 150 seats active. Bulk invite by domain available.', done: false },
    { k: 'devices', ic: 'models',     t: 'Roll out Torii', s: 'Distribute Torii installers and enrol devices for on-device models.', done: false },
    { k: 'kb',      ic: 'library',    t: 'Set up spaces & knowledge base', s: 'Create spaces, set ingestion & retrieval defaults, import docs.', done: false },
  ];

  // each step opens a concrete sub-flow inline
  const inp = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', width: '100%' };
  function Field({ label, children }) { return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="zs-eyebrow" style={{ margin: 0 }}>{label}</span>{children}</label>; }
  function SubFlow({ k }) {
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)' };
    if (k === 'org') return <div style={grid}><Field label="Legal name"><input style={inp} defaultValue="Northwind Estates Ltd" /></Field><Field label="Primary domain"><input style={inp} defaultValue="northwind.co" /></Field><Field label="Region"><select style={inp} defaultValue="eu-west-2">{['eu-west-2', 'eu-central-1', 'us-east-1'].map((r) => <option key={r}>{r}</option>)}</select></Field></div>;
    if (k === 'sso') return <div><div style={grid}><button className="zs-btn zs-btn-secondary" style={{ justifyContent: 'center' }}><BrandIcon name="google" size={15} /> Google OAuth · live</button><button className="zs-btn zs-btn-secondary" style={{ justifyContent: 'center' }}><BrandIcon name="github" size={15} tone="ink" /> GitHub OAuth · live</button><button className="zs-btn zs-btn-ghost" disabled style={{ justifyContent: 'center', opacity: 0.6 }}><Icon name="sso" size={14} tone="mute" /> SAML SSO · fast-follow</button></div><div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 'var(--space-3)' }}>142 seats · email + OAuth today · SAML SSO + SCIM directory sync are designed and land as a fast-follow.</div></div>;
    if (k === 'region') return <div style={grid}><Field label="Primary region"><select style={inp} defaultValue="eu-west-2 · London">{['eu-west-2 · London', 'eu-central-1 · Frankfurt', 'us-east-1 · Virginia'].map((r) => <option key={r}>{r}</option>)}</select></Field><Field label="Egress"><select style={inp} defaultValue="In-region only">{['In-region only', 'Allow failover region'].map((r) => <option key={r}>{r}</option>)}</select></Field></div>;
    if (k === 'router') return <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>Anthropic · OpenAI · Bedrock · Vercel keyed · OpenRouter + Ollama pending</span><span className="grow" /><button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="keys" size={13} tone="paper" /> Go to Connections →</button></div>;
    if (k === 'budgets') { const P = { day: 1 / 30, week: 7 / 30, mo: 1 }; const row = (n, depth) => (<React.Fragment key={n.name + depth}><div className="flex items-center gap-2" style={{ padding: '6px 0', paddingLeft: depth * 18, borderTop: depth ? '1px solid var(--paper-edge)' : 'none' }}><Icon name={n.kind === 'org' ? 'org' : n.kind === 'user' ? 'user' : n.kind === 'team' ? 'team' : 'dept'} size={13} tone={depth === 0 ? 'accent' : 'mute'} /><span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', fontWeight: depth === 0 ? 600 : 500, color: 'var(--ink)' }}>{n.name}</span><span className="dtag">{(n.name === 'Support' ? 'soft' : 'hard')}</span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 96, textAlign: 'right' }}>{money(n.cap, 0)}/mo</span></div>{(n.children || []).map((c) => row(c, depth + 1))}</React.Fragment>); return <div>{row(BUDGET_TREE, 0)}<div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-3)' }}>Same tree as Organization · caps cascade org → dept → team → user · hard blocks, soft warns · edit periods in Organization</div></div>; }
    if (k === 'invite') return <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}><Field label="Bulk invite by domain"><input style={{ ...inp, minWidth: 200 }} defaultValue="@northwind.co" /></Field><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', alignSelf: 'flex-end', paddingBottom: 8 }}>142 / 150 seats active</span><span className="grow" /><button className="zs-btn zs-btn-primary zs-btn-sm" style={{ alignSelf: 'flex-end' }}><Icon name="team" size={13} tone="paper" /> Send invites</button></div>;
    if (k === 'devices') return <div><div style={grid}>{[['macOS', 'apple'], ['Windows', 'windows'], ['Linux', 'linux']].map(([os]) => (<button key={os} className="zs-btn zs-btn-secondary" style={{ justifyContent: 'center' }}><Icon name="models" size={14} tone="soft" /> {os} installer</button>))}</div><div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)' }}><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>enrolment link · auto-configures gateway + region</span><span className="grow" /><button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="models" size={13} tone="soft" /> View device fleet →</button></div></div>;
    if (k === 'kb') return <div><div style={grid}><Field label="First space"><input style={inp} defaultValue="Leasing Ops" /></Field><Field label="Chunking default"><select style={inp} defaultValue="Structural">{['Structural', 'Semantic', 'Sentence-window'].map((r) => <option key={r}>{r}</option>)}</select></Field><Field label="Retrieval default"><select style={inp} defaultValue="Hybrid">{['Hybrid', 'Dense', 'Sparse'].map((r) => <option key={r}>{r}</option>)}</select></Field></div><div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)' }}><span className="grow" /><button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="library" size={13} tone="paper" /> Open Spaces & KB →</button></div></div>;
    return null;
  }

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
    const [open, setOpen] = useState(null);
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
                <div key={st.k} style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <div className="flex items-center gap-4" style={{ padding: 'var(--space-4) var(--space-5)' }}>
                    <span className={'glyph' + (st.done ? ' accent' : '')} style={{ width: 36, height: 36 }}><Icon name={st.ic} size={17} tone={st.done ? 'accent' : 'mute'} /></span>
                    <button onClick={() => setOpen((o) => (o === st.k ? null : st.k))} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="flex items-center gap-2"><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{st.t}</span><Icon name="caret" size={11} tone="mute" style={{ transform: open === st.k ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }} /></div>
                      <div className="zs-body-sm" style={{ marginTop: 1 }}>{st.s}</div>
                    </button>
                    {st.done
                      ? <button onClick={() => toggle(st.k)} className="status" style={{ color: 'var(--success)' }}><Icon name="check" size={15} tone="success" /> done</button>
                      : <button onClick={() => setOpen(st.k)} className="zs-btn zs-btn-secondary" style={{ height: 30, fontSize: 12, whiteSpace: 'nowrap' }}>Set up <Icon name="arrow" size={13} tone="soft" /></button>}
                  </div>
                  {open === st.k && (
                    <div className="rise" style={{ padding: '0 var(--space-5) var(--space-5)', marginLeft: 36 + 16 }}>
                      <div style={{ padding: 'var(--space-4)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', background: 'var(--paper-soft)' }}>
                        <SubFlow k={st.k} />
                        {!st.done && <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--paper-edge)' }}><span className="grow" /><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setOpen(null)}>Later</button><button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => { toggle(st.k); setOpen(null); }}><Icon name="check" size={13} tone="paper" /> Mark done</button></div>}
                      </div>
                    </div>
                  )}
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
