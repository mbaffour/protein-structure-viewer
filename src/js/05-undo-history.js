  /* ---------- Undo history ---------- */

  const historyLimit = 60;
  let undoStack = [];
  let redoStack = [];
  /* How many undo steps have ever been taken. The stack's length stops at historyLimit, so it cannot
     say whether an action added a step; this count can (read by the regression suite). */
  let rememberedSteps = 0;

  function snapshotRecords() {
    return structuredClone({ labels: labelRecords, selections: selectionRecords, measurements: measurementRecords, annotations: annotationRecords, domains: domainRecords, positions: spotlightResidues, views: savedViews });
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
    renderLabelList(); renderSelectionList(); renderMeasurementList(); renderAnnotationList(); renderDomainList(); renderPositionState(); renderSavedViews();
    applyStyle();
  }

  function undo() {
    const item = undoStack.pop();
    if (!item) { updateStatus('Nothing to undo'); return; }
    redoStack.push({ what: item.what, state: snapshotRecords() });
    restoreRecords(item.state); renderHistoryButtons();
    updateStatus('Undid ' + item.what + (undoStack.length ? ' · ' + undoStack.length + ' more' : ''));
  }

  function redo() {
    const item = redoStack.pop();
    if (!item) { updateStatus('Nothing to redo'); return; }
    undoStack.push({ what: item.what, state: snapshotRecords() });
    restoreRecords(item.state); renderHistoryButtons();
    updateStatus('Redid ' + item.what);
  }

