  /* ---------- Composition ---------- */

  function heteroInventory(entry) {
    const groups = new Map();
    entry.atoms.forEach(atom => {
      if (!atom.hetflag || isWater(atom)) return;
      const name = String(atom.resn || '?').toUpperCase();
      if (!groups.has(name)) groups.set(name, new Set());
      groups.get(name).add((atom.chain || '') + '|' + atom.resi);
    });
    return [...groups.entries()].map(([name, set]) => [name, set.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function renderComposition() {
    const entry = activeEntry();
    contactChainOptions(entry);
    renderMsaState();
    const wrap = root.querySelector('#gpv-composition');
    if (!entry || !entry.model) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const body = root.querySelector('#gpv-chain-rows'); body.replaceChildren();
    const hidden = entry.hiddenChains || [];
    residueRows(entry).forEach(row => {
      const tr = document.createElement('tr');
      const chainCell = document.createElement('th');
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'form-control-color gpv-chain-color';
      swatch.value = chainColor(row.chain);
      swatch.setAttribute('aria-label', 'Colour for chain ' + (row.chain || '—'));
      swatch.title = 'Set a custom colour for this chain — used in Chain colour mode everywhere (view, panels, sequence strip, legends, exports). Double-click to reset to the default colour.';
      swatch.addEventListener('input', () => { setChainColor(row.chain, swatch.value); root.querySelector('#gpv-color-mode').value = 'chain'; applyStyle(); });
      swatch.addEventListener('change', () => updateStatus('Chain ' + (row.chain || '—') + ' colour set'));
      swatch.addEventListener('dblclick', event => {
        event.preventDefault();
        resetChainColor(row.chain);
        swatch.value = chainColor(row.chain);
        root.querySelector('#gpv-color-mode').value = 'chain';
        applyStyle();
        updateStatus('Chain ' + (row.chain || '—') + ' colour reset to default');
      });
      chainCell.append(swatch, document.createTextNode(row.chain || '—')); tr.append(chainCell);
      const count = document.createElement('td'); count.className = 'text-end'; count.textContent = String(row.residues.length); tr.append(count);
      const range = document.createElement('td'); range.textContent = row.residues[0].resi + '–' + row.residues[row.residues.length - 1].resi; tr.append(range);
      const confidence = document.createElement('td'); confidence.className = 'text-end';
      confidence.textContent = entry.scores.length ? (mean(row.residues.map(atom => Number(atom.b) || 0)) || 0).toFixed(1) : '—'; tr.append(confidence);
      const toggleCell = document.createElement('td');
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'form-check-input'; toggle.checked = !hidden.includes(row.chain);
      toggle.setAttribute('aria-label', 'Show chain ' + (row.chain || '—'));
      toggle.addEventListener('change', () => {
        entry.hiddenChains = toggle.checked ? (entry.hiddenChains || []).filter(chain => chain !== row.chain) : [...new Set([...(entry.hiddenChains || []), row.chain])];
        applyStyle();
        updateStatus((toggle.checked ? 'Showing' : 'Hiding') + ' chain ' + (row.chain || '—') + ' of ' + displayName(entry));
      });
      const wrapper = document.createElement('label'); wrapper.className = 'form-check form-switch gpv-chain-switch'; wrapper.append(toggle);
      toggleCell.append(wrapper); tr.append(toggleCell);
      const fadeCell = document.createElement('td');
      const fade = document.createElement('input'); fade.type = 'checkbox'; fade.className = 'form-check-input'; fade.checked = (entry.fadedChains || []).includes(row.chain);
      fade.setAttribute('aria-label', 'Fade chain ' + (row.chain || '—'));
      fade.addEventListener('change', () => {
        entry.fadedChains = fade.checked ? [...new Set([...(entry.fadedChains || []), row.chain])] : (entry.fadedChains || []).filter(chain => chain !== row.chain);
        applyStyle();
        updateStatus((fade.checked ? 'Faded' : 'Restored') + ' chain ' + (row.chain || '—') + ' of ' + displayName(entry));
      });
      const fadeWrap = document.createElement('label'); fadeWrap.className = 'form-check form-switch gpv-chain-switch'; fadeWrap.append(fade);
      fadeCell.append(fadeWrap); tr.append(fadeCell);
      body.append(tr);
    });
    const inventory = heteroInventory(entry);
    root.querySelector('#gpv-hetero-summary').textContent = inventory.length
      ? 'Ligands and ions: ' + inventory.slice(0, 12).map(([name, count]) => name + (count > 1 ? ' ×' + count : '')).join(', ') + (inventory.length > 12 ? ' and ' + (inventory.length - 12) + ' more' : '')
      : 'No ligands or ions (water is not counted).';
    root.querySelector('#gpv-chains-all').disabled = hidden.length === 0 && !(entry.fadedChains || []).length;
    const groups = entityGroups(entry); const size = assemblyDimensions(entry);
    root.querySelector('#gpv-assembly-summary').textContent = (groups.length ? 'Stoichiometry: ' + groups.map(group => group.label + ' ×' + group.chains.length + ' (' + clipText(group.chains.join(', '), 30) + ', ' + group.length + ' aa)').join(' · ') : '')
      + (size ? (groups.length ? ' · ' : '') + 'Cα extent ' + (size.exact ? '' : '≥ ') + (size.extent / 10).toFixed(1) + ' nm · radius of gyration ' + (size.gyration / 10).toFixed(1) + ' nm' : '');
  }


