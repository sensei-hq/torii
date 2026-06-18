/* Strategos Console · view-signin.jsx — auth gate. Role chosen here scopes
   everything that follows (RBAC). SSO-first, in the Zen-Sumi idiom.
   Layout: full-width intro header (brand · eyebrow · headline · summary),
   then two columns — routing diagram + value props | sign-in card. */
(function () {
  const { Icon, Enso, MarkPaths } = window.StrategosIcons;
  const { PROVIDER_HUE } = window.StrategosData;
  const { useState } = React;

  const IDENTITIES = [
    { persona: 'admin',  initial: 'A', name: 'Aiko Tanaka',  email: 'aiko@northwind.co',  role: 'Administrator', scope: 'Full control · governance · billing' },
    { persona: 'member', initial: 'M', name: 'Mara Okafor',  email: 'mara@northwind.co',  role: 'Member',        scope: 'Leasing Ops · create, ask & share' },
  ];

  const PROVIDERS = [
    { key: 'anthropic', label: 'anthropic', y: 38 },
    { key: 'google',    label: 'google',    y: 92 },
    { key: 'openai',    label: 'openai',    y: 146 },
    { key: 'local',     label: 'local',     y: 200 },
  ];

  const VALUE = [
    { ic: 'routing', t: 'Route across every provider', s: 'One endpoint. Step-down routing and a free-tier floor pick the cheapest model that still answers well.' },
    { ic: 'wallet',  t: 'Spend with intent',           s: 'Org, team and user budgets with hard caps. Blended cost per call is down 35% this quarter.' },
    { ic: 'shield',  t: 'Govern with confidence',      s: 'SSO, role-based access and a full request ledger — every call traceable, every key accounted for.' },
  ];

  // routing diagram — providers on the left converge through the gateway enso
  // and out to the workspace. hairline strokes, vermillion reserved for the hub.
  function RoutingGraphic() {
    const paths = {
      38:  'M160 38 C 232 38, 244 116, 272 116',
      92:  'M160 92 C 222 92, 244 116, 272 116',
      146: 'M160 146 C 222 146, 244 116, 272 116',
      200: 'M160 200 C 232 200, 244 116, 272 116',
    };
    return (
      <svg className="sgn-graphic" viewBox="0 0 420 232" role="img" aria-label="Strategos routes requests from many model providers through one gateway to your apps." fill="none">
        {/* connectors — base hairline */}
        {PROVIDERS.map((p) => (
          <path key={'b' + p.y} d={paths[p.y]} stroke="var(--paper-edge)" strokeWidth="1.5" />
        ))}
        {/* connectors — animated accent flow toward the hub */}
        {PROVIDERS.map((p) => (
          <path key={'f' + p.y} className="sgn-flow" d={paths[p.y]} stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
        ))}
        {/* provider rows */}
        {PROVIDERS.map((p) => (
          <g key={p.key}>
            <circle cx="16" cy={p.y} r="5" fill={PROVIDER_HUE[p.key]} />
            <text x="30" y={p.y + 4} fontFamily="var(--font-mono)" fontSize="12.5" fill="var(--ink-soft)">{p.label}</text>
            <circle cx="160" cy={p.y} r="2.5" fill="var(--ink-faint)" />
          </g>
        ))}
        {/* gateway hub — the brand mark in its soft well */}
        <circle cx="300" cy="116" r="29" fill="var(--accent-soft)"></circle>
        <circle cx="300" cy="116" r="29" stroke="var(--paper-edge)" strokeWidth="1"></circle>
        <svg x="283" y="99" width="34" height="34" viewBox="0 0 24 24" fill="none">
          <path d={MarkPaths.top} fill="var(--ink)"></path>
          <path d={MarkPaths.band2} fill="var(--ink)" fillOpacity="0.8"></path>
          <path d={MarkPaths.band3} fill="var(--ink)" fillOpacity="0.6"></path>
          <path d={MarkPaths.tip} fill="var(--ink)" fillOpacity="0.2"></path>
          <circle cx="13" cy="15" r="1" fill="var(--ink)" fillOpacity="0.3"></circle>
          <path d={MarkPaths.nub} fill="var(--ink)"></path>
          <path d={MarkPaths.orb} fill="var(--ink)"></path>
          <path d={MarkPaths.coin} fill="var(--accent)"></path>
        </svg>
        <text x="300" y="166" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" letterSpacing="0.14em" fill="var(--ink-mute)">GATEWAY</text>
        {/* output to apps */}
        <path d="M331 116 H 398" stroke="var(--ink-faint)" strokeWidth="1.5" />
        <path d="M392 110 L 400 116 L 392 122" stroke="var(--ink-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <text x="382" y="103" textAnchor="end" fontFamily="var(--font-mono)" fontSize="11" fill="var(--ink-mute)">your apps</text>
      </svg>
    );
  }

  function Brand({ size = 30, font = 26 }) {
    return (
      <div className="flex items-center gap-3">
        <Enso size={size} />
        <span style={{ fontFamily: 'var(--font-display)', fontSize: font, letterSpacing: '-0.02em' }}>Strategos</span>
      </div>
    );
  }

  function SignInView({ onSignIn, mode = 'member' }) {
    const isAdmin = mode === 'admin';
    const ids = IDENTITIES.filter((i) => i.persona === (isAdmin ? 'admin' : 'member'));
    const [sel, setSel] = useState(ids[0].persona);
    const id = ids.find((i) => i.persona === sel) || ids[0];
    const cross = isAdmin
      ? { href: 'Strategos%20Console.html', label: 'Not an admin? Open the workspace' }
      : { href: 'Strategos%20Admin.html', label: 'Administrator? Open the admin portal' };

    return (
      <div className="sgn-root">
        <style>{`
          .sgn-root { position: fixed; inset: 0; background: var(--paper); overflow: auto; }
          .sgn-wrap { max-width: 1100px; margin: 0 auto; padding: var(--space-7) clamp(20px, 5vw, 48px) var(--space-7); }
          .sgn-head { padding-bottom: var(--space-6); border-bottom: 1px solid var(--paper-edge); }
          .sgn-head-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
          .sgn-body { display: grid; grid-template-columns: 1fr; gap: var(--space-7); padding-top: var(--space-7); align-items: start; }
          .sgn-intro { min-width: 0; }
          .sgn-main { display: flex; justify-content: center; min-width: 0; }
          .sgn-graphic { width: 100%; height: auto; display: block; }
          .sgn-value { display: flex; flex-direction: column; gap: var(--space-4); margin-top: var(--space-6); }
          .sgn-value-row { display: grid; grid-template-columns: 36px 1fr; gap: var(--space-3); align-items: start; }
          .sgn-value-ic { width: 36px; height: 36px; border-radius: var(--radius); display: grid; place-items: center; background: var(--paper-soft); border: 1px solid var(--paper-edge); }
          .sgn-flow { stroke-dasharray: 5 90; stroke-dashoffset: 0; }
          @media (prefers-reduced-motion: no-preference) {
            .sgn-flow { animation: sgn-flow 2.6s linear infinite; }
          }
          @keyframes sgn-flow { to { stroke-dashoffset: -95; } }
          @media (max-width: 899px) {
            .sgn-intro { display: none; }
          }
          @media (min-width: 900px) {
            .sgn-body { grid-template-columns: 1.05fr 0.95fr; gap: clamp(48px, 7vw, 96px); }
            .sgn-main { justify-content: flex-end; }
          }
        `}</style>

        <div className="sgn-wrap rise">
          {/* ── header · spans both columns ───────────────────────── */}
          <header className="sgn-head">
            <div className="sgn-head-row">
              <Brand size={32} font={28} />
              <div className="zs-eyebrow" style={{ color: 'var(--accent)' }}>{isAdmin ? 'Admin portal · tenant & gateway control' : 'AI gateway · routing & governance'}</div>
            </div>
            <h1 className="zs-h1" style={{ marginTop: 'var(--space-6)', lineHeight: 1.1 }}>{isAdmin ? 'Operate the gateway.' : 'One endpoint for every model.'}</h1>
          </header>

          <div className="sgn-body">
            {/* ── left · routing diagram + value props ─────────────── */}
            <section className="sgn-intro">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-5)', color: 'var(--ink-soft)', maxWidth: 460 }}>
                Strategos routes every request across Anthropic, Google, OpenAI and your local models — then keeps spend, access and answer quality under one roof.
              </p>
              <div className="card" style={{ padding: 'var(--space-5) var(--space-5) var(--space-4)' }}>
                <RoutingGraphic />
              </div>

              <div className="sgn-value">
                {VALUE.map((v) => (
                  <div key={v.t} className="sgn-value-row">
                    <span className="sgn-value-ic"><Icon name={v.ic} size={18} tone="accent" /></span>
                    <span>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{v.t}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 3, lineHeight: 1.45 }}>{v.s}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── right · sign in ──────────────────────────────────── */}
            <main className="sgn-main">
              <div style={{ width: 400, maxWidth: '100%' }}>
            <div className="card" style={{ padding: 'var(--space-6)' }}>
              <h1 className="zs-h2" style={{ textAlign: 'center' }}>{isAdmin ? 'Sign in to the admin portal' : 'Sign in to your workspace'}</h1>
              <p className="zs-body-sm" style={{ textAlign: 'center', marginTop: 6, marginBottom: 'var(--space-5)' }}>Northwind Estates · {isAdmin ? 'tenant administration' : 'gateway'}</p>

              {/* SSO */}
              <button className="zs-btn zs-btn-primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} onClick={() => onSignIn(sel)}>
                <Icon name="sso" size={16} tone="paper" /> Continue with Okta
              </button>

              <div className="flex items-center gap-3" style={{ margin: 'var(--space-4) 0' }}>
                <span className="zs-rule" style={{ flex: 1 }} />
                <span className="zs-meta" style={{ fontSize: 10 }}>OR</span>
                <span className="zs-rule" style={{ flex: 1 }} />
              </div>

              {/* credentials (visual) */}
              <label className="zs-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Work email</label>
              <div className="zs-input" style={{ marginBottom: 'var(--space-3)' }}>
                <Icon name="user" size={14} tone="mute" /><input value={id.email} readOnly />
              </div>
              <label className="zs-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Password</label>
              <div className="zs-input" style={{ marginBottom: 'var(--space-4)' }}>
                <Icon name="lock" size={14} tone="mute" /><input type="password" value="************" readOnly />
              </div>
              <button className="zs-btn zs-btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onSignIn(sel)}>Sign in</button>

              {/* identity / role picker */}
              <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Demo · sign in as</div>
              <div className="flex flex-col gap-2">
                {ids.map((i) => {
                  const on = sel === i.persona;
                  return (
                    <button key={i.persona} onClick={() => setSel(i.persona)} className="flex items-center gap-3" style={{
                      padding: '10px 12px', borderRadius: 'var(--radius-lg)', textAlign: 'left',
                      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'),
                      background: on ? 'var(--accent-soft)' : 'var(--paper)',
                    }}>
                      <span className="ava" style={{ width: 32, height: 32, background: on ? 'var(--accent)' : 'var(--paper-mute)', color: on ? 'var(--paper)' : 'var(--ink)', borderColor: 'transparent' }}>{i.initial}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="flex items-center gap-2">
                          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{i.name}</span>
                          <span className="tag">{i.role}</span>
                        </span>
                        <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>{i.scope}</span>
                      </span>
                      <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), display: 'grid', placeItems: 'center' }}>
                        {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="zs-body-sm" style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--ink-faint)', fontSize: 11.5 }}>
              <Icon name="shield" size={12} tone="faint" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
              SAML · SSO enforced · session pinned to eu-west-2
            </p>
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--paper-edge)' }}>
              <a href={cross.href} className="zs-body-sm" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {cross.label} <Icon name="arrow" size={13} tone="accent" />
              </a>
            </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    );
  }

  window.SignInView = SignInView;
})();
