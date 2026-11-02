  /* ---------- Proximity selection ---------- */

  let nearbyResult = null;
  /* With no options it reads the Annotate panel, as the Highlight button always has. The residue
     card (04c) asks the same question about one residue of any shown model — not only the active
     one — by passing { entry, mode: 'residue', residue }; the cutoff still comes from the panel's
     Within (Å) field, so the card and the proximity tool count with one rule and agree. Only the
     validation hook passes { cutoff }, to ask the same rule at the reference's cutoff without
     touching the panel. */
  function nearbyResidues(options = {}) {
    const entry = options.entry || activeEntry(); if (!entry || !entry.model) return null;
    const mode = options.mode || root.querySelector('#gpv-near-target').value;
    const cutoff = Math.min(12, Math.max(2, Number(options.cutoff !== undefined ? options.cutoff : root.querySelector('#gpv-near-cutoff').value) || 4.5));
    const chain = root.querySelector('#gpv-near-chain').value.trim();
    const residue = options.residue ? { entryId: entry.id, chain: options.residue.chain || '', resi: options.residue.resi, icode: insertionCodeOf(options.residue) } : selectedResidue;
    /* A residue is its chain, number and insertion code: 57A's neighbours include 57 and 57B. */
    const isTarget = atom => residue && sameResidue(atom, residue.chain, residue.resi, insertionCodeOf(residue));
    const heavy = heavyAtoms(entry);
    let targets;
    if (mode === 'hetero') targets = heavy.filter(atom => atom.hetflag && !isWater(atom));
    else if (mode === 'chain') { if (!chain) return { error: 'Type the chain to measure from' }; targets = heavy.filter(atom => (atom.chain || '') === chain); }
    else { if (!residue || residue.entryId !== entry.id) return { error: 'Click a residue of this model first' }; targets = heavy.filter(isTarget); }
    if (!targets.length) return { error: mode === 'hetero' ? 'No ligands or ions in ' + displayName(entry) : 'No atoms matched the target' };
    const targetSet = new Set(targets);
    const candidates = heavy.filter(atom => !atom.hetflag && !targetSet.has(atom) && !(mode === 'chain' && (atom.chain || '') === chain) && !(mode === 'residue' && isTarget(atom)));
    const grid = spatialGrid(candidates, cutoff); const limit = cutoff * cutoff; const found = new Map();
    targets.forEach(target => grid.near(target).forEach(index => {
      const atom = candidates[index];
      if (squaredDistance(atom, target) > limit) return;
      const key = (atom.chain || '') + '|' + atom.resi + '|' + insertionCodeOf(atom);
      if (!found.has(key)) found.set(key, { chain: atom.chain || '', resi: atom.resi, icode: insertionCodeOf(atom), resn: atom.resn || '' });
    }));
    return { entry, cutoff, mode, residues: [...found.values()].sort((a, b) => compareChains(a.chain, b.chain) || a.resi - b.resi || (a.icode < b.icode ? -1 : a.icode > b.icode ? 1 : 0)) };
  }

  function highlightNearby() {
    highlightNearbyResult(nearbyResidues());
  }

  /* The highlight itself, apart from the question, so the residue card's Highlight (04c) makes from
     its own list exactly what this button makes: one selection record per chain, one undo step. */
  function highlightNearbyResult(result) {
    if (!result) return;
    if (result.error) { updateStatus(result.error); return; }
    nearbyResult = result;
    root.querySelector('#gpv-near-copy').disabled = !result.residues.length;
    if (!result.residues.length) { updateStatus('No residues within ' + result.cutoff + ' Å of the target'); return; }
    const byChain = new Map();
    result.residues.forEach(item => { if (!byChain.has(item.chain)) byChain.set(item.chain, []); byChain.get(item.chain).push(item); });
    const color = root.querySelector('#gpv-selection-color').value;
    /* A second press with nothing changed would stack identical rows on the first; a chain already
       highlighted with exactly these residues in this colour is left as it is. */
    const same = (record, chain, made) => record.entryId === result.entry.id && record.action === 'highlight' && (record.chain || '') === chain && record.color === color && selectionResidueKeys(record).join() === selectionResidueKeys(made).join();
    const records = [...byChain].map(([chain, items]) => ({ chain, ...selectionResidues(items) }));
    const wanted = records.filter(made => !selectionRecords.some(record => same(record, made.chain, made)));
    if (!wanted.length) { updateStatus('Those ' + plural(result.residues.length, 'residue') + ' within ' + result.cutoff + ' Å are already highlighted on ' + displayName(result.entry)); return; }
    remember('nearby residues');
    wanted.forEach(made => selectionRecords.push({ id: nextAnnotationId++, entryId: result.entry.id, action: 'highlight', color, ...made }));
    renderSelectionList(); applyStyle();
    updateStatus(result.residues.length + ' residue' + (result.residues.length === 1 ? '' : 's') + ' within ' + result.cutoff + ' Å highlighted on ' + displayName(result.entry) + ' · Copy residue list for the methods');
  }

  function nearbyListText() {
    if (!nearbyResult || !nearbyResult.residues) return '';
    return nearbyResult.residues.map(item => residueName(item, 'list')).join(', ');
  }

