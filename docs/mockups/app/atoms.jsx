/* Strategos Console · atoms.jsx — shared interactive atoms.
   Exposes window.StrategosUI. */
(function () {
  const { Icon } = window.StrategosIcons;
  const { PROVIDER_HUE } = window.StrategosData;

  function Switch({ on, onClick, label }) {
    return React.createElement('button', {
      type: 'button', role: 'switch', 'aria-checked': !!on, 'aria-label': label,
      onClick, className: 'sw' + (on ? ' on' : ''),
    });
  }

  function ProviderDot({ provider, size = 8 }) {
    return React.createElement('span', {
      className: 'pdot',
      style: { width: size, height: size, background: PROVIDER_HUE[provider] || PROVIDER_HUE.local },
    });
  }

  // tone → fill color for meters
  const METER_TONE = {
    accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)',
    ink: 'var(--ink)', mute: 'var(--ink-mute)',
  };

  function Meter({ label, value, max = 100, display, tone = 'ink', hint }) {
    const pct = Math.max(2, Math.min(100, (value / max) * 100));
    const col = METER_TONE[tone] || tone;
    return React.createElement('div', null,
      React.createElement('div', { className: 'meter-lbl' },
        React.createElement('span', { className: 'k' }, label),
        React.createElement('span', { className: 'v', style: { color: col } }, display),
      ),
      React.createElement('div', { className: 'meter' },
        React.createElement('i', { style: { width: pct + '%', background: col } })),
      hint && React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 } }, hint),
    );
  }

  function Pill({ children, kind, icon }) {
    return React.createElement('span', { className: 'pill' + (kind ? ' ' + kind : '') },
      icon && React.createElement(Icon, { name: icon, size: 13, tone: kind === 'accent' ? 'accent' : kind === 'success' ? 'success' : 'mute' }),
      children);
  }

  function Tag({ children }) {
    return React.createElement('span', { className: 'tag' }, children);
  }

  // a control row with icon + title + sub + a trailing control (switch)
  function CtrlRow({ icon, title, sub, active, children }) {
    return React.createElement('div', { className: 'ctrl' },
      React.createElement('span', { className: 'ctrl-ic' }, React.createElement(Icon, { name: icon, size: 18, tone: active ? 'accent' : 'mute' })),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 'var(--text-sm)', fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-soft)' } }, title),
        React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-mute)', marginTop: 1 } }, sub),
      ),
      children);
  }

  // model picker (compact select styled)
  function ModelPicker({ value, onChange }) {
    const { MODELS } = window.StrategosData;
    return React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--paper-edge)', background: 'var(--paper)' } },
      React.createElement(ProviderDot, { provider: (window.StrategosData.modelById(value) || {}).provider, size: 7 }),
      React.createElement('select', {
        value, onChange: (e) => onChange(e.target.value),
        style: { border: 'none', outline: 'none', background: 'transparent', font: '500 12px var(--font-mono)', color: 'var(--ink)', cursor: 'pointer' },
      }, MODELS.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.id))),
    );
  }

  window.StrategosUI = { Switch, ProviderDot, Meter, Pill, Tag, CtrlRow, ModelPicker };
})();
