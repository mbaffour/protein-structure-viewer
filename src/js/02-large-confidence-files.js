  /* ---------- Large confidence files ----------
     An AlphaFold 3 full_data file carries two N×N matrices: the PAE, which the viewer uses,
     and contact probabilities, which it does not. For a 4 400-token assembly that is 175 MB
     of JSON per model, and JSON.parse would build sixteen million boxed numbers for each
     matrix. This scanner reads the bytes once: the PAE is copied straight into Float32Array
     rows, the contact matrix is dropped, and JSON.parse only ever sees the small remainder.
     Measured on that assembly the browser heap fell from 2.2 GB to well under 1 GB. */
  const jsonWhitespace = code => code === 32 || code === 10 || code === 13 || code === 9;

  function findJsonKey(bytes, key) {
    const pattern = new TextEncoder().encode('"' + key + '"');
    const first = pattern[0]; const length = pattern.length;
    for (let i = 0; i <= bytes.length - length; i += 1) {
      if (bytes[i] !== first) continue;
      let matched = true;
      for (let k = 1; k < length; k += 1) { if (bytes[i + k] !== pattern[k]) { matched = false; break; } }
      if (!matched) continue;
      let j = i + length;
      while (j < bytes.length && jsonWhitespace(bytes[j])) j += 1;
      if (bytes[j] !== 58) continue;
      j += 1;
      while (j < bytes.length && jsonWhitespace(bytes[j])) j += 1;
      if (bytes[j] !== 91) continue;
      return { keyStart: i, valueStart: j };
    }
    return null;
  }

  /* Index of the bracket closing the array that opens at start, or -1 when the array holds
     strings or objects (then it is not a numeric matrix and is left to JSON.parse). */
  function matrixEnd(bytes, start) {
    let depth = 0;
    for (let i = start; i < bytes.length; i += 1) {
      const code = bytes[i];
      if (code === 91) depth += 1;
      else if (code === 93) { depth -= 1; if (depth === 0) return i; }
      else if (code === 34 || code === 123) return -1;
    }
    return -1;
  }

  function readFloatRows(bytes, start, end) {
    const rows = []; let row = null; let filled = 0; let depth = 0; let expected = 0;
    const push = value => {
      if (!row) return;
      if (filled === row.length) { const bigger = new Float32Array(Math.max(16, row.length * 2)); bigger.set(row); row = bigger; }
      row[filled] = value; filled += 1;
    };
    let i = start;
    while (i <= end) {
      const code = bytes[i];
      if (code === 91) { depth += 1; if (depth === 1 || depth === 2) { row = new Float32Array(expected || 1024); filled = 0; } i += 1; continue; }
      /* Depth 2 closes one row of a nested matrix. Depth 1 closing with numbers still in hand and no
         rows behind them means the array was flat, which is how ColabFold and AlphaFold2 WebGPU write
         predicted_aligned_error; the caller folds that single run back into a square. */
      if (code === 93) {
        if (depth === 2 && row) { rows.push(filled === row.length ? row : row.slice(0, filled)); expected = filled; row = null; }
        else if (depth === 1 && row && !rows.length && filled) { rows.push(row.slice(0, filled)); row = null; }
        depth -= 1; i += 1; continue;
      }
      if ((code >= 48 && code <= 57) || code === 45 || code === 43 || code === 46) {
        let j = i; let negative = false;
        if (code === 45 || code === 43) { negative = code === 45; j += 1; }
        let whole = 0; let fraction = 0; let scale = 1;
        while (j <= end && bytes[j] >= 48 && bytes[j] <= 57) { whole = whole * 10 + (bytes[j] - 48); j += 1; }
        if (bytes[j] === 46) { j += 1; while (j <= end && bytes[j] >= 48 && bytes[j] <= 57) { fraction = fraction * 10 + (bytes[j] - 48); scale *= 10; j += 1; } }
        let value = whole + fraction / scale;
        if (bytes[j] === 101 || bytes[j] === 69) {
          j += 1; let sign = 1; if (bytes[j] === 45) { sign = -1; j += 1; } else if (bytes[j] === 43) j += 1;
          let exponent = 0; while (j <= end && bytes[j] >= 48 && bytes[j] <= 57) { exponent = exponent * 10 + (bytes[j] - 48); j += 1; }
          value *= Math.pow(10, sign * exponent);
        }
        push(negative ? -value : value); i = j; continue;
      }
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) { /* null, NaN, Infinity */
        let j = i; while (j <= end && ((bytes[j] >= 65 && bytes[j] <= 90) || (bytes[j] >= 97 && bytes[j] <= 122))) j += 1;
        push(NaN); i = j; continue;
      }
      i += 1;
    }
    return rows;
  }

  /* L² values in one run, back into L rows. The residue count is taken from plddt when it is there,
     because a square root of a float count is a worse answer than the file's own length. */
  function squareFromFlatPae(flat, residueCount) {
    const side = Number.isInteger(residueCount) && residueCount > 0 && residueCount * residueCount === flat.length
      ? residueCount : Math.round(Math.sqrt(flat.length));
    if (!(side >= 1) || side * side !== flat.length) return null;
    const rows = new Array(side);
    /* slice, not subarray: a view keeps the whole L² buffer alive, and the session autosave
       structured-clones every row, which would write that buffer once per row. */
    for (let i = 0; i < side; i += 1) rows[i] = flat.slice(i * side, (i + 1) * side);
    return rows;
  }

  function parseConfidenceBytes(bytes) {
    const cuts = []; let pae = null;
    ['pae', 'predicted_aligned_error', 'contact_probs'].forEach(key => {
      const found = findJsonKey(bytes, key); if (!found) return;
      const end = matrixEnd(bytes, found.valueStart); if (end < 0) return;
      if (key !== 'contact_probs' && !pae) pae = readFloatRows(bytes, found.valueStart, end);
      cuts.push([found.valueStart, end]);
    });
    cuts.sort((a, b) => a[0] - b[0]);
    const decoder = new TextDecoder(); let text = ''; let position = 0;
    cuts.forEach(([start, end]) => { text += decoder.decode(bytes.subarray(position, start)) + 'null'; position = end + 1; });
    text += decoder.decode(bytes.subarray(position));
    const data = JSON.parse(text);
    const target = normalizeConfidenceJson(data);
    if (pae && pae.length && target && typeof target === 'object' && !Array.isArray(target)) {
      const square = pae.length === 1 && pae[0].length > 1
        ? squareFromFlatPae(pae[0], Array.isArray(target.plddt) ? target.plddt.length : null)
        : pae;
      if (square) target.pae = square;
    }
    return data;
  }

  function fileStem(path) {
    return path.split('/').pop().replace(/\.(pdb|cif|mmcif|json|csv)$/i, '');
  }

  function associationKey(path) {
    const stem = fileStem(path).toLowerCase();
    /* AlphaFold DB downloads: AF-P69905-F1-model_v6 and AF-P69905-F1-predicted_aligned_error_v6
       (or -confidence_v6) belong together; the version suffix carries no model index. */
    const database = stem.replace(/-(model|predicted_aligned_error|confidence)_v\d+$/, '');
    if (database !== stem) return database;
    /* AlphaFold2 WebGPU and ColabFold write job_unrelaxed_model_1.pdb beside job_scores.json and
       job_predicted_aligned_error_v1.json. Reduce all three to the job name, before the AlphaFold 3
       rule below, which would otherwise leave job_unrelaxed_model_1 as job_unrelaxed_1. */
    const folded = stem
      .replace(/_(?:un)?relaxed_model_\d+$/, '')
      .replace(/_scores$/, '')
      .replace(/_predicted_aligned_error_v\d+$/, '');
    if (folded !== stem) return folded;
    return stem.replace(/_(summary_confidences|confidences|full_data|model)(?:_(\d+))?$/, (_, marker, index) => index ? '_' + index : '');
  }

  function assetFitsEntry(asset, entry) {
    if (asset.collection && entry.collection && asset.collection !== entry.collection) return false;
    const assetKey = associationKey(asset.name);
    const entryKey = associationKey(entry.sourcePath || entry.name);
    if (assetKey === entryKey) return true;
    const assetBase = fileStem(asset.name).toLowerCase();
    const entryBase = fileStem(entry.name).toLowerCase();
    const ranked = entryBase.match(/^ranked_(\d+)$/);
    if (ranked && asset.rankIndex === Number(ranked[1])) return true;
    if (asset.modelName && (entryBase === asset.modelName.toLowerCase() || entryBase.endsWith('_' + asset.modelName.toLowerCase()))) return true;
    if (asset.seed !== undefined && asset.sample !== undefined) {
      return entryBase.includes('seed-' + asset.seed + '_sample-' + asset.sample);
    }
    return false;
  }

  function normalizeConfidenceJson(value) {
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'object') return value[0];
    return value;
  }

  function confidenceFromJson(raw) {
    const data = normalizeConfidenceJson(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const flat = Array.isArray(data.pae) ? data.pae : Array.isArray(data.predicted_aligned_error) ? data.predicted_aligned_error : null;
    const pae = flat && flat.length && typeof flat[0] === 'number'
      ? squareFromFlatPae(flat, Array.isArray(data.plddt) ? data.plddt.length : null) : flat;
    return {
      ptm: finiteNumber(data.ptm ?? data.predicted_tm_score),
      iptm: finiteNumber(data.iptm ?? data.interface_predicted_tm_score),
      rankingScore: finiteNumber(data.ranking_score ?? data.ranking_confidence),
      fractionDisordered: finiteNumber(data.fraction_disordered),
      hasClash: data.has_clash === undefined ? null : data.has_clash === true || Number(data.has_clash) === 1,
      pae,
      paeMaximum: pae ? matrixMaximum(pae) : null,
      tokenChainIds: Array.isArray(data.token_chain_ids) ? data.token_chain_ids : null,
      tokenResidueIds: Array.isArray(data.token_res_ids) ? data.token_res_ids : null,
      chainIds: Array.isArray(data.chain_ids) ? data.chain_ids : null,
      chainPairIptm: Array.isArray(data.chain_pair_iptm) ? data.chain_pair_iptm : null,
      chainPairPaeMin: Array.isArray(data.chain_pair_pae_min) ? data.chain_pair_pae_min : null
    };
  }

  function mergeConfidence(target, incoming) {
    if (!incoming) return target || {};
    const merged = { ...(target || {}) };
    Object.entries(incoming).forEach(([key, value]) => {
      if (value !== null && value !== undefined) merged[key] = value;
    });
    return merged;
  }

  function attachConfidenceAssets() {
    structures.forEach(entry => {
      confidenceAssets.filter(asset => assetFitsEntry(asset, entry)).forEach(asset => {
        entry.confidence = mergeConfidence(entry.confidence, asset.confidence);
        if (asset.rank !== null && asset.rank !== undefined) entry.rank = asset.rank;
      });
    });
    applyModelOrder();
    if (!root.querySelector('[data-gpv-panel="confidence"]').hidden) renderConfidence();
  }

  function applyModelOrder() {
    const mode = root.querySelector('#gpv-order').value;
    const value = entry => mode === 'ranking' ? finiteNumber(entry.confidence && entry.confidence.rankingScore) : mode === 'plddt' ? mean(entry.scores) : -entry.loadIndex;
    structures.sort((a, b) => {
      if (mode === 'loaded') return a.loadIndex - b.loadIndex;
      return (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || a.loadIndex - b.loadIndex;
    });
  }

  function renderConfidence() {
    const panel = root.querySelector('#gpv-confidence-panel');
    panel.hidden = structures.length === 0;
    const body = root.querySelector('#gpv-metrics');
    body.replaceChildren();
    structures.forEach(entry => {
      const row = document.createElement('tr');
      const values = [
        displayName(entry),
        formatMetric(mean(entry.scores), 1),
        formatMetric(entry.confidence && entry.confidence.ptm),
        formatMetric(entry.confidence && entry.confidence.iptm),
        formatMetric(entry.confidence && entry.confidence.rankingScore),
        entry.rank === null || entry.rank === undefined ? '—' : String(entry.rank),
        Object.prototype.hasOwnProperty.call(entry.confidence || {}, 'hasClash') ? (entry.confidence.hasClash ? 'Yes' : 'No') : '—'
      ];
      values.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.textContent = value;
        if (index > 0 && index < 6) cell.className = 'text-end';
        row.append(cell);
      });
      body.append(row);
    });
    drawPae(activeEntry());
  }

  function paeColor(value, maximum) {
    const t = Math.max(0, Math.min(1, value / Math.max(1, maximum)));
    const low = [0, 83, 214];
    const high = [255, 219, 19];
    return low.map((channel, index) => Math.round(channel + (high[index] - channel) * t));
  }

  function drawPae(entry) {
    renderDomains(entry);
    renderLigandSites(entry);
    const panel = root.querySelector('#gpv-pae-panel');
    const plot = root.querySelector('#gpv-pae-plot');
    const matrix = entry && entry.confidence && entry.confidence.pae;
    if (!Array.isArray(matrix) || !matrix.length || !isMatrixRow(matrix[0])) {
      plot.hidden = true;
      renderInterfaceMetrics(entry);
      return;
    }
    plot.hidden = false;
    const canvas = root.querySelector('#gpv-pae');
    const context = canvas.getContext('2d');
    const size = matrix.length;
    const image = context.createImageData(canvas.width, canvas.height);
    const maximum = finiteNumber(entry.confidence.paeMaximum) || matrixMaximum(matrix);
    for (let y = 0; y < canvas.height; y += 1) {
      const row = matrix[Math.min(size - 1, Math.floor(y * size / canvas.height))] || [];
      for (let x = 0; x < canvas.width; x += 1) {
        const value = finiteNumber(row[Math.min(row.length - 1, Math.floor(x * row.length / canvas.width))]) || 0;
        const color = paeColor(value, maximum);
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const chains = entry.confidence.tokenChainIds || [];
    context.save();
    context.strokeStyle = labelColors.getPropertyValue('--foreground').trim() || '#111827';
    context.globalAlpha = 0.7;
    context.lineWidth = 1;
    for (let index = 1; index < chains.length; index += 1) {
      if (chains[index] === chains[index - 1]) continue;
      const position = Math.round(index * canvas.width / size) + 0.5;
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, canvas.height);
      context.moveTo(0, position);
      context.lineTo(canvas.width, position);
      context.stroke();
    }
    context.restore();
    canvas.dataset.entryId = String(entry.id);
    canvas.dataset.maximum = String(maximum);
    canvas.setAttribute('aria-label', 'Predicted aligned error heatmap for ' + entry.name + ', ' + size + ' by ' + size + ' tokens, maximum ' + maximum.toFixed(1) + ' angstroms');
    root.querySelector('#gpv-pae-detail').textContent = entry.name + ' · ' + size + ' × ' + size + ' tokens · maximum ' + maximum.toFixed(1) + ' Å';
    renderInterfaceMetrics(entry);
  }

  function renderInterfaceMetrics(entry) {
    const panel = root.querySelector('#gpv-pae-panel');
    const wrap = root.querySelector('#gpv-interface-wrap');
    const body = root.querySelector('#gpv-interface-metrics');
    body.replaceChildren();
    const confidence = entry && entry.confidence || {};
    const iptm = confidence.chainPairIptm;
    const pae = confidence.chainPairPaeMin;
    const size = Math.max(Array.isArray(iptm) ? iptm.length : 0, Array.isArray(pae) ? pae.length : 0);
    const derivedChainIds = [...new Set(confidence.tokenChainIds || [])];
    const chainIds = confidence.chainIds && confidence.chainIds.length ? confidence.chainIds : derivedChainIds.length ? derivedChainIds : Array.from({ length: size }, (_, index) => String(index + 1));
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) {
        const row = document.createElement('tr');
        const values = [
          (chainIds[i] ?? i + 1) + '–' + (chainIds[j] ?? j + 1),
          formatMetric(iptm && iptm[i] && iptm[i][j]),
          formatMetric(pae && pae[i] && pae[i][j], 2)
        ];
        values.forEach((value, index) => {
          const cell = document.createElement(index === 0 ? 'th' : 'td');
          cell.textContent = value;
          if (index > 0) cell.className = 'text-end';
          row.append(cell);
        });
        body.append(row);
      }
    }
    wrap.hidden = body.children.length === 0;
    panel.hidden = root.querySelector('#gpv-pae-plot').hidden && wrap.hidden;
  }

  async function sha256(textValue) {
    if (!globalThis.crypto || !crypto.subtle) return null;
    const bytes = new TextEncoder().encode(textValue);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function downloadBlob(contents, type, filename) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    return '"' + String(value ?? '').replace(/"/g, '""') + '"';
  }

  function confidenceSourcesByEntry() {
    const sources = new Map(structures.map(entry => [entry.id, []]));
    confidenceAssets.forEach(asset => {
      structures.forEach(entry => { if (assetFitsEntry(asset, entry)) sources.get(entry.id).push(asset.name); });
    });
    return sources;
  }

  /* Per-residue pLDDT plot: one panel per chain, one line per displayed model,
     the four confidence bands shaded behind. */
  function plddtProfileSvg() {
    const entries = displayedEntries().filter(entry => entry.model && entry.scores.length).slice(0, 8);
    const chains = [...new Set(entries.flatMap(entry => residueRows(entry).map(row => row.chain)))].sort(compareChains).slice(0, 12);
    if (!entries.length || !chains.length) return null;
    const width = 1200; const left = 72; const right = 30; const top = 64; const rowHeight = 170; const gap = 40; const bottom = 40;
    const height = top + chains.length * rowHeight + (chains.length - 1) * gap + bottom;
    const ink = '#111827'; const muted = '#6b7280'; const grid = '#e5e7eb';
    const parts = [];
    const text = (x, y, value, size, anchor = 'start', weight = 400, fill = ink, extra = '') => '<text x="' + f(x) + '" y="' + f(y) + '" font-family="' + svgFont + '" font-size="' + size + '" font-weight="' + weight + '" text-anchor="' + anchor + '" fill="' + fill + '"' + extra + '>' + svgEscape(value) + '</text>';
    parts.push('<g id="title">' + text(left, 32, provenanceValues().title || 'Per-residue pLDDT', 20, 'start', 600) + '</g>');
    parts.push('<g id="models">');
    let cursor = width - right;
    svgMeasure.font = '500 12px ' + svgFont;
    [...entries].reverse().forEach(entry => {
      const label = clipText(displayName(entry), 30); const labelWidth = svgMeasure.measureText(label).width;
      cursor -= labelWidth; parts.push(text(cursor, 34, label, 12, 'start', 500));
      cursor -= 18; parts.push('<rect x="' + f(cursor) + '" y="24" width="12" height="12" rx="2" fill="' + entry.color + '"/>'); cursor -= 16;
    });
    parts.push('</g>');
    const plotWidth = width - left - right;
    chains.forEach((chain, index) => {
      const y0 = top + index * (rowHeight + gap);
      const rows = entries.map(entry => ({ entry, row: residueRows(entry).find(item => item.chain === chain) })).filter(item => item.row);
      const minResi = Math.min(...rows.map(item => item.row.residues[0].resi));
      const maxResi = Math.max(...rows.map(item => item.row.residues[item.row.residues.length - 1].resi));
      const x = resi => left + (maxResi === minResi ? 0 : (resi - minResi) / (maxResi - minResi) * plotWidth);
      const y = value => y0 + rowHeight - value / 100 * rowHeight;
      parts.push('<g id="chain-' + svgEscape(chain || 'none') + '">');
      [[0, 50, '#ff7d45'], [50, 70, '#ffdb13'], [70, 90, '#65cbf3'], [90, 100, '#0053d6']].forEach(([low, high, color]) => parts.push('<rect x="' + f(left) + '" y="' + f(y(high)) + '" width="' + f(plotWidth) + '" height="' + f(y(low) - y(high)) + '" fill="' + color + '" fill-opacity="0.12"/>'));
      [0, 50, 70, 90, 100].forEach(value => {
        parts.push('<line x1="' + f(left) + '" x2="' + f(left + plotWidth) + '" y1="' + f(y(value)) + '" y2="' + f(y(value)) + '" stroke="' + grid + '"/>');
        parts.push(text(left - 8, y(value) + 4, String(value), 11, 'end', 400, muted));
      });
      const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find(candidate => (maxResi - minResi) / candidate <= 14) || 1000;
      for (let resi = Math.ceil(minResi / step) * step; resi <= maxResi; resi += step) {
        parts.push('<line x1="' + f(x(resi)) + '" x2="' + f(x(resi)) + '" y1="' + f(y0 + rowHeight) + '" y2="' + f(y0 + rowHeight + 4) + '" stroke="' + muted + '"/>');
        parts.push(text(x(resi), y0 + rowHeight + 17, String(resi), 11, 'middle', 400, muted));
      }
      parts.push('<rect x="' + f(left) + '" y="' + f(y0) + '" width="' + f(plotWidth) + '" height="' + f(rowHeight) + '" fill="none" stroke="' + muted + '"/>');
      parts.push(text(left, y0 - 8, chain ? 'Chain ' + chain : 'Chain —', 13, 'start', 600));
      parts.push(text(left - 52, y0 + rowHeight / 2, 'pLDDT', 11, 'middle', 400, muted, ' transform="rotate(-90 ' + f(left - 52) + ' ' + f(y0 + rowHeight / 2) + ')"'));
      rows.forEach(item => {
        const d = item.row.residues.map((atom, position) => (position ? 'L' : 'M') + f(x(atom.resi)) + ' ' + f(y(Math.max(0, Math.min(100, Number(atom.b) || 0))))).join(' ');
        parts.push('<path d="' + d + '" fill="none" stroke="' + item.entry.color + '" stroke-width="' + (entries.length > 1 ? 1.6 : 2) + '" stroke-linejoin="round"/>');
      });
      parts.push('</g>');
    });
    return { svg: svgDocument(width, height, '#ffffff', parts.join('\n')), width, height };
  }

  function downloadProfileSvg() {
    const profile = plddtProfileSvg();
    if (!profile) { announce('No displayed model carries pLDDT scores', 'error'); return; }
    downloadBlob(profile.svg, 'image/svg+xml', 'plddt-profile.svg');
    updateStatus('pLDDT profile SVG downloaded');
  }

  async function downloadProfilePng() {
    const profile = plddtProfileSvg();
    if (!profile) { announce('No displayed model carries pLDDT scores', 'error'); return; }
    const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg));
    const scale = 2; const canvas = document.createElement('canvas');
    canvas.width = profile.width * scale; canvas.height = profile.height * scale;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    downloadBlob(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')), 'image/png', 'plddt-profile.png');
    updateStatus('pLDDT profile PNG downloaded');
  }

  function downloadConfidenceCsv() {
    if (!structures.length) { announce('Load a model before exporting confidence metrics', 'error'); return; }
    const sources = confidenceSourcesByEntry();
    const rows = [['model', 'source_archive', 'mean_plddt', 'ptm', 'iptm', 'ranking_score', 'rank', 'has_clash', 'confidence_sources']];
    structures.forEach(entry => {
      const confidence = entry.confidence || {};
      rows.push([entry.name, entry.collection ?? '', mean(entry.scores) ?? '', confidence.ptm ?? '', confidence.iptm ?? '', confidence.rankingScore ?? '', entry.rank ?? '', Object.prototype.hasOwnProperty.call(confidence, 'hasClash') ? confidence.hasClash : '', (sources.get(entry.id) || []).join('; ')]);
    });
    downloadBlob(rows.map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv', 'protein-confidence-metrics.csv');
    announce('Confidence CSV downloaded');
  }

  function entriesById() {
    return new Map(structures.map(entry => [entry.id, entry]));
  }

  function displayName(entry) {
    return entry.label || entry.name;
  }

  function entryById(id) {
    return structures.find(entry => entry.id === id) || null;
  }

  function activeEntry() {
    if (root.querySelector('#gpv-side-by-side').checked) return structures.find(entry => entry.id === Number(root.querySelector('#gpv-left-model').value)) || structures[0] || null;
    return structures.find(entry => entry.id === activeId && entry.visible) || structures.find(entry => entry.visible) || structures[0] || null;
  }

  function displayedEntries() {
    if (root.querySelector('#gpv-side-by-side').checked) {
      const left = structures.find(entry => entry.id === Number(root.querySelector('#gpv-left-model').value));
      return left ? [left] : [];
    }
    const visible = structures.filter(entry => entry.visible);
    if (root.querySelector('#gpv-view-mode').value === 'single') {
      const active = activeEntry();
      return active && active.visible ? [active] : [];
    }
    return visible;
  }

  function selectToolTab(name) {
    root.querySelectorAll('[data-gpv-tab]').forEach(button => {
      const selected = button.dataset.gpvTab === name;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    root.querySelectorAll('[data-gpv-panel]').forEach(panel => { panel.hidden = panel.dataset.gpvPanel !== name; });
    if (name === 'confidence') renderConfidence();
  }

  function backgroundSpec() {
    const mode = root.querySelector('#gpv-background').value;
    if (mode === 'transparent') return { color: '#ffffff', alpha: 0 };
    if (mode === 'dark') return { color: '#101827', alpha: 1 };
    if (mode === 'custom') return { color: root.querySelector('#gpv-background-color').value, alpha: 1 };
    return { color: '#ffffff', alpha: 1 };
  }

  /* Silhouette outline and depth cueing are properties of a viewer, not of a model, so
     every viewer that shows the scene — main, panels, export — gets them from one place. */
  function applyViewStyle(target) {
    if (!target || typeof target.setViewStyle !== 'function') return;
    const mode = root.querySelector('#gpv-outline').value;
    const background = backgroundSpec();
    const dark = background.alpha > 0 && hexLuminance(background.color) < 0.45;
    try {
      target.setViewStyle(mode === 'none' ? { style: 'none' } : { style: 'outline', color: dark ? '#f8fafc' : '#111827', width: mode === 'bold' ? 0.12 : 0.06 });
      if (typeof target.enableFog === 'function') target.enableFog(root.querySelector('#gpv-fog').checked);
    } catch (error) { /* an engine without the feature keeps the plain view */ }
  }

  function applyAppearance() {
    const background = backgroundSpec();
    root.querySelector('#gpv-background-color').disabled = root.querySelector('#gpv-background').value !== 'custom';
    viewer.setBackgroundColor(background.color, background.alpha);
    if (typeof viewer.setProjection === 'function') viewer.setProjection(root.querySelector('#gpv-projection').value);
    applyViewStyle(viewer);
    comparePanels.forEach(panel => {
      if (!panel.viewer) return;
      panel.viewer.setBackgroundColor(background.color, background.alpha);
      if (typeof panel.viewer.setProjection === 'function') panel.viewer.setProjection(root.querySelector('#gpv-projection').value);
      applyViewStyle(panel.viewer);
      panel.viewer.render();
    });
    viewer.render();
  }

