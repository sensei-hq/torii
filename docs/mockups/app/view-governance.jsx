/* Seiki · view-governance.jsx (admin)
   Ownership · security · confidentiality for the shared content system. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, Tag, Switch, PageHeader } = window.StrategosUI;
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
    { t: '09:52', who: 'policy', cat: 'policy', text: <span><b>Blocked</b> external share on <b>Q1 board deck</b> · Confidential</span> },
    { t: '09:48', who: 'a.rao',  cat: 'export', text: <span>exported <b>requests ledger</b> · Jan 1 – today → <code>csv</code></span> },
    { t: '09:46', who: 'policy', cat: 'policy', text: <span>masked <b>2 tenant names</b> in an answer · PII policy</span> },
    { t: '09:41', who: 'a.rao',  cat: 'config', text: <span>raised <b>Support</b> budget cap → <code>$9,000</code></span> },
    { t: '09:33', who: 'a.rao',  cat: 'config', text: <span>edited hierarchy · added team <b>Tier-2</b> under Support</span> },
    { t: '09:12', who: 'm.diaz', cat: 'config', text: <span>reclassified <b>Lease template</b> → <span className="clf clf-confidential"><span className="d" />Confidential</span></span> },
    { t: '09:04', who: 'policy', cat: 'policy', text: <span><b>Blocked</b> <code>web-fetch</code> for <b>j.lee</b> · not in role allow-list</span> },
    { t: '08:30', who: 'j.lee',  cat: 'access', text: <span>signed in via Google OAuth</span> },
    { t: '08:02', who: 'system', cat: 'access', text: <span>SIEM stream healthy · <b>1,204</b> events delivered overnight</span> },
    { t: 'Yest.', who: 'system', cat: 'config', text: <span>retention job archived <b>142</b> stale items</span> },
  ];
  const CAT = { config: ['Config', 'var(--ink-mute)'], policy: ['Policy', 'var(--accent)'], access: ['Access', 'var(--success)'], export: ['Export', 'var(--warning)'] };

  // live enforcement — every guardrail the gateway applies, with proof it fired
  const POLICIES = [
    { name: 'PII masking',            scope: 'all spaces · answers',   applied: 3640, blocked: 18, last: '2m ago',  desc: 'Tenant names and PII masked before egress' },
    { name: 'Grounded-only',          scope: 'Confidential+ docs',     applied: 1204, blocked: 6,  last: '5m ago',  desc: 'Answers must cite in-tenant sources' },
    { name: 'Region pin · eu-west-2', scope: 'all cloud calls',        applied: 3120, blocked: 2,  last: '1m ago',  desc: 'No call leaves the London region' },
    { name: 'Budget floor → step-down', scope: 'department caps',      applied: 44,   blocked: 0,  last: '12m ago', desc: 'At 20% remaining, route to a cheaper tier' },
    { name: 'Tool allow-list',        scope: 'per role',               applied: 210,  blocked: 9,  last: '8m ago',  desc: 'Block tool calls outside the role allow-list' },
    { name: 'No external share',      scope: 'Internal+ documents',    applied: 96,   blocked: 4,  last: '1h ago',  desc: 'Block external links on classified docs' },
  ];

  // what actually triggered each block — the drill-down behind the counts.
  // Reinforcing or correcting an instance feeds back into the policy.
  const BLOCK_DETAIL = {
    'PII masking': [
      { id: 'pii-1', t: '09:46', who: 'j.lee',  cause: 'Masked “Northwind Ltd” in an answer — matched the tenant-name pattern.', fix: 'Added “Northwind Ltd” to the safe-terms list — it won’t be masked again.' },
      { id: 'pii-2', t: '08:58', who: 'm.diaz', cause: 'Masked a 16-digit invoice ID that looked like a card number.',           fix: 'Tuned the card-number rule to ignore the invoice-ID format.' },
    ],
    'Tool allow-list': [
      { id: 'tool-1', t: '09:04', who: 'j.lee', cause: 'Blocked web-fetch — not in the Support role allow-list.', fix: 'Added web-fetch to the Support allow-list — Support can use it now.' },
    ],
    'No external share': [
      { id: 'shr-1', t: '08:30', who: 's.kaur', cause: 'Blocked an external link on the Q1 board deck — classified Confidential.', fix: 'Reclassified the deck to Internal so it can be shared externally.' },
    ],
    'Grounded-only': [
      { id: 'grd-1', t: '09:12', who: 'a.rao', cause: 'Refused an answer with no in-tenant source — the model tried general knowledge.', fix: 'Confirmed — keep refusing ungrounded answers.' },
    ],
    'Region pin · eu-west-2': [
      { id: 'reg-1', t: '08:02', who: 'ops-bot', cause: 'Blocked a route that would have egressed to us-east-1.', fix: 'Confirmed — the region pin holds.' },
    ],
  };

  // effective-policy resolution (workspace-default → space-override → user-preference)
  const POL_MEMBERS = ['m.okafor', 'a.rao', 's.kaur', 'j.lee'];
  const LAYERS = { 'workspace-default': ['workspace', 'var(--ink-mute)'], 'space-override': ['space', 'var(--accent)'], 'user-preference': ['you', 'var(--success)'] };
  const EFFECTIVE = {
    'm.okafor': [['Default model', 'sonnet-4.6', 'space-override', 'Leasing Ops · balanced tier'], ['Retrieval mode', 'Content-aware', 'workspace-default', 'org default'], ['Tool allow-list', 'warehouse · files', 'space-override', 'Leasing Ops'], ['PII masking', 'On', 'workspace-default', 'locked · cannot override'], ['Monthly cap', '$700', 'user-preference', 'within Leasing team cap']],
    'a.rao': [['Default model', 'opus-4.8', 'user-preference', 'admin pinned'], ['Retrieval mode', 'SQL-RAG', 'space-override', 'Finance'], ['Tool allow-list', 'warehouse · files · code', 'space-override', 'Finance'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$1,200', 'space-override', 'Finance dept']],
    's.kaur': [['Default model', 'gemini-3-flash', 'space-override', 'Brand Kit · fast tier'], ['Retrieval mode', 'Sentence-window', 'workspace-default', 'org default'], ['Tool allow-list', 'files', 'space-override', 'Brand Kit'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$400', 'user-preference', 'within Tier-1 cap']],
    'j.lee': [['Default model', 'sonnet-4.6', 'workspace-default', 'org default'], ['Retrieval mode', 'Content-aware', 'workspace-default', 'org default'], ['Tool allow-list', 'warehouse', 'space-override', 'Support'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$400', 'user-preference', 'within Tier-1 cap']],
  };
  const FEATURES0 = [
    { name: 'Playground (RAG)', state: 'on' },
    { name: 'Model pinning', state: 'user' },
    { name: 'External MCP tools', state: 'locked' },
    { name: 'Web fetch tool', state: 'locked' },
    { name: 'Data export · CSV', state: 'on' },
    { name: 'Agents & plans (beta)', state: 'locked' },
  ];
  const FSTATE = { locked: ['Locked', 'var(--accent)', 'lock'], on: ['Default on', 'var(--success)', 'check'], off: ['Default off', 'var(--ink-mute)', 'close'], user: ['User choice', 'var(--ink)', 'user'] };
  const FSTATES = ['locked', 'on', 'off', 'user'];
  const DEVICES = [
    { name: 'aiko-mbp',     user: 'a.rao',    exec: 'on-device',   models: 2, sync: 'synced',            last: 'now' },
    { name: 'leasing-win',  user: 'm.okafor', exec: 'on-device',   models: 2, sync: 'synced',            last: '3m' },
    { name: 'web · chrome', user: 's.kaur',   exec: 'via gateway', models: 0, sync: '—',                 last: '12m' },
    { name: 'ops-runner',   user: 'ops-bot',  exec: 'on-device',   models: 1, sync: 'offline · 3 queued', last: '1h' },
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
        <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{sub}</div>
      </div>
    );
  }

  function GovernanceView() {
    const [siem, setSiem] = useState(true);
    const [auditCat, setAuditCat] = useState('all');
    const [member, setMember] = useState('m.okafor');
    const [features, setFeatures] = useState(FEATURES0);
    const [expanded, setExpanded] = useState('PII masking');
    const CLF_KEYS = ['public', 'internal', 'confidential', 'restricted'];
    const [levels, setLevels] = useState(() => LEVELS.map((l) => ({ ...l })));
    const total2 = levels.reduce((s, l) => s + (+l.n || 0), 0) || 1;
    const fillOf = (l) => FILL[l.k] || FILL[l.badge] || 'var(--ink-mute)';
    const badgeCls = (l) => (CLF_KEYS.includes(l.k) ? l.k : (l.badge || 'internal'));
    const setLvl = (i, patch) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const [unowned, setUnowned] = useState(12);
    const [mask, setMask] = useState({ names: true, emails: true, cards: true, secrets: true, jailbreak: true, grounded: true });
    const [rules, setRules] = useState([
      { id: 'r1', label: 'Tenant name', pattern: '(Northwind|Maple Court|Harbour View)', act: 'mask', on: true },
      { id: 'r2', label: 'Card / IBAN', pattern: '\\b(?:\\d[ -]*?){13,19}\\b', act: 'mask', on: true },
      { id: 'r3', label: 'API key / token', pattern: '(sk|pk|ghp|xoxb)[-_][A-Za-z0-9]{16,}', act: 'block', on: true },
    ]);
    const flipRule = (id) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, on: !r.on } : r)));
    const setRulePart = (id, patch) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const addRule = () => setRules((rs) => [...rs, { id: 'r' + Date.now(), label: 'New rule', pattern: '', act: 'mask', on: true }]);
    const rmRule = (id) => setRules((rs) => rs.filter((r) => r.id !== id));
    const [safe, setSafe] = useState(['Northwind Ltd', 'invoice-ID format', 'gemma-4-9b']);
    const [safeDraft, setSafeDraft] = useState('');
    const [ret, setRet] = useState({ md: '24mo', csv: '24mo', chat: '90d', images: '24mo' });
    const [hold, setHold] = useState(false);
    const RET_OPTS = [['30d', '30 days'], ['90d', '90 days'], ['12mo', '12 months'], ['24mo', '24 months'], ['forever', 'Keep forever']];
    const inpS = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-mono)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' };
    const [feedback, setFeedback] = useState(() => { try { return JSON.parse(localStorage.getItem('zs-policy-feedback') || '{}'); } catch (e) { return {}; } });
    const setFb = (id, v) => setFeedback((m) => { const n = { ...m }; if (v) n[id] = v; else delete n[id]; try { localStorage.setItem('zs-policy-feedback', JSON.stringify(n)); } catch (e) {} return n; });
    const fbCount = (v) => Object.values(feedback).filter((x) => x === v).length;
    const totalBlocks = POLICIES.reduce((s, p) => s + p.blocked, 0);
    const auditRows = AUDIT.filter((a) => auditCat === 'all' || a.cat === auditCat);
    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Governance" title="Ownership, security & confidentiality" subMax={640}
          sub="Every document in the shared system has an owner, a classification, and an audit trail. Policies here apply across both the member workspace and the gateway."
          actions={<Pill icon="check" kind="success">{POLICIES.length} policies enforced</Pill>} />

        {/* Policy enforcement — proof governance is being applied */}
        <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="shield" size={15} tone="success" /><span className="zs-eyebrow">Policy enforcement · live</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{POLICIES.length} active · <b style={{ color: 'var(--ink)' }}>{totalBlocks}</b> blocks / 24h</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '700px' }}>
              <thead><tr><th>Policy</th><th>Scope</th><th className="num">Applied 24h</th><th className="num">Blocked 24h</th><th>Last fired</th><th>Status</th></tr></thead>
              <tbody>
                {POLICIES.map((p) => {
                  const detail = BLOCK_DETAIL[p.name];
                  const open = expanded === p.name;
                  return (
                    <React.Fragment key={p.name}>
                      <tr className={detail ? 'clickable' : ''} onClick={() => detail && setExpanded(open ? null : p.name)} style={detail ? undefined : { cursor: 'default' }}>
                        <td>
                          <div className="flex items-center gap-2">
                            {detail
                              ? <Icon name="caret" size={11} tone="mute" style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }} />
                              : <span style={{ width: 11, display: 'inline-block' }} />}
                            <div>
                              <div style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                              <div className="zs-body-sm" style={{ fontSize: 11.5 }}>{p.desc}</div>
                            </div>
                          </div>
                        </td>
                        <td className="mono" data-th="Scope" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-xs)' }}>{p.scope}</td>
                        <td className="num" data-th="Applied 24h" style={{ color: 'var(--ink-mute)' }}>{p.applied.toLocaleString()}</td>
                        <td className="num" data-th="Blocked 24h" style={{ color: p.blocked > 0 ? 'var(--warning)' : 'var(--ink-faint)', fontWeight: p.blocked > 0 ? 600 : 400 }}>{p.blocked}</td>
                        <td className="mono" data-th="Last fired" style={{ color: 'var(--ink-mute)', fontSize: 'var(--text-xs)' }}>{p.last}</td>
                        <td data-th="Status"><span className="status" style={{ color: 'var(--success)' }}><span className="dot" style={{ background: 'var(--success)' }} />enforced</span></td>
                      </tr>
                      {open && detail && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, background: 'var(--paper-soft)' }}>
                            <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
                              <div className="zs-eyebrow" style={{ marginBottom: 10 }}>What triggered these blocks · validate to tune the policy</div>
                              {detail.map((b) => {
                                const fb = feedback[b.id];
                                return (
                                  <div key={b.id} style={{ padding: '10px 0', borderTop: '1px solid var(--paper-edge)' }}>
                                    <div className="flex items-baseline gap-3">
                                      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 42, flexShrink: 0 }}>{b.t}</span>
                                      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', width: 60, flexShrink: 0 }}>{b.who}</span>
                                      <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{b.cause}</span>
                                    </div>
                                    <div className="flex items-center gap-2" style={{ marginTop: 8, paddingLeft: 105, flexWrap: 'wrap' }}>
                                      {fb === 'reinforced' ? (
                                        <span className="flex items-center gap-2" style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}><Icon name="check" size={14} tone="success" /> Reinforced — the gateway keeps blocking this <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb(b.id, null)}>undo</button></span>
                                      ) : fb === 'corrected' ? (
                                        <span className="flex items-center gap-2" style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}><Icon name="spark" size={14} tone="accent" /> {b.fix} <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb(b.id, null)}>undo</button></span>
                                      ) : (
                                        <React.Fragment>
                                          <span className="zs-body-sm" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-mute)', marginRight: 4 }}>Was this right?</span>
                                          <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => setFb(b.id, 'reinforced')}><Icon name="check" size={13} tone="success" /> Correct block</button>
                                          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb(b.id, 'corrected')}><Icon name="flag" size={13} tone="accent" /> False positive</button>
                                        </React.Fragment>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="spark" size={14} tone="accent" /><span>Every call passes these checks before a model sees it. Reviewing blocks tunes them — <b style={{ color: 'var(--success)' }}>{fbCount('reinforced')}</b> reinforced, <b style={{ color: 'var(--accent)' }}>{fbCount('corrected')}</b> corrected this week.</span></div>
        </div>

        {/* Confidentiality — editable classification scheme */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-hd">
            <div className="flex items-center gap-3">
              <span className="glyph accent" style={{ width: 32, height: 32 }}><Icon name="tag" size={16} tone="accent" /></span>
              <div><div className="zs-eyebrow" style={{ marginBottom: 2 }}>Confidentiality</div><div className="zs-h3">Classification scheme</div></div>
            </div>
            <button className="zs-btn zs-btn-secondary zs-btn-sm" disabled style={{ opacity: 0.6 }} title="The four classification levels are fixed"><Icon name="lock" size={13} tone="mute" /> 4 fixed levels</button>
          </div>
          <div style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 'var(--radius-full)', overflow: 'hidden', marginBottom: 'var(--space-5)' }}>
              {levels.map((l, i) => <div key={i} title={l.label} style={{ width: ((+l.n || 0) / total2) * 100 + '%', background: fillOf(l) }} />)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-4)' }}>
              {levels.map((l, i) => (
                <div key={i} style={{ padding: 'var(--space-4)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', background: 'var(--paper)' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8, gap: 8 }}>
                    <span className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
                      <span className={'clf clf-' + badgeCls(l)} style={{ padding: 2 }}><span className="d" /></span>
                      <input value={l.label} onChange={(e) => setLvl(i, { label: e.target.value })} style={{ flex: 1, minWidth: 0, font: '600 13px var(--font-ui)', color: 'var(--ink)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper-soft)', padding: '3px 6px' }} />
                    </span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'var(--text-xl)', color: 'var(--ink)' }}>{(+l.n || 0).toLocaleString()}</span>
                  </div>
                  <textarea value={l.policy} onChange={(e) => setLvl(i, { policy: e.target.value })} rows={2} style={{ width: '100%', resize: 'vertical', font: '12px/1.45 var(--font-ui)', color: 'var(--ink-soft)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper-soft)', padding: '6px 8px' }} />
                </div>
              ))}
            </div>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Relabel a level or edit its access rule. The four levels are fixed — <b>public · internal · confidential · restricted</b>; documents keep their classification when a level is renamed.</span></div>
        </div>

        {/* Masking policy editor */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="shield" size={15} tone="success" /><span className="zs-eyebrow">Masking policy</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>workspace default · spaces may tighten</span></div>
          <div style={{ padding: '4px 0' }}>
            {[['names', 'Tenant &amp; personal names', 'Mask names matching the tenant directory + PII patterns'], ['emails', 'Email addresses', 'Redact email addresses in inputs and answers'], ['cards', 'Card &amp; account numbers', 'Redact anything matching card / IBAN patterns'], ['secrets', 'Secrets &amp; credentials', 'Redact API keys, tokens and passwords before egress'], ['jailbreak', 'Jailbreak &amp; prompt-injection filter', 'Block known injection and jailbreak patterns'], ['grounded', 'Grounded-only answers', 'Refuse answers with no in-tenant source']].map(([k, t, d], i) => (
              <div key={k} className="flex items-center gap-3" style={{ padding: '11px var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <Icon name={mask[k] ? 'check' : 'close'} size={15} tone={mask[k] ? 'success' : 'mute'} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }} dangerouslySetInnerHTML={{ __html: t }} /><div className="zs-body-sm" style={{ fontSize: 12 }}>{d}</div></div>
                <Switch on={mask[k]} onClick={() => setMask((m) => ({ ...m, [k]: !m[k] }))} label={t} />
              </div>
            ))}
          </div>
          <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>Masking runs before any model sees a call. A space may add stricter rules; members can’t switch it off.</span></div>
        </div>

        {/* redaction-rule editor */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="filter" size={15} tone="soft" /><span className="zs-eyebrow">Redaction rules</span></span><button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={addRule}><Icon name="plus" size={13} tone="soft" /> Add rule</button></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '640px' }}>
              <thead><tr><th>Label</th><th>Pattern</th><th>Action</th><th></th><th></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} style={{ opacity: r.on ? 1 : 0.5 }}>
                    <td><input value={r.label} onChange={(e) => setRulePart(r.id, { label: e.target.value })} style={{ width: '100%', font: '600 12px var(--font-ui)', color: 'var(--ink)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper-soft)', padding: '4px 6px' }} /></td>
                    <td data-th="Pattern"><input value={r.pattern} onChange={(e) => setRulePart(r.id, { pattern: e.target.value })} spellCheck={false} style={{ width: '100%', minWidth: 160, font: '11px var(--font-mono)', color: 'var(--ink)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper-soft)', padding: '4px 6px' }} /></td>
                    <td data-th="Action"><select value={r.act} onChange={(e) => setRulePart(r.id, { act: e.target.value })} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 11px var(--font-ui)', color: 'var(--ink)', padding: '3px 6px', cursor: 'pointer' }}>{['mask', 'block', 'flag'].map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                    <td><Switch on={r.on} onClick={() => flipRule(r.id)} label={'Enable ' + r.label} /></td>
                    <td><button onClick={() => rmRule(r.id)} title="Remove rule" style={{ display: 'grid', placeItems: 'center' }}><Icon name="trash" size={13} tone="faint" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Rules run in order before egress. <b>mask</b> replaces with a placeholder, <b>block</b> refuses the call, <b>flag</b> allows but records it. Patterns are RE2 — validated on save.</span></div>
        </div>

        {/* secret safe-term / allow-list */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="check" size={15} tone="success" /><span className="zs-eyebrow">Safe-term allow-list</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{safe.length} terms</span></div>
          <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
              {safe.map((s) => <span key={s} className="chip" style={{ height: 26 }}>{s}<button onClick={() => setSafe((a) => a.filter((x) => x !== s))} title="Remove" style={{ display: 'inline-flex' }}><Icon name="close" size={11} tone="mute" /></button></span>)}
            </div>
            <div className="composer" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper-soft)' }}>
              <Icon name="plus" size={15} tone="mute" />
              <input value={safeDraft} onChange={(e) => setSafeDraft(e.target.value)} placeholder="Add a term the gateway should never mask…" onKeyDown={(e) => { if (e.key === 'Enter' && safeDraft.trim()) { setSafe((a) => [...new Set([...a, safeDraft.trim()])]); setSafeDraft(''); } }} />
              <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => { if (safeDraft.trim()) { setSafe((a) => [...new Set([...a, safeDraft.trim()])]); setSafeDraft(''); } }}>Add</button>
            </div>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Safe terms are exempt from masking everywhere — the escape hatch behind “False positive” in the redaction review. Company names and product IDs commonly live here.</span></div>
        </div>

        {/* Retention & data rights */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd"><span className="flex items-center gap-2"><Icon name="history" size={15} tone="soft" /><span className="zs-eyebrow">Retention &amp; data rights</span></span></div>
          <div style={{ padding: '4px 0' }}>
            {[['md', 'Markdown documents'], ['csv', 'Table CSVs'], ['chat', 'Chat transcripts'], ['images', 'Extracted images']].map(([k, t], i) => (
              <div key={k} className="flex items-center justify-between" style={{ padding: '10px var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{t}</span>
                <select value={ret[k]} onChange={(e) => setRet((r) => ({ ...r, [k]: e.target.value }))} style={inpS}>{RET_OPTS.map(([v, lab]) => <option key={v} value={v}>{lab}</option>)}</select>
              </div>
            ))}
            <div className="flex items-center gap-3" style={{ padding: '11px var(--space-5)', borderTop: '1px solid var(--paper-edge)' }}>
              <Icon name="lock" size={15} tone={hold ? 'accent' : 'mute'} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>Legal hold</div><div className="zs-body-sm" style={{ fontSize: 12 }}>Suspend deletion across all types while an investigation is open.</div></div>
              <Switch on={hold} onClick={() => setHold((v) => !v)} label="Legal hold" />
            </div>
          </div>
          <div className="card-foot dashed" style={{ justifyContent: 'space-between', gap: 'var(--space-4)' }}>
            <span className="flex items-center gap-2"><Icon name="role" size={14} tone="mute" /><span>Data-subject requests · export or erase one person’s data across the tenant.</span></span>
            <span className="flex items-center gap-2" style={{ flexShrink: 0 }}>
              <button className="zs-btn zs-btn-secondary zs-btn-sm"><Icon name="upload" size={13} tone="soft" /> Export subject data</button>
              <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="trash" size={13} tone="warning" /> Erase subject data</button>
            </span>
          </div>
        </div>

        {/* Ownership + Security */}
        <div className="grid-half" style={{ marginTop: 'var(--space-5)' }}>
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
            <div className="card-foot dashed">{unowned > 0
              ? <React.Fragment><Icon name="flag" size={14} tone="warning" /><span style={{ flex: 1 }}><b style={{ color: 'var(--warning)' }}>{unowned} items</b> have no owner — assign before next review.</span><button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => setUnowned(0)}><Icon name="role" size={13} tone="soft" /> Assign owner</button></React.Fragment>
              : <React.Fragment><Icon name="check" size={14} tone="success" /><span>All items have an owner · assigned to space owners.</span></React.Fragment>}</div>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hd"><span className="flex items-center gap-2"><Icon name="governance" size={15} tone="soft" /><span className="zs-eyebrow">Security</span></span></div>
            <div className="flex" style={{ borderBottom: '1px solid var(--paper-edge)' }}>
              <SecTile icon="sso" label="Identity" value="Email + OAuth" sub="Google · GitHub · 142 seats · SAML fast-follow" />
              <SecTile icon="globe" label="Region" value="eu-west-2" sub="London · in-region only" />
              <div style={{ flex: 1, minWidth: 0, padding: 'var(--space-4)' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><Icon name="history" size={16} tone="soft" /><span className="zs-eyebrow">Retention</span></div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)' }}>24 months</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>md · json · csv · chat 90d</div>
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

        {/* Effective policy · per member */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="shield" size={15} tone="soft" /><span className="zs-eyebrow">Effective policy · per member</span></span>
            <select value={member} onChange={(e) => setMember(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '600 12px var(--font-mono)', color: 'var(--ink)', padding: '4px 8px', cursor: 'pointer' }}>
              {POL_MEMBERS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <table className="tbl">
            <thead><tr><th>Policy</th><th>Effective value</th><th>Set by</th></tr></thead>
            <tbody>
              {EFFECTIVE[member].map(([pol, val, layer, note]) => (
                <tr key={pol}>
                  <td style={{ color: 'var(--ink)', fontWeight: 500 }}>{pol}</td>
                  <td className="mono" style={{ color: 'var(--ink)' }}>{val}</td>
                  <td><span className="flex items-center gap-2"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', padding: '2px 7px', borderRadius: 'var(--radius-full)', background: 'var(--paper-mute)', color: LAYERS[layer][1], border: '1px solid var(--paper-edge)' }}>{LAYERS[layer][0]}</span><span className="zs-body-sm" style={{ fontSize: 11.5 }}>{note}</span></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Resolved in order: <b style={{ color: 'var(--ink-mute)' }}>workspace</b> default → <b style={{ color: 'var(--accent)' }}>space</b> override → <b style={{ color: 'var(--success)' }}>your</b> preference. Locked policies (PII) ignore lower layers.</span></div>
        </div>

        {/* Feature governance */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="settings" size={15} tone="soft" /><span className="zs-eyebrow">Feature governance</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{features.filter((f) => f.state === 'locked').length} locked · {features.filter((f) => f.state !== 'locked').length} member-adjustable</span>
          </div>
          <div style={{ padding: '4px 0' }}>
            {features.map((f, i) => { const cur = f.state; return (
              <div key={f.name} className="flex items-center gap-3" style={{ padding: '10px var(--space-5)', borderBottom: i < features.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                <Icon name={FSTATE[cur][2]} size={15} tone={cur === 'locked' ? 'accent' : cur === 'on' ? 'success' : 'mute'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{f.name}</div>
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{FSTATE[cur][0]} · {cur === 'locked' ? 'members can’t change' : cur === 'user' ? 'member decides' : 'members may override'}</div>
                </div>
                <div style={{ display: 'inline-flex', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  {FSTATES.map((s, j) => { const on = cur === s; return <button key={s} onClick={() => setFeatures((fs) => fs.map((x, k) => (k === i ? { ...x, state: s } : x)))} title={FSTATE[s][0]} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', fontSize: 10.5, fontWeight: 500, borderLeft: j ? '1px solid var(--paper-edge)' : 'none', background: on ? FSTATE[s][1] : 'transparent', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}><Icon name={FSTATE[s][2]} size={11} tone={on ? 'paper' : 'mute'} />{FSTATE[s][0]}</button>; })}
                </div>
              </div>
            ); })}
          </div>
          <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>Four states: <b>locked</b> (no one changes it), <b>default on/off</b> (a space or member may override), <b>user choice</b> (no default pushed). Mirrors <b style={{ color: 'var(--ink)' }}>Feature management</b>.</span></div>
        </div>

        {/* Device fleet */}
        <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
          <div className="card-hd">
            <span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">Device fleet · where execution lands</span></span>
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{DEVICES.length} devices · {DEVICES.filter((d) => d.exec === 'on-device').length} run locally</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '640px' }}>
              <thead><tr><th>Device</th><th>User</th><th>Executes</th><th className="num">Local models</th><th>Sync</th><th className="num">Seen</th></tr></thead>
              <tbody>
                {DEVICES.map((d) => (
                  <tr key={d.name}>
                    <td className="mono" style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.name}</td>
                    <td className="mono" data-th="User">{d.user}</td>
                    <td data-th="Executes">{d.exec === 'on-device'
                      ? <span className="exec exec-local"><Icon name="models" size={12} tone="success" />on device</span>
                      : <span className="exec"><Icon name="globe" size={12} tone="mute" />via gateway</span>}</td>
                    <td className="num" data-th="Local models">{d.models}</td>
                    <td className="mono" data-th="Sync" style={{ fontSize: 11, color: d.sync.indexOf('offline') >= 0 ? 'var(--warning)' : 'var(--ink-mute)' }}>{d.sync}</td>
                    <td className="num" data-th="Seen" style={{ color: 'var(--ink-mute)' }}>{d.last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Desktop devices can run models on-box; the web client always routes via the gateway. Offline devices buffer calls until they reconnect.</span></div>
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
          <div className="flex items-center gap-2" style={{ padding: '10px var(--space-5)', borderBottom: '1px solid var(--paper-edge)', flexWrap: 'wrap' }}>
            {[['all', 'All'], ['config', 'Config'], ['policy', 'Policy'], ['access', 'Access'], ['export', 'Export']].map(([k, lab]) => (
              <button key={k} onClick={() => setAuditCat(k)} style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500,
                border: '1px solid ' + (auditCat === k ? 'var(--ink)' : 'var(--paper-edge)'), background: auditCat === k ? 'var(--ink)' : 'var(--paper)', color: auditCat === k ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>
            ))}
          </div>
          <div style={{ padding: '8px var(--space-5) var(--space-4)' }}>
            {auditRows.map((a, i) => (
              <div key={i} className="flex items-baseline gap-3" style={{ padding: '8px 0', borderBottom: i < auditRows.length - 1 ? '1px solid var(--paper-edge)' : 'none' }}>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 44, flexShrink: 0 }}>{a.t}</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: a.who === 'policy' ? 'var(--accent)' : a.who === 'system' ? 'var(--ink-faint)' : 'var(--ink-soft)', width: 64, flexShrink: 0 }}>{a.who}</span>
                <span className="zs-body-sm" style={{ flex: 1 }}>{a.text}</span>
                <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: CAT[a.cat][1] }}>{CAT[a.cat][0]}</span>
              </div>
            ))}
          </div>
          <div className="card-foot dashed" style={{ gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>retention · <b style={{ color: 'var(--ink)' }}>24 months</b></span>
            <span className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>scope · <b style={{ color: 'var(--ink)' }}>config · policy · access · exports · sign-ins</b></span>
            <span className="flex items-center gap-2" style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>
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
