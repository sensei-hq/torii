/* Seiki · view-models.jsx — the model catalog, now editable.
   Add or edit a custom model + endpoint, enable/disable per tenant, mark
   local-capable, and refresh capabilities from the router. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, CardHead, Tag, CardFoot, Button, Table, ProviderDot, Pill, ExecBadge, DesktopOnlyNote, Switch, useEnv, PageHeader, EmptyState } = window.StrategosUI;
  const API = window.StrategosAPI;
  const { ROUTERS, PROVIDER_HUE, money, GATEWAY_REGION } = API;
  const { useState } = React;

  const { TIERS, TIER_LABEL, BLANK } = window.StrategosAPI.content.models;
  const PROVIDERS = Object.keys(PROVIDER_HUE);
  const ROUTE_IDS = ROUTERS.map((r) => r.id);

  function qualityTone(q) { return q >= 95 ? 'var(--success)' : q >= 88 ? 'var(--ink)' : 'var(--ink-mute)'; }

  function Field({ label, children }) {
    return <label className="flex flex-col gap-1"><span className="zs-eyebrow m-0">{label}</span>{children}</label>;
  }
  const inp = { border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', font: '500 13px var(--font-mono)', color: 'var(--ink)', padding: '7px 9px', width: '100%' };

  /* Reference implementation of the data seam: the catalog is fetched through
     StrategosAPI, never read from fixtures directly. In 'fixtures' mode this
     resolves from app/data.jsx; set StrategosAPI.config.mode = 'http' and the
     same call becomes GET {baseUrl}/models with no change to this view. */
  function ModelsView() {
    const [tier, setTier] = useState('all');
    const { meta } = useEnv();
    const { data: catalog, loading, error } = API.useResource(() => API.models.load(), []);
    const [models, setModels] = useState([]);
    React.useEffect(() => {
      if (catalog) setModels(catalog.map((m) => ({ ...m, enabled: true, verified: true })));
    }, [catalog]);
    const [editing, setEditing] = useState(null);   // id | 'new' | null
    const [draft, setDraft] = useState(BLANK);

    const rows = models.filter((m) => tier === 'all' || m.tier === tier);
    const maxLat = models.length ? Math.max(...models.map((m) => m.lat)) : 1;
    const localCount = models.filter((m) => m.localCap).length;

    const openNew = () => { setDraft(BLANK); setEditing('new'); };
    const openEdit = (m) => { setDraft({ ...m }); setEditing(m.id); };
    const save = () => {
      if (!draft.id.trim()) return;
      setModels((ms) => {
        const exists = ms.some((m) => m.id === editing);
        const rec = { ...draft, price: +draft.price, q: +draft.q, lat: +draft.lat, enabled: true, verified: editing !== 'new', custom: editing === 'new' || draft.custom };
        return exists ? ms.map((m) => (m.id === editing ? rec : m)) : [...ms, rec];
      });
      setEditing(null);
    };
    const remove = (id) => { setModels((ms) => ms.filter((m) => m.id !== id)); setEditing(null); };
    const toggleEnabled = (id) => setModels((ms) => ms.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)));
    const refresh = () => setModels((ms) => ms.map((m) => ({ ...m, verified: true })));
    // enable-scoping: a model enabled globally may be turned off per space/role (tighten-only)
    const SCOPES = [['all', 'All (tenant)'], ['space:leasing', 'Leasing Ops'], ['space:finance', 'Finance'], ['role:editor', 'Editor'], ['role:viewer', 'Viewer']];
    const [mscope, setMscope] = useState('all');
    const [scopedOff, setScopedOff] = useState({});   // scope → id → true (disabled here)
    const enabledFor = (m) => m.enabled && (mscope === 'all' ? true : !(scopedOff[mscope] || {})[m.id]);
    const toggleScoped = (m) => {
      if (mscope === 'all') { toggleEnabled(m.id); return; }
      if (!m.enabled) return;   // globally off — a scope can't enable it
      setScopedOff((o) => { const n = { ...o }; n[mscope] = { ...(n[mscope] || {}) }; n[mscope][m.id] = !n[mscope][m.id]; return n; });
    };

    if (!models.length) {
      return (
        <ViewPad wide className="rise">
          <PageHeader eyebrow="Models" title="Model catalog" subMax={780}
            sub="Every model your org can reach through the gateway — priced, measured, and routable." />
          <Card>
            <EmptyState kanji={error ? '空' : '静'}
              title={error ? 'The catalog did not answer.' : 'Still listening.'}
              sub={error ? String(error.message || error) : 'Reading the model catalog from the gateway.'}
              actions={loading ? null : <Button variant="secondary" size="sm" onClick={() => location.reload()}>Try again</Button>} />
          </Card>
        </ViewPad>
      );
    }

    return (
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Models" title="Model catalog" subMax={780}
          sub="Every model your org can reach through the gateway — priced, measured, and routable. Add a custom model or endpoint, enable per tenant, and mark which run on-device."
          actions={<>
            {!meta.web && <Pill kind="success"><Icon name="models" size={13} tone="success" /> {localCount} local-capable · 16-core · 24 GB</Pill>}
            <Button variant="secondary" onClick={refresh}><Icon name="refresh" size={14} tone="soft" /> Refresh from routers</Button>
            <Button variant="primary" onClick={openNew}><Icon name="plus" size={15} tone="paper" /> Add model</Button>
          </>} />

        <DesktopOnlyNote feature="Local models" />

        {editing && (
          <Card className="rise overflow-hidden mb-6 border border-accent" style={{ marginTop: meta.web ? '16px' : 0}}>
            <CardHead><span className="zs-eyebrow">{editing === 'new' ? 'Add a custom model' : 'Edit ' + editing}</span><button onClick={() => setEditing(null)} style={{ display: 'grid', placeItems: 'center' }}><Icon name="close" size={15} tone="mute" /></button></CardHead>
            <div className="p-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))'}}>
              <Field label="Model id · api_model_id"><input style={inp} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="my-model-v1" disabled={editing !== 'new'} /></Field>
              <Field label="Provider"><select style={inp} value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
              <Field label="Route · endpoint"><select style={inp} value={draft.route} onChange={(e) => setDraft({ ...draft, route: e.target.value })}>{ROUTE_IDS.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
              <Field label="Tier"><select style={inp} value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>{['frontier', 'balanced', 'fast', 'local'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
              <Field label="Price · $ / 1M"><input style={inp} type="number" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              <Field label="Quality · 0–100"><input style={inp} type="number" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} /></Field>
              <Field label="Latency · ms"><input style={inp} type="number" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} /></Field>
              <Field label="Context"><input style={inp} value={draft.ctx} onChange={(e) => setDraft({ ...draft, ctx: e.target.value })} placeholder="128K" /></Field>
            </div>
            <div className="flex items-center gap-3 pt-0 px-6 pb-6">
              <span className="flex items-center gap-2 flex-1"><Icon name="models" size={15} tone={draft.localCap ? 'success' : 'mute'} /><span className="text-sm text-ink">Local-capable — can run on a member’s device</span><Switch on={!!draft.localCap} onClick={() => setDraft({ ...draft, localCap: !draft.localCap })} label="Local-capable" /></span>
              {editing !== 'new' && <Button variant="ghost" size="sm" onClick={() => remove(editing)}><Icon name="trash" size={13} tone="warning" /> Remove</Button>}
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={save}><Icon name="check" size={13} tone="paper" /> {editing === 'new' ? 'Add model' : 'Save'}</Button>
            </div>
          </Card>
        )}

        <div className="tabs mb-6" style={{ marginTop: (meta.web && !editing) ? '16px' : 0 }}>
          {TIERS.map((t) => <button key={t} className={'tab' + (tier === t ? ' on' : '')} onClick={() => setTier(t)}>{TIER_LABEL[t]}</button>)}
          <span className="flex-1" />
          <span className="zs-eyebrow mr-0.5">Enable for</span>
          {SCOPES.map(([id, lab]) => { const on = mscope === id; return <button key={id} onClick={() => setMscope(id)} style={{ padding: '3px 9px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 500, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--paper-edge)'), background: on ? 'var(--ink)' : 'var(--paper)', color: on ? 'var(--on-primary)' : 'var(--ink-soft)' }}>{lab}</button>; })}
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table min={820}>
              <thead><tr>
                <th>Model</th><th>Route</th><th>Tier</th>
                <th className="num">$ / 1M</th><th className="num">Quality</th><th>Latency</th><th className="num">Context</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="clickable" style={{ opacity: m.enabled ? 1 : 0.5 }} onClick={() => openEdit(m)}>
                    <td>
                      <span className="flex items-center gap-2">
                        <ProviderDot provider={m.provider} size={8} />
                        <span className="font-mono text-sm font-semibold text-ink">{m.id}</span>
                        {m.tag && <Tag>{m.tag}</Tag>}
                        {m.custom && <span className="dtag">custom</span>}
                      </span>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2, marginLeft: 16 }}>{m.provider}</div>
                    </td>
                    <td data-th="Route">
                      <div className="flex items-center gap-2 text-ink-soft"><Icon name="router" size={13} tone="mute" />{m.route}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <ExecBadge local={!!m.localCap && !meta.web} region={GATEWAY_REGION} />
                        {m.localCap && m.route !== 'Ollama' && <Tag><Icon name="models" size={11} tone="success" />local-capable</Tag>}
                      </div>
                    </td>
                    <td data-th="Tier"><span style={{ textTransform: 'capitalize' }}>{m.tier}</span></td>
                    <td className="num" data-th="$ / 1M" style={{ color: m.price === 0 ? 'var(--success)' : 'var(--ink)' }}>{m.price === 0 ? 'free' : money(m.price)}</td>
                    <td className="num" data-th="Quality" style={{ color: qualityTone(m.q), fontWeight: 600 }}>{m.q}</td>
                    <td data-th="Latency">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: (m.lat / maxLat) * 100 + '%', background: m.lat > 2000 ? 'var(--warning)' : 'var(--ink-mute)' }} /></div>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 42, textAlign: 'right' }}>{(m.lat / 1000).toFixed(1)}s</span>
                      </div>
                    </td>
                    <td className="num" data-th="Context" style={{ color: 'var(--ink-soft)' }}>{m.ctx}</td>
                    <td data-th="Status" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {m.verified ? <span className="status text-success" title="Capabilities verified from the router"><span className="dot" style={{ background: 'var(--success)' }} />verified</span>
                          : <span className="status text-warning" title="Not yet verified — refresh from router"><span className="dot" style={{ background: 'var(--warning)' }} />unverified</span>}
                        {mscope !== 'all' && !m.enabled
                          ? <span className="dtag" title="Disabled tenant-wide"><Icon name="lock" size={11} tone="mute" /> off</span>
                          : <Switch on={enabledFor(m)} onClick={() => toggleScoped(m)} label={'Enable ' + m.id} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <CardFoot dashed className="gap-6 font-mono">
            <span>{rows.length} of {models.length} models · {models.filter((m) => m.enabled).length} enabled</span>
            <span>local-capable · <b style={{ color: 'var(--success)' }}>{localCount}</b></span>
            <span>default · <b style={{ color: 'var(--ink)' }}>sonnet-4.6</b></span>
            <span className="ml-auto">click a row to edit · pricing & capabilities are per-tenant</span>
          </CardFoot>
        </Card>
      </ViewPad>
    );
  }

  window.ModelsView = ModelsView;
})();
