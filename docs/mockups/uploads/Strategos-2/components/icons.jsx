/* Strategos · icons.jsx
   Hairline SVG icons, 1.4–1.5 stroke, round caps — in the Marginalia idiom.
   <Icon name="..." size={16} /> renders an inline currentColor glyph.
   Wrapped in an IIFE so nothing leaks to the shared babel global scope except
   window.StrategosIcons. */
(function () {
const STRATEGOS_ICON_PATHS = {
  /* ── gateway domain ── */
  router:   <g><rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M4.5 11.2 v0.2 M7 11.2 v0.2 M9.5 11.2 v0.2" strokeLinecap="round"/><path d="M8 9 V5 M8 5 l-2.5 -2 M8 5 l2.5 -2" /></g>,
  provider: <g><path d="M8 2 l5 3 v6 l-5 3 -5 -3 V5 Z"/><path d="M3 5 l5 3 5 -3 M8 8 v6" /></g>,
  model:    <g><circle cx="8" cy="8" r="2.2"/><path d="M8 2 v2.4 M8 11.6 V14 M2 8 h2.4 M11.6 8 H14 M3.8 3.8 l1.7 1.7 M10.5 10.5 l1.7 1.7 M12.2 3.8 l-1.7 1.7 M5.5 10.5 l-1.7 1.7"/></g>,
  layers:   <g><path d="M8 2 L14 5 L8 8 L2 5 Z"/><path d="M2 8 L8 11 L14 8 M2 11 L8 14 L14 11"/></g>,
  shield:   <g><path d="M8 2 l5 2 v4 c0 3 -2.3 5 -5 6 c-2.7 -1 -5 -3 -5 -6 V4 Z"/><path d="M5.8 8 L7.3 9.5 L10.3 6.3" strokeLinecap="round"/></g>,
  key:      <g><circle cx="5.5" cy="5.5" r="3"/><path d="M7.6 7.6 L13 13 M11 11 l1.5 -1.5 M12.5 12.5 L14 11"/></g>,
  budget:   <g><circle cx="8" cy="8" r="6"/><path d="M8 4.5 V11.5 M9.8 6 H7 a1.4 1.4 0 0 0 0 2.8 h2 a1.4 1.4 0 0 1 0 2.8 H6.2" strokeLinecap="round"/></g>,
  chart:    <g><path d="M2.5 2.5 V13.5 H13.5"/><path d="M5 11 V8 M8 11 V5.5 M11 11 V7" strokeLinecap="round"/></g>,
  fallback: <g><path d="M3 4 h4 a3 3 0 0 1 3 3 v0"/><path d="M3 4 l2 -1.6 M3 4 l2 1.6" strokeLinecap="round"/><path d="M13 12 H9 a3 3 0 0 1 -3 -3 v0"/><path d="M13 12 l-2 -1.6 M13 12 l-2 1.6" strokeLinecap="round"/></g>,
  database: <g><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4 V12 c0 1.1 2.2 2 5 2 s5 -0.9 5 -2 V4 M3 8 c0 1.1 2.2 2 5 2 s5 -0.9 5 -2"/></g>,
  tool:     <g><path d="M10.5 2.5 a3 3 0 0 0 -3.6 4 L2.5 11 l2 2 L9 8.6 a3 3 0 0 0 4 -3.6 l-2 2 -1.5 -1.5 Z"/></g>,
  doc:      <g><path d="M4 2.5 H9.5 L12.5 5.5 V13.5 H4 Z"/><path d="M9.5 2.5 V5.5 H12.5 M6 8 H10.5 M6 10.5 H10.5"/></g>,
  citation: <g><path d="M6 3 C4 3 3 4.5 3 6.5 C3 8 4 9 5.5 9 L5 12 M12.5 3 C10.5 3 9.5 4.5 9.5 6.5 C9.5 8 10.5 9 12 9 L11.5 12"/></g>,
  branch:   <g><circle cx="4" cy="4" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="12" cy="8" r="1.6"/><path d="M4 5.6 V10.4 M4 8 h3.5 a3 3 0 0 0 3 -3 v0 M10.4 8 H8"/></g>,
  globe:    <g><circle cx="8" cy="8" r="6"/><path d="M2.5 8 h11 M8 2 c2.2 2 2.2 10 0 12 M8 2 c-2.2 2 -2.2 10 0 12"/></g>,
  lock:     <g><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7"/></g>,
  bolt:     <g><path d="M9 2 L4 9 H8 L7 14 L12 7 H8 Z"/></g>,
  gauge:    <g><path d="M2.5 11 a5.5 5.5 0 0 1 11 0"/><path d="M8 11 L11 6.5" strokeLinecap="round"/><circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none"/></g>,
  filter:   <g><path d="M2.5 3.5 H13.5 L9.5 8.5 V12.5 L6.5 13.5 V8.5 Z"/></g>,
  scale:    <g><path d="M8 2.5 V13.5 M4 13.5 H12 M3 5.5 H13 M3 5.5 L1.5 9 a2 2 0 0 0 3 0 Z M13 5.5 L11.5 9 a2 2 0 0 0 3 0 Z"/></g>,
  spark:    <g><path d="M8 2 L8.9 6.1 L13 7 L8.9 7.9 L8 12 L7.1 7.9 L3 7 L7.1 6.1 Z"/></g>,
  history:  <g><path d="M8 2.5 a5.5 5.5 0 1 1 -5.2 3.7" /><path d="M2.4 2.6 L2.8 6.2 L6.4 5.8" strokeLinecap="round"/><path d="M8 5.5 V8.2 L10 9.5" strokeLinecap="round"/></g>,
  /* ── ui ── */
  check:    <g><path d="M3.5 8.5 7 12 13 4" strokeWidth="1.7"/></g>,
  arrow:    <g><path d="M3 8 H13 M9.5 4.5 L13 8 L9.5 11.5"/></g>,
  arrowR:   <g><path d="M6 4 L 10 8 L 6 12"/></g>,
  arrowDown:<g><path d="M8 3 V13 M4.5 9.5 L8 13 L11.5 9.5"/></g>,
  caret:    <g><path d="M4 6 L 8 10 L 12 6"/></g>,
  plus:     <g><path d="M4 8h8M8 4v8"/></g>,
  search:   <g><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14" strokeLinecap="round"/></g>,
  send:     <g><path d="M3 8 L 13 3 L 10 13 L 8.5 9.5 Z" strokeWidth="1.7"/></g>,
  attach:   <g><path d="M11 4 L 5.5 9.5 A 2 2 0 0 0 8.3 12.3 L 13 7.6 A 3.5 3.5 0 0 0 8 2.6 L 3.5 7.1 A 5 5 0 0 0 10.5 14.1"/></g>,
  user:     <g><circle cx="8" cy="5" r="2.5"/><path d="M3 13.5 a 5 5 0 0 1 10 0"/></g>,
  org:      <g><rect x="3" y="6" width="10" height="7.5" rx="1"/><path d="M5.5 6 V3.5 H10.5 V6 M6 9 h1 M9 9 h1 M6 11 h1 M9 11 h1"/></g>,
  dept:     <g><rect x="2.5" y="3" width="11" height="4" rx="1"/><rect x="2.5" y="9" width="5" height="4" rx="1"/><rect x="8.5" y="9" width="5" height="4" rx="1"/><path d="M8 7 V9 M5 9 V8 H11 V9"/></g>,
  dot:      <g><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/></g>,
  external: <g><path d="M6 3 H4 a1 1 0 0 0 -1 1 v8 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1 -1 v-2 M9 3 H13 V7 M13 3 L7.5 8.5"/></g>,
  copy:     <g><rect x="5" y="5" width="8" height="8" rx="1.2"/><path d="M3 11 V3.5 A0.5 0.5 0 0 1 3.5 3 H11"/></g>,
  refresh:  <g><path d="M13 8 a5 5 0 1 1 -1.5 -3.5"/><path d="M13 2.5 V5 H10.5" strokeLinecap="round"/></g>,
  sliders:  <g><path d="M3 5 H13 M3 11 H13" /><circle cx="6" cy="5" r="1.6" fill="var(--paper-card)"/><circle cx="10" cy="11" r="1.6" fill="var(--paper-card)"/></g>,
  eye:      <g><path d="M1.5 8 C3.5 4.5 12.5 4.5 14.5 8 C12.5 11.5 3.5 11.5 1.5 8 Z"/><circle cx="8" cy="8" r="1.8"/></g>,
  pause:    <g><path d="M6 4 V12 M10 4 V12" strokeWidth="1.8"/></g>,
  flag:     <g><path d="M4 2.5 V13.5 M4 3 H12 L10 6 L12 9 H4"/></g>,
};

function Icon({ name, size = 16, stroke = 1.5, style, className }) {
  const inner = STRATEGOS_ICON_PATHS[name];
  if (!inner) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={stroke} className={className}
      style={{ display: 'block', ...style }} aria-hidden="true">
      {inner}
    </svg>
  );
}

/* Strategos banner mark — routed shards tapering to a point, vermillion
   dollar-coin rosette. Same mark as the console (app/icons.jsx); `onDark`
   renders paper shards for use on ink-filled blocks. */
function Aperture({ size = 28, style, className, onDark = false }) {
  const I = onDark ? 'var(--paper)' : 'var(--ink)';
  const A = onDark ? 'var(--moss)' : 'var(--moss)';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style} className={className} aria-hidden="true">
      <path d="M19.9943 7.27755L5.73779 10.5408L4.06423 7.71041C3.87493 7.39013 4.12675 7 4.52321 7H19.5206C19.7388 7 19.9131 7.11805 19.9943 7.27755Z" fill={I}></path>
      <path d="M19.9374 8.08333L17.6282 11.989L7.89673 14.2165L5.91797 10.8696L19.952 7.65723C20.0172 7.78575 20.0214 7.94147 19.9374 8.08333Z" fill={I} fillOpacity="0.8"></path>
      <path d="M17.5006 12.3486L14.9755 16.6194L9.9661 17.7661L8.04297 14.5135L17.5006 12.3486Z" fill={I} fillOpacity="0.6"></path>
      <path d="M14.7657 16.998L12.5315 20.7768C12.3558 21.0742 11.8913 21.0742 11.7156 20.7768L10.1113 18.0634L14.7657 16.998Z" fill={I} fillOpacity="0.2"></path>
      <circle cx="13" cy="15" r="1" fill={I} fillOpacity="0.3"></circle>
      <path d="M9 5.7998C9.55228 5.7998 10 6.24752 10 6.7998H8C8 6.24755 8.44776 5.79985 9 5.7998Z" fill={I}></path>
      <path d="M17.5 3C17.5 3.55228 17.0523 4 16.5 4C15.9477 4 15.5 3.55228 15.5 3C15.5 2.44772 15.9477 2 16.5 2C17.0523 2 17.5 2.44772 17.5 3Z" fill={I}></path>
      <path d="M8.5 15C7.11942 15 6 16.1194 6 17.5C6 18.8806 7.11942 20 8.5 20C9.88058 20 11 18.8806 11 17.5C11 16.1194 9.88058 15 8.5 15ZM8.62444 18.7121L8.62556 18.889C8.62556 18.9135 8.60547 18.9342 8.58092 18.9342H8.42243C8.39788 18.9342 8.37779 18.9141 8.37779 18.8895V18.7143C7.88225 18.6775 7.649 18.3951 7.62388 18.0882C7.62165 18.0619 7.6423 18.0396 7.66853 18.0396H7.92634C7.9481 18.0396 7.96708 18.0552 7.97042 18.0765C7.99888 18.2533 8.13672 18.3856 8.38393 18.4185V17.6222L8.24609 17.5871C7.95424 17.5173 7.67634 17.3354 7.67634 16.9581C7.67634 16.5513 7.98549 16.3326 8.38058 16.2941V16.1099C8.38058 16.0854 8.40067 16.0653 8.42522 16.0653H8.58203C8.60658 16.0653 8.62667 16.0854 8.62667 16.1099V16.2924C9.00893 16.3309 9.29576 16.5541 9.32924 16.9018C9.33203 16.928 9.31138 16.9509 9.2846 16.9509H9.03404C9.01172 16.9509 8.99275 16.9342 8.98996 16.9124C8.96763 16.7494 8.83705 16.6166 8.62444 16.5876V17.3371L8.76618 17.37C9.12779 17.4593 9.37388 17.6323 9.37388 18.0195C9.37388 18.4397 9.06138 18.6741 8.62444 18.7121ZM8.02344 16.9325C8.02344 17.0742 8.11105 17.1842 8.29967 17.2522C8.32589 17.2628 8.35212 17.2712 8.38337 17.2801V16.5882C8.17746 16.6144 8.02344 16.7299 8.02344 16.9325ZM8.67355 17.6869C8.65792 17.6836 8.6423 17.6797 8.62444 17.6747V18.4208C8.86217 18.3996 9.02623 18.269 9.02623 18.0502C9.02623 17.8789 8.9375 17.7673 8.67355 17.6869Z" fill={A}></path>
    </svg>
  );
}

window.StrategosIcons = { Icon, Aperture };
})();
