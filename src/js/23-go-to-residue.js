  /* ---------- Go to residue ---------- */

  /* B:45, B/45, B 45, B45, 45B or 45, with an insertion code after the number: H:100A. B45 is chain B
     when the model has a chain of that name — the way the card and the labels write a residue. A letter right
     after the number is the insertion code when the model has that residue and no chain of that
     name, so 45B still means chain B wherever there is no residue 45B. A chain is matched as typed,
     and regardless of case only when no chain has exactly that name — an assembly can have both a
     and A. A bare number is the residue without an insertion code where there is one. */
  function goToResidue(raw) {
    const text = String(raw || '').trim();
    const entry = activeEntry();
    if (!entry || !entry.model) { updateStatus('Load and show a model first'); return; }
    let chain = ''; let resi = null; let icode = null;
    const chains = new Set(entry.atoms.map(atom => atom.chain || ''));
    const hasCode = code => entry.atoms.some(atom => atom.resi === resi && insertionCodeOf(atom) === code);
    let match = text.match(/^([A-Za-z0-9]{1,4})[:/\s]+(-?\d+)([A-Za-z]?)$/);
    if (match) { chain = match[1]; resi = Number(match[2]); icode = match[3] || null; }
    else if ((match = text.match(/^(-?\d+)(\s*)([A-Za-z]{1,4})$/))) {
      resi = Number(match[1]); const letter = match[3];
      const code = letter.length === 1 && !match[2] ? [letter, letter.toUpperCase()].find(hasCode) : undefined;
      if (code && !chains.has(letter)) icode = code; else chain = letter;
    }
    else if ((match = text.match(/^(-?\d+)$/))) resi = Number(match[1]);
    else if ((match = text.match(/^([A-Za-z]{1,4})(-?\d+)([A-Za-z]?)$/)) && [...chains].some(name => name.toUpperCase() === match[1].toUpperCase())) { chain = match[1]; resi = Number(match[2]); icode = match[3] || null; }
    if (resi === null) { updateStatus('Type a residue number, optionally with its chain and insertion code: B:45, B45, 45B, 45, or H:100A'); return; }
    if (chain && !chains.has(chain)) chain = [...chains].find(name => name.toUpperCase() === chain.toUpperCase()) ?? chain;
    let candidates = entry.atoms.filter(atom => atom.resi === resi && (!chain || (atom.chain || '') === chain));
    if (icode !== null) candidates = candidates.filter(atom => insertionCodeOf(atom) === icode || insertionCodeOf(atom) === icode.toUpperCase());
    else if (candidates.some(atom => !insertionCodeOf(atom))) candidates = candidates.filter(atom => !insertionCodeOf(atom));
    const atom = candidates.find(item => item.atom === 'CA' && !item.hetflag) || candidates.find(item => item.atom === 'CA') || candidates[0];
    if (!atom) { announce('No residue ' + text + ' in ' + displayName(entry), 'error'); return; }
    /* Go to can be the second residue of Measure to…, whose result the status line then keeps. */
    const measuring = Boolean(measureFrom);
    /* An open card names the residue it was opened at; Go to moves the selection elsewhere, so the
       card closes, as it does for a click on the stage — its Enter would otherwise label the old one. */
    closeLabelEditor(false);
    handleAtomClick(entry, atom);
    const selection = { model: entry.model.getID(), resi };
    if (atom.chain) selection.chain = atom.chain;
    /* Frame the residue itself: 57A, not 57, 57A and 57B together. */
    const code = insertionCodeOf(atom);
    selection.predicate = item => insertionCodeOf(item) === code;
    viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer);
    sequenceHover = { entryId: entry.id, chain: atom.chain || '', resi, icode: insertionCodeOf(atom) }; renderSequenceSoon();
    if (!measuring) updateStatus(residueText(entry, atom));
  }

