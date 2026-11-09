  /* ---------- Small UI helpers ---------- */

  function toast(message, kind = 'info') {
    const host = root.querySelector('#gpv-toasts');
    const item = document.createElement('div');
    item.className = 'gpv-toast' + (kind === 'error' ? ' is-error' : '');
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    item.textContent = message;
    host.append(item);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 280);
    }, kind === 'error' ? 6000 : 3200);
  }

  function announce(message, kind = 'info') {
    updateStatus(message);
    toast(message, kind);
  }

  function setBusy(label) {
    busyDepth += 1;
    const badge = root.querySelector('#gpv-busy');
    root.querySelector('#gpv-busy-label').textContent = label;
    badge.hidden = false;
    return () => {
      busyDepth = Math.max(0, busyDepth - 1);
      if (busyDepth === 0) badge.hidden = true;
    };
  }

  function setButtonText(button, text) {
    const last = button.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.nodeValue = text;
    else button.append(text);
  }

  function showImportErrors(messages) {
    const panel = root.querySelector('#gpv-import-errors');
    panel.hidden = messages.length === 0;
    panel.textContent = messages.length
      ? messages.slice(0, 3).join(' · ') + (messages.length > 3 ? ' · +' + (messages.length - 3) + ' more' : '')
      : '';
    if (messages.length) console.warn('Protein viewer notes:', messages);
  }

  function readJson(key, fallback) {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch (error) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode */ }
  }

  function plddtColor(score) {
    if (score < 50) return '#ff7d45';
    if (score < 70) return '#ffdb13';
    if (score < 90) return '#65cbf3';
    return '#0053d6';
  }

  function modelScores(model) {
    const scores = [];
    model.selectedAtoms({}).forEach(atom => {
      const score = Number(atom.b);
      /* One value per residue: the Cα, or for a nucleotide (an RNA or DNA prediction has no Cα) the C1′.
         A calcium ion is also an atom called CA; it is a HETATM, and not a residue's confidence. */
      if (!atom.hetflag && (atom.atom === 'CA' || atom.atom === "C1'") && Number.isFinite(score)) scores.push(score);
    });
    return scores;
  }

  /* How an experimental structure says what it is: mmCIF _exptl.method or PDB EXPDTA. A crystal
     structure opened from disk has B-factors in the pLDDT column, as a fetched one does; predictions
     either say nothing or say THEORETICAL MODEL. */
  function experimentalMethod(text) {
    const source = String(text || '');
    const inline = source.match(/^_exptl\.method\s+(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/m) || source.match(/^EXPDTA\s+(.+?)\s*$/m);
    /* A loop of several methods (X-ray with neutron, say) is experimental whatever the columns are. */
    const method = inline ? (inline.slice(1).find(value => value) || '').trim() : /^_exptl\.method\s*$/m.test(source) ? 'experimental methods' : '';
    return method && !/theoretical|predict|comput|model/i.test(method) ? method : null;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatMetric(value, digits = 3) {
    const number = finiteNumber(value);
    return number === null ? '—' : number.toFixed(digits);
  }

  /* PAE rows are plain arrays when a small file went through JSON.parse and Float32Array
     rows when a large one went through the byte scanner below; both index the same way. */
  const isMatrixRow = row => Array.isArray(row) || (row !== null && typeof row === 'object' && ArrayBuffer.isView(row));

  function matrixMaximum(matrix) {
    let maximum = 0;
    if (!Array.isArray(matrix)) return maximum;
    matrix.forEach(row => {
      if (!isMatrixRow(row)) return;
      if (Array.isArray(row)) { row.forEach(value => { const number = finiteNumber(value); if (number !== null) maximum = Math.max(maximum, number); }); return; }
      for (let index = 0; index < row.length; index += 1) { const value = row[index]; if (value === value && value > maximum) maximum = value; }
    });
    return maximum;
  }


  /* ---------- Colour words ----------
     The legend text starter (34a) names each key colour in a word — "model_a (purple)" — because a
     figure legend is read in print and in a screen reader, where "#8b5cf6" means nothing. A wrong
     word is worse than a hex code, so the word is chosen perceptually: the colour's CIELAB value is
     compared with a few prototypes per word by CIEDE2000, the difference measure built to match
     what people judge "close", and the nearest prototype names it. Plain RGB or HSL distance put
     pale blue nearer grey and dark orange nearer red than anyone reading the figure would.
     Prototypes are the viewer's own palettes (models, chains, Okabe–Ito, pLDDT, bands) plus the
     CSS primaries, so every colour the viewer draws by default lands on the word its caption uses. */
  function hexToLab(hex) {
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(String(hex || '').trim());
    const value = short ? short.slice(1).map(c => c + c).join('') : (/^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()) || [])[1];
    if (!value) return null;
    const linear = [0, 2, 4].map(offset => { const c = parseInt(value.slice(offset, offset + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    /* sRGB → XYZ (D65), each axis over its white point, then the CIE companding. */
    const xyz = [
      (0.4124 * linear[0] + 0.3576 * linear[1] + 0.1805 * linear[2]) / 0.95047,
      0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2],
      (0.0193 * linear[0] + 0.1192 * linear[1] + 0.9505 * linear[2]) / 1.08883
    ].map(t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
  }
  /* CIEDE2000 (Sharma, Wu & Dalal 2005), checked against their published test pairs. */
  function colourDifference(first, second) {
    const [L1, a1, b1] = first; const [L2, a2, b2] = second; const rad = Math.PI / 180;
    const meanChroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const G = 0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + 25 ** 7)));
    const ap1 = a1 * (1 + G); const ap2 = a2 * (1 + G);
    const C1 = Math.hypot(ap1, b1); const C2 = Math.hypot(ap2, b2);
    const hue = (y, x) => { if (!x && !y) return 0; const h = Math.atan2(y, x) / rad; return h < 0 ? h + 360 : h; };
    const h1 = hue(b1, ap1); const h2 = hue(b2, ap2);
    let dh = 0; if (C1 * C2) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
    const dL = L2 - L1; const dC = C2 - C1; const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh / 2 * rad);
    const Lm = (L1 + L2) / 2; const Cm = (C1 + C2) / 2;
    let hm = h1 + h2; if (C1 * C2) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
    const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    const SL = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2); const SC = 1 + 0.045 * Cm; const SH = 1 + 0.015 * Cm * T;
    const RT = -2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
    return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
  }
  /* Light and dark variants exist where the viewer draws both and a reader must tell them apart —
     pLDDT's light and dark blue, the distance bands' blues, a faded model's pale tint. Indigo is
     here because the chain and domain palettes have one between their blue and their purple, and
     either of those words would name two different colours in one key. */
  const colourWords = [
    ['black', '#000000', '#111827'], ['dark grey', '#4b5563', '#374151'], ['grey', '#9ca3af', '#808080', '#999999'], ['light grey', '#d1d5db', '#e5e7eb'], ['white', '#ffffff', '#f8fafc'],
    ['red', '#dc2626', '#ef4444', '#ff0000', '#e60a0a'], ['dark red', '#991b1b', '#7f1d1d', '#800000'], ['light red', '#f87171', '#fca5a5', '#fa8072'],
    ['pink', '#ec4899', '#f472b6', '#ff69b4', '#cc79a7'], ['light pink', '#fbcfe8', '#ffc0cb'],
    ['orange', '#f97316', '#ff8c00', '#fb923c', '#ff7d45', '#e69f00', '#ffa500'], ['dark orange', '#c2410c', '#d55e00'], ['light orange', '#fdba74', '#fed7aa'],
    ['brown', '#92400e', '#78350f', '#8b4513', '#a0522d'],
    ['yellow', '#facc15', '#ffff00', '#f0e442', '#ffdb13', '#fde725', '#eab308'], ['dark yellow', '#a16207', '#ca8a04', '#808000'], ['pale yellow', '#fef08a', '#fef9c3'],
    ['light green', '#86efac', '#a3e635', '#90ee90', '#bbf7d0'], ['green', '#22c55e', '#16a34a', '#00a000', '#5ec962'], ['dark green', '#166534', '#14532d', '#0f820f'],
    ['teal', '#14b8a6', '#0d9488', '#0f766e', '#008080', '#21918c'], ['cyan', '#06b6d4', '#22d3ee', '#00ffff', '#00dcdc'], ['light cyan', '#a5f3fc', '#cffafe'],
    ['light blue', '#7dd3fc', '#60a5fa', '#56b4e9', '#93c5fd', '#65cbf3'], ['pale blue', '#bfdbfe', '#dbeafe'],
    ['blue', '#2563eb', '#3b82f6', '#0000ff', '#0072b2'], ['dark blue', '#1e3a8a', '#1e40af', '#000080', '#0053d6'],
    ['indigo', '#4f46e5', '#6366f1', '#4338ca'],
    ['purple', '#a855f7', '#8b5cf6', '#7c3aed', '#800080'], ['dark purple', '#4c1d95', '#440154'], ['light purple', '#d8b4fe', '#c4b5fd', '#e9d5ff'],
    ['magenta', '#d946ef', '#c026d3', '#ff00ff']
  ].map(([name, ...prototypes]) => ({ name, labs: prototypes.map(hexToLab) }));
  /* The word for a colour; anything that is not a hex colour comes back as it was given. */
  function colourName(hex) {
    const lab = hexToLab(hex); if (!lab) return String(hex || '');
    let best = ''; let nearest = Infinity;
    colourWords.forEach(word => word.labs.forEach(prototype => { const distance = colourDifference(lab, prototype); if (distance < nearest) { nearest = distance; best = word.name; } }));
    return best;
  }
