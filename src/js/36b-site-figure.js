  /* ---------- Site figure ----------
     The figure a mutation study ends up drawing is always the same two panels: an overview of the
     superposed models so the reader knows where the site is, and a close-up of the site itself with
     the side chains, each model's own residue named on it, and the wild type solid against the
     mutants faded. Make site figure builds both from the position that was just compared — camera,
     colouring, emphasis and captions — ticks them as the only two panels of the figure builder and
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

  function makeSiteFigure() {
    const shown = displayedEntries().filter(entry => entry.model);
    if (!spotlightResidues.length) { announce('Compare a position first — the site figure is built around it', 'error'); return; }
    if (shown.length < 2) { announce('Show at least two models to make a site figure', 'error'); return; }
    const reference = siteFigureReference();
    if (!reference) { announce('Show at least two models to make a site figure', 'error'); return; }
    /* Several compared positions make several figures; this press builds the first one. */
    const spot = spotlightResidues[0];
    const tag = positionTag(spot);
    const restore = captureViewState();
    remember('site figure');
    /* Per-model colouring is what makes the two panels readable: one colour per model, named in the
       legend. Side chains are the point of the close-up. */
    siteFigureSet('#gpv-color-mode', 'structure');
    siteFigureSet('#gpv-position-sticks', true);

    /* Panel A — the overview: every shown model solid, the whole superposition in frame. */
    shown.forEach(entry => { entry.faded = false; });
    applyStyle(); fitPrimary(); viewer.render();
    const overview = captureViewState('Overview', 'Superposed models, site ' + tag + ' marked');
    overview.inFigure = true;

    /* Panel B — the close-up: the reference solid, the others faded behind it, the camera on the
       site itself. zoomTo() frames the residue alone; backing off a little brings its neighbours
       and the rest of the fold into the panel, which is what makes the close-up legible. */
    shown.forEach(entry => { entry.faded = entry !== reference; });
    applyStyle();
    const selection = { model: reference.model.getID(), resi: spot.resi };
    if (spot.chain) selection.chain = spot.chain;
    viewer.zoomTo(selection);
    if (typeof viewer.zoom === 'function') viewer.zoom(0.6);
    viewer.render();
    const closeUp = captureViewState('Site ' + tag, String(positionReadout(spot) || tag).slice(0, 200));
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
