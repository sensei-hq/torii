/* ═══════════════════════════════════════════════════════════════════
   STRATEGOS · CONTENT
   All copy and fixture data that used to sit in the artboards, one
   namespace per view. Views read it through the single data seam:

     const { STATES, SECTIONS } = window.StrategosAPI.content.features;

   Copy edits never touch layout, and a namespace can be swapped for a
   real endpoint by moving it into a resource in app/api.jsx.
   ═══════════════════════════════════════════════════════════════════ */
window.StrategosContent = {

  /* ── admin ─────────────────────────────────────────────────────── */
  admin: {
    NAV: [
      { label: 'Overview', items: [
        { id: 'overview', label: 'Overview', icon: 'overview' },
        { id: 'requests', label: 'Usage patterns', icon: 'requests', end: 'live' },
      ]},
      { label: 'Tenant', items: [
        { id: 'organization', label: 'Members & roles', icon: 'org' },
        { id: 'onboarding', label: 'Onboarding', icon: 'sso' },
        { id: 'apikeys', label: 'API identities', icon: 'keys' },
      ]},
      { label: 'Gateway', items: [
        { id: 'models', label: 'Models', icon: 'models', end: '8' },
        { id: 'routing', label: 'Routing', icon: 'routing' },
        { id: 'connections', label: 'Connections', icon: 'keys' },
        { id: 'spaces', label: 'Spaces & KB', icon: 'library' },
        { id: 'tools', label: 'Tools & MCP', icon: 'branch' },
        { id: 'templates', label: 'Prompt library', icon: 'grid' },
      ]},
      { label: 'Govern', items: [
        { id: 'governance', label: 'Governance', icon: 'governance' },
        { id: 'features', label: 'Feature management', icon: 'lock' },
        { id: 'devices', label: 'Device fleet', icon: 'models' },
        { id: 'alerts', label: 'Alerts', icon: 'bell' },
        { id: 'billing', label: 'Budgets & billing', icon: 'wallet' },
        { id: 'settings', label: 'Settings', icon: 'settings' },
      ]},
    ],

    ACCOUNT: { mark: 'N', name: 'Northwind Estates', sub: 'org · 142 seats' },

    USER: { name: 'Aiko', initial: 'A' },
  },

  /* ── app ───────────────────────────────────────────────────────── */
  app: {
    PREF_DEFAULTS: { model: 'auto', tier: 'balanced', cites: 'compact', retention: false, autotune: false, digest: true, autosave: true, locale: 'en-GB' },

    NAV: [
      { label: 'Workspace', items: [
        { id: 'workspace', label: 'Home', icon: 'home' },
        { id: 'ask', label: 'Ask', icon: 'ask' },
        { id: 'library', label: 'Library', icon: 'library' },
      ]},
      { label: 'Tools', items: [
        { id: 'playground', label: 'Playground', icon: 'playground' },
        { id: 'compare', label: 'Compare', icon: 'scale' },
        { id: 'workflows', label: 'Workflows', icon: 'refresh' },
        { id: 'local', label: 'Local models', icon: 'models' },
      ]},
      { label: 'You', items: [
        { id: 'activity', label: 'Activity', icon: 'history' },
        { id: 'settings', label: 'Settings', icon: 'settings' },
      ]},
    ],
  },

  /* ── alerts ────────────────────────────────────────────────────── */
  alerts: {
    CHANNELS0: [
      { id: 'email',   name: 'Email',   ic: 'bell',   target: 'owners@northwind.co', on: true },
      { id: 'slack',   name: 'Slack',   ic: 'share',  target: '#strategos-alerts', on: true },
      { id: 'webhook', name: 'Webhook', ic: 'globe',  target: 'https://hooks.northwind/gw', on: false },
      { id: 'siem',    name: 'SIEM',    ic: 'upload', target: 'splunk · hec', on: true },
    ],

    SEV: { critical: ['critical', 'var(--accent)'], warning: ['warning', 'var(--warning)'], info: ['info', 'var(--ink-mute)'] },

    RULES0: [
      { id: 'budget',  name: 'Budget breach',   desc: 'A node crosses its cap threshold', trigger: 'soft cap \u2192 warn \u00b7 hard cap \u2192 block', sev: 'critical', chans: ['email', 'slack'], on: true,  fired: '2d ago' },
      { id: 'outage',  name: 'Provider outage', desc: 'A router returns sustained 5xx / timeouts', trigger: '3 failures in 60s', sev: 'critical', chans: ['email', 'slack', 'webhook'], on: true, fired: '3w ago' },
      { id: 'policy',  name: 'Policy hit',      desc: 'A guardrail blocks a call', trigger: 'any block', sev: 'warning', chans: ['slack', 'siem'], on: true, fired: '8m ago' },
      { id: 'anomaly', name: 'Usage anomaly',   desc: 'Spend or volume spikes off baseline', trigger: '3σ over 7-day mean', sev: 'warning', chans: ['email'], on: true, fired: '5d ago' },
      { id: 'device',  name: 'Device offline',  desc: 'An enrolled device stops syncing', trigger: 'no heartbeat 24h', sev: 'info', chans: ['slack'], on: false, fired: '—' },
      { id: 'ingest',  name: 'Ingestion failed', desc: 'A document fails to parse or embed', trigger: 'any failure', sev: 'info', chans: ['slack'], on: true, fired: '1h ago' },
    ],
  },

  /* ── apikeys ───────────────────────────────────────────────────── */
  apikeys: {
    KEYS0: [
      { id: 'sk_live_renewals', name: 'Renewals bot', kind: 'service', node: 'Leasing', scope: 'chat · files', rate: '600/min', created: '2mo ago', last: '4m ago', calls: 18420, spend: 62.4, status: 'active', prefix: 'sk_live_4f2a…' },
      { id: 'sk_live_digest',   name: 'Weekly digest', kind: 'service', node: 'Support', scope: 'chat',        rate: '120/min', created: '3mo ago', last: '2d ago', calls: 640,   spend: 3.1,  status: 'active', prefix: 'sk_live_9c81…' },
      { id: 'sk_live_ingest',   name: 'Ingest worker', kind: 'service', node: 'Northwind Estates', scope: 'embeddings', rate: '2,000/min', created: '5mo ago', last: '1m ago', calls: 94200, spend: 41.0, status: 'active', prefix: 'sk_live_2d55…' },
      { id: 'sk_test_sandbox',  name: 'Dev sandbox',   kind: 'key',     node: 'a.rao', scope: 'chat · tools', rate: '60/min', created: '1w ago', last: '—', calls: 12, spend: 0.02, status: 'active', prefix: 'sk_test_7b0e…' },
      { id: 'sk_live_legacy',   name: 'Old exporter',  kind: 'key',     node: 'Finance', scope: 'files',      rate: '—', created: '1y ago', last: '3mo ago', calls: 5100, spend: 0, status: 'revoked', prefix: 'sk_live_1a0f…' },
    ],
  },

  /* ── ask ───────────────────────────────────────────────────────── */
  ask: {
    CLF_LABEL: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    TASKS: [
      { k: 'find',      label: 'Find',      icon: 'search', ask: 'Find overdue renewals' },
      { k: 'summarize', label: 'Summarize', icon: 'doc',    ask: 'Summarize for the board' },
      { k: 'draft',     label: 'Draft',     icon: 'create', ask: 'Draft a renewal notice' },
      { k: 'compare',   label: 'Compare',   icon: 'scale',  ask: 'Compare to last quarter' },
    ],
  },

  /* ── billing ───────────────────────────────────────────────────── */
  billing: {
    SEATS0: [
      { user: 'a.rao', role: 'Admin', last: 'now', active: true },
      { user: 'm.okafor', role: 'Viewer', last: '3m', active: true },
      { user: 's.kaur', role: 'Editor', last: '2h', active: true },
      { user: 't.bauer', role: 'Viewer', last: '21d', active: true },
      { user: 'j.lee', role: 'Viewer', last: '3mo', active: true },
    ],

    PROVIDER_SPEND: [['anthropic', 14200], ['openai', 6100], ['google', 3400], ['meta', 1200], ['local', 0]],

    MODEL_SPEND: [['sonnet-4.6', 'anthropic', 9800], ['opus-4.8', 'anthropic', 4400], ['gpt-5.2', 'openai', 6100], ['gemini-3-pro', 'google', 3400], ['llama-4-405b', 'meta', 1200], ['gemma-4-9b', 'local', 0]],

    KIND_IC: { org: 'org', dept: 'dept', team: 'team', user: 'user' },

    INVOICES: [
      ['Apr 2026', 'Platform license · 142 seats', 4260, 'open'],
      ['Mar 2026', 'Platform license · 138 seats', 4140, 'paid'],
      ['Mar 2026', 'Usage overage · routing', 318, 'paid'],
      ['Feb 2026', 'Platform license · 138 seats', 4140, 'paid'],
    ],
  },

  /* ── connections ───────────────────────────────────────────────── */
  connections: {
    ROUTER_ICON: { Anthropic: 'provider', OpenAI: 'provider', Bedrock: 'router', Vercel: 'bolt', OpenRouter: 'globe', Ollama: 'database' },

    MASKED: { Anthropic: 'sk-ant-•••• 4f2a', OpenAI: 'sk-•••• 9c1e', Bedrock: 'arn:•••• prod', Vercel: 'vc-•••• 7b30', OpenRouter: 'or-•••• 22aa', Ollama: 'localhost:11434' },

    REGION0: { Anthropic: 'eu-west-2', OpenAI: 'eu-west-2', Bedrock: 'eu-west-2', Vercel: 'fra1 · edge', OpenRouter: '—', Ollama: 'on-box' },

    SCOPES: [['all', 'All spaces'], ['finance', 'Finance only'], ['leasing', 'Leasing only'], ['admins', 'Admins only']],

    HEALTH: { healthy: ['healthy', 'var(--success)'], expiring: ['expiring soon', 'var(--warning)'], expired: ['expired', 'var(--accent)'] },

    EXP_DAYS: { Anthropic: 210, OpenAI: 120, Bedrock: 365, Vercel: 45, OpenRouter: 9, Ollama: null },
  },

  /* ── devices ───────────────────────────────────────────────────── */
  devices: {
    DEVICES0: [
      { id: 'aiko-mbp',    user: 'a.rao',    platform: 'macOS 15 · M3 Pro',  app: '0.4.2', cfg: 412, exec: 'local', models: 2, sync: 'synced',   buffer: 0, last: 'now',  keySync: 'on', fp: 'ed25519:9f2a·c41d' },
      { id: 'leasing-win', user: 'm.okafor', platform: 'Windows 11 · RTX',   app: '0.4.2', cfg: 412, exec: 'local', models: 2, sync: 'synced',   buffer: 0, last: '3m',   keySync: 'on', fp: 'ed25519:3b7e·88a0' },
      { id: 'web·chrome',  user: 's.kaur',   platform: 'Web · Chrome 141',   app: '—',     cfg: 412, exec: 'gateway', models: 0, sync: 'session', buffer: 0, last: '12m', keySync: 'n/a', fp: '—' },
      { id: 'ops-runner',  user: 'ops-bot',  platform: 'Linux · headless',   app: '0.4.1', cfg: 408, exec: 'local', models: 1, sync: 'offline',  buffer: 3, last: '1h',   keySync: 'on', fp: 'ed25519:1a0f·d52c' },
      { id: 'kaur-ipad',   user: 's.kaur',   platform: 'iPadOS · web',       app: '—',     cfg: 412, exec: 'gateway', models: 0, sync: 'session', buffer: 0, last: '2d',  keySync: 'n/a', fp: '—' },
    ],
  },

  /* ── features ──────────────────────────────────────────────────── */
  features: {
    STATES: ['locked', 'on', 'off', 'user'],

    OWN: {
      admin: ['admin', 'var(--ink)'],
      space: ['space', 'var(--accent)'],
      user:  ['user', 'var(--success)'],
      floor: ['admin floor', 'var(--warning)'],
    },

    RANK: { locked: 3, off: 2, on: 1, user: 0 },

    SCOPES: [
      { id: 'workspace', label: 'Workspace default', kind: 'workspace' },
      { id: 'space:leasing', label: 'Leasing Ops', kind: 'space' },
      { id: 'space:finance', label: 'Finance', kind: 'space' },
      { id: 'role:editor', label: 'Editor', kind: 'role' },
      { id: 'role:viewer', label: 'Viewer', kind: 'role' },
    ],

    LAYERS: [['workspace', 'Workspace default', 'var(--ink-mute)'], ['space', 'Space override', 'var(--accent)'], ['role', 'Role', 'var(--warning)'], ['user', 'User preference', 'var(--success)']],

    SECTIONS: [
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
    ],
  },

  /* ── governance ────────────────────────────────────────────────── */
  governance: {
    LEVELS: [
      { k: 'public',       label: 'Public',       n: 412,  cls: 'clf-public',       policy: 'Anyone in the org. External share allowed.' },
      { k: 'internal',     label: 'Internal',     n: 1840, cls: 'clf-internal',     policy: 'Org members only. No external links.' },
      { k: 'confidential', label: 'Confidential', n: 286,  cls: 'clf-confidential', policy: 'Space members only. PII masked in answers.' },
      { k: 'restricted',   label: 'Restricted',   n: 47,   cls: 'clf-restricted',   policy: 'Named owners only. Never leaves region. Audited.' },
    ],

    FILL: { public: 'var(--success)', internal: 'var(--ink-mute)', confidential: 'var(--warning)', restricted: 'var(--accent)' },

    OWNERS: [
      { space: 'Q1 Reporting',  owner: 'a.rao',     items: 318,  cls: 'confidential', review: '3d' },
      { space: 'Leasing Ops',   owner: 'm.okafor',  items: 1204, cls: 'internal',     review: '1w' },
      { space: 'Brand Kit',     owner: 's.kaur',    items: 96,   cls: 'public',       review: '2w' },
      { space: 'Finance Vault', owner: 'a.rao',     items: 47,   cls: 'restricted',   review: '1d' },
    ],

    ROLES: [
      { role: 'Owner',  n: 3,  can: 'Full control · billing · governance' },
      { role: 'Admin',  n: 8,  can: 'Configure models, routing, connections' },
      { role: 'Editor', n: 54, can: 'Create & edit content · share in-space' },
      { role: 'Viewer', n: 77, can: 'Read & ask · no edits, no external share' },
    ],

    CAT: { config: ['Config', 'var(--ink-mute)'], policy: ['Policy', 'var(--accent)'], access: ['Access', 'var(--success)'], export: ['Export', 'var(--warning)'] },

    POLICIES: [
      { name: 'PII masking',            scope: 'all spaces · answers',   applied: 3640, blocked: 18, last: '2m ago',  desc: 'Tenant names and PII masked before egress' },
      { name: 'Grounded-only',          scope: 'Confidential+ docs',     applied: 1204, blocked: 6,  last: '5m ago',  desc: 'Answers must cite in-tenant sources' },
      { name: 'Region pin · eu-west-2', scope: 'all cloud calls',        applied: 3120, blocked: 2,  last: '1m ago',  desc: 'No call leaves the London region' },
      { name: 'Budget floor → step-down', scope: 'department caps',      applied: 44,   blocked: 0,  last: '12m ago', desc: 'At 20% remaining, route to a cheaper tier' },
      { name: 'Tool allow-list',        scope: 'per role',               applied: 210,  blocked: 9,  last: '8m ago',  desc: 'Block tool calls outside the role allow-list' },
      { name: 'No external share',      scope: 'Internal+ documents',    applied: 96,   blocked: 4,  last: '1h ago',  desc: 'Block external links on classified docs' },
    ],

    BLOCK_DETAIL: {
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
    },

    POL_MEMBERS: ['m.okafor', 'a.rao', 's.kaur', 'j.lee'],

    LAYERS: { 'workspace-default': ['workspace', 'var(--ink-mute)'], 'space-override': ['space', 'var(--accent)'], 'user-preference': ['you', 'var(--success)'] },

    EFFECTIVE: {
      'm.okafor': [['Default model', 'sonnet-4.6', 'space-override', 'Leasing Ops · balanced tier'], ['Retrieval mode', 'Content-aware', 'workspace-default', 'org default'], ['Tool allow-list', 'warehouse · files', 'space-override', 'Leasing Ops'], ['PII masking', 'On', 'workspace-default', 'locked · cannot override'], ['Monthly cap', '$700', 'user-preference', 'within Leasing team cap']],
      'a.rao': [['Default model', 'opus-4.8', 'user-preference', 'admin pinned'], ['Retrieval mode', 'SQL-RAG', 'space-override', 'Finance'], ['Tool allow-list', 'warehouse · files · code', 'space-override', 'Finance'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$1,200', 'space-override', 'Finance dept']],
      's.kaur': [['Default model', 'gemini-3-flash', 'space-override', 'Brand Kit · fast tier'], ['Retrieval mode', 'Sentence-window', 'workspace-default', 'org default'], ['Tool allow-list', 'files', 'space-override', 'Brand Kit'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$400', 'user-preference', 'within Tier-1 cap']],
      'j.lee': [['Default model', 'sonnet-4.6', 'workspace-default', 'org default'], ['Retrieval mode', 'Content-aware', 'workspace-default', 'org default'], ['Tool allow-list', 'warehouse', 'space-override', 'Support'], ['PII masking', 'On', 'workspace-default', 'locked'], ['Monthly cap', '$400', 'user-preference', 'within Tier-1 cap']],
    },

    FEATURES0: [
      { name: 'Playground (RAG)', state: 'on' },
      { name: 'Model pinning', state: 'user' },
      { name: 'External MCP tools', state: 'locked' },
      { name: 'Web fetch tool', state: 'locked' },
      { name: 'Data export · CSV', state: 'on' },
      { name: 'Agents & plans (beta)', state: 'locked' },
    ],

    FSTATE: { locked: ['Locked', 'var(--accent)', 'lock'], on: ['Default on', 'var(--success)', 'check'], off: ['Default off', 'var(--ink-mute)', 'close'], user: ['User choice', 'var(--ink)', 'user'] },

    FSTATES: ['locked', 'on', 'off', 'user'],

    DEVICES: [
      { name: 'aiko-mbp',     user: 'a.rao',    exec: 'on-device',   models: 2, sync: 'synced',            last: 'now' },
      { name: 'leasing-win',  user: 'm.okafor', exec: 'on-device',   models: 2, sync: 'synced',            last: '3m' },
      { name: 'web · chrome', user: 's.kaur',   exec: 'via gateway', models: 0, sync: '—',                 last: '12m' },
      { name: 'ops-runner',   user: 'ops-bot',  exec: 'on-device',   models: 1, sync: 'offline · 3 queued', last: '1h' },
    ],
  },

  /* ── libraryDoc ───────────────────────────────────────────────── */
  libraryDoc: {
    CLF_LABEL: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    DEFAULT_REDACTIONS: [
      { type: 'Tenant name', placeholder: '⟨tenant-1⟩', original: 'Nor••••• Ltd', at: 'p.2 ¶1' },
      { type: 'Email', placeholder: '⟨email⟩', original: 'a•••@northwind.co', at: 'p.4 footer' },
      { type: 'Card number', placeholder: '⟨card⟩', original: '•••• 4218', at: 'table row 6' },
    ],

    COMMENTS: [
      { who: 'a.rao', role: 'owner', at: '2d ago', kind: 'comment', text: 'The arrears figure on p.4 needs the appendix-C credit applied before we share this.' },
      { who: 's.kaur', role: 'commenter', at: '1d ago', kind: 'suggestion', text: 'Suggest changing “favourable” → “£8,210 under budget” for the board.' },
      { who: 'm.okafor', role: 'editor', at: '3h ago', kind: 'comment', text: 'Agreed — I’ll re-run once the appendix-C credit lands.' },
    ],

    SENS_COL: { confidential: 'var(--accent)', internal: 'var(--warning)', public: 'var(--success)' },

    STAGES: ['queued', 'parsing', 'chunking', 'embedding', 'ready'],

    STAGE_LABEL: { queued: 'Queued', parsing: 'Parsing', chunking: 'Chunking', embedding: 'Embedding', ready: 'Ready', failed: 'Failed' },

    DOC: {
      q0: {
        ing: 'ready', quality: 96, parser: 'layout-aware · Docling profile', pages: 18, size: '4.2 MB', chunkCount: 142,
        tags: ['service charge', 'reconciliation', 'Q1', 'finance'],
        versions: [
          { v: 3, when: '3d ago', who: 'a.rao', note: 'Re-uploaded with appendix C', cur: true },
          { v: 2, when: '2w ago', who: 'a.rao', note: 'Replaced figures 1–2' },
          { v: 1, when: '1mo ago', who: 'm.okafor', note: 'Initial upload' },
        ],
        assets: [
          { name: 'q1-reconciliation.md', kind: 'doc', bytes: '38 KB', md:
  `# Q1 service-charge reconciliation
  
  Reconciliation of the **service-charge account** for the quarter ending 31 March. Figures are drawn from the managing-agent ledger and cross-checked against bank statements.
  
  ## Summary
  
  - Total demanded across the estate: **£412,800**
  - Collected to date: **£389,140** (94.3%)
  - Arrears carried forward: **£23,660**
  - Variance against budget: **−£8,210** (favourable)
  
  The largest single variance sits in *grounds maintenance*, where the seasonal contract renewed below the budgeted rate.
  
  ## Method
  
  Each cost line is matched to its supporting invoice and tagged to a schedule. Disputed items are held in suspense until resolved with the tenant.
  
  \`\`\`
  account = ledger.filter(period = "Q1")
  variance = budget - actual
  \`\`\`
  
  ## Next steps
  
  - Issue arrears reminders for the nine units above £1,000
  - Close appendix C once the lift-maintenance credit lands` },
          { name: 'service-charges.csv', kind: 'sheet', bytes: '12 KB', table: {
            cols: ['Schedule', 'Budgeted', 'Actual', 'Variance', 'Status'],
            rows: [
              ['Grounds maintenance', '£42,000', '£36,180', '−£5,820', 'Favourable'],
              ['Lift maintenance', '£28,500', '£29,940', '+£1,440', 'Over'],
              ['Cleaning', '£51,200', '£50,110', '−£1,090', 'On budget'],
              ['Insurance', '£88,400', '£88,400', '£0', 'On budget'],
              ['Management fee', '£40,000', '£40,000', '£0', 'On budget'],
              ['Reserve fund', '£120,000', '£120,000', '£0', 'On budget'],
              ['Utilities — common', '£42,700', '£39,420', '−£3,280', 'Favourable'],
            ] } },
          { name: 'figures.png', kind: 'image', cap: 'Figure 1 — Collected vs demanded by month', alt: 'Bar chart comparing demanded and collected service charge by month across the quarter.' },
          { name: 'figures-2.png', kind: 'image', cap: 'Figure 2 — Variance by schedule', alt: 'Horizontal bars showing budget variance for each service-charge schedule.' },
        ],
        chunks: [
          { id: 'c-01', head: 'Reconciliation summary', tokens: 412, score: 0.91, ctx: 'Prepended: doc title + section "Summary"' },
          { id: 'c-02', head: 'Variance — grounds maintenance', tokens: 388, score: 0.86, ctx: 'Prepended: doc title + "Method"' },
          { id: 'c-03', head: 'Arrears by unit', tokens: 503, score: 0.71, ctx: 'From table service-charges.csv (rows 1–9)', dropped: true },
          { id: 'c-04', head: 'Next steps', tokens: 196, score: 0.64, ctx: 'Prepended: doc title' },
        ],
      },
      l1: {
        ing: 'ready', quality: 92, parser: 'sheet-aware · tables→CSV', pages: 4, size: '180 KB', chunkCount: 38,
        tags: ['renewals', 'schedule', 'leasing'],
        versions: [
          { v: 2, when: '12m ago', who: 'm.okafor', note: 'Added August cohort', cur: true },
          { v: 1, when: '1w ago', who: 'm.okafor', note: 'Initial upload' },
        ],
        assets: [
          { name: 'renewals-schedule.csv', kind: 'sheet', bytes: '9 KB', table: {
            cols: ['Unit', 'Tenant', 'Expiry', 'Rent (pcm)', 'Status'],
            rows: [
              ['Maple Court 4B', 'L. Nguyen', '31 Jul', '£1,850', 'Notice sent'],
              ['Harbour View 12', 'R. Owusu', '14 Aug', '£2,200', 'In negotiation'],
              ['Maple Court 2A', 'D. Silva', '31 Aug', '£1,720', 'Renewing'],
              ['Dock Yard 7', 'K. Patel', '30 Sep', '£2,640', 'At risk'],
              ['Harbour View 3', 'S. Khan', '31 Oct', '£2,050', 'Renewing'],
            ] } },
          { name: 'summary.md', kind: 'doc', bytes: '6 KB', md:
  `# Renewals — Q3
  
  Five tenancies expire this quarter. **One** is flagged at risk (Dock Yard 7) where the tenant has signalled a possible move.
  
  - Notices issued: 1 of 5
  - In active negotiation: 2
  - Expected to renew: 3` },
        ],
        chunks: [
          { id: 'c-01', head: 'Renewals summary', tokens: 210, score: 0.83, ctx: 'Prepended: doc title' },
          { id: 'c-02', head: 'At-risk tenancies', tokens: 188, score: 0.79, ctx: 'From renewals-schedule.csv' },
        ],
      },
    },
  },

  /* ── library ───────────────────────────────────────────────────── */
  library: {
    KB_D: { chunk: 'structural', retr: 'hybrid', embed: 'bge-large-1024', rerank: true, classification: 'internal', maskStrict: false, tiers: ['frontier', 'balanced', 'fast', 'local'], retention: '24mo' },

    RET_LABEL: { '90d': '90 days', '12mo': '12 months', '24mo': '24 months', forever: 'Keep forever' },

    TIERS_ALL: ['frontier', 'balanced', 'fast', 'local'],

    CLF_MAP: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    CLF: ['public', 'internal', 'confidential', 'restricted'],

    CLF_LABEL: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    QUOTA_BY_TIER: { company: 50, department: 20, team: 10, personal: 5 },

    ING: {
      ready:     { lbl: 'Ready',     tone: 'success', cls: 'ok' },
      queued:    { lbl: 'Queued',    tone: 'mute',    cls: 'wait' },
      parsing:   { lbl: 'Parsing',   tone: 'accent',  cls: 'run' },
      chunking:  { lbl: 'Chunking',  tone: 'accent',  cls: 'run' },
      embedding: { lbl: 'Embedding', tone: 'accent',  cls: 'run' },
      failed:    { lbl: 'Failed',    tone: 'warning', cls: 'fail' },
    },
  },

  /* ── localModels ──────────────────────────────────────────────── */
  localModels: {
    FIT: { good: ['fits comfortably', 'var(--success)'], tight: ['fits — tight', 'var(--warning)'], over: ['exceeds memory', 'var(--accent)'] },

    REGISTRY: [
      { id: 'gemma-4-9b',          fmt: 'GGUF', quant: 'Q4_K_M', size: 5.4, ctx: '128K', q: 78, installed: true,  def: true,  update: false },
      { id: 'mistral-small-free',  fmt: 'GGUF', quant: 'Q5_K_M', size: 4.8, ctx: '128K', q: 80, installed: true,  def: false, update: true  },
      { id: 'qwen-3-8b',           fmt: 'GGUF', quant: 'Q4_K_M', size: 5.1, ctx: '256K', q: 82, installed: false, allowed: true },
      { id: 'phi-4-mini',          fmt: 'ONNX', quant: 'int4',   size: 2.6, ctx: '64K',  q: 74, installed: false, allowed: true },
      { id: 'llama-4-8b',          fmt: 'GGUF', quant: 'Q4_K_M', size: 5.0, ctx: '128K', q: 81, installed: false, allowed: false, reason: 'not in the admin allow-list' },
    ],
  },

  /* ── models ────────────────────────────────────────────────────── */
  models: {
    TIERS: ['all', 'frontier', 'balanced', 'fast', 'local'],

    TIER_LABEL: { all: 'All tiers', frontier: 'Frontier', balanced: 'Balanced', fast: 'Fast', local: 'Local' },

    BLANK: { id: '', provider: 'anthropic', route: 'Anthropic', tier: 'balanced', price: 1, lat: 1200, q: 85, ctx: '128K', localCap: false },
  },

  /* ── onboarding ────────────────────────────────────────────────── */
  onboarding: {
    STEPS: [
      { k: 'org',     ic: 'org',        t: 'Organization identity', s: 'Legal name, primary domain, logo and region.', done: true },
      { k: 'sso',     ic: 'sso',        t: 'Single sign-on',        s: 'Email + Google/GitHub OAuth live · SAML SSO + SCIM fast-follow.', done: true },
      { k: 'region',  ic: 'globe',      t: 'Data residency',        s: 'Set the tenant\u2019s processing region. Calls and content never leave it.', done: true },
      { k: 'router',  ic: 'router',     t: 'Connect a router',      s: '4 of 6 routers keyed. Add OpenRouter to unlock 300+ models.', done: false },
      { k: 'budgets', ic: 'wallet',     t: 'Set budgets',           s: 'Org cap set. Department caps pending for Finance & Support.', done: false },
      { k: 'invite',  ic: 'team',       t: 'Invite members',        s: '142 of 150 seats active. Bulk invite by domain available.', done: false },
      { k: 'devices', ic: 'models',     t: 'Roll out Torii', s: 'Distribute Torii installers and enrol devices for on-device models.', done: false },
      { k: 'kb',      ic: 'library',    t: 'Set up spaces & knowledge base', s: 'Create spaces, set ingestion & retrieval defaults, import docs.', done: false },
    ],

    FIELDS: [
      ['Legal name', 'Northwind Estates Ltd'],
      ['Primary domain', 'northwind.co'],
      ['Tenant ID', 'tn_nw_8f21a'],
      ['Region', 'eu-west-2 · London'],
      ['Plan', 'Enterprise · annual'],
      ['Registered', '14 Jan 2026'],
    ],
  },

  /* ── organization ──────────────────────────────────────────────── */
  organization: {
    PERIODS: [['daily', 'D'], ['weekly', 'W'], ['monthly', 'M']],

    FACTOR: { daily: 1 / 30, weekly: 7 / 30, monthly: 1 },

    SUFFIX: { daily: 'day', weekly: 'wk', monthly: 'mo' },

    KIND_ICON: { org: 'org', dept: 'dept', team: 'team', user: 'user' },

    DEPTS: { Operations: ['Maintenance', 'Leasing'], Finance: ['—'], Support: ['Tier-1'] },

    ROLES: ['Owner', 'Admin', 'Editor', 'Viewer'],

    PEOPLE0: [
      { user: 'a.rao',    dept: 'Finance',    team: '—',           role: 'Admin',  cap: 1200, mtd: 980 },
      { user: 'm.okafor', dept: 'Operations', team: 'Leasing',     role: 'Viewer', cap: 700,  mtd: 312 },
      { user: 'r.okoro',  dept: 'Operations', team: 'Maintenance', role: 'Viewer', cap: 600,  mtd: 540 },
      { user: 't.bauer',  dept: 'Operations', team: 'Maintenance', role: 'Viewer', cap: 500,  mtd: 430 },
      { user: 's.kaur',   dept: 'Support',    team: 'Tier-1',      role: 'Editor', cap: 400,  mtd: 312 },
      { user: 'j.lee',    dept: 'Support',    team: 'Tier-1',      role: 'Viewer', cap: 400,  mtd: 288 },
      { user: 'm.diaz',   dept: 'Finance',    team: '—',           role: 'Editor', cap: 600,  mtd: 410 },
    ],

    IDP: [
      { id: 'okta',   name: 'Okta',          mark: 'O', proto: 'SAML 2.0 · SCIM',   domain: 'northwind.okta.com' },
      { id: 'entra',  name: 'Microsoft Entra', mark: 'E', proto: 'SAML 2.0 · SCIM',   domain: 'northwind.onmicrosoft.com' },
      { id: 'google', name: 'Google Workspace', mark: 'G', proto: 'SAML 2.0 · SCIM', domain: 'northwind.co' },
      { id: 'saml',   name: 'Generic SAML',  mark: 'S', proto: 'SAML 2.0 · manual',  domain: 'idp.northwind.co' },
    ],

    DISCOVERED: [
      { k: 'dept', label: 'Departments', n: 3,   ic: 'org' },
      { k: 'team', label: 'Teams',       n: 4,   ic: 'team' },
      { k: 'role', label: 'Roles',       n: 4,   ic: 'role' },
      { k: 'user', label: 'People',      n: 142, ic: 'user' },
    ],

    GROUPS0: [
      { group: 'strategos-admins', members: 3,  role: 'Admin' },
      { group: 'finance-all',      members: 14, role: 'Editor' },
      { group: 'operations-all',   members: 96, role: 'Viewer' },
      { group: 'service-accounts', members: 6,  role: 'Viewer' },
    ],

    CAPS: [
      ['configure', 'Configure gateway',   'models · routing · connections'],
      ['governance', 'Manage governance',   'policies · classification · audit'],
      ['budgets',   'Manage budgets',       'caps · billing · seats'],
      ['members',   'Manage members',       'invite · roles · directory'],
      ['content',   'Create & edit content', 'documents in a space'],
      ['share',     'Share externally',      'links outside the tenant'],
      ['tools',     'Use tools / MCP',       'within the allow-list'],
      ['export',    'Export data',           'csv · reports'],
      ['apikeys',   'Manage API keys',       'service identities'],
    ],

    TIERS_R: [['frontier', 'Frontier'], ['balanced', 'Balanced'], ['fast', 'Fast'], ['local', 'Local']],

    ROLE_DEFS0: [
      { name: 'Owner',  custom: false, caps: { configure: 1, governance: 1, budgets: 1, members: 1, content: 1, share: 1, tools: 1, export: 1, apikeys: 1 }, tiers: { frontier: 1, balanced: 1, fast: 1, local: 1 } },
      { name: 'Admin',  custom: false, caps: { configure: 1, governance: 1, budgets: 0, members: 1, content: 1, share: 1, tools: 1, export: 1, apikeys: 1 }, tiers: { frontier: 1, balanced: 1, fast: 1, local: 1 } },
      { name: 'Editor', custom: false, caps: { configure: 0, governance: 0, budgets: 0, members: 0, content: 1, share: 0, tools: 1, export: 1, apikeys: 0 }, tiers: { frontier: 0, balanced: 1, fast: 1, local: 1 } },
      { name: 'Viewer', custom: false, caps: { configure: 0, governance: 0, budgets: 0, members: 0, content: 0, share: 0, tools: 0, export: 1, apikeys: 0 }, tiers: { frontier: 0, balanced: 0, fast: 1, local: 1 } },
    ],
  },

  /* ── overview ──────────────────────────────────────────────────── */
  overview: {
    TREND: [0.043, 0.041, 0.044, 0.039, 0.038, 0.040, 0.037, 0.036, 0.034, 0.035, 0.031, 0.030, 0.029, 0.028],

    TOP_MODELS: [
      { id: 'sonnet-4.6',     provider: 'anthropic', share: 52, calls: '1.9k' },
      { id: 'gemini-3-flash', provider: 'google',    share: 23, calls: '840' },
      { id: 'gemma-4-9b',     provider: 'local',     share: 14, calls: '510' },
      { id: 'gpt-5.2',        provider: 'openai',    share: 11, calls: '400' },
    ],

    SETUP: [
      { go: 'connections', ic: 'keys',    title: 'Connect routers',   stat: '4', unit: '/ 6 routers',   pct: 67,  tone: 'var(--warning)', sub: 'OpenRouter needs a key' },
      { go: 'models',      ic: 'models',  title: 'Register models',   stat: '8', unit: '/ 8 reachable', pct: 100, tone: 'var(--success)', sub: '2 on-device · 6 via gateway' },
      { go: 'routing',     ic: 'routing', title: 'Route & fall back', stat: '4', unit: 'rules live',    pct: 100, tone: 'var(--success)', sub: 'budget floor + resilience' },
    ],
  },

  /* ── playground ────────────────────────────────────────────────── */
  playground: {
    LEVELS: [
      { k: 'raw',      name: 'Raw embedding',   sub: 'cosine over 512-token chunks',              ic: 'database', use: 'A fast, fuzzy first read. No structure — tables and figures are flattened to text.' },
      { k: 'sentence', name: 'Sentence-window', sub: 'sentence vectors + window expansion',        ic: 'layers',   use: 'When the answer hinges on a sentence or two of surrounding prose.' },
      { k: 'content',  name: 'Content-aware',   sub: 'layout parse · tables → rows, figs → caps',  ic: 'doc',      use: 'When the source has tables or figures you need kept intact.' },
      { k: 'sql',      name: 'SQL-RAG',         sub: 'route structured asks to the warehouse',     ic: 'branch',   use: 'For exact numbers — routes analytical asks to the Finance warehouse tool.' },
    ],

    RETRIEVED: [
      { id: 'c-01', head: 'Reconciliation summary',            score: 0.91, src: 'q1-reconciliation.md' },
      { id: 'c-02', head: 'Variance — grounds maintenance',     score: 0.86, src: 'q1-reconciliation.md' },
      { id: 'c-03', head: 'Service-charge table (rows 1–9)',    score: 0.71, src: 'service-charges.csv' },
    ],

    SQL_ROWS: [
      ['Maple Court', '48,200', '62,400', '+14,200'],
      ['Harbour View', '31,000', '40,750', '+9,750'],
      ['Old Mill Lofts', '22,500', '25,610', '+3,110'],
      ['Kingsgate', '18,000', '19,180', '+1,180'],
    ],

    NODE_ICON: { user: 'user', autotune: 'spark', mem: 'history', retr: 'database', sql: 'branch', rerank: 'filter', guard: 'shield', done: 'check' },

    RETR_MODES: [
      { k: 'dense',  name: 'Dense',  sub: 'vector' },
      { k: 'sparse', name: 'Sparse', sub: 'BM25' },
      { k: 'hybrid', name: 'Hybrid', sub: 'dense+BM25' },
    ],

    RERANK_MODELS: ['bge-reranker-v2', 'cohere-rerank-3.5', 'jina-reranker-v2'],

    CHUNKS_PG: ['Structural', 'Paragraph', 'Sentence-window', 'Semantic', 'Proposition', 'Parent-document', 'Late chunking', 'Layout-aware'],

    ADV_MODES: [['contextual', 'Contextual'], ['transforms', 'Query transforms'], ['graphrag', 'GraphRAG'], ['raptor', 'RAPTOR'], ['colbert', 'ColBERT'], ['agentic', 'Agentic']],
  },

  /* ── requests ──────────────────────────────────────────────────── */
  requests: {
    STATUS: {
      ok:         ['served',       'var(--success)'],
      stepped:    ['stepped down', 'var(--warning)'],
      resilience: ['failed over',  'var(--accent)'],
      free:       ['free floor',   'var(--ink-mute)'],
    },

    NODE_ICON: { user: 'user', budget: 'wallet', fallback: 'routing', guard: 'shield', error: 'flag', done: 'check' },

    NODE_TONE: { user: 'ink', budget: 'warning', fallback: 'accent', guard: 'success', error: 'warning', done: 'success' },

    EXC_GROUP: [
      { kind: 'Budget step-down', n: 44, tone: 'var(--warning)', ic: 'wallet',  note: 'cap floor → cheaper tier' },
      { kind: 'Free-floor',       n: 18, tone: 'var(--ink-mute)', ic: 'models', note: 'cap exhausted → local model' },
      { kind: 'Policy block',     n: 9,  tone: 'var(--danger)',  ic: 'shield',  note: 'tool / share blocked' },
      { kind: 'Provider failover', n: 3, tone: 'var(--accent)',  ic: 'router',  note: '5xx / timeout → resilience hop' },
    ],

    USAGE: [
      { id: 'sonnet-4.6',     provider: 'anthropic', share: 52, calls: '1.9k' },
      { id: 'gemini-3-flash', provider: 'google',    share: 23, calls: '840' },
      { id: 'gemma-4-9b',     provider: 'local',     share: 14, calls: '510' },
      { id: 'gpt-5.2',        provider: 'openai',    share: 11, calls: '400' },
    ],

    DEVICE_OF: { 'a.rao': 'aiko-mbp', 'm.okafor': 'leasing-win', 's.kaur': 'web·chrome', 'j.lee': 'web·chrome', 'm.diaz': 'aiko-mbp', 'ops-bot': 'ops-runner' },

    DATE_MAX: { today: 0, '7d': 7, '30d': 30 },
  },

  /* ── routing ───────────────────────────────────────────────────── */
  routing: {
    ROLES: ['primary', 'step-down', 'resilience', 'free floor'],

    ASSIGN0: [
      { scope: 'Leasing Ops', kind: 'space', chain: 'chat' },
      { scope: 'Finance', kind: 'space', chain: 'chat' },
      { scope: 'Support', kind: 'space', chain: 'cheap' },
      { scope: 'Viewer role', kind: 'role', chain: 'cheap' },
      { scope: 'Sandbox', kind: 'space', chain: 'local' },
    ],

    HEALTH: { Anthropic: 'ok', OpenAI: 'ok', Bedrock: 'ok', Vercel: 'ok', OpenRouter: 'degraded', Ollama: 'ok' },
  },

  /* ── signin ────────────────────────────────────────────────────── */
  signin: {
    IDENTITIES: [
      { persona: 'admin',  initial: 'A', name: 'Aiko Tanaka',  email: 'aiko@northwind.co',  role: 'Administrator', scope: 'Full control · governance · billing' },
      { persona: 'member', initial: 'M', name: 'Mara Okafor',  email: 'mara@northwind.co',  role: 'Member',        scope: 'Leasing Ops · create, ask & share' },
    ],

    PROVIDERS: [
      { key: 'anthropic', label: 'anthropic', y: 38 },
      { key: 'google',    label: 'google',    y: 92 },
      { key: 'openai',    label: 'openai',    y: 146 },
      { key: 'local',     label: 'local',     y: 200 },
    ],

    VALUE: [
      { ic: 'routing', t: 'Route across every provider', s: 'One endpoint. Step-down routing and a free-tier floor pick the cheapest model that still answers well.' },
      { ic: 'wallet',  t: 'Spend with intent',           s: 'Org, team and user budgets with hard caps. Blended cost per call is down 35% this quarter.' },
      { ic: 'shield',  t: 'Govern with confidence',      s: 'OAuth, role-based access and a full request ledger — every call traceable, every key accounted for.' },
    ],
  },

  /* ── spaces ────────────────────────────────────────────────────── */
  spaces: {
    PARSERS: [
      { k: 'layout', name: 'Layout-aware', sub: 'prose → md · tables → CSV · figures → captions', q: 97 },
      { k: 'fast',   name: 'Fast text',    sub: 'text-only extraction, no table/figure split',      q: 88 },
      { k: 'ocr',    name: 'OCR fallback', sub: 'for scans & image-only PDFs',                       q: 79 },
    ],

    CHUNKS: [
      { k: 'structural', name: 'Structural / recursive', sub: 'split on heading & section boundaries' },
      { k: 'paragraph',  name: 'Paragraph-level',        sub: 'one chunk per paragraph' },
      { k: 'sentence',   name: 'Sentence-window',        sub: 'sentence vectors + window expansion' },
      { k: 'semantic',   name: 'Semantic',               sub: 'split on embedding-similarity boundaries' },
      { k: 'proposition', name: 'Proposition',           sub: 'atomic facts, one claim per chunk' },
      { k: 'parent',     name: 'Parent-document',        sub: 'retrieve small, return the parent' },
      { k: 'late',       name: 'Late chunking',          sub: 'embed the full doc, then split' },
      { k: 'layout',     name: 'Layout / content-aware', sub: 'tables & figures as their own units' },
    ],

    RETR: [
      { k: 'dense',  name: 'Dense', sub: 'vector similarity' },
      { k: 'sparse', name: 'Sparse · BM25', sub: 'keyword match' },
      { k: 'hybrid', name: 'Hybrid', sub: 'dense + sparse, weighted' },
    ],

    ADVANCED: [
      { k: 'contextual', name: 'Contextual retrieval', sub: 'prepend per-chunk context before embedding + BM25 — big recall win', rec: true },
      { k: 'rewrite',    name: 'Query transforms',     sub: 'rewriting · decomposition · HyDE' },
      { k: 'colbert',    name: 'Multi-vector · ColBERT', sub: 'late-interaction — higher accuracy, more storage' },
      { k: 'raptor',     name: 'RAPTOR',               sub: 'hierarchical summary tree for long-doc / global questions' },
      { k: 'graph',      name: 'GraphRAG',             sub: 'entity / relation graph for connect-the-dots queries' },
      { k: 'sqlrag',     name: 'SQL-RAG',              sub: 'text-to-SQL for structured / analytical questions' },
      { k: 'agentic',    name: 'Agentic RAG',          sub: 'retrieve → reason → re-retrieve loop' },
    ],

    RERANK_MODELS: ['bge-reranker-v2', 'cohere-rerank-3.5', 'jina-reranker-v2'],

    EMBED_MODELS: [['bge-large-1024', 'BGE-large · 1024-dim'], ['e5-large-1024', 'E5-large · 1024-dim'], ['nomic-768', 'Nomic-embed · 768-dim'], ['openai-3-large-3072', 'OpenAI-3-large · 3072-dim']],

    TIERS_KB: ['frontier', 'balanced', 'fast', 'local'],

    RET_OPTS: [['90d', '90 days'], ['12mo', '12 months'], ['24mo', '24 months'], ['forever', 'Keep forever']],

    CLF_KB: [['public', 'Public'], ['internal', 'Internal'], ['confidential', 'Confidential'], ['restricted', 'Restricted']],

    DEFAULTS: {
      parser: 'layout', extract: { tables: true, images: true, formulas: true }, embed: 'bge-large-1024',
      chunk: 'structural', size: 512, overlap: 64,
      retr: 'hybrid', hybrid: 65, rerank: true, rerankModel: 'bge-reranker-v2',
      advanced: ['contextual'], quotaGB: 25,
      classification: 'internal', maskStrict: false, tiers: ['frontier', 'balanced', 'fast', 'local'], retention: '24mo',
    },

    TIER_QUOTA: { company: 200, department: 80, team: 40, personal: 10 },

    STAGES: ['queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],

    STAGE_META: {
      queued:    ['queued',    'var(--ink-faint)'],
      parsing:   ['parsing',   'var(--ink-mute)'],
      chunking:  ['chunking',  'var(--ink-mute)'],
      embedding: ['embedding', 'var(--warning)'],
      ready:     ['ready',     'var(--success)'],
      failed:    ['failed',    'var(--accent)'],
    },
  },

  /* ── templates ─────────────────────────────────────────────────── */
  templates: {
    EXTRA: [
      { id: 'tpl-notice', name: 'Renewal notice', space: 'Leasing Ops', by: 'm.okafor', body: 'Draft a renewal notice for {unit} at {rent}, effective {date}.', version: 5, uses: 340, published: true, scope: 'space', updated: '5d ago' },
      { id: 'tpl-cfo',    name: 'CFO variance brief', space: 'Finance', by: 'a.rao', body: 'Summarize the month’s budget variance in five bullets for the CFO.', version: 2, uses: 41, published: false, scope: 'private', updated: 'today' },
      { id: 'tpl-tenant', name: 'Tenant reply — empathetic', space: 'Support', by: 'a.rao', body: 'Reply to the tenant’s complaint about {issue}, acknowledge and give next steps.', version: 7, uses: 512, published: true, scope: 'tenant', updated: '1d ago' },
    ],

    SCOPE: { private: ['private', 'var(--ink-mute)'], space: ['space', 'var(--accent)'], tenant: ['tenant', 'var(--success)'] },
  },

  /* ── tools ─────────────────────────────────────────────────────── */
  tools: {
    SERVERS0: [
      { id: 'finance-warehouse', transport: 'http', scope: 'shared',  exec: 'gateway',   tools: 4, status: 'healthy', url: 'https://mcp.northwind/finance', note: 'SQL over finance.*' },
      { id: 'file-export',       transport: 'sse',  scope: 'shared',  exec: 'gateway',   tools: 3, status: 'healthy', url: 'https://mcp.northwind/files',   note: 'csv · xlsx · pdf' },
      { id: 'code-interpreter',  transport: 'stdio', scope: 'desktop', exec: 'on-device', tools: 1, status: 'healthy', url: 'stdio://sandboxed-python',      note: 'sandboxed python · on-box' },
      { id: 'web-fetch',         transport: 'http', scope: 'shared',  exec: 'gateway',   tools: 1, status: 'restricted', url: 'https://mcp.northwind/web',    note: 'external URLs · off by default' },
    ],

    ROLES: ['Owner', 'Admin', 'Editor', 'Viewer'],

    TOOLS: [
      { id: 'sql',    name: 'Warehouse SQL',    server: 'finance-warehouse', grants: { Owner: true, Admin: true, Editor: true, Viewer: false } },
      { id: 'export', name: 'File export',      server: 'file-export',       grants: { Owner: true, Admin: true, Editor: true, Viewer: true } },
      { id: 'code',   name: 'Code interpreter', server: 'code-interpreter',  grants: { Owner: true, Admin: true, Editor: false, Viewer: false } },
      { id: 'web',    name: 'Web fetch',        server: 'web-fetch',         grants: { Owner: true, Admin: false, Editor: false, Viewer: false } },
    ],

    TRANSPORT: { stdio: ['stdio', 'var(--ink-mute)'], http: ['http', 'var(--ink-mute)'], sse: ['sse', 'var(--ink-mute)'] },

    SPACES: [['all', 'Role default'], ['leasing', 'Leasing Ops'], ['finance', 'Finance'], ['support', 'Support']],
  },

  /* ── workflowsBuilder ─────────────────────────────────────────── */
  workflowsBuilder: {
    STEP: {
      trigger:  { ic: 'bolt',     label: 'Trigger' },
      retrieve: { ic: 'search',   label: 'Retrieve' },
      draft:    { ic: 'create',   label: 'Draft' },
      tool:     { ic: 'router',   label: 'Tool / MCP' },
      classify: { ic: 'shield',   label: 'Classify' },
      notify:   { ic: 'bell',     label: 'Notify' },
      branch:   { ic: 'routing',  label: 'Branch' },
      output:   { ic: 'check',    label: 'Output' },
      agent:    { ic: 'spark',    label: 'Agent' },
    },

    TRIG: {
      schedule: { ic: 'calendar', label: 'Schedule' },
      event:    { ic: 'bolt',     label: 'Event' },
      manual:   { ic: 'playground', label: 'Manual' },
    },

    STATUS: {
      success: ['Success',      'var(--success)'],
      review:  ['Needs review', 'var(--warning)'],
      stepped: ['Stepped down', 'var(--accent)'],
      failed:  ['Failed',       'var(--danger)'],
      running: ['Running',      'var(--accent)'],
    },

    STEP_TYPES: ['retrieve', 'draft', 'tool', 'classify', 'notify', 'branch', 'output'],
  },

  /* ── workflows ─────────────────────────────────────────────────── */
  workflows: {
    CLF_LABEL: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    SHARE: {
      private:   { ic: 'lock',  t: 'Just me',         d: 'Only you can see and run it' },
      workspace: { ic: 'team',  t: 'This workspace',   d: 'Everyone in this workspace' },
      people:    { ic: 'share', t: 'Specific people',  d: 'Pick who can use it' },
      company:   { ic: 'org',   t: 'Company-wide',     d: 'Shared across every workspace' },
    },

    FILTERS: [['all', 'All'], ['schedule', 'Scheduled'], ['event', 'Event'], ['manual', 'Manual'], ['agent', 'Agents']],
  },

  /* ── workspace ─────────────────────────────────────────────────── */
  workspace: {
    ING_META: { queued: ['Queued', 'var(--ink-faint)'], parsing: ['Parsing', 'var(--warning)'], chunking: ['Chunking', 'var(--warning)'], embedding: ['Embedding', 'var(--warning)'], failed: ['Failed', 'var(--accent)'] },

    MY_MODELS: [
      { id: 'sonnet-4.6', note: 'default' },
      { id: 'gemini-3-flash', note: 'fast' },
      { id: 'gemma-4-9b', note: 'on device' },
    ],

    RECENT: [
      { ic: 'ask',    kind: 'Thread', title: 'Which units are due for lease renewal in Q3?', space: 'Leasing Ops', when: '12m ago' },
      { ic: 'create', kind: 'Draft',  title: 'Maple Court — service-charge variance memo',   space: 'Q1 Reporting', when: '1h ago' },
      { ic: 'doc',    kind: 'Doc',    title: 'Tenant onboarding checklist v3',                space: 'Leasing Ops', when: 'Yesterday' },
    ],

    CLF_LABEL: { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' },

    TIER_LABEL: { company: 'Company-wide', department: 'Department', team: 'Team', personal: 'Personal' },
  },
};
