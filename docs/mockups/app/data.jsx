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
    { id: 'gemma-4-9b',         provider: 'local',     route: 'Ollama',     tier: 'local',    price: 0.00,  lat: 900,  q: 78, ctx: '128K', tag: 'free' },
    { id: 'mistral-small-free', provider: 'mistral',   route: 'OpenRouter', tier: 'fast',     price: 0.00,  lat: 640,  q: 80, ctx: '128K', tag: 'free' },
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

  const BUDGET_TREE = {
    name: 'Northwind Estates', kind: 'org', cap: 40000, spent: 26480,
    children: [
      { name: 'Operations', kind: 'dept', cap: 14000, spent: 11200, children: [
        { name: 'Maintenance', kind: 'dept', cap: 5000, spent: 4650 },
        { name: 'Leasing',     kind: 'dept', cap: 4000, spent: 2100 },
      ]},
      { name: 'Finance', kind: 'dept', cap: 10000, spent: 6900 },
      { name: 'Support', kind: 'dept', cap: 8000, spent: 5300, children: [
        { name: 'You · a.rao', kind: 'user', cap: 400, spent: 312 },
      ]},
    ],
  };

  function modelById(id) { return MODELS.find((m) => m.id === id); }
  function money(n, dp = 2) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

  window.StrategosData = { MODELS, PROVIDER_HUE, ROUTERS, FALLBACK_CHAIN, BUDGET_TREE, modelById, money };
})();
