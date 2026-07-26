/* Torii · icons.jsx
   Iconography = Solar Icons (Bold Duotone) via the Iconify SVG API,
   tinted to the Zen-Sumi ink / accent scale. This is the "icons instead
   of kanji" layer: every functional mark that the source used a kanji for
   is here a soft two-tone Solar glyph instead.

   <Icon name="playground" size={18} tone="accent" /> */
(function () {
  // tone → hex. Solar icons are fetched with their color baked into the URL,
  // so we keep a light + dark palette and pick by the active theme.
  const TONE_LIGHT = {
    ink: '#2A2925', soft: '#54514A', mute: '#8C887E', faint: '#B7B2A6',
    accent: '#A83D1F', success: '#578D70', warning: '#B9893A', paper: '#F7F4EC',
  };
  const TONE_DARK = {
    ink: '#EDEAE2', soft: '#C6C2B8', mute: '#9A968C', faint: '#6E6A60',
    accent: '#D9663F', success: '#7BAE92', warning: '#D6A85A', paper: '#1B1A17',
  };
  function palette() { return (window.__zsTheme === 'dark') ? TONE_DARK : TONE_LIGHT; }
  const TONE = TONE_LIGHT; // back-compat export

  // semantic name → Solar glyph id (bold-duotone variant only)
  const MAP = {
    // nav
    overview:    'widget-5',
    playground:  'chat-square-code',
    requests:    'clipboard-list',
    routing:     'routing-2',
    models:      'cpu',
    keys:        'key',
    settings:    'settings',
    // marks reused across views
    search:      'magnifer',
    bell:        'bell',
    sun:         'sun-2',
    moon:        'moon',
    command:     'command',
    arrow:       'arrow-right',
    caret:       'alt-arrow-down',
    check:       'check-circle',
    info:        'info-circle',
    refresh:     'refresh',
    trash:       'trash-bin-minimalistic',
    warning:     'danger-triangle',
    plus:        'add-circle',
    close:       'close-circle',
    lock:        'lock-keyhole-minimalistic',
    shield:      'shield-check',
    bolt:        'bolt',
    spark:       'magic-stick-3',
    filter:      'filter',
    history:     'history',
    flag:        'danger-triangle',
    globe:       'global',
    wallet:      'wallet-2',
    scale:       'scale',
    // budget tree
    org:         'buildings-3',
    dept:        'users-group-rounded',
    user:        'user',
    // data / rag
    doc:         'document-text',
    database:    'database',
    layers:      'layers-minimalistic',
    branch:      'siderbar',
    citation:    'bookmark',
    // providers / routers
    provider:    'box-minimalistic',
    router:      'server',
    // personas + member workspace
    home:        'home-smile',
    ask:         'chat-round-line',
    library:     'folder-with-files',
    governance:  'shield-keyhole',
    share:       'users-group-two-rounded',
    upload:      'cloud-upload',
    create:      'pen-new-square',
    role:        'shield-user',
    tag:         'tag',
    sso:         'login-3',
    code:        'code',
    image:       'gallery',
    sheet:       'chart-2',
    grid:        'widget',
    list:        'list',
    sort:        'sort-vertical',
    pin:         'pin',
    more:        'menu-dots',
    menu:        'hamburger-menu',
    eye:         'eye',
    folder:      'folder',
    star:        'star',
    logout:      'logout-3',
    calendar:    'calendar',
    team:        'users-group-rounded',
  };

  function url(name, hex) {
    const glyph = MAP[name] || 'question-circle';
    return 'https://api.iconify.design/solar:' + glyph + '-bold-duotone.svg?color=' + encodeURIComponent(hex);
  }

  function Icon({ name, size = 16, tone = 'soft', style, alt = '' }) {
    const hex = palette()[tone] || tone; // allow raw hex passthrough
    return React.createElement('img', {
      src: url(name, hex),
      width: size, height: size, alt,
      style: Object.assign({ display: 'block', flexShrink: 0 }, style),
      draggable: false,
    });
  }

  // brand marks for OAuth buttons — real provider logos (Google stays
  // multicolor; GitHub is a silhouette, tinted to the ink ladder).
  function BrandIcon({ name, size = 16, tone = 'ink', style }) {
    const src = name === 'google'
      ? 'https://api.iconify.design/logos:google-icon.svg'
      : 'https://api.iconify.design/simple-icons:github.svg?color=' + encodeURIComponent(palette()[tone] || tone);
    return React.createElement('img', {
      src, width: size, height: size, alt: '',
      style: Object.assign({ display: 'block', flexShrink: 0 }, style),
      draggable: false,
    });
  }

  // brand mark — the platform banner: a pennant of routed shards tapering
  // to a point, with a vermillion dollar-coin rosette. From uploads/strategos.svg,
  // tinted to the Zen-Sumi ink ladder so it follows light/dark themes.
  const MARK_COIN = 'M8.5 15C7.11942 15 6 16.1194 6 17.5C6 18.8806 7.11942 20 8.5 20C9.88058 20 11 18.8806 11 17.5C11 16.1194 9.88058 15 8.5 15ZM8.62444 18.7121L8.62556 18.889C8.62556 18.9135 8.60547 18.9342 8.58092 18.9342H8.42243C8.39788 18.9342 8.37779 18.9141 8.37779 18.8895V18.7143C7.88225 18.6775 7.649 18.3951 7.62388 18.0882C7.62165 18.0619 7.6423 18.0396 7.66853 18.0396H7.92634C7.9481 18.0396 7.96708 18.0552 7.97042 18.0765C7.99888 18.2533 8.13672 18.3856 8.38393 18.4185V17.6222L8.24609 17.5871C7.95424 17.5173 7.67634 17.3354 7.67634 16.9581C7.67634 16.5513 7.98549 16.3326 8.38058 16.2941V16.1099C8.38058 16.0854 8.40067 16.0653 8.42522 16.0653H8.58203C8.60658 16.0653 8.62667 16.0854 8.62667 16.1099V16.2924C9.00893 16.3309 9.29576 16.5541 9.32924 16.9018C9.33203 16.928 9.31138 16.9509 9.2846 16.9509H9.03404C9.01172 16.9509 8.99275 16.9342 8.98996 16.9124C8.96763 16.7494 8.83705 16.6166 8.62444 16.5876V17.3371L8.76618 17.37C9.12779 17.4593 9.37388 17.6323 9.37388 18.0195C9.37388 18.4397 9.06138 18.6741 8.62444 18.7121ZM8.02344 16.9325C8.02344 17.0742 8.11105 17.1842 8.29967 17.2522C8.32589 17.2628 8.35212 17.2712 8.38337 17.2801V16.5882C8.17746 16.6144 8.02344 16.7299 8.02344 16.9325ZM8.67355 17.6869C8.65792 17.6836 8.6423 17.6797 8.62444 17.6747V18.4208C8.86217 18.3996 9.02623 18.269 9.02623 18.0502C9.02623 17.8789 8.9375 17.7673 8.67355 17.6869Z';
  const MARK_TOP   = 'M19.9943 7.27755L5.73779 10.5408L4.06423 7.71041C3.87493 7.39013 4.12675 7 4.52321 7H19.5206C19.7388 7 19.9131 7.11805 19.9943 7.27755Z';
  const MARK_BAND2 = 'M19.9374 8.08333L17.6282 11.989L7.89673 14.2165L5.91797 10.8696L19.952 7.65723C20.0172 7.78575 20.0214 7.94147 19.9374 8.08333Z';
  const MARK_BAND3 = 'M17.5006 12.3486L14.9755 16.6194L9.9661 17.7661L8.04297 14.5135L17.5006 12.3486Z';
  const MARK_TIP   = 'M14.7657 16.998L12.5315 20.7768C12.3558 21.0742 11.8913 21.0742 11.7156 20.7768L10.1113 18.0634L14.7657 16.998Z';
  const MARK_NUB   = 'M9 5.7998C9.55228 5.7998 10 6.24752 10 6.7998H8C8 6.24755 8.44776 5.79985 9 5.7998Z';
  const MARK_ORB   = 'M17.5 3C17.5 3.55228 17.0523 4 16.5 4C15.9477 4 15.5 3.55228 15.5 3C15.5 2.44772 15.9477 2 16.5 2C17.0523 2 17.5 2.44772 17.5 3Z';

  function Mark({ size = 22 }) {
    const I = 'var(--ink)';
    return React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', style: { display: 'block', flexShrink: 0 } },
      React.createElement('path', { d: MARK_TOP, fill: I }),
      React.createElement('path', { d: MARK_BAND2, fill: I, fillOpacity: 0.8 }),
      React.createElement('path', { d: MARK_BAND3, fill: I, fillOpacity: 0.6 }),
      React.createElement('path', { d: MARK_TIP, fill: I, fillOpacity: 0.2 }),
      React.createElement('circle', { cx: 13, cy: 15, r: 1, fill: I, fillOpacity: 0.3 }),
      React.createElement('path', { d: MARK_NUB, fill: I }),
      React.createElement('path', { d: MARK_ORB, fill: I }),
      React.createElement('path', { d: MARK_COIN, fill: 'var(--accent)' })
    );
  }

  window.StrategosIcons = { Icon, BrandIcon, Enso: Mark, Mark, TONE,
    MarkPaths: { coin: MARK_COIN, top: MARK_TOP, band2: MARK_BAND2, band3: MARK_BAND3, tip: MARK_TIP, nub: MARK_NUB, orb: MARK_ORB } };
})();
