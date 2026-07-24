/* Strategos experience map — render. Vanilla, builds personas + flows + focus. */
(function () {
  const J = window.STRATEGOS_JOURNEYS;
  const FOCUS = window.STRATEGOS_FOCUS;
  const root = document.getElementById('personas');

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const kan = (c) => `<span class="zs-kanji">${c}</span>`;

  const curves = [];

  J.forEach((p) => {
    const sec = el('section', 'persona');

    // ── head
    const head = el('div', 'persona-head');
    head.innerHTML = `<span class="persona-kanji">${p.kanji}</span>
      <div><div class="persona-name">${p.name}</div>
      <div class="persona-sub">${p.sub}</div></div>`;
    sec.appendChild(head);

    // ── persona card
    const card = el('div', 'persona-card');
    card.innerHTML = `
      <div><h5>Who they are</h5><p>${p.who}</p></div>
      <div><h5>What they want</h5><p>${p.goal}</p></div>
      <div><h5>In their words</h5><p class="quote">${p.quote}</p></div>`;
    sec.appendChild(card);

    // ── emotional curve
    const cw = el('div', 'curve-wrap');
    cw.innerHTML = `<div class="curve-cap">Felt confidence across the journey</div>`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'curve-svg');
    cw.appendChild(svg);
    sec.appendChild(cw);
    curves.push({ svg, stages: p.stages });

    // ── journey grid (row-major: cells emitted row-by-row so each
    //    grid row stretches to the tallest cell across all columns)
    const overflow = el('div', 'grid-overflow');
    const grid = el('div', 'grid-stages');
    const n = p.stages.length;
    grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    const rowDefs = [
      { type: 'head' },
      { type: 'does',   label: 'Does' },
      { type: 'thinks', label: 'Thinks' },
      { type: 'touch',  label: 'Touchpoints' },
      { type: 'note', kind: 'fr', mk: '▲', key: 'friction' },
      { type: 'note', kind: 'op', mk: '●', key: 'opportunity' },
      { type: 'note', kind: 'gp', mk: '◇', key: 'gap' }
    ];
    rowDefs.forEach((row, ri) => {
      p.stages.forEach((s, ci) => {
        const edge = (ci < n - 1 ? ' bx' : '') + (ri < rowDefs.length - 1 ? ' by' : '');
        let cell;
        if (row.type === 'head') {
          cell = el('div', 'gcell stage-head' + edge);
          cell.innerHTML = `<span class="k">${s.kanji}</span>
            <div><div class="stage-no">${s.no}</div><div class="stage-name">${s.name}</div></div>`;
        } else if (row.type === 'does') {
          cell = el('div', 'gcell cell' + edge);
          cell.innerHTML = `<div class="cell-label">${row.label}</div><ul>${s.does.map((d) => `<li>${d}</li>`).join('')}</ul>`;
        } else if (row.type === 'thinks') {
          cell = el('div', 'gcell cell' + edge);
          cell.innerHTML = `<div class="cell-label">${row.label}</div><p class="think">${s.thinks}</p>`;
        } else if (row.type === 'touch') {
          cell = el('div', 'gcell cell' + edge);
          cell.innerHTML = `<div class="cell-label">${row.label}</div><div class="chips">${s.touch.map((t) => `<span class="chip">${t}</span>`).join('')}</div>`;
        } else {
          cell = el('div', `gcell cell note note-${row.kind}` + edge);
          const done = s.resolved && s.resolved[row.key];
          const doneHtml = done ? `<span class="done">✓ Shipped — ${done}</span>` : '';
          cell.innerHTML = `<span class="nm">${row.mk}</span><span class="nt">${s[row.key]}${doneHtml}</span>`;
        }
        grid.appendChild(cell);
      });
    });
    overflow.appendChild(grid);
    sec.appendChild(overflow);

    // ── flows
    const flows = el('div', 'flows');
    flows.innerHTML = `<div class="flows-title">${kan('流')}<h3>Key flows</h3></div>`;
    p.flows.forEach((f) => {
      const fl = el('div', 'flow');
      const fhead = el('div', 'flow-head');
      fhead.innerHTML = `<h4>${f.title}</h4><p>${f.note}</p>`;
      fl.appendChild(fhead);
      const line = el('div', 'flow-line');
      f.steps.forEach((step, i) => {
        const cls = 'node' + (step.kind === 'decision' ? ' decision' : step.kind === 'terminal' ? ' terminal' : '');
        const node = el('div', cls);
        let inner = '';
        if (step.flag) inner += `<span class="flag" title="Friction point">▲</span>`;
        if (step.kind === 'decision' && step.tag) inner += `<span class="ntag">${step.tag}</span>`;
        inner += `<span class="nlabel">${step.label}</span>`;
        if (step.sub) inner += `<span class="nsub">${step.sub}</span>`;
        node.innerHTML = inner;
        line.appendChild(node);
        if (i < f.steps.length - 1) line.appendChild(el('span', 'arrow', '→'));
      });
      fl.appendChild(line);
      flows.appendChild(fl);
    });
    sec.appendChild(flows);

    root.appendChild(sec);
  });

  // ── focus section
  const focus = document.getElementById('focus');
  focus.innerHTML = `<h2>${FOCUS.title}</h2><p class="focus-sub">${FOCUS.sub}</p>`;
  const fg = el('div', 'focus-grid');
  FOCUS.cards.forEach((c) => {
    const fc = el('div', 'focus-card');
    const dot = c.tone === 'fr' ? 'background: var(--warning);' : 'background: var(--accent);';
    const tags = c.tags.map((t) => `<span class="chip">${t}</span>`).join('');
    const done = c.done ? `<span style="margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-size:var(--text-xs); color:var(--success); font-weight:600;">✓ Shipped</span>` : '';
    fc.innerHTML = `
      <div class="focus-rank"><span class="zs-dot" style="${dot}"></span>${c.rank}${done}</div>
      <h4>${c.title}</h4><p>${c.body}</p>
      <div class="focus-tags">${tags}</div>`;
    fg.appendChild(fc);
  });
  focus.appendChild(fg);

  // ── draw curves (responsive)
  function drawCurve({ svg, stages }) {
    const W = svg.clientWidth || 1000;
    const H = 128, top = 26, bottom = 40;
    const n = stages.length;
    const pts = stages.map((s, i) => ({
      x: W * (i + 0.5) / n,
      y: top + (1 - s.emo) * (H - top - bottom),
      s
    }));
    const minEmo = Math.min(...stages.map((s) => s.emo));

    // smooth path
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) / 2;
      d += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
    }

    let svgHtml = '';
    // baseline
    svgHtml += `<line x1="0" y1="${H - bottom + 14}" x2="${W}" y2="${H - bottom + 14}" stroke="var(--paper-edge)" stroke-width="1"/>`;
    // curve
    svgHtml += `<path d="${d}" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-linecap="round"/>`;
    // points + labels
    pts.forEach((pt) => {
      const low = pt.s.emo <= minEmo + 0.001;
      svgHtml += `<line x1="${pt.x}" y1="${pt.y}" x2="${pt.x}" y2="${H - bottom + 14}" stroke="var(--paper-edge)" stroke-width="1" stroke-dasharray="2 3"/>`;
      if (low) svgHtml += `<circle cx="${pt.x}" cy="${pt.y}" r="6.5" fill="none" stroke="var(--accent)" stroke-width="1.25"/>`;
      svgHtml += `<circle cx="${pt.x}" cy="${pt.y}" r="3.5" fill="${low ? 'var(--accent)' : 'var(--ink-soft)'}"/>`;
      svgHtml += `<text class="emo-label" x="${pt.x}" y="${pt.y - 13}" text-anchor="middle" ${low ? 'fill="var(--accent)"' : ''}>${pt.s.emoLabel}</text>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = svgHtml;
  }

  function redraw() { curves.forEach(drawCurve); }
  redraw();
  window.addEventListener('resize', () => { clearTimeout(window.__cz); window.__cz = setTimeout(redraw, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
})();
