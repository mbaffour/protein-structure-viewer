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

  /* What a residue-to-residue measurement made from the card joins: 'ca' (the two Cα atoms, as
     2.50.0 always did) or 'closest' (the closest heavy-atom pair of the two residues). A UI
     preference, kept in the same store as the others under `measureAtoms`; the record it makes is
     an ordinary two-atom distance either way, so nothing saved changes shape. Read here, at start-up,
     because the card's select is built only when the card first opens. */
  const measureAtomChoices = ['ca', 'closest'];
  let measureAtoms = storedMeasureAtoms();
  /* The card's contacts list for this opening of the card — { entryId, chain, resi, cutoff, rows,
     near } once the list has been opened, null before. Worked out on first open and kept until the
     card closes or opens at another residue, so hovering and measuring rows never recompute it. */
  let cardContacts = null;
  /* The residue a contacts row is pointing at while the pointer or focus is on it:
     { entryId, chain, resi }, drawn as a temporary label on the main view only. */
  let contactHover = null;

  function storedMeasureAtoms() {
    const stored = readJson(preferenceKey, null);
    return stored && typeof stored === 'object' && measureAtomChoices.includes(stored.measureAtoms) ? stored.measureAtoms : 'ca';
  }

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
     disagree; it is worked out once when the card opens, not every frame it follows the residue.
     The count comes back apart from the rest because the card makes it the link that opens the
     contacts list. */
  function residueCardFacts(entry, atom) {
    const parts = [];
    if (entry.scores.length && Number.isFinite(Number(atom.b))) parts.push('pLDDT ' + Number(atom.b).toFixed(1));
    const ss = secondaryStructureWord(entry, atom);
    if (ss) parts.push(ss);
    const near = entry.model ? nearbyResidues({ entry, mode: 'residue', residue: { chain: atom.chain || '', resi: atom.resi } }) : null;
    const nearText = near && !near.error ? plural(near.residues.length, 'residue') + ' within ' + near.cutoff + ' Å' : '';
    return { parts, nearText };
  }

  /* The card's own parts, made once with the editor (labelEditorElement) and placed by it: the
     facts line under the residue line, the contacts list under that, and Measure to…, the measure
     choice, Contacts and the distances CSV among the buttons. */
  function residueCardElements() {
    const facts = document.createElement('div');
    facts.id = 'gpv-residue-card-facts'; facts.className = 'gpv-residue-card-facts text-small'; facts.hidden = true;
    const measure = document.createElement('button');
    measure.type = 'button'; measure.className = 'btn btn-ghost'; measure.id = 'gpv-label-editor-measure'; measure.textContent = 'Measure to…';
    measure.addEventListener('click', measureToFromCard);
    const contacts = document.createElement('button');
    contacts.type = 'button'; contacts.className = 'btn btn-ghost'; contacts.id = 'gpv-label-editor-contacts'; contacts.textContent = 'Contacts';
    contacts.title = 'List the residues in contact with this one — the residues counted on the line above — nearest first, with the closest atoms and the Cα–Cα distance';
    contacts.setAttribute('aria-controls', 'gpv-residue-contacts'); contacts.setAttribute('aria-expanded', 'false');
    contacts.addEventListener('click', toggleResidueContacts);
    const distances = document.createElement('button');
    distances.type = 'button'; distances.className = 'btn btn-ghost'; distances.id = 'gpv-label-editor-distances'; distances.textContent = 'Distances CSV';
    distances.title = 'Download the distance from this residue to every residue of its model — Cα–Cα and closest heavy atoms — nearest first';
    distances.addEventListener('click', downloadResidueDistancesFromCard);
    const atoms = document.createElement('label');
    atoms.className = 'gpv-residue-card-atoms text-small'; atoms.id = 'gpv-label-editor-measure-atoms-wrap';
    atoms.title = 'What Measure to…, M, a click on a contact and Measure all join: the two residues’ Cα atoms, or their closest pair of heavy atoms. Remembered for next time; the contact and distance map always measures Cα–Cα';
    const select = document.createElement('select');
    select.className = 'form-select'; select.id = 'gpv-label-editor-measure-atoms';
    [['ca', 'Cα–Cα'], ['closest', 'closest atoms']].forEach(([value, text]) => select.append(new Option(text, value)));
    select.value = measureAtoms;
    select.addEventListener('change', () => setMeasureAtoms(select.value));
    atoms.append('Measure ', select);
    const list = residueContactsElement();
    return { facts, measure, contacts, distances, atoms, list };
  }

  /* The contacts list: three actions over a scrolling list of rows, each row a button so the list
     can be walked with Tab and a row measured with Enter. Filled by renderResidueContacts. */
  function residueContactsElement() {
    const panel = document.createElement('div');
    panel.id = 'gpv-residue-contacts'; panel.className = 'gpv-residue-contacts'; panel.hidden = true;
    const tools = document.createElement('div'); tools.className = 'gpv-residue-contacts-tools';
    const button = (id, text, title, action) => {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'btn btn-ghost'; item.id = id; item.textContent = text; item.title = title;
      item.addEventListener('click', action);
      return item;
    };
    tools.append(
      button('gpv-residue-contacts-measure-all', 'Measure all', 'Draw a measurement from this residue to every residue listed — Cα–Cα or closest atoms, as the Measure choice says — in one undo step', measureAllContacts),
      button('gpv-residue-contacts-highlight', 'Highlight', 'Highlight the listed residues in the Annotate tab’s highlight colour — what Highlight nearby residues makes for this residue', highlightContactsFromCard),
      button('gpv-residue-contacts-copy', 'Copy', 'Copy the list as tab-separated text: residue, chain, closest distance, the two atoms, Cα–Cα distance', copyContactsFromCard)
    );
    const rows = document.createElement('ul'); rows.className = 'gpv-residue-contacts-rows'; rows.id = 'gpv-residue-contacts-rows';
    rows.setAttribute('aria-label', 'Residues in contact');
    const empty = document.createElement('div'); empty.className = 'gpv-residue-contacts-empty text-small'; empty.hidden = true;
    panel.append(tools, rows, empty);
    return panel;
  }

  /* Called by openLabelEditor once the head line is set. A residue's card gets the two lines,
     Measure to…, the measure choice and Contacts; annotation text, which belongs to no residue, gets
     none of them. Every opening starts with the contacts list closed and uncomputed. */
  function fillResidueCard(host, target, residueLine) {
    resetResidueContacts(true);
    const facts = host.querySelector('#gpv-residue-card-facts');
    const own = ['#gpv-label-editor-measure', '#gpv-label-editor-contacts', '#gpv-label-editor-distances', '#gpv-label-editor-measure-atoms-wrap'].map(selector => host.querySelector(selector));
    const entry = residueLine && target.kind !== 'annotation' ? entryById(target.entryId) : null;
    if (!entry || !target.atom) { facts.hidden = true; facts.textContent = ''; own.forEach(item => { item.hidden = true; }); return; }
    const chain = target.atom.chain || '';
    const atom = residueAlphaCarbon(entry, chain, target.atom.resi) || target.atom;
    /* The model is named only when there is more than one to tell apart. */
    host.querySelector('.gpv-label-editor-residue').textContent = (atom.resn || 'RES') + atom.resi + (chain ? ' · chain ' + chain : '') + (structures.length > 1 ? ' · ' + displayName(entry) : '');
    const { parts, nearText } = residueCardFacts(entry, atom);
    /* The line reads exactly as before — the count is a link only in how it behaves. */
    facts.replaceChildren();
    if (parts.length) facts.append(parts.join(' · ') + (nearText ? ' · ' : ''));
    if (nearText) {
      const link = document.createElement('button');
      link.type = 'button'; link.className = 'gpv-residue-card-near'; link.id = 'gpv-residue-card-near'; link.textContent = nearText;
      link.title = 'List these residues: closest atoms and Cα–Cα distance for each';
      link.setAttribute('aria-controls', 'gpv-residue-contacts'); link.setAttribute('aria-expanded', 'false');
      link.addEventListener('click', toggleResidueContacts);
      facts.append(link);
    }
    facts.hidden = !parts.length && !nearText;
    own.forEach(item => { item.hidden = false; });
    const select = host.querySelector('#gpv-label-editor-measure-atoms');
    if (select.value !== measureAtoms) select.value = measureAtoms;
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
    const title = blocker || 'Measure the ' + (measureAtoms === 'closest' ? 'closest heavy-atom' : 'Cα–Cα') + ' distance from this residue to the next residue you click (M)';
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

  /* Every residue's heavy atoms, in file order, keyed chain|resi — so the closest-pair search below
     does not filter the whole model once per pair when a contacts list asks it twenty times over, or
     the validation once per residue of a chain. Cached on the atoms array it indexes; the atoms are
     the model's own objects, so a superposition that moves them moves what the index holds. */
  function residueHeavyAtomIndex(entry) {
    if (!entry.residueAtomCache || entry.residueAtomCache.atoms !== entry.atoms) {
      const map = new Map();
      heavyAtoms(entry).forEach(atom => {
        const key = (atom.chain || '') + '|' + atom.resi;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(atom);
      });
      entry.residueAtomCache = { atoms: entry.atoms, map };
    }
    return entry.residueAtomCache.map;
  }

  /* The closest approach of the two residues' heavy atoms — what says whether they touch, which the
     Cα–Cα distance alone does not — as the pair of atoms itself, so a measurement can be drawn
     between them. A residue has a few dozen atoms at most, so every pair is tried; a tie keeps the
     first pair found in atom order, so the answer never depends on anything but the file. */
  function closestHeavyAtomPair(entryA, residueA, entryB, residueB) {
    const atomsA = residueHeavyAtomIndex(entryA).get((residueA.chain || '') + '|' + residueA.resi) || [];
    const atomsB = residueHeavyAtomIndex(entryB).get((residueB.chain || '') + '|' + residueB.resi) || [];
    let best = Infinity; let a = null; let b = null;
    for (const first of atomsA) {
      for (const second of atomsB) {
        const d2 = squaredDistance(first, second);
        if (d2 < best) { best = d2; a = first; b = second; }
      }
    }
    return a ? { a, b, distance: Math.sqrt(best) } : null;
  }

  function closestHeavyAtomDistance(entryA, residueA, entryB, residueB) {
    const pair = closestHeavyAtomPair(entryA, residueA, entryB, residueB);
    return pair ? pair.distance : null;
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
    const made = fromEntry && measureResiduePair(fromEntry, from, entry, { chain, resi: atom.resi }, measureAtoms);
    if (!made) { updateStatus('The first residue’s model is no longer loaded · nothing measured'); return; }
    updateStatus(from.name + ' — ' + made.summary);
  }

  /* The record measurement mode would have made for a click on each residue's Cα — or, with atoms
     'closest', on the two atoms of their closest heavy-atom pair: drawn by drawMeasurements, listed,
     exported, saved and undone exactly like one, as one undo step. Shared by Measure to…, the card's
     contacts list and a click on the distance map (19), so they can never make different records;
     the map leaves `atoms` at its default because the map is a Cα map. Returns the two atoms, the
     distances and the status-line wording after the first residue's name, or null when either
     residue has no atoms loaded. */
  function measureResiduePair(entryA, residueA, entryB, residueB, atoms = 'ca') {
    const made = residuePairMeasurement(entryA, residueA, entryB, residueB, atoms);
    if (!made) return null;
    remember('measurement');
    measurementRecords.push(made.record);
    renderMeasurementList(); rebuildOverlays();
    return made;
  }

  /* The measurement record for a residue pair and what to say about it, without taking an undo step
     or adding it — so Measure all can add a whole list under one step. */
  function residuePairMeasurement(entryA, residueA, entryB, residueB, atoms = 'ca') {
    const chainA = residueA.chain || ''; const chainB = residueB.chain || '';
    const alphaA = residueAlphaCarbon(entryA, chainA, residueA.resi);
    const alphaB = residueAlphaCarbon(entryB, chainB, residueB.resi);
    if (!alphaA || !alphaB) return null;
    const nearest = closestHeavyAtomPair(entryA, { chain: chainA, resi: residueA.resi }, entryB, { chain: chainB, resi: residueB.resi });
    const closest = nearest ? nearest.distance : null;
    /* A residue with no heavy atom has no closest pair to draw; its Cα (or stand-in) still has a place. */
    const byAtoms = atoms === 'closest' && nearest;
    const first = byAtoms ? nearest.a : alphaA;
    const second = byAtoms ? nearest.b : alphaB;
    const record = { id: nextAnnotationId++, type: 'distance', points: [atomReference(entryA, first), atomReference(entryB, second)] };
    const distance = Math.sqrt(squaredDistance(first, second));
    const pair = [first, second].map(item => (item.atom === 'CA' ? 'Cα' : item.atom || 'atom')).join('–');
    /* The closest approach is worth a mention only when it says something the Cα distance does not —
       and is the distance itself when the closest atoms were measured. */
    const contact = !byAtoms && closest !== null && closest < distance - 0.05 ? ' · closest atoms ' + closest.toFixed(1) + ' Å' : '';
    return { record, first, second, distance, closest, summary: labelEditorDefaultText(second) + ': ' + pair + ' ' + distance.toFixed(2) + ' Å' + contact };
  }

  /* Distances from this residue: the card's residue against every residue of its model (one
     representative atom per residue, as the sequence strip and the distance map use — the Cα, else
     a nucleotide's P), with the closest heavy-atom approach for every one of them. One residue
     against a model is a few hundred thousand distance checks at most, so nothing is cut off by a
     cutoff here. The residue itself is left out: its distance to itself says nothing, and the
     first row is then the nearest other residue. Rows nearest first. */
  function residueDistanceRows(entry, chain, resi) {
    const origin = residueAlphaCarbon(entry, chain, resi);
    if (!origin) return null;
    const heavy = heavyAtoms(entry).filter(atom => !isWater(atom));
    const own = heavy.filter(atom => (atom.chain || '') === chain && atom.resi === resi);
    /* One pass over the model's heavy atoms, each tried against the few atoms of this residue. */
    const closest = new Map();
    heavy.forEach(atom => {
      if (atom.hetflag) return;
      const atomChain = atom.chain || '';
      if (atomChain === chain && atom.resi === resi) return;
      let best = Infinity;
      for (const mine of own) { const d2 = squaredDistance(atom, mine); if (d2 < best) best = d2; }
      const key = atomChain + '|' + atom.resi;
      if (!closest.has(key) || closest.get(key) > best) closest.set(key, best);
    });
    const rows = [];
    residueRows(entry).forEach(row => row.residues.forEach(atom => {
      if (row.chain === chain && atom.resi === resi) return;
      const best = closest.get(row.chain + '|' + atom.resi);
      rows.push({ chain: row.chain, resi: atom.resi, resn: atom.resn || '', ca: Math.sqrt(squaredDistance(origin, atom)), heavy: best === undefined || !Number.isFinite(best) ? null : Math.sqrt(best) });
    }));
    rows.sort((x, y) => x.ca - y.ca || compareChains(x.chain, y.chain) || x.resi - y.resi);
    return { origin, rows };
  }

  function downloadResidueDistancesFromCard() {
    const editor = labelEditor;
    if (!editor || editor.kind === 'annotation' || !editor.atom) return;
    const entry = entryById(editor.entryId);
    if (!entry || !entry.model) { updateStatus('That residue’s model is no longer loaded'); return; }
    const chain = editor.atom.chain || '';
    const result = residueDistanceRows(entry, chain, editor.atom.resi);
    if (!result || !result.rows.length) { updateStatus('No other residues in this model to measure to'); return; }
    const lines = [['chain', 'resi', 'resn', 'ca_distance', 'min_heavy_distance'].map(csvCell).join(',')];
    result.rows.forEach(row => lines.push([row.chain, row.resi, row.resn, row.ca.toFixed(3), row.heavy === null ? '' : row.heavy.toFixed(3)].map(csvCell).join(',')));
    const name = labelEditorDefaultText(result.origin);
    downloadBlob(lines.join('\n'), 'text/csv', 'distances-from-' + (chain ? chain + '-' : '') + result.origin.resi + '.csv');
    const nearest = result.rows[0];
    updateStatus('Distances from ' + name + ' · ' + plural(result.rows.length, 'residue') + ' · nearest ' + (nearest.resn || 'RES') + nearest.resi + (nearest.chain ? ' · ' + nearest.chain : '') + ' at ' + nearest.ca.toFixed(2) + ' Å (Cα–Cα)');
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
    return { text: labelEditorDefaultText(atom) + confidence, style: residueMarkerStyle(atom) };
  }

  function residueMarkerStyle(atom) {
    return {
      ...labelStyle({ x: atom.x, y: atom.y, z: atom.z }, { size: 10 }),
      borderColor: themeColor('--primary', '#339cff'), borderOpacity: 1, borderThickness: 1,
      showBackground: true, backgroundOpacity: 0.7
    };
  }

  /* The temporary label naming the residue a contacts row points at, in the marker's style so it
     reads as the card talking, not as a label. drawLabels asks for it on the main viewer only, as
     for the marker: never a record, never in an export. None when that residue's model or chain is
     not shown. */
  function contactHoverSpec(shownIds) {
    const hover = contactHover;
    if (!hover || !shownIds.has(hover.entryId)) return null;
    const entry = entryById(hover.entryId);
    if (!entry || !entry.model || (entry.hiddenChains || []).includes(hover.chain)) return null;
    const atom = residueAlphaCarbon(entry, hover.chain, hover.resi);
    return atom ? { text: labelEditorDefaultText(atom), style: residueMarkerStyle(atom) } : null;
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
    /* Colour by distance from the selected residue (03a) goes grey with nothing selected. */
    distanceColourSelectionChanged();
    if (shouldRender) rebuildOverlays();
    return true;
  }

  /* ---------- The residue's contacts, on the card ----------
     "Pick a residue and look for its contacts, or measure the distance between it and them." The
     list is the proximity tool's own answer for this residue at the Annotate cutoff — the same rule
     and the same residues as the count on the card and as Highlight nearby residues — with, for each
     one, its closest heavy-atom pair and the Cα–Cα distance. It is UI state: computed when opened,
     dropped when the card closes, saved nowhere. What it makes — measurements and a highlight — are
     ordinary records. */

  /* The residue's contacts at `cutoff` (the Annotate panel's Within when left out), nearest first by
     closest heavy-atom distance: { cutoff, rows: [{ chain, resi, resn, closest, atomA, atomB, ca }],
     near } — atomA is this residue's atom, atomB the contact's — or nearbyResidues' { error }. */
  function residueContactRows(entry, chain, resi, cutoff) {
    const near = nearbyResidues({ entry, mode: 'residue', residue: { chain, resi }, cutoff });
    if (!near) return { error: 'That residue’s model is not loaded' };
    if (near.error) return near;
    const origin = residueAlphaCarbon(entry, chain, resi);
    const rows = near.residues.map(item => {
      const pair = closestHeavyAtomPair(entry, { chain, resi }, entry, item);
      const other = residueAlphaCarbon(entry, item.chain, item.resi);
      return {
        chain: item.chain, resi: item.resi, resn: item.resn,
        closest: pair ? pair.distance : null, atomA: pair ? pair.a.atom || '' : '', atomB: pair ? pair.b.atom || '' : '',
        ca: origin && other ? Math.sqrt(squaredDistance(origin, other)) : null
      };
    });
    const nearestFirst = value => (value === null ? Infinity : value);
    rows.sort((x, y) => nearestFirst(x.closest) - nearestFirst(y.closest) || compareChains(x.chain, y.chain) || x.resi - y.resi);
    return { cutoff: near.cutoff, rows, near };
  }

  /* The card's residue and its model, or null when the card is not at a residue whose model is loaded. */
  function cardResidue() {
    const editor = labelEditor;
    if (!editor || editor.kind === 'annotation' || !editor.atom) return null;
    const entry = entryById(editor.entryId);
    if (!entry || !entry.model) return null;
    const chain = editor.atom.chain || '';
    const atom = residueAlphaCarbon(entry, chain, editor.atom.resi) || editor.atom;
    return { entry, chain, resi: editor.atom.resi, name: labelEditorDefaultText(atom) };
  }

  function contactsPanelOpen() {
    const panel = labelEditorHost && labelEditorHost.querySelector('#gpv-residue-contacts');
    return Boolean(panel && !panel.hidden);
  }

  function toggleResidueContacts() {
    if (contactsPanelOpen()) { resetResidueContacts(false); return; }
    openResidueContacts();
  }

  function openResidueContacts() {
    const picked = cardResidue();
    if (!picked) { updateStatus('That residue’s model is no longer loaded'); return; }
    if (!cardContacts) cardContacts = { entryId: picked.entry.id, chain: picked.chain, resi: picked.resi, ...residueContactRows(picked.entry, picked.chain, picked.resi) };
    renderResidueContacts();
    setContactsExpanded(true);
    positionLabelEditor();
  }

  /* Closes the list; `forget` also drops this opening's rows (the card is closing or moving to
     another residue) — a list merely folded away keeps them for when it is opened again. The hover
     label goes with it either way. */
  function resetResidueContacts(forget = true) {
    if (forget) cardContacts = null;
    setContactHover(null);
    if (labelEditorHost && labelEditorHost.querySelector('#gpv-residue-contacts')) setContactsExpanded(false);
  }

  function setContactsExpanded(open) {
    const host = labelEditorHost; if (!host) return;
    host.querySelector('#gpv-residue-contacts').hidden = !open;
    host.classList.toggle('has-contacts', open);
    host.querySelectorAll('#gpv-label-editor-contacts, #gpv-residue-card-near').forEach(item => item.setAttribute('aria-expanded', String(open)));
    if (!open && labelEditor) positionLabelEditor();
  }

  function contactRowName(row) {
    return (row.resn || 'RES') + row.resi + (row.chain ? ' · ' + row.chain : '');
  }

  function renderResidueContacts() {
    const host = labelEditorHost; const found = cardContacts; if (!host || !found) return;
    const list = host.querySelector('#gpv-residue-contacts-rows');
    const empty = host.querySelector('.gpv-residue-contacts-empty');
    const rows = found.rows || [];
    list.replaceChildren();
    rows.forEach(row => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'gpv-residue-contact';
      button.dataset.chain = row.chain; button.dataset.resi = String(row.resi);
      button.dataset.closest = row.closest === null ? '' : row.closest.toFixed(3);
      button.dataset.atoms = row.atomA + '–' + row.atomB;
      const part = (className, text) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };
      button.append(
        part('gpv-contact-name', contactRowName(row)),
        part('gpv-contact-closest', row.closest === null ? '—' : row.closest.toFixed(2) + ' Å'),
        part('gpv-contact-atoms', row.atomA && row.atomB ? row.atomA + '–' + row.atomB : ''),
        part('gpv-contact-ca', row.ca === null ? '' : 'Cα ' + row.ca.toFixed(2) + ' Å')
      );
      button.title = 'Measure to ' + contactRowName(row) + ' (' + (measureAtoms === 'closest' ? 'closest atoms' : 'Cα–Cα') + ')';
      const point = () => setContactHover({ entryId: found.entryId, chain: row.chain, resi: row.resi });
      button.addEventListener('mouseenter', point);
      button.addEventListener('focus', point);
      button.addEventListener('mouseleave', () => setContactHover(null));
      button.addEventListener('blur', () => setContactHover(null));
      button.addEventListener('click', () => measureContactRow(row));
      item.append(button); list.append(item);
    });
    list.hidden = !rows.length;
    empty.hidden = Boolean(rows.length);
    empty.textContent = found.error ? found.error : 'No residues within ' + found.cutoff + ' Å';
    ['#gpv-residue-contacts-measure-all', '#gpv-residue-contacts-highlight', '#gpv-residue-contacts-copy'].forEach(selector => { host.querySelector(selector).disabled = !rows.length; });
  }

  function setContactHover(target) {
    const same = target && contactHover && target.entryId === contactHover.entryId && target.chain === contactHover.chain && target.resi === contactHover.resi;
    if (same || (!target && !contactHover)) return;
    contactHover = target;
    rebuildOverlays();
  }

  /* The card's rows belong to the residue the card was opened at; a card since moved or closed has
     none to act on. */
  function liveContacts() {
    const picked = cardResidue();
    const found = cardContacts;
    if (!picked || !found || found.entryId !== picked.entry.id || found.chain !== picked.chain || found.resi !== picked.resi) return null;
    return { picked, found };
  }

  function measureContactRow(row) {
    const live = liveContacts(); if (!live) return;
    const made = measureResiduePair(live.picked.entry, live.picked, live.picked.entry, row, measureAtoms);
    if (!made) { updateStatus('No atoms of ' + contactRowName(row) + ' are loaded to measure to'); return; }
    updateStatus(labelEditorDefaultText(made.first) + ' — ' + made.summary);
  }

  /* Every contact as a measurement, in one undo step: the step is taken once, then every record is
     added, so one ⌘Z takes the whole list back. */
  function measureAllContacts() {
    const live = liveContacts(); if (!live || !live.found.rows || !live.found.rows.length) return;
    const { picked, found } = live;
    const made = found.rows.map(row => residuePairMeasurement(picked.entry, picked, picked.entry, row, measureAtoms)).filter(Boolean);
    if (!made.length) { updateStatus('No atoms of the contacts are loaded to measure to'); return; }
    remember('contact measurements');
    made.forEach(item => measurementRecords.push(item.record));
    renderMeasurementList(); rebuildOverlays();
    updateStatus(plural(made.length, 'measurement') + ' from ' + picked.name + ' to its contacts within ' + found.cutoff + ' Å (' + (measureAtoms === 'closest' ? 'closest atoms' : 'Cα–Cα') + ') · one undo step');
  }

  /* What Highlight nearby residues makes for this residue (10): the same residues, the same records. */
  function highlightContactsFromCard() {
    const live = liveContacts(); if (!live || !live.found.near) return;
    highlightNearbyResult(live.found.near);
  }

  function contactsText(found) {
    const lines = [['residue', 'chain', 'resi', 'resn', 'closest_distance', 'closest_atoms', 'ca_distance'].join('\t')];
    found.rows.forEach(row => lines.push([contactRowName(row), row.chain, row.resi, row.resn, row.closest === null ? '' : row.closest.toFixed(3), row.atomA + '–' + row.atomB, row.ca === null ? '' : row.ca.toFixed(3)].join('\t')));
    return lines.join('\n');
  }

  async function copyContactsFromCard() {
    const live = liveContacts(); if (!live || !live.found.rows || !live.found.rows.length) return;
    const text = contactsText(live.found);
    const what = plural(live.found.rows.length, 'contact') + ' of ' + live.picked.name;
    try { await navigator.clipboard.writeText(text); announce(what + ' copied as tab-separated text'); }
    catch (error) { root.querySelector('#gpv-data-text').value = text; announce('Clipboard unavailable — the ' + what + ' are in the paste box of Per-residue data'); }
  }

  function setMeasureAtoms(value) {
    measureAtoms = measureAtomChoices.includes(value) ? value : 'ca';
    const stored = readJson(preferenceKey, null);
    writeJson(preferenceKey, { ...(stored && typeof stored === 'object' ? stored : {}), measureAtoms });
    const select = labelEditorHost && labelEditorHost.querySelector('#gpv-label-editor-measure-atoms');
    if (select && select.value !== measureAtoms) select.value = measureAtoms;
    refreshMeasureToButton();
    if (contactsPanelOpen()) renderResidueContacts();
    updateStatus('Measure to…, M and the contacts now measure ' + (measureAtoms === 'closest' ? 'the closest heavy atoms' : 'Cα–Cα'));
  }

  /* The debug hook's view of the same functions, for the validation scripts: the model is parsed if
     it has not been yet (archives load lazily), and only plain values come back. */
  function debugEntry(entryId) {
    const entry = entryById(Number(entryId));
    if (entry && !entry.model) { try { materializeEntry(entry); } catch (error) { return null; } }
    return entry && entry.model ? entry : null;
  }

  function debugResidueContacts(entryId, chain, resi, cutoff) {
    const entry = debugEntry(entryId); if (!entry) return null;
    const found = residueContactRows(entry, chain || '', Number(resi), cutoff);
    return found.error ? null : found.rows.map(row => ({ ...row }));
  }

  function debugResidueDistances(entryId, chain, resi) {
    const entry = debugEntry(entryId); if (!entry) return null;
    const result = residueDistanceRows(entry, chain || '', Number(resi));
    return result ? result.rows.map(row => ({ ...row })) : null;
  }

  /* Two named atoms, the first of each name in file order — which is the first alternate location
     where a crystal structure gives an atom several. */
  function debugAtomPairDistance(entryId, chainA, resiA, atomA, chainB, resiB, atomB) {
    const entry = debugEntry(entryId); if (!entry) return null;
    const find = (chain, resi, name) => entry.atoms.find(atom => (atom.chain || '') === (chain || '') && atom.resi === Number(resi) && (atom.atom || '') === name);
    const a = find(chainA, resiA, atomA); const b = find(chainB, resiB, atomB);
    return a && b ? Math.sqrt(squaredDistance(a, b)) : null;
  }

