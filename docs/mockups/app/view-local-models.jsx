/* Torii · view-local-models.jsx (member · desktop)
   Browse, download, update and remove on-device models (GGUF / ONNX),
   set the local default, and watch storage. Web clients see the
   desktop-only note; everything runs on the member's own hardware. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Meter, Pill, useEnv, DesktopOnlyNote, PageHeader, ProviderDot } = window.StrategosUI;
  const { money } = window.StrategosData;
  const { useState, useRef } = React;

  const HW = { chip: 'Apple M3 Pro', ram: '36 GB', ramGB: 36, accel: 'Metal · 18-core GPU', disk: 512 };
  // rough working-set estimate: weights (≈ model size) + KV cache headroom
  function fitOf(m) {
    const need = +(m.size * 1.25 + (parseInt(m.ctx) >= 256 ? 3 : 1.5)).toFixed(1);
    const ratio = need / HW.ramGB;
    const tier = ratio < 0.45 ? 'good' : ratio < 0.75 ? 'tight' : 'over';
    return { need, tier };
  }
  const FIT = { good: ['fits comfortably', 'var(--success)'], tight: ['fits — tight', 'var(--warning)'], over: ['exceeds memory', 'var(--accent)'] };
  const REGISTRY = [
    { id: 'gemma-4-9b',          fmt: 'GGUF', quant: 'Q4_K_M', size: 5.4, ctx: '128K', q: 78, installed: true,  def: true,  update: false },
    { id: 'mistral-small-free',  fmt: 'GGUF', quant: 'Q5_K_M', size: 4.8, ctx: '128K', q: 80, installed: true,  def: false, update: true  },
    { id: 'qwen-3-8b',           fmt: 'GGUF', quant: 'Q4_K_M', size: 5.1, ctx: '256K', q: 82, installed: false, allowed: true },
    { id: 'phi-4-mini',          fmt: 'ONNX', quant: 'int4',   size: 2.6, ctx: '64K',  q: 74, installed: false, allowed: true },
    { id: 'llama-4-8b',          fmt: 'GGUF', quant: 'Q4_K_M', size: 5.0, ctx: '128K', q: 81, installed: false, allowed: false, reason: 'not in the admin allow-list' },
  ];

  function LocalModelsView() {
    const { meta } = useEnv();
    const [reg, setReg] = useState(REGISTRY);
    const [prog, setProg] = useState({});   // id → 0..100 while downloading
    const timers = useRef({});

    const download = (id) => {
      setProg((p) => ({ ...p, [id]: 2 }));
      clearInterval(timers.current[id]);
      timers.current[id] = setInterval(() => {
        setProg((p) => {
          const v = (p[id] || 0) + 11 + Math.random() * 9;
          if (v >= 100) {
            clearInterval(timers.current[id]);
            setReg((r) => r.map((m) => (m.id === id ? { ...m, installed: true } : m)));
            const { [id]: _, ...rest } = p; return rest;
          }
          return { ...p, [id]: v };
        });
      }, 260);
    };
    const remove = (id) => setReg((r) => r.map((m) => (m.id === id ? { ...m, installed: false, def: false } : m)));
    const setDefault = (id) => setReg((r) => r.map((m) => ({ ...m, def: m.id === id })));
    const applyUpdate = (id) => setReg((r) => r.map((m) => (m.id === id ? { ...m, update: false } : m)));

    const installed = reg.filter((m) => m.installed);
    const available = reg.filter((m) => !m.installed);
    const usedModels = installed.reduce((s, m) => s + m.size, 0);
    const used = +(96 + usedModels).toFixed(1);   // 96 GB baseline system + models

    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Device" title="Local models" subMax={640}
          sub="Models that run entirely on this machine — no call leaves your device, and they keep working offline. You may install any model on the admin allow-list."
          actions={<Pill icon={meta.web ? 'globe' : 'models'} kind={meta.web ? undefined : 'success'}>{meta.web ? 'Web · no local models' : installed.length + ' on device'}</Pill>} />

        <DesktopOnlyNote feature="Local models" />

        {meta.web ? (
          <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center', marginTop: 'var(--space-5)' }}>
            <span className="glyph" style={{ width: 48, height: 48, margin: '0 auto var(--space-4)' }}><Icon name="globe" size={24} tone="mute" /></span>
            <div className="zs-h3" style={{ marginBottom: 6 }}>Open Torii on your desktop</div>
            <p className="zs-body-sm" style={{ maxWidth: 420, margin: '0 auto' }}>On-device models need Torii’s embedded runtime. In a browser, every call runs via the gateway.</p>
          </div>
        ) : (
          <React.Fragment>
            {/* device + storage */}
            <div className="grid-half" style={{ marginTop: 'var(--space-5)' }}>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-hd"><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">This device</span></span><span className="exec exec-local"><Icon name="models" size={12} tone="success" />runs on-device</span></div>
                <div style={{ padding: 'var(--space-5)' }}>
                  <div className="grid grid-cols-2 gap-4">
                    {[['Chip', HW.chip], ['Memory', HW.ram], ['Accelerator', HW.accel], ['Runtime', 'llama.cpp · in-process']].map(([k, v]) => (
                      <div key={k}><div className="zs-eyebrow" style={{ marginBottom: 3 }}>{k}</div><div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{v}</div></div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-hd"><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Model storage</span></span><button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="trash" size={13} tone="soft" /> Free up space</button></div>
                <div style={{ padding: 'var(--space-5)' }}>
                  <Meter label="Disk used" value={used} max={HW.disk} display={used + ' / ' + HW.disk + ' GB'} tone={used / HW.disk > 0.85 ? 'warning' : 'accent'} hint={usedModels.toFixed(1) + ' GB across ' + installed.length + ' models · rest is system'} />
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-4)' }}>garbage-collects unused quant layers weekly · reuses your ~/.ollama cache when present</div>
                </div>
              </div>
            </div>

            {/* installed */}
            <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="check" size={15} tone="success" /><span className="zs-eyebrow">Installed</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{installed.length} models · {usedModels.toFixed(1)} GB</span></div>
              {installed.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <ProviderDot provider="local" size={9} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2">
                      <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                      {m.def && <span className="pill accent"><Icon name="pin" size={12} tone="accent" />local default</span>}
                      {m.update && <span className="dtag warn">update available</span>}
                    </div>
                    <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{m.fmt} · {m.quant} · {m.size} GB · {m.ctx} ctx · q{m.q}</div>
                  </div>
                  {m.update && <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => applyUpdate(m.id)}><Icon name="refresh" size={13} tone="soft" /> Update</button>}
                  {!m.def && <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setDefault(m.id)}><Icon name="pin" size={13} tone="soft" /> Set default</button>}
                  <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => remove(m.id)} title="Remove from device"><Icon name="trash" size={13} tone="mute" /></button>
                </div>
              ))}
            </div>

            {/* available */}
            <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Available to download</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>in-process runtime · GGUF / ONNX</span></div>
              {available.map((m, i) => {
                const p = prog[m.id];
                const downloading = p != null;
                return (
                  <div key={m.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: m.allowed === false ? 0.6 : 1 }}>
                    <ProviderDot provider="local" size={9} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                        {m.allowed === false && <span className="dtag warn">blocked</span>}
                      </div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{m.allowed === false ? m.reason : m.fmt + ' · ' + m.quant + ' · ' + m.size + ' GB · ' + m.ctx + ' ctx · q' + m.q}</div>
                      {m.allowed !== false && (() => { const f = fitOf(m); return (
                        <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                          <span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: FIT[f.tier][1] }} />
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: FIT[f.tier][1] }}>{FIT[f.tier][0]}</span>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>~{f.need} GB / {HW.ramGB} GB</span>
                        </div>
                      ); })()}
                      {downloading && (
                        <div style={{ marginTop: 8, height: 5, borderRadius: 'var(--radius-full)', background: 'var(--paper-mute)', overflow: 'hidden' }}>
                          <div style={{ width: Math.min(100, p) + '%', height: '100%', background: 'var(--accent)', transition: 'width .2s linear' }} />
                        </div>
                      )}
                    </div>
                    {m.allowed === false ? <Icon name="lock" size={16} tone="mute" />
                      : downloading ? <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', width: 88, textAlign: 'right' }}>{Math.round(p)}% · pulling</span>
                      : fitOf(m).tier === 'over'
                        ? <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => download(m.id)} title="Exceeds this device's memory — may be slow or fail" style={{ color: 'var(--accent)' }}><Icon name="flag" size={13} tone="warning" /> Download anyway</button>
                        : <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => download(m.id)}><Icon name="upload" size={13} tone="soft" /> Download</button>}
                  </div>
                );
              })}
              <div className="card-foot dashed"><Icon name="lock" size={14} tone="mute" /><span>You can install any model your administrator allows. The <b>fit</b> signal estimates working-set memory (weights + KV cache) against this device — models over budget warn before download. Blocked models need an admin to add them to the allow-list.</span></div>
            </div>
          </React.Fragment>
        )}
      </div>
    );
  }

  window.LocalModelsView = LocalModelsView;
})();
