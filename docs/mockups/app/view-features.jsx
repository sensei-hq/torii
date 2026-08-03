/* Seiki · view-features.jsx
   Feature management — the control-ownership model (UiFeature × UiFeatureState).
   Admins decide which controls a member sees and whether a member may override
   them. Every control resolves to one of four states:
     locked · default-on · default-off · user-overridable
   and carries a recommended owner + the surfaces it lives on. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, CardFoot, Button, Pill, Switch, PageHeader } = window.StrategosUI;
  const { useState } = React;

  /* four-state model — order is fixed for the segmented control */
  const { STATES, OWN, RANK, SCOPES, LAYERS, SECTIONS } = window.StrategosAPI.content.features;
  const STATE = {
    locked: { label: 'Locked',       tone: 'var(--accent)',   ic: 'lock',  member: "Shown locked — members can't change it" },
    on:     { label: 'Default on',   tone: 'var(--success)',  ic: 'check', member: 'On for everyone — members may turn it off' },
    off:    { label: 'Default off',  tone: 'var(--ink-mute)', ic: 'close', member: 'Off for everyone — members may turn it on' },
    user:   { label: 'User choice',  tone: 'var(--ink)',      ic: 'user',  member: 'Member decides — no default pushed' },
  };

  /* owner tokens — who the control belongs to */

  // precedence: each layer may only tighten the one above (higher rank = stricter)

  /* the ownership matrix. state = current UiFeatureState; allowed = states an
     admin may pick for this control (a safety control can't become user-owned). */

  const ALL = SECTIONS.flatMap((s) => s.rows);
  const KEY = 'zs-feature-mgmt';

  function OwnerChip({ token }) {
    const [label, color] = OWN[token];
    return (
      <span className="font-mono text-xs py-px px-2 rounded-full bg-paper-mute border whitespace-nowrap" style={{ color}}>{label}</span>
    );
  }

  /* the four-state segmented control — only the allowed states render */
  function StateSeg({ value, allowed, onChange }) {
    return (
      <div className="inline-flex border rounded overflow-hidden bg-paper">
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
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Governance" title="Feature management" subMax={660}
          sub="Decide which controls members see, and whether they may change them. Each control resolves to one state — locked, a default they can override, or their own choice — and applies across the console and the gateway."
          actions={<Button variant="secondary" onClick={reset}><Icon name="history" size={13} tone="soft" /> Reset to recommended</Button>} />

        {/* state legend + counts */}
        <Card className="overflow-hidden mb-6">
          <CardHead>
            <span className="flex items-center gap-2"><Icon name="settings" size={15} tone="soft" /><span className="zs-eyebrow">The four states</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ALL.length} controls</span>
          </CardHead>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t-0">
            {STATES.map((s, i) => (
              <div className="py-4 px-6" key={s} style={{ borderLeft: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', background: STATE[s].tone }} />
                  <span className="text-sm font-semibold text-ink">{STATE[s].label}</span>
                  <span className="ml-auto font-display font-light text-xl text-ink">{count(s)}</span>
                </div>
                <p className="zs-body-sm text-[12px] leading-snug">{STATE[s].member}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* precedence + scope switcher */}
        <Card className="overflow-hidden mb-6">
          <CardHead><span className="flex items-center gap-2"><Icon name="routing" size={15} tone="soft" /><span className="zs-eyebrow">How a control resolves</span></span></CardHead>
          <div className="flex items-center py-4 px-6 gap-2 flex-wrap">
            {LAYERS.map(([, lab, col], i, a) => (
              <React.Fragment key={lab}>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink bg-paper-mute border rounded-full py-1 px-3"><span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: col }} />{lab}</span>
                {i < a.length - 1 && <Icon name="caret" size={13} tone="mute" style={{ transform: 'rotate(-90deg)' }} />}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-0 px-6 pb-4 flex-wrap">
            <span className="zs-eyebrow mr-1">Editing scope</span>
            {SCOPES.map((sc) => { const on = scope === sc.id; return (
              <button key={sc.id} onClick={() => setScope(sc.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>
                {sc.kind !== 'workspace' && <span className="font-mono text-[10px] opacity-70">{sc.kind}</span>}{sc.label}
              </button>
            ); })}
          </div>
          <CardFoot dashed><Icon name="lock" size={14} tone="mute" /><span>Each layer may only <b>tighten</b> the one above — never loosen it. {isWs ? 'You are editing the workspace default.' : <>Editing <b style={{ color: 'var(--ink)' }}>{scopeMeta.kind} · {scopeMeta.label}</b> — pick <b>Inherit</b> to follow the workspace, or a stricter state to override.</>} Locked controls ignore lower layers.</span></CardFoot>
        </Card>

        {/* the matrix, grouped by concern */}
        {SECTIONS.map((sec) => (
          <Card className="overflow-hidden mb-6" key={sec.label}>
            <CardHead>
              <span className="flex items-center gap-2"><Icon name={sec.icon} size={15} tone="soft" /><span className="zs-eyebrow">{sec.label}</span></span>
              <span className="zs-body-sm text-[12px] max-w-[460px] text-right">{sec.hint}</span>
            </CardHead>
            <div>
              {sec.rows.map((r, i) => {
                const cur = effective(r.k);
                return (
                  <div key={r.k} className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-start lg:gap-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <div className="flex flex-1 min-w-0 gap-3">
                      <span className="glyph w-[32px] h-[32px] shrink-0"><Icon name={r.ic} size={16} tone={cur === 'locked' ? 'accent' : 'soft'} /></span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-ink">{r.t}</span>
                          {r.owner.map((o) => <OwnerChip key={o} token={o} />)}
                        </div>
                        <div className="zs-body-sm mt-0.5 text-[12px]">{r.d}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {r.where.map((w) => (
                            <span className="font-mono text-xs text-ink-mute" key={w}>· {w}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 flex-col items-start gap-2 lg:w-[360px] lg:items-end">
                      {isWs ? (
                        <StateSeg value={cur} allowed={r.allowed} onChange={(v) => set(r.k, v)} />
                      ) : (() => {
                        const wsState = st[r.k];
                        const strict = r.allowed.filter((s) => RANK[s] > RANK[wsState]);
                        const isOv = !!(ov[scope] || {})[r.k];
                        return (
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>workspace · {STATE[wsState].label}</span>
                            <div className="inline-flex border rounded overflow-hidden bg-paper">
                              <button onClick={() => setOverride(r.k, null)} style={{ height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', fontWeight: 500, background: !isOv ? 'var(--paper-mute)' : 'transparent', color: 'var(--ink-soft)' }}>Inherit</button>
                              {strict.map((s) => { const on = (ov[scope] || {})[r.k] === s; return (
                                <button key={s} onClick={() => setOverride(r.k, s)} title={STATE[s].member} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 'var(--text-xs)', fontWeight: 500, borderLeft: '1px solid var(--paper-edge)', background: on ? STATE[s].tone : 'transparent', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}><Icon name={STATE[s].ic} size={12} tone={on ? 'paper' : 'mute'} />{STATE[s].label}</button>
                              ); })}
                              {strict.length === 0 && <span className="h-[28px] py-0 px-2.5 inline-flex items-center text-[11px] text-ink-faint border-l">can’t tighten further</span>}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="flex items-center gap-1.5 text-xs leading-[1.35] text-ink-mute text-left lg:text-right">
                        <Icon name={STATE[cur].ic} size={13} tone={cur === 'locked' ? 'accent' : cur === 'on' ? 'success' : 'mute'} />
                        <span>{STATE[cur].member}{!isWs && (ov[scope] || {})[r.k] ? ' · overridden at ' + scopeMeta.kind : ''}{r.note ? ' · ' + r.note : ''}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}

        <CardFoot dashed className="border rounded-lg bg-paper-soft">
          <Icon name="info" size={14} tone="mute" />
          <span><b>Locked</b> controls can’t be changed by a space or member. <b>Default</b> controls apply everywhere but a space or member may opt out. <b>User-choice</b> controls surface with no default pushed. Space-level overrides resolve between the workspace default and the member — see <b style={{ color: 'var(--ink)' }}>Governance → effective policy</b>.</span>
        </CardFoot>
      </ViewPad>
    );
  }

  window.FeatureManagementView = FeatureManagementView;
})();
