  /* ---------- Position comparison ----------
     A mutation study loads the same protein twice — one run of the wild type, one of the point
     mutant — and the question is what sits at one position in each. Compare this position takes the
     selected residue and, in every shown model, draws the side chain there, writes that model's own
     residue on it, and states whether the models agree. Positions are matched by chain and residue
     number alone, which is what two runs of the same sequence share; an insertion or deletion
     between the runs shifts the numbering and the comparison follows the numbers, not the residues. */
  let spotlightResidues = [];

  /* ARG → Arg: the three-letter code as it is written in a figure label. */
  function positionResidueName(resn) {
    const text = String(resn || 'RES').trim() || 'RES';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
  const positionTag = spot => (spot.chain ? spot.chain + ':' : '') + spot.resi;

  /* Every shown model that has this position, with the atom the label hangs on. */
  function positionAtoms(chain, resi) {
    return displayedEntries().filter(entry => entry.model).map(entry => {
      const candidates = entry.atoms.filter(atom => !atom.hetflag && atom.resi === resi && (atom.chain || '') === (chain || ''));
      const atom = candidates.find(item => item.atom === 'CA') || candidates[0];
      return atom ? { entry, atom } : null;
    }).filter(Boolean);
  }

  /* The readout: one line naming the position, what each model has there, and whether they differ. */
  function positionReadout(spot) {
    const found = positionAtoms(spot.chain, spot.resi);
    if (!found.length) return positionTag(spot) + ' · in none of the shown models';
    const identities = found.map(item => positionResidueName(item.atom.resn));
    const tag = positionTag(spot);
    if (new Set(identities).size === 1) return tag + ' · ' + identities[0] + ' in all ' + found.length + ' model' + (found.length === 1 ? '' : 's');
    const names = distinguishingNames(found.map(item => displayName(item.entry)));
    const parts = found.map((item, index) => names[index] + ' ' + identities[index]);
    return tag + ' · ' + (found.length === 2 ? parts[0] + ' → ' + parts[1] : parts.join(' · ')) + ' · differs';
  }

  /* The same comparison as a sentence for the figure legend. */
  function positionSentence(spot) {
    const found = positionAtoms(spot.chain, spot.resi);
    if (!found.length) return null;
    const drawn = root.querySelector('#gpv-position-sticks').checked ? 'is drawn as side-chain sticks and labelled' : 'is labelled';
    const identities = found.map(item => positionResidueName(item.atom.resn));
    const lead = 'Position ' + positionTag(spot) + ' ' + drawn + ' in every model; it is ';
    if (new Set(identities).size === 1) return lead + identities[0] + ' in all ' + found.length + ' of them.';
    const names = distinguishingNames(found.map(item => displayName(item.entry)));
    const parts = found.map((item, index) => identities[index] + ' in ' + names[index]);
    return lead + parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] + '.';
  }

  function renderPositionState(message = null) {
    const state = root.querySelector('#gpv-position-state');
    if (message) { state.textContent = message; return; }
    if (!spotlightResidues.length) { state.textContent = 'Select a residue, then compare it across the shown models.'; return; }
    state.textContent = spotlightResidues.map(positionReadout).join('  ·  ');
  }

  /* Comparing needs a residue to compare and at least two models to compare it in. */
  function updatePositionCompare() {
    const button = root.querySelector('#gpv-position-compare');
    if (button) button.disabled = !selectedResidue || displayedEntries().filter(entry => entry.model).length < 2;
  }

  function comparePosition() {
    if (!selectedResidue) { announce('Click a residue first — in the viewer, the sequence strip, or with Go to', 'error'); return; }
    if (displayedEntries().filter(entry => entry.model).length < 2) { announce('Show at least two models to compare a position across them', 'error'); return; }
    const chain = selectedResidue.chain || '';
    const resi = selectedResidue.resi;
    const found = positionAtoms(chain, resi);
    if (found.length < 2) {
      announce(positionTag({ chain, resi }) + ' is in only ' + found.length + ' of the shown models · check the chain and the numbering', 'error');
      return;
    }
    remember('position comparison');
    if (!spotlightResidues.some(spot => spot.chain === chain && spot.resi === resi)) spotlightResidues.push({ chain, resi });
    found.forEach(({ entry, atom }) => {
      const key = residueKey(entry.id, atom.chain || '', atom.resi);
      const record = {
        entryId: entry.id, chain: atom.chain || '', resi: atom.resi, resn: atom.resn || 'RES', atom: 'CA',
        x: atom.x, y: atom.y, z: atom.z, key,
        text: positionResidueName(atom.resn) + atom.resi, color: entry.color, size: 15, kind: 'position'
      };
      const index = labelRecords.findIndex(label => label.key === key);
      if (index >= 0) labelRecords[index] = { ...labelRecords[index], ...record }; else labelRecords.push(record);
    });
    renderLabelList(); applyStyle(); rebuildOverlays();
    const readout = positionReadout({ chain, resi });
    renderPositionState();
    announce(readout);
  }

  function clearPositions() {
    if (!spotlightResidues.length && !labelRecords.some(label => label.kind === 'position')) { announce('No compared positions to clear'); return; }
    remember('compared positions');
    spotlightResidues = [];
    labelRecords = labelRecords.filter(label => label.kind !== 'position');
    renderLabelList(); applyStyle(); rebuildOverlays();
    renderPositionState();
    announce('Compared positions cleared');
  }

  root.querySelector('#gpv-position-compare').addEventListener('click', comparePosition);
  root.querySelector('#gpv-position-clear').addEventListener('click', clearPositions);
  root.querySelector('#gpv-position-sticks').addEventListener('change', () => {
    applyStyle();
    updateStatus(root.querySelector('#gpv-position-sticks').checked ? 'Side chains drawn at the compared positions' : 'Side chains at the compared positions hidden');
  });
