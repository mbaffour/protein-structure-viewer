  /* ---------- Session files ----------
     The autosave snapshot, written as a ZIP the user keeps: session.json (everything but the bulky
     parts), models/ with each model's text, and confidence/ with each PAE matrix as raw Float32
     (row-major, little-endian). Unlike scene JSON it carries the models themselves, so it reopens
     anywhere with no other files, and unlike the autosave it has no size cap and keeps every PAE. */
  async function downloadSessionFile() {
    if (!structures.length) return;
    if (typeof JSZip === 'undefined') { announce('The ZIP writer did not load. Refresh the page and try again.', 'error'); return; }
    const done = setBusy('Saving session…');
    try {
      const zip = new JSZip(); const snapshot = sessionSnapshot(confidence => confidence);
      snapshot.type = 'protein-viewer-session'; snapshot.schemaVersion = 1;
      snapshot.files.forEach((file, index) => {
        const stem = String(index + 1).padStart(2, '0') + '-' + String(file.name).replace(/[^\w.-]+/g, '_');
        file.textMember = 'models/' + stem; zip.file(file.textMember, file.text || ''); delete file.text;
        const confidence = { ...(file.confidence || {}) };
        if (Array.isArray(confidence.pae) && confidence.pae.length) {
          const rows = confidence.pae.length; const cols = confidence.pae[0].length;
          const flat = new Float32Array(rows * cols);
          confidence.pae.forEach((row, r) => { for (let c = 0; c < cols; c += 1) flat[r * cols + c] = Number(row[c]); });
          const member = 'confidence/' + stem + '.pae.f32'; zip.file(member, flat.buffer);
          confidence.paeMember = member; confidence.paeRows = rows; confidence.paeCols = cols; delete confidence.pae;
        }
        file.confidence = confidence;
      });
      zip.file('session.json', JSON.stringify(snapshot));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const title = provenanceValues().title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
      downloadBlob(blob, 'application/zip', (title || 'protein-session') + '-' + new Date().toISOString().slice(0, 10) + '.zip');
      announce('Session saved · ' + structures.length + ' model' + (structures.length === 1 ? '' : 's') + ' · ' + formatBytes(blob.size) + ' · reopen it with Open session file or by dropping it on the page');
    } catch (error) { announce('Could not save the session: ' + error.message, 'error'); }
    finally { done(); }
  }

  async function readSessionZip(zip) {
    const member = zip.file('session.json'); if (!member) return null;
    const snapshot = JSON.parse(await member.async('string'));
    if (snapshot.type !== 'protein-viewer-session' || !Array.isArray(snapshot.files)) return null;
    for (const file of snapshot.files) {
      if (file.textMember) { const text = zip.file(file.textMember); file.text = text ? await text.async('string') : ''; }
      const confidence = file.confidence || {};
      if (confidence.paeMember && zip.file(confidence.paeMember)) {
        const bytes = await zip.file(confidence.paeMember).async('arraybuffer');
        const flat = new Float32Array(bytes); const cols = confidence.paeCols || confidence.paeRows;
        confidence.pae = Array.from({ length: confidence.paeRows }, (_, r) => flat.subarray(r * cols, (r + 1) * cols));
        confidence.paeMaximum = matrixMaximum(confidence.pae);
      }
      delete confidence.paeMember; delete confidence.paeRows; delete confidence.paeCols;
    }
    return snapshot;
  }

  async function openSessionFile(file) {
    if (typeof JSZip === 'undefined') { announce('The ZIP reader did not load. Refresh the page and try again.', 'error'); return false; }
    const snapshot = await readSessionZip(await JSZip.loadAsync(file));
    if (!snapshot) { announce('That ZIP is not a session file', 'error'); return false; }
    const restored = await restoreSession(snapshot);
    if (!restored) { updateStatus('Session not opened · the page is kept as it was'); return false; }
    return true;
  }

  /* An empty page has nothing of its own to save; it only replaces the stored session once it has
     held models of its own. Otherwise the boot-time save would delete the session the restore banner
     is offering, and Not now would be Forget it. */
  let sessionHadModels = false;
  async function saveSession() {
    if (!structures.length) { if (sessionHadModels) await sessionStore('readwrite', store => store.delete('current')); return; }
    sessionHadModels = true;
    const total = structures.reduce((sum, entry) => sum + (entry.text ? entry.text.length : 0), 0);
    if (total > 80 * 1024 * 1024) { if (!sessionWarned) { sessionWarned = true; toast('Session too large to autosave (over 80 MB of coordinates) — use Save session file to keep your work.'); } return; }
    const snapshot = {
      savedAt: new Date().toISOString(), viewerVersion,
      files: structures.map(entry => ({ name: entry.name, text: entry.text, format: entry.format, sourcePath: entry.sourcePath, collection: entry.collection, fetchId: entry.fetchId || null, confidence: sessionConfidence(entry.confidence) || {}, rank: entry.rank })),
      scene: sessionScene()
    };
    await sessionStore('readwrite', store => store.put(snapshot, 'current'));
  }
  async function offerSessionRestore() {
    if (location.hash.startsWith('#scene=') || structures.length) return;
    let saved = null;
    try { saved = await sessionStore('readonly', store => store.get('current')); } catch (error) { return; }
    if (!saved || !Array.isArray(saved.files) || !saved.files.length || structures.length) return;
    const banner = root.querySelector('#gpv-session-banner'); banner.hidden = false;
    root.querySelector('#gpv-session-text').textContent = 'Restore your last session? ' + saved.files.length + ' model' + (saved.files.length === 1 ? '' : 's') + ', saved ' + new Date(saved.savedAt).toLocaleString() + '.';
    root.querySelector('#gpv-session-yes').onclick = () => { banner.hidden = true; restoreSession(saved).catch(error => announce('Could not restore the session: ' + error.message, 'error')); };
    root.querySelector('#gpv-session-no').onclick = () => { banner.hidden = true; };
    root.querySelector('#gpv-session-forget').onclick = () => { banner.hidden = true; sessionStore('readwrite', store => store.delete('current')).then(() => updateStatus('Saved session discarded')).catch(() => {}); };
  }
  function dismissSessionBanner() {
    root.querySelector('#gpv-session-banner').hidden = true;
  }
  /* The page's own work, as Clear all counts it. */
  function sessionPageWork() {
    return labelRecords.length + selectionRecords.length + measurementRecords.length + annotationRecords.length + domainRecords.length + savedViews.length + spotlightResidues.length;
  }
  /* Everything Clear all removes, without its question (the session asked its own): the models, their
     records and panels, and the analyses made on them. The undo history goes too — its steps name
     models that are no longer on the page, and undoing into them would only take the session's records
     away. Chain colours and the export settings stay; the session's scene sets its own. */
  function sessionEmptyPage() {
    stopCycle(); stopMotion();
    dismissCanvasText(); cancelMeasureTo(false); setBoxSelectMode(false);
    if (annotationActive) toggleAnnotating(false);
    if (measurementActive) toggleMeasurement();
    viewer.removeAllModels(); viewer.removeAllLabels(); viewer.removeAllShapes();
    comparePanels.forEach(destroyPanelViewer);
    releaseExportViewer();
    structures = []; activeId = null; selectedResidue = null;
    clearHistory();
    labelRecords = []; selectionRecords = []; measurementRecords = []; measurementDraft = []; annotationRecords = []; annotationDraft = [];
    spotlightResidues = []; positionEffect = null; renderPositionEffect(); renderPositionState();
    domainRecords = []; domainVersion += 1;
    residueData = null; renderDataState();
    savedViews = [];
    confidenceAssets = []; interactionResults = null; alignmentResults = []; interfaceResults = null; renderInterfaceResults();
    pendingScene = null;
    root.querySelector('#gpv-residue').textContent = idleResidueText;
    root.querySelector('#gpv-side-by-side').checked = false;
    clearComparePanels();
    resetAnalyses();
    renderAlignmentResults();
    renderLabelList(); renderSelectionList(); renderMeasurementList(); renderAnnotationList(); renderDomainList(); renderSavedViews();
  }

  /* A session file is a whole workspace: it replaces the page — models, records, views, settings —
     rather than adding its models beside the page's and pinning its records on whichever page model
     had the same file name (before 2.52.0 a session of run A opened over run B labelled run B). With
     anything on the page it asks first; Cancel keeps the page. Returns what it restored, or null. */
  async function restoreSession(saved) {
    const open = structures.length; const work = sessionPageWork();
    if (open || work) {
      const what = open ? 'the ' + (open === 1 ? 'model' : open + ' models') + ' and the work on this page' : 'the work on this page';
      if (!confirm('Replace ' + what + ' with the session? Cancel keeps the page.')) return null;
    }
    const done = setBusy('Restoring session…');
    try {
      if (open || work) sessionEmptyPage();
      saved.files.forEach(file => {
        const entry = addStructure(uniqueModelName(file.name, file.collection), file.text, file.format, file.sourcePath, file.collection);
        if (file.fetchId) entry.fetchId = file.fetchId;
        if (file.confidence) entry.confidence = file.confidence;
        if (file.rank !== undefined && file.rank !== null) entry.rank = file.rank;
      });
      renderList(); applyStyle();
      await applyScene(saved.scene);
      /* What is on the page now, which is what the session held. */
      const message = 'Session restored · ' + structures.length + ' model' + (structures.length === 1 ? '' : 's') + ' from ' + new Date(saved.savedAt).toLocaleTimeString() + (open ? ' · replaced the ' + (open === 1 ? 'model that was open' : open + ' models that were open') : '');
      announce(message);
      return { models: structures.length, message };
    } finally { done(); }
  }

