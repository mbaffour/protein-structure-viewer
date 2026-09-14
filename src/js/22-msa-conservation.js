  /* ---------- MSA conservation ----------
     AlphaFold 3 archives carry the unpaired MSA per entity as .a3m. The query is the first
     record; uppercase letters are match columns, lowercase letters insertions (dropped), '-'
     gaps. Per query column: depth (sequences with a residue), identity to the query, and
     conservation = 1 − H / log2(20) with H the Shannon entropy over the twenty amino acids.
     The columns are mapped onto every chain whose sequence contains the query, and the result
     is loaded as a per-residue dataset so colouring, legends, exports and reports all follow. */
  let msaAssets = [];
  const aminoAlphabet = 'ACDEFGHIKLMNPQRSTVWY';

  function parseA3m(text) {
    const records = []; let current = null;
    String(text).split(/\r?\n/).forEach(line => {
      if (line.startsWith('>')) { current = { header: line.slice(1).trim(), parts: [] }; records.push(current); }
      else if (current && line.trim() && !line.startsWith('#')) current.parts.push(line.trim());
    });
    if (!records.length) return null;
    const query = records[0].parts.join('').replace(/[a-z.]/g, '');
    const length = query.length; if (!length) return null;
    const depth = new Array(length).fill(0); const identity = new Array(length).fill(0); const counts = Array.from({ length }, () => new Map());
    let used = 0;
    records.forEach(record => {
      const sequence = record.parts.join('').replace(/[a-z.]/g, '');
      if (sequence.length !== length) return;
      used += 1;
      for (let i = 0; i < length; i += 1) {
        const letter = sequence[i];
        if (letter === '-' || letter === 'X' || letter === 'x') continue;
        depth[i] += 1; if (letter === query[i]) identity[i] += 1;
        counts[i].set(letter, (counts[i].get(letter) || 0) + 1);
      }
    });
    const conservation = counts.map((column, i) => {
      if (!depth[i]) return 0;
      let entropy = 0;
      column.forEach(count => { const p = count / depth[i]; entropy -= p * Math.log2(p); });
      return Math.max(0, Math.min(1, 1 - entropy / Math.log2(aminoAlphabet.length)));
    });
    return { query, sequences: used, depth, identity: identity.map((count, i) => (depth[i] ? count / depth[i] : 0)), conservation };
  }

  function msaAssetsFor(entry) {
    if (!entry) return [];
    return msaAssets.filter(asset => asset.collection === entry.collection);
  }

  function renderMsaState() {
    const entry = activeEntry(); const assets = msaAssetsFor(entry);
    const button = root.querySelector('#gpv-msa-paint'); const state = root.querySelector('#gpv-msa-state');
    button.disabled = !assets.length || !entry || !entry.model;
    if (!assets.length) { state.textContent = entry ? 'No alignment for ' + (entry.collection || 'this source') + '. AlphaFold 3 archives carry one per entity; an .a3m can also be added on its own.' : 'No alignment loaded.'; return; }
    state.textContent = assets.length + ' alignment' + (assets.length === 1 ? '' : 's') + ' from ' + (entry.collection || 'this source') + ': ' + clipText(assets.map(asset => asset.name.replace(/^.*_unpaired_msa_/, '')).join(', '), 90);
  }

  function paintByMsa() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const assets = msaAssetsFor(entry); if (!assets.length) return;
    const metric = root.querySelector('#gpv-msa-metric').value;
    const values = new Map(); const covered = []; const notes = [];
    const rows = residueRows(entry);
    assets.forEach(asset => {
      if (!asset.parsed) asset.parsed = parseA3m(asset.text) || false;
      const msa = asset.parsed; if (!msa) { notes.push(asset.name + ': could not be read'); return; }
      rows.forEach(row => {
        const letters = row.residues.map(atom => residueLetter(atom.resn)).join('');
        let offset = letters.indexOf(msa.query); let queryOffset = 0;
        if (offset < 0) { const inner = msa.query.indexOf(letters); if (inner < 0) return; queryOffset = inner; offset = 0; }
        row.residues.forEach((atom, index) => {
          const column = index - offset + queryOffset;
          if (column < 0 || column >= msa.query.length) return;
          const value = metric === 'depth' ? msa.depth[column] : metric === 'identity' ? msa.identity[column] : msa.conservation[column];
          values.set((atom.chain || '') + '|' + atom.resi, value);
        });
        covered.push((row.chain || '—') + ' (' + msa.sequences + ' seq.)');
      });
    });
    if (!values.size) { announce('No chain of ' + displayName(entry) + ' matches a query sequence in the alignment' + (notes.length ? ' · ' + notes.join('; ') : ''), 'error'); return; }
    const all = [...values.values()];
    const names = { conservation: 'MSA conservation (1 − H/log₂20)', identity: 'MSA identity to query', depth: 'MSA coverage (sequences)' };
    remember('MSA colouring');
    residueData = { values, byResi: new Map(), min: Math.min(...all), max: Math.max(...all), count: all.length, name: names[metric], scale: 'viridis', scope: 'source', entryId: entry.id, msa: { metric, sequences: assets.map(asset => asset.parsed ? asset.parsed.sequences : 0) } };
    root.querySelector('#gpv-color-mode').value = 'data';
    renderDataState(); applyStyle();
    announce(residueData.name + ' on chain' + (covered.length === 1 ? ' ' : 's ') + clipText(covered.join(', '), 80) + (notes.length ? ' · ' + notes.join('; ') : ''));
  }

