/* Strategos · pg-more.jsx — Compare models · Talk to your data · MCP tools. */
const { Icon: MIcon } = window.StrategosIcons;
const { Switch: MSwitch, ProviderDot: MDot, Bar: MBar } = window.StrategosUI;
const { MODELS: M_ALL, modelById: mById, money: mMoney } = window.StrategosData;
const { useState: mUseState } = React;

/* ─────────────────────────────────────────────────────────────
   COMPARE MODELS — one task, many models, side by side.
   ───────────────────────────────────────────────────────────── */
const COMPARE_ANSWER = {
  frontier: ['Rent is £1,450/mo, due on the 1st; 14-day late grace.', 'You cover internal repairs under £150; landlord covers structural.', '2-month deposit, protected in a TDS scheme.', 'Break clause at month 6 with 60 days notice.', 'No subletting without written consent.'],
  balanced: ['£1,450 monthly rent, payable on the 1st.', 'Tenant handles minor repairs; landlord the structure.', 'Deposit is two months, held in a scheme.', 'Six-month break clause with notice.', 'Subletting needs consent.'],
  fast:     ['Rent £1,450/mo on the 1st.', 'You fix small stuff, landlord big stuff.', 'Deposit = 2 months.', 'Can leave at 6 months w/ notice.', 'Ask before subletting.'],
  local:    ['Rent is 1450 a month.', 'Tenant does small repairs.', 'Deposit two months.', 'Break clause exists.', 'No subletting.'],
};
function compareTier(m) { return m.tier === 'frontier' ? 'frontier' : m.tier === 'local' ? 'local' : m.tier === 'fast' ? 'fast' : 'balanced'; }

function CompareModels() {
  const [picked, setPicked] = mUseState(['opus-4.8', 'gemini-3-flash', 'gemma-4-9b']);
  const toggle = (id) => setPicked((p) => p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : (p.length < 4 ? [...p, id] : p));
  const cards = picked.map(mById);
  const cheapest = cards.reduce((a, b) => (b.price < a.price ? b : a));
  const best = cards.reduce((a, b) => (b.q > a.q ? b : a));
  const value = cards.reduce((a, b) => ((b.q / (b.price + 1)) > (a.q / (a.price + 1)) ? b : a));

  return (
    <div className="appwin">
      <div className="appwin-bar">
        <div className="traffic"><span style={{ background: '#E36355' }}></span><span style={{ background: '#F5BE4F' }}></span><span style={{ background: '#61C554' }}></span></div>
        <span className="wtitle"><MIcon name="scale" size={14} /> Compare models · same task</span>
        <div className="wright"><span className="tag">{picked.length} of {M_ALL.length} routed</span></div>
      </div>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'var(--paper)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 12 }}>
          <span className="eyebrow">Task</span>
          <span style={{ font: '500 14px var(--font-body)', color: 'var(--ink)' }}>Summarize this 14-page lease into 5 plain-English bullets a tenant would get.</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {M_ALL.map((m) => {
            const on = picked.includes(m.id);
            return (
              <button key={m.id} type="button" onClick={() => toggle(m.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px', cursor: 'pointer',
                  borderRadius: 999, border: '1px solid ' + (on ? 'var(--moss-line)' : 'var(--line)'),
                  background: on ? 'var(--moss-soft)' : 'var(--paper-card)', color: on ? 'var(--moss)' : 'var(--ink-mute)',
                  font: '500 12px var(--font-mono)', transition: 'all 120ms' }}>
                <MDot provider={m.provider} />{m.id}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 0 }}>
        {cards.map((m, idx) => {
          const ans = COMPARE_ANSWER[compareTier(m)];
          const costPer = m.price * 4200 / 1e6;
          const badge = m.id === best.id ? ['Highest quality', 'moss'] : m.id === value.id ? ['Best value', 'sky'] : m.id === cheapest.id ? ['Cheapest', 'ink'] : null;
          return (
            <div key={m.id} style={{ borderRight: idx < cards.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MDot provider={m.provider} size={9} />
                  <span className="mono" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{m.id}</span>
                  {badge && <span className="tag" style={{ marginLeft: 'auto', color: badge[1] === 'moss' ? 'var(--moss)' : badge[1] === 'sky' ? 'var(--sky)' : 'var(--ink-mute)', borderColor: 'currentColor', background: 'transparent' }}>{badge[0]}</span>}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 5 }}>{m.route} · {m.provider} · {m.ctx} ctx</div>
              </div>
              <ol style={{ flex: 1, margin: 0, padding: '14px 16px 14px 30px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {ans.map((b, i) => <li key={i} style={{ font: '400 12.5px/1.45 var(--font-body)', color: 'var(--ink-mute)' }}>{b}</li>)}
              </ol>
              <div style={{ padding: '12px 16px', borderTop: '1px dashed var(--line)', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--paper)' }}>
                <MBar label="Quality" value={m.q} display={m.q + '%'} tone={m.q > 92 ? 'moss' : 'sky'} />
                <div style={{ display: 'flex', justifyContent: 'space-between', font: '600 12px var(--font-mono)' }}>
                  <span style={{ color: 'var(--ink-soft)' }}>{(m.lat / 1000).toFixed(1)}s</span>
                  <span style={{ color: m.price === 0 ? 'var(--success)' : 'var(--ink)' }}>{m.price === 0 ? 'free' : (costPer * 100).toFixed(2) + '¢/run'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   TALK TO YOUR DATA — NL → SQL → result + chart.
   ───────────────────────────────────────────────────────────── */
const DATA_Q = [
  {
    q: 'Top 5 properties by overdue rent this month',
    sql: "SELECT property, SUM(amount) AS overdue\nFROM rent_ledger\nWHERE status = 'overdue'\nGROUP BY property\nORDER BY overdue DESC\nLIMIT 5;",
    cols: ['Property', 'Overdue £'],
    rows: [['Harbour View', 8400], ['Maple Court', 6120], ['Kingsgate', 4300], ['Old Mill Lofts', 2750], ['Riverside', 1900]],
    chart: 'bar',
  },
  {
    q: 'Avg maintenance response time by region',
    sql: "SELECT region, AVG(resolved_at - opened_at) AS avg_hrs\nFROM tickets\nWHERE type = 'maintenance'\nGROUP BY region\nORDER BY avg_hrs;",
    cols: ['Region', 'Avg hrs'],
    rows: [['North', 18], ['Central', 26], ['South', 31], ['West', 44]],
    chart: 'bar',
  },
  {
    q: 'Portfolio occupancy, last 6 months',
    sql: "SELECT month, ROUND(100.0*occupied/units, 1) AS occupancy\nFROM occupancy_monthly\nORDER BY month\nLIMIT 6;",
    cols: ['Month', 'Occupancy %'],
    rows: [['Jan', 91], ['Feb', 92], ['Mar', 90], ['Apr', 94], ['May', 96], ['Jun', 97]],
    chart: 'line',
  },
];

function MiniChart({ spec }) {
  const vals = spec.rows.map((r) => r[1]);
  const max = Math.max(...vals);
  const W = 360, H = 150, pad = 8;
  if (spec.chart === 'line') {
    const step = (W - pad * 2) / (vals.length - 1);
    const pts = vals.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2 - 12)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }}>
        <path d={d + ` L ${pts[pts.length - 1][0]} ${H - pad} L ${pts[0][0]} ${H - pad} Z`} fill="var(--moss-soft)" opacity="0.5" />
        <path d={d} fill="none" stroke="var(--moss)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill="var(--paper-card)" stroke="var(--moss)" strokeWidth="1.5" />)}
      </svg>
    );
  }
  const bw = (W - pad * 2) / vals.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }}>
      {vals.map((v, i) => {
        const h = (v / max) * (H - pad * 2 - 4);
        return <rect key={i} x={pad + i * bw + 6} y={H - pad - h} width={bw - 14} height={h} rx="3" fill="var(--moss)" opacity={0.55 + 0.45 * (v / max)} />;
      })}
    </svg>
  );
}

function TalkToData() {
  const [i, setI] = mUseState(0);
  const spec = DATA_Q[i];
  return (
    <div className="appwin">
      <div className="appwin-bar">
        <div className="traffic"><span style={{ background: '#E36355' }}></span><span style={{ background: '#F5BE4F' }}></span><span style={{ background: '#61C554' }}></span></div>
        <span className="wtitle"><MIcon name="database" size={14} /> Talk to your data · NL → SQL</span>
        <div className="wright"><span className="tag"><MIcon name="lock" size={12} /> read-only · in-tenant</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.25fr)', minHeight: 440 }}>
        <div style={{ borderRight: '1px solid var(--line)', padding: '18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Ask in plain English</div>
          {DATA_Q.map((d, idx) => (
            <button key={idx} type="button" onClick={() => setI(idx)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', cursor: 'pointer', textAlign: 'left',
                border: '1px solid ' + (idx === i ? 'var(--moss-line)' : 'var(--line)'), borderRadius: 10,
                background: idx === i ? 'var(--moss-soft)' : 'var(--paper-card)', transition: 'all 120ms' }}>
              <MIcon name="search" size={14} style={{ color: idx === i ? 'var(--moss)' : 'var(--ink-soft)', flexShrink: 0 }} />
              <span style={{ font: '500 13px/1.35 var(--font-body)', color: idx === i ? 'var(--moss)' : 'var(--ink)' }}>{d.q}</span>
            </button>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Generated SQL</div>
            <pre style={{ margin: 0, padding: 14, background: 'var(--paper-inset)', border: '1px solid var(--line)', borderRadius: 10, font: '500 11.5px/1.6 var(--font-mono)', color: 'var(--ink)', overflowX: 'auto', whiteSpace: 'pre' }}>{spec.sql}</pre>
          </div>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="eyebrow">Result</span>
            <span className="tag"><MIcon name="check" size={12} style={{ color: 'var(--success)' }} /> {spec.rows.length} rows · 0.2s</span>
          </div>
          <table className="table">
            <thead><tr>{spec.cols.map((c, j) => <th key={c} className={j ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>
              {spec.rows.map((r, ri) => (
                <tr key={ri}><td style={{ fontFamily: 'var(--font-body)' }}>{r[0]}</td><td className="num">{r[1].toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 18, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--paper)' }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{spec.chart === 'line' ? 'Trend' : 'Distribution'}</div>
            <MiniChart spec={spec} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MCP TOOLS — catalog + a live agent run that uses what's enabled.
   ───────────────────────────────────────────────────────────── */
const MCP_SERVERS = [
  { id: 'postgres',   name: 'Postgres',     scope: 'finance.* · read', tools: 4, ic: 'database', step: ['queried', <span>ran <code>SELECT * FROM payouts</code> over <code>finance.ledger</code></span>] },
  { id: 'stripe',     name: 'Stripe',       scope: 'payouts · read',   tools: 6, ic: 'budget',   step: ['called', <span><code>stripe.list_payouts</code> → 12 payouts last 7 days</span>] },
  { id: 'filesystem', name: 'Filesystem',   scope: '/reports · rw',    tools: 3, ic: 'doc',      step: ['wrote', <span>saved <code>reconciliation-wk23.csv</code> to <code>/reports</code></span>] },
  { id: 'slack',      name: 'Slack',        scope: '#finance · post',  tools: 2, ic: 'send',     step: ['posted', <span>summary to <code>#finance-ops</code></span>] },
  { id: 'websearch',  name: 'Web search',   scope: 'public web',       tools: 1, ic: 'globe',    step: ['searched', <span>FX rates for multi-currency payouts</span>] },
  { id: 'github',     name: 'GitHub',       scope: 'repo · read',      tools: 5, ic: 'branch',   step: ['checked', <span>open issues tagged <code>billing</code></span>] },
];

function McpTools() {
  const [on, setOn] = mUseState({ postgres: true, stripe: true, filesystem: true, slack: false, websearch: false, github: false });
  const flip = (id) => setOn((s) => ({ ...s, [id]: !s[id] }));
  const active = MCP_SERVERS.filter((s) => on[s.id]);
  return (
    <div className="appwin">
      <div className="appwin-bar">
        <div className="traffic"><span style={{ background: '#E36355' }}></span><span style={{ background: '#F5BE4F' }}></span><span style={{ background: '#61C554' }}></span></div>
        <span className="wtitle"><MIcon name="tool" size={14} /> Explore tools · MCP servers</span>
        <div className="wright"><span className="tag">{active.length} connected · {active.reduce((a, s) => a + s.tools, 0)} tools</span></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', minHeight: 460 }}>
        <div style={{ borderRight: '1px solid var(--line)', padding: '16px 18px' }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Tool catalog</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {MCP_SERVERS.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 10,
                border: '1px solid ' + (on[s.id] ? 'var(--line-strong)' : 'var(--line)'), background: on[s.id] ? 'var(--paper-card)' : 'var(--paper)' }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
                  border: '1px solid var(--line)', background: on[s.id] ? 'var(--moss-soft)' : 'var(--paper-inset)', color: on[s.id] ? 'var(--moss)' : 'var(--ink-soft)' }}>
                  <MIcon name={s.ic} size={15} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '600 13px var(--font-body)', color: 'var(--ink)' }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1 }}>{s.scope} · {s.tools} tools</div>
                </div>
                <MSwitch on={on[s.id]} onClick={() => flip(s.id)} label={s.name} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Agent run</div>
          <div className="step" data-kind="user" style={{ paddingBottom: 14 }}>
            <span className="node"><MIcon name="user" size={14} /></span>
            <div className="head" style={{ fontFamily: 'var(--font-hand)', color: 'var(--user)' }}>You asked</div>
            <div className="body" style={{ font: '500 13.5px/1.5 var(--font-body)' }}>Reconcile last week's Stripe payouts against the ledger and flag mismatches.</div>
          </div>
          <div className="stream" style={{ padding: 0, overflow: 'visible' }}>
            {active.length === 0 && <div className="hand" style={{ fontSize: 18, padding: '8px 4px' }}>enable a tool to let the agent act →</div>}
            {active.map((s) => (
              <div className="step" data-kind="done" key={s.id} style={{ paddingBottom: 12 }}>
                <span className="node" style={{ color: 'var(--moss)', borderColor: 'var(--moss-line)' }}><MIcon name={s.ic} size={13} /></span>
                <div className="head" style={{ fontFamily: 'var(--font-hand)', color: 'var(--moss)' }}>{s.name} · {s.step[0]}</div>
                <div className="body" style={{ font: '400 12.5px/1.45 var(--font-body)' }}>{s.step[1]}</div>
              </div>
            ))}
            {active.length > 0 && (
              <div className="final-reply" style={{ marginTop: 4 }}>
                <div className="ft"><MIcon name="check" size={12} /> Done</div>
                <div className="body" style={{ font: '400 13px/1.5 var(--font-body)' }}>
                  Reconciled <b>12 payouts</b> against the ledger using {active.length} tool{active.length > 1 ? 's' : ''} — <b>1 mismatch</b> flagged (£240 FX rounding on a EUR payout).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.CompareModels = CompareModels;
window.TalkToData = TalkToData;
window.McpTools = McpTools;
