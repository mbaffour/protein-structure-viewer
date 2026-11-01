  /* ---------- Residue card, residue marker and Measure to… ----------
     "Select a residue and show what it is on the canvas; measure between residues, in contact or
     not." The label editor (04a) already opens at a clicked residue, so it becomes the residue card:
     above the label field it says what the residue is — pLDDT, secondary structure, how many
     residues sit around it. A small marker on the canvas keeps naming the selected residue after
     the card closes. And Measure to… (or M) takes the residue as the first point of a one-shot
     distance to the next residue clicked. All of it is UI state: the card and the marker are saved
     nowhere and never reach an export, and the measurement it makes is an ordinary measurement
     record, so scenes, sessions, share links and reports keep their shape. */

  /* The residue Measure to… measures from while it waits for the second click:
     { entryId, chain, resi, name }, or null when nothing is armed. */
  let measureFrom = null;

  /* The atom that stands for a residue — the Cα, else a nucleotide's P, else the residue's first
     atom — so the card, the marker and a measurement read the same atom whichever atom of the
     residue the click happened to land nearest. */
  function residueAlphaCarbon(entry, chain, resi) {
    let found = null;
    for (const atom of entry.atoms) {
      if ((atom.chain || '') !== (chain || '') || atom.resi !== resi) continue;
      if (atom.atom === 'CA' && !atom.hetflag) return atom;
      if (!found || (atom.atom === 'P' && found.atom !== 'P')) found = atom;
    }
    return found;
  }

  /* Whether this model's secondary structure says anything. 3Dmol assigns `ss` from HELIX/SHEET
     records or its own DSSP-like pass; a file it gave nothing to has 'c' (or no value) on every
     residue, and a card reading "loop" for every residue of a helical protein would be wrong, so
     such a model gets no secondary-structure word at all. Cached on the atoms array it describes. */
  function entryHasSecondaryStructure(entry) {
    if (!entry.ssCache || entry.ssCache.atoms !== entry.atoms) {
      entry.ssCache = { atoms: entry.atoms, known: entry.atoms.some(atom => atom.atom === 'CA' && (atom.ss === 'h' || atom.ss === 's')) };
    }
    return entry.ssCache.known;
  }

  const secondaryStructureWords = { h: 'α-helix', s: 'β-strand', c: 'loop' };
  function secondaryStructureWord(entry, atom) {
    if (!atom || !entryHasSecondaryStructure(entry)) return '';
    return secondaryStructureWords[atom.ss] || '';
  }

  /* `pLDDT 94.8 · α-helix · 7 residues within 4.5 Å`, each part only when it is known. The count is
     the proximity tool's own answer for this residue at the panel's cutoff, so the two never
     disagree; it is worked out once when the card opens, not every frame it follows the residue. */
  function residueCardFacts(entry, atom) {
    const parts = [];
    if (entry.scores.length && Number.isFinite(Number(atom.b))) parts.push('pLDDT ' + Number(atom.b).toFixed(1));
    const ss = secondaryStructureWord(entry, atom);
    if (ss) parts.push(ss);
    const near = entry.model ? nearbyResidues({ entry, mode: 'residue', residue: { chain: atom.chain || '', resi: atom.resi } }) : null;
    if (near && !near.error) parts.push(plural(near.residues.length, 'residue') + ' within ' + near.cutoff + ' Å');
    return parts.join(' · ');
  }

  /* The card's own parts, made once with the editor (labelEditorElement) and placed by it: the
     facts line under the residue line, and Measure to… among the buttons. */
  function residueCardElements() {
    const facts = document.createElement('div');
    facts.id = 'gpv-residue-card-facts'; facts.className = 'gpv-residue-card-facts text-small'; facts.hidden = true;
    const measure = document.createElement('button');
    measure.type = 'button'; measure.className = 'btn btn-ghost'; measure.id = 'gpv-label-editor-measure'; measure.textContent = 'Measure to…';
    measure.addEventListener('click', measureToFromCard);
    return { facts, measure };
  }

  /* Called by openLabelEditor once the head line is set. A residue's card gets the two lines and
     Measure to…; annotation text, which belongs to no residue, gets neither. */
  function fillResidueCard(host, target, residueLine) {
    const facts = host.querySelector('#gpv-residue-card-facts');
    const measure = host.querySelector('#gpv-label-editor-measure');
    const entry = residueLine && target.kind !== 'annotation' ? entryById(target.entryId) : null;
    if (!entry || !target.atom) { facts.hidden = true; facts.textContent = ''; measure.hidden = true; return; }
    const chain = target.atom.chain || '';
    const atom = residueAlphaCarbon(entry, chain, target.atom.resi) || target.atom;
    /* The model is named only when there is more than one to tell apart. */
    host.querySelector('.gpv-label-editor-residue').textContent = (atom.resn || 'RES') + atom.resi + (chain ? ' · chain ' + chain : '') + (structures.length > 1 ? ' · ' + displayName(entry) : '');
    const text = residueCardFacts(entry, atom);
    facts.textContent = text; facts.hidden = !text;
    measure.hidden = false;
    refreshMeasureToButton();
  }

  /* One mode at a time: a click while measuring or drawing already belongs to that mode, so the
     one-shot cannot be armed beside either. Null when nothing is in the way. */
  function measureToBlocker() {
    if (measurementActive) return 'Measure to… is off while measurement mode is on — stop measuring first';
    if (annotationActive) return 'Measure to… is off while drawing — stop drawing first';
    return null;
  }

  /* Run when the card opens and every frame it follows its residue, so turning measurement or
     drawing on or off from the panel while the card is open is reflected at once. Assignments are
     skipped when nothing changed, to leave the DOM alone 60 times a second. */
  function refreshMeasureToButton() {
    const button = labelEditorHost && labelEditorHost.querySelector('#gpv-label-editor-measure');
    if (!button || button.hidden) return;
    const blocker = measureToBlocker();
    const title = blocker || 'Measure the Cα–Cα distance from this residue to the next residue you click (M)';
    if (button.disabled !== Boolean(blocker)) button.disabled = Boolean(blocker);
    if (button.title !== title) button.title = title;
  }

  function measureToFromCard() {
    const editor = labelEditor;
    if (!editor || editor.kind === 'annotation') return;
    const blocker = measureToBlocker();
    if (blocker) { updateStatus(blocker); return; }
    const entry = entryById(editor.entryId);
    closeLabelEditor(true);
    if (!entry) { updateStatus('That residue’s model is no longer loaded'); return; }
    armMeasureTo(entry, editor.atom);
  }

  /* M: the residue already selected, without opening the card. */
  function measureToFromSelection() {
    if (!selectedResidue) { updateStatus('Select a residue first — click it in the viewer or the sequence strip — then press M to measure from it'); return; }
    const blocker = measureToBlocker();
    if (blocker) { updateStatus(blocker); return; }
    const entry = entryById(selectedResidue.entryId);
    if (!entry) { updateStatus('The selected residue’s model is no longer loaded'); return; }
    closeLabelEditor(false);
    armMeasureTo(entry, selectedResidue);
  }

  function armMeasureTo(entry, atom) {
    const chain = atom.chain || '';
    const first = residueAlphaCarbon(entry, chain, atom.resi);
    if (!first) { updateStatus('No atoms of that residue are loaded to measure from'); return; }
    measureFrom = { entryId: entry.id, chain, resi: atom.resi, name: labelEditorDefaultText(first) };
    root.querySelector('#gpv-stage').classList.add('is-measuring-to');
    updateStatus('Click a second residue to measure from ' + measureFrom.name + ' · Esc cancels');
  }

  /* Returns whether there was anything to cancel, so Esc can tell whether it was used. */
  function cancelMeasureTo(announceIt = false) {
    if (!measureFrom) return false;
    measureFrom = null;
    root.querySelector('#gpv-stage').classList.remove('is-measuring-to');
    if (announceIt) updateStatus('Measure to… cancelled');
    return true;
  }

  /* Turning measuring, drawing or Drag to select on drops an armed Measure to…: the next click is
     that mode's now. The card's button follows the change too. */
  function measureToModesChanged() {
    if (measurementActive || annotationActive || boxSelectMode) cancelMeasureTo(false);
    refreshMeasureToButton();
  }

  /* The closest approach of the two residues' heavy atoms — what says whether they touch, which the
     Cα–Cα distance alone does not. A residue has a few dozen atoms at most, so every pair is tried. */
  function closestHeavyAtomDistance(entryA, residueA, entryB, residueB) {
    const residueAtoms = (entry, residue) => heavyAtoms({ atoms: entry.atoms.filter(atom => (atom.chain || '') === residue.chain && atom.resi === residue.resi) });
    const atomsA = residueAtoms(entryA, residueA); const atomsB = residueAtoms(entryB, residueB);
    let best = Infinity;
    atomsA.forEach(a => atomsB.forEach(b => { best = Math.min(best, squaredDistance(a, b)); }));
    return Number.isFinite(best) ? Math.sqrt(best) : null;
  }

  /* The second click of an armed Measure to…, from handleAtomClick — so a click in the viewer, a
     pick in the strip or the letters, and Go to all finish it the same way. The result is the
     record measurement mode would have made for a click on each Cα: drawn by drawMeasurements,
     listed, exported, saved and undone exactly like one, as one undo step. */
  function finishMeasureTo(entry, atom) {
    const from = measureFrom;
    const chain = atom.chain || '';
    /* A slip onto the same residue measures nothing and keeps the arm, so the next click can still
       land on the residue that was meant. */
    if (from.entryId === entry.id && from.chain === chain && from.resi === atom.resi) {
      updateStatus('That is ' + from.name + ' itself — nothing measured · click a different residue, or Esc to cancel');
      return;
    }
    cancelMeasureTo(false);
    const fromEntry = entryById(from.entryId);
    const first = fromEntry && residueAlphaCarbon(fromEntry, from.chain, from.resi);
    const second = residueAlphaCarbon(entry, chain, atom.resi);
    if (!first || !second) { updateStatus('The first residue’s model is no longer loaded · nothing measured'); return; }
    remember('measurement');
    measurementRecords.push({ id: nextAnnotationId++, type: 'distance', points: [atomReference(fromEntry, first), atomReference(entry, second)] });
    renderMeasurementList(); rebuildOverlays();
    const distance = Math.sqrt(squaredDistance(first, second));
    const closest = closestHeavyAtomDistance(fromEntry, from, entry, { chain, resi: atom.resi });
    const pair = [first, second].map(item => (item.atom === 'CA' ? 'Cα' : item.atom || 'atom')).join('–');
    /* The closest approach is worth a mention only when it says something the Cα distance does not. */
    const contact = closest !== null && closest < distance - 0.05 ? ' · closest atoms ' + closest.toFixed(1) + ' Å' : '';
    updateStatus(from.name + ' — ' + labelEditorDefaultText(second) + ': ' + pair + ' ' + distance.toFixed(2) + ' Å' + contact);
  }

  /* The marker naming the selected residue on the main viewer: `GLU57 · B · pLDDT 94.8`, smaller
     than a label, on translucent paper with the accent border, so it never reads as a label record.
     drawLabels asks for it only when drawing the main viewer, as it does for the active label's
     ring — exports, comparison panels, figures and the report never get it. None when the residue's
     model or chain is not shown, or when the residue carries a label, which already says what it is. */
  function residueMarkerSpec(shownIds) {
    const picked = selectedResidue;
    if (!picked || !shownIds.has(picked.entryId)) return null;
    const entry = entryById(picked.entryId);
    if (!entry || !entry.model || (entry.hiddenChains || []).includes(picked.chain)) return null;
    const key = residueKey(picked.entryId, picked.chain, picked.resi);
    if (labelRecords.some(label => label.key === key)) return null;
    const atom = residueAlphaCarbon(entry, picked.chain, picked.resi) || picked;
    const confidence = entry.scores.length && Number.isFinite(Number(atom.b)) ? ' · pLDDT ' + Number(atom.b).toFixed(1) : '';
    const style = {
      ...labelStyle({ x: atom.x, y: atom.y, z: atom.z }, { size: 10 }),
      borderColor: themeColor('--primary', '#339cff'), borderOpacity: 1, borderThickness: 1,
      showBackground: true, backgroundOpacity: 0.7
    };
    return { text: labelEditorDefaultText(atom) + confidence, style };
  }

  function residueMarkerText() {
    const spec = residueMarkerSpec(new Set(displayedEntries().map(entry => entry.id)));
    return spec ? spec.text : null;
  }

  /* Esc with nothing else to close, Clear all, and recording a video leave no residue selected — and
     so no marker. The panel's readout goes back to what a fresh page says. */
  function clearSelectedResidue(shouldRender = true) {
    cancelMeasureTo(false);
    if (!selectedResidue) return false;
    selectedResidue = null;
    root.querySelector('#gpv-residue').textContent = idleResidueText;
    root.querySelector('#gpv-label-text').value = '';
    root.querySelector('#gpv-add-label').disabled = true;
    updatePositionCompare();
    if (shouldRender) rebuildOverlays();
    return true;
  }

