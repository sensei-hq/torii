/* Strategos Console · view-governance.jsx (admin)
   Ownership · security · confidentiality for the shared content system. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Tag, Switch } = window.StrategosUI;
  const { useState } = React;

  const LEVELS = [
    { k: 'public',       label: 'Public',       n: 412,  cls: 'clf-public',       policy: 'Anyone in the org. External share allowed.' },
    { k: 'internal',     label: 'Internal',     n: 1840, cls: 'clf-internal',     policy: 'Org members only. No external links.' },
    { k: 'confidential', label: 'Confidential', n: 286,  cls: 'clf-confidential', policy: 'Space members only. PII masked in answers.' },
    { k: 'restricted',   label: 'Restricted',   n: 47,   cls: 'clf-restricted',   policy: 'Named owners only. Never leaves region. Audited.' },
  ];
  const FILL = { public: 'var(--success)', internal: 'var(--ink-mute)', confidential: 'var(--warning)', restricted: 'var(--accent)' };
  const total = LEVELS.reduce((s, l) => s + l.n, 0);

  const OWNERS = [
    { space: 'Q1 Reporting',  owner: 'a.rao',     items: 318,  cls: 'confidential', review: '3d' },
    { space: 'Leasing Ops',   owner: 'm.okafor',  items: 1204, cls: 'internal',     review: '1w' },
    { space: 'Brand Kit',     owner: 's.kaur',    items: 96,   cls: 'public',       review: '2w' },
    { space: 'Finance Vault', owner: 'a.rao',     items: 47,   cls: 'restricted',   review: '1d' },
  ];

  const ROLES = [
    { role: 'Owner',  n: 3,  can: 'Full control · billing · governance' },
    { role: 'Admin',  n: 8,  can: 'Configure models, routing, connections' },
    { role: 'Editor', n: 54, can: 'Create & edit content · share in-space' },
    { role: 'Viewer', n: 77, can: 'Read & ask · no edits, no external share' },
  ];

  const AUDIT = [
    ['09:48', 'a.rao',   <span>exported <b>requests ledger</b> · Jan 1 – today → <code>csv</code></span>],
    ['09:41', 'a.rao',   <span>raised <b>Support</b> budget cap → <code>$9,000</code></span>],
    ['09:12', 'm.diaz',  <span>reclassified <b>Lease template</b> → <span className="clf clf-confidential"><span className="d" />Confidential</span></span>],
    ['08:30', 'sso',     <span><b>j.lee</b> signed in via Okta · SAML</span>],
    ['08:02', 'system',  <span>SIEM stream healthy · <b>1,204</b> events delivered overnight</span>],
    ['Yest.', 'system',  <span>retention job archived <b>142</b> stale items</span>],
  ];

  function ClfBadge({ cls }) {
    const map = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
    return <span className={'clf clf-' + cls}><span className="d" />{map[cls]}</span>;
  }

  function SecTile({ icon, label, value, sub }) {
    return (
      <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)', borderRight: '1px solid var(--paper-edge)' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <Icon name={icon} size={16} tone="soft" />
          <span className="zs-eyebrow">{label}</span>
        </div>
        <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)' }}>{value}</div>
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
      </div>
    );
  }

  function GovernanceView() {
    const [siem, setSiem] = useState(true);
    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Governance</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Ownership, security &amp; confidentiality</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 640 }}>Every document in the shared system has an owner, a classification, and an audit trail. Policies here apply across both the member workspace and the gateway.</p>
          </div>
          <Pill icon="check" kind="success">policies enforced</Pill>
        </div>

        {/* Confidentiality */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <div className="flex items-center gap-3">
              <span className="glyph accent" style={{ width: 32, height: 32 }}><Icon name="tag" size={16} tone="accent" /></span>
              <div><div className="zs-eyebrow" style={{ marginBottom: 2 }}>Confidentiality</div><div className="zs-h3">Classification scheme</div></div>
            </div>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>{total.toLocaleString()} items</span>
          </div>
          <div style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
              {LEVELS.map((l) => <div key={l.k} title={l.label} style={{ width: (l.n / total) * 100 + '%', background: FILL[l.k] }} />)}
            </div>
            <div className="grid grid-cols-4 gap-4">
              {LEVELS.map((l) => (
                <div key={l.k} style={{ padding: 'var(--space-4)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <ClfBadge cls={l.k} />
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-xl)', color: 'var(--ink)' }}>{l.n.toLocaleString()}</span>
                  </div>
                  <p className="zs-body-sm" style={{ fontSize: 12, lineHeight: 1.45 }}>{l.policy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ownership + Security */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 'var(--space-5)', marginTop: 'var(--space-5)', alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="role" size={15} tone="soft" /><span className="zs-eyebrow">Ownership</span></span><Tag>by space</Tag></div>
            <table className="tbl">
              <thead><tr><th>Space</th><th>Owner</th><th className="num">Items</th><th>Class</th><th className="num">Review</th></tr></thead>
              <tbody>
                {OWNERS.map((o) => (
                  <tr key={o.space}>
                    <td style={{ color: 'var(--ink)', fontWeight: 500 }}>{o.space}</td>
                    <td className="mono">{o.owner}</td>
                    <td className="num">{o.items.toLocaleString()}</td>
                    <td><ClfBadge cls={o.cls} /></td>
                    <td className="num" style={{ color: 'var(--ink-mute)' }}>{o.review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-foot dashed"><Icon name="flag" size={14} tone="warning" /><span><b style={{ color: 'var(--warning)' }}>12 items</b> have no owner — assign before next review.</span></div>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="governance" size={15} tone="soft" /><span className="zs-eyebrow">Security</span></span></div>
            <div className="flex" style={{ borderBottom: '1px solid var(--paper-edge)' }}>
              <SecTile icon="sso" label="Identity" value="SAML · Okta" sub="enforced · 142 seats" />
              <SecTile icon="globe" label="Region" value="eu-west-2" sub="London · in-region only" />
              <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name="history" size={16} tone="soft" /><span className="zs-eyebrow">Retention</span></div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)' }}>24 months</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-mute)', marginTop: 2 }}>md · json · csv · chat 90d</div>
              </div>
            </div>
            <div style={{ padding: '8px 0' }}>
              {ROLES.map((r) => (
                <div key={r.role} className="flex items-center gap-3" style={{ padding: '9px var(--space-5)' }}>
                  <span style={{ width: 80, fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.role}</span>
                  <span className="tag">{r.n}</span>
                  <span className="zs-body-sm" style={{ flex: 1, fontSize: 12 }}>{r.can}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Audit */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span className="zs-eyebrow">Audit trail</span></span>
            <span className="flex items-center gap-3">
              <Pill><span className="dot" style={{ background: siem ? 'var(--success)' : 'var(--ink-faint)' }} /> immutable {siem ? '· streamed to SIEM' : '· SIEM paused'}</Pill>
              <button className="zs-btn zs-btn-secondary" style={{ height: 28, fontSize: 12 }}><Icon name="upload" size={13} tone="soft" /> Export</button>
            </span>
          </div>
          <div style={{ padding: '8px var(--space-5) var(--space-4)' }}>
            {AUDIT.map((a, i) => (
              <div key={i} className="flex items-baseline gap-3" style={{ padding: '8px 0', borderBottom: i < AUDIT.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', width: 44 }}>{a[0]}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', width: 64 }}>{a[1]}</span>
                <span className="zs-body-sm" style={{ flex: 1 }}>{a[2]}</span>
              </div>
            ))}
          </div>
          <div className="card-foot dashed" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>retention · <b style={{ color: 'var(--ink)' }}>24 months</b></span>
            <span className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>scope · <b style={{ color: 'var(--ink)' }}>config · access · exports · sign-ins</b></span>
            <span className="flex items-center gap-2" style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>
              stream to SIEM
              <Switch on={siem} onClick={() => setSiem(!siem)} label="Stream audit events to SIEM" />
            </span>
          </div>
        </div>
      </div>
    );
  }

  window.GovernanceView = GovernanceView;
})();
