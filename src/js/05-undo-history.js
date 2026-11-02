  /* ---------- Undo history ---------- */

  const historyLimit = 60;
  let undoStack = [];
  let redoStack = [];
  /* How many undo steps have ever been taken. The stack's length stops at historyLimit, so it cannot
     say whether an action added a step; this count can (read by the regression suite). */
  let rememberedSteps = 0;

  /* Besides the records: each model's fade (Fade, Emphasise and Use medoid are undo steps), the
     legend's renamed entries, and the per-residue data with the colour scheme it was painted in (MSA
     colouring is one). The data and the neighbourhood table are replaced whole, never edited, so they
     are kept by reference rather than copied on every step. */
  function snapshotRecords() {
    return {
      ...structuredClone({ labels: labelRecords, selections: selectionRecords, measurements: measurementRecords, annotations: annotationRecords, domains: domainRecords, positions: spotlightResidues, views: savedViews, faded: structures.map(entry => ({ id: entry.id, faded: entry.faded })), figureLabels }),
      residueData, colorMode: root.querySelector('#gpv-color-mode').value, positionEffect
    };
  }

  function renderHistoryButtons() {
    root.querySelector('#gpv-undo').disabled = !undoStack.length;
    root.querySelector('#gpv-redo').disabled = !redoStack.length;
  }

  /* Call before mutating labels, selections, measurements or annotations. */
  function remember(what) {
    undoStack.push({ what, state: snapshotRecords() });
    rememberedSteps += 1;
    if (undoStack.length > historyLimit) undoStack.shift();
    redoStack = [];
    renderHistoryButtons();
  }

  function clearHistory() {
    undoStack = []; redoStack = [];
    renderHistoryButtons();
  }

  function restoreRecords(state) {
    /* An open label editor may be editing text this state does not have; it closes uncommitted. The
       active label is held by its key, so it is found again in the restored records if it is there. */
    closeLabelEditor(false);
    /* The box selection's popover describes a selection this state may not have. */
    closeBoxPopover(false);
    const alive = record => Boolean(entryById(record.entryId));
    labelRecords = state.labels.filter(alive);
    selectionRecords = state.selections.filter(alive);
    measurementRecords = state.measurements.filter(record => record.points.every(alive));
    annotationRecords = state.annotations.filter(record => record.points.every(alive));
    domainRecords = (state.domains || []).filter(record => record.scope === 'all' || alive(record)); domainVersion += 1;
    spotlightResidues = state.positions || [];
    /* Saved views are records too: Make site figure adds two or three of them in one press, and undo
       has to take them back with the rest of the state that press changed. */
    if (Array.isArray(state.views)) savedViews = state.views;
    (state.faded || []).forEach(item => { const entry = entryById(item.id); if (entry) entry.faded = item.faded; });
    if (state.figureLabels) { setFigureLabels(state.figureLabels); applyFigureLabels(); }
    /* The colour scheme is not itself an undo step; it goes back only with the data it showed. */
    if ('residueData' in state && state.residueData !== residueData) {
      residueData = state.residueData; renderDataState();
      const mode = root.querySelector('#gpv-color-mode');
      if (mode.value !== state.colorMode) mode.value = state.colorMode;
    }
    /* The neighbourhood table belongs to the compared positions it was measured around. */
    positionEffect = spotlightResidues.length ? state.positionEffect || null : null; renderPositionEffect();
    renderLabelList(); renderSelectionList(); renderMeasurementList(); renderAnnotationList(); renderDomainList(); renderPositionState(); renderSavedViews(); renderList(); renderSequenceSoon();
    applyStyle();
    /* A scene restore's step also holds the display it replaced (31, sceneDisplayState). */
    if (state.display) applySceneDisplay(state.display);
  }
  /* The state the opposite stack takes: the records, and the display too when the step carries one,
     so redo of an undone scene restore puts the scene's settings back as well as its records. */
  function undoCounterSnapshot(item) {
    const state = snapshotRecords();
    if (item.state && item.state.display) state.display = sceneDisplayState();
    return state;
  }

  function undo() {
    const item = undoStack.pop();
    if (!item) { updateStatus('Nothing to undo'); return; }
    redoStack.push({ what: item.what, state: undoCounterSnapshot(item) });
    restoreRecords(item.state); renderHistoryButtons();
    updateStatus('Undid ' + item.what + (undoStack.length ? ' · ' + undoStack.length + ' more' : ''));
  }

  function redo() {
    const item = redoStack.pop();
    if (!item) { updateStatus('Nothing to redo'); return; }
    undoStack.push({ what: item.what, state: undoCounterSnapshot(item) });
    restoreRecords(item.state); renderHistoryButtons();
    updateStatus('Redid ' + item.what);
  }

