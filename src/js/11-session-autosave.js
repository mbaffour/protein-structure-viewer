  /* ---------- Session autosave ---------- */

  const sessionDbName = 'protein-structure-viewer';
  let sessionTimer = 0; let sessionWarned = false;
  function openSessionDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no IndexedDB')); return; }
      const request = indexedDB.open(sessionDbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function sessionStore(mode, work) {
    const db = await openSessionDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('session', mode); const request = work(tx.objectStore('session'));
      tx.oncomplete = () => { db.close(); resolve(request && request.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  function scheduleSessionSave() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => { saveSession().catch(() => {}); }, 1500);
  }
  /* A 4 400-token PAE is 78 MB per model as Float32; five of them would be written to
     IndexedDB after every change. Matrices above 1 500 tokens are left out of the autosave
     (the models, scores and everything else are kept); reopen the archive to get them back. */
  function sessionConfidence(confidence) {
    if (!confidence || !Array.isArray(confidence.pae) || confidence.pae.length <= 1500) return confidence;
    const copy = { ...confidence }; delete copy.pae; delete copy.paeMaximum; copy.paeOmitted = true; return copy;
  }

  function sessionScene() {
    return { type: 'protein-viewer-scene', schemaVersion: 1, viewerVersion, provenance: provenanceValues(), models: structures.map(entry => ({ name: entry.name, visible: entry.visible, color: entry.color, label: entry.label || '', hiddenChains: entry.hiddenChains || [], fadedChains: entry.fadedChains || [] })), settings: sceneSettings(), ...sceneOverlays(), savedViews: savedViews.map(view => ({ ...view })) };
  }

  function sessionSnapshot(confidenceOf = sessionConfidence) {
    return {
      savedAt: new Date().toISOString(), viewerVersion,
      files: structures.map(entry => ({ name: entry.name, text: entry.text, format: entry.format, sourcePath: entry.sourcePath, collection: entry.collection, fetchId: entry.fetchId || null, confidence: confidenceOf(entry.confidence) || {}, rank: entry.rank })),
      scene: sessionScene()
    };
  }

