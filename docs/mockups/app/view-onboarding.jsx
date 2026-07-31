/* Seiki · view-onboarding.jsx
   Tenant registration & onboarding — the setup checklist a new org works through,
   plus the registered tenant's identity details. Admin-only. */
(function () {
  const { Icon, BrandIcon } = window.StrategosIcons;
  const { ViewPad, Card, Split, CardHead, CardFoot, Button, Pill, PageHeader } = window.StrategosUI;
  const { BUDGET_TREE, money } = window.StrategosAPI;
  const { useState } = React;

  const { STEPS, FIELDS } = window.StrategosAPI.content.onboarding;

  // each step opens a concrete sub-flow inline
  const inp = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', width: '100%' };
  function Field({ label, children }) { return <label className="flex flex-col gap-1"><span className="zs-eyebrow m-0">{label}</span>{children}</label>; }
  function SubFlow({ k }) {
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' };
    if (k === 'org') return <div style={grid}><Field label="Legal name"><input style={inp} defaultValue="Northwind Estates Ltd" /></Field><Field label="Primary domain"><input style={inp} defaultValue="northwind.co" /></Field><Field label="Region"><select style={inp} defaultValue="eu-west-2">{['eu-west-2', 'eu-central-1', 'us-east-1'].map((r) => <option key={r}>{r}</option>)}</select></Field></div>;
    if (k === 'sso') return <div><div style={grid}><Button className="justify-center" variant="secondary"><BrandIcon name="google" size={15} /> Google OAuth · live</Button><Button className="justify-center" variant="secondary"><BrandIcon name="github" size={15} tone="ink" /> GitHub OAuth · live</Button><Button className="justify-center opacity-60" variant="ghost" disabled><Icon name="sso" size={14} tone="mute" /> SAML SSO · fast-follow</Button></div><div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: '12px' }}>142 seats · email + OAuth today · SAML SSO + SCIM directory sync are designed and land as a fast-follow.</div></div>;
    if (k === 'region') return <div style={grid}><Field label="Primary region"><select style={inp} defaultValue="eu-west-2 · London">{['eu-west-2 · London', 'eu-central-1 · Frankfurt', 'us-east-1 · Virginia'].map((r) => <option key={r}>{r}</option>)}</select></Field><Field label="Egress"><select style={inp} defaultValue="In-region only">{['In-region only', 'Allow failover region'].map((r) => <option key={r}>{r}</option>)}</select></Field></div>;
    if (k === 'router') return <div className="flex items-center gap-3 flex-wrap"><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>Anthropic · OpenAI · Bedrock · Vercel keyed · OpenRouter + Ollama pending</span><span className="flex-1" /><Button variant="primary" size="sm"><Icon name="keys" size={13} tone="paper" /> Go to Connections →</Button></div>;
    if (k === 'budgets') { const P = { day: 1 / 30, week: 7 / 30, mo: 1 }; const row = (n, depth) => (<React.Fragment key={n.name + depth}><div className="flex items-center gap-2 py-1.5 px-0" style={{ paddingLeft: depth * 18, borderTop: depth ? '1px solid var(--paper-edge)' : 'none' }}><Icon name={n.kind === 'org' ? 'org' : n.kind === 'user' ? 'user' : n.kind === 'team' ? 'team' : 'dept'} size={13} tone={depth === 0 ? 'accent' : 'mute'} /><span className="flex-1 min-w-0 text-sm text-ink" style={{ fontWeight: depth === 0 ? 600 : 500}}>{n.name}</span><span className="dtag">{(n.name === 'Support' ? 'soft' : 'hard')}</span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 96, textAlign: 'right' }}>{money(n.cap, 0)}/mo</span></div>{(n.children || []).map((c) => row(c, depth + 1))}</React.Fragment>); return <div>{row(BUDGET_TREE, 0)}<div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: '12px' }}>Same tree as Organization · caps cascade org → dept → team → user · hard blocks, soft warns · edit periods in Organization</div></div>; }
    if (k === 'invite') return <div className="flex items-center gap-3 flex-wrap"><Field label="Bulk invite by domain"><input style={{ ...inp, minWidth: 200 }} defaultValue="@northwind.co" /></Field><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', alignSelf: 'flex-end', paddingBottom: 8 }}>142 / 150 seats active</span><span className="flex-1" /><Button className="self-end" variant="primary" size="sm"><Icon name="team" size={13} tone="paper" /> Send invites</Button></div>;
    if (k === 'devices') return <div><div style={grid}>{[['macOS', 'apple'], ['Windows', 'windows'], ['Linux', 'linux']].map(([os]) => (<Button className="justify-center" variant="secondary" key={os}><Icon name="models" size={14} tone="soft" /> {os} installer</Button>))}</div><div className="flex items-center gap-2 mt-4"><span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>enrolment link · auto-configures gateway + region</span><span className="flex-1" /><Button variant="ghost" size="sm"><Icon name="models" size={13} tone="soft" /> View device fleet →</Button></div></div>;
    if (k === 'kb') return <div><div style={grid}><Field label="First space"><input style={inp} defaultValue="Leasing Ops" /></Field><Field label="Chunking default"><select style={inp} defaultValue="Structural">{['Structural', 'Semantic', 'Sentence-window'].map((r) => <option key={r}>{r}</option>)}</select></Field><Field label="Retrieval default"><select style={inp} defaultValue="Hybrid">{['Hybrid', 'Dense', 'Sparse'].map((r) => <option key={r}>{r}</option>)}</select></Field></div><div className="flex items-center gap-2 mt-4"><span className="flex-1" /><Button variant="primary" size="sm"><Icon name="library" size={13} tone="paper" /> Open Spaces & KB →</Button></div></div>;
    return null;
  }

  function OnboardingView() {
    const [steps, setSteps] = useState(STEPS);
    const [open, setOpen] = useState(null);
    const done = steps.filter((s) => s.done).length;
    const pct = Math.round((done / steps.length) * 100);
    const toggle = (k) => setSteps((arr) => arr.map((s) => (s.k === k ? { ...s, done: !s.done } : s)));

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Onboarding" title="Tenant registration" subMax={640}
          sub="Stand up a governed gateway for your organization. Each step provisions one part of the tenant — identity, residency, routing, budgets and people."
          actions={<Pill kind={pct === 100 ? 'success' : 'accent'} icon={pct === 100 ? 'check' : 'info'}>{done} of {steps.length} complete</Pill>} />

        {/* progress bar */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <span className="zs-eyebrow">Setup progress</span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--accent)' }}>{pct}%</span>
          </div>
          <div className="track" style={{ height: 8 }}><i style={{ width: pct + '%', background: 'var(--accent)' }} /></div>
        </Card>

        <Split>
          {/* checklist */}
          <Card className="overflow-hidden">
            <CardHead><span className="flex items-center gap-2"><Icon name="check" size={15} tone="soft" /><span className="zs-eyebrow">Setup checklist</span></span></CardHead>
            <div>
              {steps.map((st, i) => (
                <div key={st.k} style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <div className="flex items-center gap-4 py-4 px-6">
                    <span className={'glyph' + (st.done ? ' accent' : '') + ' w-[36px] h-[36px]'}><Icon name={st.ic} size={17} tone={st.done ? 'accent' : 'mute'} /></span>
                    <button onClick={() => setOpen((o) => (o === st.k ? null : st.k))} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="flex items-center gap-2"><span className="text-sm font-semibold text-ink">{st.t}</span><Icon name="caret" size={11} tone="mute" style={{ transform: open === st.k ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }} /></div>
                      <div className="zs-body-sm mt-px">{st.s}</div>
                    </button>
                    {st.done
                      ? <button onClick={() => toggle(st.k)} className="status" style={{ color: 'var(--success)' }}><Icon name="check" size={15} tone="success" /> done</button>
                      : <Button className="h-[30px] text-[12px] whitespace-nowrap" variant="secondary" onClick={() => setOpen(st.k)}>Set up <Icon name="arrow" size={13} tone="soft" /></Button>}
                  </div>
                  {open === st.k && (
                    <div className="rise pt-0 px-6 pb-6" style={{ marginLeft: 36 + 16 }}>
                      <div className="p-4 border rounded-lg bg-paper-soft">
                        <SubFlow k={st.k} />
                        {!st.done && <div className="flex items-center gap-2 mt-4 pt-4 border-t"><span className="flex-1" /><Button variant="ghost" size="sm" onClick={() => setOpen(null)}>Later</Button><Button variant="primary" size="sm" onClick={() => { toggle(st.k); setOpen(null); }}><Icon name="check" size={13} tone="paper" /> Mark done</Button></div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Steps can be revisited any time. The gateway is usable as soon as identity and a router are connected.</span></CardFoot>
          </Card>

          {/* registered tenant */}
          <Card className="overflow-hidden">
            <CardHead><span className="flex items-center gap-2"><Icon name="org" size={15} tone="soft" /><span className="zs-eyebrow">Registered tenant</span></span></CardHead>
            <div className="py-1 px-0">
              {FIELDS.map(([k, v], i) => (
                <div key={k} className="flex items-center justify-between gap-3 py-3 px-6" style={{ borderBottom: i < FIELDS.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                  <span className="zs-eyebrow normal-case text-ink-mute" style={{ letterSpacing: 0}}>{k}</span>
                  <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
            <CardFoot className="justify-between">
              <span className="flex items-center gap-2"><span className="dot" style={{ background: 'var(--success)' }} /> active</span>
              <Button variant="ghost" size="sm">Edit details</Button>
            </CardFoot>
          </Card>
        </Split>
      </ViewPad>
    );
  }

  window.OnboardingView = OnboardingView;
})();
