  /* ---------- MSA conservation ----------
     AlphaFold 3 archives carry the unpaired MSA per entity as .a3m. The query is the first
     record; uppercase letters are match columns, lowercase letters insertions (dropped), '-'
     gaps. Per query column: depth (sequences with a residue), identity to the query, and
     conservation = 1 − H / log2(20) with H the Shannon entropy over the twenty amino acids.
     By default the entropy uses the position-based sequence weights of Henikoff & Henikoff
     (1994): at each column every sequence receives 1 / (r · n) where r is the number of residue
     types in the column and n the number of sequences sharing its residue; a sequence's weight is
     its sum over columns, scaled so the weights average 1. Redundant clusters of near-identical
     sequences then no longer dominate the column. The unweighted value is kept alongside
     (conservationRaw) and selectable with the Henikoff weights switch.
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
    const isGap = letter => letter === '-' || letter === 'X' || letter === 'x';
    const kept = records.map(record => record.parts.join('').replace(/[a-z.]/g, '')).filter(sequence => sequence.length === length);
    const used = kept.length;
    const depth = new Array(length).fill(0); const identity = new Array(length).fill(0); const counts = Array.from({ length }, () => new Map());
    kept.forEach(sequence => {
      for (let i = 0; i < length; i += 1) {
        const letter = sequence[i];
        if (isGap(letter)) continue;
        depth[i] += 1; if (letter === query[i]) identity[i] += 1;
        counts[i].set(letter, (counts[i].get(letter) || 0) + 1);
      }
    });
    /* Henikoff position-based weights: 1 / (types in column × sequences sharing the residue),
       summed over the columns where the sequence has a residue, scaled to a mean of 1. */
    const weights = new Array(used).fill(0);
    for (let i = 0; i < length; i += 1) {
      const types = counts[i].size; if (!types) continue;
      kept.forEach((sequence, s) => { const letter = sequence[i]; if (!isGap(letter)) weights[s] += 1 / (types * counts[i].get(letter)); });
    }
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const scale = weightTotal > 0 ? used / weightTotal : 1;
    for (let s = 0; s < used; s += 1) weights[s] *= scale;
    const entropyOf = column => { let entropy = 0; let total = 0; column.forEach(count => { total += count; }); if (!total) return null; column.forEach(count => { const p = count / total; if (p > 0) entropy -= p * Math.log2(p); }); return entropy; };
    const normalise = entropy => (entropy === null ? 0 : Math.max(0, Math.min(1, 1 - entropy / Math.log2(aminoAlphabet.length))));
    const conservationRaw = counts.map(column => normalise(entropyOf(column)));
    const conservation = counts.map((column, i) => {
      if (!column.size) return 0;
      const weighted = new Map();
      kept.forEach((sequence, s) => { const letter = sequence[i]; if (!isGap(letter)) weighted.set(letter, (weighted.get(letter) || 0) + weights[s]); });
      return normalise(entropyOf(weighted));
    });
    return { query, sequences: used, depth, identity: identity.map((count, i) => (depth[i] ? count / depth[i] : 0)), conservation, conservationRaw, weights };
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
    const weighted = root.querySelector('#gpv-msa-weights').checked;
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
          const value = metric === 'depth' ? msa.depth[column] : metric === 'identity' ? msa.identity[column] : weighted ? msa.conservation[column] : msa.conservationRaw[column];
          values.set((atom.chain || '') + '|' + atom.resi, value);
        });
        covered.push((row.chain || '—') + ' (' + msa.sequences + ' seq.)');
      });
    });
    if (!values.size) { announce('No chain of ' + displayName(entry) + ' matches a query sequence in the alignment' + (notes.length ? ' · ' + notes.join('; ') : ''), 'error'); return; }
    const all = [...values.values()];
    const names = { conservation: weighted ? 'MSA conservation (1 − H/log₂20, Henikoff-weighted)' : 'MSA conservation (1 − H/log₂20, unweighted)', identity: 'MSA identity to query', depth: 'MSA coverage (sequences)' };
    remember('MSA colouring');
    residueData = { values, byResi: new Map(), min: Math.min(...all), max: Math.max(...all), count: all.length, name: names[metric], scale: 'viridis', scope: 'source', entryId: entry.id, msa: { metric, weighted: metric === 'conservation' ? weighted : null, sequences: assets.map(asset => asset.parsed ? asset.parsed.sequences : 0) } };
    root.querySelector('#gpv-color-mode').value = 'data';
    renderDataState(); applyStyle();
    announce(residueData.name + ' on chain' + (covered.length === 1 ? ' ' : 's ') + clipText(covered.join(', '), 80) + (notes.length ? ' · ' + notes.join('; ') : ''));
  }

