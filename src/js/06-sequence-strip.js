  /* ---------- Sequence strip ---------- */

  const sequenceKey = 'protein-structure-viewer:sequence-hidden';
  const sequenceChainLimit = 24;
  let sequenceHover = null;
  let sequenceDrag = null;
  let sequenceRange = null;
  let sequenceFrame = 0;
  let sequenceMarks = [];

  /* One representative atom per residue (Cα, else P, else the first seen), grouped by chain. */
  function residueRows(entry) {
    if (entry.sequenceCache && entry.sequenceCache.atoms === entry.atoms) return entry.sequenceCache.rows;
    const chains = new Map();
    entry.atoms.forEach(atom => {
      if (atom.hetflag || !Number.isFinite(Number(atom.resi))) return;
      const chain = atom.chain || '';
      if (!chains.has(chain)) chains.set(chain, new Map());
      const residues = chains.get(chain);
      const current = residues.get(atom.resi);
      if (!current || atom.atom === 'CA' || (atom.atom === 'P' && current.atom !== 'CA')) residues.set(atom.resi, atom);
    });
    const rows = [...chains.entries()]
      .map(([chain, residues]) => ({ chain, residues: [...residues.values()].sort((a, b) => a.resi - b.resi) }))
      .filter(row => row.residues.length > 1)
      .sort((a, b) => compareChains(a.chain, b.chain));
    entry.sequenceCache = { atoms: entry.atoms, rows };
    return rows;
  }

  /* Which models the strip shows: the active one when models are shown one at a
     time or side by side, otherwise every displayed model (active first). */
  function sequenceEntries() {
    const shown = displayedEntries().filter(entry => entry.model);
    const active = activeEntry();
    const first = shown.includes(active) ? active : shown[0];
    if (!first) return [];
    if (root.querySelector('#gpv-view-mode').value === 'single' || root.querySelector('#gpv-side-by-side').checked) return [first];
    return [first, ...shown.filter(entry => entry !== first)].slice(0, 8);
  }

  function sequenceEntry() {
    return sequenceEntries()[0] || null;
  }

  function sequenceColor(entry, atom) {
    const mode = root.querySelector('#gpv-color-mode').value;
    if (mode === 'chain') return chainColor(atom.chain);
    if (mode === 'entity') return entityColor(entry, atom);
    if (mode === 'deviation') return deviationColor(entry, atom);
    if (mode === 'agreement') return agreementColor(entry, atom);
    if (mode === 'domain') return domainColor(entry, atom);
    if (mode === 'annotated') return annotatedColor(entry, atom);
    if (mode === 'data') return dataColor(entry, atom);
    if (residueModes.includes(mode)) return residueColor(mode, atom);
    return entry.scores.length ? plddtColor(Number(atom.b || 0)) : entry.color;
  }

  function describeResidue(entry, atom) {
    const confidence = entry.scores.length && Number.isFinite(Number(atom.b)) ? ' · pLDDT ' + Number(atom.b).toFixed(1) : '';
    return (atom.resn || 'RES') + atom.resi + (atom.chain ? ' · chain ' + atom.chain : '') + confidence;
  }

  function drawSequenceRow(canvas, entry, row) {
    const width = canvas.clientWidth || 300; const height = 30; const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
    const count = row.residues.length; const cell = width / count; const gap = cell > 3 ? 1 : 0;
    const ink = themeColor('--card-foreground', '#111827');
    const labelled = new Set(labelRecords.filter(label => label.entryId === entry.id && (label.chain || '') === row.chain).map(label => label.resi));
    const highlighted = new Map();
    selectionRecords.filter(record => record.entryId === entry.id && record.action === 'highlight' && (!record.chain || record.chain === row.chain))
      .forEach(record => record.residues.forEach(resi => highlighted.set(resi, record.color)));
    const threshold = entry.scores.length ? hideBelow() : 0;
    const chainHidden = (entry.hiddenChains || []).includes(row.chain);
    row.residues.forEach((atom, index) => {
      const x = index * cell;
      context.fillStyle = sequenceColor(entry, atom);
      context.globalAlpha = chainHidden || (threshold && Number(atom.b) < threshold) ? 0.22 : 1;
      context.fillRect(x, 4, Math.max(0.5, cell - gap), 12);
      context.globalAlpha = 1;
      const mark = highlighted.get(atom.resi);
      if (mark) { context.fillStyle = mark; context.fillRect(x, 18, Math.max(0.5, cell - gap), 3); }
      if (cell >= 9) {
        const fill = sequenceColor(entry, atom);
        context.fillStyle = /^#[0-9a-f]{6}$/i.test(fill) && hexLuminance(fill) > 0.5 ? '#111827' : '#ffffff';
        context.font = '600 9px ' + (labelColors.getPropertyValue('--font-mono').trim() || 'monospace'); context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText(residueLetter(atom.resn), x + cell / 2, 10.5);
        context.textAlign = 'start';
      }
      if (labelled.has(atom.resi)) {
        context.fillStyle = ink; context.beginPath();
        context.moveTo(x + cell / 2, 3.5); context.lineTo(x + cell / 2 - 3.5, 0); context.lineTo(x + cell / 2 + 3.5, 0); context.fill();
      }
    });
    context.fillStyle = themeColor('--muted-foreground', '#6b7280');
    context.font = '9px ' + (labelColors.getPropertyValue('--font-mono').trim() || 'monospace'); context.textBaseline = 'alphabetic';
    const step = [1, 5, 10, 25, 50, 100, 250, 500, 1000].find(value => value * cell >= 44) || 1000;
    let lastTick = -Infinity;
    row.residues.forEach((atom, index) => {
      if (index !== 0 && atom.resi % step !== 0) return;
      const x = index * cell;
      if (index !== 0 && x < lastTick + 40) return;
      context.fillText(String(atom.resi), x, 29); lastTick = x;
    });
    if (sequenceRange && sequenceRange.entryId === entry.id && sequenceRange.chain === row.chain) {
      const from = Math.min(sequenceRange.from, sequenceRange.to); const to = Math.max(sequenceRange.from, sequenceRange.to);
      context.strokeStyle = ink; context.lineWidth = 1.5;
      context.strokeRect(from * cell + 0.75, 1.75, (to - from + 1) * cell - 1.5, 20);
    }
    sequenceMarks.filter(mark => mark.entryId === entry.id && mark.chain === row.chain).forEach(mark => {
      const index = row.residues.findIndex(atom => atom.resi === mark.resi);
      if (index >= 0) { context.strokeStyle = '#d946ef'; context.lineWidth = 2; context.strokeRect(index * cell, 2, Math.max(3, cell), 16); }
    });
    if (sequenceHover && sequenceHover.entryId === entry.id && sequenceHover.chain === row.chain) {
      const index = row.residues.findIndex(atom => atom.resi === sequenceHover.resi);
      if (index >= 0) { context.strokeStyle = ink; context.lineWidth = 2; context.strokeRect(index * cell, 2, Math.max(3, cell), 16); }
    }
  }

  function sequenceRowFor(canvas) {
    const entry = entryById(Number(canvas.dataset.entryId));
    if (!entry || !entry.model) return null;
    const row = residueRows(entry).find(item => item.chain === canvas.dataset.chain);
    return row ? { entry, row } : null;
  }

  function sequenceIndexAt(canvas, row, event) {
    const box = canvas.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left) / Math.max(1, box.width) * row.residues.length);
    return Math.max(0, Math.min(row.residues.length - 1, index));
  }

  function resetSequenceHint() {
    root.querySelector('#gpv-sequence-hint').textContent = 'Hover to read a residue · click to select it for a label · drag to pick a range · double-click to zoom';
  }

  /* A residue picked from the strip or the letters counts as an atom click, so
     arrows, callouts and measurements can be drawn between residues chosen by
     number rather than by hunting for them in three dimensions. */
  function pickSequenceResidue(entry, atom) {
    handleAtomClick(entry, atom);
    root.querySelector('#gpv-sequence-hint').textContent = describeResidue(entry, atom) + (annotationActive ? ' added to the drawing' : measurementActive ? ' added to the measurement' : ' selected · add a label in Annotate, or double-click to zoom to it');
    if (!root.querySelector('[data-gpv-panel="annotate"]').hidden) root.querySelector('#gpv-label-text').focus();
    updateStatus(residueText(entry, atom));
  }

  function wireSequenceCanvas(canvas) {
    canvas.addEventListener('pointermove', event => {
      const found = sequenceRowFor(canvas); if (!found) return;
      const index = sequenceIndexAt(canvas, found.row, event); const atom = found.row.residues[index];
      sequenceHover = { entryId: found.entry.id, chain: found.row.chain, resi: atom.resi };
      if (sequenceDrag && sequenceDrag.chain === found.row.chain) sequenceRange = { ...sequenceDrag, to: index };
      root.querySelector('#gpv-sequence-hint').textContent = describeResidue(found.entry, atom) + (sequenceDrag ? ' · release to pick the range' : '');
      drawSequenceRow(canvas, found.entry, found.row);
    });
    canvas.addEventListener('pointerleave', () => {
      if (sequenceDrag || !sequenceHover || sequenceHover.chain !== canvas.dataset.chain) return;
      sequenceHover = null; resetSequenceHint();
      const found = sequenceRowFor(canvas); if (found) drawSequenceRow(canvas, found.entry, found.row);
    });
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const found = sequenceRowFor(canvas); if (!found) return;
      const index = sequenceIndexAt(canvas, found.row, event);
      sequenceDrag = { entryId: found.entry.id, chain: found.row.chain, from: index, to: index };
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* not every engine supports capture on canvas */ }
    });
    canvas.addEventListener('pointerup', event => {
      const drag = sequenceDrag; sequenceDrag = null;
      if (!drag) return;
      const found = sequenceRowFor(canvas); if (!found) return;
      const index = sequenceIndexAt(canvas, found.row, event);
      const from = Math.min(drag.from, index); const to = Math.max(drag.from, index);
      if (from === to) {
        sequenceRange = null;
        pickSequenceResidue(found.entry, found.row.residues[index]);
      } else {
        sequenceRange = { ...drag, to: index };
        const first = found.row.residues[from].resi; const last = found.row.residues[to].resi;
        root.querySelector('#gpv-selection-model').value = String(found.entry.id);
        root.querySelector('#gpv-selection-chain').value = found.row.chain;
        root.querySelector('#gpv-selection-range').value = first + '-' + last;
        root.querySelector('#gpv-sequence-hint').textContent = 'Residues ' + first + '–' + last + (found.row.chain ? ' of chain ' + found.row.chain : '') + ' are in the Selections range · Highlight or Hide them from the Annotate tab';
        updateStatus('Range ' + first + '–' + last + ' ready in Annotate → Selections');
      }
      drawSequenceRow(canvas, found.entry, found.row);
    });
    canvas.addEventListener('dblclick', () => {
      const found = sequenceRowFor(canvas);
      if (!found || !sequenceHover || !found.entry.model) return;
      const selection = { model: found.entry.model.getID(), resi: sequenceHover.resi };
      if (found.row.chain) selection.chain = found.row.chain;
      viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer);
    });
  }

  function renderSequence() {
    const wrap = root.querySelector('#gpv-sequence'); const rows = root.querySelector('#gpv-sequence-rows'); const toggle = root.querySelector('#gpv-sequence-toggle');
    const entries = sequenceEntries();
    const hidden = readJson(sequenceKey, false) === true;
    wrap.hidden = !entries.length;
    toggle.textContent = hidden ? 'Show sequence' : 'Hide sequence'; toggle.setAttribute('aria-expanded', String(!hidden));
    rows.hidden = hidden;
    if (!entries.length || hidden) { rows.replaceChildren(); rows.dataset.key = ''; root.querySelector('#gpv-sequence-letters').replaceChildren(); root.querySelector('#gpv-sequence-letters').dataset.key = ''; return; }
    const planned = entries.flatMap(entry => residueRows(entry).map(row => ({ entry, row })));
    const shown = planned.slice(0, sequenceChainLimit);
    const multi = entries.length > 1;
    const total = planned.reduce((sum, item) => sum + item.row.residues.length, 0);
    const mode = root.querySelector('#gpv-color-mode').value;
    const colourNote = mode === 'chain' ? ' · coloured by chain' : mode === 'entity' ? ' · coloured by entity' : mode === 'deviation' ? ' · coloured by Cα deviation' : mode === 'agreement' ? ' · coloured by model agreement (Cα RMSF)' : mode === 'domain' ? ' · coloured by PAE domains' : mode === 'annotated' ? ' · coloured by annotated domains' : mode === 'data' ? ' · coloured by ' + (residueData ? residueData.name : 'per-residue data') : residueModes.includes(mode) ? ' · coloured by ' + ({ charge: 'residue charge', hydrophobicity: 'hydrophobicity', restype: 'residue type', amino: 'amino acid', ss: 'secondary structure' })[mode] : entries.some(entry => entry.scores.length) ? ' · coloured by pLDDT' : '';
    const chainNote = planned.length > shown.length ? ' · first ' + shown.length + ' of ' + planned.length + ' rows' : '';
    const cut = hideBelow();
    const cutNote = cut && entries.some(entry => entry.scores.length) ? ' · pLDDT below ' + cut + ' hidden' : '';
    root.querySelector('#gpv-sequence-title').textContent = (multi ? entries.length + ' models' : displayName(entries[0])) + ' · ' + total + ' residues' + colourNote + cutNote + chainNote;
    const key = shown.map(item => item.entry.id + ':' + item.row.chain + ((item.entry.hiddenChains || []).includes(item.row.chain) ? '!' : '') + ((item.entry.fadedChains || []).includes(item.row.chain) ? '~' : '')).join(',');
    rows.classList.toggle('is-multi', multi);
    if (rows.dataset.key !== key) {
      rows.replaceChildren(); rows.dataset.key = key;
      shown.forEach(({ entry, row }) => {
        const line = document.createElement('div'); line.className = 'gpv-sequence-row';
        const name = document.createElement('span'); name.className = 'gpv-sequence-chain';
        const chainName = row.chain ? 'Chain ' + row.chain : 'No chain';
        const hiddenChain = (entry.hiddenChains || []).includes(row.chain);
        const fadedChain = Boolean(entry.faded) || (entry.fadedChains || []).includes(row.chain);
        name.textContent = (multi ? clipText(displayName(entry), 14) + ' · ' + (row.chain || '—') : chainName) + (hiddenChain ? ' · hidden' : fadedChain ? ' · faded' : '');
        name.title = displayName(entry) + ' · ' + chainName + ' · ' + row.residues.length + ' residues';
        const canvas = document.createElement('canvas'); canvas.dataset.chain = row.chain; canvas.dataset.entryId = String(entry.id);
        if (fadedChain) canvas.style.opacity = '0.45';
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', displayName(entry) + ', ' + chainName + ', ' + row.residues.length + ' residues');
        wireSequenceCanvas(canvas);
        line.append(name, canvas); rows.append(line);
      });
    }
    shown.forEach(({ entry, row }, index) => drawSequenceRow(rows.children[index].querySelector('canvas'), entry, row));
    renderSequenceLetters(shown, multi);
  }

  const lettersKey = 'protein-structure-viewer:sequence-letters-open';

  /* The one-letter sequence, fifty residues a line in blocks of ten, each letter a
     chip in the current colour scheme; click a letter to select that residue. */
  function renderSequenceLetters(shown, multi) {
    const details = root.querySelector('#gpv-sequence-text'); const host = root.querySelector('#gpv-sequence-letters');
    if (!details.open) { host.replaceChildren(); host.dataset.key = ''; return; }
    const key = shown.map(item => item.entry.id + ':' + item.row.chain).join(',') + '|' + root.querySelector('#gpv-color-mode').value + '|' + hideBelow() + '|' + alignmentResults.length;
    if (host.dataset.key === key) return;
    host.dataset.key = key; host.replaceChildren();
    shown.forEach(({ entry, row }) => {
      const block = document.createElement('div'); block.className = 'gpv-seq-block';
      const head = document.createElement('div'); head.className = 'gpv-seq-head text-small';
      const title = document.createElement('strong'); title.textContent = (multi ? displayName(entry) + ' · ' : '') + (row.chain ? 'Chain ' + row.chain : 'No chain');
      const meta = document.createElement('span'); meta.className = 'text-muted';
      meta.textContent = row.residues.length + ' residues · ' + row.residues[0].resi + '–' + row.residues[row.residues.length - 1].resi;
      const letters = row.residues.map(atom => residueLetter(atom.resn)).join('');
      const copy = document.createElement('button'); copy.className = 'btn btn-ghost'; copy.type = 'button'; copy.textContent = 'Copy';
      copy.title = 'Copy the one-letter sequence';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(letters); updateStatus('Sequence copied · ' + letters.length + ' residues'); }
        catch (error) { updateStatus('Clipboard unavailable — select the letters and copy them'); }
      });
      head.append(title, meta, copy);
      const pre = document.createElement('pre'); pre.className = 'gpv-seq-lines';
      const threshold = entry.scores.length ? hideBelow() : 0;
      for (let start = 0; start < row.residues.length; start += 50) {
        const line = document.createElement('div'); line.className = 'gpv-seq-line';
        const gutter = document.createElement('span'); gutter.className = 'gpv-seq-gutter'; gutter.textContent = String(row.residues[start].resi);
        line.append(gutter);
        row.residues.slice(start, start + 50).forEach((atom, offset) => {
          if (offset && offset % 10 === 0) line.append(' ');
          const span = document.createElement('span'); span.className = 'gpv-aa'; span.textContent = residueLetter(atom.resn);
          const fill = sequenceColor(entry, atom);
          span.style.background = fill;
          span.style.color = /^#[0-9a-f]{6}$/i.test(fill) && hexLuminance(fill) > 0.5 ? '#111827' : '#ffffff';
          if (threshold && Number(atom.b) < threshold) span.classList.add('is-hidden');
          span.title = describeResidue(entry, atom);
          span.dataset.resi = String(atom.resi);
          span.addEventListener('click', () => pickSequenceResidue(entry, atom));
          line.append(span);
        });
        pre.append(line);
      }
      block.append(head, pre); host.append(block);
    });
  }

  function renderSequenceSoon() {
    if (sequenceFrame) return;
    sequenceFrame = requestAnimationFrame(() => { sequenceFrame = 0; renderSequence(); });
  }

