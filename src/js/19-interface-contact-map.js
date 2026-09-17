  /* ---------- Interface contact map ----------
     Residue pairs of two chains whose atoms come within a cutoff, drawn as a map with the
     first chain down the side and the second along the top. The same heavy-atom distance
     rule as the proximity tool, so the numbers cross-validate the same way. */
  let contactResult = null;
  const contactButtons = ['#gpv-contact-highlight', '#gpv-contact-png', '#gpv-contact-csv'];

  function contactChainOptions(entry) {
    const first = root.querySelector('#gpv-contact-a'); const second = root.querySelector('#gpv-contact-b');
    const rows = entry && entry.model ? residueRows(entry) : [];
    const previous = [first.value, second.value];
    [first, second].forEach((select, index) => {
      select.replaceChildren();
      rows.forEach(row => { const option = document.createElement('option'); option.value = row.chain; option.textContent = (row.chain || '—') + ' · ' + row.residues.length + ' aa'; select.append(option); });
      if (rows.some(row => row.chain === previous[index])) select.value = previous[index]; else if (rows[Math.min(index, rows.length - 1)]) select.value = rows[Math.min(index, rows.length - 1)].chain;
    });
    const ready = rows.length >= 2;
    root.querySelector('#gpv-contact-run').disabled = !ready;
    if (contactResult && (!entry || contactResult.entryId !== entry.id)) {
      contactResult = null; root.querySelector('#gpv-contact-wrap').hidden = true; contactButtons.forEach(selector => { root.querySelector(selector).disabled = true; });
    }
    if (!contactResult) root.querySelector('#gpv-contact-state').textContent = !entry || !entry.model ? 'Show a model with two or more chains.' : ready ? 'Choose two chains and compute.' : displayName(entry) + ' has a single chain; a contact map needs two.';
  }

  function computeContacts() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const chainA = root.querySelector('#gpv-contact-a').value; const chainB = root.querySelector('#gpv-contact-b').value;
    if (chainA === chainB) { updateStatus('Pick two different chains for the contact map'); return; }
    const mode = root.querySelector('#gpv-contact-atoms').value;
    const cutoff = Math.min(15, Math.max(3, Number(root.querySelector('#gpv-contact-cutoff').value) || 4.5));
    root.querySelector('#gpv-contact-cutoff').value = String(cutoff);
    const rows = residueRows(entry); const rowA = rows.find(row => row.chain === chainA); const rowB = rows.find(row => row.chain === chainB);
    if (!rowA || !rowB) return;
    const pick = chain => heavyAtoms(entry).filter(atom => !atom.hetflag && !isWater(atom) && (atom.chain || '') === chain && (mode === 'heavy' || atom.atom === 'CA'));
    const atomsA = pick(chainA); const atomsB = pick(chainB);
    const indexA = new Map(rowA.residues.map((atom, i) => [atom.resi, i])); const indexB = new Map(rowB.residues.map((atom, i) => [atom.resi, i]));
    const grid = spatialGrid(atomsB, cutoff); const limit = cutoff * cutoff;
    const pairs = new Map();
    atomsA.forEach(a => {
      const i = indexA.get(a.resi); if (i === undefined) return;
      grid.near(a).forEach(k => {
        const b = atomsB[k]; const d2 = squaredDistance(a, b); if (d2 > limit) return;
        const j = indexB.get(b.resi); if (j === undefined) return;
        const key = i + '|' + j; const d = Math.sqrt(d2);
        if (!pairs.has(key) || pairs.get(key) > d) pairs.set(key, d);
      });
    });
    const residuesA = new Set(); const residuesB = new Set();
    pairs.forEach((d, key) => { const [i, j] = key.split('|').map(Number); residuesA.add(rowA.residues[i].resi); residuesB.add(rowB.residues[j].resi); });
    contactResult = { entryId: entry.id, chainA, chainB, rowA, rowB, mode, cutoff, pairs, residuesA: [...residuesA].sort((x, y) => x - y), residuesB: [...residuesB].sort((x, y) => x - y) };
    drawContactMap(root.querySelector('#gpv-contact-canvas'));
    root.querySelector('#gpv-contact-state').textContent = pairs.size + ' residue pair' + (pairs.size === 1 ? '' : 's') + ' within ' + cutoff + ' Å (' + (mode === 'ca' ? 'Cα–Cα' : 'any heavy atom') + ') · ' + residuesA.size + ' interface residue' + (residuesA.size === 1 ? '' : 's') + ' on chain ' + (chainA || '—') + ', ' + residuesB.size + ' on chain ' + (chainB || '—');
    contactButtons.forEach(selector => { root.querySelector(selector).disabled = pairs.size === 0; });
    root.querySelector('#gpv-contact-wrap').hidden = false;
    root.querySelector('#gpv-contact-readout').textContent = 'Hover a cell to read the residue pair · click a contact to select both residues and zoom to them';
    updateStatus('Contact map: ' + pairs.size + ' residue pairs between chains ' + (chainA || '—') + ' and ' + (chainB || '—') + ' within ' + cutoff + ' Å');
  }

  function contactCell(canvas) {
    const n = contactResult.rowA.residues.length; const m = contactResult.rowB.residues.length;
    return Math.max(2, Math.min(12, Math.floor(560 / Math.max(n, m))));
  }

  /* Rows: chain A residues (top to bottom); columns: chain B residues (left to right).
     Closer pairs are darker. With `figure` the map gets margins, ticks, titles and a scale. */
  function drawContactMap(canvas, figure = false, scale = 1) {
    if (!contactResult) return;
    const { rowA, rowB, pairs, cutoff, chainA, chainB } = contactResult;
    const n = rowA.residues.length; const m = rowB.residues.length;
    const cell = contactCell(canvas) * scale;
    const margin = figure ? { left: 72 * scale, top: 54 * scale, right: 24 * scale, bottom: 64 * scale } : { left: 0, top: 0, right: 0, bottom: 0 };
    canvas.width = Math.round(m * cell + margin.left + margin.right); canvas.height = Math.round(n * cell + margin.top + margin.bottom);
    const context = canvas.getContext('2d');
    const palette = figure ? { paper: '#ffffff', ink: '#111827', grid: '#e5e7eb' } : { paper: themeColor('--card', '#ffffff'), ink: themeColor('--foreground', '#111827'), grid: themeColor('--border', '#e5e7eb') };
    context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height);
    const near = '#1e3a8a'; const far = '#bfdbfe';
    pairs.forEach((distance, key) => {
      const [i, j] = key.split('|').map(Number);
      context.fillStyle = mixHex(near, far, Math.max(0, Math.min(1, distance / cutoff)));
      context.fillRect(margin.left + j * cell, margin.top + i * cell, Math.max(1, cell), Math.max(1, cell));
    });
    const step = n > 400 || m > 400 ? 100 : n > 150 || m > 150 ? 50 : n > 60 || m > 60 ? 25 : 10;
    context.strokeStyle = palette.grid; context.lineWidth = 1;
    rowB.residues.forEach((atom, j) => { if (atom.resi % step === 0) { context.beginPath(); context.moveTo(margin.left + j * cell + 0.5, margin.top); context.lineTo(margin.left + j * cell + 0.5, margin.top + n * cell); context.stroke(); } });
    rowA.residues.forEach((atom, i) => { if (atom.resi % step === 0) { context.beginPath(); context.moveTo(margin.left, margin.top + i * cell + 0.5); context.lineTo(margin.left + m * cell, margin.top + i * cell + 0.5); context.stroke(); } });
    if (!figure) return;
    const font = figureFont(); const size = 11 * scale;
    context.fillStyle = palette.ink; context.font = size + 'px ' + font; context.textAlign = 'center'; context.textBaseline = 'top';
    rowB.residues.forEach((atom, j) => { if (atom.resi % step === 0) context.fillText(String(atom.resi), margin.left + j * cell + cell / 2, margin.top + n * cell + 6 * scale); });
    context.textAlign = 'right'; context.textBaseline = 'middle';
    rowA.residues.forEach((atom, i) => { if (atom.resi % step === 0) context.fillText(String(atom.resi), margin.left - 6 * scale, margin.top + i * cell + cell / 2); });
    context.font = '600 ' + (12 * scale) + 'px ' + font; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
    context.fillText('Chain ' + (chainB || '—') + ' residue', margin.left + m * cell / 2, canvas.height - 14 * scale);
    context.save(); context.translate(18 * scale, margin.top + n * cell / 2); context.rotate(-Math.PI / 2); context.fillText('Chain ' + (chainA || '—') + ' residue', 0, 0); context.restore();
    context.font = '600 ' + (13 * scale) + 'px ' + font; context.textAlign = 'left';
    const entry = entryById(contactResult.entryId);
    context.fillText(truncateToWidth(context, (entry ? displayName(entry) + ' · ' : '') + 'contacts within ' + cutoff + ' Å (' + (contactResult.mode === 'ca' ? 'Cα–Cα' : 'any heavy atom') + ') · ' + pairs.size + ' pairs', Math.max(60, canvas.width - margin.left - margin.right - 140 * scale)), margin.left, 22 * scale);
    /* distance scale */
    const barX = canvas.width - margin.right - 120 * scale; const barY = 32 * scale; const barW = 100 * scale; const barH = 8 * scale;
    for (let x = 0; x < barW; x += 1) { context.fillStyle = mixHex(near, far, x / barW); context.fillRect(barX + x, barY, 1, barH); }
    context.font = (10 * scale) + 'px ' + font; context.fillStyle = palette.ink; context.textAlign = 'left'; context.textBaseline = 'top';
    context.fillText('0 Å', barX, barY + barH + 2 * scale); context.textAlign = 'right'; context.fillText(cutoff + ' Å', barX + barW, barY + barH + 2 * scale);
  }

  function contactAt(event) {
    if (!contactResult) return null;
    const canvas = root.querySelector('#gpv-contact-canvas'); const rect = canvas.getBoundingClientRect();
    const n = contactResult.rowA.residues.length; const m = contactResult.rowB.residues.length;
    const i = Math.floor((event.clientY - rect.top) / rect.height * n); const j = Math.floor((event.clientX - rect.left) / rect.width * m);
    if (i < 0 || j < 0 || i >= n || j >= m) return null;
    return { i, j, a: contactResult.rowA.residues[i], b: contactResult.rowB.residues[j], distance: contactResult.pairs.get(i + '|' + j) };
  }

  function contactPairText(hit) {
    const label = atom => (atom.chain ? atom.chain + ':' : '') + (atom.resn || '') + ' ' + atom.resi;
    return label(hit.a) + ' — ' + label(hit.b) + (hit.distance === undefined ? ' · no contact' : ' · ' + hit.distance.toFixed(2) + ' Å');
  }

  function highlightContactInterface() {
    if (!contactResult) return;
    const entry = entryById(contactResult.entryId); if (!entry) return;
    remember('interface highlight');
    const color = root.querySelector('#gpv-interface-color').value;
    selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain: contactResult.chainA, residues: contactResult.residuesA.slice(), action: 'highlight', color });
    selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain: contactResult.chainB, residues: contactResult.residuesB.slice(), action: 'highlight', color });
    renderSelectionList(); applyStyle();
    updateStatus('Interface highlighted · ' + contactResult.residuesA.length + ' residues on chain ' + (contactResult.chainA || '—') + ', ' + contactResult.residuesB.length + ' on chain ' + (contactResult.chainB || '—'));
  }

  function downloadContactsCsv() {
    if (!contactResult) return;
    const entry = entryById(contactResult.entryId);
    const rows = [['model', 'chain_a', 'resi_a', 'resn_a', 'chain_b', 'resi_b', 'resn_b', 'min_distance_angstrom', 'atoms', 'cutoff_angstrom']];
    [...contactResult.pairs.entries()].map(([key, d]) => { const [i, j] = key.split('|').map(Number); return { a: contactResult.rowA.residues[i], b: contactResult.rowB.residues[j], d }; })
      .sort((x, y) => x.a.resi - y.a.resi || x.b.resi - y.b.resi)
      .forEach(pair => rows.push([entry ? displayName(entry) : '', contactResult.chainA, pair.a.resi, pair.a.resn || '', contactResult.chainB, pair.b.resi, pair.b.resn || '', pair.d.toFixed(3), contactResult.mode === 'ca' ? 'CA' : 'heavy', contactResult.cutoff]));
    downloadBlob(rows.map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv', 'contacts-' + (contactResult.chainA || 'x') + '-' + (contactResult.chainB || 'y') + '.csv');
    updateStatus('Contacts CSV downloaded · ' + contactResult.pairs.size + ' pairs');
  }

  async function downloadContactPng() {
    if (!contactResult) return;
    const canvas = document.createElement('canvas');
    drawContactMap(canvas, true, 3);
    downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), 300), 'image/png', 'contact-map-' + (contactResult.chainA || 'x') + '-' + (contactResult.chainB || 'y') + '.png');
    updateStatus('Contact map PNG downloaded · ' + canvas.width + ' × ' + canvas.height + ' at 300 dpi');
  }


