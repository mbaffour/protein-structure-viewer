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
    await restoreSession(snapshot);
    return true;
  }

  async function saveSession() {
    if (!structures.length) { await sessionStore('readwrite', store => store.delete('current')); return; }
    const total = structures.reduce((sum, entry) => sum + (entry.text ? entry.text.length : 0), 0);
    if (total > 80 * 1024 * 1024) { if (!sessionWarned) { sessionWarned = true; toast('Session too large to autosave (over 80 MB of coordinates) — use Save session file to keep your work.'); } return; }
    const snapshot = {
      savedAt: new Date().toISOString(), viewerVersion,
      files: structures.map(entry => ({ name: entry.name, text: entry.text, format: entry.format, sourcePath: entry.sourcePath, collection: entry.collection, fetchId: entry.fetchId || null, confidence: sessionConfidence(entry.confidence) || {}, rank: entry.rank })),
      predictionRuns: predictionRuns.map(run => ({ ...run })),
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
  async function restoreSession(saved) {
    const done = setBusy('Restoring session…');
    try {
      /* The prediction settings are not a property of any one model, so they travel beside the files
         rather than on them; without this the methods text loses its predictor after a restore. */
      if (Array.isArray(saved.predictionRuns)) predictionRuns = saved.predictionRuns.map(run => ({ ...run }));
      saved.files.forEach(file => {
        const entry = addStructure(uniqueModelName(file.name, file.collection), file.text, file.format, file.sourcePath, file.collection);
        if (file.fetchId) entry.fetchId = file.fetchId;
        if (file.confidence) entry.confidence = file.confidence;
        if (file.rank !== undefined && file.rank !== null) entry.rank = file.rank;
      });
      renderList(); applyStyle();
      await applyScene(saved.scene);
      announce('Session restored · ' + saved.files.length + ' model' + (saved.files.length === 1 ? '' : 's') + ' from ' + new Date(saved.savedAt).toLocaleTimeString());
    } finally { done(); }
  }

