/* Strategos · governance.jsx — budget hierarchy + fallback chain (budget-driven). */
const { Icon: GIcon } = window.StrategosIcons;
const { Switch: GSwitch, ProviderDot: GDot } = window.StrategosUI;
const { FALLBACK_CHAIN: G_CHAIN, modelById: gById, money: gMoney } = window.StrategosData;
const { useState: gUseState } = React;

/* ── budget tree ── */
const BUDGET_TREE = {
  name: 'Northwind Estates', kind: 'org', cap: 40000, spent: 26480,
  children: [
    { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200, children: [
      { name: 'Maintenance', kind: 'dept', cap: 5000, spent: 4650 },
      { name: 'Leasing', kind: 'dept', cap: 4000, spent: 2100 },
    ]},
    { name: 'Finance', kind: 'dept', cap: 10000, spent: 6900 },
    { name: 'Support', kind: 'dept', cap: 8000, spent: 5300, children: [
      { name: 'You · a.rao', kind: 'user', cap: 400, spent: 312 },
    ]},
  ],
};

function spendTone(pct) { return pct >= 92 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--moss)'; }

function BudgetNode({ node, depth }) {
  const [open, setOpen] = gUseState(depth < 1);
  const pct = Math.round((node.spent / node.cap) * 100);
  const tone = spendTone(pct);
  const hasKids = node.children && node.children.length;
  const icon = { org: 'org', dept: 'dept', user: 'user' }[node.kind];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10,
        marginLeft: depth * 22, background: node.kind === 'user' ? 'var(--moss-soft)' : 'transparent',
        border: '1px solid ' + (node.kind === 'user' ? 'var(--moss-line)' : 'transparent') }}>
        <button type="button" onClick={() => hasKids && setOpen((o) => !o)}
          style={{ width: 22, height: 22, borderRadius: 6, border: 0, cursor: hasKids ? 'pointer' : 'default', display: 'grid', placeItems: 'center',
            background: 'transparent', color: 'var(--ink-soft)', visibility: hasKids ? 'visible' : 'hidden', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 160ms' }}>
          <GIcon name="caret" size={11} />
        </button>
        <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center', border: '1px solid var(--line)', background: 'var(--paper-inset)', color: 'var(--ink-mute)' }}>
          <GIcon name={icon} size={14} />
        </span>
        <div style={{ minWidth: 120, flexShrink: 0 }}>
          <div style={{ font: '600 13.5px var(--font-body)', color: 'var(--ink)' }}>{node.name}</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{node.kind}</div>
        </div>
        <div style={{ flex: 1, minWidth: 80 }}>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--paper-well)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: tone, borderRadius: 999, transition: 'width 400ms' }}></div>
          </div>
        </div>
        <div className="tnum" style={{ minWidth: 118, textAlign: 'right', font: '500 12px var(--font-mono)', color: 'var(--ink-mute)' }}>
          <span style={{ color: 'var(--ink)' }}>{gMoney(node.spent, 0)}</span> / {gMoney(node.cap, 0)}
        </div>
        <span style={{ minWidth: 34, textAlign: 'right', font: '600 12px var(--font-mono)', color: tone }}>{pct}%</span>
      </div>
      {hasKids && open && <div style={{ marginTop: 2 }}>{node.children.map((c) => <BudgetNode key={c.name} node={c} depth={depth + 1} />)}</div>}
    </div>
  );
}

function BudgetHierarchy() {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Budgets &amp; limits</div>
          <div style={{ font: '600 17px var(--font-display)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>One license, governed like thousands</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="pill"><GIcon name="refresh" size={12} /> resets monthly</span>
          <span className="pill moss"><span className="dot" style={{ background: 'var(--moss)' }}></span>$13,520 left</span>
        </div>
      </div>
      <div style={{ padding: '12px 16px 16px' }}>
        <BudgetNode node={BUDGET_TREE} depth={0} />
      </div>
      <div style={{ padding: '12px 20px', borderTop: '1px dashed var(--line)', display: 'flex', alignItems: 'center', gap: 8, font: '500 12px var(--font-body)', color: 'var(--ink-mute)' }}>
        <GIcon name="info" size={14} style={{ color: 'var(--sky)' }} />
        Limits cascade — a call is allowed only if the user, their team, the department <em>and</em> the org all have headroom. Arbitrary depth.
      </div>
    </div>
  );
}

/* ── fallback chain driven by a budget-remaining slider ── */
function FallbackChain() {
  const [remaining, setRemaining] = gUseState(64);
  const [outage, setOutage] = gUseState(false);
  /* pick active step */
  let activeIdx;
  if (outage) activeIdx = 2;            // resilience on provider error
  else if (remaining <= 0) activeIdx = 3;
  else if (remaining < 20) activeIdx = 1;
  else activeIdx = 0;
  const active = G_CHAIN[activeIdx];
  const am = gById(active.model);

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Fallback chain</div>
          <div style={{ font: '600 17px var(--font-display)', letterSpacing: '-0.01em', color: 'var(--ink)' }}>Always finish the task — at the right price</div>
        </div>
        <span className="tag"><GIcon name="fallback" size={12} /> RAG · chat with docs</span>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {/* controls */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ font: '500 11px var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Budget remaining</span>
              <span className="tnum" style={{ font: '600 12.5px var(--font-mono)', color: spendTone(100 - remaining) }}>{remaining}%</span>
            </div>
            <input type="range" min="0" max="100" value={remaining} onChange={(e) => setRemaining(+e.target.value)}
              style={{ width: '100%', accentColor: 'var(--moss)' }} disabled={outage} />
          </div>
          <div role="button" tabIndex={0} onClick={() => setOutage((o) => !o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOutage((o) => !o); } }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 36, padding: '0 12px', cursor: 'pointer', borderRadius: 10,
              border: '1px solid ' + (outage ? 'color-mix(in oklab, var(--danger) 50%, var(--line))' : 'var(--line)'),
              background: outage ? 'color-mix(in oklab, var(--danger) 12%, var(--paper-card))' : 'var(--paper-card)', color: outage ? 'var(--danger)' : 'var(--ink-mute)', font: '500 12.5px var(--font-body)' }}>
            <GIcon name="bolt" size={14} /> Simulate provider outage
            <GSwitch on={outage} onClick={() => setOutage((o) => !o)} label="outage" />
          </div>
        </div>

        {/* the chain */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {G_CHAIN.map((step, i) => {
            const sm = gById(step.model);
            const isActive = i === activeIdx;
            const skipped = i < activeIdx && !(outage && i < 2);
            return (
              <div key={step.model}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
                  border: '1px solid ' + (isActive ? 'var(--moss-line)' : 'var(--line)'),
                  background: isActive ? 'var(--moss-soft)' : 'var(--paper-card)',
                  opacity: skipped ? 0.5 : 1, transition: 'all 160ms' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', width: 16 }}>{i + 1}</span>
                  <GDot provider={sm.provider} size={9} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{step.model}</span>
                      <span className="tag" style={{ height: 18, fontSize: 9.5 }}>{step.role}</span>
                      {isActive && <span className="pill moss" style={{ height: 20, fontSize: 10 }}><span className="dot" style={{ background: 'var(--moss)' }}></span>serving now</span>}
                      {skipped && <span style={{ font: '500 11px var(--font-mono)', color: 'var(--ink-faint)' }}>· skipped</span>}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 3 }}>{step.rule} · {sm.route}</div>
                  </div>
                  <span className="tnum" style={{ font: '600 12.5px var(--font-mono)', color: step.price === 0 ? 'var(--success)' : 'var(--ink-mute)' }}>{step.price === 0 ? 'free' : gMoney(step.price) + '/M'}</span>
                </div>
                {i < G_CHAIN.length - 1 && <div style={{ marginLeft: 22, height: 14, width: 1, background: 'var(--line-strong)' }}></div>}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--paper-inset)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--moss)', color: 'var(--moss-fg)', flexShrink: 0 }}><GIcon name="check" size={15} /></span>
          <span style={{ font: '500 13px/1.45 var(--font-body)', color: 'var(--ink)' }}>
            {outage ? <span>Provider error → routed to <b>{active.model}</b> for resilience. The task still completes.</span>
              : remaining <= 0 ? <span>Budget exhausted → dropped to the <b>free floor ({active.model})</b>. Work continues; no surprise bill.</span>
              : remaining < 20 ? <span>Under 20% budget → stepped down to <b>{active.model}</b> to protect the cap.</span>
              : <span>Plenty of headroom → serving the primary <b>{active.model}</b> at full quality.</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function GovernanceSection() {
  return (
    <section className="section" id="governance" style={{ background: 'var(--paper-card)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div className="shell-max">
        <div className="section-hd">
          <span className="eyebrow"><span className="tick"></span>Controls &amp; governance</span>
          <h2>Spend it like it's yours — because the rules are.</h2>
          <p className="lede">Budgets cascade through any hierarchy. Fallbacks keep work flowing when money or providers run out. Both apply to every call, in every playground above.</p>
        </div>
        <div className="grid2" style={{ marginTop: 48 }}>
          <BudgetHierarchy />
          <FallbackChain />
        </div>
        <div style={{ marginTop: 22 }}><window.KeyVault /></div>
      </div>
    </section>
  );
}

window.GovernanceSection = GovernanceSection;
