/* Torii · view-local-models.jsx (member · desktop)
   Browse, download, update and remove on-device models (GGUF / ONNX),
   set the local default, and watch storage. Web clients see the
   desktop-only note; everything runs on the member's own hardware. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ViewPad, Card, Half, CardHead, CardFoot, Button, Meter, Pill, useEnv, DesktopOnlyNote, PageHeader, ProviderDot } = window.StrategosUI;
  const { money } = window.StrategosAPI;
  const { useState, useRef } = React;

  const HW = { chip: 'Apple M3 Pro', ram: '36 GB', ramGB: 36, accel: 'Metal · 18-core GPU', disk: 512 };
  // rough working-set estimate: weights (≈ model size) + KV cache headroom
  function fitOf(m) {
    const need = +(m.size * 1.25 + (parseInt(m.ctx) >= 256 ? 3 : 1.5)).toFixed(1);
    const ratio = need / HW.ramGB;
    const tier = ratio < 0.45 ? 'good' : ratio < 0.75 ? 'tight' : 'over';
    return { need, tier };
  }
  const { FIT, REGISTRY } = window.StrategosAPI.content.localModels;

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
      <ViewPad wide className="rise">
        <PageHeader eyebrow="Device" title="Local models" subMax={640}
          sub="Models that run entirely on this machine — no call leaves your device, and they keep working offline. You may install any model on the admin allow-list."
          actions={<Pill icon={meta.web ? 'globe' : 'models'} kind={meta.web ? undefined : 'success'}>{meta.web ? 'Web · no local models' : installed.length + ' on device'}</Pill>} />

        <DesktopOnlyNote feature="Local models" />

        {meta.web ? (
          <Card className="p-12 text-center mt-6">
            <span className="glyph w-[48px] h-[48px] mt-0 mx-auto mb-4"><Icon name="globe" size={24} tone="mute" /></span>
            <div className="zs-h3 mb-1.5">Open Torii on your desktop</div>
            <p className="zs-body-sm max-w-[420px] my-0 mx-auto">On-device models need Torii’s embedded runtime. In a browser, every call runs via the gateway.</p>
          </Card>
        ) : (
          <React.Fragment>
            {/* device + storage */}
            <Half className="mt-6">
              <Card className="overflow-hidden">
                <CardHead><span className="flex items-center gap-2"><Icon name="models" size={15} tone="soft" /><span className="zs-eyebrow">This device</span></span><span className="exec exec-local"><Icon name="models" size={12} tone="success" />runs on-device</span></CardHead>
                <div className="p-6">
                  <div className="grid grid-cols-2 gap-4">
                    {[['Chip', HW.chip], ['Memory', HW.ram], ['Accelerator', HW.accel], ['Runtime', 'llama.cpp · in-process']].map(([k, v]) => (
                      <div key={k}><div className="zs-eyebrow mb-1">{k}</div><div className="text-sm font-semibold text-ink">{v}</div></div>
                    ))}
                  </div>
                </div>
              </Card>
              <Card className="overflow-hidden">
                <CardHead><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Model storage</span></span><Button variant="ghost" size="sm"><Icon name="trash" size={13} tone="soft" /> Free up space</Button></CardHead>
                <div className="p-6">
                  <Meter label="Disk used" value={used} max={HW.disk} display={used + ' / ' + HW.disk + ' GB'} tone={used / HW.disk > 0.85 ? 'warning' : 'accent'} hint={usedModels.toFixed(1) + ' GB across ' + installed.length + ' models · rest is system'} />
                  <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: '16px' }}>garbage-collects unused quant layers weekly · reuses your ~/.ollama cache when present</div>
                </div>
              </Card>
            </Half>

            {/* installed */}
            <Card className="overflow-hidden mt-6">
              <CardHead><span className="flex items-center gap-2"><Icon name="check" size={15} tone="success" /><span className="zs-eyebrow">Installed</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{installed.length} models · {usedModels.toFixed(1)} GB</span></CardHead>
              {installed.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                  <ProviderDot provider="local" size={9} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                      {m.def && <Pill kind="accent"><Icon name="pin" size={12} tone="accent" />local default</Pill>}
                      {m.update && <span className="dtag warn">update available</span>}
                    </div>
                    <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{m.fmt} · {m.quant} · {m.size} GB · {m.ctx} ctx · q{m.q}</div>
                  </div>
                  {m.update && <Button variant="secondary" size="sm" onClick={() => applyUpdate(m.id)}><Icon name="refresh" size={13} tone="soft" /> Update</Button>}
                  {!m.def && <Button variant="ghost" size="sm" onClick={() => setDefault(m.id)}><Icon name="pin" size={13} tone="soft" /> Set default</Button>}
                  <Button variant="ghost" size="sm" onClick={() => remove(m.id)} title="Remove from device"><Icon name="trash" size={13} tone="mute" /></Button>
                </div>
              ))}
            </Card>

            {/* available */}
            <Card className="overflow-hidden mt-6">
              <CardHead><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Available to download</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>in-process runtime · GGUF / ONNX</span></CardHead>
              {available.map((m, i) => {
                const p = prog[m.id];
                const downloading = p != null;
                return (
                  <div key={m.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none', opacity: m.allowed === false ? 0.6 : 1 }}>
                    <ProviderDot provider="local" size={9} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="mono" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{m.id}</span>
                        {m.allowed === false && <span className="dtag warn">blocked</span>}
                      </div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{m.allowed === false ? m.reason : m.fmt + ' · ' + m.quant + ' · ' + m.size + ' GB · ' + m.ctx + ' ctx · q' + m.q}</div>
                      {m.allowed !== false && (() => { const f = fitOf(m); return (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: FIT[f.tier][1] }} />
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: FIT[f.tier][1] }}>{FIT[f.tier][0]}</span>
                          <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>~{f.need} GB / {HW.ramGB} GB</span>
                        </div>
                      ); })()}
                      {downloading && (
                        <div className="mt-2 h-[5px] rounded-full bg-paper-mute overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: Math.min(100, p) + '%', transition: 'width .2s linear' }} />
                        </div>
                      )}
                    </div>
                    {m.allowed === false ? <Icon name="lock" size={16} tone="mute" />
                      : downloading ? <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', width: 88, textAlign: 'right' }}>{Math.round(p)}% · pulling</span>
                      : fitOf(m).tier === 'over'
                        ? <Button className="text-accent" variant="ghost" size="sm" onClick={() => download(m.id)} title="Exceeds this device's memory — may be slow or fail"><Icon name="flag" size={13} tone="warning" /> Download anyway</Button>
                        : <Button variant="secondary" size="sm" onClick={() => download(m.id)}><Icon name="upload" size={13} tone="soft" /> Download</Button>}
                  </div>
                );
              })}
              <CardFoot dashed><Icon name="lock" size={14} tone="mute" /><span>You can install any model your administrator allows. The <b>fit</b> signal estimates working-set memory (weights + KV cache) against this device — models over budget warn before download. Blocked models need an admin to add them to the allow-list.</span></CardFoot>
            </Card>
          </React.Fragment>
        )}
      </ViewPad>
    );
  }

  window.LocalModelsView = LocalModelsView;
})();
