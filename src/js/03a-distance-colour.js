  /* ---------- Colour by distance from the selected residue ----------
     "How far is everything from this residue?" answered on the structure itself: every residue of
     the selected residue's model is coloured by the distance of its closest heavy atom to the
     selected residue — the min_heavy_distance of the residue card's Distances CSV, from the same
     function (residueDistanceRows, 04c) — in five fixed bands, the residue itself in orange. Other models, and every model while nothing is selected, are grey. The mode is a value
     of #gpv-color-mode like any other, so scenes, sessions and share links carry it; the selection
     is not saved with them, as it never has been, so a restored scene is grey until a residue is
     clicked. Fixed bands rather than a scale fitted to the model, so two figures read alike. The
     residue's orange is the Annotate highlight's, off the blue ramp and the same in either interface
     theme, so the residue stands out and a figure does not depend on the theme it was exported from;
     the far band is a grey dark enough to read on white paper. */

  const distanceFromResidueBands = [[4, '#1e3a8a', '≤4 Å'], [6, '#2563eb', '4–6 Å'], [10, '#60a5fa', '6–10 Å'], [20, '#bfdbfe', '10–20 Å'], [Infinity, '#d1d5db', '>20 Å']];
  const distanceFromResidueGrey = '#9ca3af';
  const distanceFromResidueSelf = '#f97316';
  /* What choosing the mode with nothing selected says (41); a selection replaces it. */
  const distanceColourHint = 'Click a residue first';
  /* { key, atoms, values } for the last residue coloured from: chain|resi → closest heavy-atom
     distance. One residue against a model is a single pass over its atoms, but colouring asks once
     per atom per viewer, panel and export, so the pass is made once per residue. */
  let distanceColourCache = null;
  /* The selection the view was last coloured for, so a click on the residue already selected (or a
     second selectResidue for the same one) does not restyle every model again. */
  let distanceColourDrawn = null;
  let distanceRecolourTimer = 0;

  function distanceColourKey() {
    const picked = selectedResidue;
    return picked ? picked.entryId + '|' + picked.chain + '|' + picked.resi : '';
  }

  /* The selected residue and the words for it, or null when nothing is selected or its model is gone. */
  function distanceColourTarget() {
    const picked = selectedResidue;
    if (!picked) return null;
    const entry = entryById(picked.entryId);
    if (!entry) return null;
    const residue = (picked.resn || 'RES') + residueNumber(picked);
    return {
      entry, chain: picked.chain || '', resi: picked.resi,
      short: residueName(picked),
      long: residue + (picked.chain ? ' of chain ' + picked.chain : '') + (structures.length > 1 ? ' in ' + displayName(entry) : '')
    };
  }

  function distanceFromResidueValues(entry, chain, resi) {
    const key = entry.id + '|' + chain + '|' + resi;
    if (distanceColourCache && distanceColourCache.key === key && distanceColourCache.atoms === entry.atoms) return distanceColourCache.values;
    const result = residueDistanceRows(entry, chain, resi);
    const values = result ? new Map(result.rows.map(row => [row.chain + '|' + row.resi, row.heavy])) : null;
    distanceColourCache = { key, atoms: entry.atoms, values };
    return values;
  }

  function distanceFromResidueBand(value) {
    return distanceFromResidueBands.find(([limit]) => value <= limit)[1];
  }

  /* The colour function for one model, with the residue's distances resolved once rather than per
     atom. Hetero groups and water have no distance of their own here — the rows are
     the polymer residues — so they are grey, unless they are the selected residue itself. */
  function distanceFromResidueColorFunc(entry) {
    distanceColourDrawn = distanceColourKey();
    const picked = selectedResidue;
    if (!picked || picked.entryId !== entry.id) return () => distanceFromResidueGrey;
    const values = distanceFromResidueValues(entry, picked.chain || '', picked.resi);
    return atom => {
      const chain = atom.chain || '';
      if (chain === (picked.chain || '') && atom.resi === picked.resi) return distanceFromResidueSelf;
      if (!values || atom.hetflag) return distanceFromResidueGrey;
      const value = values.get(chain + '|' + atom.resi);
      return value === undefined || value === null ? distanceFromResidueGrey : distanceFromResidueBand(value);
    };
  }

  /* The sequence strip's colour for one residue — the same function the view uses. */
  function distanceFromResidueColor(entry, atom) {
    return distanceFromResidueColorFunc(entry)(atom);
  }

  /* Called whenever the selected residue changes (selectResidue, clearSelectedResidue). Deferred to
     after the click that changed it, so the restyle never runs in the middle of a click handler, and
     the status line that click wrote is kept rather than replaced by applyStyle's "Ready" — except the
     "Click a residue first" hint the mode itself put up, which a residue now selected answers. */
  function distanceColourSelectionChanged() {
    if (root.querySelector('#gpv-color-mode').value !== 'fromresidue') return;
    if (distanceRecolourTimer || distanceColourKey() === distanceColourDrawn) return;
    distanceRecolourTimer = setTimeout(() => {
      distanceRecolourTimer = 0;
      if (root.querySelector('#gpv-color-mode').value !== 'fromresidue' || distanceColourKey() === distanceColourDrawn) return;
      const state = root.querySelector('#gpv-state'); const said = state.textContent;
      applyStyle();
      const target = distanceColourTarget();
      state.textContent = target && said.startsWith(distanceColourHint) ? 'Coloured by distance from ' + target.short : said;
    }, 0);
  }

  /* The key: the five bands and the residue they are measured from, named in the title. */
  function distanceColourLegend() {
    const target = distanceColourTarget();
    if (!target) return { title: 'Distance from a residue', items: [[distanceFromResidueGrey, 'none', 'No residue selected — click a residue first']] };
    return { title: 'Distance from ' + target.short, items: [...distanceFromResidueBands.map(([, color, label]) => [color, label]), [distanceFromResidueSelf, target.short, target.short + ' (selected)']] };
  }

  function distanceColourStripNote() {
    const target = distanceColourTarget();
    return target ? ' · coloured by distance from ' + target.short : ' · coloured by distance from a residue (click one)';
  }

  /* The figure legend's colour clause (28). */
  function distanceColourCaption() {
    const target = distanceColourTarget();
    if (!target) return 'shown in grey (distance colouring is selected but no residue is)';
    const others = displayedEntries().some(entry => entry.model && entry.id !== target.entry.id);
    return 'coloured by the distance of each residue’s closest heavy atom to ' + target.long + ' (≤4 Å dark blue, 4–6 Å blue, 6–10 Å light blue, 10–20 Å pale blue, >20 Å light grey; ' + target.short + ' itself in orange' + (others ? '; other models grey' : '') + ')';
  }

  /* The methods sentence (28): the definition behind the colours, so the figure can be reproduced. */
  function distanceColourMethods() {
    const target = distanceColourTarget();
    if (!target) return 'Distance colouring was selected with no residue selected, so every residue is shown in grey.';
    return 'Residues are coloured by the distance of their closest heavy atom to ' + target.long + ' in five bands (≤4, 4–6, 6–10, 10–20 and >20 Å): the shortest distance between any heavy atom of the residue and any heavy atom of ' + target.short + ', hydrogens and water excluded; ligands and ions are not coloured by distance.';
  }
