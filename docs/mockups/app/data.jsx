/* Strategos Console · data.jsx — the gateway's catalog + tenant context.
   Ported from the source product; values unchanged. */
(function () {
  const MODELS = [
    { id: 'opus-4.8',           provider: 'anthropic', route: 'Bedrock',    tier: 'frontier', price: 18.00, lat: 2400, q: 98, ctx: '500K', tag: 'flagship' },
    { id: 'sonnet-4.6',         provider: 'anthropic', route: 'Anthropic',  tier: 'balanced', price: 4.50,  lat: 1200, q: 94, ctx: '500K', tag: 'default' },
    { id: 'gpt-5.2',            provider: 'openai',    route: 'OpenAI',     tier: 'frontier', price: 14.00, lat: 2100, q: 96, ctx: '400K', tag: '' },
    { id: 'gemini-3-pro',       provider: 'google',    route: 'Vercel',     tier: 'balanced', price: 5.00,  lat: 1500, q: 93, ctx: '2M',   tag: '' },
    { id: 'gemini-3-flash',     provider: 'google',    route: 'Vercel',     tier: 'fast',     price: 0.45,  lat: 480,  q: 86, ctx: '1M',   tag: 'cheap' },
    { id: 'llama-4-405b',       provider: 'meta',      route: 'OpenRouter', tier: 'balanced', price: 2.20,  lat: 1700, q: 90, ctx: '256K', tag: '' },
    { id: 'gemma-4-9b',         provider: 'local',     route: 'Ollama',     tier: 'local',    price: 0.00,  lat: 900,  q: 78, ctx: '128K', tag: 'free', localCap: true },
    { id: 'mistral-small-free', provider: 'mistral',   route: 'OpenRouter', tier: 'fast',     price: 0.00,  lat: 640,  q: 80, ctx: '128K', tag: 'free', localCap: true },
  ];

  // washi-friendly, low-chroma provider hues
  const PROVIDER_HUE = {
    anthropic: 'oklch(0.58 0.11 40)',
    openai:    'oklch(0.55 0.07 165)',
    google:    'oklch(0.56 0.10 250)',
    meta:      'oklch(0.54 0.11 265)',
    mistral:   'oklch(0.60 0.13 55)',
    local:     'oklch(0.55 0.02 250)',
  };

  const ROUTERS = [
    { id: 'Anthropic',  kind: 'first-party', note: 'direct',            keyed: true  },
    { id: 'OpenAI',     kind: 'first-party', note: 'direct',            keyed: true  },
    { id: 'Bedrock',    kind: 'cloud',       note: 'aws · in-region',   keyed: true  },
    { id: 'Vercel',     kind: 'edge',        note: 'ai gateway',        keyed: true  },
    { id: 'OpenRouter', kind: 'aggregator',  note: '300+ models',       keyed: false },
    { id: 'Ollama',     kind: 'local',       note: 'embedded · on-box', keyed: true  },
  ];

  const FALLBACK_CHAIN = [
    { model: 'opus-4.8',     rule: 'while under budget',        price: 18.00, role: 'primary'    },
    { model: 'sonnet-4.6',   rule: 'if budget < 20% remaining', price: 4.50,  role: 'step-down'  },
    { model: 'llama-4-405b', rule: 'if provider 5xx / timeout', price: 2.20,  role: 'resilience' },
    { model: 'gemma-4-9b',   rule: 'if budget exhausted',       price: 0.00,  role: 'free floor' },
  ];

  // Canonical org → dept → team → user budget tree. Single source of truth:
  // Organization edits it; Billing and Onboarding render the same tree.
  const BUDGET_TREE = {
    name: 'Northwind Estates', kind: 'org', cap: 40000, spent: 26480,
    children: [
      { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200, children: [
        { name: 'Maintenance', kind: 'team', cap: 5000, spent: 4650, children: [
          { name: 'r.okoro', kind: 'user', cap: 600, spent: 540 },
          { name: 't.bauer', kind: 'user', cap: 500, spent: 430 },
        ]},
        { name: 'Leasing', kind: 'team', cap: 4000, spent: 2100, children: [
          { name: 'm.okafor', kind: 'user', cap: 700, spent: 312 },
        ]},
      ]},
      { name: 'Finance', kind: 'dept', cap: 10000, spent: 6900, children: [
        { name: 'a.rao', kind: 'user', cap: 1200, spent: 980 },
        { name: 'm.diaz', kind: 'user', cap: 600, spent: 410 },
      ]},
      { name: 'Support', kind: 'dept', cap: 8000, spent: 5300, children: [
        { name: 'Tier-1', kind: 'team', cap: 3000, spent: 2400, children: [
          { name: 's.kaur', kind: 'user', cap: 400, spent: 312 },
          { name: 'j.lee', kind: 'user', cap: 400, spent: 288 },
        ]},
      ]},
    ],
  };

  // MCP / tool allow-list resolved for the signed-in member's role + space.
  // (Admins set these per role/space; the member sees what they may call.)
  const TOOLS = [
    { id: 'warehouse', name: 'Finance warehouse', sub: 'SQL over finance.*', allowed: true,  via: 'gateway',   mcp: 'http' },
    { id: 'files',     name: 'File export',       sub: 'csv · xlsx · pdf',  allowed: true,  via: 'gateway',   mcp: 'http' },
    { id: 'code',      name: 'Code interpreter',  sub: 'sandboxed python',  allowed: true,  via: 'on-device', mcp: 'stdio' },
    { id: 'web',       name: 'Web fetch',         sub: 'external URLs',     allowed: false, reason: 'not in the Support role allow-list' },
  ];

  // Reusable starting points — shared across the tenant or saved by a member.
  // Each carries a pipeline preset so loading one rebuilds the trace + meters.
  const PROMPT_TEMPLATES = [
    { id: 'tpl-exact', name: 'Variance — exact figures', space: 'Q1 Reporting', by: 'a.rao', shared: true,
      body: 'Which properties breached their service-charge budget last quarter, and by how much?',
      preset: { level: 3, guardrails: true, citations: true, rerank: false, autotune: false, retention: false } },
    { id: 'tpl-board', name: 'Board summary', space: 'Q1 Reporting', by: 'a.rao', shared: true,
      body: 'Summarize the Q1 service-charge variance for the board in five bullets.',
      preset: { level: 2, guardrails: true, citations: true, rerank: true, autotune: false, retention: false } },
    { id: 'tpl-scan', name: 'Quick scan', space: 'Leasing Ops', by: 'm.okafor', shared: true,
      body: 'Give me a fast first read — which properties look over budget?',
      preset: { level: 0, guardrails: false, citations: false, rerank: false, autotune: false, retention: false } },
  ];

  /* ── Workspaces ────────────────────────────────────────────────────
     A single global scope the member picks and works inside. Workspaces
     map onto the org hierarchy — company-wide → department → team → personal
     — and replace the old per-view "spaces" sidebar. Budget cascades down
     each workspace's path (last node = that workspace's own ceiling). */
  const TIERS = [
    { key: 'company',    label: 'Company-wide', icon: 'org',  hint: 'Everyone in the org' },
    { key: 'department', label: 'Departments',  icon: 'dept', hint: 'A whole department' },
    { key: 'team',       label: 'Teams',        icon: 'team', hint: 'A focused team space' },
    { key: 'personal',   label: 'Personal',     icon: 'user', hint: 'Only you' },
  ];

  const ORG_NODE = { name: 'Northwind Estates', kind: 'org', cap: 40000, spent: 26480 };

  const WORKSPACES = [
    { id: 'northwind', tier: 'company', name: 'Northwind Estates', mark: 'N', cls: 'internal',
      desc: 'Company-wide handbook, policies & brand', members: ['M', 'J', 'A', 'S', 'D'], people: 48, items: 4980,
      budget: [ORG_NODE] },
    { id: 'operations', tier: 'department', name: 'Operations', mark: 'Op', cls: 'internal',
      desc: 'SOPs, vendors & incident logs', members: ['M', 'J', 'S'], people: 22, items: 1860,
      budget: [ORG_NODE, { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200 }] },
    { id: 'finance', tier: 'department', name: 'Finance', mark: 'Fi', cls: 'confidential',
      desc: 'Budgets, ledgers & audit prep', members: ['A', 'M'], people: 9, items: 1240,
      budget: [ORG_NODE, { name: 'Finance', kind: 'dept', cap: 10000, spent: 6900 }] },
    { id: 'support', tier: 'department', name: 'Support', mark: 'Su', cls: 'internal',
      desc: 'Knowledge base, playbooks & tickets', members: ['A', 'M', 'J'], people: 14, items: 940,
      budget: [ORG_NODE, { name: 'Support', kind: 'dept', cap: 8000, spent: 5300 }] },
    { id: 'leasing', tier: 'team', name: 'Leasing Ops', mark: 'L', cls: 'internal',
      desc: 'Renewals, viewings & tenant comms', members: ['M', 'J', 'A', 'S'], people: 6, items: 1204,
      budget: [ORG_NODE, { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200 }, { name: 'Leasing', kind: 'team', cap: 4000, spent: 2100 }] },
    { id: 'q1', tier: 'team', name: 'Q1 Reporting', mark: 'Q', cls: 'confidential',
      desc: 'Quarterly packs & reconciliations', members: ['A', 'M'], people: 4, items: 318,
      budget: [ORG_NODE, { name: 'Finance', kind: 'dept', cap: 10000, spent: 6900 }, { name: 'Q1 Reporting', kind: 'team', cap: 3000, spent: 1840 }] },
    { id: 'brand', tier: 'team', name: 'Brand Kit', mark: 'B', cls: 'public',
      desc: 'Logos, templates & voice', members: ['S', 'M', 'J'], people: 5, items: 96,
      budget: [ORG_NODE, { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200 }, { name: 'Brand Kit', kind: 'team', cap: 1500, spent: 620 }] },
    { id: 'personal', tier: 'personal', name: 'My space', mark: 'M', cls: 'confidential',
      desc: 'Your drafts, notes & scratch work', members: ['M'], people: 1, items: 38,
      budget: [ORG_NODE, { name: 'Support', kind: 'dept', cap: 8000, spent: 5300 }, { name: 'You · m.okafor', kind: 'user', cap: 400, spent: 312 }] },
  ];

  // collections within each workspace
  const WS_COLLECTIONS = {
    northwind:  ['Policies', 'Brand', 'People'],
    operations: ['SOPs', 'Vendors', 'Logs'],
    finance:    ['Budgets', 'Ledgers', 'Audit'],
    support:    ['KB', 'Playbooks', 'Exports'],
    leasing:    ['Inspections', 'Renewals', 'Registers', 'Templates'],
    q1:         ['Reconciliation', 'Board', 'Workbooks'],
    brand:      ['Logos', 'Guidelines', 'Templates'],
    personal:   ['Drafts', 'Notes'],
  };

  // documents per workspace · src = upload format · norm = stored-as artifacts · ing = pipeline state
  const WS_DOCS = {
    northwind: [
      { id: 'n0', title: 'Employee handbook 2026', src: 'PDF', owner: 'hr', cls: 'public', when: '2w ago', ing: 'ready', coll: 'Policies', tags: ['handbook', 'hr'], norm: [['handbook.md', 'doc'], ['index.json', 'code']] },
      { id: 'n1', title: 'Information security policy', src: 'PDF', owner: 'it.sec', cls: 'internal', when: '1mo ago', ing: 'ready', coll: 'Policies', tags: ['security', 'policy'], norm: [['infosec.md', 'doc']] },
      { id: 'n2', title: 'Expense & travel policy', src: 'DOCX', owner: 'finance', cls: 'internal', when: '1mo ago', ing: 'ready', coll: 'Policies', tags: ['expenses', 'policy'], norm: [['expenses.md', 'doc']] },
      { id: 'n3', title: 'Brand guidelines', src: 'DOCX', owner: 's.kaur', cls: 'public', when: '3w ago', ing: 'ready', coll: 'Brand', tags: ['brand', 'guide'], norm: [['brand.md', 'doc'], ['marks.png', 'image']] },
      { id: 'n4', title: 'Org chart & directory', src: 'MD', owner: 'hr', cls: 'internal', when: '4d ago', ing: 'ready', coll: 'People', tags: ['org', 'directory'], norm: [['org-chart.md', 'doc'], ['people.csv', 'sheet']] },
    ],
    operations: [
      { id: 'o0', title: 'Maintenance SOP — planned works', src: 'MD', owner: 'm.okafor', cls: 'internal', when: '5d ago', ing: 'ready', coll: 'SOPs', tags: ['sop', 'maintenance'], norm: [['maintenance-sop.md', 'doc']] },
      { id: 'o1', title: 'Approved contractor register', src: 'XLSX', owner: 'j.lee', cls: 'internal', when: '1w ago', ing: 'ready', coll: 'Vendors', tags: ['vendors', 'register'], norm: [['contractors.csv', 'sheet']] },
      { id: 'o2', title: 'Incident log — Q1', src: 'CSV', owner: 'ops-bot', cls: 'internal', when: '2d ago', ing: 'embedding', coll: 'Logs', tags: ['incident', 'q1'], norm: [['incidents.csv', 'sheet'], ['summary.md', 'doc']] },
    ],
    finance: [
      { id: 'f0', title: 'FY26 budget model', src: 'XLSX', owner: 'a.rao', cls: 'confidential', when: '6d ago', ing: 'ready', coll: 'Budgets', tags: ['budget', 'fy26'], norm: [['budget-model.csv', 'sheet'], ['assumptions.md', 'doc']] },
      { id: 'f1', title: 'AP aging report', src: 'CSV', owner: 'a.rao', cls: 'confidential', when: '3d ago', ing: 'ready', coll: 'Ledgers', tags: ['ledger', 'ap'], norm: [['ap-aging.csv', 'sheet']] },
      { id: 'f2', title: 'Audit prep checklist', src: 'DOCX', owner: 'a.rao', cls: 'confidential', when: '1w ago', ing: 'ready', coll: 'Audit', tags: ['audit', 'checklist'], norm: [['audit-checklist.md', 'doc']] },
    ],
    support: [
      { id: 's0', title: 'Tenant FAQ knowledge base', src: 'MD', owner: 'a.rao', cls: 'internal', when: 'Yesterday', ing: 'ready', coll: 'KB', tags: ['faq', 'kb'], norm: [['tenant-faq.md', 'doc']] },
      { id: 's1', title: 'Escalation playbook', src: 'DOCX', owner: 'a.rao', cls: 'internal', when: '2w ago', ing: 'ready', coll: 'Playbooks', tags: ['playbook', 'escalation'], norm: [['escalation.md', 'doc']] },
      { id: 's2', title: 'Ticket export — March', src: 'CSV', owner: 'support-bot', cls: 'internal', when: '4d ago', ing: 'ready', coll: 'Exports', tags: ['tickets', 'export'], norm: [['tickets-mar.csv', 'sheet']] },
    ],
    leasing: [
      { id: 'l0', title: 'Building inspection — Harbour View', src: 'PDF', owner: 'm.okafor', cls: 'internal', when: 'just now', ing: 'embedding', coll: 'Inspections', tags: ['inspection', 'harbour view'], norm: [['report.md', 'doc'], ['photos.png', 'image']] },
      { id: 'l1', title: 'Renewals schedule — Q3', src: 'XLSX', owner: 'm.okafor', cls: 'internal', when: '12m ago', ing: 'ready', coll: 'Renewals', tags: ['renewals', 'q3'], norm: [['renewals-schedule.csv', 'sheet'], ['summary.md', 'doc']] },
      { id: 'l2', title: 'Lease register', src: 'MD', owner: 'm.okafor', cls: 'internal', when: '2h ago', ing: 'ready', coll: 'Registers', tags: ['register'], norm: [['lease-register.md', 'doc'], ['index.json', 'code']] },
      { id: 'l3', title: 'Tenant onboarding checklist v3', src: 'DOCX', owner: 's.kaur', cls: 'internal', when: 'Yesterday', ing: 'ready', coll: 'Templates', tags: ['onboarding', 'template'], norm: [['onboarding.md', 'doc']] },
      { id: 'l4', title: 'Maple Court 4B — renewal notice', src: 'Draft', owner: 'm.okafor', cls: 'confidential', when: '1h ago', ing: 'failed', coll: 'Renewals', tags: ['renewals', 'notice'], norm: [['renewal-notice.md', 'doc'], ['tenant-4b.json', 'code']] },
    ],
    q1: [
      { id: 'q0', title: 'Q1 service-charge pack', src: 'PDF', owner: 'a.rao', cls: 'confidential', when: '3d ago', ing: 'ready', coll: 'Reconciliation', tags: ['service charge', 'reconciliation'], norm: [['q1-reconciliation.md', 'doc'], ['service-charges.csv', 'sheet'], ['figures.png', 'image'], ['figures-2.png', 'image']] },
      { id: 'q1d', title: 'Board deck — Q1 review', src: 'PDF', owner: 'a.rao', cls: 'confidential', when: '4d ago', ing: 'ready', coll: 'Board', tags: ['board', 'q1'], norm: [['board-q1.md', 'doc'], ['charts.png', 'image']] },
      { id: 'q2', title: 'Reconciliation workbook', src: 'XLSX', owner: 'a.rao', cls: 'restricted', when: '1w ago', ing: 'ready', coll: 'Workbooks', tags: ['workbook'], norm: [['reconciliation.csv', 'sheet'], ['ledger.csv', 'sheet']] },
    ],
    brand: [
      { id: 'b0', title: 'Logo pack', src: 'ZIP', owner: 's.kaur', cls: 'public', when: '2w ago', ing: 'ready', coll: 'Logos', tags: ['logo'], norm: [['logos.png', 'image'], ['logos-mono.png', 'image']] },
      { id: 'b1', title: 'Voice & tone guide', src: 'DOCX', owner: 's.kaur', cls: 'public', when: '3w ago', ing: 'ready', coll: 'Guidelines', tags: ['voice', 'guide'], norm: [['voice.md', 'doc']] },
      { id: 'b2', title: 'Letterhead template', src: 'DOCX', owner: 's.kaur', cls: 'public', when: '1mo ago', ing: 'ready', coll: 'Templates', tags: ['template'], norm: [['letterhead.md', 'doc']] },
    ],
    personal: [
      { id: 'p0', title: 'Q3 renewals — talking points', src: 'Draft', owner: 'm.okafor', cls: 'confidential', when: '20m ago', ing: 'ready', coll: 'Drafts', tags: ['renewals', 'notes'], norm: [['talking-points.md', 'doc']] },
      { id: 'p1', title: 'Site visits — running notes', src: 'MD', owner: 'm.okafor', cls: 'confidential', when: 'Yesterday', ing: 'ready', coll: 'Notes', tags: ['notes', 'site visit'], norm: [['site-notes.md', 'doc']] },
      { id: 'p2', title: 'Scratch — model comparison', src: 'Draft', owner: 'm.okafor', cls: 'internal', when: '2d ago', ing: 'ready', coll: 'Drafts', tags: ['scratch'], norm: [['compare.md', 'doc']] },
    ],
  };

  function wsById(id) { return WORKSPACES.find((w) => w.id === id) || WORKSPACES[0]; }
  function wsByTier() {
    return TIERS.map((t) => ({ tier: t, items: WORKSPACES.filter((w) => w.tier === t.key) })).filter((g) => g.items.length);
  }

  /* ── Workflows · repeatable automation ─────────────────────────────
     A workflow is a saved, repeatable plan: a trigger (schedule / event /
     manual) → a chain of steps (retrieve, draft, tool, classify, notify,
     branch) → an output. Each run routes through the gateway, so it carries
     exec location + cost + guardrails like any call. Scoped to a workspace
     (or shared company-wide). ReAct agents are the same surface, kind:'agent',
     shipped as a v2 preview. */
  const WF = (id, name, ws, o) => Object.assign({ id, name, ws, kind: 'flow', status: 'active', shared: false }, o);

  const WORKFLOWS = [
    WF('wf-renewal', 'Renewal notice — draft & route', 'leasing', {
      trigger: { kind: 'event', label: 'On new doc', detail: 'A document lands in Leasing Ops · Renewals' },
      cls: 'confidential', owner: 'm.okafor', approval: true,
      flow: [
        { id: 's1', type: 'retrieve', title: 'Pull tenant record + schedule', detail: 'tenant-4b.json · renewals-schedule.csv', plane: 'cloud' },
        { id: 's2', type: 'draft', title: 'Draft renewal notice', detail: 'from “Standard renewal” template' },
        { id: 's3', type: 'branch', title: 'Rent uplift over 5%?', cond: 'uplift > 5%', fail: { type: 'notify', title: 'Flag for review', detail: 'assign m.okafor · hold send' } },
        { id: 's4', type: 'classify', title: 'Mark Confidential', detail: 'PII present · grounded-only' },
        { id: 's5', type: 'output', title: 'Save to Leasing Ops · Renewals', detail: 'as a Confidential draft' },
      ],
      tools: ['files'],
      budget: { perRun: 0.06, monthEst: 4.2 },
      lastRun: { at: '1h ago', status: 'review', dur: '3.1s', cost: 0.06, touched: '1 doc · held for review' },
      runs: [
        { at: 'Today · 09:12', status: 'review',  dur: '3.1s', cost: 0.06, touched: 'Maple Court 4B — uplift 6.2% held' },
        { at: 'Today · 08:40', status: 'success', dur: '2.8s', cost: 0.05, touched: 'Kingsgate 2 — drafted & saved' },
        { at: 'Yest · 16:20',  status: 'success', dur: '2.9s', cost: 0.05, touched: 'Harbour View 7A — drafted & saved' },
        { at: 'Yest · 11:05',  status: 'stepped', dur: '4.0s', cost: 0.01, touched: 'budget floor → gemma-4-9b' },
      ],
    }),
    WF('wf-digest', 'Weekly tenant-ticket digest', 'support', {
      trigger: { kind: 'schedule', label: 'Every Mon · 08:00', detail: 'Weekly · Europe/London' },
      cls: 'internal', owner: 'a.rao',
      flow: [
        { id: 's1', type: 'retrieve', title: 'Gather the week’s tickets', detail: 'tickets-mar.csv · tenant-faq.md' },
        { id: 's2', type: 'draft', title: 'Write the digest', detail: 'from “Board summary” template · 5 bullets' },
        { id: 's3', type: 'notify', title: 'Email Support leads', detail: '3 recipients · Monday 08:05' },
      ],
      tools: ['files'],
      budget: { perRun: 0.04, monthEst: 0.18 },
      lastRun: { at: 'Mon 08:01', status: 'success', dur: '5.2s', cost: 0.04, touched: '142 tickets · digest sent' },
      runs: [
        { at: 'Mon · 08:01', status: 'success', dur: '5.2s', cost: 0.04, touched: '142 tickets summarized · sent' },
        { at: 'Mon −1w · 08:01', status: 'success', dur: '4.9s', cost: 0.04, touched: '128 tickets summarized · sent' },
        { at: 'Mon −2w · 08:02', status: 'success', dur: '5.0s', cost: 0.04, touched: '151 tickets summarized · sent' },
      ],
    }),
    WF('wf-reconcile', 'Reconciliation → board summary', 'finance', {
      trigger: { kind: 'schedule', label: '1st of month · 07:00', detail: 'Monthly · Europe/London' },
      cls: 'confidential', owner: 'a.rao', approval: true,
      flow: [
        { id: 's1', type: 'tool', title: 'Query the finance warehouse', detail: 'service-charge actual vs budget', tool: 'warehouse', plane: 'cloud' },
        { id: 's2', type: 'draft', title: 'Draft board summary', detail: 'from “Variance — exact figures” template' },
        { id: 's3', type: 'branch', title: 'Variance over £10k?', cond: 'variance > £10,000', fail: { type: 'notify', title: 'Flag the CFO', detail: 'priority review · hold publish' } },
        { id: 's4', type: 'output', title: 'Save to Q1 Reporting · Board', detail: 'Confidential' },
      ],
      tools: ['warehouse', 'files'],
      budget: { perRun: 0.21, monthEst: 0.21 },
      lastRun: { at: '1 May 07:00', status: 'success', dur: '8.4s', cost: 0.21, touched: '3 properties over budget · saved' },
      runs: [
        { at: '1 May · 07:00', status: 'success', dur: '8.4s', cost: 0.21, touched: '+£27,060 net variance · saved' },
        { at: '1 Apr · 07:00', status: 'review',  dur: '9.1s', cost: 0.23, touched: 'Variance £14.2k → CFO flagged' },
      ],
    }),
    WF('wf-classify', 'Auto-classify & route new uploads', 'shared', {
      shared: true, trigger: { kind: 'event', label: 'On any upload', detail: 'Any workspace · after parsing' },
      cls: 'internal', owner: 'a.rao',
      flow: [
        { id: 's1', type: 'retrieve', title: 'Read parsed content', detail: 'md · csv · json artifacts', plane: 'local' },
        { id: 's2', type: 'classify', title: 'Detect PII → set classification', detail: 'public / internal / confidential', plane: 'local' },
        { id: 's3', type: 'branch', title: 'Contains PII?', cond: 'pii detected', fail: { type: 'output', title: 'Restrict + notify owner', detail: 'mask in answers · audit' } },
        { id: 's4', type: 'output', title: 'Route to matching collection', detail: 'by content + tags' },
      ],
      tools: [],
      budget: { perRun: 0.002, monthEst: 1.1 },
      lastRun: { at: '6m ago', status: 'success', dur: '0.9s', cost: 0.002, touched: '1 upload → Internal · Inspections' },
      runs: [
        { at: 'Today · 11:54', status: 'success', dur: '0.9s', cost: 0.002, touched: 'Harbour View report → Internal' },
        { at: 'Today · 10:21', status: 'success', dur: '0.8s', cost: 0.002, touched: 'AP aging → Confidential · restricted' },
        { at: 'Today · 09:03', status: 'failed',  dur: '—',    cost: 0,     touched: 'corrupt PDF · skipped' },
      ],
    }),
    WF('wf-overdue', 'Overdue renewals reminder', 'leasing', {
      status: 'paused', trigger: { kind: 'manual', label: 'Run on demand', detail: 'No schedule · you trigger it' },
      cls: 'internal', owner: 'm.okafor',
      flow: [
        { id: 's1', type: 'retrieve', title: 'Find overdue renewals', detail: 'past 90-day notice window' },
        { id: 's2', type: 'notify', title: 'Remind the owners', detail: 'one nudge per unit' },
      ],
      tools: ['files'],
      budget: { perRun: 0.03, monthEst: 0 },
      lastRun: { at: '2w ago', status: 'success', dur: '1.4s', cost: 0.03, touched: '5 units · reminders sent' },
      runs: [ { at: '2w ago', status: 'success', dur: '1.4s', cost: 0.03, touched: '5 overdue units · reminded' } ],
    }),
    WF('wf-agent', 'Portfolio insights agent', 'leasing', {
      kind: 'agent', status: 'draft', preview: true,
      trigger: { kind: 'schedule', label: 'Every Fri · 17:00', detail: 'Weekly · within guardrails' },
      cls: 'confidential', owner: 'm.okafor', approval: true,
      goal: 'Surface the portfolio risks worth a human’s attention this week — overdue renewals, budget overruns, repeated maintenance issues — and propose next actions.',
      guardrails: { maxSteps: 8, budgetCap: 0.5, grounded: true },
      tools: ['warehouse', 'files', 'code'],
      // an example of steps the agent CHOSE on its last dry-run
      trace: [
        { type: 'agent', title: 'Planned approach', detail: 'decide which sources to read, then synthesize' },
        { type: 'retrieve', title: 'Read renewals + maintenance logs', detail: 'chose 2 of 6 collections' },
        { type: 'tool', title: 'Queried warehouse for overruns', detail: 'service-charge variance', tool: 'warehouse', plane: 'cloud' },
        { type: 'branch', title: 'Found 3 risks above threshold', detail: 'escalated 1, summarized 2' },
        { type: 'output', title: 'Drafted a risk brief', detail: 'held for review · not sent' },
      ],
      budget: { perRun: 0.34, monthEst: 1.4 },
      lastRun: { at: 'dry-run · 2d ago', status: 'review', dur: '22s', cost: 0.34, touched: '3 risks · brief held for review' },
      runs: [ { at: 'Dry-run · 2d ago', status: 'review', dur: '22s', cost: 0.34, touched: '3 risks found · brief drafted' } ],
    }),
  ];

  function workflowsFor(wsId) { return WORKFLOWS.filter((w) => w.ws === wsId || w.shared); }

  function modelById(id) { return MODELS.find((m) => m.id === id); }
  function money(n, dp = 2) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

  // Execution location. The gateway pins all cloud calls to one region
  // (see Routing → routing policy · region pin). Anything on the Ollama
  // router runs on-box; everything else leaves via the gateway.
  const GATEWAY_REGION = 'eu-west-2';
  function execOf(routeOrId) {
    const m = modelById(routeOrId);
    const route = m ? m.route : routeOrId;
    const local = route === 'Ollama';
    return { local, region: GATEWAY_REGION, route };
  }

  window.StrategosData = { MODELS, PROVIDER_HUE, ROUTERS, FALLBACK_CHAIN, BUDGET_TREE, TOOLS, PROMPT_TEMPLATES, modelById, money, execOf, GATEWAY_REGION,
    TIERS, WORKSPACES, WS_COLLECTIONS, WS_DOCS, wsById, wsByTier, WORKFLOWS, workflowsFor };
})();
