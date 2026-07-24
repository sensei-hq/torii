/* Strategos · enterprise.jsx — security, deployment modes, whitelabel, CTA. */
const { Icon: EIcon, Aperture: EAperture } = window.StrategosIcons;

const ENT_FEATURES = [
  { ic: 'lock', h: 'Data stays in-tenant', p: 'Documents, embeddings and warehouse queries never leave your accounts. Nothing is used to train anyone\u2019s model — ever.' },
  { ic: 'shield', h: 'Guardrails & policy', p: 'PII masking, jailbreak filters, grounded-only answers and per-route allow-lists, enforced before and after every call.' },
  { ic: 'user', h: 'SSO, SCIM & roles', p: 'SAML / OIDC sign-in, automated provisioning, and roles that map cleanly onto the budget hierarchy.' },
  { ic: 'history', h: 'Audit & compliance', p: 'Immutable, exportable logs of every prompt, model decision and tool call. SOC 2 Type II, GDPR-ready.' },
  { ic: 'globe', h: 'Data residency', p: 'Pin routing to a region — EU-only, US-only or on-box — so calls physically never cross a boundary you didn\u2019t allow.' },
  { ic: 'spark', h: 'Whitelabel', p: 'Your mark, your domain, your palette. Strategos is the engine in the margin; your brand owns the page.' },
];

function DeploymentModes() {
  const modes = [
    { tag: 'Single-tenant', h: 'Isolated', ic: 'lock', tone: 'moss',
      points: ['Dedicated instance & datastore', 'Private VPC or on-prem', 'Your keys, your egress only', 'For regulated & high-sensitivity orgs'] },
    { tag: 'Multi-tenant', h: 'Shared SaaS', ic: 'org', tone: 'sky',
      points: ['Pooled, logically-isolated tenants', 'Fastest to roll out org-wide', 'Per-tenant keys, budgets & policy', 'Same console, same controls'] },
  ];
  return (
    <div style={{ marginTop: 56 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span className="eyebrow">Deployment modes</span>
        <span style={{ font: '400 14px var(--font-body)', color: 'var(--ink-mute)' }}>Same UX, same controls — only the boundary changes.</span>
      </div>
      <div className="grid2">
        {modes.map((m) => (
          <div key={m.h} className="card hover" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', border: '1px solid var(--line)', background: m.tone === 'moss' ? 'var(--moss-soft)' : 'var(--sky-soft)', color: m.tone === 'moss' ? 'var(--moss)' : 'var(--sky)' }}>
                <EIcon name={m.ic} size={18} />
              </span>
              <div>
                <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{m.tag}</div>
                <div style={{ font: '600 19px var(--font-display)', letterSpacing: '-0.015em', color: 'var(--ink)' }}>{m.h}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {m.points.map((p) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 9, font: '400 13.5px var(--font-body)', color: 'var(--ink-mute)' }}>
                  <EIcon name="check" size={14} style={{ color: m.tone === 'moss' ? 'var(--moss)' : 'var(--sky)', flexShrink: 0 }} />{p}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, font: '500 12px/1.5 var(--font-body)', color: 'var(--ink-soft)' }}>
        <EIcon name="info" size={14} style={{ color: 'var(--sky)', flexShrink: 0 }} />
        Built to grow — the same governed canvas can become your org-wide knowledge surface, isolated or shared, without changing how people work.
      </div>
    </div>
  );
}

function EnterpriseSection() {
  return (
    <section className="section" id="enterprise" style={{ background: 'var(--paper-card)', borderTop: '1px solid var(--line)' }}>
      <div className="shell-max">
        <div className="section-hd">
          <span className="eyebrow"><span className="tick"></span>For the enterprise</span>
          <h2>Secure by default. Governed by design.</h2>
          <p className="lede">One purchase covers the whole org, yet behaves like every person has their own budget, keys and policy. Security isn’t a tier — it’s the foundation.</p>
        </div>
        <div className="feat-grid">
          {ENT_FEATURES.map((f) => (
            <div className="feat" key={f.h}>
              <span className="fi"><EIcon name={f.ic} size={18} /></span>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
        <DeploymentModes />
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="section tight">
      <div className="shell-max">
        <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--paper)', padding: '56px 48px', overflow: 'hidden' }}>
          <div className="canvas-grid" style={{ position: 'absolute', inset: 0, opacity: 0.12, mixBlendMode: 'overlay' }} aria-hidden="true"></div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 560 }}>
              <EAperture size={36} onDark={true} />
              <h2 style={{ font: '500 clamp(28px,3.6vw,40px)/1.02 var(--font-display)', letterSpacing: '-0.02em', margin: '18px 0 0', color: 'var(--paper)' }}>Put the gateway at the door.</h2>
              <p style={{ font: '400 17px/1.55 var(--font-body)', margin: '14px 0 0', color: 'color-mix(in oklab, var(--paper) 82%, transparent)', maxWidth: 480 }}>Bring your keys, set your budgets, and let every team explore the frontier — safely, on one license.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 200 }}>
              <a className="btn lg" href="#playground" style={{ background: 'var(--paper)', color: 'var(--ink)', borderColor: 'transparent' }}><span className="ico"><EIcon name="spark" size={16} /></span>Open the console</a>
              <a className="btn lg" href="#governance" style={{ background: 'transparent', color: 'var(--paper)', borderColor: 'color-mix(in oklab, var(--paper) 40%, transparent)', boxShadow: 'none' }}>Talk to sales</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.EnterpriseSection = EnterpriseSection;
window.ClosingCTA = ClosingCTA;
