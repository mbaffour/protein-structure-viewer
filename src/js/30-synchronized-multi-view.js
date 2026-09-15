  /* ---------- Synchronized multi-view ---------- */

  /* Up to three panels sit in one row; four make a 2 × 2 grid; five or six use three columns. */
  function panelColumns(total) {
    return total <= 3 ? total : total <= 4 ? 2 : 3;
  }

  function panelViewers() {
    return [viewer, ...comparePanels.filter(panel => panel.viewer).map(panel => panel.viewer)];
  }

  function panelNames() {
    return comparePanels.map(panel => (entryById(panel.entryId) || {}).name).filter(Boolean);
  }

  function legacyPanelNames(state) {
    if (Array.isArray(state.comparePanels)) return state.comparePanels;
    return state.rightModel ? [state.rightModel] : [];
  }

  /* Rotation-only sync keeps each panel's own centre and zoom (view[0..3]) and
     shares just the quaternion, so assemblies of very different size stay framed. */
  function copyView(source, target) {
    if (typeof source.getView !== 'function' || typeof target.setView !== 'function') return;
    const from = source.getView();
    if (root.querySelector('#gpv-sync-mode').value === 'full') { target.setView(from); return; }
    const own = target.getView();
    target.setView([own[0], own[1], own[2], own[3], from[4], from[5], from[6], from[7]]);
  }

  const lastViews = new Map();

  function sameView(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 1e-9) return false;
    return true;
  }

  function seedViews() {
    panelViewers().forEach(target => { if (typeof target.getView === 'function') lastViews.set(target, target.getView()); });
  }

  function syncViewsFrom(source) {
    if (!root.querySelector('#gpv-side-by-side').checked) return;
    syncingView = true;
    panelViewers().forEach(target => { if (target !== source) copyView(source, target); });
    seedViews();
    syncingView = false;
  }

  /* 3Dmol redraws drags, wheel zooms, and spins through an internal path that
     bypasses its state-change callback, so the panels are kept in step by
     watching every camera once per frame instead. */
  function syncTick() {
    compareSyncFrame = 0;
    const viewers = panelViewers();
    if (viewers.length < 2 || !root.querySelector('#gpv-side-by-side').checked) { lastViews.clear(); return; }
    const changed = viewers.find(target => typeof target.getView === 'function' && !sameView(lastViews.get(target), target.getView()));
    if (changed) syncViewsFrom(changed);
    compareSyncFrame = requestAnimationFrame(syncTick);
  }

  function ensureSyncLoop() {
    if (compareSyncFrame || !root.querySelector('#gpv-side-by-side').checked || !comparePanels.some(panel => panel.viewer)) return;
    compareSyncFrame = requestAnimationFrame(syncTick);
  }

  function newPanel(entryId) {
    return { id: nextPanelId++, entryId, element: null, stage: null, label: null, viewer: null, model: null, observer: null };
  }

  function defaultPanelEntry() {
    const taken = new Set([Number(root.querySelector('#gpv-left-model').value), ...comparePanels.map(panel => panel.entryId)]);
    return structures.find(entry => !taken.has(entry.id)) || structures[structures.length - 1] || null;
  }

  function addComparePanel(entryId = null) {
    if (comparePanels.length >= maxComparePanels || !structures.length) return null;
    const entry = entryId === null ? defaultPanelEntry() : entryById(entryId);
    if (!entry) return null;
    const panel = newPanel(entry.id);
    comparePanels.push(panel);
    root.querySelector('#gpv-side-by-side').checked = true;
    renderPanelControls();
    applyStyle();
    return panel;
  }

  function destroyPanelViewer(panel) {
    if (panel.observer) { panel.observer.disconnect(); panel.observer = null; }
    if (panel.viewer) lastViews.delete(panel.viewer);
    if (panel.element) {
      const canvas = panel.element.querySelector('canvas');
      const context = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
      const lose = context && context.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      panel.element.remove();
    }
    panel.element = null; panel.stage = null; panel.label = null; panel.viewer = null; panel.model = null;
  }

  function removeComparePanel(id) {
    const panel = comparePanels.find(item => item.id === id);
    if (!panel) return;
    destroyPanelViewer(panel);
    comparePanels = comparePanels.filter(item => item.id !== id);
    renderPanelControls();
    applyStyle();
  }

  function clearComparePanels() {
    comparePanels.forEach(destroyPanelViewer);
    comparePanels = [];
    renderPanelControls();
  }

  function setComparePanels(entries) {
    clearComparePanels();
    entries.slice(0, maxComparePanels).forEach(entry => comparePanels.push(newPanel(entry.id)));
    renderPanelControls();
  }

  function renderPanelControls() {
    const list = root.querySelector('#gpv-compare-panels');
    list.replaceChildren();
    comparePanels.forEach((panel, index) => {
      if (structures.length && !structures.some(entry => entry.id === panel.entryId)) panel.entryId = structures[0].id;
      const row = document.createElement('div'); row.className = 'gpv-entry gpv-panel-row';
      const name = document.createElement('span'); name.className = 'gpv-entry-score'; name.textContent = 'Panel ' + (index + 2);
      const select = document.createElement('select'); select.className = 'form-select'; select.setAttribute('aria-label', 'Model shown in panel ' + (index + 2));
      structures.forEach(entry => select.append(new Option((entry.collection ? entry.collection + ' › ' : '') + displayName(entry), String(entry.id))));
      select.value = String(panel.entryId);
      select.disabled = !structures.length;
      select.addEventListener('change', () => {
        panel.entryId = Number(select.value);
        renderComparePanels();
        updateStatus('Panel ' + (index + 2) + ' shows ' + ((entryById(panel.entryId) || {}).name || 'nothing'));
      });
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { removeComparePanel(panel.id); updateStatus('Panel removed'); });
      row.append(name, select, remove);
      list.append(row);
    });
    root.querySelector('#gpv-add-panel').disabled = !structures.length || comparePanels.length >= maxComparePanels;
    root.querySelector('#gpv-clear-panels').disabled = !comparePanels.length;
  }

  function ensurePanelViewer(panel, index) {
    if (panel.viewer) return panel.viewer;
    const pane = document.createElement('div'); pane.className = 'gpv-view-pane';
    const label = document.createElement('span'); label.className = 'viz-badge gpv-view-label';
    const stage = document.createElement('div');
    stage.className = 'card gpv-stage gpv-stage-compare';
    stage.setAttribute('role', 'application');
    stage.setAttribute('aria-label', 'Synchronized comparison viewport ' + (index + 2) + '. Drag to rotate every panel.');
    stage.tabIndex = 0;
    /* The first comparison stage keeps its historical id; the test suite addresses it. */
    if (index === 0) stage.id = 'gpv-stage-compare';
    pane.append(label, stage);
    root.querySelector('#gpv-view-grid').append(pane);
    panel.element = pane; panel.stage = stage; panel.label = label;
    panel.viewer = $3Dmol.createViewer(stage, viewerOptions());
    applyViewStyle(panel.viewer);
    panel.observer = new ResizeObserver(() => { if (panel.viewer) panel.viewer.resize(); });
    panel.observer.observe(stage);
    return panel.viewer;
  }

  function renderComparePanels() {
    const grid = root.querySelector('#gpv-view-grid');
    const enabled = root.querySelector('#gpv-side-by-side').checked && structures.length > 0 && comparePanels.length > 0;
    const label = root.querySelector('#gpv-left-label');
    label.hidden = !enabled;
    grid.classList.toggle('is-comparing', enabled);
    grid.style.setProperty('--gpv-columns', String(panelColumns(1 + comparePanels.length)));
    grid.dataset.panes = String(enabled ? 1 + comparePanels.length : 1);
    if (!enabled) { comparePanels.forEach(destroyPanelViewer); return; }
    const primary = activeEntry();
    label.textContent = primary ? displayName(primary) : 'Primary';
    label.title = primary ? primary.name : '';
    const shown = new Set(displayedEntries());
    const broken = [];
    comparePanels.forEach((panel, index) => {
      const target = entryById(panel.entryId);
      const secondary = ensurePanelViewer(panel, index);
      secondary.removeAllModels(); secondary.removeAllLabels(); secondary.removeAllShapes();
      panel.label.textContent = target ? displayName(target) : 'Empty panel';
      panel.label.title = target ? target.name : '';
      if (!target) return;
      /* Without this, a lazily-loaded model has no atoms of its own and the clone
         silently shows unaligned, unstyled coordinates. */
      if (!target.model) {
        try { materializeEntry(target); if (!shown.has(target)) target.model.setStyle({}, {}); }
        catch (error) { broken.push(error.message); return; }
      }
      if (typeof secondary.removeAllSurfaces === 'function') secondary.removeAllSurfaces();
      panel.model = secondary.addModel(target.text, target.format);
      panel.model.selectedAtoms({}).forEach((atom, atomIndex) => {
        const source = target.atoms[atomIndex];
        if (source) { atom.x = source.x; atom.y = source.y; atom.z = source.z; }
      });
      applyModelStyle(panel.model, target, secondary);
      drawOverlays(secondary, new Set([target.id]), { width: panel.stage.clientWidth, height: panel.stage.clientHeight }, false);
      const background = backgroundSpec();
      secondary.setBackgroundColor(background.color, background.alpha);
      if (typeof secondary.setProjection === 'function') secondary.setProjection(root.querySelector('#gpv-projection').value);
      secondary.zoomTo();
      copyView(viewer, secondary);
      secondary.render();
    });
    if (broken.length) showImportErrors(broken);
    seedViews();
    ensureSyncLoop();
    setTimeout(() => { panelViewers().forEach(target => target.resize()); seedViews(); }, 0);
  }

  /* zoomTo() with no selection frames every model the viewer holds, including
     ones styled invisible while comparing; frame only what is displayed. */
  function fitPrimary() {
    const shown = displayedEntries().filter(entry => entry.model);
    if (shown.length) viewer.zoomTo({ model: shown.map(entry => entry.model.getID()) }); else viewer.zoomTo();
  }

  function fitAllViews() {
    fitPrimary(); viewer.render();
    comparePanels.forEach(panel => { if (panel.viewer) { panel.viewer.zoomTo(); panel.viewer.render(); } });
    syncViewsFrom(viewer);
  }

  function restoreCoordinates(shouldRender = true) {
    structures.forEach(entry => { entry.deviations = null; });
    ensembleSpread = null;
    structures.filter(entry => entry.model).forEach(entry => entry.atoms.forEach((atom, index) => {
      const original = entry.originalAtoms[index];
      /* originalAtoms is cleared when a model is released to reclaim memory. */
      if (!original) return;
      atom.x = original.x;
      atom.y = original.y;
      atom.z = original.z;
    }));
    if (shouldRender) {
      alignmentResults = [];
      renderAlignmentResults();
      applyStyle();
      fitPrimary();
      viewer.render();
      updateStatus('Original coordinates restored');
    }
  }

  function centroid(points) {
    const total = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0]);
    return total.map(value => value / points.length);
  }

  function identifierPairs(reference, target) {
    const referenceMap = new Map(reference.atoms.filter(atom => atom.atom === 'CA').map(atom => [(atom.chain || '') + '|' + atom.resi, atom]));
    const pairs = target.atoms.filter(atom => atom.atom === 'CA' && referenceMap.has((atom.chain || '') + '|' + atom.resi)).map(atom => [referenceMap.get((atom.chain || '') + '|' + atom.resi), atom]);
    return { pairs, method: 'chain/residue IDs', identity: null, chainPairs: null };
  }

  const aminoAcids = {
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
    LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
    SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z'
  };

  function residueChains(entry) {
    const chains = new Map();
    entry.atoms.filter(atom => atom.atom === 'CA').forEach(atom => {
      const chain = atom.chain || '';
      if (!chains.has(chain)) chains.set(chain, []);
      chains.get(chain).push({ atom, letter: aminoAcids[String(atom.resn || '').toUpperCase()] || 'X' });
    });
    return chains;
  }

  function alignSequences(referenceResidues, targetResidues) {
    const rows = referenceResidues.length + 1;
    const columns = targetResidues.length + 1;
    const scores = Array.from({ length: rows }, () => new Int32Array(columns));
    const trace = Array.from({ length: rows }, () => new Uint8Array(columns));
    for (let i = 1; i < rows; i += 1) { scores[i][0] = -2 * i; trace[i][0] = 1; }
    for (let j = 1; j < columns; j += 1) { scores[0][j] = -2 * j; trace[0][j] = 2; }
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < columns; j += 1) {
        const diagonal = scores[i - 1][j - 1] + (referenceResidues[i - 1].letter === targetResidues[j - 1].letter ? 2 : -1);
        const up = scores[i - 1][j] - 2;
        const left = scores[i][j - 1] - 2;
        const best = Math.max(diagonal, up, left);
        scores[i][j] = best;
        trace[i][j] = best === diagonal ? 0 : best === up ? 1 : 2;
      }
    }
    let i = referenceResidues.length;
    let j = targetResidues.length;
    const pairs = [];
    let matches = 0;
    while (i > 0 || j > 0) {
      const direction = trace[i][j];
      if (i > 0 && j > 0 && direction === 0) {
        const referenceResidue = referenceResidues[i - 1];
        const targetResidue = targetResidues[j - 1];
        pairs.push([referenceResidue.atom, targetResidue.atom]);
        if (referenceResidue.letter === targetResidue.letter) matches += 1;
        i -= 1;
        j -= 1;
      } else if (i > 0 && (j === 0 || direction === 1)) i -= 1;
      else j -= 1;
    }
    pairs.reverse();
    return { pairs, identity: pairs.length ? matches / pairs.length : 0, score: scores[rows - 1][columns - 1] };
  }

  function sequencePairs(reference, target) {
    const referenceChains = residueChains(reference);
    const targetChains = residueChains(target);
    const candidates = [];
    referenceChains.forEach((referenceResidues, referenceChain) => {
      targetChains.forEach((targetResidues, targetChain) => {
        const alignment = alignSequences(referenceResidues, targetResidues);
        candidates.push({ referenceChain, targetChain, ...alignment });
      });
    });
    candidates.sort((a, b) => (b.identity - a.identity) || (b.pairs.length - a.pairs.length) || (b.score - a.score));
    const usedReference = new Set();
    const usedTarget = new Set();
    const selected = [];
    candidates.forEach(candidate => {
      if (!usedReference.has(candidate.referenceChain) && !usedTarget.has(candidate.targetChain)) {
        usedReference.add(candidate.referenceChain);
        usedTarget.add(candidate.targetChain);
        selected.push(candidate);
      }
    });
    const pairs = selected.flatMap(candidate => candidate.pairs);
    const matches = selected.reduce((sum, candidate) => sum + Math.round(candidate.identity * candidate.pairs.length), 0);
    return {
      pairs,
      method: 'global sequence alignment',
      identity: pairs.length ? matches / pairs.length : 0,
      chainPairs: selected.map(candidate => (candidate.referenceChain || '—') + '→' + (candidate.targetChain || '—')).join('; ')
    };
  }

  /* Matching identical chains by where they sit.
     In an assembly of identical subunits every chain pair scores the same identity, so pairing by
     sequence alone is arbitrary: a prediction that places the same subunit in a different position
     is then compared against the wrong copy and the RMSD means nothing. After a first fit this
     re-pairs chains of identical sequence by the distance between their centroids — nearest first,
     each chain used once — and the superposition is computed again from the new pairing. Greedy,
     not optimal: with subunits closer to each other than to their partners it can still choose
     badly, which is why it is an option and the chain mapping is printed in the results. */
  function positionalPairs(reference, target) {
    const referenceChains = residueChains(reference);
    const targetChains = residueChains(target);
    const centroidOf = residues => {
      const total = residues.length || 1;
      return residues.reduce((sum, residue) => ({ x: sum.x + residue.atom.x / total, y: sum.y + residue.atom.y / total, z: sum.z + residue.atom.z / total }), { x: 0, y: 0, z: 0 });
    };
    const referenceList = [...referenceChains].map(([chain, residues]) => ({ chain, residues, sequence: residues.map(residue => residue.letter).join(''), centre: centroidOf(residues) }));
    const targetList = [...targetChains].map(([chain, residues]) => ({ chain, residues, sequence: residues.map(residue => residue.letter).join(''), centre: centroidOf(residues) }));
    const candidates = [];
    referenceList.forEach(left => targetList.forEach(right => {
      candidates.push({ left, right, same: left.sequence === right.sequence, distance: Math.hypot(left.centre.x - right.centre.x, left.centre.y - right.centre.y, left.centre.z - right.centre.z) });
    }));
    candidates.sort((a, b) => (Number(b.same) - Number(a.same)) || (a.distance - b.distance));
    const usedReference = new Set(); const usedTarget = new Set(); const selected = [];
    candidates.forEach(candidate => {
      if (usedReference.has(candidate.left.chain) || usedTarget.has(candidate.right.chain)) return;
      usedReference.add(candidate.left.chain); usedTarget.add(candidate.right.chain);
      selected.push(candidate);
    });
    const aligned = selected.map(candidate => ({ referenceChain: candidate.left.chain, targetChain: candidate.right.chain, ...alignSequences(candidate.left.residues, candidate.right.residues) }));
    const pairs = aligned.flatMap(candidate => candidate.pairs);
    const matches = aligned.reduce((sum, candidate) => sum + Math.round(candidate.identity * candidate.pairs.length), 0);
    return {
      pairs,
      method: 'sequence alignment with chains matched by position',
      identity: pairs.length ? matches / pairs.length : 0,
      chainPairs: aligned.map(candidate => (candidate.referenceChain || '—') + '→' + (candidate.targetChain || '—')).join('; ')
    };
  }

  function caPairs(reference, target) {
    return root.querySelector('#gpv-alignment-mode').value === 'sequence' ? sequencePairs(reference, target) : identifierPairs(reference, target);
  }

  /* Fitting on part of the structure. The superposition is computed from the residues of the
     chosen region only — a chain, a residue range, or whatever is selected — while the RMSD is
     reported both over that region and over every matched Cα. That difference is the measurement:
     "0.4 Å over the core, 6.8 Å overall" is how a hinge or a domain shift is shown. */
  function parseFitRegion(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    const parts = value.split(':');
    const named = parts.length > 1;
    const chain = named ? parts[0].trim() : (/^[A-Za-z][A-Za-z0-9]{0,3}$/.test(value) ? value : '');
    const rangeText = named ? parts.slice(1).join(':').trim() : (chain ? '' : value);
    const residues = rangeText ? new Set(parseResidueRange(rangeText)) : null;
    if (chain && !rangeText) return { chain, residues: null, label: 'chain ' + chain };
    if (!residues || !residues.size) return null;
    return { chain, residues, label: (chain ? 'chain ' + chain + ' ' : '') + 'residues ' + rangeText };
  }
  function fitMatcher() {
    const scope = root.querySelector('#gpv-fit-scope').value;
    if (scope === 'selection') {
      const records = selectionRecords.filter(record => record.action !== 'hide' && record.residues.length);
      if (!records.length) return null;
      const byChain = new Map();
      records.forEach(record => {
        const key = record.chain || '';
        if (!byChain.has(key)) byChain.set(key, new Set());
        record.residues.forEach(resi => byChain.get(key).add(resi));
      });
      const anyChain = byChain.get('');
      return { label: 'the selected residues', test: atom => Boolean((anyChain && anyChain.has(atom.resi)) || (byChain.get(atom.chain || '') || new Set()).has(atom.resi)) };
    }
    if (scope !== 'region') return null;
    const region = parseFitRegion(root.querySelector('#gpv-fit-region').value);
    if (!region) return null;
    return { label: region.label, test: atom => (!region.chain || (atom.chain || '') === region.chain) && (!region.residues || region.residues.has(atom.resi)) };
  }
  function renderFitControls() {
    const scope = root.querySelector('#gpv-fit-scope').value;
    const input = root.querySelector('#gpv-fit-region');
    input.disabled = scope !== 'region';
    const state = root.querySelector('#gpv-fit-state');
    if (scope === 'all') { state.textContent = 'The superposition uses every residue that matches between the models.'; return; }
    const matcher = fitMatcher();
    state.textContent = matcher
      ? 'Fitting on ' + matcher.label + ' · the table reports the RMSD over that region and over everything matched.'
      : scope === 'selection' ? 'No residues are selected — add a selection in Annotate, or fit on all residues.' : 'Give a chain or a range: A, A:20-140, or 20-140.';
  }

  function determinant3(matrix) {
    return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
      - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
      + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  }

  function alignEntry(reference, target, matcher = null, pairingOverride = null) {
    const pairing = pairingOverride || caPairs(reference, target);
    const pairs = pairing.pairs;
    if (pairs.length < 3) return null;
    /* Fit on the region when enough of it matched; otherwise fall back to every pair and say so. */
    const region = matcher ? pairs.filter(pair => matcher.test(pair[0])) : [];
    const fitPairs = region.length >= 3 ? region : pairs;
    const fitRegion = matcher ? (region.length >= 3 ? matcher.label : matcher.label + ' (too few matched — fitted on all)') : null;
    const referencePoints = fitPairs.map(pair => [pair[0].x, pair[0].y, pair[0].z]);
    const targetPoints = fitPairs.map(pair => [pair[1].x, pair[1].y, pair[1].z]);
    const referenceCenter = centroid(referencePoints);
    const targetCenter = centroid(targetPoints);
    const x = targetPoints.map(point => point.map((value, axis) => value - targetCenter[axis]));
    const y = referencePoints.map(point => point.map((value, axis) => value - referenceCenter[axis]));
    const svd = numeric.svd(numeric.dot(numeric.transpose(x), y));
    let rotation = numeric.dot(svd.V, numeric.transpose(svd.U));
    if (determinant3(rotation) < 0) {
      svd.V.forEach(row => { row[2] *= -1; });
      rotation = numeric.dot(svd.V, numeric.transpose(svd.U));
    }
    target.atoms.forEach(atom => {
      const centered = [atom.x - targetCenter[0], atom.y - targetCenter[1], atom.z - targetCenter[2]];
      const transformed = numeric.dot(rotation, centered);
      atom.x = transformed[0] + referenceCenter[0];
      atom.y = transformed[1] + referenceCenter[1];
      atom.z = transformed[2] + referenceCenter[2];
    });
    target.deviations = new Map();
    if (!reference.deviationSamples) reference.deviationSamples = new Map();
    const fitSet = fitPairs === pairs ? null : new Set(fitPairs.map(pair => pair[1]));
    let fitSquaredError = 0;
    const squaredError = pairs.reduce((sum, pair) => {
      const dx = pair[0].x - pair[1].x;
      const dy = pair[0].y - pair[1].y;
      const dz = pair[0].z - pair[1].z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      target.deviations.set(residueTag(pair[1]), distance);
      const tag = residueTag(pair[0]);
      reference.deviationSamples.set(tag, [...(reference.deviationSamples.get(tag) || []), distance]);
      if (!fitSet || fitSet.has(pair[1])) fitSquaredError += dx * dx + dy * dy + dz * dz;
      return sum + dx * dx + dy * dy + dz * dz;
    }, 0);
    return {
      count: pairs.length, rmsd: Math.sqrt(squaredError / pairs.length),
      fitCount: fitPairs.length, fitRmsd: Math.sqrt(fitSquaredError / fitPairs.length), fitRegion,
      method: pairing.method, identity: pairing.identity, chainPairs: pairing.chainPairs, name: target.name, reference: reference.name
    };
  }

  function renderAlignmentResults() {
    const wrap = root.querySelector('#gpv-alignment-wrap');
    wrap.hidden = alignmentResults.length === 0;
    root.querySelector('#gpv-alignment-csv').disabled = alignmentResults.length === 0;
    root.querySelector('#gpv-rmsf-csv').disabled = !ensembleSpread;
    root.querySelector('#gpv-rmsf-svg').disabled = !ensembleSpread; root.querySelector('#gpv-rmsf-png').disabled = !ensembleSpread;
    const body = root.querySelector('#gpv-alignment-results');
    body.replaceChildren();
    alignmentResults.forEach(result => {
      const row = document.createElement('tr');
      const values = [result.name, result.reference, String(result.count), result.identity === null ? '—' : (result.identity * 100).toFixed(1) + '%', result.rmsd.toFixed(3), result.fitRegion ? result.fitRegion + ' · ' + result.fitCount + ' Cα' : 'all matched', result.fitRmsd.toFixed(3), result.method + (result.chainPairs ? ' · ' + result.chainPairs : '')];
      values.forEach((value, index) => {
        const cell = document.createElement(index < 2 ? 'th' : 'td');
        cell.textContent = value;
        if ((index >= 2 && index <= 4) || index === 6) cell.className = 'text-end';
        row.append(cell);
      });
      body.append(row);
    });
  }

  function downloadAlignmentCsv() {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['model', 'reference', 'ca_pairs', 'sequence_identity', 'rmsd_angstrom', 'fitted_on', 'fit_ca_pairs', 'fit_rmsd_angstrom', 'mapping', 'chain_pairs']];
    alignmentResults.forEach(result => rows.push([result.name, result.reference, result.count, result.identity === null ? '' : result.identity, result.rmsd, result.fitRegion || 'all matched', result.fitCount, result.fitRmsd, result.method, result.chainPairs || '']));
    downloadBlob(rows.map(row => row.map(quote).join(',')).join('\n'), 'text/csv', 'protein-alignment-results.csv');
    updateStatus('Alignment CSV downloaded');
  }

  function alignVisible() {
    if (typeof numeric === 'undefined' || typeof numeric.svd !== 'function') {
      announce('Alignment needs the numeric.js library, which did not load. Reload the page and try again.', 'error');
      return;
    }
    const referenceId = Number(root.querySelector('#gpv-reference').value);
    const reference = entryById(referenceId);
    if (!reference) return;
    const done = setBusy('Aligning…');
    const failures = [];
    const ready = entry => {
      try { materializeEntry(entry); return true; }
      catch (error) { failures.push(error.message); entry.visible = false; return false; }
    };
    if (!ready(reference)) { done(); showImportErrors(failures); announce('The reference model could not be read', 'error'); return; }
    const targets = visibleEntries().filter(ready);
    restoreCoordinates(false);
    const results = [];
    const matcher = fitMatcher();
    reference.deviationSamples = new Map();
    const byPosition = root.querySelector('#gpv-chain-position').checked;
    targets.forEach(entry => {
      if (entry !== reference) {
        let result = alignEntry(reference, entry, matcher);
        /* Second pass: with the models roughly on top of each other, re-pair identical chains by
           position and fit again. Kept only when it actually brings the models closer. */
        if (result && byPosition) {
          const repaired = alignEntry(reference, entry, matcher, positionalPairs(reference, entry));
          if (repaired && repaired.rmsd <= result.rmsd) result = repaired;
        }
        if (result) results.push(result);
      }
    });
    /* The reference is coloured by its mean deviation across the aligned models. */
    reference.deviations = new Map([...reference.deviationSamples].map(([tag, list]) => [tag, mean(list)]));
    ensembleSpread = ensembleAgreement([reference, ...targets.filter(entry => entry !== reference && results.some(result => result.name === entry.name))]);
    reference.deviationSamples = null;
    done();
    showImportErrors(failures);
    alignmentResults = results;
    renderAlignmentResults();
    applyStyle();
    fitPrimary();
    viewer.render();
    if (results.length) {
      const averageRmsd = mean(results.map(result => result.rmsd));
      const identities = results.map(result => result.identity).filter(value => value !== null);
      announce('Aligned ' + results.length + ' model' + (results.length === 1 ? '' : 's') + (results[0].fitRegion ? ' on ' + results[0].fitRegion + ' · mean fitted RMSD ' + mean(results.map(result => result.fitRmsd)).toFixed(2) + ' Å' : '') + ' · mean Cα RMSD ' + averageRmsd.toFixed(2) + ' Å over all matched pairs' + (identities.length ? ' · mean identity ' + (mean(identities) * 100).toFixed(1) + '%' : ''));
    } else announce('No model had at least three matching Cα atoms to align on', 'error');
  }

  /* ---- Pairwise RMSD matrix ----
     Every shown model superposed onto every other with the same pairing rules as Align visible —
     residue mapping, fit region, positional chain matching — without moving anything on screen.
     The matrix says which models of an ensemble agree and which is the odd one out; the figure
     panel is the small heat map every ensemble paper carries. */
  let rmsdMatrix = null;
  function kabschFit(pairs) {
    if (pairs.length < 3) return null;
    const referencePoints = pairs.map(pair => [pair[0].x, pair[0].y, pair[0].z]);
    const targetPoints = pairs.map(pair => [pair[1].x, pair[1].y, pair[1].z]);
    const referenceCenter = centroid(referencePoints); const targetCenter = centroid(targetPoints);
    const x = targetPoints.map(point => point.map((value, axis) => value - targetCenter[axis]));
    const y = referencePoints.map(point => point.map((value, axis) => value - referenceCenter[axis]));
    const svd = numeric.svd(numeric.dot(numeric.transpose(x), y));
    let rotation = numeric.dot(svd.V, numeric.transpose(svd.U));
    if (determinant3(rotation) < 0) { svd.V.forEach(row => { row[2] *= -1; }); rotation = numeric.dot(svd.V, numeric.transpose(svd.U)); }
    return { rotation, referenceCenter, targetCenter };
  }
  function movedBy(fit, point) {
    const moved = numeric.dot(fit.rotation, [point.x - fit.targetCenter[0], point.y - fit.targetCenter[1], point.z - fit.targetCenter[2]]);
    return { x: moved[0] + fit.referenceCenter[0], y: moved[1] + fit.referenceCenter[1], z: moved[2] + fit.referenceCenter[2] };
  }
  function rmsdUnder(fit, pairs) {
    let sum = 0;
    pairs.forEach(pair => { const moved = movedBy(fit, pair[1]); sum += (moved.x - pair[0].x) ** 2 + (moved.y - pair[0].y) ** 2 + (moved.z - pair[0].z) ** 2; });
    return Math.sqrt(sum / pairs.length);
  }
  /* RMSD of target on reference under the current Compare settings, leaving both untouched. */
  function pairwiseRmsd(reference, target, matcher, byPosition) {
    const evaluate = pairing => {
      const pairs = pairing.pairs; if (pairs.length < 3) return null;
      const region = matcher ? pairs.filter(pair => matcher.test(pair[0])) : [];
      const fit = kabschFit(region.length >= 3 ? region : pairs); if (!fit) return null;
      return { rmsd: rmsdUnder(fit, pairs), count: pairs.length, fit, mapping: pairing.chainPairs };
    };
    let best = evaluate(caPairs(reference, target));
    if (best && byPosition) {
      /* Re-pair identical chains in the fitted frame, on copies, so nothing on screen moves. */
      const copies = target.atoms.filter(atom => atom.atom === 'CA').map(atom => ({ ...atom, ...movedBy(best.fit, atom) }));
      const again = evaluate(positionalPairs(reference, { atoms: copies }));
      if (again && again.rmsd <= best.rmsd) best = again;
    }
    return best;
  }
  function computeRmsdMatrix() {
    if (typeof numeric === 'undefined' || typeof numeric.svd !== 'function') { announce('The matrix needs the numeric.js library, which did not load. Reload the page and try again.', 'error'); return; }
    const shown = displayedEntries().filter(entry => entry.model);
    if (shown.length < 2) { announce('Show at least two models to build a pairwise RMSD matrix', 'error'); return; }
    if (shown.length > 12) { announce('The pairwise matrix is limited to twelve shown models · hide some first', 'error'); return; }
    const matcher = fitMatcher(); const byPosition = root.querySelector('#gpv-chain-position').checked;
    const done = setBusy('Superposing every pair…');
    try {
      const values = shown.map(() => shown.map(() => 0)); const counts = shown.map(() => shown.map(() => 0)); const mappings = shown.map(() => shown.map(() => ''));
      for (let i = 0; i < shown.length; i += 1) for (let j = i + 1; j < shown.length; j += 1) {
        const result = pairwiseRmsd(shown[i], shown[j], matcher, byPosition);
        values[i][j] = values[j][i] = result ? result.rmsd : NaN;
        counts[i][j] = counts[j][i] = result ? result.count : 0;
        mappings[i][j] = mappings[j][i] = result ? result.mapping || '' : '';
      }
      rmsdMatrix = { names: shown.map(displayName), short: distinguishingNames(shown.map(displayName)), values, counts, mappings, mapping: root.querySelector('#gpv-alignment-mode').value === 'sequence' ? 'sequence' : 'identifier', fitRegion: matcher ? matcher.label : null, byPosition };
    } finally { done(); }
    renderRmsdMatrix();
    if (typeof renderCompositeControls === 'function') renderCompositeControls();
    const finite = rmsdMatrix.values.flat().filter((value, index) => Number.isFinite(value) && index % (shown.length + 1) !== 0);
    announce('Pairwise RMSD matrix · ' + shown.length + ' models · ' + (finite.length ? Math.min(...finite).toFixed(2) + ' to ' + Math.max(...finite).toFixed(2) + ' Å' : 'no pair could be fitted') + (rmsdMatrix.fitRegion ? ' · fitted on ' + rmsdMatrix.fitRegion : '') + (byPosition ? ' · chains matched by position' : ''));
  }
  /* The medoid: the shown model with the lowest mean RMSD to the others — the one an ensemble
     figure should show, and the one to superpose the rest onto. */
  function rmsdMedoid() {
    if (!rmsdMatrix) return null;
    const means = rmsdMatrix.values.map((row, i) => { const others = row.filter((value, j) => j !== i && Number.isFinite(value)); return others.length ? others.reduce((sum, value) => sum + value, 0) / others.length : NaN; });
    let best = -1; means.forEach((value, index) => { if (Number.isFinite(value) && (best < 0 || value < means[best])) best = index; });
    return best < 0 ? null : { index: best, name: rmsdMatrix.names[best], mean: means[best], means };
  }
  function rmsdMatrixMaximum() {
    const finite = rmsdMatrix.values.flat().filter(Number.isFinite);
    return Math.max(0.01, ...finite);
  }
  function renderRmsdMatrix() {
    const wrap = root.querySelector('#gpv-rmsd-matrix-wrap'); const state = root.querySelector('#gpv-rmsd-matrix-state');
    ['#gpv-rmsd-matrix-csv', '#gpv-rmsd-matrix-png', '#gpv-rmsd-matrix-svg'].forEach(selector => { root.querySelector(selector).disabled = !rmsdMatrix; });
    if (!rmsdMatrix) { wrap.hidden = true; state.textContent = 'Show two or more models, then compute. Uses the residue mapping, fit region and chain matching set above.'; return; }
    wrap.hidden = false;
    const head = root.querySelector('#gpv-rmsd-matrix-head'); const body = root.querySelector('#gpv-rmsd-matrix-body'); head.replaceChildren(); body.replaceChildren();
    const headRow = document.createElement('tr'); headRow.append(document.createElement('th'));
    rmsdMatrix.short.forEach((name, index) => { const th = document.createElement('th'); th.className = 'text-end'; th.textContent = name; th.title = rmsdMatrix.names[index]; headRow.append(th); });
    const meanHead = document.createElement('th'); meanHead.className = 'text-end'; meanHead.textContent = 'Mean'; meanHead.title = 'Mean RMSD to the other models; ★ marks the medoid, the model closest to all the others'; headRow.append(meanHead);
    head.append(headRow);
    const maximum = rmsdMatrixMaximum(); const medoid = rmsdMedoid();
    rmsdMatrix.values.forEach((row, i) => {
      const tr = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row'; th.textContent = (medoid && medoid.index === i ? '★ ' : '') + rmsdMatrix.short[i]; th.title = rmsdMatrix.names[i] + (medoid && medoid.index === i ? ' · medoid' : ''); tr.append(th);
      row.forEach((value, j) => {
        const td = document.createElement('td'); td.className = 'text-end';
        if (i === j) td.textContent = '—';
        else if (!Number.isFinite(value)) td.textContent = 'n/a';
        else { td.textContent = value.toFixed(2); td.style.background = gradientColor(dataScales.heat, value / maximum); td.style.color = value / maximum > 0.55 ? '#ffffff' : '#111827'; td.title = rmsdMatrix.counts[i][j] + ' Cα pairs' + (rmsdMatrix.mappings[i][j] ? ' · ' + rmsdMatrix.mappings[i][j] : ''); }
        tr.append(td);
      });
      const meanCell = document.createElement('td'); meanCell.className = 'text-end'; meanCell.style.fontWeight = medoid && medoid.index === i ? '700' : '';
      meanCell.textContent = medoid && Number.isFinite(medoid.means[i]) ? medoid.means[i].toFixed(2) : '—'; tr.append(meanCell);
      body.append(tr);
    });
    root.querySelector('#gpv-rmsd-medoid').disabled = !medoid;
    root.querySelector('#gpv-rmsd-medoid').textContent = medoid ? 'Use ' + rmsdMatrix.short[medoid.index] + ' as reference' : 'Use medoid as reference';
    state.textContent = (medoid ? 'Medoid ' + rmsdMatrix.short[medoid.index] + ' · mean ' + medoid.mean.toFixed(2) + ' Å to the others · ' : '') + rmsdMatrix.names.length + ' models · Cα RMSD after superposing each pair · ' + (rmsdMatrix.mapping === 'sequence' ? 'sequence-aware mapping' : 'chain and residue identifiers') + (rmsdMatrix.fitRegion ? ' · fitted on ' + rmsdMatrix.fitRegion + ', RMSD over all matched pairs' : '') + (rmsdMatrix.byPosition ? ' · identical chains matched by position' : '') + ' · hover a cell for the pair count and chain mapping';
  }
  function downloadRmsdMatrixCsv() {
    if (!rmsdMatrix) return;
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['model', ...rmsdMatrix.names]];
    rmsdMatrix.values.forEach((row, i) => rows.push([rmsdMatrix.names[i], ...row.map((value, j) => (i === j ? 0 : Number.isFinite(value) ? value : ''))]));
    rows.push([]); rows.push(['ca_pairs', ...rmsdMatrix.names]);
    rmsdMatrix.counts.forEach((row, i) => rows.push([rmsdMatrix.names[i], ...row]));
    rows.push([]); rows.push(['settings', 'mapping=' + rmsdMatrix.mapping, 'fitted_on=' + (rmsdMatrix.fitRegion || 'all matched'), 'chains_by_position=' + rmsdMatrix.byPosition]);
    downloadBlob(rows.map(row => row.map(quote).join(',')).join('\n'), 'text/csv', 'protein-rmsd-matrix.csv');
    updateStatus('RMSD matrix CSV downloaded');
  }
  /* The heat map: names down the left and along the top, one coloured square per pair with the
     value inside, a colour bar underneath. Drawn square in a given side length. */
  function rmsdMatrixMetrics(size, scale) {
    const n = rmsdMatrix.names.length; const label = Math.round(Math.min(size * 0.28, 120 * scale)); const bar = Math.round(28 * scale);
    const cell = Math.floor((size - label - bar - Math.round(10 * scale)) / n);
    return { n, label, bar, cell, font: Math.max(8, Math.min(Math.round(13 * scale), Math.round(cell * 0.32))), small: Math.round(10 * scale), gridX: label, gridY: label, width: label + cell * n, height: label + cell * n + bar + Math.round(10 * scale) };
  }
  function drawRmsdMatrix(context, x0, y0, size, scale, palette) {
    const m = rmsdMatrixMetrics(size, scale); const maximum = rmsdMatrixMaximum();
    context.save(); context.textBaseline = 'middle';
    context.font = '500 ' + m.small + 'px ' + figureFont(); context.fillStyle = palette.ink;
    rmsdMatrix.short.forEach((name, i) => {
      const text = truncateToWidth(context, name, m.label - 6 * scale);
      context.textAlign = 'right'; context.fillText(text, x0 + m.gridX - 4 * scale, y0 + m.gridY + i * m.cell + m.cell / 2);
      context.save(); context.translate(x0 + m.gridX + i * m.cell + m.cell / 2, y0 + m.gridY - 4 * scale); context.rotate(-Math.PI / 2); context.textAlign = 'left'; context.fillText(text, 0, 0); context.restore();
    });
    rmsdMatrix.values.forEach((row, i) => row.forEach((value, j) => {
      const x = x0 + m.gridX + j * m.cell; const y = y0 + m.gridY + i * m.cell;
      const tint = i === j ? palette.paper : Number.isFinite(value) ? gradientColor(dataScales.heat, value / maximum) : '#e5e7eb';
      context.fillStyle = tint; context.fillRect(x, y, m.cell, m.cell);
      context.strokeStyle = palette.paper; context.lineWidth = Math.max(1, scale); context.strokeRect(x + 0.5, y + 0.5, m.cell - 1, m.cell - 1);
      if (i !== j) { context.fillStyle = Number.isFinite(value) && value / maximum > 0.55 ? '#ffffff' : '#111827'; context.font = '600 ' + m.font + 'px ' + figureFont(); context.textAlign = 'center'; context.fillText(Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) : 'n/a', x + m.cell / 2, y + m.cell / 2); }
    }));
    const barY = y0 + m.gridY + m.n * m.cell + Math.round(10 * scale); const barW = m.n * m.cell;
    for (let k = 0; k < barW; k += 1) { context.fillStyle = gradientColor(dataScales.heat, k / Math.max(1, barW - 1)); context.fillRect(x0 + m.gridX + k, barY, 1, Math.round(m.bar * 0.45)); }
    context.fillStyle = palette.ink; context.font = '500 ' + m.small + 'px ' + figureFont(); context.textAlign = 'left'; context.fillText('0', x0 + m.gridX, barY + m.bar * 0.8);
    context.textAlign = 'right'; context.fillText(maximum.toFixed(1) + ' Å', x0 + m.gridX + barW, barY + m.bar * 0.8);
    context.textAlign = 'center'; context.fillText('Cα RMSD', x0 + m.gridX + barW / 2, barY + m.bar * 0.8);
    context.restore();
    return m;
  }
  function svgRmsdMatrix(x0, y0, size, scale, palette) {
    const m = rmsdMatrixMetrics(size, scale); const maximum = rmsdMatrixMaximum();
    const text = (x, y, sz, weight, anchor, fill, value, transform) => '<text x="' + f(x) + '" y="' + f(y) + '" dominant-baseline="central" text-anchor="' + anchor + '" font-family="' + svgFont + '" font-size="' + f(sz) + '" font-weight="' + weight + '" fill="' + fill + '"' + (transform ? ' transform="' + transform + '"' : '') + '>' + svgEscape(value) + '</text>';
    const parts = ['<g id="rmsd-matrix">'];
    svgMeasure.font = '500 ' + m.small + 'px ' + svgFont;
    rmsdMatrix.short.forEach((name, i) => {
      const label = truncateToWidth(svgMeasure, name, m.label - 6 * scale);
      parts.push(text(x0 + m.gridX - 4 * scale, y0 + m.gridY + i * m.cell + m.cell / 2, m.small, 500, 'end', palette.ink, label));
      const cx = x0 + m.gridX + i * m.cell + m.cell / 2; const cy = y0 + m.gridY - 4 * scale;
      parts.push(text(cx, cy, m.small, 500, 'start', palette.ink, label, 'rotate(-90 ' + f(cx) + ' ' + f(cy) + ')'));
    });
    rmsdMatrix.values.forEach((row, i) => row.forEach((value, j) => {
      const x = x0 + m.gridX + j * m.cell; const y = y0 + m.gridY + i * m.cell;
      const tint = i === j ? palette.paper : Number.isFinite(value) ? gradientColor(dataScales.heat, value / maximum) : '#e5e7eb';
      parts.push('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(m.cell) + '" height="' + f(m.cell) + '" fill="' + tint + '" stroke="' + palette.paper + '" stroke-width="' + f(Math.max(1, scale)) + '"/>');
      if (i !== j) parts.push(text(x + m.cell / 2, y + m.cell / 2, m.font, 600, 'middle', Number.isFinite(value) && value / maximum > 0.55 ? '#ffffff' : '#111827', Number.isFinite(value) ? value.toFixed(value >= 10 ? 1 : 2) : 'n/a'));
    }));
    const barY = y0 + m.gridY + m.n * m.cell + 10 * scale; const barW = m.n * m.cell; const steps = 24;
    for (let k = 0; k < steps; k += 1) parts.push('<rect x="' + f(x0 + m.gridX + barW * k / steps) + '" y="' + f(barY) + '" width="' + f(barW / steps + 0.5) + '" height="' + f(m.bar * 0.45) + '" fill="' + gradientColor(dataScales.heat, k / (steps - 1)) + '"/>');
    parts.push(text(x0 + m.gridX, barY + m.bar * 0.8, m.small, 500, 'start', palette.ink, '0'));
    parts.push(text(x0 + m.gridX + barW, barY + m.bar * 0.8, m.small, 500, 'end', palette.ink, maximum.toFixed(1) + ' Å'));
    parts.push(text(x0 + m.gridX + barW / 2, barY + m.bar * 0.8, m.small, 500, 'middle', palette.ink, 'Cα RMSD'));
    parts.push('</g>');
    return { markup: parts.join(''), height: m.height };
  }
  async function downloadRmsdMatrix(kind) {
    if (!rmsdMatrix) { announce('Compute the pairwise RMSD matrix first', 'error'); return; }
    const plan = exportDimensions(); const scale = figureScale(plan); const palette = figurePalette(); const pad = Math.round(16 * scale);
    const size = Math.min(plan.width, plan.height) - pad * 2; const m = rmsdMatrixMetrics(size, scale);
    const width = m.width + pad * 2; const height = m.height + pad * 2;
    if (kind === 'png') {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
      context.fillStyle = palette.paper; context.fillRect(0, 0, width, height);
      drawRmsdMatrix(context, pad, pad, size, scale, palette);
      downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), plan.dpi), 'image/png', exportFileName('protein-rmsd-matrix', plan, 'png'));
    } else {
      downloadBlob(svgDocument(width, height, palette.paper, svgRmsdMatrix(pad, pad, size, scale, palette).markup), 'image/svg+xml', 'protein-rmsd-matrix.svg');
    }
    announce('RMSD matrix ' + kind.toUpperCase() + ' downloaded · ' + rmsdMatrix.names.length + ' × ' + rmsdMatrix.names.length + ' · ' + width + ' × ' + height + ' px' + (plan.dpi ? ' at ' + plan.dpi + ' dpi' : ''));
  }
  /* One click: superpose everything onto the medoid and draw it solid against the rest. */
  function useMedoidAsReference() {
    const medoid = rmsdMedoid(); if (!medoid) return;
    const entry = structures.find(item => displayName(item) === medoid.name && item.model);
    if (!entry) { announce('The medoid model is no longer loaded', 'error'); return; }
    const select = root.querySelector('#gpv-reference'); select.value = String(entry.id); select.dispatchEvent(new Event('change', { bubbles: true }));
    alignVisible();
    remember('emphasis');
    structures.filter(item => item.visible && item.model).forEach(item => { item.faded = item !== entry; });
    renderList(); applyStyle(); renderSequenceSoon();
    announce(displayName(entry) + ' is the medoid (mean ' + medoid.mean.toFixed(2) + ' Å to the others) · models superposed onto it and it is drawn solid');
  }
  root.querySelector('#gpv-rmsd-medoid').addEventListener('click', useMedoidAsReference);
  root.querySelector('#gpv-rmsd-matrix-run').addEventListener('click', computeRmsdMatrix);
  root.querySelector('#gpv-rmsd-matrix-csv').addEventListener('click', downloadRmsdMatrixCsv);
  root.querySelector('#gpv-rmsd-matrix-png').addEventListener('click', () => downloadRmsdMatrix('png'));
  root.querySelector('#gpv-rmsd-matrix-svg').addEventListener('click', () => downloadRmsdMatrix('svg'));

  function recordSpinVideo() {
    const canvas = root.querySelector('#gpv-stage canvas');
    if (!canvas || !canvas.captureStream || typeof MediaRecorder === 'undefined') {
      announce('This browser cannot record video from a canvas. Safari in particular does not support it; Chrome and Firefox do.', 'error');
      return;
    }
    if (restoreMotion !== null) return;
    const button = root.querySelector('#gpv-video');
    const duration = Number(root.querySelector('#gpv-video-length').value) || 5;
    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      viewer.spin(false);
      stream.getTracks().forEach(track => track.stop());
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'protein-spin.webm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      button.disabled = structures.length === 0;
      button.textContent = 'Record spin video';
      /* Recording commandeers the viewer's motion; put the user's choice back. */
      if (restoreMotion !== null) { root.querySelector('#gpv-motion').value = restoreMotion; restoreMotion = null; applyMotion(); }
      announce('Spin video downloaded');
    };
    restoreMotion = root.querySelector('#gpv-motion').value;
    stopMotion();
    button.disabled = true;
    button.textContent = 'Recording ' + duration + 's…';
    recorder.start();
    viewer.spin('y', 0.8);
    announce('Recording a ' + duration + ' second spin video…');
    setTimeout(() => recorder.stop(), duration * 1000);
  }

  function rankingAssets(name, data) {
    if (!data || !Array.isArray(data.order)) return [];
    const scoreMaps = [data['iptm+ptm'], data.ranking_confidences, data.plddts].filter(value => value && typeof value === 'object');
    return data.order.map((modelName, rankIndex) => {
      let score = null;
      scoreMaps.some(map => {
        const value = finiteNumber(map[modelName]);
        if (value !== null) { score = value; return true; }
        return false;
      });
      return {
        name,
        modelName,
        rankIndex,
        rank: rankIndex + 1,
        confidence: { rankingScore: score }
      };
    });
  }

  function parseRankingCsv(name, textValue) {
    const rows = textValue.trim().split(/\r?\n/).map(line => line.split(',').map(value => value.trim()));
    if (rows.length < 2) return [];
    const headers = rows[0].map(value => value.toLowerCase());
    const seedIndex = headers.indexOf('seed');
    const sampleIndex = headers.indexOf('sample');
    const scoreIndex = headers.indexOf('ranking_score');
    if (scoreIndex < 0) return [];
    return rows.slice(1).map(row => ({
      name,
      seed: seedIndex >= 0 ? row[seedIndex] : undefined,
      sample: sampleIndex >= 0 ? row[sampleIndex] : undefined,
      confidence: { rankingScore: finiteNumber(row[scoreIndex]) }
    })).sort((a, b) => (b.confidence.rankingScore ?? -Infinity) - (a.confidence.rankingScore ?? -Infinity)).map((asset, index) => ({ ...asset, rank: index + 1 }));
  }

  function registerMetadata(name, textValue, collection = null) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
      const assets = lower.endsWith('.csv') ? parseRankingCsv(name, textValue) : [];
      if (assets.length) { assets.forEach(asset => { asset.collection = collection; }); confidenceAssets.push(...assets); return true; }
      const table = parseResidueTable(textValue);
      if (table) { setResidueData(table, fileStem(name)); return true; }
      return false;
    }
    let data;
    try { data = textValue instanceof Uint8Array ? parseConfidenceBytes(textValue) : JSON.parse(textValue); } catch (error) { return false; }
    if (data && data.type === 'protein-viewer-scene') {
      pendingScene = data;
      return true;
    }
    const ranked = rankingAssets(name, data);
    if (ranked.length) {
      ranked.forEach(asset => { asset.collection = collection; });
      confidenceAssets.push(...ranked);
      return true;
    }
    const confidence = confidenceFromJson(data);
    if (!confidence) return false;
    const useful = Object.values(confidence).some(value => value !== null && value !== false);
    if (!useful) return false;
    confidenceAssets.push({ name, confidence, rank: null, collection });
    return true;
  }

  function provenanceValues() {
    return {
      title: root.querySelector('#gpv-project-title').value.trim(),
      source: root.querySelector('#gpv-project-source').value.trim(),
      method: root.querySelector('#gpv-project-method').value.trim(),
      notes: root.querySelector('#gpv-project-notes').value.trim()
    };
  }

  function nameOf(entryId) {
    return (structures.find(entry => entry.id === entryId) || {}).name;
  }

  function sceneSettings() {
    const active = activeEntry();
    const reference = structures.find(entry => entry.id === Number(root.querySelector('#gpv-reference').value));
    return {
      viewMode: root.querySelector('#gpv-view-mode').value,
      representation: root.querySelector('#gpv-style').value,
      colorMode: root.querySelector('#gpv-color-mode').value,
      modelOrder: root.querySelector('#gpv-order').value,
      alignmentMode: root.querySelector('#gpv-alignment-mode').value,
      alignmentApplied: alignmentResults.length > 0,
      activeModel: active ? active.name : null,
      referenceModel: reference ? reference.name : null,
      allResidueLabels: root.querySelector('#gpv-all-labels').checked,
      projection: root.querySelector('#gpv-projection').value,
      outline: root.querySelector('#gpv-outline').value,
      fog: root.querySelector('#gpv-fog').checked,
      labelStyle: root.querySelector('#gpv-label-style').value,
      legendPosition: root.querySelector('#gpv-legend-position').value,
      chainsByPosition: root.querySelector('#gpv-chain-position').checked,
      fitScope: root.querySelector('#gpv-fit-scope').value,
      fitRegion: root.querySelector('#gpv-fit-region').value,
      figureLabels: { ...figureLabels },
      figureBuilder: builderOptions(),
      background: root.querySelector('#gpv-background').value,
      backgroundColor: root.querySelector('#gpv-background-color').value,
      hideBelow: hideBelow(),
      hetero: root.querySelector('#gpv-hetero').value,
      surface: root.querySelector('#gpv-surface').value,
      sideBySide: root.querySelector('#gpv-side-by-side').checked,
      syncMode: root.querySelector('#gpv-sync-mode').value,
      leftModel: (structures.find(entry => entry.id === Number(root.querySelector('#gpv-left-model').value)) || {}).name || null,
      comparePanels: panelNames(),
      camera: typeof viewer.getView === 'function' ? viewer.getView() : null
    };
  }

  /* Labels, selections, measurements and annotations in scene form. keep() decides
     which models' records are included — share links drop records on local files. */
  function sceneOverlays(keep = () => true) {
    const kept = record => keep(record.entryId);
    const keptPoints = record => record.points.every(point => keep(point.entryId));
    const point = item => ({ model: nameOf(item.entryId), chain: item.chain, resi: item.resi, atom: item.atom, index: item.index });
    return {
      labels: labelRecords.filter(kept).map(label => ({ model: nameOf(label.entryId), chain: label.chain, resi: label.resi, atom: label.atom, text: label.text, color: label.color, size: label.size, ...(label.kind === 'domain' ? { kind: 'domain' } : {}), ...(labelOffsetLength(label) ? { offset: label.offset } : {}) })),
      selections: selectionRecords.filter(kept).map(record => ({ model: nameOf(record.entryId), chain: record.chain, residues: record.residues, action: record.action, color: record.color })),
      measurements: measurementRecords.filter(keptPoints).map(record => ({ type: record.type, points: record.points.map(point) })),
      residueData: residueData && (residueData.scope === 'all' || keep(residueData.entryId)) ? { name: residueData.name, scale: residueData.scale, scope: residueData.scope, model: nameOf(residueData.entryId), rows: [...residueData.values.entries()].map(([key, value]) => [key.split('|')[0], Number(key.split('|')[1]), value]).concat([...residueData.byResi.entries()].map(([resi, value]) => ['', resi, value])) } : null,
      domains: domainRecords.filter(record => record.scope === 'all' || kept(record)).map(record => ({ name: record.name, color: record.color, chain: record.chain, residues: record.residues, scope: record.scope, model: nameOf(record.entryId) })),
      annotations: annotationRecords.filter(keptPoints).map(record => ({ type: record.type, text: record.text, color: record.color, size: record.size, dashed: record.dashed, corner: record.corner, offset: record.offset, distance: record.distance, dx: record.dx, dy: record.dy, points: record.points.map(point) }))
    };
  }

  async function saveScene() {
    const modelRecords = await Promise.all(structures.map(async entry => ({
      name: entry.name,
      sourcePath: entry.sourcePath,
      sha256: entry.hash || await sha256(entry.text),
      visible: entry.visible,
      color: entry.color,
      label: entry.label || '',
      hiddenChains: entry.hiddenChains || [],
      ...(entry.faded ? { faded: true } : {}),
      ...(entry.fetchId ? { fetch: entry.fetchId } : {})
    })));
    const scene = {
      type: 'protein-viewer-scene',
      schemaVersion: 1,
      viewerVersion,
      createdAt: new Date().toISOString(),
      provenance: provenanceValues(),
      confidenceSources: [...new Set(confidenceAssets.map(asset => asset.name))],
      models: modelRecords,
      settings: sceneSettings(),
      ...sceneOverlays(),
      savedViews: savedViews.map(view => ({ ...view }))
    };
    downloadBlob(JSON.stringify(scene, null, 2), 'application/json', 'protein-viewer-scene.json');
    updateStatus('Reproducible scene JSON downloaded');
  }

