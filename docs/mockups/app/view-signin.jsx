/* Torii · view-signin.jsx — auth gate. Role chosen here scopes
   everything that follows (RBAC). SSO-first, in the Zen-Sumi idiom.
   Layout: full-width intro header (brand · eyebrow · headline · summary),
   then two columns — routing diagram + value props | sign-in card. */
(function () {
  const { Card, Tag, Button } = window.StrategosUI;
  const { Icon, BrandIcon, Enso, MarkPaths } = window.StrategosIcons;
  const { PROVIDER_HUE } = window.StrategosAPI;
  const { useState } = React;

  const { IDENTITIES, PROVIDERS, VALUE } = window.StrategosAPI.content.signin;

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
      <svg className="sgn-graphic" viewBox="0 0 420 232" role="img" aria-label="Requests from many model providers route through one gateway to your apps." fill="none">
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

  function Brand({ size = 30, font = 26, name = 'Torii' }) {
    return (
      <div className="flex items-center gap-3">
        <Enso size={size} />
        <span className="font-display tracking-tight" style={{ fontSize: font}}>{name}</span>
      </div>
    );
  }

  function SignInView({ onSignIn, mode = 'member' }) {
    const isAdmin = mode === 'admin';
    const ids = IDENTITIES.filter((i) => i.persona === (isAdmin ? 'admin' : 'member'));
    const [sel, setSel] = useState(ids[0].persona);
    const id = ids.find((i) => i.persona === sel) || ids[0];
    const cross = isAdmin
      ? { href: 'Torii.html', label: 'Not an admin? Open Torii' }
      : { href: 'Seiki.html', label: 'Administrator? Open Seiki' };

    return (
      <div className="sgn-root">

        <div className="sgn-wrap rise">
          {/* ── header · spans both columns ───────────────────────── */}
          <header className="sgn-head">
            <div className="sgn-head-row">
              <span className="flex items-center gap-2">
                <Brand size={32} font={28} name={isAdmin ? 'Seiki' : 'Torii'} />
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>v1.0</span>
              </span>
              <div className="zs-eyebrow text-accent">{isAdmin ? 'Admin portal · define · manage · control · inspect' : 'AI gateway · routing & governance'}</div>
            </div>
          </header>

          <div className="sgn-body grid grid-cols-1 items-start gap-12 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-[clamp(48px,7vw,96px)]">
            {/* ── left · routing diagram + value props ─────────────── */}
            <section className="sgn-intro lt-lg:hidden">
              <p className="zs-body-sm mb-6 text-ink-soft max-w-[460px]">
                {isAdmin ? 'Seiki' : 'Torii'} routes every request across Anthropic, Google, OpenAI and your local models — then keeps spend, access and answer quality under one roof.
              </p>
              <Card className="pt-6 px-6 pb-4">
                <RoutingGraphic />
              </Card>

              <div className="sgn-value">
                {VALUE.map((v) => (
                  <div key={v.t} className="sgn-value-row">
                    <span className="sgn-value-ic"><Icon name={v.ic} size={18} tone="accent" /></span>
                    <span>
                      <span className="block text-sm font-semibold text-ink">{v.t}</span>
                      <span className="block text-sm text-ink-mute mt-1 leading-[1.45]">{v.s}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── right · sign in ──────────────────────────────────── */}
            <main className="sgn-main lg:justify-end">
              <div className="w-[400px] max-w-full">
            <Card className="p-8">
              <h1 className="zs-h2 text-center mb-6">{isAdmin ? 'Sign in to the admin portal' : 'Sign in to your workspace'}</h1>

              {/* OAuth — v1 sign-in */}
              <div className="flex flex-col gap-2">
                <Button className="w-full justify-center h-[40px]" variant="secondary" onClick={() => onSignIn(sel)}>
                  <BrandIcon name="google" size={17} /> Continue with Google
                </Button>
                <Button className="w-full justify-center h-[40px]" variant="secondary" onClick={() => onSignIn(sel)}>
                  <BrandIcon name="github" size={17} tone="ink" /> Continue with GitHub
                </Button>
              </div>

              <div className="flex items-center gap-3 my-4 mx-0">
                <span className="zs-rule flex-1" />
                <span className="zs-meta text-[10px]">OR</span>
                <span className="zs-rule flex-1" />
              </div>

              {/* magic link — passwordless email (v1 primary) */}
              <label className="zs-eyebrow block mb-1.5">Work email</label>
              <div className="zs-input mb-3">
                <Icon name="user" size={14} tone="mute" /><input value={id.email} readOnly />
              </div>
              <Button className="w-full justify-center" variant="secondary" onClick={() => onSignIn(sel)}><Icon name="bolt" size={14} tone="soft" /> Email me a magic link</Button>
              <p className="zs-body-sm text-center mt-2 text-xs text-ink-faint">Passwordless — we send a one-time sign-in link. No password to remember.</p>
              <Button className="w-full justify-center mt-2 opacity-60" variant="ghost" disabled title="Fast-follow — not yet enabled"><Icon name="sso" size={14} tone="mute" /> SAML SSO — fast-follow</Button>

              {/* identity / role picker */}
              <div className="zs-eyebrow mt-6 mx-0 mb-3">Demo · sign in as</div>
              <div className="flex flex-col gap-2">
                {ids.map((i) => {
                  const on = sel === i.persona;
                  return (
                    <button key={i.persona} onClick={() => setSel(i.persona)} className="flex items-center gap-3" style={{
                      padding: '10px 12px', borderRadius: 'var(--radius-lg)', textAlign: 'left',
                      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'),
                      background: on ? 'var(--accent-soft)' : 'var(--paper)',
                    }}>
                      <span className="ava w-[32px] h-[32px] border-transparent" style={{ background: on ? 'var(--accent)' : 'var(--paper-mute)', color: on ? 'var(--paper)' : 'var(--ink)'}}>{i.initial}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{i.name}</span>
                          <Tag>{i.role}</Tag>
                        </span>
                        <span className="block font-mono text-xs text-ink-mute mt-0.5">{i.scope}</span>
                      </span>
                      <span className="w-[16px] h-[16px] rounded-full grid place-items-center" style={{ border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)')}}>
                        {on && <span className="w-[8px] h-[8px] rounded-full bg-accent" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <p className="zs-body-sm text-center mt-4 text-ink-faint text-xs">
              <Icon className="inline-block mr-1" name="shield" size={12} tone="faint" style={{ verticalAlign: '-2px'}} />
              Email + OAuth · SAML SSO fast-follow · session pinned to your tenant region
            </p>
            <div className="text-center mt-4 pt-4 border-t">
              <a href={cross.href} className="zs-body-sm text-accent font-medium inline-flex items-center gap-1.5" style={{ textDecoration: 'none'}}>
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
