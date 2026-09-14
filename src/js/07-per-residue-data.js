  /* ---------- Per-residue data ---------- */

  let residueData = null;
  const dataScales = {
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    diverging: ['#2563eb', '#f8fafc', '#dc2626'],
    heat: ['#fff5f0', '#fb6a4a', '#67000d']
  };
  const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function gradientColor(stops, t) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    const position = clamped * (stops.length - 1); const index = Math.min(stops.length - 2, Math.floor(position)); const local = position - index;
    const a = hexToRgb(stops[index]); const b = hexToRgb(stops[index + 1]);
    return rgbToHex(a.map((channel, i) => channel + (b[i] - channel) * local));
  }
  const formatDataValue = value => Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);

  function parseResidueRows(rows) {
    const values = new Map(); const byResi = new Map();
    rows.forEach(row => { const chain = String(row[0] || '').trim(); const resi = Number(row[1]); const value = Number(row[2]); if (!Number.isFinite(resi) || !Number.isFinite(value)) return; if (chain) values.set(chain + '|' + resi, value); else byResi.set(resi, value); });
    const all = [...values.values(), ...byResi.values()];
    if (!all.length) return null;
    return { values, byResi, min: Math.min(...all), max: Math.max(...all), count: all.length };
  }

  /* CSV/TSV with a residue column and a numeric value column; chain optional. Header
     names are recognised loosely; a header-less table is read as resi,value or
     chain,resi,value. */
  function parseResidueTable(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (lines.length < 2) return null;
    const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, '')));
    const header = rows[0].map(cell => cell.toLowerCase());
    const numeric = cell => /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(cell || '');
    const headerless = header.every(cell => cell === '' || numeric(cell));
    let chainCol = -1; let resiCol = -1; let valueCol = -1;
    if (!headerless) {
      chainCol = header.findIndex(cell => ['chain', 'chain_id', 'asym', 'asym_id', 'auth_asym_id', 'label_asym_id'].includes(cell));
      resiCol = header.findIndex(cell => ['resi', 'residue', 'resid', 'res', 'position', 'pos', 'site', 'resnum', 'residue_number', 'auth_seq_id', 'seq_id', 'index'].includes(cell));
      const skip = new Set(['resn', 'aa', 'residue_name', 'wt', 'wild_type', 'mutation', 'name', 'label', 'chain', 'chain_id']);
      valueCol = header.findIndex((cell, index) => index !== chainCol && index !== resiCol && !skip.has(cell) && rows.slice(1).some(row => numeric(row[index])));
    }
    const body = headerless ? rows : rows.slice(1);
    if (resiCol < 0) { if (body[0] && body[0].length >= 3 && !numeric(body[0][0])) { chainCol = 0; resiCol = 1; valueCol = 2; } else { chainCol = -1; resiCol = 0; valueCol = 1; } }
    if (valueCol < 0) return null;
    return parseResidueRows(body.map(row => [chainCol >= 0 ? row[chainCol] : '', row[resiCol], row[valueCol]]));
  }

  function dataRange() {
    if (!residueData) return { min: 0, max: 1 };
    if (residueData.scale === 'diverging') { const limit = Math.max(Math.abs(residueData.min), Math.abs(residueData.max)) || 1; return { min: -limit, max: limit }; }
    return { min: residueData.min, max: residueData.max === residueData.min ? residueData.min + 1 : residueData.max };
  }

  function residueDataValue(entry, atom) {
    if (!residueData || !domainApplies(residueData, entry)) return undefined;
    const key = (atom.chain || '') + '|' + atom.resi;
    if (residueData.values.has(key)) return residueData.values.get(key);
    return residueData.byResi.get(atom.resi);
  }

  function dataColor(entry, atom) {
    const value = residueDataValue(entry, atom);
    if (value === undefined) return '#d1d5db';
    const range = dataRange();
    return gradientColor(dataScales[residueData.scale] || dataScales.viridis, (value - range.min) / (range.max - range.min || 1));
  }

  function setResidueData(table, nameHint) {
    const entry = activeEntry();
    if (!entry) { announce('Load a model before adding per-residue data', 'error'); return; }
    const name = (root.querySelector('#gpv-data-name').value.trim() || nameHint || 'Values').slice(0, 40);
    residueData = { ...table, name, scale: root.querySelector('#gpv-data-scale').value, scope: root.querySelector('#gpv-data-scope').value, entryId: entry.id };
    root.querySelector('#gpv-data-name').value = name;
    renderDataState(); applyStyle();
    announce(name + ': ' + table.count + ' values from ' + formatDataValue(table.min) + ' to ' + formatDataValue(table.max) + (table.values.size ? '' : ' (no chain column — applied to every chain)'));
  }

  function renderDataState() {
    const state = root.querySelector('#gpv-data-state');
    root.querySelector('#gpv-data-paint').disabled = !residueData;
    root.querySelector('#gpv-data-csv').disabled = !residueData;
    root.querySelector('#gpv-data-apply').disabled = !activeEntry();
    if (!residueData) { state.textContent = 'No per-residue data loaded.'; return; }
    const owner = entryById(residueData.entryId);
    state.textContent = residueData.name + ' · ' + residueData.count + ' values · ' + formatDataValue(residueData.min) + ' to ' + formatDataValue(residueData.max) + ' · ' + ({ viridis: 'viridis', diverging: 'diverging', heat: 'white–red' })[residueData.scale] + ' · ' + scopeNames[residueData.scope] + (owner ? ' (' + displayName(owner) + ')' : '');
  }

  function downloadResidueDataCsv() {
    if (!residueData) return;
    const owner = entryById(residueData.entryId); const entry = (owner && owner.model) ? owner : activeEntry();
    const names = new Map(); if (entry) entry.atoms.forEach(atom => { if (atom.atom === 'CA') names.set((atom.chain || '') + '|' + atom.resi, atom.resn || ''); });
    const rows = [['chain', 'resi', 'resn', residueData.name.replace(/[^\w()\-. ]+/g, ' ').trim() || 'value']];
    const sortKey = (a, b) => compareChains(a[0], b[0]) || a[1] - b[1];
    const entries = [...residueData.values.entries()].map(([key, value]) => { const [chain, resi] = key.split('|'); return [chain, Number(resi), value]; });
    residueData.byResi.forEach((value, resi) => entries.push(['', Number(resi), value]));
    entries.sort(sortKey).forEach(([chain, resi, value]) => rows.push([chain, resi, names.get(chain + '|' + resi) || '', Number.isInteger(value) ? String(value) : value.toFixed(6)]));
    downloadBlob(rows.map(row => row.map(csvCell).join(',')).join('\n'), 'text/csv', (residueData.name || 'residue-data').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) + '.csv');
    updateStatus('Per-residue data CSV downloaded · ' + (rows.length - 1) + ' rows');
  }

  function loadPastedData() {
    const table = parseResidueTable(root.querySelector('#gpv-data-text').value);
    if (!table) { announce('Could not read a residue column and a numeric value column from the pasted text', 'error'); return; }
    setResidueData(table, 'Pasted values');
  }

