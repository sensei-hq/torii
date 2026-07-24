/* Strategos Console · view-models.jsx — the model catalog. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ProviderDot, Pill, ExecBadge, DesktopOnlyNote, useEnv, PageHeader } = window.StrategosUI;
  const { MODELS, money, GATEWAY_REGION } = window.StrategosData;
  const { useState } = React;

  const TIERS = ['all', 'frontier', 'balanced', 'fast', 'local'];
  const TIER_LABEL = { all: 'All tiers', frontier: 'Frontier', balanced: 'Balanced', fast: 'Fast', local: 'Local' };

  function qualityTone(q) { return q >= 95 ? 'var(--success)' : q >= 88 ? 'var(--ink)' : 'var(--ink-mute)'; }

  function ModelsView() {
    const [tier, setTier] = useState('all');
    const { meta } = useEnv();
    const rows = MODELS.filter((m) => tier === 'all' || m.tier === tier);
    const maxLat = Math.max(...MODELS.map((m) => m.lat));
    const localCount = MODELS.filter((m) => m.localCap).length;

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Models" title="Eight models, one address"
          sub="Every model your org can reach through the gateway — across six routers — priced, measured, and ready to route. Filter by tier."
          actions={!meta.web && (
            <span className="pill success">
              <Icon name="models" size={13} tone="success" /> This device · {localCount} local-capable · 16-core · 24 GB
            </span>
          )} />

        <DesktopOnlyNote feature="Local models" />

        <div className="tabs" style={{ marginBottom: 'var(--space-5)', marginTop: meta.web ? 'var(--space-4)' : 0 }}>
          {TIERS.map((t) => (
            <button key={t} className={'tab' + (tier === t ? ' on' : '')} onClick={() => setTier(t)}>{TIER_LABEL[t]}</button>
          ))}
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl tbl-stack" style={{ '--tbl-min': '720px' }}>
              <thead><tr>
                <th>Model</th><th>Route</th><th>Tier</th>
                <th className="num">$ / 1M</th><th className="num">Quality</th><th>Latency</th><th className="num">Context</th>
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="clickable">
                    <td>
                      <span className="flex items-center gap-2">
                        <ProviderDot provider={m.provider} size={8} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                        {m.tag && <span className="tag">{m.tag}</span>}
                      </span>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2, marginLeft: 16 }}>{m.provider}</div>
                    </td>
                    <td data-th="Route">
                      <div className="flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}><Icon name="router" size={13} tone="mute" />{m.route}</div>
                      <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                        <ExecBadge local={m.route === 'Ollama' && !meta.web} region={GATEWAY_REGION} />
                        {m.localCap && m.route !== 'Ollama' && <span className="tag"><Icon name="models" size={11} tone="success" />local-capable</span>}
                      </div>
                    </td>
                    <td data-th="Tier"><span style={{ textTransform: 'capitalize' }}>{m.tier}</span></td>
                    <td className="num" data-th="$ / 1M" style={{ color: m.price === 0 ? 'var(--success)' : 'var(--ink)' }}>{m.price === 0 ? 'free' : money(m.price)}</td>
                    <td className="num" data-th="Quality" style={{ color: qualityTone(m.q), fontWeight: 600 }}>{m.q}</td>
                    <td data-th="Latency">
                      <div className="flex items-center gap-2" style={{ minWidth: 120 }}>
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: (m.lat / maxLat) * 100 + '%', background: m.lat > 2000 ? 'var(--warning)' : 'var(--ink-mute)' }} /></div>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', width: 42, textAlign: 'right' }}>{(m.lat / 1000).toFixed(1)}s</span>
                      </div>
                    </td>
                    <td className="num" data-th="Context" style={{ color: 'var(--ink-soft)' }}>{m.ctx}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed" style={{ gap: 'var(--space-5)', fontFamily: 'var(--font-mono)' }}>
            <span>{rows.length} of {MODELS.length} models</span>
            <span>cheapest · <b style={{ color: 'var(--success)' }}>free (2 local)</b></span>
            <span>local-capable on this device · <b style={{ color: 'var(--success)' }}>{MODELS.filter((m) => m.localCap).length}</b></span>
            <span>default · <b style={{ color: 'var(--ink)' }}>sonnet-4.6</b></span>
          </div>
        </div>
      </div>
    );
  }

  window.ModelsView = ModelsView;
})();
