/* Torii · view-library-doc.jsx (member)
   The document workspace — what opens when you select a Library item.
   Beyond "open": ingestion pipeline state, parse quality, the extracted-assets
   browser (rendered markdown · table-as-data-grid · figure gallery), the chunk
   inspector, source→artifact lineage, and version history. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { ExecBadge, MyTemplates } = window.StrategosUI;
  const { useState } = React;

  const CLF_LABEL = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };
  const DEFAULT_REDACTIONS = [
    { type: 'Tenant name', placeholder: '⟨tenant-1⟩', original: 'Nor••••• Ltd', at: 'p.2 ¶1' },
    { type: 'Email', placeholder: '⟨email⟩', original: 'a•••@northwind.co', at: 'p.4 footer' },
    { type: 'Card number', placeholder: '⟨card⟩', original: '•••• 4218', at: 'table row 6' },
  ];
  const COMMENTS = [
    { who: 'a.rao', role: 'owner', at: '2d ago', kind: 'comment', text: 'The arrears figure on p.4 needs the appendix-C credit applied before we share this.' },
    { who: 's.kaur', role: 'commenter', at: '1d ago', kind: 'suggestion', text: 'Suggest changing “favourable” → “£8,210 under budget” for the board.' },
    { who: 'm.okafor', role: 'editor', at: '3h ago', kind: 'comment', text: 'Agreed — I’ll re-run once the appendix-C credit lands.' },
  ];
  function sensOf(col) { if (/tenant|owner|name|arrear|rent|email|tenant/i.test(col)) return 'confidential'; if (/budget|actual|variance|amount|pcm|cost|\$|£|rate/i.test(col)) return 'internal'; return 'public'; }
  const SENS_COL = { confidential: 'var(--accent)', internal: 'var(--warning)', public: 'var(--success)' };

  /* ── ingestion pipeline ─────────────────────────────────────────────── */
  const STAGES = ['queued', 'parsing', 'chunking', 'embedding', 'ready'];
  const STAGE_LABEL = { queued: 'Queued', parsing: 'Parsing', chunking: 'Chunking', embedding: 'Embedding', ready: 'Ready', failed: 'Failed' };

  /* ── rich per-document content (keyed by Library item id) ───────────── */
  const DOC = {
    q0: {
      ing: 'ready', quality: 96, parser: 'layout-aware · Docling profile', pages: 18, size: '4.2 MB', chunkCount: 142,
      tags: ['service charge', 'reconciliation', 'Q1', 'finance'],
      versions: [
        { v: 3, when: '3d ago', who: 'a.rao', note: 'Re-uploaded with appendix C', cur: true },
        { v: 2, when: '2w ago', who: 'a.rao', note: 'Replaced figures 1–2' },
        { v: 1, when: '1mo ago', who: 'm.okafor', note: 'Initial upload' },
      ],
      assets: [
        { name: 'q1-reconciliation.md', kind: 'doc', bytes: '38 KB', md:
`# Q1 service-charge reconciliation

Reconciliation of the **service-charge account** for the quarter ending 31 March. Figures are drawn from the managing-agent ledger and cross-checked against bank statements.

## Summary

- Total demanded across the estate: **£412,800**
- Collected to date: **£389,140** (94.3%)
- Arrears carried forward: **£23,660**
- Variance against budget: **−£8,210** (favourable)

The largest single variance sits in *grounds maintenance*, where the seasonal contract renewed below the budgeted rate.

## Method

Each cost line is matched to its supporting invoice and tagged to a schedule. Disputed items are held in suspense until resolved with the tenant.

\`\`\`
account = ledger.filter(period = "Q1")
variance = budget - actual
\`\`\`

## Next steps

- Issue arrears reminders for the nine units above £1,000
- Close appendix C once the lift-maintenance credit lands` },
        { name: 'service-charges.csv', kind: 'sheet', bytes: '12 KB', table: {
          cols: ['Schedule', 'Budgeted', 'Actual', 'Variance', 'Status'],
          rows: [
            ['Grounds maintenance', '£42,000', '£36,180', '−£5,820', 'Favourable'],
            ['Lift maintenance', '£28,500', '£29,940', '+£1,440', 'Over'],
            ['Cleaning', '£51,200', '£50,110', '−£1,090', 'On budget'],
            ['Insurance', '£88,400', '£88,400', '£0', 'On budget'],
            ['Management fee', '£40,000', '£40,000', '£0', 'On budget'],
            ['Reserve fund', '£120,000', '£120,000', '£0', 'On budget'],
            ['Utilities — common', '£42,700', '£39,420', '−£3,280', 'Favourable'],
          ] } },
        { name: 'figures.png', kind: 'image', cap: 'Figure 1 — Collected vs demanded by month', alt: 'Bar chart comparing demanded and collected service charge by month across the quarter.' },
        { name: 'figures-2.png', kind: 'image', cap: 'Figure 2 — Variance by schedule', alt: 'Horizontal bars showing budget variance for each service-charge schedule.' },
      ],
      chunks: [
        { id: 'c-01', head: 'Reconciliation summary', tokens: 412, score: 0.91, ctx: 'Prepended: doc title + section "Summary"' },
        { id: 'c-02', head: 'Variance — grounds maintenance', tokens: 388, score: 0.86, ctx: 'Prepended: doc title + "Method"' },
        { id: 'c-03', head: 'Arrears by unit', tokens: 503, score: 0.71, ctx: 'From table service-charges.csv (rows 1–9)', dropped: true },
        { id: 'c-04', head: 'Next steps', tokens: 196, score: 0.64, ctx: 'Prepended: doc title' },
      ],
    },
    l1: {
      ing: 'ready', quality: 92, parser: 'sheet-aware · tables→CSV', pages: 4, size: '180 KB', chunkCount: 38,
      tags: ['renewals', 'schedule', 'leasing'],
      versions: [
        { v: 2, when: '12m ago', who: 'm.okafor', note: 'Added August cohort', cur: true },
        { v: 1, when: '1w ago', who: 'm.okafor', note: 'Initial upload' },
      ],
      assets: [
        { name: 'renewals-schedule.csv', kind: 'sheet', bytes: '9 KB', table: {
          cols: ['Unit', 'Tenant', 'Expiry', 'Rent (pcm)', 'Status'],
          rows: [
            ['Maple Court 4B', 'L. Nguyen', '31 Jul', '£1,850', 'Notice sent'],
            ['Harbour View 12', 'R. Owusu', '14 Aug', '£2,200', 'In negotiation'],
            ['Maple Court 2A', 'D. Silva', '31 Aug', '£1,720', 'Renewing'],
            ['Dock Yard 7', 'K. Patel', '30 Sep', '£2,640', 'At risk'],
            ['Harbour View 3', 'S. Khan', '31 Oct', '£2,050', 'Renewing'],
          ] } },
        { name: 'summary.md', kind: 'doc', bytes: '6 KB', md:
`# Renewals — Q3

Five tenancies expire this quarter. **One** is flagged at risk (Dock Yard 7) where the tenant has signalled a possible move.

- Notices issued: 1 of 5
- In active negotiation: 2
- Expected to renew: 3` },
      ],
      chunks: [
        { id: 'c-01', head: 'Renewals summary', tokens: 210, score: 0.83, ctx: 'Prepended: doc title' },
        { id: 'c-02', head: 'At-risk tenancies', tokens: 188, score: 0.79, ctx: 'From renewals-schedule.csv' },
      ],
    },
  };

  // fallback content for items without a hand-authored entry
  function docFor(item) {
    if (DOC[item.id]) return DOC[item.id];
    const assets = (item.norm || []).map(([name, kind]) => {
      if (kind === 'image') return { name, kind, cap: name.replace(/\.[a-z]+$/, '').replace(/[-_]/g, ' '), alt: 'Extracted figure from ' + item.src + '.' };
      if (kind === 'sheet') return { name, kind, bytes: '—', table: { cols: ['Column A', 'Column B', 'Column C'], rows: [['—', '—', '—'], ['—', '—', '—']] } };
      return { name, kind, bytes: '—', md: '# ' + item.title + '\n\nNormalized from ' + item.src + '. Rendered markdown preview.' };
    });
    return {
      ing: item.ing || 'ready', quality: 88, parser: 'default profile',
      pages: 1, size: '—', chunkCount: 12, tags: [], versions: [{ v: 1, when: item.when, who: item.owner, note: 'Initial upload', cur: true }],
      assets, chunks: [{ id: 'c-01', head: item.title, tokens: 240, score: 0.8, ctx: 'Prepended: doc title' }],
    };
  }

  /* ── tiny markdown renderer (headings / lists / bold / inline+block code) */
  function inline(s, kbase) {
    return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((p, i) => {
      if (/^\*\*.+\*\*$/.test(p)) return <b key={kbase + '-' + i}>{p.slice(2, -2)}</b>;
      if (/^\*[^*]+\*$/.test(p)) return <em key={kbase + '-' + i}>{p.slice(1, -1)}</em>;
      if (/^`.+`$/.test(p)) return <code key={kbase + '-' + i} className="ic">{p.slice(1, -1)}</code>;
      return p;
    });
  }
  function Markdown({ text }) {
    const lines = text.split('\n');
    const out = []; let i = 0, k = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (/^### /.test(ln)) { out.push(<h4 key={k++} className="md-h4">{inline(ln.slice(4), k)}</h4>); i++; continue; }
      if (/^## /.test(ln)) { out.push(<h3 key={k++} className="md-h3">{inline(ln.slice(3), k)}</h3>); i++; continue; }
      if (/^# /.test(ln)) { out.push(<h2 key={k++} className="md-h2">{inline(ln.slice(2), k)}</h2>); i++; continue; }
      if (/^```/.test(ln)) { i++; const code = []; while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; } i++; out.push(<pre key={k++} className="md-pre"><code>{code.join('\n')}</code></pre>); continue; }
      if (/^- /.test(ln)) { const its = []; while (i < lines.length && /^- /.test(lines[i])) { its.push(lines[i].slice(2)); i++; } out.push(<ul key={k++} className="md-ul">{its.map((t, j) => <li key={j}>{inline(t, k + '-' + j)}</li>)}</ul>); continue; }
      if (ln.trim() === '') { i++; continue; }
      out.push(<p key={k++} className="md-p">{inline(ln, k)}</p>); i++;
    }
    return <div className="md">{out}</div>;
  }

  /* ── data grid (CSV preview) ───────────────────────────────────────── */
  function DataGrid({ table }) {
    return (
      <div className="dgrid-wrap">
        <table className="dgrid">
          <thead><tr>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((cell, j) => <td key={j} className={j === 0 ? 'k' : (/^[−+£$\d]/.test(cell) ? 'num' : '')}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <div className="dgrid-foot mono">{table.rows.length} rows · {table.cols.length} columns · queryable dataset</div>
      </div>
    );
  }

  /* ── figure placeholder (no stock imagery — captioned extracted figure) */
  function Figure({ asset, big }) {
    return (
      <figure className={'fig' + (big ? ' big' : '')}>
        <div className="fig-canvas"><span className="zs-kanji">図</span></div>
        <figcaption>
          <div className="fig-cap">{asset.cap}</div>
          <div className="fig-alt mono">alt · {asset.alt}</div>
        </figcaption>
      </figure>
    );
  }

  /* ── ingestion stepper ─────────────────────────────────────────────── */
  function Pipeline({ state }) {
    const failed = state === 'failed';
    const idx = failed ? 1 : STAGES.indexOf(state);
    return (
      <div className="pipe">
        {STAGES.map((s, i) => {
          const done = i < idx, cur = i === idx;
          return (
            <React.Fragment key={s}>
              <div className={'pipe-node' + (done ? ' done' : '') + (cur ? ' cur' : '') + (failed && cur ? ' fail' : '')}>
                <span className="pipe-dot">{done ? <Icon name="check" size={11} tone="paper" /> : cur && !failed ? <span className="zs-spin pipe-spin" /> : null}</span>
                <span className="pipe-lbl">{STAGE_LABEL[s]}</span>
              </div>
              {i < STAGES.length - 1 && <span className={'pipe-bar' + (i < idx ? ' done' : '')} />}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  /* ── the workspace ─────────────────────────────────────────────────── */
  function DocWorkspace({ item, cls, setCls, onBack }) {
    const d = docFor(item);
    const redactions = d.redactions || DEFAULT_REDACTIONS;
    const dup = d.dup || { hash: 'sha256:9f2a…c41', duplicate: false };
    const [tab, setTab] = useState('preview');
    const [asset, setAsset] = useState(0);
    const a = d.assets[asset] || d.assets[0];
    const [chatOpen, setChatOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const [shareVis, setShareVis] = useState('space');
    const [tplFlash, setTplFlash] = useState(false);
    const mdText = a && a.md;
    const pickAsset = (i) => { setAsset(i); setChatOpen(false); };
    const saveAsTemplate = () => { MyTemplates.add({ name: item.title, space: 'From library', by: 'you', shared: false, body: 'Use “' + item.title + '” to …', preset: { level: 2, citations: true, guardrails: true } }); setTplFlash(true); setTimeout(() => setTplFlash(false), 1800); };

    return (
      <div className="docws rise">
        {/* header */}
        <div className="docws-hd">
          <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</button>
          <span className="glyph accent" style={{ width: 38, height: 38, marginLeft: 4 }}><Icon name="doc" size={19} tone="accent" /></span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2">
              <h1 style={{ font: '500 var(--text-xl)/1.2 var(--font-display)', letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</h1>
              <span className="tag">{item.src}</span>
              <label className={'clf clf-' + cls + ' clf-edit'}>
                <span className="d" />
                <select value={cls} onChange={(e) => setCls && setCls(item.id, e.target.value)}>
                  {Object.keys(CLF_LABEL).map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2" style={{ marginTop: 4, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>v{d.versions[0].v} · {d.pages} pp · {d.size} · {d.chunkCount} chunks · {item.owner}</span>
              {d.tags.map((t) => <span key={t} className="dtag">{t}</span>)}
            </div>
          </div>
          <div className="flex items-center gap-2" style={{ position: 'relative' }}>
            <button className="zs-btn zs-btn-ghost zs-btn-sm"><Icon name="refresh" size={14} tone="soft" /> Re-process</button>
            <button className="zs-btn zs-btn-ghost zs-btn-sm" title="Download the original uploaded file"><Icon name="upload" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Download original</button>
            {a && a.kind === 'doc' && <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={() => setChatOpen((v) => !v)}><Icon name="ask" size={14} tone={chatOpen ? 'accent' : 'soft'} /> Chat to edit</button>}
            <button className="zs-btn zs-btn-secondary zs-btn-sm" onClick={() => setShareOpen((v) => !v)}><Icon name="share" size={14} tone="soft" /> Share</button>
            <button className="zs-btn zs-btn-secondary zs-btn-sm"><Icon name="ask" size={14} tone="soft" /> Ask this doc</button>
            {shareOpen && (
              <div className="rise" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 300, zIndex: 30, background: 'var(--paper)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', padding: 'var(--space-4)' }}>
                <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Share</div>
                <div className="flex flex-col" style={{ gap: 4 }}>
                  {[['space', 'This space', 'everyone in this space'], ['people', 'Specific people', 'choose who can see it'], ['tenant', 'Anyone in tenant', 'read-only link']].map(([k, tt, ss]) => (
                    <button key={k} onClick={() => setShareVis(k)} className="flex items-center gap-2" style={{ padding: '7px 8px', borderRadius: 'var(--radius)', border: '1px solid ' + (shareVis === k ? 'var(--accent)' : 'var(--paper-edge)'), background: shareVis === k ? 'var(--accent-soft)' : 'var(--paper)', textAlign: 'left' }}>
                      <Icon name={k === 'space' ? 'library' : k === 'people' ? 'team' : 'globe'} size={15} tone={shareVis === k ? 'accent' : 'mute'} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{tt}</span>
                        <span className="mono" style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ss}</span>
                      </span>
                      {shareVis === k && <Icon name="check" size={14} tone="accent" />}
                    </button>
                  ))}
                </div>
                {shareVis === 'people' && (
                  <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
                    {[['A', 'a.rao', 'owner'], ['M', 'm.okafor', 'editor'], ['S', 's.kaur', 'commenter'], ['J', 'j.lee', 'viewer']].map(([av, nm, role]) => (
                      <div key={nm} className="flex items-center gap-2">
                        <span className="ava" style={{ width: 24, height: 24 }}>{av}</span>
                        <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{nm}</span>
                        <span className="dtag">{role}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ height: 1, background: 'var(--paper-edge)', margin: '12px 0' }} />
                <div className="flex items-center gap-2">
                  <button className="zs-btn zs-btn-ghost zs-btn-sm" onClick={saveAsTemplate}><Icon name={tplFlash ? 'check' : 'grid'} size={14} tone={tplFlash ? 'success' : 'soft'} /> {tplFlash ? 'Saved as template' : 'Save as template'}</button>
                  <span className="grow" />
                  <button className="zs-btn zs-btn-primary zs-btn-sm" onClick={() => setShareOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ingestion strip */}
        <div className="docws-ing">
          <Pipeline state={d.ing} />
          <span className="grow" />
          <div className="flex items-center gap-3">
            <span className="chip" title="content hash · deduplicated on upload" style={{ height: 22 }}><Icon name="lock" size={11} tone="mute" />{dup.hash}</span>
            <span className="chip" style={{ height: 22, color: dup.duplicate ? 'var(--warning)' : 'var(--ink-mute)' }}><Icon name={dup.duplicate ? 'flag' : 'check'} size={11} tone={dup.duplicate ? 'warning' : 'success'} />{dup.duplicate ? 'duplicate of ' + dup.of : 'no duplicates'}</span>
            {redactions.length > 0 && <span className="dtag warn" title="masked at ingestion"><Icon name="shield" size={11} tone="warning" /> {redactions.length} redacted</span>}
            <div className="flex items-center gap-2" title="how cleanly the source parsed">
              <span className="zs-eyebrow" style={{ margin: 0 }}>Parse quality</span>
              <div className="pq"><span className="pq-fill" style={{ width: d.quality + '%' }} /></div>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: d.quality >= 90 ? 'var(--success)' : 'var(--warning)' }}>{d.quality}%</span>
            </div>
            <span style={{ width: 1, height: 16, background: 'var(--paper-edge)' }} />
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{d.parser}</span>
          </div>
        </div>

        {/* tabs */}
        <div className="tabs" style={{ padding: '0 var(--space-6)', borderBottom: '1px solid var(--paper-edge)' }}>
          {[['preview', 'Preview'], ['chunks', 'Chunks'], ['comments', 'Comments'], ['redactions', 'Redactions'], ['lineage', 'Lineage'], ['versions', 'Versions']].map(([id, lbl]) => (
            <button key={id} className={'tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        <div className="docws-body">
          {tab === 'preview' && (
            <div className="docws-preview">
              {/* extracted-assets rail */}
              <div className="assets-rail">
                <div className="rail-label" style={{ padding: '0 6px 8px' }}>Extracted assets</div>
                <div className="flex flex-col" style={{ gap: 2 }}>
                  {d.assets.map((as, i) => (
                    <button key={as.name} className={'arow' + (i === asset ? ' on' : '')} onClick={() => pickAsset(i)}>
                      <Icon name={as.kind} size={15} tone={i === asset ? 'accent' : 'mute'} />
                      <span className="arow-name">{as.name}</span>
                      <span className="mono arow-b">{as.bytes || ''}</span>
                    </button>
                  ))}
                </div>
                <div className="lineage-mini">
                  <span className="mono" style={{ color: 'var(--ink-faint)' }}>from</span>
                  <span className="tag" style={{ marginTop: 4 }}>{item.src}</span>
                </div>
              </div>

              {/* main preview */}
              <div className="preview-main">
                {a.kind === 'doc' && (
                  <div>
                    <Markdown text={mdText} />
                    {chatOpen && (
                      <div className="rise" style={{ marginTop: 'var(--space-5)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                        <div className="card-hd"><span className="flex items-center gap-2"><Icon name="spark" size={15} tone="accent" /><span className="zs-eyebrow">Chat to edit</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>agent-driven</span></div>
                        <div style={{ padding: 'var(--space-4)' }}>
                          <p className="zs-body-sm" style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>Describe the change — the assistant edits the document and saves it as a new version. Hand-editing normalized artifacts isn’t part of v1; live collaborative editing is coming in v2.</p>
                          <div className="flex flex-wrap gap-2" style={{ marginBottom: 'var(--space-3)' }}>
                            {['Tighten the summary to five bullets', 'Add a risks section', 'Fix the Q1 figures from the table'].map((s) => <span key={s} className="chip" style={{ height: 24 }}>{s}</span>)}
                          </div>
                          <div className="composer" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper-soft)' }}>
                            <Icon name="ask" size={16} tone="mute" />
                            <input placeholder="Ask the assistant to edit this document…" readOnly />
                            <button className="zs-btn zs-btn-primary zs-btn-sm"><Icon name="arrow" size={13} tone="paper" /> Send</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {a.kind === 'sheet' && (
                  <div>
                    <DataGrid table={a.table} />
                    <div className="card" style={{ overflow: 'hidden', marginTop: 'var(--space-5)' }}>
                      <div className="card-hd"><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Ask the data · gated compute</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>schema only</span></div>
                      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
                        <div className="zs-eyebrow" style={{ marginBottom: 8 }}>Schema · per-column sensitivity</div>
                        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                          {a.table.cols.map((c) => { const s = sensOf(c); const enc = s !== 'public'; return (
                            <span key={c} className="chip" style={{ height: 24 }} title={s + (enc ? ' · field-encrypted' : '')}><span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: SENS_COL[s] }} />{c}{enc && <Icon name="lock" size={11} tone="mute" />}</span>
                          ); })}
                        </div>
                        <div className="composer" style={{ border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius)', background: 'var(--paper-soft)', marginTop: 'var(--space-4)' }}><Icon name="ask" size={15} tone="mute" /><input placeholder="Ask a question of this dataset — e.g. average variance by schedule…" readOnly /><button className="zs-btn zs-btn-primary zs-btn-sm">Run</button></div>
                        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', border: '1px solid var(--paper-edge)', borderRadius: 'var(--radius-lg)', background: 'var(--paper-soft)' }}>
                          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}><Icon name="shield" size={14} tone="success" /><span className="zs-eyebrow" style={{ margin: 0 }}>Computed in the tenant boundary</span></div>
                          <div className="zs-body-sm" style={{ fontSize: 12.5 }}>The model saw the <b>schema</b>, not the values. The query ran inside the tenant boundary; only an <b>aggregate</b> is returned, with <b>k-anonymity ≥ 5</b> enforced on any grouping. Encrypted fields never leave storage decrypted.</div>
                          <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', marginTop: 8 }}>→ avg variance −£1,780 across 7 schedules · 0 rows exposed</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {a.kind === 'image' && (
                  <div>
                    <Figure asset={a} big />
                    {d.assets.filter((x) => x.kind === 'image').length > 1 && (
                      <div>
                        <div className="zs-eyebrow" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>Figure gallery</div>
                        <div className="gallery">
                          {d.assets.map((x, i) => x.kind === 'image' && (
                            <button key={x.name} className={'gtile' + (i === asset ? ' on' : '')} onClick={() => setAsset(i)}>
                              <div className="gtile-canvas"><span className="zs-kanji">図</span></div>
                              <span className="gtile-cap">{x.cap}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {a.kind === 'code' && <pre className="md-pre"><code>{'{\n  "normalized": true,\n  "source": "' + item.src + '"\n}'}</code></pre>}
              </div>
            </div>
          )}

          {tab === 'chunks' && (
            <div className="docws-pad">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-4)', maxWidth: 560 }}>How this document was split for retrieval. Each chunk carries prepended context (contextual retrieval); scores are from the last query against this space.</p>
              <div className="card" style={{ overflow: 'hidden' }}>
                {d.chunks.map((c) => (
                  <div key={c.id} className={'chunk' + (c.dropped ? ' dropped' : '')}>
                    <span className="mono chunk-id">{c.id}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{c.head}</span>
                        {c.dropped && <span className="dtag warn">dropped by rerank</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 3 }}>{c.tokens} tokens · {c.ctx}</div>
                    </div>
                    <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                      <div className="score"><span className="score-fill" style={{ width: (c.score * 100) + '%' }} /></div>
                      <span className="mono" style={{ fontSize: 11, color: c.dropped ? 'var(--ink-faint)' : 'var(--ink)', width: 32, textAlign: 'right' }}>{c.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'lineage' && (
            <div className="docws-pad">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-5)', maxWidth: 560 }}>Every stored artifact traces back to the original upload. Originals are retained; normalized artifacts feed embeddings and query.</p>
              <div className="lineage">
                <div className="lin-src">
                  <span className="glyph" style={{ width: 40, height: 40 }}><Icon name="upload" size={18} tone="soft" /></span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>{item.title}</div>
                    <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>original · {item.src} · {d.size}</div>
                  </div>
                </div>
                <div className="lin-arrow"><Icon name="arrow" size={16} tone="faint" /><span className="mono">{d.parser}</span></div>
                <div className="lin-outs">
                  {d.assets.map((as) => (
                    <div key={as.name} className="lin-out">
                      <Icon name={as.kind} size={15} tone="mute" />
                      <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{as.name}</span>
                      <span className="grow" />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{as.kind === 'sheet' ? 'queryable' : as.kind === 'image' ? 'captioned' : 'embedded'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <div className="docws-pad">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-5)', maxWidth: 560 }}>Re-uploading keeps history. Earlier versions stay retrievable for audit; only the current version is indexed.</p>
              <div className="vtl">
                {d.versions.map((v) => (
                  <div key={v.v} className={'vrow' + (v.cur ? ' cur' : '')}>
                    <span className="vdot" />
                    <span className="mono vver">v{v.v}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{v.note}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{v.who} · {v.when}{v.cur ? ' · indexed' : ''}</div>
                    </div>
                    {v.cur ? <span className="dtag ok">current</span> : <button className="zs-btn zs-btn-ghost zs-btn-sm">Restore</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'redactions' && (
            <div className="docws-pad">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-4)', maxWidth: 560 }}>What the gateway masked at ingestion, before any model saw this document. Redaction is <b>one-way</b> in v1 — originals aren’t recoverable from the normalized artifact.</p>
              <div className="card" style={{ overflow: 'hidden' }}>
                {redactions.map((r, i) => (
                  <div key={i} className="flex items-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <span className="glyph" style={{ width: 30, height: 30 }}><Icon name="shield" size={14} tone="warning" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{r.type}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>original <b style={{ color: 'var(--ink-soft)' }}>{r.original}</b> → placeholder <b style={{ color: 'var(--accent)' }}>{r.placeholder}</b> · {r.at}</div>
                    </div>
                    <button className="zs-btn zs-btn-ghost zs-btn-sm" title="Mark as a false positive — stops masking this term"><Icon name="flag" size={12} tone="soft" /> False positive</button>
                  </div>
                ))}
                <div className="card-foot dashed"><Icon name="info" size={14} tone="mute" /><span>Placeholders keep answers grounded without exposing the value. Marking a false positive adds the term to the space safe-list — future uploads won’t mask it.</span></div>
              </div>
            </div>
          )}

          {tab === 'comments' && (
            <div className="docws-pad">
              <p className="zs-body-sm" style={{ marginBottom: 'var(--space-4)', maxWidth: 560 }}>Threads and suggestions on this document. A <b>commenter</b> can comment and suggest edits but not change the document; a suggestion proposes an edit the owner accepts. <span className="dtag">v2 preview</span></p>
              <div className="card" style={{ overflow: 'hidden' }}>
                {COMMENTS.map((c, i) => (
                  <div key={i} style={{ padding: 'var(--space-4) var(--space-5)', borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <span className="ava" style={{ width: 24, height: 24 }}>{c.who[0].toUpperCase()}</span>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)' }}>{c.who}</span>
                      <span className="dtag">{c.role}</span>
                      {c.kind === 'suggestion' && <span className="pill accent"><Icon name="create" size={11} tone="accent" />suggestion</span>}
                      <span className="grow" />
                      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{c.at}</span>
                    </div>
                    <div className="zs-body-sm" style={{ marginTop: 6, fontSize: 13, color: 'var(--ink)' }}>{c.text}</div>
                    {c.kind === 'suggestion'
                      ? <div className="flex items-center gap-2" style={{ marginTop: 8 }}><button className="zs-btn zs-btn-secondary zs-btn-sm"><Icon name="check" size={12} tone="soft" /> Accept suggestion</button><button className="zs-btn zs-btn-ghost zs-btn-sm">Dismiss</button></div>
                      : <div className="flex items-center gap-2" style={{ marginTop: 8 }}><button className="zs-btn zs-btn-ghost zs-btn-sm">Reply</button><button className="zs-btn zs-btn-ghost zs-btn-sm">Resolve</button></div>}
                  </div>
                ))}
                <div className="composer" style={{ borderTop: '1px solid var(--paper-edge)', background: 'var(--paper-soft)' }}><Icon name="ask" size={15} tone="mute" /><input placeholder="Add a comment…" readOnly /><button className="zs-btn zs-btn-primary zs-btn-sm">Comment</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.DocWorkspace = DocWorkspace;
})();
