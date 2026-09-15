  /* ---------- Model agreement (ensemble RMSF) ---------- */

  let ensembleSpread = null;
  const agreementBands = [[0.5, '#2563eb', '<0.5 Å'], [1, '#22c55e', '0.5–1 Å'], [2, '#eab308', '1–2 Å'], [4, '#f97316', '2–4 Å'], [Infinity, '#dc2626', '≥4 Å']];

  /* Per-residue root-mean-square fluctuation of Cα positions across the aligned
     models, keyed by chain|resi. Residues present in one model only are skipped. */
  function ensembleAgreement(entries) {
    if (entries.length < 2) return null;
    const perTag = new Map();
    entries.forEach(entry => entry.atoms.forEach(atom => {
      if (atom.atom !== 'CA' || atom.hetflag) return;
      const tag = residueTag(atom);
      if (!perTag.has(tag)) perTag.set(tag, []);
      perTag.get(tag).push([atom.x, atom.y, atom.z]);
    }));
    const values = new Map(); let max = 0;
    perTag.forEach((points, tag) => {
      if (points.length < 2) return;
      const centre = [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
      const rmsf = Math.sqrt(points.reduce((sum, point) => sum + (point[0] - centre[0]) ** 2 + (point[1] - centre[1]) ** 2 + (point[2] - centre[2]) ** 2, 0) / points.length);
      values.set(tag, rmsf); max = Math.max(max, rmsf);
    });
    return values.size ? { values, count: entries.length, models: entries.map(entry => entry.name), max } : null;
  }

  function agreementColor(atom) {
    const value = ensembleSpread ? ensembleSpread.values.get(residueTag(atom)) : undefined;
    if (value === undefined) return '#9ca3af';
    return agreementBands.find(([limit]) => value < limit)[1];
  }

  /* The RMSF profile: per-residue Cα spread across the aligned models, one panel per chain,
     the agreement bands as stripes behind the trace so the reader sees at a glance which
     stretches the models agree on. The ensemble figure's companion to the pLDDT profile. */
  function rmsfProfileSvg() {
    if (!ensembleSpread || !ensembleSpread.values.size) return null;
    const byChain = new Map();
    ensembleSpread.values.forEach((value, tag) => { const [chain, resi] = tag.split('|'); if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push({ resi: Number(resi), value }); });
    const chains = [...byChain.keys()].sort(compareChains).slice(0, 12);
    if (!chains.length) return null;
    const width = 1200; const left = 72; const right = 30; const top = 64; const rowHeight = 170; const gap = 40; const bottom = 40;
    const height = top + chains.length * rowHeight + (chains.length - 1) * gap + bottom;
    const ink = '#111827'; const muted = '#6b7280'; const grid = '#e5e7eb';
    const ceiling = Math.max(1, Math.ceil(ensembleSpread.max * 1.05 * 2) / 2);
    const parts = [];
    const text = (x, y, value, size, anchor = 'start', weight = 400, fill = ink, extra = '') => '<text x="' + f(x) + '" y="' + f(y) + '" font-family="' + svgFont + '" font-size="' + size + '" font-weight="' + weight + '" text-anchor="' + anchor + '" fill="' + fill + '"' + extra + '>' + svgEscape(value) + '</text>';
    parts.push('<g id="title">' + text(left, 32, (provenanceValues().title ? provenanceValues().title + ' · ' : '') + 'Per-residue Cα RMSF across ' + ensembleSpread.count + ' models', 20, 'start', 600) + '</g>');
    parts.push('<g id="bands">');
    let cursor = width - right; svgMeasure.font = '500 12px ' + svgFont;
    [...agreementBands].reverse().forEach(([, color, label]) => { const labelWidth = svgMeasure.measureText(label).width; cursor -= labelWidth; parts.push(text(cursor, 34, label, 12, 'start', 500)); cursor -= 18; parts.push('<rect x="' + f(cursor) + '" y="24" width="12" height="12" rx="2" fill="' + color + '"/>'); cursor -= 16; });
    parts.push('</g>');
    const plotWidth = width - left - right;
    chains.forEach((chain, index) => {
      const y0 = top + index * (rowHeight + gap);
      const residues = byChain.get(chain).sort((a, b) => a.resi - b.resi);
      const minResi = residues[0].resi; const maxResi = residues[residues.length - 1].resi;
      const x = resi => left + (maxResi === minResi ? 0 : (resi - minResi) / (maxResi - minResi) * plotWidth);
      const y = value => y0 + rowHeight - Math.min(ceiling, value) / ceiling * rowHeight;
      parts.push('<g id="chain-' + svgEscape(chain || 'none') + '">');
      let low = 0;
      agreementBands.forEach(([limit, color]) => { const high = Math.min(ceiling, limit); if (high > low) parts.push('<rect x="' + f(left) + '" y="' + f(y(high)) + '" width="' + f(plotWidth) + '" height="' + f(y(low) - y(high)) + '" fill="' + color + '" fill-opacity="0.12"/>'); low = high; });
      const tickStep = ceiling <= 2 ? 0.5 : ceiling <= 5 ? 1 : ceiling <= 12 ? 2 : 5;
      for (let value = 0; value <= ceiling + 1e-9; value += tickStep) {
        parts.push('<line x1="' + f(left) + '" x2="' + f(left + plotWidth) + '" y1="' + f(y(value)) + '" y2="' + f(y(value)) + '" stroke="' + grid + '"/>');
        parts.push(text(left - 8, y(value) + 4, String(Math.round(value * 10) / 10), 11, 'end', 400, muted));
      }
      const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].find(candidate => (maxResi - minResi) / candidate <= 14) || 1000;
      for (let resi = Math.ceil(minResi / step) * step; resi <= maxResi; resi += step) {
        parts.push('<line x1="' + f(x(resi)) + '" x2="' + f(x(resi)) + '" y1="' + f(y0 + rowHeight) + '" y2="' + f(y0 + rowHeight + 4) + '" stroke="' + muted + '"/>');
        parts.push(text(x(resi), y0 + rowHeight + 17, String(resi), 11, 'middle', 400, muted));
      }
      parts.push('<rect x="' + f(left) + '" y="' + f(y0) + '" width="' + f(plotWidth) + '" height="' + f(rowHeight) + '" fill="none" stroke="' + muted + '"/>');
      parts.push(text(left, y0 - 8, chain ? 'Chain ' + chain : 'Chain —', 13, 'start', 600));
      parts.push(text(left - 52, y0 + rowHeight / 2, 'RMSF (Å)', 11, 'middle', 400, muted, ' transform="rotate(-90 ' + f(left - 52) + ' ' + f(y0 + rowHeight / 2) + ')"'));
      const d = residues.map((item, position) => (position ? 'L' : 'M') + f(x(item.resi)) + ' ' + f(y(item.value))).join(' ');
      parts.push('<path d="' + d + ' L' + f(x(maxResi)) + ' ' + f(y(0)) + ' L' + f(x(minResi)) + ' ' + f(y(0)) + ' Z" fill="' + ink + '" fill-opacity="0.08"/>');
      parts.push('<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="1.8" stroke-linejoin="round"/>');
      parts.push('</g>');
    });
    return { svg: svgDocument(width, height, '#ffffff', parts.join('\n')), width, height };
  }
  function downloadRmsfProfileSvg() {
    const profile = rmsfProfileSvg();
    if (!profile) { announce('Align two or more models first (Compare → Align visible) to plot the RMSF', 'error'); return; }
    downloadBlob(profile.svg, 'image/svg+xml', 'rmsf-profile.svg'); updateStatus('RMSF profile SVG downloaded');
  }
  async function downloadRmsfProfilePng() {
    const profile = rmsfProfileSvg();
    if (!profile) { announce('Align two or more models first (Compare → Align visible) to plot the RMSF', 'error'); return; }
    const plan = exportDimensions(); const scale = Math.max(1, plan.width / profile.width);
    const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(profile.width * scale); canvas.height = Math.round(profile.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), plan.dpi), 'image/png', exportFileName('rmsf-profile', plan, 'png'));
    updateStatus('RMSF profile PNG downloaded · ' + canvas.width + ' × ' + canvas.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi' : ''));
  }

  function downloadRmsfCsv() {
    if (!ensembleSpread) return;
    const rows = [['chain', 'resi', 'models', 'ca_rmsf_angstrom']];
    [...ensembleSpread.values.entries()].sort((a, b) => compareChains(a[0].split('|')[0], b[0].split('|')[0]) || Number(a[0].split('|')[1]) - Number(b[0].split('|')[1]))
      .forEach(([tag, value]) => rows.push([tag.split('|')[0], tag.split('|')[1], ensembleSpread.count, value.toFixed(3)]));
    rows.push([]); rows.push(['# models', ensembleSpread.models.join(' | ')]);
    downloadBlob(rows.map(row => row.join(',')).join('\n'), 'text/csv', 'protein-ensemble-rmsf.csv');
    updateStatus('Per-residue RMSF downloaded for ' + ensembleSpread.values.size + ' residues across ' + ensembleSpread.count + ' models');
  }

