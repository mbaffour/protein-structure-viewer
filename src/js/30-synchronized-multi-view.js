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

  function caPairs(reference, target) {
    return root.querySelector('#gpv-alignment-mode').value === 'sequence' ? sequencePairs(reference, target) : identifierPairs(reference, target);
  }

  function determinant3(matrix) {
    return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
      - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
      + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  }

  function alignEntry(reference, target) {
    const pairing = caPairs(reference, target);
    const pairs = pairing.pairs;
    if (pairs.length < 3) return null;
    const referencePoints = pairs.map(pair => [pair[0].x, pair[0].y, pair[0].z]);
    const targetPoints = pairs.map(pair => [pair[1].x, pair[1].y, pair[1].z]);
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
    const squaredError = pairs.reduce((sum, pair) => {
      const dx = pair[0].x - pair[1].x;
      const dy = pair[0].y - pair[1].y;
      const dz = pair[0].z - pair[1].z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      target.deviations.set(residueTag(pair[1]), distance);
      const tag = residueTag(pair[0]);
      reference.deviationSamples.set(tag, [...(reference.deviationSamples.get(tag) || []), distance]);
      return sum + dx * dx + dy * dy + dz * dz;
    }, 0);
    return { count: pairs.length, rmsd: Math.sqrt(squaredError / pairs.length), method: pairing.method, identity: pairing.identity, chainPairs: pairing.chainPairs, name: target.name, reference: reference.name };
  }

  function renderAlignmentResults() {
    const wrap = root.querySelector('#gpv-alignment-wrap');
    wrap.hidden = alignmentResults.length === 0;
    root.querySelector('#gpv-alignment-csv').disabled = alignmentResults.length === 0;
    root.querySelector('#gpv-rmsf-csv').disabled = !ensembleSpread;
    const body = root.querySelector('#gpv-alignment-results');
    body.replaceChildren();
    alignmentResults.forEach(result => {
      const row = document.createElement('tr');
      const values = [result.name, result.reference, String(result.count), result.identity === null ? '—' : (result.identity * 100).toFixed(1) + '%', result.rmsd.toFixed(3), result.method + (result.chainPairs ? ' · ' + result.chainPairs : '')];
      values.forEach((value, index) => {
        const cell = document.createElement(index < 2 ? 'th' : 'td');
        cell.textContent = value;
        if (index >= 2 && index <= 4) cell.className = 'text-end';
        row.append(cell);
      });
      body.append(row);
    });
  }

  function downloadAlignmentCsv() {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['model', 'reference', 'ca_pairs', 'sequence_identity', 'rmsd_angstrom', 'mapping', 'chain_pairs']];
    alignmentResults.forEach(result => rows.push([result.name, result.reference, result.count, result.identity === null ? '' : result.identity, result.rmsd, result.method, result.chainPairs || '']));
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
    reference.deviationSamples = new Map();
    targets.forEach(entry => {
      if (entry !== reference) {
        const result = alignEntry(reference, entry);
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
      announce('Aligned ' + results.length + ' model' + (results.length === 1 ? '' : 's') + ' · mean Cα RMSD ' + averageRmsd.toFixed(2) + ' Å' + (identities.length ? ' · mean identity ' + (mean(identities) * 100).toFixed(1) + '%' : ''));
    } else announce('No model had at least three matching Cα atoms to align on', 'error');
  }

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
      figureLabels: { ...figureLabels },
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
      labels: labelRecords.filter(kept).map(label => ({ model: nameOf(label.entryId), chain: label.chain, resi: label.resi, atom: label.atom, text: label.text, color: label.color, size: label.size })),
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

