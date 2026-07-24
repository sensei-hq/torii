/* Strategos Console · view-ask.jsx (member)
   A targeted-task surface over the shared library. Full-bleed: a conversation
   column plus a live context rail (sources · follow-ups · scope). No knobs. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ExecBadge, OfflineBanner, useEnv, ProviderDot, RoutingPanel, usePinnedModel, SaveSnippetButton, MyTemplates, Meter, useWorkspace } = window.StrategosUI;
  const { GATEWAY_REGION, modelById, PROMPT_TEMPLATES } = window.StrategosData;
  const { useState } = React;

  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

  const TASKS = [
    { k: 'find',      label: 'Find',      icon: 'search', ask: 'Find overdue renewals' },
    { k: 'summarize', label: 'Summarize', icon: 'doc',    ask: 'Summarize for the board' },
    { k: 'draft',     label: 'Draft',     icon: 'create', ask: 'Draft a renewal notice' },
    { k: 'compare',   label: 'Compare',   icon: 'scale',  ask: 'Compare to last quarter' },
  ];

  const EXCHANGES = {
    find: {
      q: 'Which units are due for lease renewal in Q3?',
      tools: 'searched 1,204 items · 6 matched',
      a: <span><b>Nine units</b> have leases ending in Q3 — five in Maple Court, three in Harbour View, one in Kingsgate. Maple Court 4B and 7A are already past their 90-day notice window and should be actioned first.</span>,
      src: [['renewals-schedule.csv', 'sheet', 'Q3 lease-end dates · 1,204 rows'], ['lease-register.md', 'doc', 'Master register · all units']],
    },
    summarize: {
      q: 'Summarize the Q1 service-charge variance for the board.',
      tools: 'read 3 docs · 2 tables',
      a: <span>Three properties breached their Q1 budget — Maple Court (+£14,200), Harbour View (+£9,750) and Old Mill Lofts (+£3,110) — driven by lift maintenance and grounds upkeep. Net portfolio variance was <b>+£27,060 (4.1%)</b> against plan.</span>,
      src: [['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table'], ['service-charges.csv', 'sheet', 'Per-property charges']],
    },
    draft: {
      q: 'Draft a renewal notice for Maple Court 4B.',
      tools: 'used template · merged tenant record',
      a: <span>Drafted a renewal notice using the <b>standard renewal template</b>, merged with the 4B tenant record and current schedule-of-rates. Saved to <b>Leasing Ops</b> as a Confidential draft — review the rent uplift figure before sending.</span>,
      src: [['renewal-notice.template.md', 'doc', 'Standard renewal template'], ['tenant-4b.json', 'code', 'Tenant record · Maple Court 4B']],
    },
    compare: {
      q: 'Compare maintenance spend across Maple Court and Harbour View.',
      tools: 'queried warehouse · charted',
      a: <span>Maple Court spent <b>£62,400</b> vs Harbour View's <b>£40,750</b> on maintenance last quarter. The gap is almost entirely lift servicing (£18k at Maple Court, two emergency call-outs). Per-unit, the two are within 6%.</span>,
      src: [['maintenance-log.csv', 'sheet', 'Work orders · last quarter'], ['q1-reconciliation.md', 'doc', 'Budget vs actual · p.4 table']],
    },
  };

  function AskView({ initial = 'M', go }) {
    const { ws, all } = useWorkspace();
    const space = ws.name;
    const [task, setTask] = useState('find');
    const [whyOpen, setWhyOpen] = useState(false);
    const [pinned, setPinned] = usePinnedModel();
    const [extra, setExtra] = useState(() => new Set());
    const [spacesOpen, setSpacesOpen] = useState(false);
    const [peek, setPeek] = useState(null);
    const [draftCls, setDraftCls] = useState('confidential');
    const [draftTpl, setDraftTpl] = useState('');
    const [fb, setFb] = useState(null);
    const templates = [...PROMPT_TEMPLATES, ...MyTemplates.use()];
    const others = (all || window.StrategosData.WORKSPACES).filter((w) => w.id !== ws.id);
    const toggleSpace = (id) => setExtra((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const openDoc = (name, chunk) => { if (go) { window.StrategosUI.Handoff.set({ openDoc: name, chunk: chunk }); go('library'); } };
    const { meta: dev } = useEnv();
    const ex = EXCHANGES[task];
    const meta = { items: ws.items, cls: ws.cls, members: ws.members };
    const suggestions = TASKS.filter((t) => t.k !== task);

    // which model answered, why, and what it cost — the legible-routing core
    const online = dev.online;
    const answeringModel = !online ? 'gemma-4-9b' : (pinned || 'sonnet-4.6');
    const m = modelById(answeringModel) || {};
    const callTokens = 12400;
    const callCost = +((m.price || 0) * callTokens / 1e6).toFixed(4);
    const exec = { local: !online, region: GATEWAY_REGION };
    const grounding = Math.min(99, (m.q || 90) - 4);
    const quality = m.q || 90;
    const latMs = (m.lat || 1200) + 300;
    const reason = !online
      ? 'Cloud unreachable — the gateway answered on-device with ' + answeringModel + '. Nothing left this machine.'
      : pinned
        ? 'You pinned ' + answeringModel + ', so the gateway skipped auto-routing and used it directly.'
        : 'Auto-routed to ' + answeringModel + ' — the balanced-tier default. You’re under budget, so the gateway chose quality over the cheaper floor and kept grounding in-tenant.';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        {/* header */}
        <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)' }}>
          <div className="zs-eyebrow">Ask</div>
          <h1 className="zs-h1" style={{ marginTop: 4 }}>What do you need?</h1>
        </div>

        {/* control bar */}
        <div className="flex items-center gap-3" style={{ padding: '0 var(--space-6) var(--space-4)', flexWrap: 'wrap' }}>
          <button className="flex items-center gap-2" onClick={() => window.StrategosWorkspace.openSwitcher()} title="Switch workspace  ⌘K"
            style={{ height: 32, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper-soft)', cursor: 'pointer' }}>
            <Icon name="library" size={14} tone="accent" />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-mute)' }}>Asking across</span>
            <span style={{ font: '600 13px var(--font-ui)', color: 'var(--ink)' }}>{space}{extra.size ? ' + ' + extra.size + ' more' : ''}</span>
            <Icon name="caret" size={13} tone="mute" />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setSpacesOpen((v) => !v)} title="Ask across more spaces"><Icon name="plus" size={13} tone="soft" /> Space</button>
            {spacesOpen && (
              <React.Fragment>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setSpacesOpen(false)} />
                <div className="rise" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41, width: 240, maxHeight: 280, overflowY: 'auto', background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', padding: 4 }}>
                  <div className="zs-eyebrow" style={{ padding: '6px 8px' }}>Also ask across</div>
                  {others.map((w) => {
                    const on = extra.has(w.id);
                    return (
                      <button key={w.id} onClick={() => toggleSpace(w.id)} className="flex items-center gap-2" style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}>
                        <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent)' : 'transparent' }}>{on && <Icon name="check" size={11} tone="paper" />}</span>
                        <span className={'wsdot wsdot-' + w.cls} style={{ width: 6, height: 6 }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            )}
          </div>
          {[...extra].map((id) => { const w = (all || []).find((x) => x.id === id); return <button key={id} className="dtag tag-btn" onClick={() => toggleSpace(id)}>{w ? w.name : id} ✕</button>; })}
          <span className={'clf clf-' + ws.cls}><span className="d" />grounded · in-tenant</span>
          <span className="grow" />
          <div className="tabs sm">
            {TASKS.map((t) => (
              <button key={t.k} className={'tab' + (task === t.k ? ' on' : '')} onClick={() => setTask(t.k)}>
                <Icon name={t.icon} size={14} tone={task === t.k ? 'ink' : 'mute'} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* body: conversation + context rail */}
        <div className="flex" style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--paper-edge)' }}>
          {/* conversation */}
          <section className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }} className="rise">
              <div style={{ maxWidth: 820, margin: '0 auto' }}>
                <div style={{ marginBottom: dev.online ? 0 : 'var(--space-5)' }}><OfflineBanner context="ask" /></div>
                {/* user turn */}
                <div className="flex items-start gap-3" style={{ marginBottom: 'var(--space-5)' }}>
                  <span className="ava" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent' }}>{initial}</span>
                  <div style={{ paddingTop: 3, fontSize: 'var(--text-lg)', color: 'var(--ink)', lineHeight: 1.5, fontFamily: 'var(--font-display)', fontWeight: 400 }}>{ex.q}</div>
                </div>

                {/* answer */}
                <div className="answer">
                  <div className="answer-hd">
                    <Icon name="spark" size={12} tone="accent" /> Answer
                    <button onClick={() => setWhyOpen((v) => !v)} title="Why this model?"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--paper-edge)', background: whyOpen ? 'var(--accent-soft)' : 'var(--paper)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                      <ProviderDot provider={m.provider} size={7} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink)' }}>{answeringModel}</span>
                      {m.tier && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.tier}</span>}
                      {pinned && <Icon name="pin" size={11} tone="accent" />}
                    </button>
                    <ExecBadge local={!online} region={GATEWAY_REGION} verb />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', textTransform: 'none', letterSpacing: 0 }}>{callCost === 0 ? 'free' : '$' + callCost.toFixed(3)}</span>
                    <span className="grow" />
                    <button onClick={() => setWhyOpen((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: whyOpen ? 'var(--accent)' : 'var(--ink-mute)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                      <Icon name="info" size={13} tone={whyOpen ? 'accent' : 'mute'} /> why this model
                      <Icon name="caret" size={11} tone={whyOpen ? 'accent' : 'mute'} style={{ transform: whyOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur) var(--ease)' }} />
                    </button>
                  </div>
                  {whyOpen && (
                    <RoutingPanel modelId={answeringModel} reason={reason} callCost={callCost} pinned={!!pinned} exec={exec}
                      onTogglePin={() => setPinned(pinned ? '' : answeringModel)} />
                  )}
                  <div className="answer-bd" style={{ fontSize: 'var(--text-lg)', lineHeight: 1.65 }}>
                    {ex.a}
                    <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
                      {ex.src.map(([name], i) => (
                        <button key={name} className="chip" style={{ height: 22, cursor: 'pointer' }} onClick={() => setPeek(i)} title="Show source"><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup>{name}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--paper-edge)' }}>
                      <span className="zs-meta">{ex.tools}</span>
                      <span className="grow" />
                      <SaveSnippetButton snippet={{ key: 'ask·' + task + '·' + space, kind: 'answer', task, title: ex.q, space, model: answeringModel }} />
                    </div>
                    <div className="grid grid-cols-3 gap-4" style={{ marginTop: 14 }}>
                      <Meter label="Grounding" value={grounding} display={grounding + '%'} tone={grounding > 80 ? 'success' : 'accent'} />
                      <Meter label="Answer quality" value={quality} display={quality + '%'} tone={quality > 85 ? 'success' : 'accent'} />
                      <Meter label="Latency" value={latMs} max={4200} display={(latMs / 1000).toFixed(1) + 's'} tone={latMs > 2600 ? 'warning' : 'ink'} />
                    </div>
                    <div className="flex items-center gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                      {fb === 'accepted' ? (
                        <span className="flex items-center gap-2" style={{ fontSize: 'var(--text-sm)', color: 'var(--success)' }}><Icon name="check" size={14} tone="success" /> Captured as feedback — thanks. <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb(null)}>undo</button></span>
                      ) : fb === 'editing' ? (
                        <div className="composer" style={{ width: '100%', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', background: 'var(--paper-soft)' }}><Icon name="create" size={15} tone="accent" /><input placeholder="Suggest a correction — what should it say instead?" readOnly /><button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => setFb('accepted')}>Submit correction</button></div>
                      ) : (
                        <React.Fragment>
                          <span className="zs-meta">Was this useful?</span>
                          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb('up')}><Icon name="check" size={13} tone={fb === 'up' ? 'success' : 'soft'} /> Helpful</button>
                          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb('down')}><Icon name="flag" size={13} tone={fb === 'down' ? 'accent' : 'soft'} /> Not quite</button>
                          <span style={{ width: 1, height: 16, background: 'var(--paper-edge)' }} />
                          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb('accepted')}><Icon name="check" size={13} tone="soft" /> Accept</button>
                          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setFb('editing')}><Icon name="create" size={13} tone="soft" /> Edit</button>
                          <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="refresh" size={13} tone="soft" /> Retry</button>
                        </React.Fragment>
                      )}
                    </div>
                  </div>
                </div>

                {task === 'draft' && (
                  <div className="card" style={{ marginTop: 'var(--space-4)', overflow: 'hidden' }}>
                    <div className="flex items-center gap-3" style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--accent-soft)', borderBottom: '1px solid var(--paper-edge)' }}>
                      <Icon name="create" size={16} tone="accent" />
                      <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>Draft ready to save to <b>{space}</b>{draftTpl ? ' · from template' : ''}</span>
                      <button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="check" size={13} tone="paper" /> Save draft</button>
                      <button className="zs-btn zs-btn-secondary zs-btn-sm">Open in library</button>
                    </div>
                    <div className="flex items-center" style={{ padding: 'var(--space-3) var(--space-4)', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
                      <span className="flex items-center gap-2">
                        <span className="zs-eyebrow" style={{ margin: 0 }}>Classification</span>
                        <select value={draftCls} onChange={(e) => setDraftCls(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>{Object.keys(CLF_LABEL).map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}</select>
                        <span className={'clf clf-' + draftCls}><span className="d" />{CLF_LABEL[draftCls]}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="zs-eyebrow" style={{ margin: 0 }}>From template</span>
                        <select value={draftTpl} onChange={(e) => setDraftTpl(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
                          <option value="">None · blank draft</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* composer */}
            <div style={{ background: 'var(--paper-soft)', borderTop: '1px solid var(--paper-edge)' }}>
              <div className="composer" style={{ maxWidth: 820, margin: '0 auto', background: 'transparent', borderTop: 'none' }}>
                <Icon name="plus" size={16} tone="mute" />
                <input placeholder={'Ask, find, draft or compare across ' + space + '…'} readOnly />
                <button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="ask" size={13} tone="paper" /> Send <span className="kbd" style={{ marginLeft: 4 }}>⌘↵</span></button>
              </div>
            </div>
          </section>

          {/* context rail */}
          <aside className="ask-rail" style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--paper-edge)', background: 'var(--paper-soft)', overflowY: 'auto', padding: 'var(--space-5)' }}>
            <div className="zs-eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Sources used</div>
            <div className="flex flex-col gap-2">
              {ex.src.map(([name, kind, desc], i) => (
                <div key={name} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper)', overflow: 'hidden' }}>
                  <button onClick={() => setPeek(peek === i ? null : i)} className="flex items-start gap-3" style={{ width: '100%', textAlign: 'left', padding: 'var(--space-3)' }}>
                    <span className="item-ic" style={{ width: 30, height: 30 }}><Icon name={kind} size={14} tone="soft" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-1"><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span></div>
                      <div className="zs-body-sm" style={{ fontSize: 11.5, marginTop: 1 }}>{desc}</div>
                    </div>
                    <Icon name="caret" size={12} tone="mute" style={{ transform: peek === i ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }} />
                  </button>
                  {peek === i && (
                    <div className="rise" style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}>
                      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>chunk c-0{i + 1}</span>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{kind === 'sheet' ? 'rows ' + (i * 9 + 1) + '\u2013' + (i * 9 + 9) : 'p.' + (i + 4) + ' \u00b6' + (i + 1)}</span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>“…{desc}…”</div>
                      <button className="zs-btn zs-btn-secondary zs-btn-sm" style={{ marginTop: 8 }} onClick={() => openDoc(name, 'c-0' + (i + 1))}><Icon name="arrow" size={12} tone="soft" /> Open at this chunk</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Suggested next</div>
            <div className="flex flex-col gap-2">
              {suggestions.map((t) => (
                <button key={t.k} onClick={() => setTask(t.k)} className="flex items-center gap-3" style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', textAlign: 'left' }}>
                  <Icon name={t.icon} size={15} tone="mute" />
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{t.ask}</span>
                  <Icon name="arrow" size={13} tone="faint" />
                </button>
              ))}
            </div>

            <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Scope</div>
            <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--paper-edge)', background: 'var(--paper)' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
                <span className="flex items-center gap-2"><Icon name="library" size={15} tone="accent" /><span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{space}</span></span>
                <span className={'clf clf-' + meta.cls}><span className="d" />{CLF_LABEL[meta.cls]}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="ava-row">{meta.members.map((a) => <span key={a} className="ava" style={{ width: 22, height: 22 }}>{a}</span>)}</div>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{meta.items.toLocaleString()} items</span>
              </div>
            </div>

            <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>
              <span className="flex items-center gap-2">Interaction intelligence <span className="dtag">v2 preview</span></span>
            </div>
            <div className="flex flex-col gap-2">
              {[['spark', 'Clarifying question', '“By ‘last quarter’ do you mean Q1 (Jan–Mar) or the last 3 months?”'], ['history', 'Learned preference', 'You usually want exact figures — defaulting to the SQL-RAG pipeline.'], ['filter', 'Query rewrite', 'service-charge actual vs budget by property · period = Q1 · Δ > 0']].map(([ic, t, d]) => (
                <div key={t} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius)', border: '1px dashed var(--paper-edge)', background: 'var(--paper)' }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 3 }}><Icon name={ic} size={13} tone="accent" /><span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink)' }}>{t}</span></div>
                  <div className="zs-body-sm" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{d}</div>
                </div>
              ))}
            </div>

            <p className="zs-body-sm" style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', lineHeight: 1.5 }}>Answers are grounded only in documents you can access. Confidential content is masked for members without space access.</p>
          </aside>
        </div>
      </div>
    );
  }

  window.AskView = AskView;
})();
