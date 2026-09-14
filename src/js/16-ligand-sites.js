  /* ---------- Ligand sites ---------- */

  let siteResults = null;

  function ligandGroups(entry) {
    const groups = new Map();
    heavyAtoms(entry).forEach(atom => {
      if (!atom.hetflag || isWater(atom)) return;
      const resn = String(atom.resn || '?').toUpperCase(); const key = (atom.chain || '') + '|' + atom.resi + '|' + resn;
      if (!groups.has(key)) groups.set(key, { chain: atom.chain || '', resi: atom.resi, resn, atoms: [] });
      groups.get(key).atoms.push(atom);
    });
    return [...groups.values()];
  }

  /* chain|resi -> PAE token indices, including ligand tokens when the matrix has
     AlphaFold 3 token ids (ligands are tokenised per atom, all sharing one residue id). */
  function paeTokenIndex(entry) {
    const confidence = entry.confidence || {}; const matrix = confidence.pae;
    if (!Array.isArray(matrix) || !matrix.length) return null;
    const index = new Map();
    const add = (tag, i) => { if (!tag) return; if (!index.has(tag)) index.set(tag, []); index.get(tag).push(i); };
    if (Array.isArray(confidence.tokenChainIds) && Array.isArray(confidence.tokenResidueIds) && confidence.tokenChainIds.length === matrix.length) {
      confidence.tokenChainIds.forEach((chain, i) => add(String(chain) + '|' + Number(confidence.tokenResidueIds[i]), i));
      return index;
    }
    const tags = paeTokens(entry); if (!tags) return null;
    tags.forEach((tag, i) => add(tag, i));
    return index;
  }

  function analyseLigandSites() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const cutoff = Math.min(8, Math.max(2, Number(root.querySelector('#gpv-site-cutoff').value) || 4.5));
    const groups = ligandGroups(entry);
    if (!groups.length) { siteResults = null; renderLigandSites(entry); updateStatus('No ligands or ions in ' + displayName(entry)); return; }
    const protein = heavyAtoms(entry).filter(atom => !atom.hetflag);
    const grid = spatialGrid(protein, cutoff); const limit = cutoff * cutoff;
    const tokenIndex = paeTokenIndex(entry); const matrix = entry.confidence && entry.confidence.pae;
    const rows = groups.map(group => {
      const residues = new Map();
      group.atoms.forEach(target => grid.near(target).forEach(i => { const atom = protein[i]; if (squaredDistance(atom, target) <= limit) { const tag = residueTag(atom); if (!residues.has(tag)) residues.set(tag, atom); } }));
      const site = [...residues.values()].sort((a, b) => compareChains(a.chain || '', b.chain || '') || a.resi - b.resi);
      const plddt = entry.scores.length && site.length ? mean(site.map(atom => Number(atom.b) || 0)) : null;
      let pae = null;
      if (tokenIndex && matrix) {
        const ligandTokens = tokenIndex.get(group.chain + '|' + group.resi) || [];
        const siteTokens = site.flatMap(atom => tokenIndex.get(residueTag(atom)) || []);
        if (ligandTokens.length && siteTokens.length) {
          let sum = 0; let count = 0;
          ligandTokens.forEach(i => siteTokens.forEach(j => { const a = Number(matrix[i] && matrix[i][j]); const b = Number(matrix[j] && matrix[j][i]); if (Number.isFinite(a) && Number.isFinite(b)) { sum += (a + b) / 2; count += 1; } }));
          pae = count ? sum / count : null;
        }
      }
      return { group, site, plddt, pae };
    }).sort((a, b) => b.group.atoms.length - a.group.atoms.length || compareChains(a.group.chain, b.group.chain) || a.group.resi - b.group.resi);
    siteResults = { entryId: entry.id, cutoff, rows };
    renderLigandSites(entry);
    updateStatus(rows.length + ' ligand site' + (rows.length === 1 ? '' : 's') + ' analysed at ' + cutoff + ' Å on ' + displayName(entry));
  }

  function siteLabel(group) { return group.resn + ' ' + (group.chain ? group.chain + ':' : '') + group.resi; }
  function siteResidueList(site) { return site.map(atom => (atom.chain ? atom.chain + ':' : '') + (atom.resn || '') + atom.resi).join('; '); }

  function renderLigandSites(entry) {
    const run = root.querySelector('#gpv-site-run'); const state = root.querySelector('#gpv-site-state');
    const wrap = root.querySelector('#gpv-site-wrap'); const body = root.querySelector('#gpv-site-rows'); body.replaceChildren();
    const groups = entry && entry.model ? ligandGroups(entry) : [];
    run.disabled = !groups.length;
    const results = siteResults && entry && siteResults.entryId === entry.id ? siteResults : null;
    root.querySelector('#gpv-site-csv').disabled = !results;
    if (!entry || !entry.model) { wrap.hidden = true; state.textContent = 'Show a model with ligands or ions.'; return; }
    if (!groups.length) { wrap.hidden = true; state.textContent = displayName(entry) + ' has no ligands or ions (water is not counted).'; return; }
    if (!results) { wrap.hidden = true; state.textContent = groups.length + ' ligand or ion group' + (groups.length === 1 ? '' : 's') + ' · choose a cutoff and analyse.'; return; }
    wrap.hidden = false;
    state.textContent = results.rows.length + ' site' + (results.rows.length === 1 ? '' : 's') + ' at ' + results.cutoff + ' Å' + (results.rows.some(row => row.pae !== null) ? ' · ligand–site PAE is the mean over ligand-token × site-residue pairs (a summary, not validated against a reference)' : entry.confidence && entry.confidence.pae ? ' · the PAE matrix carries no ligand tokens' : '');
    results.rows.forEach(row => {
      const tr = document.createElement('tr');
      const name = document.createElement('th'); name.textContent = siteLabel(row.group); name.title = siteResidueList(row.site); tr.append(name);
      [[String(row.group.atoms.length), 'text-end'], [String(row.site.length), 'text-end'], [row.plddt === null ? '—' : row.plddt.toFixed(1), 'text-end'], [row.pae === null ? '—' : row.pae.toFixed(2), 'text-end']].forEach(([value, className]) => { const td = document.createElement('td'); td.className = className; td.textContent = value; tr.append(td); });
      const action = document.createElement('td'); const highlight = document.createElement('button'); highlight.className = 'btn btn-ghost'; highlight.type = 'button'; highlight.textContent = 'Highlight';
      highlight.disabled = !row.site.length;
      highlight.addEventListener('click', () => {
        remember('ligand site');
        const byChain = new Map(); row.site.forEach(atom => { const chain = atom.chain || ''; if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push(atom.resi); });
        byChain.forEach((residues, chain) => selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain, residues: residues.sort((a, b) => a - b), action: 'highlight', color: root.querySelector('#gpv-interface-color').value }));
        renderSelectionList(); applyStyle();
        updateStatus(siteLabel(row.group) + ' site highlighted · ' + row.site.length + ' residues');
      });
      action.append(highlight); tr.append(action); body.append(tr);
    });
  }

  function downloadSitesCsv() {
    const entry = activeEntry(); if (!siteResults || !entry) return;
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const rows = [['model', 'ligand', 'chain', 'resi', 'ligand_atoms', 'cutoff_angstrom', 'site_residue_count', 'site_mean_plddt', 'ligand_site_mean_pae', 'site_residues']];
    siteResults.rows.forEach(row => rows.push([displayName(entry), row.group.resn, row.group.chain, row.group.resi, row.group.atoms.length, siteResults.cutoff, row.site.length, row.plddt === null ? '' : row.plddt.toFixed(2), row.pae === null ? '' : row.pae.toFixed(3), siteResidueList(row.site)]));
    downloadBlob(rows.map(row => row.map(quote).join(',')).join('\n'), 'text/csv', 'ligand-sites.csv');
    updateStatus('Ligand sites CSV downloaded');
  }

