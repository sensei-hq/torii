/* Torii · view-library-doc.jsx (member)
   The document workspace — what opens when you select a Library item.
   Beyond "open": ingestion pipeline state, parse quality, the extracted-assets
   browser (rendered markdown · table-as-data-grid · figure gallery), the chunk
   inspector, source→artifact lineage, and version history. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { Tag, Chip, CardHead, Card, CardFoot, Pill, Button, ExecBadge, MyTemplates } = window.StrategosUI;
  const { useState } = React;

  const { CLF_LABEL, DEFAULT_REDACTIONS, COMMENTS, SENS_COL, STAGES, STAGE_LABEL, DOC } = window.StrategosAPI.content.libraryDoc;
  function sensOf(col) { if (/tenant|owner|name|arrear|rent|email|tenant/i.test(col)) return 'confidential'; if (/budget|actual|variance|amount|pcm|cost|\$|£|rate/i.test(col)) return 'internal'; return 'public'; }

  /* ── ingestion pipeline ─────────────────────────────────────────────── */

  /* ── rich per-document content (keyed by Library item id) ───────────── */

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
        <div className="docws-hd lt-lg:flex-wrap lt-lg:!px-4 lt-lg:!py-3">
          <Button variant="ghost" size="sm" onClick={onBack}><Icon name="arrow" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Library</Button>
          <span className="glyph accent w-[38px] h-[38px] ml-1"><Icon name="doc" size={19} tone="accent" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="tracking-tight text-ink m-0 whitespace-nowrap overflow-hidden text-ellipsis" style={{ font: '500 var(--text-xl)/1.2 var(--font-display)'}}>{item.title}</h1>
              <Tag>{item.src}</Tag>
              <label className={'clf clf-' + cls + ' clf-edit'}>
                <span className="d" />
                <select value={cls} onChange={(e) => setCls && setCls(item.id, e.target.value)}>
                  {Object.keys(CLF_LABEL).map((c) => <option key={c} value={c}>{CLF_LABEL[c]}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>v{d.versions[0].v} · {d.pages} pp · {d.size} · {d.chunkCount} chunks · {item.owner}</span>
              {d.tags.map((t) => <span key={t} className="dtag">{t}</span>)}
            </div>
          </div>
          <div className="flex items-center gap-2 relative">
            <Button variant="ghost" size="sm"><Icon name="refresh" size={14} tone="soft" /> Re-process</Button>
            <Button variant="ghost" size="sm" title="Download the original uploaded file"><Icon name="upload" size={14} tone="soft" style={{ transform: 'rotate(180deg)' }} /> Download original</Button>
            {a && a.kind === 'doc' && <Button variant="ghost" size="sm" onClick={() => setChatOpen((v) => !v)}><Icon name="ask" size={14} tone={chatOpen ? 'accent' : 'soft'} /> Chat to edit</Button>}
            <Button variant="secondary" size="sm" onClick={() => setShareOpen((v) => !v)}><Icon name="share" size={14} tone="soft" /> Share</Button>
            <Button variant="secondary" size="sm"><Icon name="ask" size={14} tone="soft" /> Ask this doc</Button>
            {shareOpen && (
              <div className="rise absolute w-[300px] z-[30] bg-paper border rounded-lg shadow p-4" style={{ top: 'calc(100% + 6px)', right: 0}}>
                <div className="zs-eyebrow mb-2">Share</div>
                <div className="flex flex-col gap-1">
                  {[['space', 'This space', 'everyone in this space'], ['people', 'Specific people', 'choose who can see it'], ['tenant', 'Anyone in tenant', 'read-only link']].map(([k, tt, ss]) => (
                    <button key={k} onClick={() => setShareVis(k)} className="flex items-center gap-2" style={{ padding: '7px 8px', borderRadius: 'var(--radius)', border: '1px solid ' + (shareVis === k ? 'var(--accent)' : 'var(--paper-edge)'), background: shareVis === k ? 'var(--accent-soft)' : 'var(--paper)', textAlign: 'left' }}>
                      <Icon name={k === 'space' ? 'library' : k === 'people' ? 'team' : 'globe'} size={15} tone={shareVis === k ? 'accent' : 'mute'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-ink">{tt}</span>
                        <span className="mono" style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{ss}</span>
                      </span>
                      {shareVis === k && <Icon name="check" size={14} tone="accent" />}
                    </button>
                  ))}
                </div>
                {shareVis === 'people' && (
                  <div className="flex flex-col gap-1.5 mt-2.5">
                    {[['A', 'a.rao', 'owner'], ['M', 'm.okafor', 'editor'], ['S', 's.kaur', 'commenter'], ['J', 'j.lee', 'viewer']].map(([av, nm, role]) => (
                      <div key={nm} className="flex items-center gap-2">
                        <span className="ava w-[24px] h-[24px]">{av}</span>
                        <span className="flex-1 text-sm text-ink">{nm}</span>
                        <span className="dtag">{role}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="h-[1px] bg-paper-edge my-3 mx-0" />
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={saveAsTemplate}><Icon name={tplFlash ? 'check' : 'grid'} size={14} tone={tplFlash ? 'success' : 'soft'} /> {tplFlash ? 'Saved as template' : 'Save as template'}</Button>
                  <span className="flex-1" />
                  <Button variant="primary" size="sm" onClick={() => setShareOpen(false)}>Done</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ingestion strip */}
        <div className="docws-ing lt-lg:overflow-x-auto lt-lg:!px-4 lt-lg:!py-3">
          <Pipeline state={d.ing} />
          <span className="flex-1" />
          <div className="flex items-center gap-3">
            <Chip className="h-[22px]" title="content hash · deduplicated on upload"><Icon name="lock" size={11} tone="mute" />{dup.hash}</Chip>
            <Chip className="h-[22px]" style={{ color: dup.duplicate ? 'var(--warning)' : 'var(--ink-mute)' }}><Icon name={dup.duplicate ? 'flag' : 'check'} size={11} tone={dup.duplicate ? 'warning' : 'success'} />{dup.duplicate ? 'duplicate of ' + dup.of : 'no duplicates'}</Chip>
            {redactions.length > 0 && <span className="dtag warn" title="masked at ingestion"><Icon name="shield" size={11} tone="warning" /> {redactions.length} redacted</span>}
            <div className="flex items-center gap-2" title="how cleanly the source parsed">
              <span className="zs-eyebrow m-0">Parse quality</span>
              <div className="pq"><span className="pq-fill" style={{ width: d.quality + '%' }} /></div>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: d.quality >= 90 ? 'var(--success)' : 'var(--warning)' }}>{d.quality}%</span>
            </div>
            <span className="w-[1px] h-[16px] bg-paper-edge" />
            <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>{d.parser}</span>
          </div>
        </div>

        {/* tabs */}
        <div className="tabs py-0 px-8 border-b">
          {[['preview', 'Preview'], ['chunks', 'Chunks'], ['comments', 'Comments'], ['redactions', 'Redactions'], ['lineage', 'Lineage'], ['versions', 'Versions']].map(([id, lbl]) => (
            <button key={id} className={'tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        <div className="docws-body">
          {tab === 'preview' && (
            <div className="docws-preview lt-lg:flex-col">
              {/* extracted-assets rail */}
              <div className="assets-rail lt-lg:!w-auto lt-lg:!shrink-0 lt-lg:!border-r-0 lt-lg:border-b lt-lg:!flex lt-lg:items-center lt-lg:gap-1 lt-lg:overflow-x-auto lt-lg:overflow-y-hidden lt-lg:!px-3 lt-lg:!py-2">
                <div className="rail-label pt-0 px-1.5 pb-2">Extracted assets</div>
                <div className="flex flex-col gap-0.5">
                  {d.assets.map((as, i) => (
                    <button key={as.name} className={'arow lt-lg:!w-auto lt-lg:!shrink-0 lt-lg:whitespace-nowrap' + (i === asset ? ' on' : '')} onClick={() => pickAsset(i)}>
                      <Icon name={as.kind} size={15} tone={i === asset ? 'accent' : 'mute'} />
                      <span className="arow-name">{as.name}</span>
                      <span className="mono arow-b">{as.bytes || ''}</span>
                    </button>
                  ))}
                </div>
                <div className="lineage-mini lt-lg:!hidden">
                  <span className="mono" style={{ color: 'var(--ink-faint)' }}>from</span>
                  <Tag className="mt-1">{item.src}</Tag>
                </div>
              </div>

              {/* main preview */}
              <div className="preview-main lt-xl:!p-6">
                {a.kind === 'doc' && (
                  <div>
                    <Markdown text={mdText} />
                    {chatOpen && (
                      <div className="rise mt-6 border rounded-lg overflow-hidden">
                        <CardHead><span className="flex items-center gap-2"><Icon name="spark" size={15} tone="accent" /><span className="zs-eyebrow">Chat to edit</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>agent-driven</span></CardHead>
                        <div className="p-4">
                          <p className="zs-body-sm mt-0 mb-3">Describe the change — the assistant edits the document and saves it as a new version. Hand-editing normalized artifacts isn’t part of v1; live collaborative editing is coming in v2.</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {['Tighten the summary to five bullets', 'Add a risks section', 'Fix the Q1 figures from the table'].map((s) => <Chip className="h-[24px]" key={s}>{s}</Chip>)}
                          </div>
                          <div className="composer border rounded bg-paper-soft">
                            <Icon name="ask" size={16} tone="mute" />
                            <input placeholder="Ask the assistant to edit this document…" readOnly />
                            <Button variant="primary" size="sm"><Icon name="arrow" size={13} tone="paper" /> Send</Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {a.kind === 'sheet' && (
                  <div>
                    <DataGrid table={a.table} />
                    <Card className="overflow-hidden mt-6">
                      <CardHead><span className="flex items-center gap-2"><Icon name="database" size={15} tone="soft" /><span className="zs-eyebrow">Ask the data · gated compute</span></span><span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>schema only</span></CardHead>
                      <div className="py-4 px-6">
                        <div className="zs-eyebrow mb-2">Schema · per-column sensitivity</div>
                        <div className="flex gap-2 flex-wrap">
                          {a.table.cols.map((c) => { const s = sensOf(c); const enc = s !== 'public'; return (
                            <Chip className="h-[24px]" key={c} title={s + (enc ? ' · field-encrypted' : '')}><span className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: SENS_COL[s] }} />{c}{enc && <Icon name="lock" size={11} tone="mute" />}</Chip>
                          ); })}
                        </div>
                        <div className="composer border rounded bg-paper-soft mt-4"><Icon name="ask" size={15} tone="mute" /><input placeholder="Ask a question of this dataset — e.g. average variance by schedule…" readOnly /><Button variant="primary" size="sm">Run</Button></div>
                        <div className="mt-4 p-4 border rounded-lg bg-paper-soft">
                          <div className="flex items-center gap-2 mb-1.5"><Icon name="shield" size={14} tone="success" /><span className="zs-eyebrow m-0">Computed in the tenant boundary</span></div>
                          <div className="zs-body-sm text-[12.5px]">The model saw the <b>schema</b>, not the values. The query ran inside the tenant boundary; only an <b>aggregate</b> is returned, with <b>k-anonymity ≥ 5</b> enforced on any grouping. Encrypted fields never leave storage decrypted.</div>
                          <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--ink)', marginTop: 8 }}>→ avg variance −£1,780 across 7 schedules · 0 rows exposed</div>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}
                {a.kind === 'image' && (
                  <div>
                    <Figure asset={a} big />
                    {d.assets.filter((x) => x.kind === 'image').length > 1 && (
                      <div>
                        <div className="zs-eyebrow mt-6 mx-0 mb-3">Figure gallery</div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
            <div className="docws-pad lt-lg:!p-4">
              <p className="zs-body-sm mb-4 max-w-[560px]">How this document was split for retrieval. Each chunk carries prepended context (contextual retrieval); scores are from the last query against this space.</p>
              <Card className="overflow-hidden">
                {d.chunks.map((c) => (
                  <div key={c.id} className={'chunk' + (c.dropped ? ' dropped' : '')}>
                    <span className="mono chunk-id">{c.id}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-ink">{c.head}</span>
                        {c.dropped && <span className="dtag warn">dropped by rerank</span>}
                      </div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 3 }}>{c.tokens} tokens · {c.ctx}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="score"><span className="score-fill" style={{ width: (c.score * 100) + '%' }} /></div>
                      <span className="mono" style={{ fontSize: 11, color: c.dropped ? 'var(--ink-faint)' : 'var(--ink)', width: 32, textAlign: 'right' }}>{c.score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {tab === 'lineage' && (
            <div className="docws-pad lt-lg:!p-4">
              <p className="zs-body-sm mb-6 max-w-[560px]">Every stored artifact traces back to the original upload. Originals are retained; normalized artifacts feed embeddings and query.</p>
              <div className="lineage">
                <div className="lin-src">
                  <span className="glyph w-[40px] h-[40px]"><Icon name="upload" size={18} tone="soft" /></span>
                  <div>
                    <div className="font-semibold text-ink text-sm">{item.title}</div>
                    <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)' }}>original · {item.src} · {d.size}</div>
                  </div>
                </div>
                <div className="lin-arrow"><Icon name="arrow" size={16} tone="faint" /><span className="mono">{d.parser}</span></div>
                <div className="lin-outs">
                  {d.assets.map((as) => (
                    <div key={as.name} className="lin-out">
                      <Icon name={as.kind} size={15} tone="mute" />
                      <span className="mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{as.name}</span>
                      <span className="flex-1" />
                      <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{as.kind === 'sheet' ? 'queryable' : as.kind === 'image' ? 'captioned' : 'embedded'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <div className="docws-pad lt-lg:!p-4">
              <p className="zs-body-sm mb-6 max-w-[560px]">Re-uploading keeps history. Earlier versions stay retrievable for audit; only the current version is indexed.</p>
              <div className="vtl">
                {d.versions.map((v) => (
                  <div key={v.v} className={'vrow' + (v.cur ? ' cur' : '')}>
                    <span className="vdot" />
                    <span className="mono vver">v{v.v}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-ink">{v.note}</div>
                      <div className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>{v.who} · {v.when}{v.cur ? ' · indexed' : ''}</div>
                    </div>
                    {v.cur ? <span className="dtag ok">current</span> : <Button variant="ghost" size="sm">Restore</Button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'redactions' && (
            <div className="docws-pad lt-lg:!p-4">
              <p className="zs-body-sm mb-4 max-w-[560px]">What the gateway masked at ingestion, before any model saw this document. Redaction is <b>one-way</b> in v1 — originals aren’t recoverable from the normalized artifact.</p>
              <Card className="overflow-hidden">
                {redactions.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 py-4 px-6" style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <span className="glyph w-[30px] h-[30px]"><Icon name="shield" size={14} tone="warning" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink">{r.type}</div>
                      <div className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-mute)', marginTop: 2 }}>original <b style={{ color: 'var(--ink-soft)' }}>{r.original}</b> → placeholder <b style={{ color: 'var(--accent)' }}>{r.placeholder}</b> · {r.at}</div>
                    </div>
                    <Button variant="ghost" size="sm" title="Mark as a false positive — stops masking this term"><Icon name="flag" size={12} tone="soft" /> False positive</Button>
                  </div>
                ))}
                <CardFoot dashed><Icon name="info" size={14} tone="mute" /><span>Placeholders keep answers grounded without exposing the value. Marking a false positive adds the term to the space safe-list — future uploads won’t mask it.</span></CardFoot>
              </Card>
            </div>
          )}

          {tab === 'comments' && (
            <div className="docws-pad lt-lg:!p-4">
              <p className="zs-body-sm mb-4 max-w-[560px]">Threads and suggestions on this document. A <b>commenter</b> can comment and suggest edits but not change the document; a suggestion proposes an edit the owner accepts. <span className="dtag">v2 preview</span></p>
              <Card className="overflow-hidden">
                {COMMENTS.map((c, i) => (
                  <div className="py-4 px-6" key={i} style={{ borderTop: i ? '1px solid var(--paper-edge)' : 'none' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="ava w-[24px] h-[24px]">{c.who[0].toUpperCase()}</span>
                      <span className="text-sm font-semibold text-ink">{c.who}</span>
                      <span className="dtag">{c.role}</span>
                      {c.kind === 'suggestion' && <Pill kind="accent"><Icon name="create" size={11} tone="accent" />suggestion</Pill>}
                      <span className="flex-1" />
                      <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-faint)' }}>{c.at}</span>
                    </div>
                    <div className="zs-body-sm mt-1.5 text-[13px] text-ink">{c.text}</div>
                    {c.kind === 'suggestion'
                      ? <div className="flex items-center gap-2 mt-2"><Button variant="secondary" size="sm"><Icon name="check" size={12} tone="soft" /> Accept suggestion</Button><Button variant="ghost" size="sm">Dismiss</Button></div>
                      : <div className="flex items-center gap-2 mt-2"><Button variant="ghost" size="sm">Reply</Button><Button variant="ghost" size="sm">Resolve</Button></div>}
                  </div>
                ))}
                <div className="composer border-t bg-paper-soft"><Icon name="ask" size={15} tone="mute" /><input placeholder="Add a comment…" readOnly /><Button variant="primary" size="sm">Comment</Button></div>
              </Card>
            </div>
          )}
        </div>
      </div>
    );
  }

  window.DocWorkspace = DocWorkspace;
})();
