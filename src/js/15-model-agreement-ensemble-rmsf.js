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

  function downloadRmsfCsv() {
    if (!ensembleSpread) return;
    const rows = [['chain', 'resi', 'models', 'ca_rmsf_angstrom']];
    [...ensembleSpread.values.entries()].sort((a, b) => compareChains(a[0].split('|')[0], b[0].split('|')[0]) || Number(a[0].split('|')[1]) - Number(b[0].split('|')[1]))
      .forEach(([tag, value]) => rows.push([tag.split('|')[0], tag.split('|')[1], ensembleSpread.count, value.toFixed(3)]));
    rows.push([]); rows.push(['# models', ensembleSpread.models.join(' | ')]);
    downloadBlob(rows.map(row => row.join(',')).join('\n'), 'text/csv', 'protein-ensemble-rmsf.csv');
    updateStatus('Per-residue RMSF downloaded for ' + ensembleSpread.values.size + ' residues across ' + ensembleSpread.count + ' models');
  }

