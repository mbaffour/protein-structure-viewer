  /* ---------- Interface geometry ---------- */

  const vdwRadii = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, SE: 1.9, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98 };
  const probeRadius = 1.4;
  /* 92 points on a unit sphere by golden-angle spiral — the classic Shrake–Rupley count. */
  const spherePoints = Array.from({ length: 92 }, (_, index) => {
    const y = 1 - (index / 91) * 2; const r = Math.sqrt(Math.max(0, 1 - y * y)); const theta = Math.PI * (3 - Math.sqrt(5)) * index;
    return [Math.cos(theta) * r, y, Math.sin(theta) * r];
  });

  function atomElement(atom) {
    return String(atom.elem || (atom.atom || '').replace(/[^A-Za-z]/g, '').slice(0, 1)).toUpperCase();
  }

  function atomRadius(atom) {
    return vdwRadii[atomElement(atom)] || 1.7;
  }

  function heavyAtoms(entry) {
    return entry.atoms.filter(atom => atomElement(atom) !== 'H' && atomElement(atom) !== 'D');
  }

  function spatialGrid(atoms, cell) {
    const cells = new Map();
    const keyOf = (x, y, z) => x + ',' + y + ',' + z;
    atoms.forEach((atom, index) => {
      const key = keyOf(Math.floor(atom.x / cell), Math.floor(atom.y / cell), Math.floor(atom.z / cell));
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(index);
    });
    return {
      near(atom) {
        const cx = Math.floor(atom.x / cell); const cy = Math.floor(atom.y / cell); const cz = Math.floor(atom.z / cell);
        const out = [];
        for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = cells.get(keyOf(cx + dx, cy + dy, cz + dz)); if (bucket) out.push(...bucket);
        }
        return out;
      }
    };
  }

  function squaredDistance(a, b) {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  }

  function solventAccessibleArea(atoms) {
    const radii = atoms.map(atom => atomRadius(atom) + probeRadius);
    const grid = spatialGrid(atoms, 2 * Math.max(...radii, 1));
    let total = 0;
    atoms.forEach((atom, index) => {
      const radius = radii[index];
      const neighbours = grid.near(atom).filter(other => other !== index && squaredDistance(atom, atoms[other]) < (radius + radii[other]) ** 2);
      let exposed = 0;
      for (const point of spherePoints) {
        const x = atom.x + point[0] * radius; const y = atom.y + point[1] * radius; const z = atom.z + point[2] * radius;
        let buried = false;
        for (const other of neighbours) {
          const candidate = atoms[other]; const limit = radii[other] * radii[other];
          if ((x - candidate.x) ** 2 + (y - candidate.y) ** 2 + (z - candidate.z) ** 2 < limit) { buried = true; break; }
        }
        if (!buried) exposed += 1;
      }
      total += 4 * Math.PI * radius * radius * exposed / spherePoints.length;
    });
    return total;
  }

  function contactSummary(atoms, cutoff) {
    const grid = spatialGrid(atoms, cutoff);
    const limit = cutoff * cutoff;
    const pairs = new Map();
    atoms.forEach((atom, index) => {
      const chain = atom.chain || '';
      grid.near(atom).forEach(other => {
        if (other <= index) return;
        const partner = atoms[other]; const partnerChain = partner.chain || '';
        if (partnerChain === chain || squaredDistance(atom, partner) > limit) return;
        const [first, second] = chain < partnerChain ? [atom, partner] : [partner, atom];
        const key = (first.chain || '') + '|' + (second.chain || '');
        if (!pairs.has(key)) pairs.set(key, { chains: [first.chain || '', second.chain || ''], contacts: 0, residuePairs: new Set(), residuesA: new Set(), residuesB: new Set() });
        const record = pairs.get(key);
        record.contacts += 1;
        record.residuePairs.add(first.resi + '|' + second.resi);
        record.residuesA.add(first.resi); record.residuesB.add(second.resi);
      });
    });
    return [...pairs.values()].sort((a, b) => b.contacts - a.contacts);
  }

  async function analyseInterfaces() {
    const entry = entryById(Number(root.querySelector('#gpv-interface-model').value)) || activeEntry();
    if (!entry) return;
    const cutoff = Number(root.querySelector('#gpv-interface-cutoff').value) || 4;
    const button = root.querySelector('#gpv-interface-run'); const state = root.querySelector('#gpv-interface-state');
    const done = setBusy('Analysing interfaces…');
    button.disabled = true; state.textContent = 'Finding contacts…';
    await afterPaint();
    try {
      if (!entry.model) materializeEntry(entry);
      const atoms = heavyAtoms(entry);
      const chains = [...new Set(atoms.map(atom => atom.chain || ''))];
      if (chains.length < 2) { interfaceResults = { entryId: entry.id, cutoff, rows: [] }; renderInterfaceResults(); state.textContent = displayName(entry) + ' has a single chain — no inter-chain interface to measure.'; return; }
      const rows = contactSummary(atoms, cutoff);
      const byChain = new Map(chains.map(chain => [chain, atoms.filter(atom => (atom.chain || '') === chain)]));
      const soloArea = new Map();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        state.textContent = 'Buried surface for ' + row.chains.join('–') + ' (' + (index + 1) + ' / ' + rows.length + ')…';
        await afterPaint();
        row.chains.forEach(chain => { if (!soloArea.has(chain)) soloArea.set(chain, solventAccessibleArea(byChain.get(chain))); });
        const together = solventAccessibleArea(byChain.get(row.chains[0]).concat(byChain.get(row.chains[1])));
        row.bsa = Math.max(0, soloArea.get(row.chains[0]) + soloArea.get(row.chains[1]) - together);
      }
      interfaceResults = { entryId: entry.id, cutoff, rows };
      renderInterfaceResults();
      state.textContent = rows.length ? rows.length + ' chain pair' + (rows.length === 1 ? '' : 's') + ' in contact at ' + cutoff.toFixed(1) + ' Å · ' + displayName(entry) : 'No inter-chain contacts within ' + cutoff.toFixed(1) + ' Å.';
      announce('Interface analysis finished · ' + rows.length + ' chain pair' + (rows.length === 1 ? '' : 's'));
    } catch (error) {
      announce('Interface analysis failed: ' + error.message, 'error');
    } finally {
      done(); button.disabled = structures.length === 0;
    }
  }

  function renderInterfaceResults() {
    const wrap = root.querySelector('#gpv-contacts-wrap'); const body = root.querySelector('#gpv-contacts-rows'); body.replaceChildren();
    const rows = interfaceResults ? interfaceResults.rows : [];
    wrap.hidden = rows.length === 0;
    root.querySelector('#gpv-interface-csv').disabled = rows.length === 0;
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const cells = [row.chains.join(' – '), String(row.contacts), String(row.residuePairs.size), row.residuesA.size + ' + ' + row.residuesB.size, Number.isFinite(row.bsa) ? row.bsa.toFixed(0) : '—'];
      cells.forEach((value, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = value; if (index > 0) cell.className = 'text-end'; tr.append(cell); });
      const action = document.createElement('td');
      const highlight = document.createElement('button'); highlight.className = 'btn btn-ghost'; highlight.type = 'button'; highlight.textContent = 'Highlight';
      highlight.addEventListener('click', () => highlightInterface(row));
      action.append(highlight); tr.append(action); body.append(tr);
    });
  }

  function highlightInterface(row) {
    const entryId = interfaceResults.entryId; const color = root.querySelector('#gpv-interface-color').value;
    const entry = entryById(entryId); if (!entry) return;
    remember('interface highlight');
    [[row.chains[0], row.residuesA], [row.chains[1], row.residuesB]].forEach(([chain, residues]) => {
      selectionRecords.push({ id: nextAnnotationId++, entryId, chain, residues: [...residues].sort((a, b) => a - b), action: 'highlight', color });
    });
    if (!entry.visible) entry.visible = true;
    renderSelectionList(); renderList(); applyStyle();
    updateStatus('Interface ' + row.chains.join('–') + ' highlighted on ' + displayName(entry) + ' · manage it in the Annotate tab');
  }

  function downloadInterfaceCsv() {
    if (!interfaceResults || !interfaceResults.rows.length) return;
    const entry = entryById(interfaceResults.entryId);
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const lines = [['model', 'chain_a', 'chain_b', 'cutoff_angstrom', 'atom_contacts', 'residue_pairs', 'interface_residues_a', 'interface_residues_b', 'buried_surface_area_A2', 'residues_a', 'residues_b'].join(',')];
    interfaceResults.rows.forEach(row => lines.push([entry ? entry.name : '', row.chains[0], row.chains[1], interfaceResults.cutoff, row.contacts, row.residuePairs.size, row.residuesA.size, row.residuesB.size, Number.isFinite(row.bsa) ? row.bsa.toFixed(1) : '', [...row.residuesA].sort((a, b) => a - b).join(' '), [...row.residuesB].sort((a, b) => a - b).join(' ')].map(quote).join(',')));
    downloadBlob(lines.join('\n'), 'text/csv', 'interface-geometry.csv');
    announce('Interface CSV downloaded');
  }

