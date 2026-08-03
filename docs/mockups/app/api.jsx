/* ═══════════════════════════════════════════════════════════════════
   STRATEGOS · DATA ACCESS LAYER
   The single seam between the UI and its data. Artboards never read
   fixtures directly — they go through window.StrategosAPI.

   Today:   mode 'fixtures' → app/data.jsx (in-memory, synchronous)
   Wire-up: StrategosAPI.config.mode = 'http'
            StrategosAPI.config.baseUrl = 'https://gateway.example/api/v1'
            StrategosAPI.config.token = '…'            // Bearer
   …then every `await API.<resource>.load()` hits the endpoint in
   API.endpoints instead of the fixture. Nothing else changes.

   Two call styles per resource:
     API.MODELS              — synchronous fixture read (prototype views)
     await API.models.load()  — async; fixture or HTTP depending on mode
     API.models.path          — the endpoint this resource maps to
   Use the async form + useResource() for anything that will be live.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  const D = window.StrategosData;

  const config = {
    mode: 'fixtures',            // 'fixtures' | 'http'
    baseUrl: '/api/v1',
    token: null,
    latency: 0,                  // ms of simulated delay for fixture mode
  };

  /* resource → REST endpoint. The contract a backend must satisfy. */
  const endpoints = {
    models: '/models',
    routers: '/routers',
    fallbackChain: '/routing/fallback-chain',
    budgetTree: '/budgets/tree',
    tools: '/tools',
    promptTemplates: '/prompt-templates',
    tiers: '/workspaces/tiers',
    workspaces: '/workspaces',
    collections: '/workspaces/:wsId/collections',
    documents: '/workspaces/:wsId/documents',
    workflows: '/workflows',
  };

  function url(path, params) {
    let p = path.replace(/:([a-zA-Z]+)/g, (_, k) => encodeURIComponent((params || {})[k] ?? ''));
    return config.baseUrl.replace(/\/$/, '') + p;
  }

  async function request(path, { params, query, method = 'GET', body } = {}) {
    const qs = query ? '?' + new URLSearchParams(query) : '';
    const res = await fetch(url(path, params) + qs, {
      method,
      headers: Object.assign(
        { Accept: 'application/json' },
        body ? { 'Content-Type': 'application/json' } : null,
        config.token ? { Authorization: 'Bearer ' + config.token } : null
      ),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' — ' + path);
    return res.json();
  }

  const wait = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : null);

  /* A resource: sync fixture read + async load() that respects config.mode. */
  function resource(name, fixture) {
    return {
      path: endpoints[name],
      read: fixture,                                   // sync, fixtures only
      async load(args) {
        if (config.mode === 'http') return request(endpoints[name], { params: args, query: args && args.query });
        await wait(config.latency);
        return fixture(args);
      },
    };
  }

  const api = {
    config,
    endpoints,
    request,

    /* ── resources ─────────────────────────────────────────────── */
    models: resource('models', () => D.MODELS),
    routers: resource('routers', () => D.ROUTERS),
    fallbackChain: resource('fallbackChain', () => D.FALLBACK_CHAIN),
    budgetTree: resource('budgetTree', () => D.BUDGET_TREE),
    tools: resource('tools', () => D.TOOLS),
    promptTemplates: resource('promptTemplates', () => D.PROMPT_TEMPLATES),
    tiers: resource('tiers', () => D.TIERS),
    workspaces: resource('workspaces', () => D.WORKSPACES),
    collections: resource('collections', (a) => D.WS_COLLECTIONS[(a && a.wsId) || ''] || []),
    documents: resource('documents', (a) => D.WS_DOCS[(a && a.wsId) || ''] || []),
    workflows: resource('workflows', (a) => (a && a.wsId ? D.workflowsFor(a.wsId) : D.WORKFLOWS)),
  };

  /* Mirror every fixture export (MODELS, money, execOf, wsById …) so views
     read one module only. Swap a value for a resource above when it goes live. */
  Object.keys(D).forEach((k) => {
    if (k in api) return;
    Object.defineProperty(api, k, { get: () => D[k], enumerable: true });
  });

  /* useResource: the hook to use for anything that will be a real call.
     const { data, loading, error, reload } = useResource(() => API.models.load(), []); */
  function useResource(loader, deps = [], initial = null) {
    const [state, setState] = React.useState({ data: initial, loading: true, error: null });
    const [nonce, setNonce] = React.useState(0);
    React.useEffect(() => {
      let live = true;
      setState((s) => ({ data: s.data, loading: true, error: null }));
      Promise.resolve()
        .then(loader)
        .then((data) => { if (live) setState({ data, loading: false, error: null }); })
        .catch((error) => { if (live) setState({ data: initial, loading: false, error }); });
      return () => { live = false; };
    }, deps.concat(nonce)); // eslint-disable-line react-hooks/exhaustive-deps
    return Object.assign({}, state, { reload: () => setNonce((n) => n + 1) });
  }

  api.useResource = useResource;
  /* Copy + per-view fixture data (app/content.js), reached through the same
     seam: API.content.<view>.NAME. Move a namespace into a resource above
     when it becomes a real endpoint. */
  Object.defineProperty(api, 'content', { get: () => window.StrategosContent || {} });
  window.StrategosAPI = api;
})();
