  /* ---------- Proximity selection ---------- */

  let nearbyResult = null;
  function nearbyResidues() {
    const entry = activeEntry(); if (!entry || !entry.model) return null;
    const mode = root.querySelector('#gpv-near-target').value;
    const cutoff = Math.min(12, Math.max(2, Number(root.querySelector('#gpv-near-cutoff').value) || 4.5));
    const chain = root.querySelector('#gpv-near-chain').value.trim();
    const heavy = heavyAtoms(entry);
    let targets;
    if (mode === 'hetero') targets = heavy.filter(atom => atom.hetflag && !isWater(atom));
    else if (mode === 'chain') { if (!chain) return { error: 'Type the chain to measure from' }; targets = heavy.filter(atom => (atom.chain || '') === chain); }
    else { if (!selectedResidue || selectedResidue.entryId !== entry.id) return { error: 'Click a residue of this model first' }; targets = heavy.filter(atom => (atom.chain || '') === selectedResidue.chain && atom.resi === selectedResidue.resi); }
    if (!targets.length) return { error: mode === 'hetero' ? 'No ligands or ions in ' + displayName(entry) : 'No atoms matched the target' };
    const targetSet = new Set(targets);
    const candidates = heavy.filter(atom => !atom.hetflag && !targetSet.has(atom) && !(mode === 'chain' && (atom.chain || '') === chain) && !(mode === 'residue' && (atom.chain || '') === selectedResidue.chain && atom.resi === selectedResidue.resi));
    const grid = spatialGrid(candidates, cutoff); const limit = cutoff * cutoff; const found = new Map();
    targets.forEach(target => grid.near(target).forEach(index => {
      const atom = candidates[index];
      if (squaredDistance(atom, target) > limit) return;
      const key = (atom.chain || '') + '|' + atom.resi;
      if (!found.has(key)) found.set(key, { chain: atom.chain || '', resi: atom.resi, resn: atom.resn || '' });
    }));
    return { entry, cutoff, mode, residues: [...found.values()].sort((a, b) => compareChains(a.chain, b.chain) || a.resi - b.resi) };
  }

  function highlightNearby() {
    const result = nearbyResidues(); if (!result) return;
    if (result.error) { updateStatus(result.error); return; }
    nearbyResult = result;
    root.querySelector('#gpv-near-copy').disabled = !result.residues.length;
    if (!result.residues.length) { updateStatus('No residues within ' + result.cutoff + ' Å of the target'); return; }
    remember('nearby residues');
    const byChain = new Map();
    result.residues.forEach(item => { if (!byChain.has(item.chain)) byChain.set(item.chain, []); byChain.get(item.chain).push(item.resi); });
    const color = root.querySelector('#gpv-selection-color').value;
    byChain.forEach((residues, chain) => selectionRecords.push({ id: nextAnnotationId++, entryId: result.entry.id, chain, residues, action: 'highlight', color }));
    renderSelectionList(); applyStyle();
    updateStatus(result.residues.length + ' residue' + (result.residues.length === 1 ? '' : 's') + ' within ' + result.cutoff + ' Å highlighted on ' + displayName(result.entry) + ' · Copy residue list for the methods');
  }

  function nearbyListText() {
    if (!nearbyResult || !nearbyResult.residues) return '';
    return nearbyResult.residues.map(item => (item.chain ? item.chain + ':' : '') + item.resn + item.resi).join(', ');
  }

