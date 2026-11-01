  /* ---------- Contact and distance map ----------
     Residue pairs of two chains whose atoms come within a cutoff, drawn as a map with the
     first chain down the side and the second along the top. The same heavy-atom distance
     rule as the proximity tool, so the numbers cross-validate the same way.
     Grown in 2.50.0 into a distance map: the two axes may be the same chain (the square
     residue–residue map of one chain) or every chain of the model laid end to end, and the
     *All distances* view colours every pair by its Cα–Cα distance, not only the pairs in
     contact — "distances between residues that interact and ones that do not". Contacts are
     still what the cutoff defines; the Cα–Cα distances are worked out from coordinates copied
     into Float64Arrays, cell by cell when they are needed, so no matrix of millions of numbers
     is ever held. */
  let contactResult = null;
  /* The value of the "All chains" option of both chain selects; no chain identifier is this. */
  const contactAllChains = '*all*';
  /* Above this many residues on either axis the heavy-atom search is skipped for Cα only. */
  const contactHeavyLimit = 1500;
  /* The distances CSV of a big all-chains map would run to tens of millions of rows. */
  const contactCsvRowCap = 2000000;

  /* Highlight and the contacts CSV need contacts; the PNG and the distances CSV need only a map. */
  function setContactButtons() {
    const hasMap = Boolean(contactResult); const hasPairs = hasMap && contactResult.pairs.size > 0;
    root.querySelector('#gpv-contact-highlight').disabled = !hasPairs;
    root.querySelector('#gpv-contact-csv').disabled = !hasPairs;
    root.querySelector('#gpv-contact-png').disabled = !hasMap;
    root.querySelector('#gpv-contact-distances').disabled = !hasMap;
  }

  function contactChainOptions(entry) {
    const first = root.querySelector('#gpv-contact-a'); const second = root.querySelector('#gpv-contact-b');
    const rows = entry && entry.model ? residueRows(entry) : [];
    const previous = [first.value, second.value];
    const total = rows.reduce((sum, row) => sum + row.residues.length, 0);
    [first, second].forEach((select, index) => {
      select.replaceChildren();
      rows.forEach(row => { const option = document.createElement('option'); option.value = row.chain; option.textContent = (row.chain || '—') + ' · ' + row.residues.length + ' aa'; select.append(option); });
      if (rows.length) { const option = document.createElement('option'); option.value = contactAllChains; option.textContent = 'All chains · ' + total + ' aa'; select.append(option); }
      const kept = previous[index] === contactAllChains ? rows.length > 0 : rows.some(row => row.chain === previous[index]);
      if (kept) select.value = previous[index]; else if (rows[Math.min(index, rows.length - 1)]) select.value = rows[Math.min(index, rows.length - 1)].chain;
    });
    /* One chain is enough now: against itself it is the familiar intra-chain map. */
    const ready = rows.length >= 1;
    root.querySelector('#gpv-contact-run').disabled = !ready;
    if (contactResult && (!entry || contactResult.entryId !== entry.id)) {
      contactResult = null; root.querySelector('#gpv-contact-wrap').hidden = true; setContactButtons();
    }
    if (!contactResult) root.querySelector('#gpv-contact-state').textContent = !entry || !entry.model ? 'Show a model to map its residue contacts and distances.' : ready ? 'Choose two chains — the same chain twice for an intra-chain map, or All chains — and compute.' : displayName(entry) + ' has no polymer chain to map.';
  }

  /* One axis of the map: a chain's residues, or every chain's end to end, each residue stood for
     by the atom the sequence strip uses (the Cα, else a nucleotide's P), with the chain blocks
     for the dividers, a chain|resi index for the contact search, and the coordinates the Cα–Cα
     distances are read from. */
  function contactAxis(entry, value) {
    const all = value === contactAllChains;
    const rows = residueRows(entry).filter(row => all || row.chain === value);
    const residues = []; const blocks = [];
    rows.forEach(row => { blocks.push({ chain: row.chain, start: residues.length, end: residues.length + row.residues.length }); residues.push(...row.residues); });
    const index = new Map(residues.map((atom, i) => [(atom.chain || '') + '|' + atom.resi, i]));
    const x = new Float64Array(residues.length); const y = new Float64Array(residues.length); const z = new Float64Array(residues.length);
    residues.forEach((atom, i) => { x[i] = atom.x; y[i] = atom.y; z[i] = atom.z; });
    return { value, all, chain: value, residues, blocks, index, x, y, z };
  }

  function contactAxisName(axisValue) {
    return axisValue === contactAllChains ? 'all chains' : 'chain ' + (axisValue || '—');
  }

  /* Cα–Cα distance of cell (i, j), straight from the copied coordinates. */
  function contactCaDistance(i, j) {
    const a = contactResult.axisA; const b = contactResult.axisB;
    const dx = a.x[i] - b.x[j]; const dy = a.y[i] - b.y[j]; const dz = a.z[i] - b.z[j];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* The closest-atom distance of a pair in contact, or undefined. A symmetric map keeps each
     unordered pair once, under its smaller index first. */
  function contactPairDistance(i, j) {
    if (contactResult.symmetric && j < i) return contactResult.pairs.get(j + '|' + i);
    return contactResult.pairs.get(i + '|' + j);
  }

  function computeContacts() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const chainA = root.querySelector('#gpv-contact-a').value; const chainB = root.querySelector('#gpv-contact-b').value;
    const requested = root.querySelector('#gpv-contact-atoms').value;
    const cutoff = Math.min(15, Math.max(3, Number(root.querySelector('#gpv-contact-cutoff').value) || 4.5));
    root.querySelector('#gpv-contact-cutoff').value = String(cutoff);
    const axisA = contactAxis(entry, chainA);
    /* The same chain twice is one axis, square and symmetric about its diagonal. */
    const symmetric = chainA === chainB;
    const axisB = symmetric ? axisA : contactAxis(entry, chainB);
    if (axisA.residues.length < 1 || axisB.residues.length < 1) return;
    const n = axisA.residues.length; const m = axisB.residues.length;
    /* A heavy-atom search of every residue against every other over thousands of residues is the
       one slow part; above the limit the map says it used Cα atoms instead. */
    const caForced = requested === 'heavy' && Math.max(n, m) > contactHeavyLimit;
    const mode = caForced ? 'ca' : requested;
    const chainsOf = axis => new Set(axis.blocks.map(block => block.chain));
    const pick = chains => heavyAtoms(entry).filter(atom => !atom.hetflag && !isWater(atom) && chains.has(atom.chain || '') && (mode === 'heavy' || atom.atom === 'CA'));
    const atomsA = pick(chainsOf(axisA)); const atomsB = symmetric ? atomsA : pick(chainsOf(axisB));
    const grid = spatialGrid(atomsB, cutoff); const limit = cutoff * cutoff;
    const pairs = new Map();
    atomsA.forEach(a => {
      const i = axisA.index.get((a.chain || '') + '|' + a.resi); if (i === undefined) return;
      grid.near(a).forEach(k => {
        const b = atomsB[k];
        const j = axisB.index.get((b.chain || '') + '|' + b.resi); if (j === undefined) return;
        /* A residue is never in contact with itself (the diagonal stays empty), and a symmetric
           map keeps each unordered pair once. */
        if (symmetric ? j <= i : axisA.residues[i] === axisB.residues[j]) return;
        const d2 = squaredDistance(a, b); if (d2 > limit) return;
        const key = i + '|' + j; const d = Math.sqrt(d2);
        if (!pairs.has(key) || pairs.get(key) > d) pairs.set(key, d);
      });
    });
    /* Interface residues per side; for a symmetric map both sides are the same set. */
    const sideA = new Set(); const sideB = new Set();
    pairs.forEach((d, key) => { const [i, j] = key.split('|').map(Number); sideA.add(i); sideB.add(j); if (symmetric) { sideA.add(j); sideB.add(i); } });
    const interfaceOf = (axis, side) => [...side].sort((x, y) => x - y).map(i => ({ chain: axis.residues[i].chain || '', resi: axis.residues[i].resi }));
    const interfaceA = interfaceOf(axisA, sideA); const interfaceB = interfaceOf(axisB, sideB);
    /* The scale of the All distances view: 0 Å to the largest distance on the map, at most 40 Å,
       so a large assembly's long distances do not wash out the contacts. */
    let caMax = 0;
    for (let i = 0; i < n; i += 1) {
      const ax = axisA.x[i]; const ay = axisA.y[i]; const az = axisA.z[i];
      for (let j = symmetric ? i + 1 : 0; j < m; j += 1) {
        const dx = ax - axisB.x[j]; const dy = ay - axisB.y[j]; const dz = az - axisB.z[j];
        const d2 = dx * dx + dy * dy + dz * dz; if (d2 > caMax) caMax = d2;
      }
    }
    caMax = Math.sqrt(caMax);
    contactResult = {
      entryId: entry.id, chainA, chainB, rowA: { chain: chainA, residues: axisA.residues }, rowB: { chain: chainB, residues: axisB.residues }, mode, cutoff, pairs,
      residuesA: interfaceA.map(item => item.resi), residuesB: interfaceB.map(item => item.resi),
      /* 2.50.0 */
      requestedMode: requested, caForced, symmetric, allChainsA: axisA.all, allChainsB: axisB.all, axisA, axisB, interfaceA, interfaceB,
      caMax, scaleMax: Math.min(40, caMax) || 1, view: root.querySelector('#gpv-contact-view').value === 'distances' ? 'distances' : 'contacts', lastScale: null
    };
    drawContactMap(root.querySelector('#gpv-contact-canvas'));
    const modeText = mode === 'ca' ? 'Cα–Cα' : 'any heavy atom';
    const sides = symmetric
      ? interfaceA.length + ' residue' + (interfaceA.length === 1 ? '' : 's') + ' of ' + contactAxisName(chainA) + ' in contact'
      : interfaceA.length + ' interface residue' + (interfaceA.length === 1 ? '' : 's') + ' on ' + contactAxisName(chainA) + ', ' + interfaceB.length + ' on ' + contactAxisName(chainB);
    root.querySelector('#gpv-contact-state').textContent = pairs.size + ' residue pair' + (pairs.size === 1 ? '' : 's') + ' within ' + cutoff + ' Å (' + modeText + ') · ' + sides
      + ' · Cα–Cα up to ' + caMax.toFixed(1) + ' Å over ' + n + ' × ' + m + ' residues'
      + (caForced ? ' · Cα only: over ' + contactHeavyLimit.toLocaleString('en-US') + ' residues on an axis the heavy-atom search would be too slow' : '');
    setContactButtons();
    root.querySelector('#gpv-contact-wrap').hidden = false;
    root.querySelector('#gpv-contact-readout').textContent = 'Hover a cell to read the pair and its Cα–Cα distance · click a cell to measure that distance on the model';
    updateStatus('Contact map: ' + pairs.size + ' residue pairs ' + (symmetric ? 'within ' + contactAxisName(chainA) : 'between ' + contactAxisName(chainA) + ' and ' + contactAxisName(chainB)) + ' within ' + cutoff + ' Å' + (caForced ? ' (Cα only above ' + contactHeavyLimit + ' residues)' : ''));
  }

  function setContactView() {
    if (!contactResult) return;
    contactResult.view = root.querySelector('#gpv-contact-view').value === 'distances' ? 'distances' : 'contacts';
    drawContactMap(root.querySelector('#gpv-contact-canvas'));
    renderCompositeControls();
  }

  /* Up to 1 200 residues a side a cell is a whole number of pixels, 2–12, as it always was; beyond
     that the map is held to 2 400 px a side, so a figure at three times that still fits a canvas. */
  function contactCell(canvas) {
    const side = Math.max(contactResult.rowA.residues.length, contactResult.rowB.residues.length);
    return side <= 1200 ? Math.max(2, Math.min(12, Math.floor(560 / side))) : 2400 / side;
  }

  function contactScaleText(value) {
    return (Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1)) + ' Å';
  }

  /* The All distances view, one pixel per residue pair painted into an image and drawn scaled up
     without smoothing — millions of fillRects would take seconds. Above 2 000 residues a side
     every k-th residue is sampled so the image stays a few million pixels. A residue against
     itself is left transparent, so the paper shows through the diagonal. */
  function paintContactDistances(context, left, top, width, height, near, far) {
    const { rowA, rowB, scaleMax, symmetric } = contactResult;
    const n = rowA.residues.length; const m = rowB.residues.length;
    const stride = Math.max(1, Math.ceil(Math.max(n, m) / 2000));
    const w = Math.ceil(m / stride); const h = Math.ceil(n / stride);
    const image = document.createElement('canvas'); image.width = w; image.height = h;
    const imageContext = image.getContext('2d'); const pixels = imageContext.createImageData(w, h); const data = pixels.data;
    const ramp = []; for (let k = 0; k < 256; k += 1) { const hex = mixHex(near, far, k / 255); ramp.push([1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16))); }
    for (let r = 0; r < h; r += 1) {
      const i = r * stride;
      for (let c = 0; c < w; c += 1) {
        const j = c * stride; const at = (r * w + c) * 4;
        if (symmetric ? i === j : rowA.residues[i] === rowB.residues[j]) { data[at + 3] = 0; continue; }
        const colour = ramp[Math.round(Math.min(1, contactCaDistance(i, j) / scaleMax) * 255)];
        data[at] = colour[0]; data[at + 1] = colour[1]; data[at + 2] = colour[2]; data[at + 3] = 255;
      }
    }
    imageContext.putImageData(pixels, 0, 0);
    context.save(); context.imageSmoothingEnabled = false; context.drawImage(image, left, top, width, height); context.restore();
  }

  /* Rows: chain A residues (top to bottom); columns: chain B residues (left to right).
     Closer pairs are darker. With `figure` the map gets margins, ticks, titles and a scale. */
  function drawContactMap(canvas, figure = false, scale = 1) {
    if (!contactResult) return;
    const { rowA, rowB, pairs, cutoff, chainA, chainB, symmetric, view } = contactResult;
    const n = rowA.residues.length; const m = rowB.residues.length;
    const cell = contactCell(canvas) * scale;
    const margin = figure ? { left: 72 * scale, top: 54 * scale, right: 24 * scale, bottom: 64 * scale } : { left: 0, top: 0, right: 0, bottom: 0 };
    canvas.width = Math.round(m * cell + margin.left + margin.right); canvas.height = Math.round(n * cell + margin.top + margin.bottom);
    const context = canvas.getContext('2d');
    const palette = figure ? { paper: '#ffffff', ink: '#111827', grid: '#e5e7eb' } : { paper: themeColor('--card', '#ffffff'), ink: themeColor('--foreground', '#111827'), grid: themeColor('--border', '#e5e7eb') };
    context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height);
    const near = '#1e3a8a'; const far = '#bfdbfe';
    const distances = view === 'distances';
    if (distances) paintContactDistances(context, margin.left, margin.top, m * cell, n * cell, near, far);
    else {
      const paint = (i, j, distance) => { context.fillStyle = mixHex(near, far, Math.max(0, Math.min(1, distance / cutoff))); context.fillRect(margin.left + j * cell, margin.top + i * cell, Math.max(1, cell), Math.max(1, cell)); };
      /* A symmetric map holds each pair once; it is drawn on both sides of the diagonal. */
      pairs.forEach((distance, key) => { const [i, j] = key.split('|').map(Number); paint(i, j, distance); if (symmetric) paint(j, i, distance); });
    }
    const step = n > 400 || m > 400 ? 100 : n > 150 || m > 150 ? 50 : n > 60 || m > 60 ? 25 : 10;
    context.strokeStyle = palette.grid; context.lineWidth = 1;
    rowB.residues.forEach((atom, j) => { if (atom.resi % step === 0) { context.beginPath(); context.moveTo(margin.left + j * cell + 0.5, margin.top); context.lineTo(margin.left + j * cell + 0.5, margin.top + n * cell); context.stroke(); } });
    rowA.residues.forEach((atom, i) => { if (atom.resi % step === 0) { context.beginPath(); context.moveTo(margin.left, margin.top + i * cell + 0.5); context.lineTo(margin.left + m * cell, margin.top + i * cell + 0.5); context.stroke(); } });
    /* Chains laid end to end are told apart by a thin divider drawn over the cell boundary, not
       a gap, so a pointer position still maps straight onto a residue pair. */
    context.save(); context.strokeStyle = palette.ink; context.globalAlpha = 0.55; context.lineWidth = Math.max(1, scale);
    contactResult.axisB.blocks.forEach(block => { if (!block.start) return; const x = margin.left + block.start * cell; context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, margin.top + n * cell); context.stroke(); });
    contactResult.axisA.blocks.forEach(block => { if (!block.start) return; const y = margin.top + block.start * cell; context.beginPath(); context.moveTo(margin.left, y); context.lineTo(margin.left + m * cell, y); context.stroke(); });
    context.restore();
    if (!figure) return;
    const font = figureFont(); const size = 11 * scale;
    context.fillStyle = palette.ink; context.font = size + 'px ' + font; context.textAlign = 'center'; context.textBaseline = 'top';
    rowB.residues.forEach((atom, j) => { if (atom.resi % step === 0) context.fillText(String(atom.resi), margin.left + j * cell + cell / 2, margin.top + n * cell + 6 * scale); });
    context.textAlign = 'right'; context.textBaseline = 'middle';
    rowA.residues.forEach((atom, i) => { if (atom.resi % step === 0) context.fillText(String(atom.resi), margin.left - 6 * scale, margin.top + i * cell + cell / 2); });
    const axisTitle = axis => (axis.all ? 'Residue · chains ' + axis.blocks.map(block => block.chain || '—').join(' | ') : 'Chain ' + (axis.chain || '—') + ' residue');
    context.font = '600 ' + (12 * scale) + 'px ' + font; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
    context.fillText(truncateToWidth(context, axisTitle(contactResult.axisB), Math.max(60, m * cell)), margin.left + m * cell / 2, canvas.height - 14 * scale);
    context.save(); context.translate(18 * scale, margin.top + n * cell / 2); context.rotate(-Math.PI / 2); context.fillText(truncateToWidth(context, axisTitle(contactResult.axisA), Math.max(60, n * cell)), 0, 0); context.restore();
    context.font = '600 ' + (13 * scale) + 'px ' + font; context.textAlign = 'left';
    const entry = entryById(contactResult.entryId);
    const what = distances
      ? 'Cα–Cα distances · ' + n + ' × ' + m + ' residues'
      : 'contacts within ' + cutoff + ' Å (' + (contactResult.mode === 'ca' ? 'Cα–Cα' : 'any heavy atom') + ') · ' + pairs.size + ' pairs';
    context.fillText(truncateToWidth(context, (entry ? displayName(entry) + ' · ' : '') + what, Math.max(60, canvas.width - margin.left - margin.right - 140 * scale)), margin.left, 22 * scale);
    /* distance scale: 0 Å to the cutoff for contacts, to the scale maximum for all distances */
    const maximum = distances ? contactResult.scaleMax : cutoff;
    const barX = canvas.width - margin.right - 120 * scale; const barY = 32 * scale; const barW = 100 * scale; const barH = 8 * scale;
    for (let x = 0; x < barW; x += 1) { context.fillStyle = mixHex(near, far, x / barW); context.fillRect(barX + x, barY, 1, barH); }
    context.font = (10 * scale) + 'px ' + font; context.fillStyle = palette.ink; context.textAlign = 'left'; context.textBaseline = 'top';
    const labels = ['0 Å', distances ? contactScaleText(maximum) : cutoff + ' Å'];
    context.fillText(labels[0], barX, barY + barH + 2 * scale); context.textAlign = 'right'; context.fillText(labels[1], barX + barW, barY + barH + 2 * scale);
    /* What the last figure's scale read, for the regression suite (a PNG cannot be read back). */
    contactResult.lastScale = { view: distances ? 'distances' : 'contacts', labels, maximum };
  }

  function contactAt(event) {
    if (!contactResult) return null;
    const canvas = root.querySelector('#gpv-contact-canvas'); const rect = canvas.getBoundingClientRect();
    const n = contactResult.rowA.residues.length; const m = contactResult.rowB.residues.length;
    const i = Math.floor((event.clientY - rect.top) / rect.height * n); const j = Math.floor((event.clientX - rect.left) / rect.width * m);
    if (i < 0 || j < 0 || i >= n || j >= m) return null;
    const a = contactResult.rowA.residues[i]; const b = contactResult.rowB.residues[j];
    return { i, j, a, b, same: a === b, distance: contactPairDistance(i, j), ca: contactCaDistance(i, j) };
  }

  /* `A:GLU 57 — B:ARG 59 · Cα–Cα 9.42 Å · closest atoms 3.12 Å`, or `· no contact within 4.5 Å`. */
  function contactPairText(hit) {
    const label = atom => (atom.chain ? atom.chain + ':' : '') + (atom.resn || '') + ' ' + atom.resi;
    if (hit.same) return label(hit.a) + ' — the same residue';
    const pair = (hit.a.atom === 'CA' && hit.b.atom === 'CA' ? 'Cα–Cα ' : 'Cα–Cα (or P) ') + hit.ca.toFixed(2) + ' Å';
    if (hit.distance === undefined) return label(hit.a) + ' — ' + label(hit.b) + ' · ' + pair + ' · no contact within ' + contactResult.cutoff + ' Å';
    return label(hit.a) + ' — ' + label(hit.b) + ' · ' + pair + ' · ' + (contactResult.mode === 'ca' ? 'contact (Cα within ' + contactResult.cutoff + ' Å)' : 'closest atoms ' + hit.distance.toFixed(2) + ' Å');
  }

  /* A click on any cell draws that pair's distance on the model as an ordinary measurement record
     between the two Cα atoms (the helper Measure to… uses, 04c), selects the first residue and
     zooms to both — so the distance between two residues that do not touch is one click away.
     Selection goes through selectResidue, not handleAtomClick, so measurement mode or drawing
     does not also take the click as a point of its own. */
  function measureContactCell(event) {
    const hit = contactAt(event); if (!hit) return;
    const entry = entryById(contactResult.entryId); if (!entry || !entry.model) return;
    if (hit.same) { updateStatus(contactPairText(hit) + ' · nothing to measure'); return; }
    cancelMeasureTo(false);
    selectResidue(entry, hit.a);
    const made = measureResiduePair(entry, hit.a, entry, hit.b);
    const selection = { model: entry.model.getID(), or: [{ chain: hit.a.chain, resi: hit.a.resi }, { chain: hit.b.chain, resi: hit.b.resi }] };
    try { viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer); } catch (error) { /* selection syntax unsupported: keep the current view */ }
    updateStatus(made ? labelEditorDefaultText(made.first) + ' — ' + made.summary + ' · measured' : contactPairText(hit) + ' · selected');
  }

  function highlightContactInterface() {
    if (!contactResult) return;
    const entry = entryById(contactResult.entryId); if (!entry) return;
    remember('interface highlight');
    const color = root.querySelector('#gpv-interface-color').value;
    /* One selection per chain, first axis first — two for a pair of chains, as always; one for an
       intra-chain map; one per chain involved when an axis is all chains. */
    const byChain = new Map();
    [...contactResult.interfaceA, ...contactResult.interfaceB].forEach(item => { if (!byChain.has(item.chain)) byChain.set(item.chain, new Set()); byChain.get(item.chain).add(item.resi); });
    byChain.forEach((residues, chain) => selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain, residues: [...residues].sort((x, y) => x - y), action: 'highlight', color }));
    renderSelectionList(); applyStyle();
    updateStatus('Interface highlighted · ' + [...byChain.entries()].map(([chain, residues], index) => residues.size + (index ? '' : ' residue' + (residues.size === 1 ? '' : 's')) + ' on chain ' + (chain || '—')).join(', '));
  }

  function downloadContactsCsv() {
    if (!contactResult) return;
    const entry = entryById(contactResult.entryId);
    const rows = [['model', 'chain_a', 'resi_a', 'resn_a', 'chain_b', 'resi_b', 'resn_b', 'min_distance_angstrom', 'atoms', 'cutoff_angstrom']];
    /* Positions along the axes are residue order, chain by chain, so they sort an all-chains map too. */
    [...contactResult.pairs.entries()].map(([key, d]) => { const [i, j] = key.split('|').map(Number); return { i, j, a: contactResult.rowA.residues[i], b: contactResult.rowB.residues[j], d }; })
      .sort((x, y) => x.i - y.i || x.j - y.j)
      .forEach(pair => rows.push([entry ? displayName(entry) : '', pair.a.chain || '', pair.a.resi, pair.a.resn || '', pair.b.chain || '', pair.b.resi, pair.b.resn || '', pair.d.toFixed(3), contactResult.mode === 'ca' ? 'CA' : 'heavy', contactResult.cutoff]));
    downloadBlob(rows.map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv', 'contacts-' + contactFileTag() + '.csv');
    updateStatus('Contacts CSV downloaded · ' + contactResult.pairs.size + ' pairs');
  }

  function contactFileTag() {
    const tag = value => (value === contactAllChains ? 'all' : value || 'x');
    return tag(contactResult.chainA) + '-' + tag(contactResult.chainB);
  }

  /* Every pair of the map in long form, residue order (rows first, then columns), whatever the
     view. A symmetric map writes each unordered pair once and never a residue with itself, so an
     intra-chain map of n residues gives n(n−1)/2 rows; a map of two different axes gives n × m,
     less any residue that is on both. The closest heavy-atom distance is known only for pairs in
     contact, so it is blank outside the cutoff; on a Cα map it is the Cα distance itself. Capped at
     2 000 000 rows; the text is built in chunks so no single string holds the file. */
  function downloadDistancesCsv() {
    if (!contactResult) return;
    const { rowA, rowB, symmetric, mode } = contactResult;
    const entry = entryById(contactResult.entryId);
    const n = rowA.residues.length; const m = rowB.residues.length;
    const onB = new Set(rowB.residues);
    const total = symmetric ? n * (n - 1) / 2 : n * m - rowA.residues.filter(atom => onB.has(atom)).length;
    const model = csvCell(entry ? displayName(entry) : '');
    const prefix = atom => csvCell(atom.chain || '') + ',' + csvCell(atom.resi) + ',' + csvCell(atom.resn || '');
    const columns = rowB.residues.map(prefix);
    const parts = [['model', 'chain_a', 'resi_a', 'resn_a', 'chain_b', 'resi_b', 'resn_b', 'ca_distance_angstrom', 'min_heavy_distance_angstrom'].map(csvCell).join(',')];
    let chunk = []; let written = 0;
    outer: for (let i = 0; i < n; i += 1) {
      const head = model + ',' + prefix(rowA.residues[i]) + ',';
      for (let j = symmetric ? i + 1 : 0; j < m; j += 1) {
        if (!symmetric && rowA.residues[i] === rowB.residues[j]) continue;
        if (written >= contactCsvRowCap) break outer;
        const ca = contactCaDistance(i, j);
        const heavy = mode === 'ca' ? ca : contactPairDistance(i, j);
        chunk.push(head + columns[j] + ',' + csvCell(ca.toFixed(3)) + ',' + csvCell(heavy === undefined ? '' : heavy.toFixed(3)));
        written += 1;
        if (chunk.length >= 20000) { parts.push('\n' + chunk.join('\n')); chunk = []; }
      }
    }
    if (chunk.length) parts.push('\n' + chunk.join('\n'));
    downloadBlob(new Blob(parts, { type: 'text/csv' }), 'text/csv', 'distances-' + contactFileTag() + '.csv');
    const count = value => value.toLocaleString('en-US');
    updateStatus(written < total
      ? 'Distances CSV downloaded · the first ' + count(written) + ' of ' + count(total) + ' residue pairs — capped at ' + count(contactCsvRowCap) + ' rows; map fewer chains for the rest'
      : 'Distances CSV downloaded · ' + count(written) + ' residue pairs');
  }

  async function downloadContactPng() {
    if (!contactResult) return;
    const canvas = document.createElement('canvas');
    drawContactMap(canvas, true, 3);
    downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), 300), 'image/png', (contactResult.view === 'distances' ? 'distance-map-' : 'contact-map-') + contactFileTag() + '.png');
    updateStatus((contactResult.view === 'distances' ? 'Distance' : 'Contact') + ' map PNG downloaded · ' + canvas.width + ' × ' + canvas.height + ' at 300 dpi');
  }

  /* The composite figure's caption for the map panel. */
  function contactCaption() {
    if (!contactResult) return '';
    const { chainA, chainB, symmetric } = contactResult;
    const between = symmetric ? 'within ' + contactAxisName(chainA) : 'between ' + (chainA !== contactAllChains && chainB !== contactAllChains ? 'chains ' + (chainA || '—') + ' and ' + (chainB || '—') : contactAxisName(chainA) + ' and ' + contactAxisName(chainB));
    if (contactResult.view === 'distances') return 'Cα–Cα distances ' + between + ', 0–' + contactScaleText(contactResult.scaleMax);
    return 'Contacts ' + between + ' within ' + contactResult.cutoff + ' Å';
  }

  /* The methods sentence for the map, or null when there is nothing to say. The two-chain contact
     sentence is word for word what it was before 2.50.0. */
  function contactMethodsSentence() {
    if (!contactResult) return null;
    const { chainA, chainB, symmetric, cutoff } = contactResult;
    const target = entryById(contactResult.entryId); const of = target ? ' of ' + displayName(target) : '';
    const twoChains = !symmetric && chainA !== contactAllChains && chainB !== contactAllChains;
    if (contactResult.view === 'distances') {
      const between = symmetric ? (chainA === contactAllChains ? 'between all residues' : 'between residues within chain ' + (chainA || '—')) : twoChains ? 'between residues of chains ' + (chainA || '—') + ' and ' + (chainB || '—') : 'between residues of ' + contactAxisName(chainA) + ' and ' + contactAxisName(chainB);
      return 'Cα–Cα distances ' + between + of + ' (P–P for nucleotides) were computed for every residue pair and mapped on a continuous scale of 0–' + contactScaleText(contactResult.scaleMax) + ', the upper end being the largest distance present or 40 Å, whichever is smaller.';
    }
    if (!contactResult.pairs.size) return null;
    const rule = (contactResult.mode === 'ca' ? 'Cα atoms' : 'any pair of heavy atoms') + ' within ' + cutoff + ' Å';
    const forced = contactResult.caForced ? ' (Cα atoms were used because an axis exceeded ' + contactHeavyLimit + ' residues)' : '';
    if (twoChains) return 'Inter-chain contacts between chains ' + (chainA || '—') + ' and ' + (chainB || '—') + of + ' were defined as residue pairs with ' + rule + forced + '; ' + contactResult.pairs.size + ' residue pairs (' + contactResult.residuesA.length + ' residues on chain ' + (chainA || '—') + ', ' + contactResult.residuesB.length + ' on chain ' + (chainB || '—') + ') met the criterion.';
    if (symmetric) return (chainA === contactAllChains ? 'Residue contacts across all chains' : 'Intra-chain contacts within chain ' + (chainA || '—')) + of + ' were defined as pairs of different residues with ' + rule + forced + '; ' + contactResult.pairs.size + ' residue pairs (' + contactResult.residuesA.length + ' residues) met the criterion.';
    return 'Residue contacts between ' + contactAxisName(chainA) + ' and ' + contactAxisName(chainB) + of + ' were defined as pairs of different residues with ' + rule + forced + '; ' + contactResult.pairs.size + ' residue pairs (' + contactResult.residuesA.length + ' residues on ' + contactAxisName(chainA) + ', ' + contactResult.residuesB.length + ' on ' + contactAxisName(chainB) + ') met the criterion.';
  }

  /* The full Cα–Cα matrix of two axes of a model, for the cross-validation (tests/validate.mjs):
     rows are the first chain's residues, columns the second's, the diagonal of a chain against
     itself included. Pure — it reads the atoms, not the panel. */
  function contactDistanceMatrix(entryId, chainA, chainB) {
    const entry = entryById(entryId); if (!entry || !entry.atoms) return null;
    const a = contactAxis(entry, chainA); const b = contactAxis(entry, chainB);
    const ca = [];
    for (let i = 0; i < a.residues.length; i += 1) {
      const row = new Array(b.residues.length);
      for (let j = 0; j < b.residues.length; j += 1) { const dx = a.x[i] - b.x[j]; const dy = a.y[i] - b.y[j]; const dz = a.z[i] - b.z[j]; row[j] = Math.sqrt(dx * dx + dy * dy + dz * dz); }
      ca.push(row);
    }
    return { a: a.residues.map(atom => atom.resi), b: b.residues.map(atom => atom.resi), ca };
  }

