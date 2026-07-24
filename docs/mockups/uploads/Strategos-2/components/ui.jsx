/* Strategos · ui.jsx — shared interactive atoms. IIFE-wrapped → window.StrategosUI. */
(function () {
const { Icon: UIcon } = window.StrategosIcons;
const { PROVIDER_HUE: uHue, money: uiMoney } = window.StrategosData;
const { useState: uUseState, useRef: uUseRef, useEffect: uUseEffect } = React;

function Switch({ on, onClick, label }) {
  return (
    <button type="button" className={'switch' + (on ? ' on' : '')} onClick={onClick}
      role="switch" aria-checked={on} aria-label={label}></button>
  );
}

function ProviderDot({ provider, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: uHue[provider] || 'var(--ink-soft)' }}></span>;
}

/* A labelled horizontal meter. tone: 'moss' | 'sky' | 'warn' | 'danger' | 'ink' */
function Bar({ label, value, max = 100, display, tone = 'moss', hint }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  const color = { moss: 'var(--moss)', sky: 'var(--sky)', warn: 'var(--warn)', danger: 'var(--danger)', ink: 'var(--ink-mute)', success: 'var(--success)' }[tone];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ font: '500 11px var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{label}</span>
        <span className="tnum" style={{ font: '600 12.5px var(--font-mono)', color: 'var(--ink)' }}>{display}</span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: 'var(--paper-well)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 999, transition: 'width 380ms cubic-bezier(.2,.7,.3,1)' }}></div>
      </div>
      {hint && <span style={{ font: '400 10.5px var(--font-mono)', color: 'var(--ink-faint)' }}>{hint}</span>}
    </div>
  );
}

/* Model picker dropdown. value = model id, onChange(id). */
function ModelPicker({ value, onChange, compact }) {
  const { MODELS } = window.StrategosData;
  const [open, setOpen] = uUseState(false);
  const ref = uUseRef(null);
  uUseEffect(() => {
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const m = MODELS.find((x) => x.id === value) || MODELS[0];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn sm" onClick={() => setOpen((o) => !o)}
        style={{ gap: 8, height: compact ? 28 : 30 }}>
        <ProviderDot provider={m.provider} />
        <span className="mono" style={{ fontSize: 12 }}>{m.id}</span>
        <span style={{ color: 'var(--ink-soft)', display: 'inline-grid' }}><UIcon name="caret" size={11} /></span>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 264,
          background: 'var(--paper-card)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)', padding: 6 }}>
          <div style={{ font: '500 10px var(--font-mono)', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', padding: '6px 8px 4px' }}>Route to</div>
          {MODELS.map((opt) => (
            <button key={opt.id} type="button" onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', border: 0, cursor: 'pointer',
                background: opt.id === value ? 'var(--paper-inset)' : 'transparent', borderRadius: 8, textAlign: 'left' }}>
              <ProviderDot provider={opt.provider} />
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>{opt.id}</span>
              {opt.tag && <span className="tag" style={{ height: 18, fontSize: 9.5 }}>{opt.tag}</span>}
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-soft)' }}>{opt.price === 0 ? 'free' : uiMoney(opt.price) + '/M'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* A control row in a settings rail: icon, label+sub, trailing control. */
function CtrlRow({ icon, title, sub, children, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0' }}>
      <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, display: 'grid', placeItems: 'center',
        border: '1px solid var(--line)', background: active ? 'var(--moss-soft)' : 'var(--paper-inset)',
        color: active ? 'var(--moss)' : 'var(--ink-soft)', transition: 'all 120ms' }}>
        <UIcon name={icon} size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: '500 13px var(--font-body)', color: 'var(--ink)' }}>{title}</div>
        {sub && <div style={{ font: '400 11px var(--font-mono)', color: 'var(--ink-soft)', marginTop: 1 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

window.StrategosUI = { Switch, ProviderDot, Bar, ModelPicker, CtrlRow };
})();
