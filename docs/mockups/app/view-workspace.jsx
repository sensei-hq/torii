/* Torii · view-workspace.jsx (member home)
   Task-focused. Pick up recent work, jump into a space, start something new. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, ViewPad, CardHead, CardFoot, Tag, Button, Pill, DevicePill, OfflineBanner, Meter, ProviderDot, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { modelById, money, WS_DOCS, PROMPT_TEMPLATES } = window.StrategosAPI;

  const { ING_META, MY_MODELS, RECENT, CLF_LABEL, TIER_LABEL } = window.StrategosAPI.content.workspace;

  function Avatars({ list }) {
    return <div className="ava-row">{list.slice(0, 4).map((a, i) => <span key={i} className="ava">{a}</span>)}</div>;
  }

  // First-run orientation — “here’s your lane”: the workspace + classification
  // you’re in, the models you can use, and the ceiling that workspace operates
  // under (the budget cascades down to it).
  function LaneCard({ onDismiss, firstRun, ws }) {
    const cascade = ws.budget;
    const ceiling = cascade[cascade.length - 1];
    const parent = cascade.length > 1 ? cascade[cascade.length - 2] : null;
    const pct = Math.round((ceiling.spent / ceiling.cap) * 100);
    const tone = pct >= 100 ? 'danger' : pct >= 85 ? 'warning' : 'accent';
    const tierLabel = TIER_LABEL[ws.tier] || ws.tier;
    return (
      <Card className="lane rise p-6 border border-[oklch(0.58_0.15_35_/_0.25)] bg-accent-soft mb-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="glyph accent w-[30px] h-[30px]"><Icon name="role" size={16} tone="accent" /></span>
          <div className="flex-1 min-w-0">
            <div className="zs-eyebrow text-accent">Your lane</div>
            <div className="text-sm text-ink-soft">{firstRun ? 'Welcome — here’s where you operate and what you can use.' : 'Where you operate and what you can use.'}</div>
          </div>
          <WorkspaceChip ws={ws} />
          <button className="icon-btn" onClick={onDismiss} title="Hide" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 'var(--radius)' }}><Icon name="close" size={16} tone="mute" /></button>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="border-r border-[oklch(0.58_0.15_35_/_0.18)] pr-6">
            <div className="zs-eyebrow mb-2">Workspace</div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base font-semibold text-ink">{ws.name}</span>
              <span className={'clf clf-' + ws.cls}><span className="d" />{CLF_LABEL[ws.cls]}</span>
            </div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{tierLabel} · {ws.people} {ws.people === 1 ? 'person' : 'people'} · Member</div>
          </div>
          <div className="border-r border-[oklch(0.58_0.15_35_/_0.18)] pr-6">
            <div className="zs-eyebrow mb-2">Models you can use</div>
            <div className="flex flex-col gap-2">
              {MY_MODELS.map((x) => {
                const mm = modelById(x.id) || {};
                return (
                  <span key={x.id} className="flex items-center gap-2">
                    <ProviderDot provider={mm.provider} size={7} />
                    <span className="font-mono text-xs text-ink">{x.id}</span>
                    <span className="font-mono text-xs text-ink-faint">{x.note}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <Meter label={'Ceiling · ' + ceiling.name.replace(/^You · /, '')} value={ceiling.spent} max={ceiling.cap} tone={tone}
              display={money(ceiling.spent, 0) + ' / ' + money(ceiling.cap, 0)} hint={(parent ? 'cascades from ' + parent.name + ' · ' : '') + pct + '% used'} />
            <div className="text-xs text-ink-soft leading-[1.5] mt-3">The gateway auto-routes the best model under this ceiling — and always shows you where each answer ran.</div>
          </div>
        </div>
        {firstRun && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[oklch(0.58_0.15_35_/_0.18)]">
            <span className="mono" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>Caps are set by your admin · budget cascades down the org tree</span>
            <Button variant="primary" size="sm" onClick={onDismiss}>Got it</Button>
          </div>
        )}
      </Card>
    );
  }

  function WorkspaceView({ go, name = 'Mara' }) {
    const { ws, id: wsId, set: setWs, byTier } = useWorkspace();
    const [laneOpen, setLaneOpen] = React.useState(() => { try { return localStorage.getItem('zs-oriented') !== '1'; } catch (e) { return true; } });
    const [firstRun] = React.useState(laneOpen);
    function dismissLane() { try { localStorage.setItem('zs-oriented', '1'); } catch (e) {} setLaneOpen(false); }
    return (
      <ViewPad wide className="rise">
        <PageHeader className="border-0 bg-transparent cursor-pointer text-accent font-semibold p-0" eyebrow="Wed · 22 Apr" title={'Good morning, ' + name + '.'} subKind="sm"
          sub={<>Working in <button onClick={() => window.StrategosWorkspace.openSwitcher()} style={{ font: 'inherit'}}>{ws.name} ↓</button></>}
          actions={<>
            {!laneOpen && <Button variant="ghost" onClick={() => setLaneOpen(true)}><Icon name="role" size={15} tone="soft" /> Your lane</Button>}
            <DevicePill />
            <Button variant="secondary" onClick={() => go('library')}><Icon name="upload" size={15} tone="soft" /> Upload</Button>
            <Button variant="primary" onClick={() => go('ask')}><Icon name="ask" size={15} tone="paper" /> Ask</Button>
          </>} />

        {laneOpen && <LaneCard onDismiss={dismissLane} firstRun={firstRun} ws={ws} />}
        <OfflineBanner context="ask" />

        {(() => {
          const attention = (WS_DOCS[wsId] || []).filter((d) => d.ing && d.ing !== 'ready');
          if (!attention.length) return null;
          return (
            <Card className="overflow-hidden mt-6">
              <CardHead><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Needs attention</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{attention.length} uploads in flight</span></CardHead>
              {attention.map((d, i) => {
                const m = ING_META[d.ing] || ING_META.queued;
                const failed = d.ing === 'failed';
                return (
                  <div key={d.id} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <span className="glyph w-[32px] h-[32px]"><Icon name="doc" size={15} tone={failed ? 'accent' : 'soft'} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">{d.title}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{d.coll} · {d.src}</div>
                    </div>
                    <span className="status" style={{ color: m[1] }}><span className={'dot' + (failed ? '' : ' zs-spin')} style={{ background: m[1] }} />{m[0]}</span>
                    <Button variant="ghost" size="sm" onClick={() => go('library')}>{failed ? <React.Fragment><Icon name="refresh" size={13} tone="soft" /> Re-process</React.Fragment> : 'View'}</Button>
                  </div>
                );
              })}
              <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Documents still parsing, chunking or embedding aren’t retrievable yet. Failed uploads need a re-process or a different parser.</span></CardFoot>
            </Card>
          );
        })()}

        {/* Continue */}
        <div className="sec mt-0">
          <div className="sec-hd"><h2 className="zs-h2">Pick up where you left off</h2></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RECENT.map((r) => (
              <button key={r.title} className="gcard" onClick={() => go(r.ic === 'ask' ? 'ask' : 'library')} style={{ textAlign: 'left' }}>
                <div className="flex items-center justify-between">
                  <span className="glyph w-[34px] h-[34px]"><Icon name={r.ic} size={17} tone="soft" /></span>
                  <Tag>{r.kind}</Tag>
                </div>
                <div className="text-sm font-semibold text-ink leading-snug [text-wrap:pretty]">{r.title}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.space} · {r.when}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Workspaces — pick the scope you want to work in */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Your workspaces</h2><Button variant="ghost" size="sm" onClick={() => window.StrategosWorkspace.openSwitcher()}>switch  ⌘K</Button></div>
          {byTier.map((g) => (
            <div className="mb-4" key={g.tier.key}>
              <div className="flex items-center gap-2 mb-2">
                <Icon name={g.tier.icon} size={13} tone="faint" />
                <span className="rail-label p-0">{g.tier.label}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((s) => {
                  const cur = s.id === wsId;
                  return (
                    <button key={s.id} className="card" onClick={() => { setWs(s.id); go('library'); }}
                      style={{ padding: '24px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '12px', borderColor: cur ? 'var(--accent)' : undefined, background: cur ? 'var(--accent-soft)' : undefined }}>
                      <div className="flex items-center justify-between">
                        <span className={'glyph' + (cur ? ' accent' : '') + ' w-[38px] h-[38px] font-mono font-semibold text-[13px]'} style={{ color: cur ? 'var(--accent)' : 'var(--ink-soft)' }}>{s.mark}</span>
                        <span className={'clf clf-' + s.cls}><span className="d" />{CLF_LABEL[s.cls]}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="zs-h3">{s.name}</div>
                          {cur && <span className="cmdk-cur">current</span>}
                        </div>
                        <div className="zs-body-sm mt-0.5">{s.desc}</div>
                      </div>
                      <div className="flex items-center justify-between mt-auto">
                        <Avatars list={s.members} />
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{s.items.toLocaleString()} items</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Start something */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Start something new</h2></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { ic: 'ask',    t: 'Ask across your docs', s: 'summarize · find · compare', go: 'ask' },
              { ic: 'create', t: 'Draft a document',     s: 'memo, report, checklist', go: 'library' },
              { ic: 'upload', t: 'Upload files',         s: 'pdf · docx · xlsx → normalized', go: 'library' },
              { ic: 'grid',   t: 'Run a saved prompt',   s: 'templates · your saved prompts', go: 'playground', tpl: true },
            ].map((a) => (
              <button key={a.t} className="card" onClick={() => { if (a.tpl) { const tpl = PROMPT_TEMPLATES[0]; if (tpl) window.StrategosUI.Handoff.set({ preset: tpl.preset }); } go(a.go); }} style={{ padding: '16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="glyph w-[38px] h-[38px]"><Icon name={a.ic} size={18} tone="soft" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink">{a.t}</span>
                  <span className="block font-mono text-xs text-ink-mute mt-0.5">{a.s}</span>
                </span>
                <Icon name="arrow" size={15} tone="faint" />
              </button>
            ))}
          </div>
        </div>
      </ViewPad>
    );
  }

  window.WorkspaceView = WorkspaceView;
})();
