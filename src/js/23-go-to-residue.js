  /* ---------- Go to residue ---------- */

  function goToResidue(raw) {
    const text = String(raw || '').trim();
    const entry = activeEntry();
    if (!entry || !entry.model) { updateStatus('Load and show a model first'); return; }
    let chain = ''; let resi = null;
    let match = text.match(/^([A-Za-z0-9]{1,4})[:/\s]+(-?\d+)$/);
    if (match) { chain = match[1]; resi = Number(match[2]); }
    else if ((match = text.match(/^(-?\d+)\s*([A-Za-z]{1,4})$/))) { resi = Number(match[1]); chain = match[2]; }
    else if ((match = text.match(/^(-?\d+)$/))) resi = Number(match[1]);
    if (resi === null) { updateStatus('Type a residue number, optionally with its chain: B:45, 45B, or 45'); return; }
    const candidates = entry.atoms.filter(atom => atom.resi === resi && (!chain || String(atom.chain || '').toUpperCase() === chain.toUpperCase()));
    const atom = candidates.find(item => item.atom === 'CA') || candidates[0];
    if (!atom) { announce('No residue ' + text + ' in ' + displayName(entry), 'error'); return; }
    handleAtomClick(entry, atom);
    const selection = { model: entry.model.getID(), resi };
    if (atom.chain) selection.chain = atom.chain;
    viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer);
    sequenceHover = { entryId: entry.id, chain: atom.chain || '', resi }; renderSequenceSoon();
    updateStatus(residueText(entry, atom));
  }

