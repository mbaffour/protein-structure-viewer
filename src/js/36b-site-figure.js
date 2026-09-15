  /* ---------- Site figure ----------
     The figure a mutation study ends up drawing is always the same two panels: an overview of the
     superposed models so the reader knows where the site is, and a close-up of the site itself with
     the side chains, each model's own residue named on it, and the wild type solid against the
     mutants faded. Make site figure builds both from the positions that have been compared — one of
     them, or the whole set of a binding site — camera, colouring, emphasis and captions, ticks them
     as the only two panels of the figure builder and
     opens Publish at it, so the press between "what did this mutation do?" and a figure file is
     Download figure PNG. Everything it does is one undo step. */

  /* The wild type: the reference of the superposition when it is on screen, and otherwise the first
     shown model, which is the only honest default when nothing has been aligned. */
  function siteFigureReference() {
    const shown = displayedEntries().filter(entry => entry.model);
    const chosen = entryById(Number(root.querySelector('#gpv-reference').value));
    return chosen && chosen.model && shown.includes(chosen) ? chosen : shown[0] || null;
  }

  /* Set a control and let everything that listens to it react, the way a user changing it would. */
  function siteFigureSet(selector, value) {
    const control = root.querySelector(selector);
    if (!control) return;
    if (control.type === 'checkbox') { if (control.checked === value) return; control.checked = value; }
    else { if (control.value === value) return; control.value = value; }
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* The residues the close-up frames: the compared sites — one of them, or the whole set — and every
     residue of the reference model with a heavy atom within the effect cutoff of any of them.
     Framing the lone residue is what fills a large assembly's panel with whatever ribbon happens to
     lie in front of the site; its neighbourhood is the context that makes the close-up readable, and
     it is the same neighbourhood the effect table measures. Those rows are reused when a
     superposition has been measured at these positions; without one the neighbourhood is found the
     same way, straight from the reference's own heavy atoms. */
  function siteFigureNeighbourhood(reference, spot) {
    const sites = (Array.isArray(spot) ? spot : [spot]).map(item => ({ chain: item.chain || '', resi: item.resi }));
    const keys = new Set(sites.map(site => site.chain + '|' + site.resi));
    const measured = positionEffect ? positionEffect.spots || [positionEffect.spot] : [];
    /* The measured rows are reused only when the table is about exactly these sites; a table left
       over from another position would frame the wrong part of the model. */
    if (positionEffect && positionEffect.rows.length && measured.length === sites.length
      && measured.every(item => keys.has((item.chain || '') + '|' + item.resi))) {
      return positionEffect.rows.map(row => ({ chain: row.chain || '', resi: row.resi }));
    }
    const cutoff = positionCutoff();
    const heavy = heavyAtoms(reference).filter(atom => !atom.hetflag);
    const isSiteAtom = atom => keys.has((atom.chain || '') + '|' + atom.resi);
    const targets = heavy.filter(isSiteAtom);
    if (!targets.length) return sites;
    const candidates = heavy.filter(atom => !isSiteAtom(atom));
    const grid = spatialGrid(candidates, cutoff);
    const limit = cutoff * cutoff;
    const found = new Map();
    targets.forEach(target => grid.near(target).forEach(index => {
      const atom = candidates[index];
      if (squaredDistance(atom, target) > limit) return;
      const key = (atom.chain || '') + '|' + atom.resi;
      if (!found.has(key)) found.set(key, { chain: atom.chain || '', resi: atom.resi });
    }));
    return [...sites, ...found.values()];
  }

  /* The neighbourhood as one 3Dmol selection on the reference model: one sub-selection per chain,
     or-ed together when the site's surroundings cross a chain boundary, which on an assembly they
     usually do. */
  function siteFigureSelection(reference, spot) {
    const byChain = new Map();
    siteFigureNeighbourhood(reference, spot).forEach(item => {
      if (!byChain.has(item.chain)) byChain.set(item.chain, []);
      byChain.get(item.chain).push(item.resi);
    });
    const parts = [...byChain.entries()].map(([chain, residues]) => (chain ? { chain, resi: residues } : { resi: residues }));
    const selection = { model: reference.model.getID() };
    if (parts.length === 1) Object.assign(selection, parts[0]); else selection.or = parts;
    return selection;
  }

  function makeSiteFigure() {
    const shown = displayedEntries().filter(entry => entry.model);
    if (!spotlightResidues.length) { announce('Compare a position first — the site figure is built around it', 'error'); return; }
    if (shown.length < 2) { announce('Show at least two models to make a site figure', 'error'); return; }
    const reference = siteFigureReference();
    if (!reference) { announce('Show at least two models to make a site figure', 'error'); return; }
    /* Every compared position is part of the same figure: a binding site is several residues, and a
       panel of one of them with the rest out of frame answers nothing. */
    const spots = spotlightResidues.map(item => ({ chain: item.chain || '', resi: item.resi }));
    const single = spots.length === 1;
    const tag = positionTag(spots[0]);
    const restore = captureViewState();
    remember('site figure');
    /* Per-model colouring is what makes the two panels readable: one colour per model, named in the
       legend. Side chains are the point of the close-up. */
    siteFigureSet('#gpv-color-mode', 'structure');
    siteFigureSet('#gpv-position-sticks', true);

    /* Panel A — the overview: every shown model solid, the whole superposition in frame. */
    shown.forEach(entry => { entry.faded = false; });
    applyStyle(); fitPrimary(); viewer.render();
    const overview = captureViewState('Overview', single ? 'Superposed models, site ' + tag + ' marked' : 'Superposed models, ' + spots.length + ' sites marked');
    overview.inFigure = true;

    /* Panel B — the close-up: the reference solid, the others faded behind it, the camera on the
       site and its neighbourhood. Framing the lone residue is far too tight on a real assembly — the
       panel comes back a wall of ribbon with the site lost inside it — so the camera is fitted to
       every residue within the effect cutoff and then backed off a little, which brings the rest of
       the fold in behind a site that still fills the frame. */
    shown.forEach(entry => { entry.faded = entry !== reference; });
    applyStyle();
    viewer.zoomTo(siteFigureSelection(reference, spots));
    if (typeof viewer.zoom === 'function') viewer.zoom(0.8);
    viewer.render();
    const closeUp = captureViewState(single ? 'Site ' + tag : 'Sites', String((single ? positionReadout(spots[0]) : positionSetReadout()) || tag).slice(0, 200));
    closeUp.inFigure = true;

    /* Exactly these two panels, side by side, lettered and captioned. */
    savedViews.forEach(view => { view.inFigure = false; });
    savedViews.push(overview, closeUp);
    siteFigureSet('#gpv-panel-columns', '2');
    siteFigureSet('#gpv-builder-captions', 'both');
    siteFigureSet('#gpv-builder-letters', true);
    siteFigureSet('#gpv-builder-legends', true);
    renderSavedViews();

    /* The panels keep their own emphasis; the screen goes back to what it was, solid, so nobody is
       left looking at a faded model wondering what happened. */
    applyViewState(restore);
    displayedEntries().filter(entry => entry.model).forEach(entry => { entry.faded = false; });
    applyStyle();

    root.querySelector('[data-gpv-tab="publish"]').click();
    const heading = root.querySelector('#gpv-builder-heading');
    if (heading) heading.scrollIntoView({ block: 'start' });
    announce('Site figure ready · two panels in the figure builder · download it as PNG or SVG');
  }

  root.querySelector('#gpv-position-figure').addEventListener('click', makeSiteFigure);
