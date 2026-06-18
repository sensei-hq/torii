/* Strategos Console · view-models.jsx — the model catalog. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ProviderDot, Pill } = window.StrategosUI;
  const { MODELS, money } = window.StrategosData;
  const { useState } = React;

  const TIERS = ['all', 'frontier', 'balanced', 'fast', 'local'];
  const TIER_LABEL = { all: 'All tiers', frontier: 'Frontier', balanced: 'Balanced', fast: 'Fast', local: 'Local' };

  function qualityTone(q) { return q >= 95 ? 'var(--success)' : q >= 88 ? 'var(--ink)' : 'var(--ink-mute)'; }

  function ModelsView() {
    const [tier, setTier] = useState('all');
    const rows = MODELS.filter((m) => tier === 'all' || m.tier === tier);
    const maxLat = Math.max(...MODELS.map((m) => m.lat));

    return (
      <div className="view-pad wide rise">
        <div className="page-hd">
          <div>
            <div className="zs-eyebrow">Models</div>
            <h1 className="zs-h1" style={{ marginTop: 4 }}>Eight models, one address</h1>
            <p className="zs-body" style={{ marginTop: 6, maxWidth: 620 }}>Every model your org can reach through the gateway — across six routers — priced, measured, and ready to route. Filter by tier.</p>
          </div>
        </div>

        <div className="tabs" style={{ marginBottom: 'var(--space-5)' }}>
          {TIERS.map((t) => (
            <button key={t} className={'tab' + (tier === t ? ' on' : '')} onClick={() => setTier(t)}>{TIER_LABEL[t]}</button>
          ))}
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 720 }}>
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
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                        {m.tag && <span className="tag">{m.tag}</span>}
                      </span>
                      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2, marginLeft: 16 }}>{m.provider}</div>
                    </td>
                    <td><span className="flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}><Icon name="router" size={13} tone="mute" />{m.route}</span></td>
                    <td><span style={{ textTransform: 'capitalize' }}>{m.tier}</span></td>
                    <td className="num" style={{ color: m.price === 0 ? 'var(--success)' : 'var(--ink)' }}>{m.price === 0 ? 'free' : money(m.price)}</td>
                    <td className="num" style={{ color: qualityTone(m.q), fontWeight: 600 }}>{m.q}</td>
                    <td>
                      <div className="flex items-center gap-2" style={{ minWidth: 120 }}>
                        <div className="meter" style={{ flex: 1 }}><i style={{ width: (m.lat / maxLat) * 100 + '%', background: m.lat > 2000 ? 'var(--warning)' : 'var(--ink-mute)' }} /></div>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)', width: 42, textAlign: 'right' }}>{(m.lat / 1000).toFixed(1)}s</span>
                      </div>
                    </td>
                    <td className="num" style={{ color: 'var(--ink-soft)' }}>{m.ctx}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot dashed" style={{ gap: 'var(--space-5)', fontFamily: 'var(--font-mono)' }}>
            <span>{rows.length} of {MODELS.length} models</span>
            <span>cheapest · <b style={{ color: 'var(--success)' }}>free (2 local)</b></span>
            <span>default · <b style={{ color: 'var(--ink)' }}>sonnet-4.6</b></span>
          </div>
        </div>
      </div>
    );
  }

  window.ModelsView = ModelsView;
})();
