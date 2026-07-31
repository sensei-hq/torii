/* Torii · view-ask.jsx (member)
   A targeted-task surface over the shared library. Full-bleed: a conversation
   column plus a live context rail (sources · follow-ups · scope). No knobs. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Card, Kbd, Button, ExecBadge, OfflineBanner, useEnv, ProviderDot, RoutingPanel, usePinnedModel, SaveSnippetButton, MyTemplates, Meter, useWorkspace } = window.StrategosUI;
  const { GATEWAY_REGION, modelById, PROMPT_TEMPLATES } = window.StrategosAPI;
  const { useState } = React;

  const { CLF_LABEL, TASKS } = window.StrategosAPI.content.ask;

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
    const others = (all || window.StrategosAPI.WORKSPACES).filter((w) => w.id !== ws.id);
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
      <div className="flex flex-col h-full min-h-[0px]">
        {/* header */}
        <div className="pt-6 px-8 pb-4">
          <div className="zs-eyebrow">Ask</div>
          <h1 className="zs-h1 mt-1">What do you need?</h1>
        </div>

        {/* control bar */}
        <div className="flex items-center gap-3 pt-0 px-8 pb-4 flex-wrap">
          <button className="flex items-center gap-2" onClick={() => window.StrategosWorkspace.openSwitcher()} title="Switch workspace  ⌘K"
            style={{ height: 32, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper-soft)', cursor: 'pointer' }}>
            <Icon name="library" size={14} tone="accent" />
            <span className="text-sm text-ink-mute">Asking across</span>
            <span className="text-ink" style={{ font: '600 13px var(--font-ui)'}}>{space}{extra.size ? ' + ' + extra.size + ' more' : ''}</span>
            <Icon name="caret" size={13} tone="mute" />
          </button>
          <div className="relative">
            <Button variant="ghost" size="sm" onClick={() => setSpacesOpen((v) => !v)} title="Ask across more spaces"><Icon name="plus" size={13} tone="soft" /> Space</Button>
            {spacesOpen && (
              <React.Fragment>
                <div className="fixed z-[40]" style={{ inset: 0}} onClick={() => setSpacesOpen(false)} />
                <div className="rise absolute z-[41] w-[240px] max-h-[280px] overflow-y-auto bg-paper border rounded-lg shadow p-1" style={{ top: 'calc(100% + 6px)', left: 0}}>
                  <div className="zs-eyebrow py-1.5 px-2">Also ask across</div>
                  {others.map((w) => {
                    const on = extra.has(w.id);
                    return (
                      <button key={w.id} onClick={() => toggleSpace(w.id)} className="flex items-center gap-2" style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}>
                        <span className="w-[16px] h-[16px] rounded-[4px] shrink-0 grid place-items-center" style={{ border: '1px solid ' + (on ? 'var(--accent)' : 'var(--paper-edge)'), background: on ? 'var(--accent)' : 'transparent' }}>{on && <Icon name="check" size={11} tone="paper" />}</span>
                        <span className={'wsdot wsdot-' + w.cls + ' w-[6px] h-[6px]'} />
                        <span className="flex-1 min-w-0 text-sm text-ink whitespace-nowrap overflow-hidden text-ellipsis">{w.name}</span>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            )}
          </div>
          {[...extra].map((id) => { const w = (all || []).find((x) => x.id === id); return <button key={id} className="dtag tag-btn" onClick={() => toggleSpace(id)}>{w ? w.name : id} ✕</button>; })}
          <span className={'clf clf-' + ws.cls}><span className="d" />grounded · in-tenant</span>
          <span className="flex-1" />
          <div className="tabs sm">
            {TASKS.map((t) => (
              <button key={t.k} className={'tab' + (task === t.k ? ' on' : '')} onClick={() => setTask(t.k)}>
                <Icon name={t.icon} size={14} tone={task === t.k ? 'ink' : 'mute'} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* body: conversation + context rail */}
        <div className="flex flex-1 min-h-[0px] border-t">
          {/* conversation */}
          <section className="flex flex-col flex-1 min-w-0">
            <div className="rise flex-1 overflow-y-auto p-8">
              <div className="max-w-[820px] my-0 mx-auto">
                <div style={{ marginBottom: dev.online ? 0 : '24px' }}><OfflineBanner context="ask" /></div>
                {/* user turn */}
                <div className="flex items-start gap-3 mb-6">
                  <span className="ava bg-accent-soft text-accent border-transparent">{initial}</span>
                  <div className="pt-1 text-lg text-ink leading-[1.5] font-display font-normal">{ex.q}</div>
                </div>

                {/* answer */}
                <div className="answer">
                  <div className="answer-hd">
                    <Icon name="spark" size={12} tone="accent" /> Answer
                    <button onClick={() => setWhyOpen((v) => !v)} title="Why this model?"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px', borderRadius: 'var(--radius-full)', border: '1px solid var(--paper-edge)', background: whyOpen ? 'var(--accent-soft)' : 'var(--paper)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                      <ProviderDot provider={m.provider} size={7} />
                      <span className="font-mono text-xs font-semibold text-ink">{answeringModel}</span>
                      {m.tier && <span className="font-mono text-[10px] text-ink-mute uppercase tracking-[0.04em]">{m.tier}</span>}
                      {pinned && <Icon name="pin" size={11} tone="accent" />}
                    </button>
                    <ExecBadge local={!online} region={GATEWAY_REGION} verb />
                    <span className="font-mono text-xs text-ink-mute normal-case" style={{ letterSpacing: 0 }}>{callCost === 0 ? 'free' : '$' + callCost.toFixed(3)}</span>
                    <span className="flex-1" />
                    <button onClick={() => setWhyOpen((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: whyOpen ? 'var(--accent)' : 'var(--ink-mute)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                      <Icon name="info" size={13} tone={whyOpen ? 'accent' : 'mute'} /> why this model
                      <Icon name="caret" size={11} tone={whyOpen ? 'accent' : 'mute'} style={{ transform: whyOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur) var(--ease)' }} />
                    </button>
                  </div>
                  {whyOpen && (
                    <RoutingPanel modelId={answeringModel} reason={reason} callCost={callCost} pinned={!!pinned} exec={exec}
                      onTogglePin={() => setPinned(pinned ? '' : answeringModel)} />
                  )}
                  <div className="answer-bd text-lg leading-[1.65]">
                    {ex.a}
                    <div className="flex flex-wrap gap-2 mt-4">
                      {ex.src.map(([name], i) => (
                        <button key={name} className="chip" style={{ height: 22, cursor: 'pointer' }} onClick={() => setPeek(i)} title="Show source"><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup>{name}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                      <span className="zs-meta">{ex.tools}</span>
                      <span className="flex-1" />
                      <SaveSnippetButton snippet={{ key: 'ask·' + task + '·' + space, kind: 'answer', task, title: ex.q, space, model: answeringModel }} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-3.5">
                      <Meter label="Grounding" value={grounding} display={grounding + '%'} tone={grounding > 80 ? 'success' : 'accent'} />
                      <Meter label="Answer quality" value={quality} display={quality + '%'} tone={quality > 85 ? 'success' : 'accent'} />
                      <Meter label="Latency" value={latMs} max={4200} display={(latMs / 1000).toFixed(1) + 's'} tone={latMs > 2600 ? 'warning' : 'ink'} />
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {fb === 'accepted' ? (
                        <span className="flex items-center gap-2 text-sm text-success"><Icon name="check" size={14} tone="success" /> Captured as feedback — thanks. <Button variant="ghost" size="sm" onClick={() => setFb(null)}>undo</Button></span>
                      ) : fb === 'editing' ? (
                        <div className="composer w-full border border-accent rounded bg-paper-soft"><Icon name="create" size={15} tone="accent" /><input placeholder="Suggest a correction — what should it say instead?" readOnly /><Button variant="primary" size="sm" onClick={() => setFb('accepted')}>Submit correction</Button></div>
                      ) : (
                        <React.Fragment>
                          <span className="zs-meta">Was this useful?</span>
                          <Button variant="ghost" size="sm" onClick={() => setFb('up')}><Icon name="check" size={13} tone={fb === 'up' ? 'success' : 'soft'} /> Helpful</Button>
                          <Button variant="ghost" size="sm" onClick={() => setFb('down')}><Icon name="flag" size={13} tone={fb === 'down' ? 'accent' : 'soft'} /> Not quite</Button>
                          <span className="w-[1px] h-[16px] bg-paper-edge" />
                          <Button variant="ghost" size="sm" onClick={() => setFb('accepted')}><Icon name="check" size={13} tone="soft" /> Accept</Button>
                          <Button variant="ghost" size="sm" onClick={() => setFb('editing')}><Icon name="create" size={13} tone="soft" /> Edit</Button>
                          <Button variant="ghost" size="sm"><Icon name="refresh" size={13} tone="soft" /> Retry</Button>
                        </React.Fragment>
                      )}
                    </div>
                  </div>
                </div>

                {task === 'draft' && (
                  <Card className="mt-4 overflow-hidden">
                    <div className="flex items-center gap-3 py-3 px-4 bg-accent-soft border-b">
                      <Icon name="create" size={16} tone="accent" />
                      <span className="flex-1 text-sm text-ink">Draft ready to save to <b>{space}</b>{draftTpl ? ' · from template' : ''}</span>
                      <Button variant="primary" size="sm"><Icon name="check" size={13} tone="paper" /> Save draft</Button>
                      <Button variant="secondary" size="sm">Open in library</Button>
                    </div>
                    <div className="flex items-center py-3 px-4 gap-6 flex-wrap">
                      <span className="flex items-center gap-2">
                        <span className="zs-eyebrow m-0">Classification</span>
                        <select value={draftCls} onChange={(e) => setDraftCls(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>{Object.keys(CLF_LABEL).map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}</select>
                        <span className={'clf clf-' + draftCls}><span className="d" />{CLF_LABEL[draftCls]}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="zs-eyebrow m-0">From template</span>
                        <select value={draftTpl} onChange={(e) => setDraftTpl(e.target.value)} style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-sm)', background: 'var(--paper)', font: '500 12px var(--font-ui)', color: 'var(--ink)', padding: '4px 7px', cursor: 'pointer' }}>
                          <option value="">None · blank draft</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </span>
                    </div>
                  </Card>
                )}
              </div>
            </div>

            {/* composer */}
            <div className="bg-paper-soft border-t">
              <div className="composer max-w-[820px] my-0 mx-auto bg-transparent border-t-0">
                <Icon name="plus" size={16} tone="mute" />
                <input placeholder={'Ask, find, draft or compare across ' + space + '…'} readOnly />
                <Button variant="primary" size="sm"><Icon name="ask" size={13} tone="paper" /> Send <Kbd className="ml-1">⌘↵</Kbd></Button>
              </div>
            </div>
          </section>

          {/* context rail */}
          <aside className="hidden lg:block w-[320px] shrink-0 border-l bg-paper-soft overflow-y-auto p-6">
            <div className="zs-eyebrow mb-3">Sources used</div>
            <div className="flex flex-col gap-2">
              {ex.src.map(([name, kind, desc], i) => (
                <div className="border rounded bg-paper overflow-hidden" key={name}>
                  <button onClick={() => setPeek(peek === i ? null : i)} className="flex items-start gap-3" style={{ width: '100%', textAlign: 'left', padding: '12px' }}>
                    <span className="item-ic" style={{ width: 30, height: 30 }}><Icon name={kind} size={14} tone="soft" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1"><sup className="cite" style={{ verticalAlign: 'baseline' }}>{i + 1}</sup><span className="font-mono text-sm font-medium text-ink whitespace-nowrap overflow-hidden text-ellipsis">{name}</span></div>
                      <div className="zs-body-sm text-[11.5px] mt-px">{desc}</div>
                    </div>
                    <Icon name="caret" size={12} tone="mute" style={{ transform: peek === i ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur) var(--ease)' }} />
                  </button>
                  {peek === i && (
                    <div className="rise p-3 border-t bg-paper-soft">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>chunk c-0{i + 1}</span>
                        <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{kind === 'sheet' ? 'rows ' + (i * 9 + 1) + '\u2013' + (i * 9 + 9) : 'p.' + (i + 4) + ' \u00b6' + (i + 1)}</span>
                      </div>
                      <div className="font-display text-[12.5px] text-ink-soft leading-[1.5]" style={{ fontStyle: 'italic'}}>“…{desc}…”</div>
                      <Button className="mt-2" variant="secondary" size="sm" onClick={() => openDoc(name, 'c-0' + (i + 1))}><Icon name="arrow" size={12} tone="soft" /> Open at this chunk</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="zs-eyebrow mt-6 mx-0 mb-3">Suggested next</div>
            <div className="flex flex-col gap-2">
              {suggestions.map((t) => (
                <button key={t.k} onClick={() => setTask(t.k)} className="flex items-center gap-3" style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)', textAlign: 'left' }}>
                  <Icon name={t.icon} size={15} tone="mute" />
                  <span className="flex-1 text-sm text-ink">{t.ask}</span>
                  <Icon name="arrow" size={13} tone="faint" />
                </button>
              ))}
            </div>

            <div className="zs-eyebrow mt-6 mx-0 mb-3">Scope</div>
            <div className="p-4 rounded-lg border bg-paper">
              <div className="flex items-center justify-between mb-3">
                <span className="flex items-center gap-2"><Icon name="library" size={15} tone="accent" /><span className="text-sm font-semibold text-ink">{space}</span></span>
                <span className={'clf clf-' + meta.cls}><span className="d" />{CLF_LABEL[meta.cls]}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="ava-row">{meta.members.map((a) => <span key={a} className="ava w-[22px] h-[22px]">{a}</span>)}</div>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{meta.items.toLocaleString()} items</span>
              </div>
            </div>

            <div className="zs-eyebrow mt-6 mx-0 mb-3">
              <span className="flex items-center gap-2">Interaction intelligence <span className="dtag">v2 preview</span></span>
            </div>
            <div className="flex flex-col gap-2">
              {[['spark', 'Clarifying question', '“By ‘last quarter’ do you mean Q1 (Jan–Mar) or the last 3 months?”'], ['history', 'Learned preference', 'You usually want exact figures — defaulting to the SQL-RAG pipeline.'], ['filter', 'Query rewrite', 'service-charge actual vs budget by property · period = Q1 · Δ > 0']].map(([ic, t, d]) => (
                <div className="p-3 rounded border border-dashed bg-paper" key={t}>
                  <div className="flex items-center gap-2 mb-1"><Icon name={ic} size={13} tone="accent" /><span className="text-xs font-semibold text-ink">{t}</span></div>
                  <div className="zs-body-sm text-[11.5px] leading-snug">{d}</div>
                </div>
              ))}
            </div>

            <p className="zs-body-sm mt-4 text-xs text-ink-faint leading-[1.5]">Answers are grounded only in documents you can access. Confidential content is masked for members without space access.</p>
          </aside>
        </div>
      </div>
    );
  }

  window.AskView = AskView;
})();
