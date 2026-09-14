  /* ---------- Motif selection ---------- */

  function highlightMotif() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const pattern = root.querySelector('#gpv-motif').value.trim();
    const state = root.querySelector('#gpv-motif-state');
    if (!pattern) { state.textContent = 'Type a pattern first, for example N[^P][ST] for N-glycosylation sequons.'; return; }
    let regex;
    try { regex = new RegExp(pattern, 'gi'); } catch (error) { state.textContent = 'Not a valid pattern: ' + error.message; return; }
    const hits = []; const byChain = new Map();
    residueRows(entry).forEach(row => {
      const sequence = row.residues.map(atom => residueLetter(atom.resn)).join('');
      let match;
      while ((match = regex.exec(sequence)) !== null) {
        if (!match[0].length) { regex.lastIndex += 1; continue; }
        for (let offset = 0; offset < match[0].length; offset += 1) { const atom = row.residues[match.index + offset]; if (!byChain.has(row.chain)) byChain.set(row.chain, []); byChain.get(row.chain).push(atom.resi); }
        hits.push({ chain: row.chain, start: row.residues[match.index].resi, text: match[0] });
      }
    });
    if (!hits.length) { state.textContent = 'No match for ' + pattern + ' in ' + displayName(entry) + '.'; return; }
    remember('motif highlight');
    const color = root.querySelector('#gpv-selection-color').value;
    byChain.forEach((residues, chain) => selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain, residues: [...new Set(residues)].sort((a, b) => a - b), action: 'highlight', color }));
    renderSelectionList(); applyStyle();
    state.textContent = hits.length + ' match' + (hits.length === 1 ? '' : 'es') + ': ' + clipText(hits.map(hit => (hit.chain ? hit.chain + ':' : '') + hit.start + ' ' + hit.text).join(', '), 160);
    updateStatus(hits.length + ' motif match' + (hits.length === 1 ? '' : 'es') + ' highlighted on ' + displayName(entry));
  }

