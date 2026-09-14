  /* ---------- Tips ---------- */

  const tipsKey = 'protein-structure-viewer:tips-hidden';
  const tips = [
    'Drop several AlphaFold result ZIPs at once. Each becomes its own source you can filter by in the Models tab.',
    'Compare → Synchronized multi-view shows up to six models side by side. Drag, spin, or rock any panel and the rest follow.',
    'Pick Rotation only when the models differ in size, and Rotation and zoom after Align visible to inspect a superposition.',
    'Colour by pLDDT confidence and switch to orthographic projection for figures; perspective exaggerates whatever is closest.',
    'Save named views with captions in Publish. They become lettered figure panels, a caption file, and a guided tour in the report.',
    'Share report packs coordinates, aligned positions, confidence, and PAE into one HTML file a reviewer opens with no install.',
    'Keyboard: F refits every panel, S spins, C cycles models, ← → step through them, 1–6 jump between tabs, ? opens help.',
    'Click any atom to read its residue and pLDDT, then add a label. Labels travel into the report and into PNG exports.',
    'Download comparison PNG stitches the current panels into one lettered figure at the export size you chose.',
    'Annotate → Figure annotations: start drawing, then click two atoms for an arrow or line, or one atom for a marker or callout.',
    'Scene JSON records everything except coordinates. Archive it next to the structure files to rebuild a figure later.',
    'Full screen (Shift+F) keeps every synchronized panel on screen, which works well for a live walkthrough with reviewers.',
    'Rename models in the Models list — captions, badges, and the report pick up the display name while file names stay as identifiers.',
    'Download figure SVG keeps labels, arrows, callouts, and the legend as vector layers you can restyle in Illustrator or Inkscape.',
    'Confidence → Interfaces counts inter-chain contacts and buried surface area, and highlights the interface residues in one click.',
    'Embed 3Dmol.js before sharing a report that must open on a plane; switch PAE to Compact to keep the file small.',
    'The sequence strip under the viewer shows every chain coloured by pLDDT. Click a residue to select it for a label, drag across a range to fill the Selections fields, double-click to zoom to it.',
    'Ctrl/⌘+Z undoes the last label, selection, measurement or annotation change; add Shift to redo. The Undo and Redo buttons sit in the Annotate tab.',
    'Publish → Copy share link turns models fetched by ID, plus your camera, colours, labels and annotations, into a URL a reviewer opens directly. Local files are never included.',
    'Colour by chain uses a fixed palette — chain A is the same blue in every model and panel — and the export legend names each chain.',
    'Appearance → Low confidence hides residues below pLDDT 50 or 70 everywhere at once: viewer, synchronized panels, PNG and SVG exports.',
    'After Align visible, colour by Cα deviation to see where the models disagree. Blue is under 1 Å, red is 8 Å or more, grey was not matched.',
    'Confidence → pLDDT profile SVG plots per-residue confidence for every displayed model, one panel per chain, ready for a supplementary figure.',
    'In overlay mode the sequence strip shows one row per model and chain, so pLDDT of competing predictions lines up residue by residue. Hovering the PAE heatmap marks both residues on the strip.',
    'X, Y and Z rotate the view by exactly 90° (Shift reverses), so a front, side and top panel of the same model line up in a figure. Shift+R returns to the file frame.',
    'Appearance → Presets sets up a thesis figure, a dark slide, or a confidence review in one click; every control stays editable afterwards.',
    'Publish → Write figure legend drafts the legend from what is on screen — models, colouring, cut-offs, alignment RMSD, labels and measurements — ready to paste and edit.',
    'AlphaFold 3 ligands, ions and glycans are drawn as sticks by default; switch them to spheres or hide them under Appearance → Ligands and ions. Water is never shown.',
    'Models → Download FASTA writes one record per chain of the displayed models, with length and mean pLDDT in the header.',
    'Colour by residue charge, hydrophobicity, residue type, amino acid or secondary structure — and add a translucent surface for an electrostatics-style view of a binding face.',
    'Open “Sequence letters” under the strip to read the one-letter sequence in blocks of ten, coloured by the current scheme. Click a letter to select that residue; Copy takes the chain to the clipboard.',
    'Models → Composition lists every chain of the current model with a show/hide switch and counts its ligands and ions — the quickest way to isolate one subunit of an assembly.',
    'Annotate → Go to: type B:45 (or just 45) to select that residue and zoom to it. Reviewers ask about residues by number; now you can answer by number.',
    'Publish → Copy PNG to clipboard renders the publication figure and puts it straight into your paste buffer for a slide or a document.',
    'Confidence → PAE domains groups residues that the prediction places together (low PAE to one another). Colour by domains or highlight them to see which parts of an assembly are predicted as a rigid unit.',
    'Every panel of the shared report now carries a sequence strip: reviewers hover to read a residue and its pLDDT, and click to zoom the panel to it.',
    'Annotate → Domains: name a region, pick its colour, and apply it to every model from the same AlphaFold run. Colour by annotated domains paints them and the legend lists them by name — in the viewer, every export and the report.',
    'Publish → Print size exports at a stated width (85 or 178 mm) and resolution (300 or 600 dpi), writes the dpi into the PNG or TIFF, and sizes labels in points — what a journal checks.',
    'Appearance → Colour-blind-safe palette switches chains and domains to Okabe–Ito colours; a scale bar of 10–100 Å goes bottom-right of every export from Publish → Scale bar.',
    'Help (?) → How to cite gives the viewer and 3Dmol.js references; each GitHub release is archived on Zenodo with a DOI.',
    'Annotate → Per-residue data: drop a CSV of residue and value columns — conservation, mutational scores, ΔΔG — and colour the structure by it with a gradient legend that states the range.',
    'Annotate → Selections → Near: highlight every residue within 4.5 Å of the ligands, of a chain, or of the residue you clicked, and copy the list for your methods.',
    'Your session autosaves in the browser: reopen the page and choose Restore. Publish → Download all views (ZIP) renders every saved view at print size in one go.',
    'After Align visible, colour by Model agreement to see where the five models of a run disagree: per-residue Cα RMSF, blue under 0.5 Å to red at 4 Å or more, with a CSV in the Compare tab.',
    'Confidence → Ligand sites lists every ligand and ion with its contact residues, their mean pLDDT and, for AlphaFold 3, the PAE between ligand and site — the numbers that say whether a pose is trustworthy.',
    'Colour by entity gives every copy of the same protein one colour and the legend reads like a stoichiometry: α ×60, β ×12. The composition table adds the Cα extent and radius of gyration in nanometres.',
    'Annotate → Selections → Sequence motif takes a regular expression over one-letter codes — N[^P][ST] for sequons, C.{2,4}C for zinc knuckles — and highlights every match in every chain.'
  ];
  let tipIndex = Math.floor(Math.random() * tips.length);
  function renderTip() {
    root.querySelector('#gpv-tip').hidden = readJson(tipsKey, false) === true;
    root.querySelector('#gpv-tip-text').textContent = tips[tipIndex % tips.length];
  }
  root.querySelector('#gpv-tip-next').addEventListener('click', () => { tipIndex += 1; renderTip(); });
  root.querySelector('#gpv-tip-hide').addEventListener('click', () => { writeJson(tipsKey, true); renderTip(); updateStatus('Tips hidden · bring them back from the help dialog (?)'); });
  root.querySelector('#gpv-tips-reset').addEventListener('click', () => { writeJson(tipsKey, false); tipIndex += 1; renderTip(); });
  root.querySelector('#gpv-undo').addEventListener('click', undo);
  ['x', 'y', 'z'].forEach(axis => root.querySelector('#gpv-rotate-' + axis).addEventListener('click', event => rotateView(axis, event.shiftKey ? -90 : 90)));
  root.querySelector('#gpv-orient-reset').addEventListener('click', resetOrientation);
  Object.keys(presets).forEach(name => root.querySelector('#gpv-preset-' + name).addEventListener('click', () => applyPreset(name)));
  root.querySelector('#gpv-hetero').addEventListener('change', applyStyle);
  root.querySelector('#gpv-surface').addEventListener('change', () => { applyStyle(); updateStatus(root.querySelector('#gpv-surface').value === 'none' ? 'Surface removed' : 'Building the molecular surface…'); });
  root.querySelector('#gpv-sequence-text').open = readJson(lettersKey, false) === true;
  root.querySelector('#gpv-sequence-text').addEventListener('toggle', () => { writeJson(lettersKey, root.querySelector('#gpv-sequence-text').open); renderSequence(); });
  root.querySelector('#gpv-fasta').addEventListener('click', downloadFasta);
  root.querySelector('#gpv-domain-run').addEventListener('click', findDomains);
  root.querySelector('#gpv-rmsf-csv').addEventListener('click', downloadRmsfCsv);
  root.querySelector('#gpv-site-run').addEventListener('click', analyseLigandSites);
  root.querySelector('#gpv-site-csv').addEventListener('click', downloadSitesCsv);
  root.querySelector('#gpv-near-run').addEventListener('click', highlightNearby);
  root.querySelector('#gpv-motif-run').addEventListener('click', highlightMotif);
  root.querySelector('#gpv-motif').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); highlightMotif(); } });
  root.querySelector('#gpv-near-target').addEventListener('change', () => { root.querySelector('#gpv-near-chain').closest('label').hidden = root.querySelector('#gpv-near-target').value !== 'chain'; });
  root.querySelector('#gpv-near-chain').closest('label').hidden = true;
  root.querySelector('#gpv-near-copy').addEventListener('click', async () => { const text = nearbyListText(); if (!text) return; try { await navigator.clipboard.writeText(text); announce('Residue list copied · ' + nearbyResult.residues.length + ' residues'); } catch (error) { root.querySelector('#gpv-data-text').value = text; announce('Clipboard unavailable — the list is in the paste box below'); } });
  root.querySelector('#gpv-data-apply').addEventListener('click', loadPastedData);
  root.querySelector('#gpv-data-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; const table = parseResidueTable(await file.text()); if (!table) { announce('Could not read a residue column and a numeric value column from ' + file.name, 'error'); return; } setResidueData(table, fileStem(file.name)); event.target.value = ''; });
  root.querySelector('#gpv-data-paint').addEventListener('click', () => { const select = root.querySelector('#gpv-color-mode'); select.value = 'data'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  root.querySelector('#gpv-data-clear').addEventListener('click', () => { residueData = null; renderDataState(); applyStyle(); updateStatus('Per-residue data cleared'); });
  ['#gpv-data-scale', '#gpv-data-scope'].forEach(selector => root.querySelector(selector).addEventListener('change', () => { if (!residueData) return; residueData.scale = root.querySelector('#gpv-data-scale').value; residueData.scope = root.querySelector('#gpv-data-scope').value; renderDataState(); applyStyle(); }));
  root.querySelector('#gpv-views-zip').addEventListener('click', () => { downloadViewsZip(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && structures.length) saveSession().catch(() => {}); });
  root.querySelector('#gpv-add-domain').addEventListener('click', addDomainRecord);
  root.querySelector('#gpv-domain-range').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addDomainRecord(); } });
  root.querySelector('#gpv-domain-adopt').addEventListener('click', adoptPaeDomains);
  root.querySelector('#gpv-domain-paint').addEventListener('click', () => { const select = root.querySelector('#gpv-color-mode'); select.value = 'annotated'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  root.querySelector('#gpv-clear-domains').addEventListener('click', () => { if (domainRecords.length) remember('clearing domains'); domainRecords = []; domainVersion += 1; renderDomainList(); applyStyle(); updateStatus('Domains cleared'); });
  root.querySelector('#gpv-domain-color').addEventListener('click', () => { const select = root.querySelector('#gpv-color-mode'); select.value = 'domain'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  root.querySelector('#gpv-domain-highlight').addEventListener('click', () => { const entry = activeEntry(); if (entry && entry.domains && entry.domains.domains.length) highlightDomains(entry, entry.domains.domains); });
  root.querySelector('#gpv-copy-image').addEventListener('click', () => { copyPublicationPng(); });
  root.querySelector('#gpv-tiff').addEventListener('click', () => { downloadPublicationTiff(); });
  ['#gpv-export-mode', '#gpv-print-width', '#gpv-print-custom', '#gpv-print-aspect', '#gpv-print-dpi', '#gpv-print-text', '#gpv-export-size', '#gpv-export-scale'].forEach(selector => root.querySelector(selector).addEventListener('change', updateExportEstimate));
  root.querySelector('#gpv-figure-font').addEventListener('change', () => { figureFont(); rebuildOverlays(); updateStatus('Figure font: ' + root.querySelector('#gpv-figure-font').selectedOptions[0].textContent); });
  root.querySelector('#gpv-scale-bar').addEventListener('change', () => { if (Number(root.querySelector('#gpv-scale-bar').value)) ensureScaleBarLoop(); else updateScreenScaleBar(); });
  root.querySelector('#gpv-safe-palette').addEventListener('change', () => { safePaletteOn = root.querySelector('#gpv-safe-palette').checked; applyStyle(); renderDomainList(); updateStatus(safePaletteOn ? 'Okabe–Ito palette on for chains and domains' : 'Default palette restored'); });
  root.querySelector('#gpv-goto-run').addEventListener('click', () => goToResidue(root.querySelector('#gpv-goto').value));
  root.querySelector('#gpv-goto').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); goToResidue(root.querySelector('#gpv-goto').value); } });
  root.querySelector('#gpv-chains-all').addEventListener('click', () => { const entry = activeEntry(); if (!entry) return; entry.hiddenChains = []; entry.fadedChains = []; applyStyle(); updateStatus('All chains of ' + displayName(entry) + ' shown'); });
  root.querySelector('#gpv-figure-legend').addEventListener('click', () => { writeFigureLegend(); });
  root.querySelector('#gpv-methods-text').addEventListener('click', () => { writeMethodsText(); });
  root.querySelector('#gpv-redo').addEventListener('click', redo);
  root.querySelector('#gpv-share-link').addEventListener('click', () => { copyShareLink(); });
  root.querySelector('#gpv-sequence-toggle').addEventListener('click', () => { writeJson(sequenceKey, readJson(sequenceKey, false) !== true); renderSequence(); });
  new ResizeObserver(() => renderSequenceSoon()).observe(root.querySelector('#gpv-sequence-rows'));
  root.querySelector('#gpv-demo').addEventListener('click', () => { root.querySelector('#gpv-fetch-id').value = '1ubq'; root.querySelector('#gpv-fetch').click(); });
  renderTip();
  watchStageClicks();
  restorePreferences();
  root.querySelector('#gpv-cite-version').textContent = viewerVersion;
  figureFont(); updateExportEstimate();
  if (Number(root.querySelector('#gpv-scale-bar').value)) ensureScaleBarLoop();
  openSharedScene();
  offerSessionRestore();
  /* ?debug=1 exposes a few internals for the regression suite and for bug reports;
     it has no effect otherwise. */
  if (new URLSearchParams(location.search).has('debug')) window.__viewerDebug = { viewer, pickAtomAt, displayedEntries, activeEntry, colorOptions, sceneSettings, contactResult: () => contactResult, residueData: () => residueData, msaAssets: () => msaAssets, entries: () => structures, nearbyResidues, assemblyDimensions, paeDomains, parseConfidenceBytes, methodsText, alignmentResults: () => alignmentResults, ensembleSpread: () => ensembleSpread, siteResults: () => siteResults, interfaceResults: () => interfaceResults, solventAccessibleArea, heavyAtoms, ligandGroups };
  applyTheme(readJson(themeKey, 'system'));
  selectToolTab('models');
  applyAppearance();
  applyStyle();
  updateStatus();
  if (typeof gpvRenderIcons === 'function') gpvRenderIcons(root);
