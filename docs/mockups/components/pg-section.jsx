/* Strategos · pg-section.jsx — the Playground section.
   Separates the two sides of the product that the console also separates:
   • Configure & evaluate (admins) — tune retrieval, guardrails, cost; decide
     how the system behaves for everyone. (RAG / Compare / Data / Tools modules.)
   • Daily use (everyone) — the member's ask-box: pick a space, ask, get a
     grounded answer with sources. No knobs. (AskMock.) */
const { Icon: PSIcon } = window.StrategosIcons;
const { useState: psUseState } = React;

const PG_MODES = [
  { k: 'configure', label: 'Configure & evaluate', ic: 'sliders', who: 'Admins',
    note: 'Evaluate models and set how retrieval, guardrails and cost behave — before anyone uses it.' },
  { k: 'use', label: 'Daily use', ic: 'user', who: 'Everyone',
    note: 'What a member actually sees: pick a space, ask, get a grounded answer with sources. No knobs.' },
];

const PG_TABS = [
  { k: 'rag',     label: 'Chat with docs', ic: 'doc',      render: () => <window.RagPlayground /> },
  { k: 'compare', label: 'Compare models', ic: 'scale',    render: () => <window.CompareModels /> },
  { k: 'data',    label: 'Talk to data',   ic: 'database', render: () => <window.TalkToData /> },
  { k: 'tools',   label: 'MCP tools',      ic: 'tool',     render: () => <window.McpTools /> },
];

function PlaygroundSection() {
  const [mode, setMode] = psUseState('configure');
  const [tab, setTab] = psUseState('rag');
  const active = PG_TABS.find((t) => t.k === tab);
  const m = PG_MODES.find((x) => x.k === mode);

  return (
    <section className="section" id="playground">
      <div className="shell-max">
        <div className="section-hd">
          <span className="eyebrow"><span className="tick"></span>The playground</span>
          <h2>Admins configure it. Everyone just asks.</h2>
          <p className="lede">Two surfaces over one gateway — the controls an admin tunes to set behaviour, and the calm ask-box everyone else gets. Both are real and clickable below.</p>
        </div>

        {/* primary mode switch: configure (admin) vs use (member) */}
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="seg" role="tablist" aria-label="Product surface">
            {PG_MODES.map((x) => (
              <button key={x.k} role="tab" aria-selected={x.k === mode} className={x.k === mode ? 'on' : ''} onClick={() => setMode(x.k)} style={{ height: 38, padding: '0 16px' }}>
                <span className="si"><PSIcon name={x.ic} size={15} /></span>{x.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, font: '400 13px var(--font-body)', color: 'var(--ink-mute)' }}>
            <span className="pill"><PSIcon name={m.k === 'configure' ? 'lock' : 'user'} size={12} /> {m.who}</span>
            <span style={{ maxWidth: 460 }}>{m.note}</span>
          </div>
        </div>

        {mode === 'configure' ? (
          <React.Fragment>
            {/* module tabs — only in configure mode */}
            <div className="seg" role="tablist" style={{ marginTop: 20 }}>
              {PG_TABS.map((t) => (
                <button key={t.k} role="tab" aria-selected={t.k === tab} className={t.k === tab ? 'on' : ''} onClick={() => setTab(t.k)}>
                  <span className="si"><PSIcon name={t.ic} size={15} /></span>{t.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 20 }}>{active.render()}</div>
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-soft)', font: '500 12px var(--font-mono)' }}>
              <PSIcon name="sliders" size={14} />
              {tab === 'rag' && <span>Toggle layers on the right — guardrails, citations, reranking, auto-tune, retention — and step through retrieval modes L0→L3.</span>}
              {tab === 'compare' && <span>Add or remove models from the chip row to compare quality, latency and cost on the identical task.</span>}
              {tab === 'data' && <span>Pick a question — Strategos writes the SQL, runs it read-only in-tenant, and charts the result.</span>}
              {tab === 'tools' && <span>Connect MCP servers and watch the agent only use the tools you've enabled.</span>}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ marginTop: 20 }}><window.AskMock /></div>
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-soft)', font: '500 12px var(--font-mono)' }}>
              <PSIcon name="user" size={14} />
              <span>Switch the space or the task — Find, Summarize, Draft, Compare. The guardrails and routing an admin set apply automatically; the member never sees a knob.</span>
            </div>
          </React.Fragment>
        )}
      </div>
    </section>
  );
}

window.PlaygroundSection = PlaygroundSection;
