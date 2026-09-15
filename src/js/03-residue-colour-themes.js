  /* ---------- Residue colour themes ---------- */

  const residueModes = ['charge', 'hydrophobicity', 'restype', 'amino', 'ss'];
  const kyteDoolittle = { I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8, W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5 };
  const residueTypeOf = { A: 'aliphatic', V: 'aliphatic', L: 'aliphatic', I: 'aliphatic', M: 'aliphatic', F: 'aromatic', W: 'aromatic', Y: 'aromatic', S: 'polar', T: 'polar', N: 'polar', Q: 'polar', K: 'positive', R: 'positive', H: 'positive', D: 'negative', E: 'negative', G: 'special', P: 'special', C: 'special' };
  const residueTypeColors = { aliphatic: ['#f59e0b', 'Hydrophobic (A V L I M)'], aromatic: ['#a855f7', 'Aromatic (F W Y)'], polar: ['#22c55e', 'Polar (S T N Q)'], positive: ['#3b82f6', 'Positive (K R H)'], negative: ['#ef4444', 'Negative (D E)'], special: ['#94a3b8', 'Gly · Pro · Cys'], nucleic: ['#0ea5e9', 'Nucleotide'], other: ['#d1d5db', 'Other'] };
  const chargeColors = { positive: ['#2563eb', 'Positive (Lys, Arg)'], partial: ['#7dd3fc', 'His (partial +)'], negative: ['#dc2626', 'Negative (Asp, Glu, nucleotide)'], neutral: ['#d1d5db', 'Neutral'] };
  /* RasMol amino-acid colours. */
  const aminoColors = { A: '#c8c8c8', R: '#145aff', N: '#00dcdc', D: '#e60a0a', C: '#e6e600', Q: '#00dcdc', E: '#e60a0a', G: '#ebebeb', H: '#8282d2', I: '#0f820f', L: '#0f820f', K: '#145aff', M: '#e6e600', F: '#3232aa', P: '#dc9682', S: '#fa9600', T: '#fa9600', W: '#b45ab4', Y: '#3232aa', V: '#0f820f' };
  const ssColors = { h: ['#d946ef', 'Helix'], s: ['#facc15', 'Strand'], c: ['#9ca3af', 'Coil / loop'] };

  function hydrophobicityColor(value) {
    const t = Math.max(-1, Math.min(1, value / 4.5));
    const mix = (a, b, k) => a.map((channel, index) => Math.round(channel + (b[index] - channel) * k));
    const rgb = t < 0 ? mix([241, 245, 249], [37, 99, 235], -t) : mix([241, 245, 249], [234, 88, 12], t);
    return '#' + rgb.map(channel => channel.toString(16).padStart(2, '0')).join('');
  }

  function isNucleotide(atom) {
    const code = String(atom.resn || '').toUpperCase().trim();
    return !aminoAcids[code] && Boolean(nucleotides[code]);
  }

  function residueColor(mode, atom) {
    const letter = residueLetter(atom.resn);
    if (mode === 'charge') {
      const key = isNucleotide(atom) ? 'negative' : letter === 'K' || letter === 'R' ? 'positive' : letter === 'H' ? 'partial' : letter === 'D' || letter === 'E' ? 'negative' : 'neutral';
      return chargeColors[key][0];
    }
    if (mode === 'hydrophobicity') return letter in kyteDoolittle ? hydrophobicityColor(kyteDoolittle[letter]) : '#d1d5db';
    if (mode === 'restype') return residueTypeColors[isNucleotide(atom) ? 'nucleic' : residueTypeOf[letter] || 'other'][0];
    if (mode === 'amino') return aminoColors[letter] || '#d1d5db';
    if (mode === 'ss') return (ssColors[atom.ss] || ssColors.c)[0];
    return '#d1d5db';
  }

  const residueLegends = {
    charge: () => ({ title: 'Charge', items: Object.values(chargeColors).map(([color, label]) => [color, label]) }),
    hydrophobicity: () => ({ title: 'Kyte–Doolittle', items: [[hydrophobicityColor(-4.5), '−4.5 hydrophilic'], [hydrophobicityColor(-2), '−2'], [hydrophobicityColor(0), '0'], [hydrophobicityColor(2), '+2'], [hydrophobicityColor(4.5), '+4.5 hydrophobic']] }),
    restype: () => ({ title: 'Residue type', items: Object.values(residueTypeColors).slice(0, 7).map(([color, label]) => [color, label]) }),
    amino: kind => kind === 'screen' ? { title: 'Amino acid', items: Object.entries(aminoColors).map(([letter, color]) => [color, letter]) } : null,
    ss: () => ({ title: 'Secondary structure', items: Object.values(ssColors).map(([color, label]) => [color, label]) })
  };

  /* Residue colours by three-letter code for every theme, so the report can colour
     without carrying the scoring tables. */
  function residueThemeTables() {
    const names = [...Object.keys(aminoAcids), ...Object.keys(nucleotides)];
    const table = mode => Object.fromEntries(names.map(name => [name, residueColor(mode, { resn: name })]));
    return { charge: table('charge'), hydrophobicity: table('hydrophobicity'), restype: table('restype'), amino: table('amino'), ss: Object.fromEntries(Object.entries(ssColors).map(([key, [color]]) => [key, color])), fallback: '#d1d5db' };
  }

  /* The colour part of a style — shared by the representation and the surface. */
  function mixHex(color, target, amount) {
    const parse = value => { const m = /^#([0-9a-f]{6})$/i.exec(String(value || '').trim()); return m ? [0, 2, 4].map(o => parseInt(m[1].slice(o, o + 2), 16)) : null; };
    const a = parse(color); const b = parse(target);
    if (!a || !b) return color;
    return '#' + a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount).toString(16).padStart(2, '0')).join('');
  }

  /* Faded chains keep their colour scheme but are blended most of the way into the paper,
     which spotlights one subunit without the per-model opacity limits of cartoon rendering. */
  /* Fading pushes colour towards the paper: per chain, to spotlight the rest of a model, or for a
     whole model, so one model of a superposition reads as the subject and the others as context. */
  function fadeOptions(entry, options) {
    const faded = entry.fadedChains || [];
    if (!faded.length && !entry.faded) return options;
    const background = backgroundSpec(); const paper = background.alpha === 0 ? '#ffffff' : background.color;
    const colorOf = options.colorfunc ? options.colorfunc : options.color ? () => options.color : null;
    if (!colorOf) return options;
    if (entry.faded) return { colorfunc: atom => mixHex(colorOf(atom), paper, 0.72) };
    return { colorfunc: atom => faded.includes(atom.chain || '') ? mixHex(colorOf(atom), paper, 0.72) : colorOf(atom) };
  }

  function colorOptions(entry) {
    return fadeOptions(entry, baseColorOptions(entry));
  }

  function baseColorOptions(entry) {
    const mode = root.querySelector('#gpv-color-mode').value;
    if (mode === 'chain') return { colorfunc: atom => chainColor(atom.chain) };
    if (mode === 'entity') return { colorfunc: atom => entityColor(entry, atom) };
    if (mode === 'plddt') return { colorfunc: atom => plddtColor(Number(atom.b || 0)) };
    if (mode === 'deviation') return { colorfunc: atom => deviationColor(entry, atom) };
    if (mode === 'agreement') return { colorfunc: atom => agreementColor(atom) };
    if (mode === 'domain') return { colorfunc: atom => domainColor(entry, atom) };
    if (mode === 'annotated') return { colorfunc: atom => annotatedColor(entry, atom) };
    if (mode === 'data') return { colorfunc: atom => dataColor(entry, atom) };
    if (residueModes.includes(mode)) return { colorfunc: atom => residueColor(mode, atom) };
    if (mode === 'spectrum') return { colorscheme: 'spectrum' };
    if (mode === 'element') return { colorscheme: 'default' };
    return { color: entry.color };
  }

  function styleFor(entry) {
    const representation = root.querySelector('#gpv-style').value;
    const options = { ...colorOptions(entry) };
    if (representation === 'line') options.linewidth = 2;
    /* A faded model is also drawn thinner, so an overlay of five predictions reads as one subject
       against context rather than as a tangle of equals. */
    if (entry.faded) {
      if (representation === 'cartoon') { options.thickness = 0.15; options.arrows = false; }
      if (representation === 'line') options.linewidth = 1;
      if (representation === 'stick') options.radius = 0.08;
      if (representation === 'sphere') options.scale = 0.3;
    }
    const style = {};
    style[representation] = options;
    return style;
  }

  function hideBelow() {
    return Number(root.querySelector('#gpv-hide-below').value) || 0;
  }

  /* One place that styles a model the way the viewer shows it, so panels and
     exports agree with the main view: colour scheme, the low-confidence cut,
     hetero groups, and the optional surface. Returns a promise that resolves when
     any surface has been built, so exports can wait for it. */
  const surfaceAtomLimit = 40000;
  let surfaceWarned = false;
  function applyModelStyle(model, entry, host = null) {
    model.setStyle({}, styleFor(entry));
    const threshold = hideBelow();
    if (threshold && entry.scores.length) model.setStyle({ predicate: atom => Number(atom.b) < threshold }, {});
    /* Hetero groups are invisible in cartoon mode unless styled on their own.
       Water is never drawn. */
    const hetero = root.querySelector('#gpv-hetero').value;
    const heteroStyle = hetero === 'hide' ? {} : hetero === 'sphere' ? { sphere: { scale: 0.35, colorscheme: 'default' } } : { stick: { radius: 0.25, colorscheme: 'default' }, sphere: { scale: 0.28, colorscheme: 'default' } };
    model.setStyle({ hetflag: true }, heteroStyle);
    model.setStyle({ resn: waterNames }, {});
    if (entry.hiddenChains && entry.hiddenChains.length) model.setStyle({ chain: entry.hiddenChains }, {});
    /* Compared positions (Annotate → Compare this position) get side-chain sticks added on top of
       whatever the model is drawn as, so the position under discussion is visible in the main view,
       every panel and every export at once. A hidden chain stays hidden. */
    if (spotlightResidues.length && root.querySelector('#gpv-position-sticks').checked) {
      spotlightResidues.forEach(spot => {
        if (spot.chain && (entry.hiddenChains || []).includes(spot.chain)) return;
        model.setStyle(spot.chain ? { chain: spot.chain, resi: spot.resi } : { resi: spot.resi }, { stick: { radius: 0.22, colorscheme: 'default' } }, true);
      });
    }
    const surface = root.querySelector('#gpv-surface').value;
    if (surface === 'none' || !host || typeof host.addSurface !== 'function') return Promise.resolve();
    if (entry.atoms.length > surfaceAtomLimit) {
      if (!surfaceWarned) { surfaceWarned = true; announce(displayName(entry) + ' has too many atoms for a surface (limit ' + surfaceAtomLimit.toLocaleString() + ')', 'error'); }
      return Promise.resolve();
    }
    const hiddenChains = entry.hiddenChains || [];
    const selection = { model, hetflag: false, predicate: atom => !isWater(atom) && !hiddenChains.includes(atom.chain || '') && !(threshold && entry.scores.length && Number(atom.b) < threshold) };
    const style = { ...colorOptions(entry), opacity: surface === 'translucent' ? 0.6 : 1 };
    try {
      return Promise.resolve(host.addSurface($3Dmol.SurfaceType.MS, style, selection)).then(() => { if (typeof host.render === 'function') host.render(); }).catch(() => {});
    } catch (error) {
      return Promise.resolve();
    }
  }
  const waterNames = ['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'SOL'];
  const isWater = atom => waterNames.includes(String(atom.resn || '').toUpperCase());

  const residueTag = atom => (atom.chain || '') + '|' + atom.resi;
  const deviationBands = [[1, '#2563eb', '<1 Å'], [2, '#22c55e', '1–2 Å'], [4, '#eab308', '2–4 Å'], [8, '#f97316', '4–8 Å'], [Infinity, '#dc2626', '≥8 Å']];
  function deviationColor(entry, atom) {
    const value = entry.deviations ? entry.deviations.get(residueTag(atom)) : undefined;
    if (value === undefined) return '#9ca3af';
    return deviationBands.find(([limit]) => value < limit)[1];
  }

  function updateStatus(message = 'Ready') {
    if (!root.querySelector('[data-gpv-panel="publish"]').hidden) { setTimeout(renderPublicationChecks, 0); setTimeout(renderCompositeControls, 0); }
    const visible = displayedEntries();
    root.querySelector('#gpv-count').textContent = visible.length + ' displayed / ' + structures.length + ' loaded';
    const scores = visible.flatMap(entry => entry.scores);
    const score = mean(scores);
    root.querySelector('#gpv-confidence').textContent = score === null ? 'Mean pLDDT —' : 'Mean pLDDT ' + score.toFixed(1);
    root.querySelector('#gpv-state').textContent = message;
    root.querySelector('#gpv-empty').hidden = structures.length > 0;
    root.querySelector('#gpv-stage-empty').hidden = structures.length > 0;
    root.querySelector('#gpv-drop').classList.toggle('is-compact', structures.length > 0);
    root.querySelector('#gpv-report').disabled = structures.length === 0;
    root.querySelector('#gpv-share-link').disabled = !structures.some(entry => entry.fetchId);
    root.querySelector('#gpv-fasta').disabled = structures.length === 0;
    root.querySelector('#gpv-copy-image').disabled = structures.length === 0;
    root.querySelector('#gpv-add-domain').disabled = !activeEntry();
    updatePositionCompare();
    root.querySelector('#gpv-figure-legend').disabled = structures.length === 0;
    root.querySelector('#gpv-methods-text').disabled = structures.length === 0;
    const scored = structures.some(entry => entry.visible && entry.scores.length);
    root.querySelector('#gpv-profile-svg').disabled = !scored;
    root.querySelector('#gpv-profile-png').disabled = !scored;
    root.querySelector('#gpv-image').disabled = structures.length === 0; root.querySelector('#gpv-model-panels').disabled = structures.length < 2;
    root.querySelector('#gpv-rmsd-matrix-run').disabled = structures.length < 2;
    root.querySelector('#gpv-svg').disabled = structures.length === 0;
    if (typeof renderImageButton === 'function') renderImageButton();
    root.querySelector('#gpv-video').disabled = structures.length === 0;
    root.querySelector('#gpv-save-scene').disabled = structures.length === 0; root.querySelector('#gpv-save-session').disabled = structures.length === 0;
    root.querySelector('#gpv-save-view').disabled = structures.length === 0;
    root.querySelector('#gpv-contact-sheet').disabled = !savedViews.some(view => view.inFigure !== false);
    root.querySelector('#gpv-builder-svg').disabled = !savedViews.some(view => view.inFigure !== false);
    root.querySelector('#gpv-views-zip').disabled = savedViews.length === 0;
    root.querySelector('#gpv-near-run').disabled = structures.length === 0;
    root.querySelector('#gpv-motif-run').disabled = structures.length === 0;
    root.querySelector('#gpv-data-apply').disabled = structures.length === 0;
    scheduleSessionSave();
    root.querySelector('#gpv-captions').disabled = savedViews.length === 0;
    ['#gpv-domain-labels', '#gpv-pae-domain-labels', '#gpv-architecture-png', '#gpv-architecture-svg'].forEach(selector => { root.querySelector(selector).disabled = structures.length === 0; });
    updateReportEstimate();
    ['#gpv-current', '#gpv-reference', '#gpv-selection-model', '#gpv-left-model', '#gpv-previous', '#gpv-next', '#gpv-cycle', '#gpv-align', '#gpv-restore', '#gpv-add-selection', '#gpv-annotate', '#gpv-add-screen-text', '#gpv-interface-model', '#gpv-interface-run'].forEach(selector => {
      root.querySelector(selector).disabled = structures.length === 0;
    });
    const comparing = root.querySelector('#gpv-side-by-side').checked && comparePanels.length > 0 && structures.length > 0;
    root.querySelector('#gpv-add-panel').disabled = structures.length === 0 || comparePanels.length >= maxComparePanels;
    root.querySelector('#gpv-clear-panels').disabled = comparePanels.length === 0;
    root.querySelector('#gpv-compare-image').disabled = !comparing;
    root.querySelector('#gpv-compare-svg').disabled = !comparing;
    if (comparing) root.querySelector('#gpv-count').textContent += ' · ' + (comparePanels.length + 1) + ' panels';
  }

  function materializeEntry(entry) {
    if (entry.model) return entry.model;
    const model = viewer.addModel(entry.text, entry.format);
    const atoms = model.selectedAtoms({});
    if (!atoms.length) {
      viewer.removeModel(model);
      throw new Error('No atoms could be read from ' + entry.name);
    }
    entry.model = model;
    entry.atoms = atoms;
    seedChainColors(atoms);
    /* Experimental structures carry crystallographic B-factors, not pLDDT, in the same
       column; do not report them as confidence. */
    if (!entry.scores.length && entry.collection !== 'RCSB PDB') entry.scores = modelScores(model);
    entry.originalAtoms = atoms.map(atom => ({ x: atom.x, y: atom.y, z: atom.z }));
    return model;
  }

  function releaseHiddenModels(shown) {
    if (structures.length < 40 || root.querySelector('#gpv-view-mode').value !== 'single' || alignmentResults.length) return;
    const protectedIds = new Set([
      ...labelRecords.map(record => record.entryId),
      ...selectionRecords.map(record => record.entryId),
      ...measurementRecords.flatMap(record => record.points.map(point => point.entryId))
    ]);
    structures.forEach(entry => {
      if (!entry.model || shown.has(entry) || protectedIds.has(entry.id)) return;
      viewer.removeModel(entry.model);
      entry.model = null;
      entry.atoms = [];
      entry.originalAtoms = [];
    });
  }

  function applyStyle() {
    if (typeof viewer.removeAllSurfaces === 'function') viewer.removeAllSurfaces();
    let shown = new Set(displayedEntries());
    const broken = [];
    structures.forEach(entry => {
      if (shown.has(entry) && !entry.model) {
        try { materializeEntry(entry); }
        catch (error) { entry.visible = false; shown.delete(entry); broken.push(error.message); }
      }
      if (!entry.model) return;
      entry.model.setStyle({}, {});
      if (shown.has(entry)) applyModelStyle(entry.model, entry, viewer);
    });
    if (broken.length) {
      shown = new Set(displayedEntries());
      showImportErrors(broken);
    }
    releaseHiddenModels(shown);
    applySelections(shown);
    renderScreenLegend();
    renderSequenceSoon();
    renderComposition();
    rebuildOverlays(false);
    renderComparePanels();
    viewer.render();
    if (!root.querySelector('[data-gpv-panel="confidence"]').hidden) renderConfidence();
    updateStatus();
  }

  function syncModelControls() {
    if (!structures.length) activeId = null;
    if (structures.length && !structures.some(entry => entry.id === activeId)) activeId = structures[0].id;
    ['#gpv-current', '#gpv-reference', '#gpv-selection-model', '#gpv-left-model', '#gpv-interface-model'].forEach(selector => {
      const select = root.querySelector(selector);
      const previous = selector === '#gpv-current' ? activeId : (select.value || (selector === '#gpv-left-model' ? activeId : ''));
      select.replaceChildren();
      structures.forEach(entry => {
        const option = document.createElement('option');
        option.value = String(entry.id);
        option.textContent = (entry.collection ? entry.collection + ' › ' : '') + displayName(entry);
        select.append(option);
      });
      if (structures.some(entry => String(entry.id) === String(previous))) select.value = String(previous);
    });
    renderPanelControls();
    const sourceFilter = root.querySelector('#gpv-source-filter');
    const previousSource = sourceFilter.value || 'all';
    sourceFilter.replaceChildren(new Option('All loaded sources', 'all'));
    [...new Set(structures.map(entry => entry.collection).filter(Boolean))].forEach(collection => sourceFilter.append(new Option(collection, collection)));
    sourceFilter.value = [...sourceFilter.options].some(option => option.value === previousSource) ? previousSource : 'all';
    if (!root.querySelector('[data-gpv-panel="confidence"]').hidden) renderConfidence();
  }

  function filteredStructures() {
    const source = root.querySelector('#gpv-source-filter').value;
    const query = root.querySelector('#gpv-model-search').value.trim().toLowerCase();
    return structures.filter(entry => (source === 'all' || entry.collection === source) && (!query || (entry.name + ' ' + (entry.label || '') + ' ' + entry.sourcePath + ' ' + entry.collection).toLowerCase().includes(query)));
  }

  function renderList() {
    syncModelControls();
    const list = root.querySelector('#gpv-list');
    list.replaceChildren();
    const matching = filteredStructures();
    /* Large AlphaFold archives routinely hold hundreds of models. Building a row
       for every one of them makes each re-render visibly slow, so page them. */
    const shownRows = matching.slice(0, listLimit);
    const more = root.querySelector('#gpv-list-more');
    more.hidden = matching.length <= shownRows.length;
    root.querySelector('#gpv-list-more-label').textContent = more.hidden
      ? ''
      : 'Showing ' + shownRows.length + ' of ' + matching.length + ' models';
    shownRows.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'gpv-entry' + (entry.id === activeId ? ' is-active' : '');
      row.dataset.entryId = String(entry.id);

      const visibleLabel = document.createElement('label');
      visibleLabel.className = 'form-check form-switch';
      const visible = document.createElement('input');
      visible.className = 'form-check-input';
      visible.type = 'checkbox';
      visible.checked = entry.visible;
      visible.setAttribute('aria-label', 'Show ' + entry.name);
      visible.addEventListener('change', () => { entry.visible = visible.checked; applyStyle(); });
      visibleLabel.append(visible);

      const copy = document.createElement('span');
      copy.className = 'gpv-entry-copy';
      const name = document.createElement('span');
      name.className = 'gpv-entry-name';
      name.textContent = displayName(entry);
      const source = document.createElement('span');
      source.className = 'gpv-entry-source text-small';
      source.textContent = (entry.label ? entry.name + ' · ' : '') + (entry.collection || 'Individual files');
      copy.append(name, source);

      const rename = document.createElement('button');
      rename.className = 'btn btn-ghost';
      rename.type = 'button';
      rename.textContent = 'Rename';
      rename.setAttribute('aria-label', 'Rename ' + entry.name);
      rename.addEventListener('click', () => {
        const input = document.createElement('input');
        input.className = 'form-control'; input.type = 'text'; input.maxLength = 120;
        input.value = displayName(entry); input.placeholder = entry.name;
        input.setAttribute('aria-label', 'Display name for ' + entry.name);
        let done = false;
        const commit = () => {
          if (done) return; done = true;
          const value = input.value.trim();
          entry.label = value && value !== entry.name ? value : '';
          renderList(); applyStyle();
          updateStatus(entry.label ? 'Renamed to ' + entry.label : 'Display name reset to the file name');
        };
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          if (event.key === 'Escape') { event.preventDefault(); done = true; renderList(); }
        });
        input.addEventListener('blur', commit);
        copy.replaceChildren(input); input.focus(); input.select();
      });

      const score = document.createElement('span');
      score.className = 'gpv-entry-score text-small';
      const average = mean(entry.scores);
      score.textContent = average === null ? (entry.model ? 'pLDDT —' : 'Not viewed') : average.toFixed(1);

      const color = document.createElement('input');
      color.className = 'form-control form-control-color';
      color.type = 'color';
      color.value = entry.color;
      color.setAttribute('aria-label', 'Color for ' + entry.name);
      color.addEventListener('input', () => { entry.color = color.value; root.querySelector('#gpv-color-mode').value = 'structure'; applyStyle(); });

      const fadeLabel = document.createElement('label');
      fadeLabel.className = 'form-check form-switch';
      fadeLabel.title = 'Draw this model faded and thin, as context behind the others';
      const fade = document.createElement('input');
      fade.className = 'form-check-input'; fade.type = 'checkbox'; fade.checked = Boolean(entry.faded);
      fade.setAttribute('aria-label', 'Fade ' + entry.name);
      fade.addEventListener('change', () => { remember('model fade'); entry.faded = fade.checked; applyStyle(); renderSequenceSoon(); });
      fadeLabel.append(fade);

      const focus = document.createElement('button');
      focus.className = 'btn btn-ghost'; focus.type = 'button'; focus.textContent = 'Emphasise';
      focus.title = 'Draw this model solid and fade every other shown model';
      focus.setAttribute('aria-label', 'Emphasise ' + entry.name);
      focus.addEventListener('click', () => {
        remember('emphasis');
        const shown = structures.filter(item => item.visible && item.model);
        const alone = entry.faded === false && shown.every(item => item === entry || item.faded);
        shown.forEach(item => { item.faded = alone ? false : item !== entry; });
        renderList(); applyStyle(); renderSequenceSoon();
        updateStatus(alone ? 'Every shown model is drawn solid again' : displayName(entry) + ' is drawn solid, the other shown models faded');
      });

      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        if (entry.model) viewer.removeModel(entry.model);
        structures = structures.filter(item => item !== entry);
        labelRecords = labelRecords.filter(label => label.entryId !== entry.id);
        renderLabelList();
        selectionRecords = selectionRecords.filter(selection => selection.entryId !== entry.id);
        measurementRecords = measurementRecords.filter(measurement => measurement.points.every(point => point.entryId !== entry.id));
        alignmentResults = [];
        renderAlignmentResults();
        renderSelectionList();
        renderMeasurementList();
        renderList();
        applyStyle();
      });

      row.append(visibleLabel, copy, score, color, fadeLabel, focus, rename, remove);
      list.append(row);
    });
  }

  function addStructure(name, text, format, sourcePath = name, collection = 'Individual files', lazy = false) {
    const entry = {
      id: nextStructureId++,
      loadIndex: nextStructureId - 2,
      name,
      collection,
      model: null,
      visible: true,
      color: palette[structures.length % palette.length],
      text,
      format,
      sourcePath,
      confidence: {},
      rank: null,
      label: '',
      hiddenChains: [],
      scores: [],
      atoms: [],
      originalAtoms: []
    };
    structures.push(entry);
    if (activeId === null) activeId = entry.id;
    if (!lazy) {
      try { materializeEntry(entry); }
      catch (error) { structures = structures.filter(item => item !== entry); if (activeId === entry.id) activeId = structures[0] ? structures[0].id : null; throw error; }
    }
    if (!lazy) sha256(text).then(hash => { entry.hash = hash; });
    return entry;
  }

  function stopCycle() {
    clearInterval(cycleTimer);
    cycleTimer = 0;
    const button = root.querySelector('#gpv-cycle');
    setButtonText(button, 'Cycle models');
    const host = button.querySelector('[data-icon]');
    host.setAttribute('data-icon', 'play');
    host.replaceChildren();
    if (typeof gpvRenderIcons === 'function') gpvRenderIcons(button);
  }

  function visibleEntries() {
    return structures.filter(entry => entry.visible);
  }

  function cycleEntries() {
    return filteredStructures().filter(entry => entry.visible);
  }

  function selectModel(entry, fit = true) {
    if (!entry) return;
    if (!entry.visible) {
      entry.visible = true;
      renderList();
    }
    activeId = entry.id;
    root.querySelector('#gpv-current').value = String(entry.id);
    root.querySelector('#gpv-view-mode').value = 'single';
    applyStyle();
    root.querySelectorAll('#gpv-list [data-entry-id]').forEach(row => row.classList.toggle('is-active', Number(row.dataset.entryId) === entry.id));
    const activeRow = root.querySelector('#gpv-list [data-entry-id="' + entry.id + '"] .gpv-entry-score');
    const average = mean(entry.scores);
    if (activeRow) activeRow.textContent = average === null ? 'pLDDT —' : average.toFixed(1);
    if (fit && entry.model) { viewer.zoomTo({ model: entry.model.getID() }); viewer.render(); }
    updateStatus('Showing ' + displayName(entry));
  }

  function selectRelative(delta, fit = true) {
    const candidates = cycleEntries();
    if (!candidates.length) return;
    let index = candidates.findIndex(entry => entry.id === activeId);
    if (index < 0) index = delta > 0 ? -1 : 0;
    selectModel(candidates[(index + delta + candidates.length) % candidates.length], fit);
  }

  function toggleCycle() {
    if (cycleTimer) { stopCycle(); return; }
    if (!cycleEntries().length) return;
    root.querySelector('#gpv-view-mode').value = 'single';
    const delay = Math.max(500, Number(root.querySelector('#gpv-cycle-speed').value) * 1000);
    cycleTimer = setInterval(() => selectRelative(1, false), delay);
    const button = root.querySelector('#gpv-cycle');
    setButtonText(button, 'Pause cycle');
    const host = button.querySelector('[data-icon]');
    host.setAttribute('data-icon', 'pause');
    host.replaceChildren();
    if (typeof gpvRenderIcons === 'function') gpvRenderIcons(button);
    const candidates = cycleEntries();
    const active = activeEntry();
    selectModel(candidates.includes(active) ? active : candidates[0], false);
  }

  function residueKey(entryId, chain, resi) {
    return [entryId, chain || '', resi].join('|');
  }

  function residueText(entry, atom) {
    const chain = atom.chain ? ' chain ' + atom.chain : '';
    const confidence = entry.scores.length && Number.isFinite(Number(atom.b)) ? ' · pLDDT ' + Number(atom.b).toFixed(1) : '';
    return entry.name + ' · ' + (atom.resn || 'Residue') + ' ' + atom.resi + chain + ' · atom ' + (atom.atom || '—') + confidence;
  }

  function selectResidue(entry, atom) {
    selectedResidue = {
      entryId: entry.id,
      chain: atom.chain || '',
      resi: atom.resi,
      resn: atom.resn || 'RES',
      atom: atom.atom || '',
      x: atom.x,
      y: atom.y,
      z: atom.z,
      b: atom.b
    };
    root.querySelector('#gpv-residue').textContent = residueText(entry, atom);
    const key = residueKey(entry.id, atom.chain, atom.resi);
    const saved = labelRecords.find(label => label.key === key);
    root.querySelector('#gpv-label-text').value = saved ? saved.text : (atom.resn || 'RES') + atom.resi + (atom.chain ? ' · ' + atom.chain : '');
    root.querySelector('#gpv-add-label').disabled = false;
    updatePositionCompare();
  }

  function addOrEditLabel() {
    if (!selectedResidue) return;
    const text = root.querySelector('#gpv-label-text').value.trim();
    if (!text) return;
    const key = residueKey(selectedResidue.entryId, selectedResidue.chain, selectedResidue.resi);
    remember('label change');
    const record = { ...selectedResidue, key, text };
    const index = labelRecords.findIndex(label => label.key === key);
    if (index >= 0) labelRecords[index] = { ...labelRecords[index], ...record };
    else labelRecords.push(record);
    renderLabelList();
    rebuildOverlays();
    updateStatus(index >= 0 ? 'Residue label updated' : 'Residue label added');
  }

  function labelStyle(position, options = {}) {
    const color = /^#[0-9a-f]{6}$/i.test(options.color || '') ? options.color : null;
    const plain = root.querySelector('#gpv-label-style').value === 'plain';
    const background = backgroundSpec();
    const onDark = background.alpha > 0 && hexLuminance(background.color) < 0.45;
    /* A boxed label is a patch of the figure's paper with text on it. Once a background colour is
       chosen the box takes that colour, which is what the SVG export has always drawn; only with a
       transparent background does it fall back to the interface's own card colour. */
    const paper = background.alpha > 0 ? background.color : (labelColors.getPropertyValue('--card').trim() || '#ffffff');
    const ink = background.alpha > 0 ? (onDark ? '#f8fafc' : '#111827') : (labelColors.getPropertyValue('--card-foreground').trim() || '#111827');
    return {
      position,
      backgroundColor: paper,
      fontColor: color || (plain ? (onDark ? '#f8fafc' : '#111827') : ink),
      borderColor: color || (background.alpha > 0 ? (onDark ? '#475569' : '#cbd5e1') : (labelColors.getPropertyValue('--border').trim() || '#cbd5e1')),
      borderThickness: plain ? 0 : 1,
      fontSize: Math.round((options.size || 12) * (options.scale || 1)),
      font: figureFont(),
      inFront: true,
      showBackground: !plain
    };
  }

  const labelSizes = [[10, 'Small'], [12, 'Normal'], [15, 'Large'], [19, 'Huge']];

  function renderLabelList() {
    renderSequenceSoon();
    const list = root.querySelector('#gpv-label-list'); list.replaceChildren();
    const separate = root.querySelector('#gpv-labels-separate');
    if (separate) separate.disabled = !labelRecords.length;
    labelRecords.forEach(label => {
      const entry = entryById(label.entryId);
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const copy = document.createElement('span'); copy.className = 'gpv-edit-copy';
      const text = document.createElement('input'); text.className = 'form-control'; text.type = 'text'; text.value = label.text; text.maxLength = 120;
      text.setAttribute('aria-label', 'Label text for ' + (label.resn || 'residue') + ' ' + label.resi);
      text.addEventListener('change', () => { const value = text.value.trim(); if (!value) { text.value = label.text; return; } remember('label text'); label.text = value; rebuildOverlays(); updateStatus('Label updated'); });
      text.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); text.blur(); } });
      const where = document.createElement('span'); where.className = 'gpv-entry-source text-small';
      where.textContent = (entry ? displayName(entry) : 'Missing model') + ' · ' + (label.resn || 'RES') + ' ' + label.resi + (label.chain ? ' · chain ' + label.chain : '');
      copy.append(text, where);
      const tools = document.createElement('span'); tools.className = 'gpv-edit-tools';
      const size = document.createElement('select'); size.className = 'form-select'; size.setAttribute('aria-label', 'Label size');
      labelSizes.forEach(([value, name]) => size.append(new Option(name, String(value))));
      size.value = String(label.size || 12);
      size.addEventListener('change', () => { remember('label size'); label.size = Number(size.value); rebuildOverlays(); });
      const color = document.createElement('input'); color.className = 'form-control form-control-color'; color.type = 'color';
      color.value = label.color || (labelColors.getPropertyValue('--card-foreground').trim() || '#111827');
      color.setAttribute('aria-label', 'Label colour');
      color.addEventListener('input', () => { if (!color.dataset.remembered) { remember('label colour'); color.dataset.remembered = '1'; } label.color = color.value; rebuildOverlays(); });
      color.addEventListener('change', () => { delete color.dataset.remembered; });
      const show = document.createElement('button'); show.className = 'btn btn-ghost'; show.type = 'button'; show.textContent = 'Show';
      show.title = 'Zoom to this residue';
      show.addEventListener('click', () => { if (!entry || !entry.model) return; const selection = { model: entry.model.getID(), resi: label.resi }; if (label.chain) selection.chain = label.chain; viewer.zoomTo(selection); viewer.render(); syncViewsFrom(viewer); });
      const reset = document.createElement('button'); reset.className = 'btn btn-ghost'; reset.type = 'button'; reset.textContent = 'Reset';
      reset.title = 'Put the label back on its residue'; reset.disabled = labelOffsetLength(label) === 0;
      reset.addEventListener('click', () => { remember('label position'); label.offset = null; delete label.autoPlaced; renderLabelList(); rebuildOverlays(); updateStatus('Label put back on its residue'); });
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('label removal'); labelRecords = labelRecords.filter(item => item !== label); renderLabelList(); rebuildOverlays(); updateStatus('Label removed'); });
      tools.append(size, color, show, reset, remove);
      row.append(copy, tools); list.append(row);
    });
  }

  /* A label belongs to its residue: that is its anchor. Dragging it stores `offset`, a
     model-space vector, so the text keeps its place against the structure as the camera moves,
     and a thin leader line is drawn back to the residue once it has moved a clear distance. */
  function labelAnchor(label, byId = entriesById()) {
    const entry = byId.get(label.entryId);
    const atom = entry && entry.atoms.find(item => (item.chain || '') === label.chain && item.resi === label.resi && (item.atom === 'CA' || item.atom === label.atom));
    return atom ? { x: atom.x, y: atom.y, z: atom.z } : { x: label.x, y: label.y, z: label.z };
  }
  function labelOffsetLength(label) {
    const offset = label && label.offset;
    return offset ? Math.hypot(offset.x || 0, offset.y || 0, offset.z || 0) : 0;
  }
  function labelPosition(label, byId = entriesById()) { return shiftBy(labelAnchor(label, byId), label.offset); }
  const leaderMinimum = 0.75;
  function leaderLength(anchor, position) { return Math.hypot(position.x - anchor.x, position.y - anchor.y, position.z - anchor.z); }
  function leaderColor() { return labelColors.getPropertyValue('--muted-foreground').trim() || '#94a3b8'; }
  /* `placement`, when a figure panel has resolved one (panelLabelPlacement), says where each label
     goes in that panel — its text prints several times larger against the structure than on screen,
     so the screen's placement is not the panel's. Without one the label sits at its own offset. */
  function drawLabels(target, shownIds, scale = 1, placement = null) {
    const byId = entriesById();
    labelRecords.filter(label => shownIds.has(label.entryId)).forEach(label => {
      const anchor = labelAnchor(label, byId);
      const position = (placement && placement.get(label)) || shiftBy(anchor, label.offset);
      if (leaderLength(anchor, position) > leaderMinimum) target.addLine({ start: anchor, end: position, color: label.color || leaderColor(), linewidth: Math.max(1, Math.round(scale)) });
      target.addLabel(label.text, labelStyle(position, { color: label.color, size: label.size, scale }));
    });
    if (root.querySelector('#gpv-all-labels').checked) {
      const entry = activeEntry();
      if (entry && shownIds.has(entry.id)) {
        entry.atoms.filter(atom => atom.atom === 'CA').forEach(atom => {
          const text = (atom.resn || 'RES') + atom.resi + (atom.chain ? ' · ' + atom.chain : '');
          target.addLabel(text, labelStyle({ x: atom.x, y: atom.y, z: atom.z }, { scale }));
        });
      }
    }
  }

  /* Labels, measurements, and figure annotations share one pass so that adding
     any one of them never wipes the others, and so exports and comparison panels
     can draw the same overlays into their own viewers. */
  function drawOverlays(target, shownIds, dimensions, includeScreenText = true, placement = null) {
    const scale = overlayScale(dimensions);
    drawLabels(target, shownIds, scale, placement);
    drawMeasurements(target, shownIds, scale);
    drawAnnotations(target, shownIds, dimensions, includeScreenText);
  }

  function rebuildOverlays(shouldRender = true) {
    viewer.removeAllLabels();
    viewer.removeAllShapes();
    const stage = root.querySelector('#gpv-stage');
    /* The model badge sits in the top-left corner while comparing; keep corner titles clear of it. */
    const comparing = root.querySelector('#gpv-side-by-side').checked && comparePanels.length > 0 && structures.length > 0;
    const topInset = comparing ? 44 : 0;
    drawOverlays(viewer, new Set(displayedEntries().map(entry => entry.id)), { width: stage.clientWidth, height: stage.clientHeight, topInset });
    if (shouldRender) viewer.render();
  }

  function parseResidueRange(value) {
    const residues = new Set();
    String(value || '').split(',').forEach(part => {
      const match = part.trim().match(/^(-?\d+)(?:\s*-\s*(-?\d+))?$/);
      if (!match) return;
      const start = Number(match[1]);
      const end = match[2] === undefined ? start : Number(match[2]);
      const step = start <= end ? 1 : -1;
      for (let residue = start; residue !== end + step && residues.size < 10000; residue += step) residues.add(residue);
    });
    return [...residues];
  }

  function applySelections(shown = new Set(displayedEntries())) {
    const byId = entriesById();
    selectionRecords.forEach(record => {
      const entry = byId.get(record.entryId);
      /* A record can outlive its model: the entry may have been released to save
         memory, or its coordinates may have failed to parse. */
      if (!entry || !entry.model || !shown.has(entry)) return;
      const selection = { resi: record.residues };
      if (record.chain) selection.chain = record.chain;
      if (record.action === 'hide') entry.model.setStyle(selection, {});
      else if (typeof entry.model.addStyle === 'function') entry.model.addStyle(selection, { stick: { color: record.color, radius: 0.25 }, sphere: { color: record.color, scale: 0.3 } });
    });
  }

  function renderSelectionList() {
    const list = root.querySelector('#gpv-selection-list');
    list.replaceChildren();
    selectionRecords.forEach(record => {
      const entry = structures.find(item => item.id === record.entryId);
      if (!entry) return;
      const row = document.createElement('div');
      row.className = 'gpv-entry';
      const name = document.createElement('span');
      name.className = 'gpv-entry-name';
      name.textContent = entry.name + ' · chain ' + (record.chain || '—') + ' · ' + record.residues.join(', ') + ' · ' + record.action;
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('selection removal'); selectionRecords = selectionRecords.filter(item => item.id !== record.id); renderSelectionList(); applyStyle(); });
      row.append(name, remove); list.append(row);
    });
  }

  function addSelection() {
    const entryId = Number(root.querySelector('#gpv-selection-model').value);
    const chain = root.querySelector('#gpv-selection-chain').value.trim();
    const residues = parseResidueRange(root.querySelector('#gpv-selection-range').value);
    if (!entryId || !residues.length) { updateStatus('Enter a valid residue number or range'); return; }
    remember('selection');
    selectionRecords.push({ id: nextAnnotationId++, entryId, chain, residues, action: root.querySelector('#gpv-selection-action').value, color: root.querySelector('#gpv-selection-color').value });
    renderSelectionList(); applyStyle(); updateStatus('Selection added');
  }

  function atomReference(entry, atom) {
    return { entryId: entry.id, chain: atom.chain || '', resi: atom.resi, atom: atom.atom || '', index: Number.isInteger(atom.index) ? atom.index : null };
  }

  function resolvePoint(reference) {
    const entry = structures.find(item => item.id === reference.entryId);
    if (!entry) return null;
    return entry.atoms.find(atom => Number.isInteger(reference.index) && atom.index === reference.index)
      || entry.atoms.find(atom => (atom.chain || '') === reference.chain && atom.resi === reference.resi && (atom.atom || '') === reference.atom) || null;
  }

  function pointName(reference) {
    const entry = structures.find(item => item.id === reference.entryId);
    return (entry ? displayName(entry) : 'Missing model') + ' · ' + (reference.chain || '—') + ':' + reference.resi + ' ' + (reference.atom || 'atom');
  }

  function measurementValue(record) {
    const points = record.points.map(resolvePoint);
    if (points.some(point => !point)) return null;
    const vector = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
    const length = value => Math.hypot(...value);
    if (record.type === 'distance') return length(vector(points[0], points[1]));
    const a = vector(points[0], points[1]); const b = vector(points[2], points[1]);
    const cosine = a.reduce((sum, value, index) => sum + value * b[index], 0) / Math.max(1e-9, length(a) * length(b));
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }

  function measurementText(record) {
    const value = measurementValue(record);
    return value === null ? '—' : value.toFixed(2) + (record.type === 'distance' ? ' Å' : '°');
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }

  function drawMeasurements(target, shownIds, scale = 1) {
    measurementRecords.forEach(record => {
      if (!record.points.every(point => shownIds.has(point.entryId))) return;
      const points = record.points.map(resolvePoint);
      if (points.some(point => !point)) return;
      const line = (start, end) => target.addLine({ start, end, color: '#e11d48', dashed: true, linewidth: 2 });
      line(points[0], points[1]);
      if (record.type === 'angle') line(points[1], points[2]);
      target.addLabel(measurementText(record), labelStyle(record.type === 'angle' ? points[1] : midpoint(points[0], points[1]), { scale }));
    });
  }

