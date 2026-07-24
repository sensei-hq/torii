/* Strategos Console · view-workspace.jsx (member home)
   Task-focused. Pick up recent work, jump into a space, start something new. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Pill, DevicePill, OfflineBanner, Meter, ProviderDot, useWorkspace, WorkspaceChip, PageHeader } = window.StrategosUI;
  const { modelById, money, WS_DOCS, PROMPT_TEMPLATES } = window.StrategosData;

  const ING_META = { queued: ['Queued', 'var(--ink-faint)'], parsing: ['Parsing', 'var(--warning)'], chunking: ['Chunking', 'var(--warning)'], embedding: ['Embedding', 'var(--warning)'], failed: ['Failed', 'var(--accent)'] };

  const MY_MODELS = [
    { id: 'sonnet-4.6', note: 'default' },
    { id: 'gemini-3-flash', note: 'fast' },
    { id: 'gemma-4-9b', note: 'on device' },
  ];

  const RECENT = [
    { ic: 'ask',    kind: 'Thread', title: 'Which units are due for lease renewal in Q3?', space: 'Leasing Ops', when: '12m ago' },
    { ic: 'create', kind: 'Draft',  title: 'Maple Court — service-charge variance memo',   space: 'Q1 Reporting', when: '1h ago' },
    { ic: 'doc',    kind: 'Doc',    title: 'Tenant onboarding checklist v3',                space: 'Leasing Ops', when: 'Yesterday' },
  ];

  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
  const TIER_LABEL = { company: 'Company-wide', department: 'Department', team: 'Team', personal: 'Personal' };

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
      <div className="card lane rise" style={{ padding: 'var(--space-5)', border: '1px solid oklch(0.58 0.15 35 / 0.25)', background: 'var(--accent-soft)', marginBottom: 'var(--space-6)' }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-4)' }}>
          <span className="glyph accent" style={{ width: 30, height: 30 }}><Icon name="role" size={16} tone="accent" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="zs-eyebrow" style={{ color: 'var(--accent)' }}>Your lane</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-soft)' }}>{firstRun ? 'Welcome — here’s where you operate and what you can use.' : 'Where you operate and what you can use.'}</div>
          </div>
          <WorkspaceChip ws={ws} />
          <button className="icon-btn" onClick={onDismiss} title="Hide" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 'var(--radius)' }}><Icon name="close" size={16} tone="mute" /></button>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <div style={{ borderRight: '1px solid oklch(0.58 0.15 35 / 0.18)', paddingRight: 'var(--space-5)' }}>
            <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Workspace</div>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--ink)' }}>{ws.name}</span>
              <span className={'clf clf-' + ws.cls}><span className="d" />{CLF_LABEL[ws.cls]}</span>
            </div>
            <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{tierLabel} · {ws.people} {ws.people === 1 ? 'person' : 'people'} · Member</div>
          </div>
          <div style={{ borderRight: '1px solid oklch(0.58 0.15 35 / 0.18)', paddingRight: 'var(--space-5)' }}>
            <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Models you can use</div>
            <div className="flex flex-col gap-2">
              {MY_MODELS.map((x) => {
                const mm = modelById(x.id) || {};
                return (
                  <span key={x.id} className="flex items-center gap-2">
                    <ProviderDot provider={mm.provider} size={7} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink)' }}>{x.id}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{x.note}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <div>
            <Meter label={'Ceiling · ' + ceiling.name.replace(/^You · /, '')} value={ceiling.spent} max={ceiling.cap} tone={tone}
              display={money(ceiling.spent, 0) + ' / ' + money(ceiling.cap, 0)} hint={(parent ? 'cascades from ' + parent.name + ' · ' : '') + pct + '% used'} />
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-soft)', lineHeight: 1.5, marginTop: 'var(--space-3)' }}>The gateway auto-routes the best model under this ceiling — and always shows you where each answer ran.</div>
          </div>
        </div>
        {firstRun && (
          <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid oklch(0.58 0.15 35 / 0.18)' }}>
            <span className="mono" style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>Caps are set by your admin · budget cascades down the org tree</span>
            <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={onDismiss}>Got it</button>
          </div>
        )}
      </div>
    );
  }

  function WorkspaceView({ go, name = 'Mara' }) {
    const { ws, id: wsId, set: setWs, byTier } = useWorkspace();
    const [laneOpen, setLaneOpen] = React.useState(() => { try { return localStorage.getItem('zs-oriented') !== '1'; } catch (e) { return true; } });
    const [firstRun] = React.useState(laneOpen);
    function dismissLane() { try { localStorage.setItem('zs-oriented', '1'); } catch (e) {} setLaneOpen(false); }
    return (
      <div className="view-pad wide rise">
        <PageHeader eyebrow="Wed · 22 Apr" title={'Good morning, ' + name + '.'} subKind="sm"
          sub={<>Working in <button onClick={() => window.StrategosWorkspace.openSwitcher()} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'var(--accent)', fontWeight: 600, padding: 0 }}>{ws.name} ↓</button></>}
          actions={<>
            {!laneOpen && <button className="zs-btn zs-btn-ghost" onClick={() => setLaneOpen(true)}><Icon name="role" size={15} tone="soft" /> Your lane</button>}
            <DevicePill />
            <button className="zs-btn zs-btn-secondary" onClick={() => go('library')}><Icon name="upload" size={15} tone="soft" /> Upload</button>
            <button className="zs-btn zs-btn-primary" onClick={() => go('ask')}><Icon name="ask" size={15} tone="paper" /> Ask</button>
          </>} />

        {laneOpen && <LaneCard onDismiss={dismissLane} firstRun={firstRun} ws={ws} />}
        <OfflineBanner context="ask" />

        {(() => {
          const attention = (WS_DOCS[wsId] || []).filter((d) => d.ing && d.ing !== 'ready');
          if (!attention.length) return null;
          return (
            <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
              <div className="card-hd"><span className="flex items-center gap-2"><Icon name="upload" size={15} tone="soft" /><span className="zs-eyebrow">Needs attention</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{attention.length} uploads in flight</span></div>
              {attention.map((d, i) => {
                const m = ING_META[d.ing] || ING_META.queued;
                const failed = d.ing === 'failed';
                return (
                  <div key={d.id} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <span className="glyph" style={{ width: 32, height: 32 }}><Icon name="doc" size={15} tone={failed ? 'accent' : 'soft'} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{d.coll} · {d.src}</div>
                    </div>
                    <span className="status" style={{ color: m[1] }}><span className={'dot' + (failed ? '' : ' zs-spin')} style={{ background: m[1] }} />{m[0]}</span>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => go('library')}>{failed ? <React.Fragment><Icon name="refresh" size={13} tone="soft" /> Re-process</React.Fragment> : 'View'}</button>
                  </div>
                );
              })}
              <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Documents still parsing, chunking or embedding aren’t retrievable yet. Failed uploads need a re-process or a different parser.</span></div>
            </div>
          );
        })()}

        {/* Continue */}
        <div className="sec" style={{ marginTop: 0 }}>
          <div className="sec-hd"><h2 className="zs-h2">Pick up where you left off</h2></div>
          <div className="grid grid-cols-3 gap-4">
            {RECENT.map((r) => (
              <button key={r.title} className="gcard" onClick={() => go(r.ic === 'ask' ? 'ask' : 'library')} style={{ textAlign: 'left' }}>
                <div className="flex items-center justify-between">
                  <span className="glyph" style={{ width: 34, height: 34 }}><Icon name={r.ic} size={17} tone="soft" /></span>
                  <span className="tag">{r.kind}</span>
                </div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, textWrap: 'pretty' }}>{r.title}</div>
                <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{r.space} · {r.when}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Workspaces — pick the scope you want to work in */}
        <div className="sec">
          <div className="sec-hd"><h2 className="zs-h2">Your workspaces</h2><button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => window.StrategosWorkspace.openSwitcher()}>switch  ⌘K</button></div>
          {byTier.map((g) => (
            <div key={g.tier.key} style={{ marginBottom: 'var(--space-4)' }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                <Icon name={g.tier.icon} size={13} tone="faint" />
                <span className="rail-label" style={{ padding: 0 }}>{g.tier.label}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {g.items.map((s) => {
                  const cur = s.id === wsId;
                  return (
                    <button key={s.id} className="card" onClick={() => { setWs(s.id); go('library'); }}
                      style={{ padding: 'var(--space-5)', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', borderColor: cur ? 'var(--accent)' : undefined, background: cur ? 'var(--accent-soft)' : undefined }}>
                      <div className="flex items-center justify-between">
                        <span className={'glyph' + (cur ? ' accent' : '')} style={{ width: 38, height: 38, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: cur ? 'var(--accent)' : 'var(--ink-soft)' }}>{s.mark}</span>
                        <span className={'clf clf-' + s.cls}><span className="d" />{CLF_LABEL[s.cls]}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="zs-h3">{s.name}</div>
                          {cur && <span className="cmdk-cur">current</span>}
                        </div>
                        <div className="zs-body-sm" style={{ marginTop: 2 }}>{s.desc}</div>
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: 'auto' }}>
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
          <div className="grid grid-cols-3 gap-4">
            {[
              { ic: 'ask',    t: 'Ask across your docs', s: 'summarize · find · compare', go: 'ask' },
              { ic: 'create', t: 'Draft a document',     s: 'memo, report, checklist', go: 'library' },
              { ic: 'upload', t: 'Upload files',         s: 'pdf · docx · xlsx → normalized', go: 'library' },
              { ic: 'grid',   t: 'Run a saved prompt',   s: 'templates · your saved prompts', go: 'playground', tpl: true },
            ].map((a) => (
              <button key={a.t} className="card" onClick={() => { if (a.tpl) { const tpl = PROMPT_TEMPLATES[0]; if (tpl) window.StrategosUI.Handoff.set({ preset: tpl.preset }); } go(a.go); }} style={{ padding: 'var(--space-4)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span className="glyph" style={{ width: 38, height: 38 }}><Icon name={a.ic} size={18} tone="soft" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{a.t}</span>
                  <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{a.s}</span>
                </span>
                <Icon name="arrow" size={15} tone="faint" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  window.WorkspaceView = WorkspaceView;
})();
