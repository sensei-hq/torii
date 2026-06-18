/* Strategos · logo-marks.jsx — brand-mark candidates derived from
   solar:routing-2-bold-duotone: teardrop waypoint pins, an S-shaped route
   stroke, an arrowhead, and duotone (low-opacity body + solid dot) fills.
   No enso. Pure SVG, round caps, Zen-Sumi inks; vermillion rationed.
   `dark` flips ink to paper for on-ink chips. */
(function () {

  const ink = (dark) => dark ? 'var(--paper)' : 'var(--ink)';
  const faint = (dark) => dark ? 'color-mix(in oklab, var(--paper) 50%, transparent)' : 'var(--ink-faint)';
  const ACCENT = 'var(--accent)';

  /* teardrop waypoint pin, duotone: body at low opacity, solid dot */
  function Pin({ cx, cy, s = 1, body, dot }) {
    const d = `M${cx} ${cy - 5.6 * s}
      C ${cx - 3.4 * s} ${cy - 5.6 * s}, ${cx - 5.4 * s} ${cy - 3.2 * s}, ${cx - 5.4 * s} ${cy - 0.6 * s}
      C ${cx - 5.4 * s} ${cy + 2.4 * s}, ${cx} ${cy + 6 * s}, ${cx} ${cy + 6 * s}
      C ${cx} ${cy + 6 * s}, ${cx + 5.4 * s} ${cy + 2.4 * s}, ${cx + 5.4 * s} ${cy - 0.6 * s}
      C ${cx + 5.4 * s} ${cy - 3.2 * s}, ${cx + 3.4 * s} ${cy - 5.6 * s}, ${cx} ${cy - 5.6 * s} Z`;
    return (
      <g>
        <path d={d} fill={body} opacity="0.32"></path>
        <circle cx={cx} cy={cy - 0.9 * s} r={1.9 * s} fill={dot}></circle>
      </g>
    );
  }

  /* A · Route S — the route stroke alone, drawn as the Strategos initial */
  function MarkRouteS({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d="M23 7 C 11.5 4.5, 9.5 11, 16 15.5 C 22.5 20, 21 26.5, 11.5 25.8"
          stroke={ACCENT} strokeWidth="3.2" strokeLinecap="round"></path>
        <path d="M15.5 22 L 11 25.9 L 16 28.6"
          stroke={ACCENT} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* B · Waypoints — closest to the source icon: two duotone pins, the
     vermillion route snaking between them */
  function MarkWaypoints({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <Pin cx={8.5} cy={9} s={1} body={ink(dark)} dot={ink(dark)} />
        <Pin cx={23.5} cy={23} s={1} body={ink(dark)} dot={ACCENT} />
        <path d="M15.5 6.5 C 22 5.5, 24.5 9, 20 11.5 C 13.5 15, 8.5 16.5, 8.5 20.5 C 8.5 24, 11.5 25.3, 15 24.6"
          stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round"></path>
        <path d="M12.8 21.8 L 15.6 24.5 L 12.4 26.6"
          stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* C · Convergence — three provider dots route into one vermillion arrow */
  function MarkConvergence({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <circle cx="5.5" cy="7" r="2.1" fill={faint(dark)}></circle>
        <circle cx="5.5" cy="16" r="2.1" fill={faint(dark)}></circle>
        <circle cx="5.5" cy="25" r="2.1" fill={faint(dark)}></circle>
        <path d="M8 7 C 14.5 7, 14.5 16, 19 16" stroke={faint(dark)} strokeWidth="2" strokeLinecap="round"></path>
        <path d="M8 16 H 19" stroke={faint(dark)} strokeWidth="2" strokeLinecap="round"></path>
        <path d="M8 25 C 14.5 25, 14.5 16, 19 16" stroke={faint(dark)} strokeWidth="2" strokeLinecap="round"></path>
        <path d="M19 16 H 26" stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d="M23 12.5 L 26.8 16 L 23 19.5" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* D · Departure — one duotone pin as the origin; the route leaves it
     and commits, vermillion arrowhead pointing onward */
  function MarkDeparture({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <Pin cx={10} cy={9.5} s={1.25} body={ink(dark)} dot={ink(dark)} />
        <path d="M12.5 17.5 C 16 22.5, 19.5 24.5, 25 25"
          stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d="M21.5 21.6 L 25.4 25 L 21 27.6"
          stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* E · Decision — the S-route in two halves: dashed ink candidates,
     then the solid vermillion route chosen */
  function MarkDecision({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d="M23 7 C 11.5 4.5, 9.5 11, 16 15.5"
          stroke={ink(dark)} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.5 5"></path>
        <path d="M16 15.5 C 22.5 20, 21 26.5, 11.5 25.8"
          stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d="M15.5 22.2 L 11 25.9 L 15.8 28.4"
          stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* F · Bearing — favicon-grade minimum: origin dot, one curve, arrowhead */
  function MarkBearing({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <circle cx="7.5" cy="23.5" r="3" fill={ink(dark)}></circle>
        <path d="M10.5 20 C 14.5 13.5, 18.5 11, 24.5 10.2"
          stroke={ACCENT} strokeWidth="3.2" strokeLinecap="round"></path>
        <path d="M20.8 6.8 L 25.2 10.1 L 21.5 13.8"
          stroke={ACCENT} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* ── Route $ — the picked direction, refined ────────────────────
     A's S-route + a vertical bar exiting the top as an arrowhead,
     so the mark reads as a dollar sign — the route through the spend. */

  /* ── Route $ — the picked direction, refined ────────────────────
     The S-route drawn bottom→top, with the route's arrowhead capping the
     UPPER curve's terminal (like the source icon), plus a plain vertical
     bar so the mark reads as a dollar sign. */

  /* S drawn from the bottom-left tail up through the centre; the upper
     bowl exits flat-east so the arrow continues the stroke naturally */
  const DS_PATH = 'M10 24.5 C 21 27.5, 22.5 19.5, 16 16 C 9.5 12.5, 9.5 6.4, 18 6.4 L 20 6.4';
  const DS_ARROW = 'M19.7 3.6 L 22.6 6.4 L 19.7 9.2';

  /* G1 · solid — one ink-pot: the whole $ in vermillion */
  function MarkDollarSolid({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d={DS_PATH} stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d={DS_ARROW} stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        <path d="M14.5 28.2 V 3.8" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round"></path>
      </svg>
    );
  }

  /* G2 · duotone — ink bar, the S-route + arrow carries the vermillion */
  function MarkDollarDuo({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d="M14.5 28.2 V 3.8" stroke={ink(dark)} strokeWidth="2.6" strokeLinecap="round"></path>
        <path d={DS_PATH} stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d={DS_ARROW} stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
      </svg>
    );
  }

  /* G3 · journey — G2 plus an origin waypoint: the route starts at an ink
     dot on the tail and exits the upper curve as the arrow */
  function MarkDollarStub({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d="M14.5 28.2 V 3.8" stroke={ink(dark)} strokeWidth="2.6" strokeLinecap="round"></path>
        <path d={DS_PATH} stroke={ACCENT} strokeWidth="3" strokeLinecap="round"></path>
        <path d={DS_ARROW} stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        <circle cx="9.2" cy="24.3" r="2.7" fill={ink(dark)}></circle>
      </svg>
    );
  }

  /* ── Shield — from the user's reference: provider dots with elbow
     connectors feeding into a shield bearing the $. ─────────────── */

  // washi-friendly provider hues (from app/data.jsx PROVIDER_HUE)
  const HUE = {
    green:  'oklch(0.55 0.07 165)',
    blue:   'oklch(0.56 0.10 250)',
    purple: 'oklch(0.54 0.11 265)',
    orange: 'oklch(0.58 0.11 40)',
  };

  const SHIELD_PATH = 'M22 5 C 19.2 6.8, 16.8 7.5, 14.2 7.8 V 15.5 C 14.2 21, 17.6 25.2, 22 26.8 C 26.4 25.2, 29.8 21, 29.8 15.5 V 7.8 C 27.2 7.5, 24.8 6.8, 22 5 Z';
  const SHIELD_S = 'M24.3 12.8 C 20.8 11.8, 20 14, 22 15.2 C 24 16.4, 23.2 18.6, 19.7 17.6';
  const SHIELD_BAR = 'M22 10.9 V 19.5';
  const FEEDS = [
    'M7.2 6.5 H 9.8 L 12.2 8.9 H 13.4',
    'M7.2 13 H 10.4 L 11.8 14.4 H 13.4',
    'M7.2 19.5 H 10 L 11.6 17.9 H 13.4',
    'M7.2 26 H 9.6 L 12.4 23.2 H 15.6',
  ];
  const DOT_Y = [6.5, 13, 19.5, 26];

  function ShieldDollar({ stroke, accent, translate }) {
    return (
      <g transform={translate}>
        <path d={SHIELD_PATH} stroke={stroke} strokeWidth="2" strokeLinejoin="round" fill="none"></path>
        <path d={SHIELD_BAR} stroke={accent} strokeWidth="1.7" strokeLinecap="round"></path>
        <path d={SHIELD_S} stroke={accent} strokeWidth="1.8" strokeLinecap="round" fill="none"></path>
      </g>
    );
  }

  /* H1 · full color — faithful to the reference: four provider hues feed
     the ink shield; the $ takes the vermillion */
  function MarkShieldColor({ size = 32, dark }) {
    const hues = [HUE.green, HUE.blue, HUE.purple, HUE.orange];
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        {FEEDS.map((d, i) => (
          <path key={i} d={d} stroke={hues[i]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        ))}
        {DOT_Y.map((y, i) => (
          <circle key={'d' + i} cx="4.6" cy={y} r="2" fill={hues[i]}></circle>
        ))}
        <ShieldDollar stroke={ink(dark)} accent={ACCENT} />
      </svg>
    );
  }

  /* H2 · rationed — Zen-Sumi treatment: hued dots, faint ink feeds,
     vermillion only on the $ */
  function MarkShieldQuiet({ size = 32, dark }) {
    const hues = [HUE.green, HUE.blue, HUE.purple, HUE.orange];
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        {FEEDS.map((d, i) => (
          <path key={i} d={d} stroke={faint(dark)} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        ))}
        {DOT_Y.map((y, i) => (
          <circle key={'d' + i} cx="4.6" cy={y} r="2" fill={hues[i]}></circle>
        ))}
        <ShieldDollar stroke={ink(dark)} accent={ACCENT} />
      </svg>
    );
  }

  /* H3 · shield only — the favicon cut: just the shield and the $ */
  function MarkShieldSolo({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <ShieldDollar stroke={ink(dark)} accent={ACCENT} translate="translate(-6,0)" />
      </svg>
    );
  }

  /* ── Key flows — from the second reference: no dots, no icons; just
     flow lines converging inside a shield. The converged bundle reads
     like the teeth and shaft of a key — routing as access. ───────── */

  const KSHIELD = 'M16 3.5 C 12.8 5.5, 9.8 6.3, 6.8 6.6 V 15.5 C 6.8 22, 10.8 26.8, 16 28.5 C 21.2 26.8, 25.2 22, 25.2 15.5 V 6.6 C 22.2 6.3, 19.2 5.5, 16 3.5 Z';
  /* four flows entering from the left, elbowing to a convergence at x≈19.5 */
  const KFLOWS = [
    'M9.5 9.8 H 12.6 L 16.4 13.8 L 19.3 15.2',
    'M9.5 13.6 H 14.2 L 16.6 15.2 H 19.3',
    'M9.5 18.4 H 14.2 L 16.6 16.8 H 19.3',
    'M9.5 22.2 H 12.6 L 16.4 18.2 L 19.3 16.8',
  ];

  /* I1 · full color — provider-hued flows; the merged route is vermillion */
  function MarkKeyColor({ size = 32, dark }) {
    const hues = [HUE.green, HUE.blue, HUE.purple, HUE.orange];
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d={KSHIELD} stroke={ink(dark)} strokeWidth="2" strokeLinejoin="round" fill="none"></path>
        {KFLOWS.map((d, i) => (
          <path key={i} d={d} stroke={hues[i]} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        ))}
        <circle cx="20.6" cy="16" r="1.7" fill={ACCENT}></circle>
      </svg>
    );
  }

  /* I2 · rationed — ink flows, vermillion convergence */
  function MarkKeyQuiet({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d={KSHIELD} stroke={ink(dark)} strokeWidth="2" strokeLinejoin="round" fill="none"></path>
        {KFLOWS.map((d, i) => (
          <path key={i} d={d} stroke={faint(dark)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        ))}
        <circle cx="20.6" cy="16" r="1.7" fill={ACCENT}></circle>
      </svg>
    );
  }

  /* I3 · the key — lean into the read: flows are the teeth, the merged
     route is the shaft, ending in the key's bow ring */
  function MarkKeyLiteral({ size = 32, dark }) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ display: 'block' }}>
        <path d={KSHIELD} stroke={ink(dark)} strokeWidth="2" strokeLinejoin="round" fill="none"></path>
        <path d="M9.8 11 H 12 L 15 14.4 L 16.8 15.3" stroke={ink(dark)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        <path d="M9.8 16 H 16.8" stroke={ink(dark)} strokeWidth="1.7" strokeLinecap="round"></path>
        <path d="M9.8 21 H 12 L 15 17.6 L 16.8 16.7" stroke={ink(dark)} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"></path>
        <path d="M16.8 16 H 18.4" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round"></path>
        <circle cx="20.4" cy="16" r="1.9" stroke={ACCENT} strokeWidth="1.8" fill="none"></circle>
      </svg>
    );
  }

  const KEY = [
    { id: 'icolor', label: 'I1 · Key flows · full color', render: MarkKeyColor,
      tag: 'flows only', note: 'The reference minus the circles — four provider-hued flows elbowing to a vermillion convergence inside the shield.' },
    { id: 'iquiet', label: 'I2 · Key flows · rationed', render: MarkKeyQuiet,
      tag: 'zen-sumi treatment', note: 'Same geometry, all-ink flows; one vermillion point where the routes meet. The quietest mark on this canvas.' },
    { id: 'ikey', label: 'I3 · The key', render: MarkKeyLiteral,
      tag: 'routing = access', note: 'Leaning into your observation: three flows as the key’s teeth, the merged route as its shaft, the bow drawn as a vermillion ring.' },
  ];

  const SHIELD = [
    { id: 'hcolor', label: 'H1 · Shield · full color', render: MarkShieldColor,
      tag: 'faithful to reference', note: 'Four provider feeds in the console’s washi hues, elbowing into the ink shield; the $ takes the only vermillion.' },
    { id: 'hquiet', label: 'H2 · Shield · rationed', render: MarkShieldQuiet,
      tag: 'zen-sumi treatment', note: 'Same composition with faint ink feeds — only the provider dots keep their hue. Calmer; closer to the system’s color budget.' },
    { id: 'hsolo', label: 'H3 · Shield · solo', render: MarkShieldSolo,
      tag: 'favicon cut', note: 'Just the shield and the $. The feeds disappear below 20px anyway — this is what the small sizes should use.' },
  ];

  const DOLLAR = [
    { id: 'dsolid', label: 'G1 · Route $ · solid', render: MarkDollarSolid,
      tag: 'one stroke of ink', note: 'The route arrow caps the upper curve, continuing the stroke east. Whole mark in vermillion; plain bar completes the $.' },
    { id: 'dduo', label: 'G2 · Route $ · duotone', render: MarkDollarDuo,
      tag: 'route over spend', note: 'Ink bar, vermillion route — the S-route with its arrowhead rides over the dollar’s spine. Best small-size contrast.' },
    { id: 'dstub', label: 'G3 · Route $ · journey', render: MarkDollarStub,
      tag: 'in · through · out', note: 'G2 plus an origin waypoint — the route enters at the ink dot, runs through the spend, and exits the upper curve as the arrow.' },
  ];

  const MARKS = [
    { id: 'routes',      label: 'A · Route S',     render: MarkRouteS,
      tag: 'route = initial', note: 'The routing icon\u2019s S-shaped path, kept whole — it happens to be the Strategos initial. One stroke, one arrowhead, all vermillion.' },
    { id: 'waypoints',   label: 'B · Waypoints',   render: MarkWaypoints,
      tag: 'faithful evolution', note: 'Closest to solar:routing-2 itself — two duotone teardrop pins, the route snaking between them. The destination dot turns vermillion.' },
    { id: 'convergence', label: 'C · Convergence', render: MarkConvergence,
      tag: 'many in · one out', note: 'The product diagram in miniature: three provider dots, faint candidate paths, one committed vermillion arrow out.' },
    { id: 'departure',   label: 'D · Departure',   render: MarkDeparture,
      tag: 'pin + route out', note: 'Half the source icon, bolder: one duotone origin pin and the route leaving it decisively.' },
    { id: 'decision',    label: 'E · Decision',    render: MarkDecision,
      tag: 'dashed → chosen', note: 'The S-route split mid-stroke: dotted ink while options are open, solid vermillion once the router commits.' },
    { id: 'bearing',     label: 'F · Bearing',     render: MarkBearing,
      tag: 'favicon-grade', note: 'The minimum viable route: an origin dot and one curve away with an arrowhead. Survives 14px better than anything else here.' },
  ];

  window.StrategosLogoMarks = { MARKS, DOLLAR, SHIELD, KEY, MarkRouteS, MarkWaypoints, MarkConvergence, MarkDeparture, MarkDecision, MarkBearing, MarkDollarSolid, MarkDollarDuo, MarkDollarStub, MarkShieldColor, MarkShieldQuiet, MarkShieldSolo };
})();
