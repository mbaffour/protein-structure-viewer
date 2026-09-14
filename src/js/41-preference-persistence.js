  /* ---------- Preference persistence ---------- */

  const persistedControls = [
    '#gpv-style', '#gpv-color-mode', '#gpv-projection', '#gpv-outline', '#gpv-label-style', '#gpv-background', '#gpv-background-color', '#gpv-hetero',
    '#gpv-export-mode', '#gpv-print-width', '#gpv-print-aspect', '#gpv-print-dpi', '#gpv-print-text', '#gpv-figure-font', '#gpv-scale-bar', '#gpv-legend-position',
    '#gpv-view-mode', '#gpv-order', '#gpv-alignment-mode', '#gpv-fit-scope', '#gpv-export-size', '#gpv-export-scale',
    '#gpv-panel-columns', '#gpv-video-length', '#gpv-cycle-speed', '#gpv-speed', '#gpv-report-scope'
  ];

  function savePreferences() {
    writeJson(preferenceKey, Object.fromEntries(persistedControls.map(selector => [selector, root.querySelector(selector).value])));
  }

  function restorePreferences() {
    const stored = readJson(preferenceKey, null);
    if (!stored || typeof stored !== 'object') return;
    persistedControls.forEach(selector => {
      const control = root.querySelector(selector);
      const value = stored[selector];
      if (typeof value !== 'string') return;
      /* Only accept values the control actually offers, so a stale or hand-edited
         preference cannot put a control into an unhandled state. */
      if (control.tagName === 'SELECT') {
        if ([...control.options].some(option => option.value === value)) control.value = value;
      } else control.value = value;
    });
    root.querySelector('#gpv-cycle-value').textContent = Number(root.querySelector('#gpv-cycle-speed').value).toFixed(1) + ' s';
    root.querySelector('#gpv-speed-value').textContent = Number(root.querySelector('#gpv-speed').value).toFixed(2).replace(/0$/, '') + '×';
  }

  root.querySelector('#gpv-files').addEventListener('change', event => loadFiles([...event.target.files]));

  const dropZone = root.querySelector('#gpv-drop');
  let dragDepth = 0;
  const carriesFiles = event => [...(event.dataTransfer ? event.dataTransfer.types : [])].includes('Files');
  /* dragenter/dragleave fire for every child element, so count them rather than
     toggling on each event — otherwise the highlight flickers while dragging. */
  window.addEventListener('dragenter', event => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add('is-dragging');
  });
  window.addEventListener('dragover', event => { if (carriesFiles(event)) event.preventDefault(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.classList.remove('is-dragging');
  });
  window.addEventListener('drop', event => {
    /* Without this the browser opens the dropped file and the session is lost. */
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('is-dragging');
    const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
    if (files.length) loadFiles(files);
  });
  root.querySelector('#gpv-theme').addEventListener('click', () => {
    const current = root.querySelector('#gpv-theme').dataset.mode || 'system';
    const index = themeModes.findIndex(mode => mode.value === current);
    applyTheme(themeModes[(index + 1) % themeModes.length].value);
  });
  root.querySelector('#gpv-help-open').addEventListener('click', openHelp);
  root.querySelector('#gpv-fullscreen').addEventListener('click', () => setFullscreen(!fullscreen));
  root.querySelector('#gpv-fetch-form').addEventListener('submit', event => { event.preventDefault(); fetchStructure(); });
  persistedControls.forEach(selector => {
    root.querySelector(selector).addEventListener('change', savePreferences);
  });
  root.querySelector('#gpv-show-more').addEventListener('click', () => { listLimit += listPageSize; renderList(); });
  root.querySelector('#gpv-report-scope').addEventListener('change', updateReportEstimate);
  root.querySelector('#gpv-style').addEventListener('change', applyStyle);
  root.querySelector('#gpv-color-mode').addEventListener('change', applyStyle);
  root.querySelectorAll('[data-gpv-tab]').forEach((button, index, buttons) => {
    const panel = root.querySelector('[data-gpv-panel="' + button.dataset.gpvTab + '"]');
    button.id = 'gpv-tab-' + button.dataset.gpvTab; button.setAttribute('aria-controls', 'gpv-panel-' + button.dataset.gpvTab);
    panel.id = 'gpv-panel-' + button.dataset.gpvTab; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => selectToolTab(button.dataset.gpvTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      selectToolTab(buttons[nextIndex].dataset.gpvTab); buttons[nextIndex].focus();
    });
  });
  root.querySelector('#gpv-projection').addEventListener('change', applyAppearance);
  root.querySelector('#gpv-outline').addEventListener('change', applyAppearance);
  root.querySelector('#gpv-journal').addEventListener('change', event => {
    const [mm, dpi, points] = String(event.target.value || '').split('|').map(Number);
    if (!mm) return;
    const set = (selector, value) => { const control = root.querySelector(selector); if ([...control.options].some(option => option.value === String(value))) control.value = String(value); control.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#gpv-export-mode', 'print');
    const width = root.querySelector('#gpv-print-width');
    if ([...width.options].some(option => option.value === String(mm))) set('#gpv-print-width', mm);
    else { root.querySelector('#gpv-print-custom').value = String(mm); set('#gpv-print-width', 'custom'); root.querySelector('#gpv-print-custom').dispatchEvent(new Event('change', { bubbles: true })); }
    set('#gpv-print-dpi', dpi); set('#gpv-print-text', points); set('#gpv-figure-font', 'Arial, Helvetica, sans-serif');
    updateExportEstimate();
    announce(event.target.selectedOptions[0].textContent + ' · ' + mm + ' mm at ' + dpi + ' dpi, ' + points + ' pt Arial');
  });
  root.querySelector('#gpv-fog').addEventListener('change', applyAppearance);
  root.querySelector('#gpv-background').addEventListener('change', applyAppearance);
  root.querySelector('#gpv-background-color').addEventListener('input', applyAppearance);
  root.querySelector('#gpv-view-mode').addEventListener('change', () => {
    stopCycle();
    applyStyle();
    fitPrimary();
    viewer.render();
  });
  root.querySelector('#gpv-current').addEventListener('change', event => {
    stopCycle();
    selectModel(structures.find(entry => entry.id === Number(event.target.value)));
  });
  root.querySelector('#gpv-order').addEventListener('change', () => {
    stopCycle();
    applyModelOrder();
    renderList();
    applyStyle();
    updateStatus('Model order updated');
  });
  root.querySelector('#gpv-source-filter').addEventListener('change', () => {
    stopCycle(); listLimit = listPageSize; renderList();
    const count = filteredStructures().length;
    updateStatus(count + ' model' + (count === 1 ? '' : 's') + ' in this source');
  });
  root.querySelector('#gpv-model-search').addEventListener('input', () => {
    stopCycle(); listLimit = listPageSize; renderList();
    const count = filteredStructures().length;
    updateStatus(count + ' matching model' + (count === 1 ? '' : 's'));
  });
  root.querySelector('#gpv-previous').addEventListener('click', () => { stopCycle(); selectRelative(-1); });
  root.querySelector('#gpv-next').addEventListener('click', () => { stopCycle(); selectRelative(1); });
  root.querySelector('#gpv-cycle').addEventListener('click', toggleCycle);
  root.querySelector('#gpv-cycle-speed').addEventListener('input', event => {
    root.querySelector('#gpv-cycle-value').textContent = Number(event.target.value).toFixed(1) + ' s';
    if (cycleTimer) { stopCycle(); toggleCycle(); }
  });
  root.querySelector('#gpv-motion').addEventListener('change', applyMotion);
  root.querySelector('#gpv-speed').addEventListener('input', event => {
    root.querySelector('#gpv-speed-value').textContent = Number(event.target.value).toFixed(2).replace(/0$/, '') + '×';
    applyMotion();
  });
  root.querySelector('#gpv-clear').addEventListener('click', () => {
    if (structures.length > 1 && !confirm('Remove all ' + structures.length + ' models, plus any labels, selections, measurements, and saved views?')) return;
    stopCycle();
    stopMotion();
    viewer.removeAllModels();
    viewer.removeAllLabels();
    viewer.removeAllShapes();
    comparePanels.forEach(destroyPanelViewer);
    releaseExportViewer();
    structures = [];
    activeId = null;
    selectedResidue = null;
    clearHistory();
    labelRecords = [];
    domainRecords = []; domainVersion += 1;
    residueData = null; nearbyResult = null; renderDataState();
    selectionRecords = [];
    measurementRecords = [];
    measurementDraft = [];
    measurementActive = false;
    annotationRecords = [];
    annotationDraft = [];
    annotationActive = false;
    interfaceResults = null;
    renderInterfaceResults();
    root.querySelector('#gpv-interface-state').textContent = '';
    setButtonText(root.querySelector('#gpv-annotate'), 'Start drawing');
    root.querySelector('#gpv-stage').classList.remove('is-drawing');
    root.querySelector('#gpv-annotation-state').textContent = 'Pick a tool, start drawing, then click atoms in the main viewer.';
    savedViews = [];
    confidenceAssets = [];
    alignmentResults = [];
    pendingScene = null;
    root.querySelector('#gpv-residue').textContent = 'Click any atom in the viewer to inspect it.';
    root.querySelector('#gpv-label-text').value = '';
    root.querySelector('#gpv-add-label').disabled = true;
    root.querySelector('#gpv-all-labels').checked = false;
    root.querySelector('#gpv-side-by-side').checked = false;
    clearComparePanels();
    root.querySelector('#gpv-model-search').value = '';
    root.querySelector('#gpv-measure').textContent = 'Start measuring';
    root.querySelector('#gpv-measure-state').textContent = 'Measurement mode is off.';
    root.querySelector('#gpv-source-filter').value = 'all';
    root.querySelector('#gpv-import-errors').hidden = true;
    root.querySelector('#gpv-pae-detail').textContent = 'Move over the heatmap to inspect a residue pair.';
    root.querySelector('#gpv-fetch-id').value = '';
    listLimit = listPageSize;
    nextStructureId = 1;
    nextAnnotationId = 1;
    renderAlignmentResults();
    renderSelectionList();
    renderMeasurementList();
    renderAnnotationList();
    renderLabelList();
    renderSavedViews();
    renderList();
    applyStyle();
    renderComparePanels();
    announce('Cleared everything');
  });
  root.querySelector('#gpv-show-all').addEventListener('click', () => {
    filteredStructures().forEach(entry => { entry.visible = true; });
    renderList();
    applyStyle();
  });
  root.querySelector('#gpv-hide-all').addEventListener('click', () => {
    filteredStructures().forEach(entry => { entry.visible = false; });
    renderList();
    applyStyle();
  });
  root.querySelector('#gpv-fit').addEventListener('click', () => { fitAllViews(); updateStatus('Fitted every panel'); });
  root.querySelector('#gpv-align').addEventListener('click', alignVisible);
  root.querySelector('#gpv-fit-scope').addEventListener('change', renderFitControls);
  root.querySelector('#gpv-fit-region').addEventListener('input', renderFitControls);
  root.querySelector('#gpv-alignment-csv').addEventListener('click', downloadAlignmentCsv);
  root.querySelector('#gpv-restore').addEventListener('click', () => restoreCoordinates(true));
  root.querySelector('#gpv-add-label').addEventListener('click', addOrEditLabel);
  root.querySelector('#gpv-label-text').addEventListener('keydown', event => { if (event.key === 'Enter') addOrEditLabel(); });
  root.querySelector('#gpv-all-labels').addEventListener('change', () => rebuildOverlays());
  root.querySelector('#gpv-clear-labels').addEventListener('click', () => {
    if (labelRecords.length) remember('clearing labels');
    labelRecords = [];
    renderLabelList();
    root.querySelector('#gpv-all-labels').checked = false;
    root.querySelector('#gpv-label-text').value = '';
    rebuildOverlays();
    updateStatus('Residue labels cleared');
  });
  root.querySelector('#gpv-add-selection').addEventListener('click', addSelection);
  root.querySelector('#gpv-selection-range').addEventListener('keydown', event => { if (event.key === 'Enter') addSelection(); });
  root.querySelector('#gpv-clear-selections').addEventListener('click', () => { if (selectionRecords.length) remember('clearing selections'); selectionRecords = []; renderSelectionList(); applyStyle(); updateStatus('Selections cleared'); });
  root.querySelector('#gpv-measure').addEventListener('click', toggleMeasurement);
  root.querySelector('#gpv-annotate').addEventListener('click', () => toggleAnnotating());
  root.querySelector('#gpv-annotation-type').addEventListener('change', () => { annotationDraft = []; if (annotationActive) root.querySelector('#gpv-annotation-state').textContent = annotationPrompt(); });
  root.querySelector('#gpv-annotation-size').addEventListener('input', () => { root.querySelector('#gpv-annotation-size-value').textContent = String(Number(root.querySelector('#gpv-annotation-size').value)) + '×'; });
  root.querySelector('#gpv-add-screen-text').addEventListener('click', addScreenText);
  root.querySelector('#gpv-screen-text').addEventListener('keydown', event => { if (event.key === 'Enter') addScreenText(); });
  root.querySelector('#gpv-clear-annotations').addEventListener('click', () => { if (annotationRecords.length) remember('clearing annotations'); annotationRecords = []; annotationDraft = []; renderAnnotationList(); rebuildOverlays(); updateStatus('Annotations cleared'); });
  root.querySelector('#gpv-measure-type').addEventListener('change', () => { measurementDraft = []; if (measurementActive) root.querySelector('#gpv-measure-state').textContent = 'Select ' + (root.querySelector('#gpv-measure-type').value === 'angle' ? 3 : 2) + ' atoms in the viewer.'; });
  root.querySelector('#gpv-clear-measurements').addEventListener('click', () => { if (measurementRecords.length) remember('clearing measurements'); measurementRecords = []; measurementDraft = []; renderMeasurementList(); rebuildOverlays(); updateStatus('Measurements cleared'); });
  root.querySelector('#gpv-side-by-side').addEventListener('change', event => {
    stopCycle();
    const left = structures.find(entry => entry.id === Number(root.querySelector('#gpv-left-model').value));
    if (left) activeId = left.id;
    if (event.target.checked && !comparePanels.length && structures.length) addComparePanel();
    else applyStyle();
    setTimeout(() => panelViewers().forEach(target => target.resize()), 0);
    updateStatus(event.target.checked ? 'Synchronized multi-view on · drag any panel' : 'Single view');
  });
  root.querySelector('#gpv-left-model').addEventListener('change', event => { activeId = Number(event.target.value); root.querySelector('#gpv-current').value = event.target.value; applyStyle(); fitPrimary(); viewer.render(); syncViewsFrom(viewer); });
  root.querySelector('#gpv-sync-mode').addEventListener('change', () => { fitAllViews(); updateStatus(root.querySelector('#gpv-sync-mode').value === 'full' ? 'Cameras locked together' : 'Rotation shared · each panel keeps its own framing'); });
  root.querySelector('#gpv-add-panel').addEventListener('click', () => { const panel = addComparePanel(); if (panel) updateStatus('Added panel ' + (comparePanels.length + 1) + ' · ' + ((entryById(panel.entryId) || {}).name || '')); });
  root.querySelector('#gpv-clear-panels').addEventListener('click', () => { clearComparePanels(); applyStyle(); setTimeout(() => viewer.resize(), 0); updateStatus('Comparison panels removed'); });
  root.querySelector('#gpv-compare-image').addEventListener('click', downloadComparisonPng);
  root.querySelector('#gpv-svg').addEventListener('click', downloadPublicationSvg);
  root.querySelector('#gpv-compare-svg').addEventListener('click', downloadComparisonSvg);
  root.querySelector('#gpv-image').addEventListener('click', downloadPublicationPng);
  root.querySelector('#gpv-save-view').addEventListener('click', saveCurrentView);
  root.querySelector('#gpv-contact-sheet').addEventListener('click', downloadContactSheet);
  root.querySelector('#gpv-captions').addEventListener('click', downloadCaptions);
  root.querySelector('#gpv-video').addEventListener('click', recordSpinVideo);
  root.querySelector('#gpv-report').addEventListener('click', downloadReport);
  root.querySelector('#gpv-report-pae').addEventListener('change', updateReportEstimate);
  root.querySelector('#gpv-report-offline').addEventListener('change', updateReportEstimate);
  root.querySelector('#gpv-confidence-csv').addEventListener('click', downloadConfidenceCsv);
  root.querySelector('#gpv-profile-svg').addEventListener('click', downloadProfileSvg);
  root.querySelector('#gpv-profile-png').addEventListener('click', () => { downloadProfilePng().catch(error => announce('Could not render the profile: ' + error.message, 'error')); });
  root.querySelector('#gpv-hide-below').addEventListener('change', () => { applyStyle(); updateStatus(hideBelow() ? 'Residues with pLDDT below ' + hideBelow() + ' hidden in the viewer, panels and exports' : 'Every residue shown'); });
  root.querySelector('#gpv-color-mode').addEventListener('change', () => { if (root.querySelector('#gpv-color-mode').value === 'deviation' && !alignmentResults.length) announce('Deviation colouring stays grey until you align: Compare → Align visible'); });
  root.querySelector('#gpv-interface-run').addEventListener('click', analyseInterfaces);
  root.querySelector('#gpv-interface-csv').addEventListener('click', downloadInterfaceCsv);
  root.querySelector('#gpv-interface-cutoff').addEventListener('input', () => { root.querySelector('#gpv-interface-cutoff-value').textContent = Number(root.querySelector('#gpv-interface-cutoff').value).toFixed(1) + ' Å'; });
  root.querySelector('#gpv-pae-png').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = root.querySelector('#gpv-pae').toDataURL('image/png');
    link.download = 'predicted-aligned-error.png';
    link.click();
    updateStatus('PAE heatmap PNG downloaded');
  });
  root.querySelector('#gpv-save-scene').addEventListener('click', saveScene);
  root.querySelector('#gpv-save-session').addEventListener('click', downloadSessionFile);
  root.querySelector('#gpv-model-panels').addEventListener('click', downloadModelPanels);
  root.querySelector('#gpv-contact-run').addEventListener('click', () => { computeContacts(); renderCompositeControls(); });
  root.querySelector('#gpv-composite').addEventListener('click', downloadCompositeFigure);
  root.querySelector('#gpv-msa-paint').addEventListener('click', paintByMsa);
  root.querySelector('#gpv-data-csv').addEventListener('click', downloadResidueDataCsv);
  root.querySelector('#gpv-contact-highlight').addEventListener('click', highlightContactInterface);
  root.querySelector('#gpv-contact-csv').addEventListener('click', downloadContactsCsv);
  root.querySelector('#gpv-contact-png').addEventListener('click', () => { downloadContactPng().catch(error => announce('Could not render the contact map: ' + error.message, 'error')); });
  root.querySelector('#gpv-contact-canvas').addEventListener('pointermove', event => { const hit = contactAt(event); root.querySelector('#gpv-contact-readout').textContent = hit ? contactPairText(hit) : 'Hover a cell to read the residue pair'; });
  root.querySelector('#gpv-contact-canvas').addEventListener('click', event => {
    const hit = contactAt(event); if (!hit || hit.distance === undefined) return;
    const entry = entryById(contactResult.entryId); if (!entry || !entry.model) return;
    handleAtomClick(entry, hit.a);
    const selection = { model: entry.model.getID(), or: [{ chain: hit.a.chain, resi: hit.a.resi }, { chain: hit.b.chain, resi: hit.b.resi }] };
    try { viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer); } catch (error) { /* selection syntax unsupported: keep the current view */ }
    updateStatus(contactPairText(hit) + ' · selected');
  });
  root.querySelector('#gpv-label-style').addEventListener('change', applyStyle);
  root.querySelector('[data-gpv-tab="publish"]').addEventListener('click', () => { setTimeout(renderPublicationChecks, 0); setTimeout(renderCompositeControls, 0); });
  renderCompositeControls();
  renderPublicationChecks();
  root.querySelector('#gpv-open-session').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { await openSessionFile(file); } catch (error) { announce('Could not open that session file: ' + error.message, 'error'); }
    event.target.value = '';
  });
  root.querySelector('#gpv-load-scene').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const scene = JSON.parse(await file.text());
      if (scene.type !== 'protein-viewer-scene') throw new Error('Not a scene file');
      if (structures.length) await applyScene(scene);
      else { pendingScene = scene; updateStatus('Scene loaded; now add its matching structure files'); }
    } catch (error) {
      updateStatus('Could not read that scene JSON');
    }
    event.target.value = '';
  });
  root.querySelector('#gpv-pae').addEventListener('pointermove', event => {
    const entry = structures.find(item => item.id === Number(event.currentTarget.dataset.entryId));
    const matrix = entry && entry.confidence && entry.confidence.pae;
    if (!matrix || !matrix.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const row = Math.min(matrix.length - 1, Math.max(0, Math.floor((event.clientY - bounds.top) * matrix.length / bounds.height)));
    /* PAE matrices are square in practice, but do not assume it. */
    const columns = isMatrixRow(matrix[row]) ? matrix[row].length : matrix.length;
    const column = Math.min(columns - 1, Math.max(0, Math.floor((event.clientX - bounds.left) * columns / bounds.width)));
    const value = finiteNumber(matrix[row] && matrix[row][column]);
    const chains = entry.confidence.tokenChainIds || [];
    const residues = entry.confidence.tokenResidueIds || [];
    const describe = index => 'token ' + (index + 1) + (chains[index] !== undefined ? ', chain ' + chains[index] : '') + (residues[index] !== undefined ? ', residue ' + residues[index] : '');
    root.querySelector('#gpv-pae-detail').textContent = describe(row) + ' → ' + describe(column) + ' · PAE ' + (value === null ? '—' : value.toFixed(2) + ' Å');
    const mark = index => chains[index] !== undefined && residues[index] !== undefined ? { entryId: entry.id, chain: String(chains[index]), resi: Number(residues[index]) } : null;
    sequenceMarks = [mark(row), mark(column)].filter(Boolean);
    renderSequenceSoon();
  });
  root.querySelector('#gpv-pae').addEventListener('pointerleave', () => { if (sequenceMarks.length) { sequenceMarks = []; renderSequenceSoon(); } });
  const tabOrder = ['models', 'appearance', 'annotate', 'compare', 'confidence', 'publish'];
  window.addEventListener('keydown', event => {
    const target = event.target;
    /* event.target is not always an Element (it can be the document), and a
       shortcut must never swallow a character someone is typing — including the
       "?" that opens help. */
    if (target instanceof Element && (target.matches('input, select, textarea, [contenteditable]') || target.closest('dialog[open]'))) {
      if (event.key !== 'Escape') return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '?') { event.preventDefault(); openHelp(); return; }
    if (event.key === 'Escape') {
      if (fullscreen) { setFullscreen(false); return; }
      if (annotationActive) { toggleAnnotating(false); return; }
      if (measurementActive) { toggleMeasurement(); return; }
      return;
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); stopCycle(); selectRelative(-1); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); stopCycle(); selectRelative(1); return; }
    const key = event.key.toLowerCase();
    if (key === 'f') { event.preventDefault(); if (event.shiftKey) setFullscreen(!fullscreen); else fitAllViews(); return; }
    if (key === 'c' && !event.shiftKey) { event.preventDefault(); toggleCycle(); return; }
    if (key === 's' && !event.shiftKey) { event.preventDefault(); toggleSpin(); return; }
    if (['x', 'y', 'z'].includes(key)) { event.preventDefault(); rotateView(key, event.shiftKey ? -90 : 90); return; }
    if (key === 'r' && event.shiftKey) { event.preventDefault(); resetOrientation(); return; }
    const tabIndex = Number(event.key) - 1;
    if (Number.isInteger(tabIndex) && tabIndex >= 0 && tabIndex < tabOrder.length) {
      event.preventDefault();
      selectToolTab(tabOrder[tabIndex]);
      root.querySelector('[data-gpv-tab="' + tabOrder[tabIndex] + '"]').focus();
    }
  });
  new ResizeObserver(() => viewer.resize()).observe(root.querySelector('#gpv-stage'));

