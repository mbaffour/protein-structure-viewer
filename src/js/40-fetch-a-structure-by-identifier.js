  /* ---------- Fetch a structure by identifier ---------- */

  function parseIdentifier(raw) {
    const id = raw.trim();
    if (!id) return null;
    /* AlphaFold DB entry name, with or without the fragment suffix. */
    const alphafold = id.match(/^AF[-_]([A-Z0-9]+)(?:[-_]F(\d+))?$/i);
    if (alphafold) return { kind: 'alphafold', accession: alphafold[1].toUpperCase(), fragment: Number(alphafold[2] || 1) };
    /* A PDB ID is four characters and starts with a digit. */
    if (/^[0-9][A-Za-z0-9]{3}$/.test(id)) return { kind: 'pdb', code: id.toLowerCase() };
    /* Otherwise treat it as a UniProt accession and look it up in AlphaFold DB. */
    if (/^[A-Z][A-Z0-9]{5,9}$/i.test(id)) return { kind: 'alphafold', accession: id.toUpperCase(), fragment: 1 };
    return null;
  }

  async function fetchText(url, what) {
    const response = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      throw new Error(response.status === 404 ? 'no ' + what + ' with that identifier' : what + ' request failed with status ' + response.status);
    }
    return response.text();
  }

  async function resolveAlphafold(target) {
    /* The file names carry a model version that changes over time (v4 in 2023,
       v6 today), so ask the API for the current URLs instead of guessing. */
    const listing = JSON.parse(await fetchText('https://alphafold.ebi.ac.uk/api/prediction/' + encodeURIComponent(target.accession), 'AlphaFold DB entry'));
    if (!Array.isArray(listing) || !listing.length) throw new Error('no AlphaFold DB model for ' + target.accession);
    const requested = 'AF-' + target.accession + '-F' + target.fragment;
    const record = listing.find(item => item && item.modelEntityId === requested);
    if (!record) throw new Error('no AlphaFold DB model for ' + requested);
    if (!record.cifUrl) throw new Error('AlphaFold DB returned no coordinate file');
    return {
      url: record.cifUrl,
      paeUrl: record.paeDocUrl || null,
      name: (record.modelEntityId || 'AF-' + target.accession + '-F1') + '.cif',
      format: 'cif',
      collection: 'AlphaFold DB'
    };
  }

  /* Fetch one identifier (PDB ID, UniProt accession, or AlphaFold DB name) and add it
     as a model. Shared by the Fetch button and by share links. */
  async function fetchIdentifier(raw) {
    const target = parseIdentifier(raw);
    if (!target) throw new Error('"' + raw + '" is not a PDB ID, UniProt accession, or AlphaFold DB name');
    const source = target.kind === 'pdb'
      ? { url: 'https://files.rcsb.org/download/' + target.code + '.cif', paeUrl: null, name: target.code + '.cif', format: 'cif', collection: 'RCSB PDB' }
      : await resolveAlphafold(target);
    const text = await fetchText(source.url, 'structure');
    const entry = addStructure(uniqueModelName(source.name, source.collection), text, source.format, source.url, source.collection);
    entry.fetchId = target.kind === 'pdb' ? target.code : 'AF-' + target.accession + '-F' + target.fragment;
    let note = '';
    if (source.paeUrl) {
      /* Best effort: a missing PAE file must not fail the whole fetch.
         Attach it directly rather than through the filename-matching used for
         local archives — AlphaFold DB file names carry a model version that
         those heuristics do not recognise. */
      try {
        const confidence = confidenceFromJson(JSON.parse(await fetchText(source.paeUrl, 'PAE')));
        if (confidence && Array.isArray(confidence.pae) && confidence.pae.length) {
          entry.confidence = mergeConfidence(entry.confidence, confidence);
          confidenceAssets.push({ name: source.paeUrl.split('/').pop(), confidence, rank: null, collection: source.collection, modelName: entry.name });
          note = ' with predicted aligned error';
        }
      } catch (error) { note = ' (predicted aligned error unavailable)'; }
    }
    renderList();
    applyStyle();
    return { entry, source, note };
  }

  /* An export renders one state of the page. Every export path sets the busy badge to "Rendering …"
     (or "Embedding …" for the report, "Saving session…") from its first line to its last, and a model
     added between its awaits used to reach its legend but not its image. While that badge is up, an
     import (31 loadFiles) or a fetch waits for it to come down, and says so. */
  const exportBusyLabel = /^(Rendering|Embedding|Saving session)/;
  /* The badge label alone was not enough: one label for the whole page, and any job started during an
     export (Align visible, Segment PAE) wrote its own over it and never put it back, so the export
     stopped counting as one and a dropped file loaded halfway through it. An export that began with
     beginExport is counted here instead, whatever the badge says; the label test stays for the paths
     that do not go through beginExport yet. */
  let exportsInFlight = 0;
  const exportWaiters = new Set();
  function exportRendering() {
    if (exportsInFlight > 0) return true;
    const badge = root.querySelector('#gpv-busy');
    return Boolean(badge && !badge.hidden && exportBusyLabel.test(root.querySelector('#gpv-busy-label').textContent));
  }

  /* Every export renders on the one shared export viewer (31) and most of them move the page through
     the states they draw — a built figure applies each saved view in turn. A second export started
     meanwhile emptied the first one's scene between its awaits, shrank the surface under its pngURI,
     and captured a saved view's colours and camera as "the page to go back to", so both files came
     out wrong and the screen was left in panel A's state. So: one export at a time. The entry calls
     this first; null means another is rendering and nothing was started. Otherwise it returns the
     function that ends this one, to call last, in the export's finally. A running Cycle models would
     switch the model between the image and its labels (FC-7), so it stops here. */
  function beginExport() {
    if (exportRendering()) { announce('An export is still rendering · wait for it to finish, then press again', 'error'); return null; }
    exportsInFlight += 1;
    exportShown = null;
    scaleBarMisses = [];
    if (cycleTimer) stopCycle();
    holdExportButtons();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      exportsInFlight = Math.max(0, exportsInFlight - 1);
      /* The held buttons take their states from the page again; the line the export wrote stays. */
      updateStatus(root.querySelector('#gpv-state').textContent || 'Ready');
      exportWaiters.forEach(waiter => waiter());
    };
  }

  /* The buttons that start an export or snapshot the page, kept disabled while one renders: a restyle
     during a built figure (each panel is applied in turn) recomputes every button from the page and
     enabled them all again, still labelled "Rendering 1 / 3…". updateStatus calls this through
     renderImageButton (33). */
  const exportButtons = ['#gpv-image', '#gpv-svg', '#gpv-copy-image', '#gpv-contact-sheet', '#gpv-builder-svg', '#gpv-views-zip', '#gpv-compare-image', '#gpv-compare-svg', '#gpv-model-panels', '#gpv-composite', '#gpv-report', '#gpv-save-session'];
  function holdExportButtons() {
    if (!exportsInFlight) return;
    exportButtons.forEach(selector => { const button = root.querySelector(selector); if (button) button.disabled = true; });
  }

  function afterExportRenders(what) {
    updateStatus('Export in progress — ' + what + ' will load when it finishes');
    return new Promise(resolve => {
      const badge = root.querySelector('#gpv-busy');
      /* The badge can come down before the export's count does (its finally ends the badge first), so
         the end of an export asks again too. */
      const check = () => { if (exportRendering()) return; observer.disconnect(); exportWaiters.delete(check); setTimeout(resolve, 0); };
      const observer = new MutationObserver(check);
      observer.observe(badge, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
      exportWaiters.add(check);
      check();
    });
  }

  async function fetchStructure() {
    const field = root.querySelector('#gpv-fetch-id');
    const target = parseIdentifier(field.value);
    if (!target) {
      announce('Enter a four-character PDB ID (1ubq), a UniProt accession (P69905), or an AlphaFold DB name (AF-P0DTC2-F1)', 'error');
      field.focus();
      return;
    }
    const id = field.value.trim();
    const button = root.querySelector('#gpv-fetch');
    button.disabled = true;
    if (exportRendering()) await afterExportRenders(id);
    /* An armed Measure to… was armed among the models already open; the next click may land on the
       fetched one, and must open its card rather than measure into it — as for an import. */
    cancelMeasureTo(true);
    const done = setBusy('Fetching ' + id + '…');
    try {
      const { entry, source, note } = await fetchIdentifier(id);
      selectModel(entry, true, true);
      dismissSessionBanner();
      field.value = '';
      const comparing = root.querySelector('#gpv-side-by-side').checked && comparePanels.length > 0;
      announce('Loaded ' + entry.name + ' from ' + source.collection + note + (comparing ? ' · in the primary panel' : ''));
    } catch (error) {
      /* A request that never got an answer (offline, blocked) throws the browser's own TypeError, worded
         differently by every engine and saying nothing about what to do; that wording goes to the
         console only. An answer the server gave (no such entry) keeps its own words. */
      if (error instanceof TypeError) {
        console.warn('Fetch of ' + id + ' failed:', error);
        announce('Could not reach ' + (target.kind === 'pdb' ? 'the PDB' : 'AlphaFold DB') + ' (' + id + ') — check the network and the id', 'error');
      } else announce('Could not fetch that structure: ' + error.message, 'error');
    } finally {
      done();
      button.disabled = false;
    }
  }
