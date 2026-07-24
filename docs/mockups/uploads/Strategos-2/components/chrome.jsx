/* Strategos · chrome.jsx — Nav, Hero + gateway diagram, stat band, footer. */
const { Icon, Aperture } = window.StrategosIcons;

function Nav() {
  return (
    <nav className="nav">
      <div className="shell-max nav-inner">
        <a className="brand" href="#top">
          <Aperture size={28} className="mark" />
          <span className="word">Strate<b>gos</b></span>
        </a>
        <div className="nav-links">
          <a href="#playground">Playground</a>
          <a href="#governance">Governance</a>
          <a href="#observability">Requests &amp; audit</a>
          <a href="#enterprise">Enterprise</a>
        </div>
        <div className="nav-right">
          <button className="theme-toggle" aria-label="Flip theme" onClick={() => { const ac = window.AnnotatedCanvas; if (ac) ac.setTheme(ac.getTheme() === 'dark' ? 'light' : 'dark'); }}>
            <span className="icon icon-sun" aria-hidden="true">☀</span>
            <span className="icon icon-moon" aria-hidden="true">☾</span>
            <span className="label"></span>
          </button>
          <a className="btn ghost sm" href="Strategos%20Admin.html">Admin</a>
          <a className="btn ghost sm" href="Strategos%20Console.html">Sign in</a>
          <a className="btn primary sm" href="Strategos%20Console.html">Open console</a>
        </div>
      </div>
    </nav>
  );
}

/* ── Gateway diagram: routers → core → providers/models ── */
function GatewayDiagram() {
  return (
    <div className="gw">
      <div className="gw-eye">
        <span className="eyebrow">The gateway</span>
        <span className="pill sky"><span className="dot" style={{ background: 'var(--sky)' }}></span>router-agnostic</span>
      </div>
      <div className="gw-cols">
        <div className="gw-col">
          <div className="gw-lbl">Routers</div>
          {[['router', 'Bedrock', 'aws'], ['router', 'Vercel', 'edge'], ['router', 'OpenRouter', '300+'], ['router', 'Ollama', 'local']].map(([ic, t, s]) => (
            <div className="gw-node" key={t}><span className="gi"><Icon name={ic} size={15} /></span>{t}<span className="gw-sub">{s}</span></div>
          ))}
        </div>
        <div className="gw-core">
          <Aperture size={30} onDark={true} style={{ filter: 'none' }} />
          <div>
            <div className="gc-t">Strategos</div>
            <div className="gc-s">GATEWAY</div>
          </div>
        </div>
        <div className="gw-col">
          <div className="gw-lbl">Providers · models</div>
          {[['provider', 'opus-4.8', 'anthropic'], ['provider', 'gpt-5.2', 'openai'], ['provider', 'gemini-3-pro', 'google'], ['model', 'gemma-4', 'local']].map(([ic, t, s]) => (
            <div className="gw-node" key={t}><span className="gi"><Icon name={ic} size={15} /></span><span className="mono" style={{ fontSize: 12 }}>{t}</span><span className="gw-sub">{s}</span></div>
          ))}
        </div>
      </div>
      <div className="gw-foot">
        <span className="dot"></span>
        one API · budgets, fallbacks &amp; guardrails applied on every call
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className="hero shell-max" id="top">
      <div className="canvas-grid hero-grid" aria-hidden="true"></div>
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="pill moss"><span className="dot" style={{ background: 'var(--moss)' }}></span>AI gateway for the enterprise</span>
          <h1>Every model.<br/>One <span className="accent">governed</span> doorway.</h1>
          <p className="sub">
            Strategos sits between your people and every provider, router and model —
            applying budgets, fallbacks, guardrails and full observability on every single call.
            Buy one license; govern it like thousands.
          </p>
          <div className="hero-cta">
            <a className="btn primary lg" href="#playground"><span className="ico"><Icon name="spark" size={16} /></span>Explore the playground</a>
            <a className="btn lg" href="#governance"><span className="ico"><Icon name="gauge" size={16} /></span>See the controls</a>
          </div>
          <div className="hero-trust">
            <span>SOC 2 Type II</span><span className="rule"></span>
            <span>Data stays in-tenant</span><span className="rule"></span>
            <span>Bring your own keys</span>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <GatewayDiagram />
          <div className="hand" style={{ position: 'absolute', right: -6, top: -30, fontSize: 26, transform: 'rotate(-5deg)', display: 'inline-flex', alignItems: 'flex-end', gap: 4 }}>
            <svg width="30" height="26" viewBox="0 0 30 26" fill="none" aria-hidden="true" style={{ flexShrink: 0, transform: 'translateY(4px) scaleX(-1)' }}>
              <path d="M3 3 C 16 2, 25 7, 25 19" stroke="var(--sky)" strokeWidth="1.6" strokeLinecap="round" fill="none"></path>
              <path d="M20 15 L 25 20 L 28.5 14.5" stroke="var(--sky)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
            </svg>
            swap any model
          </div>
        </div>
      </div>
    </header>
  );
}

function StatBand() {
  const stats = [
    ['6', 'routers supported', ''],
    ['40+', 'models routed', ''],
    ['$0.00', 'egress to train', 'on'],
    ['100%', 'calls traced', ''],
  ];
  return (
    <div className="band">
      <div className="shell-max band-inner">
        <div className="brand" style={{ cursor: 'default' }}>
          <span className="eyebrow">Trusted between you &amp; the frontier</span>
        </div>
        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
          {stats.map(([n, l]) => (
            <div className="stat" key={l}>
              <div className="n tnum">{n}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Footer() {
  const cols = [
    ['Product', ['Playground', 'Budgets & limits', 'Fallback chains', 'Bring your own keys', 'Requests & audit']],
    ['Capabilities', ['RAG / chat with docs', 'MCP tools', 'Talk to your data', 'Compare models']],
    ['Enterprise', ['Security & governance', 'Data residency', 'Whitelabel', 'SSO & SCIM']],
  ];
  return (
    <footer className="footer" id="footer">
      <div className="shell-max">
        <div className="footer-grid">
          <div>
            <a className="brand" href="#top" style={{ marginBottom: 14 }}>
              <Aperture size={26} />
              <span className="word">Strate<b>gos</b></span>
            </a>
            <p className="muted" style={{ font: '400 13px/1.55 var(--font-body)', maxWidth: 260, margin: '4px 0 0' }}>
              The governed AI gateway. One endpoint for every model — every call traced, every key accounted for.
            </p>
          </div>
          {cols.map(([h, items]) => (
            <div key={h}>
              <h4>{h}</h4>
              <ul>{items.map((i) => <li key={i}><a href="#">{i}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <span>© 2026 Strategos · Northwind Estates demo</span>
          <span style={{ display: 'inline-flex', gap: 16 }}>
            <a href="#" style={{ color: 'var(--ink-soft)', textDecoration: 'none' }}>Privacy</a>
            <a href="#" style={{ color: 'var(--ink-soft)', textDecoration: 'none' }}>Terms</a>
            <a href="#" style={{ color: 'var(--ink-soft)', textDecoration: 'none' }}>Status</a>
          </span>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { Nav, Hero, StatBand, Footer, GatewayDiagram });
