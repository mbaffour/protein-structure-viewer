  /* ---------- Share links ---------- */

  /* A scene restricted to models that were fetched by identifier, so the recipient's
     viewer can fetch the same files. Local files never enter a link. */
  function shareableScene() {
    const shared = structures.filter(entry => entry.fetchId);
    if (!shared.length) return null;
    const ids = new Set(shared.map(entry => entry.id));
    const has = name => shared.some(entry => entry.name === name);
    const settings = sceneSettings();
    if (!has(settings.activeModel)) settings.activeModel = shared[0].name;
    if (!has(settings.referenceModel)) settings.referenceModel = null;
    if (!has(settings.leftModel)) settings.leftModel = null;
    settings.comparePanels = settings.comparePanels.filter(has);
    settings.alignmentApplied = settings.alignmentApplied && settings.referenceModel !== null && shared.length > 1;
    return {
      type: 'protein-viewer-scene',
      schemaVersion: 1,
      viewerVersion,
      createdAt: new Date().toISOString(),
      shared: true,
      provenance: provenanceValues(),
      models: shared.map(entry => ({ name: entry.name, fetch: entry.fetchId, visible: entry.visible, color: entry.color, label: entry.label || '', hiddenChains: entry.hiddenChains || [] })),
      settings,
      ...sceneOverlays(entryId => ids.has(entryId)),
      savedViews: savedViews.filter(view => has(view.activeModel) || (view.visibleModels || []).some(has)).map(view => ({
        ...view,
        id: undefined,
        activeModel: has(view.activeModel) ? view.activeModel : shared[0].name,
        visibleModels: (view.visibleModels || []).filter(has),
        colors: Object.fromEntries(Object.entries(view.colors || {}).filter(([name]) => has(name))),
        leftModel: has(view.leftModel) ? view.leftModel : null,
        comparePanels: (view.comparePanels || []).filter(has)
      }))
    };
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  async function packScene(scene) {
    const bytes = new TextEncoder().encode(JSON.stringify(scene));
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z.' + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'j.' + bytesToBase64Url(bytes);
  }

  async function unpackScene(token) {
    const bytes = base64UrlToBytes(token.slice(2));
    if (token.startsWith('z.')) {
      if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot decompress the link');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function copyShareLink() {
    const scene = shareableScene();
    const field = root.querySelector('#gpv-share-url');
    if (!scene) { announce('Fetch a model by ID first — links can only carry models the recipient can fetch too', 'error'); return; }
    const link = location.href.split('#')[0] + '#scene=' + await packScene(scene);
    field.value = link; field.hidden = false;
    const skipped = structures.length - scene.models.length;
    const note = (skipped ? ' · ' + skipped + ' local model' + (skipped === 1 ? '' : 's') + ' not included' : '') + ' · ' + (link.length / 1024).toFixed(1) + ' KB';
    try {
      await navigator.clipboard.writeText(link);
      announce('Share link copied' + note);
    } catch (error) {
      field.focus(); field.select();
      announce('Link ready — copy it from the field' + note);
    }
  }

  async function openSharedScene() {
    const match = location.hash.match(/^#scene=([A-Za-z0-9._-]+)$/);
    if (!match) return;
    let scene;
    try { scene = await unpackScene(match[1]); }
    catch (error) { announce('The shared link could not be read: ' + error.message, 'error'); return; }
    if (!scene || scene.type !== 'protein-viewer-scene' || !Array.isArray(scene.models)) return;
    const done = setBusy('Opening shared scene…');
    const missing = [];
    try {
      for (const record of scene.models) {
        if (!record.fetch || structures.some(entry => entry.name === record.name)) continue;
        try { await fetchIdentifier(String(record.fetch)); }
        catch (error) { missing.push(String(record.fetch)); }
      }
      pendingScene = null;
      await applyScene(scene);
      const loaded = scene.models.length - missing.length;
      announce('Opened a shared scene with ' + loaded + ' model' + (loaded === 1 ? '' : 's') + (missing.length ? ' · could not fetch ' + missing.join(', ') : ''), missing.length ? 'error' : 'info');
    } catch (error) {
      announce('Could not open the shared scene: ' + error.message, 'error');
    } finally {
      done();
    }
  }

  async function applyScene(scene) {
    if (!scene || scene.type !== 'protein-viewer-scene') return;
    clearHistory();
    const byName = new Map(structures.map(entry => [entry.name, entry]));
    let hashWarnings = 0;
    for (const modelRecord of scene.models || []) {
      const entry = byName.get(modelRecord.name);
      if (!entry) continue;
      entry.visible = modelRecord.visible !== false;
      if (/^#[0-9a-f]{6}$/i.test(modelRecord.color || '')) entry.color = modelRecord.color;
      if (typeof modelRecord.label === 'string') entry.label = modelRecord.label.trim().slice(0, 120);
      entry.hiddenChains = Array.isArray(modelRecord.hiddenChains) ? modelRecord.hiddenChains.map(String).slice(0, 200) : [];
      entry.fadedChains = Array.isArray(modelRecord.fadedChains) ? modelRecord.fadedChains.map(String).slice(0, 200) : [];
      if (modelRecord.sha256) {
        const actual = entry.hash || await sha256(entry.text);
        if (actual && actual !== modelRecord.sha256) hashWarnings += 1;
      }
    }
    const settings = scene.settings || {};
    if (['overlay', 'single'].includes(settings.viewMode)) root.querySelector('#gpv-view-mode').value = settings.viewMode;
    if (['cartoon', 'stick', 'sphere', 'line'].includes(settings.representation)) root.querySelector('#gpv-style').value = settings.representation;
    if (['structure', 'chain', 'entity', 'plddt', 'deviation', 'agreement', 'domain', 'annotated', 'data', 'charge', 'hydrophobicity', 'restype', 'amino', 'ss', 'spectrum', 'element'].includes(settings.colorMode)) root.querySelector('#gpv-color-mode').value = settings.colorMode;
    if (['loaded', 'ranking', 'plddt'].includes(settings.modelOrder)) root.querySelector('#gpv-order').value = settings.modelOrder;
    if (['sequence', 'identifier'].includes(settings.alignmentMode)) root.querySelector('#gpv-alignment-mode').value = settings.alignmentMode;
    if (['perspective', 'orthographic'].includes(settings.projection)) root.querySelector('#gpv-projection').value = settings.projection;
    if (['none', 'thin', 'bold'].includes(settings.outline)) root.querySelector('#gpv-outline').value = settings.outline;
    if (typeof settings.fog === 'boolean') root.querySelector('#gpv-fog').checked = settings.fog;
    if (['boxed', 'plain'].includes(settings.labelStyle)) root.querySelector('#gpv-label-style').value = settings.labelStyle;
    setFigureLabels(settings.figureLabels);
    applyBuilderOptions(settings.figureBuilder);
    if ([0, 50, 70].includes(Number(settings.hideBelow))) root.querySelector('#gpv-hide-below').value = String(Number(settings.hideBelow));
    if (['stick', 'sphere', 'hide'].includes(settings.hetero)) root.querySelector('#gpv-hetero').value = settings.hetero;
    if (['none', 'translucent', 'opaque'].includes(settings.surface)) root.querySelector('#gpv-surface').value = settings.surface;
    if (['transparent', 'white', 'dark', 'custom'].includes(settings.background)) root.querySelector('#gpv-background').value = settings.background;
    if (/^#[0-9a-f]{6}$/i.test(settings.backgroundColor || '')) root.querySelector('#gpv-background-color').value = settings.backgroundColor;
    const active = byName.get(settings.activeModel);
    if (active) activeId = active.id;
    const reference = byName.get(settings.referenceModel);
    labelRecords = (scene.labels || []).map(label => {
      const entry = byName.get(label.model);
      if (!entry) return null;
      const atom = entry.atoms.find(item => (item.chain || '') === (label.chain || '') && item.resi === label.resi && (item.atom === label.atom || item.atom === 'CA'));
      if (!atom) return null;
      return { entryId: entry.id, chain: label.chain || '', resi: label.resi, atom: label.atom || 'CA', resn: atom.resn, x: atom.x, y: atom.y, z: atom.z, key: residueKey(entry.id, label.chain, label.resi), ...(label.kind === 'domain' ? { kind: 'domain' } : {}), text: label.text, color: /^#[0-9a-f]{6}$/i.test(label.color || '') ? label.color : undefined, size: labelSizes.some(([value]) => value === Number(label.size)) ? Number(label.size) : undefined };
    }).filter(Boolean);
    selectionRecords = (scene.selections || []).map(record => {
      const entry = byName.get(record.model); if (!entry) return null;
      return { id: nextAnnotationId++, entryId: entry.id, chain: record.chain || '', residues: (record.residues || []).map(Number).filter(Number.isFinite), action: record.action === 'hide' ? 'hide' : 'highlight', color: /^#[0-9a-f]{6}$/i.test(record.color || '') ? record.color : '#f97316' };
    }).filter(Boolean);
    measurementRecords = (scene.measurements || []).map(record => {
      const points = (record.points || []).map(point => { const entry = byName.get(point.model); return entry ? { entryId: entry.id, chain: point.chain || '', resi: point.resi, atom: point.atom || '', index: point.index } : null; }).filter(Boolean);
      return points.length >= 2 ? { id: nextAnnotationId++, type: record.type === 'angle' ? 'angle' : 'distance', points } : null;
    }).filter(Boolean);
    annotationRecords = (scene.annotations || []).map(record => {
      const type = record.type === 'screen' || annotationTools[record.type] ? record.type : null;
      if (!type) return null;
      const points = (record.points || []).map(point => { const entry = byName.get(point.model); return entry ? { entryId: entry.id, chain: point.chain || '', resi: point.resi, atom: point.atom || '', index: point.index } : null; }).filter(Boolean);
      if (type !== 'screen' && points.length < annotationTools[type].points) return null;
      const offset = record.offset && ['x', 'y', 'z'].every(axis => Number.isFinite(Number(record.offset[axis]))) ? { x: Number(record.offset.x), y: Number(record.offset.y), z: Number(record.offset.z) } : { x: 0, y: 0, z: 0 };
      return { id: nextAnnotationId++, type, points, text: String(record.text || ''), color: /^#[0-9a-f]{6}$/i.test(record.color || '') ? record.color : '#f97316', size: Math.min(3, Math.max(0.5, Number(record.size) || 1)), dashed: record.dashed === true, corner: screenCorners.includes(record.corner) ? record.corner : 'top-left', offset, distance: Number.isFinite(Number(record.distance)) ? Number(record.distance) : null, dx: Number(record.dx) || 0, dy: Number(record.dy) || 0 };
    }).filter(Boolean);
    domainRecords = (scene.domains || []).map(record => {
      const entry = byName.get(record.model) || (record.scope === 'all' ? structures[0] : null);
      if (!entry || !record.name) return null;
      const residues = (record.residues || []).map(Number).filter(Number.isFinite);
      if (!residues.length) return null;
      return { id: nextAnnotationId++, entryId: entry.id, name: String(record.name).slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(record.color || '') ? record.color : domainColorFor(domainRecords.length + 1), chain: String(record.chain || ''), residues, scope: ['model', 'source', 'all'].includes(record.scope) ? record.scope : 'source' };
    }).filter(Boolean);
    domainVersion += 1;
    residueData = null;
    if (scene.residueData && Array.isArray(scene.residueData.rows)) {
      const owner = byName.get(scene.residueData.model) || structures[0];
      const table = parseResidueRows(scene.residueData.rows);
      if (owner && table) residueData = { ...table, name: String(scene.residueData.name || 'Values').slice(0, 40), scale: dataScales[scene.residueData.scale] ? scene.residueData.scale : 'viridis', scope: ['model', 'source', 'all'].includes(scene.residueData.scope) ? scene.residueData.scope : 'source', entryId: owner.id };
    }
    renderDataState();
    savedViews = (scene.savedViews || []).map(view => ({ ...view, id: nextAnnotationId++ }));
    root.querySelector('#gpv-all-labels').checked = settings.allResidueLabels === true;
    const provenance = scene.provenance || {};
    root.querySelector('#gpv-project-title').value = provenance.title || '';
    root.querySelector('#gpv-project-source').value = provenance.source || '';
    root.querySelector('#gpv-project-method').value = provenance.method || '';
    root.querySelector('#gpv-project-notes').value = provenance.notes || '';
    applyModelOrder();
    renderList();
    if (reference) root.querySelector('#gpv-reference').value = String(reference.id);
    const left = byName.get(settings.leftModel);
    if (left) root.querySelector('#gpv-left-model').value = String(left.id);
    if (['rotation', 'full'].includes(settings.syncMode)) root.querySelector('#gpv-sync-mode').value = settings.syncMode;
    setComparePanels(legacyPanelNames(settings).map(name => byName.get(name)).filter(Boolean));
    root.querySelector('#gpv-side-by-side').checked = settings.sideBySide === true;
    renderLabelList(); renderSelectionList(); renderMeasurementList(); renderAnnotationList(); renderDomainList(); renderSavedViews(); applyAppearance();
    applyStyle();
    if (settings.alignmentApplied && reference) alignVisible();
    if (settings.camera && typeof viewer.setView === 'function') viewer.setView(settings.camera);
    viewer.render();
    pendingScene = null;
    updateStatus('Scene restored' + (hashWarnings ? ' · warning: ' + hashWarnings + ' file hash mismatch' + (hashWarnings === 1 ? '' : 'es') : ''));
  }

  function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function afterPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function importProgress(value, maximum, label) {
    const state = root.querySelector('#gpv-import-state');
    state.hidden = false;
    const progress = root.querySelector('#gpv-import-progress');
    progress.max = Math.max(1, maximum); progress.value = Math.max(0, value);
    root.querySelector('#gpv-import-label').textContent = label;
  }

  function uniqueModelName(name, collection) {
    if (!structures.some(entry => entry.name === name)) return name;
    const prefixed = collection + ' › ' + name;
    if (!structures.some(entry => entry.name === prefixed)) return prefixed;
    let index = 2;
    while (structures.some(entry => entry.name === prefixed + ' (' + index + ')')) index += 1;
    return prefixed + ' (' + index + ')';
  }

  async function loadFiles(files) {
    if (!files.length) return;
    showImportErrors([]);
    listLimit = listPageSize;
    const doneBusy = setBusy('Importing ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
    stopCycle(); stopMotion();
    importProgress(0, files.length, 'Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
    updateStatus('Loading…');
    let loaded = 0;
    let skipped = 0;
    let deferredPae = 0;
    let importedArchive = false;
    const failures = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const extension = file.name.split('.').pop().toLowerCase();
      try {
        if (extension === 'zip') {
          if (typeof JSZip === 'undefined') throw new Error('The ZIP reader did not load. Refresh the page and try again.');
          importProgress(fileIndex, files.length, 'Opening ' + file.name + '…');
          const zip = await JSZip.loadAsync(file);
          if (zip.file('session.json')) {
            const snapshot = await readSessionZip(zip);
            if (snapshot) { await restoreSession(snapshot); loaded += snapshot.files.length; continue; }
          }
          importedArchive = true;
          const members = Object.values(zip.files);
          const structureMembers = members.filter(member => {
            const lower = member.name.toLowerCase();
            const supported = lower.endsWith('.pdb') || lower.endsWith('.cif') || lower.endsWith('.mmcif');
            return !member.dir && supported && !lower.includes('/templates/') && !lower.includes('template_hit');
          });
          if (!structureMembers.length) { skipped += 1; failures.push(file.name + ': no structure models found'); continue; }
          root.querySelector('#gpv-view-mode').value = 'single';
          for (let memberIndex = 0; memberIndex < structureMembers.length; memberIndex += 1) {
            const member = structureMembers[memberIndex];
            const memberExtension = member.name.split('.').pop().toLowerCase();
            try {
              const pathParts = member.name.split('/').filter(Boolean);
              const displayName = pathParts.length > 1 ? pathParts.slice(-2).join(' / ') : pathParts[0];
              addStructure(uniqueModelName(displayName, file.name), await member.async('string'), memberExtension === 'pdb' ? 'pdb' : 'cif', member.name, file.name, memberIndex > 0);
              loaded += 1;
              importProgress(fileIndex + (memberIndex + 1) / Math.max(1, structureMembers.length), files.length, file.name + ' · model ' + (memberIndex + 1) + ' of ' + structureMembers.length);
              if (memberIndex === 0) {
                renderList(); applyStyle();
                const active = activeEntry(); if (active && active.model) { viewer.zoomTo({ model: active.model.getID() }); viewer.render(); }
              }
              if (memberIndex % 5 === 4) await nextPaint();
            } catch (error) { skipped += 1; failures.push(member.name + ': ' + error.message); }
          }
          const msaMembers = members.filter(member => !member.dir && /\.a3m$/i.test(member.name) && /unpaired/i.test(member.name));
          for (const member of msaMembers) {
            try {
              const text = await member.async('string');
              if (text.length > 80 * 1024 * 1024) { failures.push(member.name + ': alignment over 80 MB skipped'); continue; }
              msaAssets.push({ collection: file.name, name: member.name.split('/').pop(), text });
            } catch (error) { failures.push(member.name + ': alignment could not be read'); }
          }
          const metadataMembers = members.filter(member => {
            const lower = member.name.toLowerCase();
            return !member.dir && (lower.endsWith('.json') || lower.endsWith('ranking_scores.csv')) && !lower.includes('/templates/');
          });
          const fullData = metadataMembers.filter(member => /_full_data_\d+\.json$/i.test(member.name));
          const selectedMetadata = structureMembers.length > 25 ? metadataMembers.filter(member => !fullData.includes(member)) : metadataMembers;
          deferredPae += metadataMembers.length - selectedMetadata.length;
          for (let metadataIndex = 0; metadataIndex < selectedMetadata.length; metadataIndex += 1) {
            const member = selectedMetadata[metadataIndex];
            try { registerMetadata(member.name, /\.json$/i.test(member.name) ? await member.async('uint8array') : await member.async('string'), file.name); }
            catch (error) { skipped += 1; failures.push(member.name + ': confidence data could not be read'); }
            if (metadataIndex % 12 === 11) await nextPaint();
          }
        } else if (['pdb', 'cif', 'mmcif'].includes(extension)) {
          addStructure(uniqueModelName(file.name, 'Individual files'), await file.text(), extension === 'pdb' ? 'pdb' : 'cif', file.name, 'Individual files');
          loaded += 1;
        } else if (extension === 'a3m') {
          msaAssets.push({ collection: 'Individual files', name: file.name, text: await file.text() });
          loaded += 0;
        } else if (['json', 'csv'].includes(extension)) {
          if (!registerMetadata(file.name, extension === 'json' ? new Uint8Array(await file.arrayBuffer()) : await file.text())) skipped += 1;
        } else {
          skipped += 1; failures.push(file.name + ': unsupported file type');
        }
      } catch (error) {
        skipped += 1; failures.push(file.name + ': ' + error.message);
      }
      importProgress(fileIndex + 1, files.length, 'Finished ' + file.name);
      await nextPaint();
    }
    if (importedArchive && structures.length > 1) root.querySelector('#gpv-view-mode').value = 'single';
    attachConfidenceAssets();
    renderList();
    applyStyle();
    const active = activeEntry();
    if (loaded && active && active.model) viewer.zoomTo({ model: active.model.getID() });
    viewer.render();
    root.querySelector('#gpv-files').value = '';
    root.querySelector('#gpv-save-scene').disabled = structures.length === 0; root.querySelector('#gpv-save-session').disabled = structures.length === 0;
    root.querySelector('#gpv-import-state').hidden = true;
    if (pendingScene && structures.length) await applyScene(pendingScene);
    else {
      const note = loaded ? 'Loaded ' + loaded + ' model' + (loaded === 1 ? '' : 's') + ' from ' + files.length + ' source' + (files.length === 1 ? '' : 's') : pendingScene ? 'Scene loaded; now add its matching structure files' : confidenceAssets.length ? 'Confidence data loaded; add matching structures' : 'No supported structures found';
      updateStatus(note + (confidenceAssets.length ? ' · confidence attached' : '') + (deferredPae ? ' · skipped ' + deferredPae + ' large PAE files for performance' : '') + (skipped ? ' · ' + skipped + ' skipped' : ''));
    }
    showImportErrors(failures);
    doneBusy();
    if (loaded) toast('Loaded ' + loaded + ' model' + (loaded === 1 ? '' : 's') + (skipped ? ' · ' + skipped + ' skipped' : ''));
    else if (failures.length) toast(failures[0], 'error');
  }

  function stopMotion() {
    viewer.spin(false);
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function startRock() {
    const tick = () => {
      const speed = Number(root.querySelector('#gpv-speed').value);
      const delta = 0.32 * speed * rockDirection;
      viewer.rotate(delta, 'y');
      viewer.render();
      rockPhase += Math.abs(delta);
      if (rockPhase >= 24) { rockPhase = 0; rockDirection *= -1; }
      animationFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function applyMotion() {
    stopMotion();
    const motion = root.querySelector('#gpv-motion').value;
    const speed = Number(root.querySelector('#gpv-speed').value);
    if (motion === 'spin') viewer.spin('y', 0.7 * speed);
    if (motion === 'rock') startRock();
    updateStatus(motion === 'off' ? 'Ready' : root.querySelector('#gpv-motion').selectedOptions[0].text);
  }

  function toggleSpin() {
    if (restoreMotion !== null) return;
    const motion = root.querySelector('#gpv-motion');
    motion.value = motion.value === 'spin' ? 'off' : 'spin';
    applyMotion();
  }

  function captureViewState(name = '', caption = '') {
    const active = activeEntry();
    return {
      id: nextAnnotationId++, name, caption,
      camera: typeof viewer.getView === 'function' ? viewer.getView() : null,
      activeModel: active ? active.name : null,
      visibleModels: structures.filter(entry => entry.visible).map(entry => entry.name),
      colors: Object.fromEntries(structures.map(entry => [entry.name, entry.color])),
      viewMode: root.querySelector('#gpv-view-mode').value,
      representation: root.querySelector('#gpv-style').value,
      colorMode: root.querySelector('#gpv-color-mode').value,
      projection: root.querySelector('#gpv-projection').value,
      background: root.querySelector('#gpv-background').value,
      backgroundColor: root.querySelector('#gpv-background-color').value,
      sideBySide: root.querySelector('#gpv-side-by-side').checked,
      syncMode: root.querySelector('#gpv-sync-mode').value,
      leftModel: (structures.find(entry => entry.id === Number(root.querySelector('#gpv-left-model').value)) || {}).name || null,
      comparePanels: panelNames(),
      panelCameras: comparePanels.map(panel => panel.viewer && typeof panel.viewer.getView === 'function' ? panel.viewer.getView() : null)
    };
  }

  /* options.panels === false applies everything except the synchronized panels: off-screen
     exports render the main view only, and rebuilding panel viewers for every rendered view
     would churn through WebGL contexts until the browser drops the oldest one. */
  function applyViewState(state, options = {}) {
    const panels = options.panels !== false;
    const byName = new Map(structures.map(entry => [entry.name, entry]));
    const visibleNames = new Set(state.visibleModels || []);
    structures.forEach(entry => {
      entry.visible = visibleNames.has(entry.name);
      if (/^#[0-9a-f]{6}$/i.test((state.colors || {})[entry.name] || '')) entry.color = state.colors[entry.name];
    });
    const active = byName.get(state.activeModel); if (active) activeId = active.id;
    if (['overlay', 'single'].includes(state.viewMode)) root.querySelector('#gpv-view-mode').value = state.viewMode;
    if (['cartoon', 'stick', 'sphere', 'line'].includes(state.representation)) root.querySelector('#gpv-style').value = state.representation;
    if (['structure', 'chain', 'entity', 'plddt', 'deviation', 'agreement', 'domain', 'annotated', 'data', 'charge', 'hydrophobicity', 'restype', 'amino', 'ss', 'spectrum', 'element'].includes(state.colorMode)) root.querySelector('#gpv-color-mode').value = state.colorMode;
    if (['perspective', 'orthographic'].includes(state.projection)) root.querySelector('#gpv-projection').value = state.projection;
    if (['transparent', 'white', 'dark', 'custom'].includes(state.background)) root.querySelector('#gpv-background').value = state.background;
    if (/^#[0-9a-f]{6}$/i.test(state.backgroundColor || '')) root.querySelector('#gpv-background-color').value = state.backgroundColor;
    if (panels) root.querySelector('#gpv-side-by-side').checked = state.sideBySide === true;
    if (['rotation', 'full'].includes(state.syncMode)) root.querySelector('#gpv-sync-mode').value = state.syncMode;
    const left = byName.get(state.leftModel);
    if (panels && state.sideBySide === true) setComparePanels(legacyPanelNames(state).map(name => byName.get(name)).filter(Boolean));
    renderList();
    if (left) root.querySelector('#gpv-left-model').value = String(left.id);
    applyAppearance(); applyStyle();
    if (state.camera && typeof viewer.setView === 'function') viewer.setView(state.camera);
    viewer.render();
    if (!panels) return;
    const cameras = Array.isArray(state.panelCameras) ? state.panelCameras : [];
    comparePanels.forEach((panel, index) => {
      if (panel.viewer && cameras[index] && typeof panel.viewer.setView === 'function') { panel.viewer.setView(cameras[index]); panel.viewer.render(); }
    });
    if (!cameras.length) syncViewsFrom(viewer);
  }

  function renderSavedViews(rebuildFigure = true) {
    if (rebuildFigure) renderFigureBuilder();
    const list = root.querySelector('#gpv-saved-views'); list.replaceChildren();
    savedViews.forEach((view, index) => {
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const textValue = document.createElement('span'); textValue.className = 'gpv-entry-name';
      textValue.textContent = String.fromCharCode(65 + index) + ' · ' + view.name + (view.caption ? ' — ' + view.caption : '');
      const load = document.createElement('button'); load.className = 'btn'; load.type = 'button'; load.textContent = 'Load'; load.addEventListener('click', () => { applyViewState(view); updateStatus('Loaded view ' + view.name); });
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { savedViews = savedViews.filter(item => item.id !== view.id); renderSavedViews(); updateStatus('Saved view removed'); });
      row.append(textValue, load, remove); list.append(row);
    });
    updateStatus();
  }

  function saveCurrentView() {
    const nameInput = root.querySelector('#gpv-view-name'); const captionInput = root.querySelector('#gpv-view-caption');
    const name = nameInput.value.trim() || 'View ' + (savedViews.length + 1);
    savedViews.push(captureViewState(name, captionInput.value.trim()));
    nameInput.value = ''; captionInput.value = ''; renderSavedViews(); updateStatus('Saved publication view ' + name);
  }

  /* The export plan: pixel dimensions plus, in print mode, the physical width, the
     resolution written into the file, and the text scale that makes labels the
     chosen point size at that width. Overlays and legends read textScale. */
  function exportDimensions() {
    const maxPixels = 24000000;
    const cap = (width, height) => {
      if (width * height <= maxPixels) return { width, height, capped: false };
      const correction = Math.sqrt(maxPixels / (width * height));
      return { width: Math.floor(width * correction), height: Math.floor(height * correction), capped: true };
    };
    if (root.querySelector('#gpv-export-mode').value === 'print') {
      const choice = root.querySelector('#gpv-print-width').value;
      const mm = choice === 'custom' ? Math.min(400, Math.max(20, Number(root.querySelector('#gpv-print-custom').value) || 120)) : Number(choice);
      const dpi = Number(root.querySelector('#gpv-print-dpi').value) || 300;
      const aspect = Number(root.querySelector('#gpv-print-aspect').value) || 1.5;
      const points = Number(root.querySelector('#gpv-print-text').value) || 8;
      const sized = cap(Math.round(mm / 25.4 * dpi), Math.round(mm / 25.4 * dpi / aspect));
      return { ...sized, dpi, mm, heightMm: mm / aspect, points, textScale: (points / 72 * dpi) / 12 };
    }
    const parts = root.querySelector('#gpv-export-size').value.split('x').map(Number);
    const requestedScale = Number(root.querySelector('#gpv-export-scale').value) || 1;
    const sized = cap(parts[0] * requestedScale, parts[1] * requestedScale);
    return { ...sized, dpi: null, textScale: Math.max(1, sized.width / 600) };
  }

  function figureScale(plan) {
    return plan && plan.textScale ? plan.textScale : Math.max(1, ((plan && plan.width) || 900) / 900);
  }

  function overlayScale(dimensions) {
    return dimensions && dimensions.textScale ? dimensions.textScale : 1;
  }

  function figureFont() {
    const value = root.querySelector('#gpv-figure-font').value;
    svgFont = value;
    return value;
  }

  function updateExportEstimate() {
    setTimeout(renderPublicationChecks, 0); setTimeout(renderCompositeControls, 0);
    const plan = exportDimensions();
    const printMode = root.querySelector('#gpv-export-mode').value === 'print';
    ['#gpv-export-size', '#gpv-export-scale'].forEach(selector => { root.querySelector(selector).closest('label').hidden = printMode; });
    ['#gpv-print-width', '#gpv-print-aspect', '#gpv-print-dpi', '#gpv-print-text'].forEach(selector => { root.querySelector(selector).closest('label').hidden = !printMode; });
    root.querySelector('#gpv-print-custom').closest('label').hidden = !printMode || root.querySelector('#gpv-print-width').value !== 'custom';
    root.querySelector('#gpv-export-estimate').textContent = printMode
      ? plan.width + ' × ' + plan.height + ' px · ' + plan.mm + ' × ' + Math.round(plan.heightMm) + ' mm at ' + plan.dpi + ' dpi · text ' + plan.points + ' pt' + (plan.capped ? ' · capped for browser stability' : '')
      : plan.width + ' × ' + plan.height + ' px · no physical size recorded' + (plan.capped ? ' · capped for browser stability' : '');
  }

  /* Off-screen render target for PNG export.
     Browsers cap the number of live WebGL contexts (commonly 8–16) and silently
     kill the oldest one past the limit — which used to be the main viewer's.
     A contact sheet created one context per panel, so a 10-panel sheet reliably
     lost the scene. One reusable surface is created here instead and kept for the
     whole session; releaseExportViewer() only empties and shrinks it. */
  let exportSurface = null;
  let exportViewer = null;

  function acquireExportViewer(width, height) {
    if (!exportSurface) {
      exportSurface = document.createElement('div');
      exportSurface.className = 'gpv-export-surface';
      root.append(exportSurface);
    }
    exportSurface.style.width = width + 'px';
    exportSurface.style.height = height + 'px';
    if (!exportViewer) {
      /* No `upscale`: 3Dmol implements it through an OffscreenCanvas bitmap transfer that
         fails in Firefox and WebKit, leaving a blank export. The surface is already
         created at the requested output size, so nothing is lost. */
      exportViewer = $3Dmol.createViewer(exportSurface, viewerOptions());
    } else {
      exportViewer.removeAllModels();
      exportViewer.removeAllLabels();
      exportViewer.removeAllShapes();
      if (typeof exportViewer.removeAllSurfaces === 'function') exportViewer.removeAllSurfaces();
      exportViewer.resize();
    }
    return exportViewer;
  }

  /* Release after an export job: clear the scene and shrink the surface so the GPU memory
     goes, but keep the one context alive. Losing and recreating it per job counted against
     the browser's WebGL context limit (WebKit drops the oldest live context at sixteen, and
     a lost context still counts until it is garbage-collected), so a session with many
     exports eventually killed the main view. One export context for the whole session
     cannot. */
  function releaseExportViewer() {
    if (!exportViewer) return;
    exportViewer.removeAllModels(); exportViewer.removeAllLabels(); exportViewer.removeAllShapes();
    if (typeof exportViewer.removeAllSurfaces === 'function') exportViewer.removeAllSurfaces();
    exportSurface.style.width = '4px'; exportSurface.style.height = '4px';
    exportViewer.resize();
  }

  async function renderPublicationImage(state = null, dimensions = exportDimensions(), overlays = true) {
    const restore = state ? captureViewState() : null;
    if (state) applyViewState(state, { panels: false });
    const target = acquireExportViewer(dimensions.width, dimensions.height);
    const background = backgroundSpec();
    target.setBackgroundColor(background.color, background.alpha);
    if (typeof target.setProjection === 'function') target.setProjection(root.querySelector('#gpv-projection').value);
    applyViewStyle(target);
    const pending = [];
    displayedEntries().forEach(entry => {
      if (!entry.model) return;
      const model = target.addModel(entry.text, entry.format);
      const atoms = model.selectedAtoms({});
      atoms.forEach((atom, index) => { if (entry.atoms[index]) { atom.x = entry.atoms[index].x; atom.y = entry.atoms[index].y; atom.z = entry.atoms[index].z; } });
      pending.push(applyModelStyle(model, entry, target));
    });
    await Promise.all(pending);
    if (overlays) drawOverlays(target, new Set(displayedEntries().map(entry => entry.id)), dimensions);
    target.zoomTo();
    if (typeof viewer.getView === 'function' && typeof target.setView === 'function') target.setView(viewer.getView());
    target.render();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const uri = target.pngURI();
    if (restore) applyViewState(restore, { panels: false });
    return uri;
  }

  async function downloadPublicationPng() {
    const button = root.querySelector('#gpv-image');
    const requested = exportDimensions();
    if (requested.width * requested.height > 6000000) {
      toast('Rendering ' + requested.width + ' × ' + requested.height + ' — this can take a while and the page will not respond meanwhile.');
    }
    const done = setBusy('Rendering PNG…');
    button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const uri = await withLegend(await renderPublicationImage(null, requested), requested);
      downloadBlob(await pngWithDpi(uri, requested.dpi), 'image/png', exportFileName('protein-publication', requested, 'png'));
      announce('Publication PNG downloaded · ' + requested.width + ' × ' + requested.height + (requested.dpi ? ' at ' + requested.dpi + ' dpi (' + requested.mm + ' mm wide)' : '') + (requested.capped ? ' · size capped for browser stability' : ''));
    } catch (error) {
      announce('Could not render the publication PNG: ' + error.message, 'error');
    } finally {
      releaseExportViewer();
      done();
      button.disabled = structures.length === 0; button.textContent = 'Download publication PNG';
    }
  }

  function hexLuminance(hex) {
    const value = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!value) return 1;
    const channels = [0, 2, 4].map(offset => parseInt(value[1].slice(offset, offset + 2), 16) / 255);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function figurePalette() {
    const mode = root.querySelector('#gpv-background').value;
    const background = backgroundSpec();
    const dark = mode === 'dark' || (mode === 'custom' && hexLuminance(background.color) < 0.45);
    return { paper: background.alpha ? background.color : '#ffffff', ink: dark ? '#f8fafc' : '#111827' };
  }

  const legendChainLimit = 12;
  /* Figure labels: what the legend's title and entries read as on screen and on every
     export, keyed by colour scheme and default entry text ('domain|D1', 'entity|α ×2',
     'chain|title'). Renaming changes nothing in the data — only the words in the legend —
     and is part of the scene, so scenes, sessions and share links carry it. */
  let figureLabels = {};
  const figureLabelLimit = 80;
  function legendItems(kind = 'figure') {
    const legend = defaultLegendItems(kind); if (!legend) return null;
    const mode = root.querySelector('#gpv-color-mode').value;
    const title = figureLabels[mode + '|title'];
    const items = legend.items.map(([color, short, long]) => {
      const custom = figureLabels[mode + '|' + short];
      if (!custom) return [color, short, long];
      const detail = long && long.includes(' · ') ? long.slice(long.indexOf(' · ')) : '';
      return [color, custom, custom + detail];
    });
    return { title: title || legend.title, items, defaults: legend };
  }
  function figureLabelsCustomised(legend = legendItems('figure')) {
    return Boolean(legend && (legend.title !== legend.defaults.title || legend.items.some((item, index) => item[1] !== legend.defaults.items[index][1])));
  }
  function setFigureLabels(next) {
    figureLabels = {};
    Object.entries(next && typeof next === 'object' ? next : {}).slice(0, 200).forEach(([key, value]) => {
      if (typeof key !== 'string' || !key.includes('|') || typeof value !== 'string') return;
      const text = value.trim().slice(0, figureLabelLimit); if (text) figureLabels[key.slice(0, figureLabelLimit * 2)] = text;
    });
  }
  /* The editor lists the current colour scheme's legend: one row for the title, one per entry. */
  function renderFigureLabels() {
    const wrap = root.querySelector('#gpv-labels-wrap'); const body = root.querySelector('#gpv-labels-rows'); const state = root.querySelector('#gpv-labels-state');
    if (wrap.hidden) return;
    if (wrap.contains(document.activeElement)) return;
    body.replaceChildren();
    const legend = legendItems('figure'); const mode = root.querySelector('#gpv-color-mode').value;
    if (!legend) { state.textContent = 'This colour scheme draws no legend, so there is nothing to rename. Choose a scheme with a legend — chains, entities, domains, models or per-residue data.'; return; }
    const row = (key, fallback, swatch) => {
      const tr = document.createElement('tr'); const th = document.createElement('th'); th.scope = 'row';
      if (swatch) { const i = document.createElement('i'); i.className = 'gpv-swatch'; i.style.background = swatch; th.append(i, ' '); }
      th.append(fallback); tr.append(th);
      const td = document.createElement('td'); const input = document.createElement('input'); input.className = 'form-control'; input.type = 'text'; input.maxLength = figureLabelLimit;
      input.dataset.gpvLabelKey = key; input.placeholder = fallback; input.value = figureLabels[key] || ''; input.setAttribute('aria-label', 'Label for ' + fallback);
      input.addEventListener('input', () => { const text = input.value.trim().slice(0, figureLabelLimit); if (text) figureLabels[key] = text; else delete figureLabels[key]; applyFigureLabels(false); });
      input.addEventListener('change', () => { remember('figure labels'); setTimeout(renderFigureLabels, 0); });
      td.append(input); tr.append(td); body.append(tr);
    };
    row(mode + '|title', legend.defaults.title, null);
    legend.defaults.items.forEach(item => row(mode + '|' + item[1], item[1], item[0]));
    renderFigureLabelsState();
  }
  function renderFigureLabelsState() {
    const mode = root.querySelector('#gpv-color-mode').value;
    const count = Object.keys(figureLabels).filter(key => key.startsWith(mode + '|')).length;
    root.querySelector('#gpv-labels-state').textContent = count ? count + ' custom label' + (count === 1 ? '' : 's') + ' for this colour scheme · they appear on screen, on every export and in the figure legend text' : 'Blank keeps the default. Names change only what the legend says, never the data.';
    root.querySelector('#gpv-labels-reset').disabled = !count;
  }
  function applyFigureLabels(rebuild = true) {
    renderScreenLegend(); if (typeof renderPublicationChecks === 'function') renderPublicationChecks();
    if (rebuild) renderFigureLabels(); else renderFigureLabelsState();
  }
  function openFigureLabels() {
    root.querySelector('[data-gpv-tab="publish"]').click();
    root.querySelector('#gpv-labels-wrap').hidden = false; renderFigureLabels();
    const first = root.querySelector('#gpv-labels-rows input'); if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
  }
  root.querySelector('#gpv-labels-edit').addEventListener('click', () => { const wrap = root.querySelector('#gpv-labels-wrap'); wrap.hidden = !wrap.hidden; if (!wrap.hidden) renderFigureLabels(); });
  root.querySelector('#gpv-labels-reset').addEventListener('click', () => {
    const mode = root.querySelector('#gpv-color-mode').value; remember('figure labels');
    Object.keys(figureLabels).filter(key => key.startsWith(mode + '|')).forEach(key => delete figureLabels[key]);
    applyFigureLabels(); announce('Legend labels reset to their defaults for this colour scheme');
  });
  /* What a colour legend should list for the current colour scheme, or null when
     the scheme has nothing worth naming. kind is 'figure', 'comparison' (each panel
     already names its model, so no model legend), or 'screen'. */
  function defaultLegendItems(kind = 'figure') {
    const mode = root.querySelector('#gpv-color-mode').value;
    if (residueLegends[mode]) return residueLegends[mode](kind);
    if (mode === 'data') {
      if (!residueData) return { title: 'Per-residue data', items: [['#d1d5db', 'none', 'No per-residue data loaded — Annotate → Per-residue data']] };
      const stops = dataScales[residueData.scale] || dataScales.viridis;
      const range = dataRange();
      const items = [0, 0.25, 0.5, 0.75, 1].map(t => [gradientColor(stops, t), formatDataValue(range.min + (range.max - range.min) * t)]);
      return { title: residueData.name, items: [...items, ['#d1d5db', 'no value', 'No value']] };
    }
    if (mode === 'annotated') {
      const active = sequenceEntry();
      const applicable = active ? domainRecords.filter(record => domainApplies(record, active)) : domainRecords;
      const seen = new Map(); applicable.forEach(record => { if (!seen.has(record.name)) seen.set(record.name, record); });
      if (!seen.size) return { title: 'Domains', items: [['#9ca3af', 'none', 'No annotated domains yet — Annotate → Domains']] };
      return { title: 'Domains', items: [...seen.values()].slice(0, 12).map(record => [record.color, clipText(record.name, 18), record.name + ' · ' + clipText(domainRecordRanges(record), 30)]) };
    }
    if (mode === 'domain') {
      const active = sequenceEntry(); const found = active && active.domains;
      if (!found || !found.domains.length) return { title: 'PAE domains (heuristic)', items: [['#9ca3af', 'none yet', 'No domains found yet — Confidence → Find domains']] };
      return { title: 'PAE domains (heuristic)', items: [...found.domains.slice(0, 12).map(domain => [domainColorFor(domain.id), 'D' + domain.id, 'Domain ' + domain.id + ' · ' + clipText(domainRanges(domain), 36)]), ...(found.unassigned ? [['#9ca3af', 'other', 'Unassigned']] : [])] };
    }
    if (mode === 'agreement') return { title: 'Cα RMSF', items: [...agreementBands.map(([, color, label]) => [color, label]), ['#9ca3af', 'single', 'In one model only']] };
    if (mode === 'deviation') return { title: 'Cα deviation', items: [...deviationBands.map(([, color, label]) => [color, label]), ['#9ca3af', 'unmatched']] };
    if (mode === 'plddt') return { title: 'pLDDT', items: [['#ff7d45', '<50', 'Very low <50'], ['#ffdb13', '50–70', 'Low 50–70'], ['#65cbf3', '70–90', 'Confident 70–90'], ['#0053d6', '≥90', 'Very high ≥90']] };
    const shown = displayedEntries().filter(entry => entry.model);
    const panelEntries = root.querySelector('#gpv-side-by-side').checked ? comparePanels.map(panel => entryById(panel.entryId)).filter(entry => entry && entry.model) : [];
    if (mode === 'entity') {
      const active = sequenceEntry(); if (!active) return null;
      const groups = entityGroups(active);
      if (!groups.length || groups.length > legendChainLimit) return null;
      return { title: 'Entity', items: groups.map(group => [entityColorFor(group.index), group.label + ' ×' + group.chains.length, group.label + ' ×' + group.chains.length + ' · ' + clipText(group.chains.join(', '), 24) + ' · ' + group.length + ' aa']) };
    }
    if (mode === 'chain') {
      const chains = [...new Set([...shown, ...panelEntries].flatMap(entry => entry.atoms.map(atom => atom.chain || '')))].sort(compareChains);
      if (!chains.length || chains.length > legendChainLimit) return null;
      return { title: 'Chain', items: chains.map(chain => [chainColor(chain), chain || '—']) };
    }
    if (mode === 'structure' && kind !== 'comparison') {
      if (shown.length < 2 || shown.length > 8) return null;
      return { title: 'Model', items: shown.map(entry => [entry.color, clipText(displayName(entry), 28)]) };
    }
    return null;
  }

  function legendWanted(kind = 'figure') {
    return root.querySelector('#gpv-export-legend').checked && legendItems(kind) !== null;
  }

  function renderScreenLegend() {
    const host = root.querySelector('#gpv-plddt-legend');
    const legend = legendItems('screen');
    host.hidden = !legend;
    host.replaceChildren();
    if (!legend) return;
    host.setAttribute('aria-label', legend.title + ' colour legend');
    const title = document.createElement('strong'); title.textContent = legend.title; host.append(title);
    legend.items.forEach(([color, short, long]) => {
      const item = document.createElement('span'); const swatch = document.createElement('i');
      swatch.className = 'gpv-swatch'; swatch.style.background = color;
      item.append(swatch, long || short); host.append(item);
    });
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn btn-ghost gpv-legend-edit'; edit.id = 'gpv-legend-edit';
    edit.textContent = figureLabelsCustomised(legend) ? 'Edit labels ·' : 'Edit labels'; edit.title = 'Rename the legend title and entries for figures (Publish → Figure labels)';
    edit.addEventListener('click', openFigureLabels); host.append(edit);
    renderFigureLabels();
  }

  function drawPlddtLegend(context, x, y, scale, palette, kind = 'figure', measureOnly = false) {
    const legend = legendItems(kind);
    if (!legend) return 0;
    const swatch = Math.round(14 * scale); const gap = Math.round(6 * scale); const font = Math.round(13 * scale);
    context.save();
    context.font = '500 ' + font + 'px ' + figureFont(); context.textBaseline = 'middle';
    const items = legend.items;
    const title = legend.title; const titleWidth = context.measureText(title).width + gap * 2;
    const widths = items.map(item => swatch + gap + context.measureText(item[1]).width + gap * 2);
    const total = titleWidth + widths.reduce((sum, width) => sum + width, 0);
    if (measureOnly) { context.restore(); return total; }
    context.fillStyle = palette.paper; context.globalAlpha = 0.88;
    context.fillRect(x - gap, y - swatch, total + gap, swatch * 2); context.globalAlpha = 1;
    let cursor = x;
    context.fillStyle = palette.ink; context.fillText(title, cursor, y); cursor += titleWidth;
    items.forEach((item, index) => {
      context.fillStyle = item[0]; context.fillRect(cursor, y - swatch / 2, swatch, swatch);
      context.fillStyle = palette.ink; context.fillText(item[1], cursor + swatch + gap, y);
      cursor += widths[index];
    });
    context.restore();
    return total;
  }

  /* Legend bottom-left, scale bar bottom-right. The legend is drawn at the figure's text scale
     but shrunk (never below 55 %) when it would not fit the width, and the bar is lifted above
     the legend band when the two would still collide — in the narrow panels of a multi-panel
     figure they otherwise print on top of each other. Used by every PNG and SVG export. */
  const furnitureMeasure = document.createElement('canvas').getContext('2d');
  function furnitureLayout(width, height, scale, bar, palette, wanted = legendWanted()) {
    const margin = Math.round(24 * scale);
    let legendScale = scale; let legendWidth = 0;
    if (wanted) {
      legendWidth = drawPlddtLegend(furnitureMeasure, 0, 0, scale, palette, 'figure', true);
      const available = width - margin * 2;
      if (legendWidth > available) { legendScale = Math.max(scale * 0.55, scale * available / legendWidth); legendWidth = drawPlddtLegend(furnitureMeasure, 0, 0, legendScale, palette, 'figure', true); }
    }
    let barLift = 0;
    if (bar && wanted && margin + legendWidth + margin / 2 > width - margin - bar.pixels - margin / 3) barLift = Math.round(Math.max(0, 40 * legendScale - 14 * scale));
    return { legendX: margin, legendY: height - Math.round(26 * legendScale), legendScale, barLift };
  }
  function drawFurniture(context, width, height, scale, bar, palette, wanted = legendWanted()) {
    const layout = furnitureLayout(width, height, scale, bar, palette, wanted);
    if (wanted) drawPlddtLegend(context, layout.legendX, layout.legendY, layout.legendScale, palette);
    if (bar) { context.save(); context.translate(0, -layout.barLift); drawScaleBar(context, bar, scale, palette); context.restore(); }
    return layout;
  }
  async function withLegend(uri, plan) {
    const bar = scaleBarSpec(exportViewer, plan);
    if (!legendWanted() && !bar) return uri;
    const { width, height } = plan;
    const imageValue = await loadImage(uri);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(imageValue, 0, 0, width, height);
    drawFurniture(context, width, height, figureScale(plan), bar, figurePalette());
    return canvas.toDataURL('image/png');
  }

