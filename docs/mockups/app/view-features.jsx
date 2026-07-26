/* Seiki · view-features.jsx
   Feature management — the control-ownership model (UiFeature × UiFeatureState).
   Admins decide which controls a member sees and whether a member may override
   them. Every control resolves to one of four states:
     locked · default-on · default-off · user-overridable
   and carries a recommended owner + the surfaces it lives on. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  /* four-state model — order is fixed for the segmented control */
  const STATES = ['locked', 'on', 'off', 'user'];
  const STATE = {
    locked: { label: 'Locked',       tone: 'var(--accent)',   ic: 'lock',  member: "Shown locked — members can't change it" },
    on:     { label: 'Default on',   tone: 'var(--success)',  ic: 'check', member: 'On for everyone — members may turn it off' },
    off:    { label: 'Default off',  tone: 'var(--ink-mute)', ic: 'close', member: 'Off for everyone — members may turn it on' },
    user:   { label: 'User choice',  tone: 'var(--ink)',      ic: 'user',  member: 'Member decides — no default pushed' },
  };

  /* owner tokens — who the control belongs to */
  const OWN = {
    admin: ['admin', 'var(--ink)'],
    space: ['space', 'var(--accent)'],
    user:  ['user', 'var(--success)'],
    floor: ['admin floor', 'var(--warning)'],
  };

  // precedence: each layer may only tighten the one above (higher rank = stricter)
  const RANK = { locked: 3, off: 2, on: 1, user: 0 };
  const SCOPES = [
    { id: 'workspace', label: 'Workspace default', kind: 'workspace' },
    { id: 'space:leasing', label: 'Leasing Ops', kind: 'space' },
    { id: 'space:finance', label: 'Finance', kind: 'space' },
    { id: 'role:editor', label: 'Editor', kind: 'role' },
    { id: 'role:viewer', label: 'Viewer', kind: 'role' },
  ];
  const LAYERS = [['workspace', 'Workspace default', 'var(--ink-mute)'], ['space', 'Space override', 'var(--accent)'], ['role', 'Role', 'var(--warning)'], ['user', 'User preference', 'var(--success)']];

  /* the ownership matrix. state = current UiFeatureState; allowed = states an
     admin may pick for this control (a safety control can't become user-owned). */
  const SECTIONS = [
    { label: 'Safety & compliance', icon: 'shield', hint: 'Guardrails. These protect the tenant, so most cannot be handed to members.', rows: [
      { k: 'masking',   ic: 'shield',  t: 'PII & tenant masking',   d: 'Scan input and output on every call and mask tenant names + PII before egress.', owner: ['admin', 'space'], where: ['Admin Settings', 'Space settings'], allowed: ['locked', 'on'], state: 'locked', note: 'Never user-disengageable.' },
      { k: 'fallback',  ic: 'routing', t: 'Automatic fallback',     d: 'Step down to a cheaper tier on budget or provider error without asking.',           owner: ['admin'],          where: ['Admin Settings', 'Routing'],          allowed: ['locked', 'on'], state: 'locked', note: 'Members cannot disable.' },
      { k: 'alerts',    ic: 'bell',    t: 'Anomaly alerts',         d: 'Notify owners on budget breach, outage, or policy hit.',                             owner: ['admin'],          where: ['Admin Settings'],                     allowed: ['on', 'off'],    state: 'on' },
      { k: 'telemetry', ic: 'history', t: 'Anonymous telemetry',    d: 'Share aggregate routing metrics to improve default routing.',                        owner: ['admin'],          where: ['Admin Settings'],                     allowed: ['on', 'off'],    state: 'off' },
      { k: 'siem',      ic: 'upload',  t: 'SIEM streaming',         d: 'Stream the immutable audit trail to the org SIEM.',                                  owner: ['admin'],          where: ['Governance'],                         allowed: ['on', 'off'],    state: 'on', note: 'Owner only.' },
    ]},
    { label: 'Retrieval & answers', icon: 'rag', hint: 'How answers are grounded. Admins set the floor; members may experiment above it.', rows: [
      { k: 'grounded',  ic: 'shield',  t: 'Grounded-only answers',  d: 'Answers must cite in-tenant sources — no general-knowledge fallback.',               owner: ['admin', 'space'], where: ['Admin Settings', 'Playground · read-only'], allowed: ['locked', 'on', 'off'], state: 'on', note: 'Members see the state but cannot loosen below policy.' },
      { k: 'retrieval', ic: 'filter',  t: 'Reranking · retrieval mode · chunking', d: 'The retrieval pipeline: reranker, retrieval strategy, chunk size.',       owner: ['admin', 'space'], where: ['Space settings', 'Playground · experiment'], allowed: ['on', 'off', 'user'], state: 'off', note: 'Members may experiment session-only; space defaults are fixed.' },
      { k: 'citations', ic: 'citation', t: 'Citations',             d: 'Show sources beneath every answer.',                                                 owner: ['user', 'floor'],  where: ['Member Settings', 'Playground'],      allowed: ['on', 'user'],   state: 'user', note: 'User preference, within the admin floor.' },
    ]},
    { label: 'Personal preferences', icon: 'user', hint: 'Members own these outright. Surface them, but leave the choice to the member.', rows: [
      { k: 'retention', ic: 'history', t: 'Context retention',      d: 'Carry prior turns into the next question.',                                          owner: ['user'],           where: ['Member Settings', 'Playground'],      allowed: ['user'],         state: 'user' },
      { k: 'autotune',  ic: 'spark',   t: 'Auto-tune prompt',       d: 'Rewrite the prompt for the chosen model before sending.',                            owner: ['user'],           where: ['Playground'],                         allowed: ['user', 'off'],  state: 'user' },
      { k: 'personal',  ic: 'settings', t: 'Weekly digest · theme · autosave drafts', d: 'Cosmetic and notification preferences.',                          owner: ['user'],           where: ['Member Settings'],                    allowed: ['user'],         state: 'user' },
    ]},
    { label: 'Access & budget', icon: 'wallet', hint: 'What a member may reach and spend. Admin-owned, cascading down the org tree.', rows: [
      { k: 'models',    ic: 'models',  t: 'Allowed models & tiers', d: 'Which models and price tiers a role or space may call.',                             owner: ['admin', 'space'], where: ['Models', 'Spaces'],                   allowed: ['locked', 'on'], state: 'locked', note: 'New — per role/space model-access policy.' },
      { k: 'budget',    ic: 'wallet',  t: 'Budget caps · period · hard/soft', d: 'Spend ceilings and their reset period.',                                    owner: ['admin'],          where: ['Organization', 'Billing'],            allowed: ['locked'],       state: 'locked', note: 'Cascades org → dept → team → user.' },
      { k: 'localdl',   ic: 'models',  t: 'Local-model download & enable',  d: 'Pull and enable a model to run on the member’s own device.',                   owner: ['user', 'floor'],  where: ['Local models · desktop'],             allowed: ['user', 'locked'], state: 'user', note: 'User on device, within the admin allow-list.' },
      { k: 'routerloc', ic: 'keys',    t: 'Router keys · device-local vs proxied', d: 'Whether a router’s keys may run on-device or must proxy the gateway.', owner: ['admin'],          where: ['Connections'],                        allowed: ['locked', 'on'], state: 'locked' },
    ]},
  ];

  const ALL = SECTIONS.flatMap((s) => s.rows);
  const KEY = 'zs-feature-mgmt';

  function OwnerChip({ token }) {
    const [label, color] = OWN[token];
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', padding: '1px 7px', borderRadius: 'var(--radius-full)',
        background: 'var(--paper-mute)', color, border: '1px solid var(--paper-edge)', whiteSpace: 'nowrap' }}>{label}</span>
    );
  }

  /* the four-state segmented control — only the allowed states render */
  function StateSeg({ value, allowed, onChange }) {
    return (
      <div style={{ display: 'inline-flex', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--paper)' }}>
        {STATES.filter((s) => allowed.includes(s)).map((s, i) => {
          const on = value === s;
          return (
            <button key={s} onClick={() => onChange(s)} title={STATE[s].member}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', fontWeight: 500,
                borderLeft: i ? '1px solid var(--paper-edge)' : 'none',
                background: on ? STATE[s].tone : 'transparent',
                color: on ? 'var(--on-primary)' : 'var(--ink-soft)',
                transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)', whiteSpace: 'nowrap' }}>
              <Icon name={STATE[s].ic} size={12} tone={on ? 'paper' : 'mute'} />{STATE[s].label}
            </button>
          );
        })}
      </div>
    );
  }

  function FeatureManagementView() {
    const [st, setSt] = useState(() => {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
      return Object.fromEntries(ALL.map((r) => [r.k, saved[r.k] || r.state]));
    });
    const set = (k, v) => setSt((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) {} return n; });
    const reset = () => { try { localStorage.removeItem(KEY); } catch (e) {} setSt(Object.fromEntries(ALL.map((r) => [r.k, r.state]))); };
    const count = (s) => ALL.filter((r) => st[r.k] === s).length;
    const [scope, setScope] = useState('workspace');
    const [ov, setOv] = useState(() => { try { return JSON.parse(localStorage.getItem('zs-feature-ov') || '{}'); } catch (e) { return {}; } });
    const setOverride = (k, v) => setOv((o) => { const n = { ...o }; n[scope] = { ...(n[scope] || {}) }; if (v) n[scope][k] = v; else delete n[scope][k]; try { localStorage.setItem('zs-feature-ov', JSON.stringify(n)); } catch (e) {} return n; });
    const scopeMeta = SCOPES.find((s) => s.id === scope) || SCOPES[0];
    const isWs = scope === 'workspace';
    const effective = (k) => (isWs ? st[k] : ((ov[scope] || {})[k] || st[k]));

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Governance" title="Feature management" subMax={660}
          sub="Decide which controls members see, and whether they may change them. Each control resolves to one state — locked, a default they can override, or their own choice — and applies across the console and the gateway."
          actions={<button className="zs-btn zs-btn-secondary" onClick={reset}><Icon name="history" size={13} tone="soft" /> Reset to recommended</button>} />

        {/* state legend + counts */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="settings" size={15} tone="soft" /><span className="zs-eyebrow">The four states</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ALL.length} controls</span>
          </div>
          <div className="grid grid-cols-4" style={{ borderTop: 'none' }}>
            {STATES.map((s, i) => (
              <div key={s} style={{ padding: 'var(--space-4) var(--space-5)', borderLeft: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', background: STATE[s].tone }} />
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{STATE[s].label}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-xl)', color: 'var(--ink)' }}>{count(s)}</span>
                </div>
                <p className="zs-body-sm" style={{ fontSize: 12, lineHeight: 1.4 }}>{STATE[s].member}</p>
              </div>
            ))}
          </div>
        </div>

        {/* precedence + scope switcher */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="routing" size={15} tone="soft" /><span className="zs-eyebrow">How a control resolves</span></span></div>
          <div className="flex items-center" style={{ padding: 'var(--space-4) var(--space-5)', gap: 8, flexWrap: 'wrap' }}>
            {LAYERS.map(([, lab, col], i, a) => (
              <React.Fragment key={lab}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)', background: 'var(--paper-mute)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-full)', padding: '5px 12px' }}><span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: col }} />{lab}</span>
                {i < a.length - 1 && <Icon name="caret" size={13} tone="mute" style={{ transform: 'rotate(-90deg)' }} />}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-2" style={{ padding: '0 var(--space-5) var(--space-4)', flexWrap: 'wrap' }}>
            <span className="zs-eyebrow" style={{ marginRight: 4 }}>Editing scope</span>
            {SCOPES.map((sc) => { const on = scope === sc.id; return (
              <button key={sc.id} onClick={() => setScope(sc.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>
                {sc.kind !== 'workspace' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7 }}>{sc.kind}</span>}{sc.label}
              </button>
            ); })}
          </div>
          <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>Each layer may only <b>tighten</b> the one above — never loosen it. {isWs ? 'You are editing the workspace default.' : <>Editing <b style={{ color: 'var(--ink)' }}>{scopeMeta.kind} · {scopeMeta.label}</b> — pick <b>Inherit</b> to follow the workspace, or a stricter state to override.</>} Locked controls ignore lower layers.</span></div>
        </div>

        {/* the matrix, grouped by concern */}
        {SECTIONS.map((sec) => (
          <div key={sec.label} className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
            <div className="card-hd">
              <span className="flex items-center gap-2"><Icon name={sec.icon} size={15} tone="soft" /><span className="zs-eyebrow">{sec.label}</span></span>
              <span className="zs-body-sm" style={{ fontSize: 12, maxWidth: 460, textAlign: 'right' }}>{sec.hint}</span>
            </div>
            <div>
              {sec.rows.map((r, i) => {
                const cur = effective(r.k);
                return (
                  <div key={r.k} className="feat-row" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <div className="feat-main">
                      <span className="glyph" style={{ width: 32, height: 32, flexShrink: 0 }}><Icon name={r.ic} size={16} tone={cur === 'locked' ? 'accent' : 'soft'} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.t}</span>
                          {r.owner.map((o) => <OwnerChip key={o} token={o} />)}
                        </div>
                        <div className="zs-body-sm" style={{ marginTop: 2, fontSize: 12 }}>{r.d}</div>
                        <div className="flex items-center gap-2" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                          {r.where.map((w) => (
                            <span key={w} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>· {w}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="feat-ctrl">
                      {isWs ? (
                        <StateSeg value={cur} allowed={r.allowed} onChange={(v) => set(r.k, v)} />
                      ) : (() => {
                        const wsState = st[r.k];
                        const strict = r.allowed.filter((s) => RANK[s] > RANK[wsState]);
                        const isOv = !!(ov[scope] || {})[r.k];
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>workspace · {STATE[wsState].label}</span>
                            <div style={{ display: 'inline-flex', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--paper)' }}>
                              <button onClick={() => setOverride(r.k, null)} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', fontWeight: 500, background: !isOv ? 'var(--paper-mute)' : 'transparent', color: 'var(--ink-soft)' }}>Inherit</button>
                              {strict.map((s) => { const on = (ov[scope] || {})[r.k] === s; return (
                                <button key={s} onClick={() => setOverride(r.k, s)} title={STATE[s].member} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', fontWeight: 500, borderLeft: '1px solid var(--paper-edge)', background: on ? STATE[s].tone : 'transparent', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}><Icon name={STATE[s].ic} size={12} tone={on ? 'paper' : 'mute'} />{STATE[s].label}</button>
                              ); })}
                              {strict.length === 0 && <span style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', fontSize: 11, color: 'var(--ink-faint)', borderLeft: '1px solid var(--paper-edge)' }}>can’t tighten further</span>}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="feat-member">
                        <Icon name={STATE[cur].ic} size={13} tone={cur === 'locked' ? 'accent' : cur === 'on' ? 'success' : 'mute'} />
                        <span>{STATE[cur].member}{!isWs && (ov[scope] || {})[r.k] ? ' · overridden at ' + scopeMeta.kind : ''}{r.note ? ' · ' + r.note : ''}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card-foot dashed" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', background: 'var(--paper-soft)' }}>
          <Icon name="info" size={14} tone="mute" />
          <span><b>Locked</b> controls can’t be changed by a space or member. <b>Default</b> controls apply everywhere but a space or member may opt out. <b>User-choice</b> controls surface with no default pushed. Space-level overrides resolve between the workspace default and the member — see <b style={{ color: 'var(--ink)' }}>Governance → effective policy</b>.</span>
        </div>
      </div>
    );
  }

  const STYLE = `
    .zs .feat-row { display: flex; align-items: flex-start; gap: var(--space-5); padding: var(--space-4) var(--space-5); }
    .zs .feat-main { display: flex; gap: var(--space-3); flex: 1; min-width: 0; }
    .zs .feat-ctrl { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; width: 360px; }
    .zs .feat-member { display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--ink-mute); text-align: right; line-height: 1.35; }
    @media (max-width: 980px) {
      .zs .feat-row { flex-direction: column; gap: var(--space-3); }
      .zs .feat-ctrl { width: 100%; align-items: flex-start; }
      .zs .feat-member { text-align: left; }
    }
  `;

  function Wrapped() {
    return React.createElement(React.Fragment, null,
      React.createElement('style', null, STYLE),
      React.createElement(FeatureManagementView));
  }

  window.FeatureManagementView = Wrapped;
})();
