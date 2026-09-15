  /* ---------- Position comparison ----------
     A mutation study loads the same protein twice — one run of the wild type, one of the point
     mutant — and the question is what sits at one position in each, and what that substitution did
     to the structure around it. Compare this position takes the selected residue and, in every shown
     model, draws the side chain there, writes that model's own residue on it, and states whether the
     models agree. Corresponding residues are found by the alignment pairing when the models have
     been superposed — so an insertion or a deletion between the runs no longer derails the
     comparison — and by chain and residue number otherwise, which is what two runs of the same
     sequence share. After a superposition the neighbourhood table adds the second half of the
     answer: how far the site and every residue around it moved. */
  let spotlightResidues = [];
  let positionEffect = null;

  /* ARG → Arg: the three-letter code as it is written in a figure label. */
  function positionResidueName(resn) {
    const text = String(resn || 'RES').trim() || 'RES';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
  const positionTag = spot => (spot.chain ? spot.chain + ':' : '') + spot.resi;

  /* The model every other model is compared against: the reference of the superposition that is
     current, when it is one of the shown models. Without one there is nothing to pair through. */
  function positionReference() {
    if (!alignmentResults.length) return null;
    const reference = entryById(Number(root.querySelector('#gpv-reference').value));
    if (!reference || !reference.model) return null;
    return displayedEntries().includes(reference) ? reference : null;
  }

  /* The Cα pairing the superposition used, as reference residue tag → the target's own atom.
     Align visible records the pairing it fitted on, which is the honest one: it carries the fit
     region and any positional chain re-matching. A model that was not part of that fit falls back to
     rebuilding the pairing with caPairs(), cached against the alignment that is current so a residue
     costs one lookup however many neighbours are asked for. */
  let positionPairCache = { token: null, maps: new Map() };
  function positionPairing(reference, entry) {
    if (entry.deviations && entry.alignedPairs instanceof Map) return entry.alignedPairs;
    if (positionPairCache.token !== alignmentResults) positionPairCache = { token: alignmentResults, maps: new Map() };
    const key = reference.id + '|' + entry.id + '|' + root.querySelector('#gpv-alignment-mode').value;
    if (!positionPairCache.maps.has(key)) {
      const map = new Map();
      try {
        caPairs(reference, entry).pairs.forEach(pair => {
          const tag = residueTag(pair[0]);
          if (!map.has(tag)) map.set(tag, pair[1]);
        });
      } catch (error) { /* a model with too few Cα atoms simply has no pairing */ }
      positionPairCache.maps.set(key, map);
    }
    return positionPairCache.maps.get(key);
  }

  /* The atom one model carries at a position: the residue the alignment placed opposite the
     reference's, whatever its number, and the same chain and number when there is no pairing. */
  function positionAtomIn(entry, chain, resi, reference) {
    if (reference && entry !== reference) {
      const partner = positionPairing(reference, entry).get((chain || '') + '|' + resi);
      if (partner) return partner;
    }
    const candidates = entry.atoms.filter(atom => !atom.hetflag && atom.resi === resi && (atom.chain || '') === (chain || ''));
    return candidates.find(item => item.atom === 'CA') || candidates[0] || null;
  }

  /* Every shown model that has this position, with the atom the label hangs on. */
  function positionAtoms(chain, resi) {
    const reference = positionReference();
    return displayedEntries().filter(entry => entry.model).map(entry => {
      const atom = positionAtomIn(entry, chain, resi, reference);
      return atom ? { entry, atom } : null;
    }).filter(Boolean);
  }

  /* Ala, or Ala17 when that model numbers the corresponding residue differently. */
  function positionIdentity(spot, item) {
    const name = positionResidueName(item.atom.resn);
    return item.atom.resi === spot.resi ? name : name + item.atom.resi;
  }

  function positionCutoff() {
    return Math.min(12, Math.max(3, Number(root.querySelector('#gpv-position-cutoff').value) || 5));
  }

  /* What the substitution did, as the tail of the readout line. */
  function positionEffectTail(spot) {
    if (!alignmentResults.length) return ' · Align visible first to measure what moved';
    if (!positionEffect || positionEffect.spot.chain !== spot.chain || positionEffect.spot.resi !== spot.resi) return '';
    const parts = [];
    const site = positionEffect.summary.siteDeviation
      .map((value, index) => (Number.isFinite(value) ? value.toFixed(2) + ' Å in ' + positionEffect.models[index] : null))
      .filter(Boolean);
    if (site.length) parts.push('site moved ' + site.join(', '));
    const moved = positionEffect.summary.neighbourMean.filter(Number.isFinite);
    if (positionEffect.summary.neighbourCount && moved.length) {
      parts.push(positionEffect.summary.neighbourCount + ' neighbour' + (positionEffect.summary.neighbourCount === 1 ? '' : 's')
        + ' within ' + positionEffect.cutoff + ' Å moved ' + mean(moved).toFixed(2) + ' Å on average');
    }
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  /* The readout: one line naming the position, what each model has there, and whether they differ. */
  function positionReadout(spot) {
    const found = positionAtoms(spot.chain, spot.resi);
    if (!found.length) return positionTag(spot) + ' · in none of the shown models';
    const identities = found.map(item => positionResidueName(item.atom.resn));
    const renumbered = found.some(item => item.atom.resi !== spot.resi);
    const tag = positionTag(spot);
    const tail = positionEffectTail(spot);
    if (new Set(identities).size === 1 && !renumbered) return tag + ' · ' + identities[0] + ' in all ' + found.length + ' model' + (found.length === 1 ? '' : 's') + tail;
    const names = distinguishingNames(found.map(item => displayName(item.entry)));
    const parts = found.map((item, index) => names[index] + ' ' + positionIdentity(spot, item));
    const verdict = new Set(identities).size === 1 ? 'same residue, numbered differently' : 'differs';
    return tag + ' · ' + (found.length === 2 ? parts[0] + ' → ' + parts[1] : parts.join(' · ')) + ' · ' + verdict + tail;
  }

  /* The same comparison as a sentence for the figure legend. */
  function positionSentence(spot) {
    const found = positionAtoms(spot.chain, spot.resi);
    if (!found.length) return null;
    const drawn = root.querySelector('#gpv-position-sticks').checked ? 'is drawn as side-chain sticks and labelled' : 'is labelled';
    const identities = found.map(item => positionResidueName(item.atom.resn));
    const lead = 'Position ' + positionTag(spot) + ' ' + drawn + ' in every model; it is ';
    if (new Set(identities).size === 1 && !found.some(item => item.atom.resi !== spot.resi)) return lead + identities[0] + ' in all ' + found.length + ' of them.';
    const names = distinguishingNames(found.map(item => displayName(item.entry)));
    const parts = found.map((item, index) => positionIdentity(spot, item) + ' in ' + names[index]);
    return lead + parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] + '.';
  }

  /* The effect sentence for the figure legend, when the neighbourhood has been measured. */
  function positionEffectLegend(spot) {
    if (!positionEffect || positionEffect.spot.chain !== spot.chain || positionEffect.spot.resi !== spot.resi) return null;
    const site = positionEffect.summary.siteDeviation
      .map((value, index) => (Number.isFinite(value) ? value.toFixed(2) + ' Å in ' + positionEffect.models[index] : null))
      .filter(Boolean);
    if (!site.length) return null;
    const joined = site.length === 1 ? site[0] : site.slice(0, -1).join(', ') + ' and ' + site[site.length - 1];
    const moved = positionEffect.summary.neighbourMean.filter(Number.isFinite);
    const neighbours = positionEffect.summary.neighbourCount && moved.length
      ? ', and the ' + positionEffect.summary.neighbourCount + ' residue' + (positionEffect.summary.neighbourCount === 1 ? '' : 's')
        + ' within ' + positionEffect.cutoff + ' Å moved ' + mean(moved).toFixed(2) + ' Å on average'
      : '';
    return 'After superposition the Cα at ' + positionTag(spot) + ' moved ' + joined + neighbours + '.';
  }

  /* ---- The local effect of a substitution ----
     The neighbourhood is every residue of the reference model with a heavy atom within the cutoff of
     the spotlighted residue; for the site and each of those neighbours the table reports how far the
     corresponding Cα of every other shown model sits from the reference after the superposition.
     That is the answer to "what did this mutation do?" in the only terms the models support. */
  function computePositionEffect(spot) {
    const reference = positionReference();
    if (!reference) return null;
    const others = displayedEntries().filter(entry => entry.model && entry !== reference);
    if (!others.length) return null;
    const site = positionAtomIn(reference, spot.chain, spot.resi, null);
    if (!site) return null;
    const cutoff = positionCutoff();
    const heavy = heavyAtoms(reference).filter(atom => !atom.hetflag);
    const isSiteAtom = atom => (atom.chain || '') === (site.chain || '') && atom.resi === site.resi;
    const siteAtoms = heavy.filter(isSiteAtom);
    if (!siteAtoms.length) return null;
    const candidates = heavy.filter(atom => !isSiteAtom(atom));
    const grid = spatialGrid(candidates, cutoff);
    const limit = cutoff * cutoff;
    const found = new Map();
    siteAtoms.forEach(target => grid.near(target).forEach(index => {
      const atom = candidates[index];
      if (squaredDistance(atom, target) > limit) return;
      const tag = residueTag(atom);
      if (!found.has(tag)) found.set(tag, atom);
    }));
    const allNames = distinguishingNames([reference, ...others].map(displayName));
    const deviationsOf = atom => others.map(entry => {
      if (!entry.deviations) return null;
      const partner = positionPairing(reference, entry).get(residueTag(atom));
      const value = partner ? entry.deviations.get(residueTag(partner)) : undefined;
      return Number.isFinite(value) ? value : null;
    });
    const rowFor = (atom, isSite) => {
      const deviations = deviationsOf(atom);
      const finite = deviations.filter(Number.isFinite);
      return { chain: atom.chain || '', resi: atom.resi, resn: atom.resn || 'RES', isSite, deviations, mean: finite.length ? mean(finite) : null };
    };
    const rank = row => (row.mean === null ? -1 : row.mean);
    const neighbours = [...found.values()].map(atom => rowFor(atom, false))
      .sort((a, b) => rank(b) - rank(a) || compareChains(a.chain, b.chain) || a.resi - b.resi);
    const summary = {
      siteDeviation: deviationsOf(site),
      neighbourMean: others.map((entry, index) => {
        const values = neighbours.map(row => row.deviations[index]).filter(Number.isFinite);
        return values.length ? mean(values) : null;
      }),
      neighbourCount: neighbours.length
    };
    return {
      spot: { chain: spot.chain, resi: spot.resi }, cutoff,
      reference: allNames[0], models: allNames.slice(1),
      rows: [rowFor(site, true), ...neighbours], summary
    };
  }

  function renderPositionEffect() {
    const wrap = root.querySelector('#gpv-position-effect-wrap');
    const head = root.querySelector('#gpv-position-effect-head');
    const body = root.querySelector('#gpv-position-effect-body');
    head.replaceChildren(); body.replaceChildren();
    root.querySelector('#gpv-position-highlight').disabled = !positionEffect;
    root.querySelector('#gpv-position-csv').disabled = !positionEffect;
    wrap.hidden = !positionEffect;
    if (!positionEffect) return;
    const headRow = document.createElement('tr');
    const corner = document.createElement('th'); corner.textContent = 'Residue'; headRow.append(corner);
    positionEffect.models.forEach(name => {
      const cell = document.createElement('th'); cell.className = 'text-end';
      cell.textContent = 'Cα Δ (Å) vs ' + name; headRow.append(cell);
    });
    head.append(headRow);
    const numberCell = (value, bold) => {
      const cell = document.createElement('td'); cell.className = 'text-end';
      cell.textContent = Number.isFinite(value) ? value.toFixed(2) : '—';
      if (bold) cell.style.fontWeight = '700';
      return cell;
    };
    positionEffect.rows.forEach(row => {
      const tr = document.createElement('tr');
      const label = document.createElement('th'); label.scope = 'row';
      label.textContent = (row.chain ? row.chain + ':' : '') + positionResidueName(row.resn) + row.resi + (row.isSite ? ' (site)' : '');
      if (row.isSite) label.style.fontWeight = '700';
      tr.append(label);
      row.deviations.forEach(value => tr.append(numberCell(value, row.isSite)));
      body.append(tr);
    });
    const summaryRow = document.createElement('tr');
    const summaryLabel = document.createElement('th'); summaryLabel.scope = 'row';
    summaryLabel.textContent = 'Neighbourhood mean (' + positionEffect.summary.neighbourCount + ' residue' + (positionEffect.summary.neighbourCount === 1 ? '' : 's') + ')';
    summaryRow.append(summaryLabel);
    positionEffect.summary.neighbourMean.forEach(value => summaryRow.append(numberCell(value, false)));
    body.append(summaryRow);
  }

  /* The neighbourhood as an ordinary highlight selection on the reference model, one record per
     chain, so it can be recoloured, removed and undone like any other. */
  function highlightNeighbourhood() {
    if (!positionEffect) return;
    const reference = positionReference();
    if (!reference) { announce('Align visible first — the neighbourhood is measured on the reference model', 'error'); return; }
    const neighbours = positionEffect.rows.filter(row => !row.isSite);
    if (!neighbours.length) { announce('No residues within ' + positionEffect.cutoff + ' Å of ' + positionTag(positionEffect.spot) + ' to highlight'); return; }
    remember('neighbourhood');
    const byChain = new Map();
    neighbours.forEach(row => { if (!byChain.has(row.chain)) byChain.set(row.chain, []); byChain.get(row.chain).push(row.resi); });
    byChain.forEach((residues, chain) => selectionRecords.push({
      id: nextAnnotationId++, entryId: reference.id, chain,
      residues: residues.sort((a, b) => a - b), action: 'highlight', color: '#f97316'
    }));
    renderSelectionList(); applyStyle();
    updateStatus(neighbours.length + ' residue' + (neighbours.length === 1 ? '' : 's') + ' within ' + positionEffect.cutoff + ' Å of '
      + positionTag(positionEffect.spot) + ' highlighted on ' + displayName(reference) + ' · manage it in the Selections list');
  }

  function downloadPositionEffectCsv() {
    if (!positionEffect) return;
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['chain', 'resi', 'resn', 'role', ...positionEffect.models.map(name => 'ca_deviation_angstrom_' + name)]];
    positionEffect.rows.forEach(row => rows.push([row.chain, row.resi, row.resn, row.isSite ? 'site' : 'neighbour',
      ...row.deviations.map(value => (Number.isFinite(value) ? value.toFixed(3) : ''))]));
    downloadBlob(rows.map(row => row.map(quote).join(',')).join('\n'), 'text/csv', 'position-effect.csv');
    announce('Effect CSV downloaded · ' + positionEffect.summary.neighbourCount + ' neighbour' + (positionEffect.summary.neighbourCount === 1 ? '' : 's') + ' within ' + positionEffect.cutoff + ' Å');
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
    positionEffect = alignmentResults.length ? computePositionEffect({ chain, resi }) : null;
    renderPositionEffect();
    renderLabelList(); applyStyle(); rebuildOverlays();
    renderPositionState();
    announce(positionReadout({ chain, resi }));
  }

  function clearPositions() {
    if (!spotlightResidues.length && !labelRecords.some(label => label.kind === 'position')) { announce('No compared positions to clear'); return; }
    remember('compared positions');
    spotlightResidues = [];
    positionEffect = null; renderPositionEffect();
    labelRecords = labelRecords.filter(label => label.kind !== 'position');
    renderLabelList(); applyStyle(); rebuildOverlays();
    renderPositionState();
    announce('Compared positions cleared');
  }

  root.querySelector('#gpv-position-compare').addEventListener('click', comparePosition);
  root.querySelector('#gpv-position-clear').addEventListener('click', clearPositions);
  root.querySelector('#gpv-position-highlight').addEventListener('click', highlightNeighbourhood);
  root.querySelector('#gpv-position-csv').addEventListener('click', downloadPositionEffectCsv);
  root.querySelector('#gpv-position-cutoff').addEventListener('change', () => {
    if (!positionEffect) return;
    positionEffect = computePositionEffect(positionEffect.spot);
    renderPositionEffect();
    renderPositionState();
    updateStatus('Neighbourhood measured within ' + positionCutoff() + ' Å');
  });
  root.querySelector('#gpv-position-sticks').addEventListener('change', () => {
    applyStyle();
    updateStatus(root.querySelector('#gpv-position-sticks').checked ? 'Side chains drawn at the compared positions' : 'Side chains at the compared positions hidden');
  });
