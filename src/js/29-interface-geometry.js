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

  /* Residues are kept as the file numbers them (100, 100A), so an antibody's 100, 100A and 100B are
     three interface residues and three pairs, not one; keyed by number alone, a contact at 100A
     counted once for all three, Highlight lit 100 and 100B with it and the CSV wrote "100". */
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
        record.residuePairs.add(residueNumber(first) + '|' + residueNumber(second));
        record.residuesA.add(residueNumber(first)); record.residuesB.add(residueNumber(second));
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
      /* Water is solvent, not a side of an interface. A crystal structure's waters carry the protein
         chains' letters, so they were counted as contacts, listed as interface residues (barnase
         "residue 241") and buried as surface: 1BRS A–D read 280 contacts and 2289 Å² where the
         protein–protein interface is 165 and about 1550 Å². PDBePISA leaves water out of interface
         areas the same way. Ligands and ions stay with their chain: a bound cofactor at an interface
         is part of it, and a predicted model's ligand chain is a partner of its own. */
      const atoms = heavyAtoms(entry).filter(atom => !isWater(atom));
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
      /* The hydrogen bonds and salt bridges of every pair, by 29a's definitions, from the same press. */
      state.textContent = 'Hydrogen bonds and salt bridges…'; await afterPaint();
      const histidineCharged = polarHistidineCharged();
      polarInterfaceRows(entry, rows, byChain, histidineCharged);
      interfaceResults = { entryId: entry.id, cutoff, rows, histidineCharged };
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
    root.querySelector('#gpv-interface-polar-csv').disabled = !rows.some(row => row.polar && row.polar.length);
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const counts = row.polar ? polarCounts(row.polar) : null;
      const cells = [row.chains.join(' – '), String(row.contacts), String(row.residuePairs.size), row.residuesA.size + ' + ' + row.residuesB.size, Number.isFinite(row.bsa) ? row.bsa.toFixed(0) : '—', counts ? String(counts.hbonds) : '—', counts ? String(counts.salts) : '—'];
      cells.forEach((value, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = value; if (index > 0) cell.className = 'text-end'; tr.append(cell); });
      const action = document.createElement('td');
      const highlight = document.createElement('button'); highlight.className = 'btn btn-ghost'; highlight.type = 'button'; highlight.textContent = 'Highlight';
      highlight.title = 'Highlight this interface’s residues in the Annotate tab’s Highlight colour';
      highlight.addEventListener('click', () => highlightInterface(row));
      /* Highlight stays the row's first button (the suite presses it as the first). */
      const show = document.createElement('button'); show.className = 'btn btn-ghost'; show.type = 'button'; show.textContent = 'Show interactions';
      show.title = 'Draw this pair’s hydrogen bonds (blue) and salt bridges (red) as dashed lines with their side chains as sticks, in one undo step';
      show.disabled = !row.polar || !row.polar.length;
      show.addEventListener('click', () => showInterfaceInteractions(row));
      const hide = document.createElement('button'); hide.className = 'btn btn-ghost'; hide.type = 'button'; hide.textContent = 'Hide interactions';
      hide.title = 'Remove the hydrogen bonds and salt bridges drawn between these two chains, and nothing else, in one undo step';
      hide.addEventListener('click', () => hideInterfaceInteractions(row));
      action.append(highlight, show, hide); tr.append(action); body.append(tr);
    });
  }

  /* A side's residues back as { resi, icode }, in residue order: 99, 100, 100A, 100B, 101. */
  function interfaceResidueItems(residues) {
    return [...residues].map(value => { const match = String(value).match(/^(-?\d+)(.*)$/); return match ? { resi: Number(match[1]), icode: match[2] } : { resi: Number(value), icode: '' }; })
      .sort((a, b) => a.resi - b.resi || (a.icode < b.icode ? -1 : a.icode > b.icode ? 1 : 0));
  }

  function highlightInterface(row) {
    /* One highlight colour for the whole viewer: Annotate's, as the contact map, the card, Near and
       Ligand sites use. Interfaces had a colour well of its own until 2.52.0. */
    const entryId = interfaceResults.entryId; const color = root.querySelector('#gpv-selection-color').value;
    const entry = entryById(entryId); if (!entry) return;
    remember('interface highlight');
    [[row.chains[0], row.residuesA], [row.chains[1], row.residuesB]].forEach(([chain, residues]) => {
      selectionRecords.push({ id: nextAnnotationId++, entryId, chain, ...selectionResidues(interfaceResidueItems(residues)), action: 'highlight', color });
    });
    if (!entry.visible) entry.visible = true;
    renderSelectionList(); renderList(); applyStyle();
    updateStatus('Interface ' + row.chains.join('–') + ' highlighted on ' + displayName(entry) + ' · manage it in the Annotate tab');
  }

  function downloadInterfaceCsv() {
    if (!interfaceResults || !interfaceResults.rows.length) return;
    const entry = entryById(interfaceResults.entryId);
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    /* The counts of hydrogen bonds and salt bridges come last, so every earlier column keeps its place. */
    const lines = [['model', 'chain_a', 'chain_b', 'cutoff_angstrom', 'atom_contacts', 'residue_pairs', 'interface_residues_a', 'interface_residues_b', 'buried_surface_area_A2', 'residues_a', 'residues_b', 'hbonds', 'salt_bridges'].join(',')];
    interfaceResults.rows.forEach(row => {
      const counts = row.polar ? polarCounts(row.polar) : null;
      lines.push([entry ? entry.name : '', row.chains[0], row.chains[1], interfaceResults.cutoff, row.contacts, row.residuePairs.size, row.residuesA.size, row.residuesB.size, Number.isFinite(row.bsa) ? row.bsa.toFixed(1) : '', interfaceResidueItems(row.residuesA).map(residueNumber).join(' '), interfaceResidueItems(row.residuesB).map(residueNumber).join(' '), counts ? counts.hbonds : '', counts ? counts.salts : ''].map(quote).join(','));
    });
    downloadBlob(lines.join('\n'), 'text/csv', 'interface-geometry.csv');
    announce('Interface CSV downloaded');
  }


  /* ---------- Hydrogen bonds and salt bridges, drawn (2.53.0) ----------
     29a finds them; this draws them. An interaction is an ordinary measurement record — a two-atom
     distance — that also says what it is (`interaction: 'hbond'|'salt'`) and carries its type's colour,
     dashed, with its value: so the list, the editor, Clear, undo, scenes, sessions, share links, the
     PNG, the SVG and the report treat it as they treat any measurement, and the legend names it (31).
     The side chains of the residues it joins are drawn as sticks for as long as it exists: derived
     from the records each time a model is styled (polarStyleSticks), so nothing else is stored. */

  /* Annotate → Interfaces' "Count histidine as charged": off unless ticked. */
  function polarHistidineCharged() {
    const box = root.querySelector('#gpv-interface-histidine');
    return Boolean(box && box.checked);
  }

  function polarTypeColor(type) {
    return type === 'hbond' ? '#0284c7' : type === 'salt' ? '#dc2626' : null;
  }

  function polarTypeName(type, form = 'legend') {
    if (form === 'short') return type === 'hbond' ? 'H-bond' : type === 'salt' ? 'Salt bridge' : '';
    return type === 'hbond' ? 'Hydrogen bond' : type === 'salt' ? 'Salt bridge' : '';
  }

  /* The interactions of every analysed chain pair, from the chains' own atoms (water already out). */
  function polarInterfaceRows(entry, rows, byChain, histidineCharged) {
    const context = polarModel(entry, histidineCharged);
    rows.forEach(row => { row.polar = polarInteractions(byChain.get(row.chains[0]) || [], byChain.get(row.chains[1]) || [], { context }); });
  }

  /* A measurement record for one interaction: its type's colour, dashed, the value shown unless the
     press draws more than polarValueLimit at once. */
  function polarRecord(entry, item, showValue) {
    return { id: nextAnnotationId++, type: 'distance', points: [atomReference(entry, item.a), atomReference(entry, item.b)], interaction: item.type, color: polarTypeColor(item.type), dashed: true, showValue };
  }

  /* Draws a list of interactions in one undo step and says what it drew — "12 hydrogen bonds and 3
     salt bridges drawn between A and D". A pair of atoms already measured (an earlier press, the card,
     a measurement made by hand) is not drawn again on top of itself; with nothing new the press adds
     nothing and says so, as Measure all does. */
  function drawPolarInteractions(entry, list, where) {
    if (!list.length) { updateStatus('No hydrogen bonds or salt bridges ' + where); return; }
    const measured = new Set(measurementRecords.map(measuredPairKey).filter(Boolean));
    const many = list.length > polarValueLimit;
    const fresh = list.map(item => polarRecord(entry, item, !many)).filter(record => { const key = measuredPairKey(record); if (measured.has(key)) return false; measured.add(key); return true; });
    if (!fresh.length) { updateStatus('Already drawn: ' + polarCountText(polarCounts(list)) + ' ' + where + ' · nothing added'); return; }
    remember('hydrogen bonds and salt bridges');
    fresh.forEach(record => measurementRecords.push(record));
    if (!entry.visible) { entry.visible = true; renderList(); }
    renderMeasurementList(); applyStyle();
    const counts = polarCounts(fresh.map(record => ({ type: record.interaction })));
    const already = list.length - fresh.length;
    updateStatus(polarCountText(counts).replace(/^./, letter => letter.toUpperCase()) + ' drawn ' + where + (already ? ' · ' + already + ' already drawn' : '') + (many ? ' · more than ' + polarValueLimit + ', so without their values — Show value on a row brings one back' : ' · Separate labels if the values crowd') + ' · one undo step');
  }

  function showInterfaceInteractions(row) {
    const entry = interfaceResults && entryById(interfaceResults.entryId);
    if (!entry || !row.polar) return;
    drawPolarInteractions(entry, row.polar, 'between ' + row.chains[0] + ' and ' + row.chains[1]);
  }

  /* The interaction records between two chains of a model — whichever press drew them. */
  function polarPairRecords(entryId, chains) {
    const wanted = chains.slice().sort().join('|');
    return measurementRecords.filter(record => record.interaction && record.points.length === 2 && record.points.every(point => point.entryId === entryId) && record.points.map(point => point.chain || '').sort().join('|') === wanted);
  }

  function hideInterfaceInteractions(row) {
    if (!interfaceResults) return;
    const gone = polarPairRecords(interfaceResults.entryId, row.chains);
    if (!gone.length) { updateStatus('No hydrogen bonds or salt bridges are drawn between ' + row.chains[0] + ' and ' + row.chains[1]); return; }
    remember('hiding hydrogen bonds and salt bridges');
    const drop = new Set(gone);
    measurementRecords = measurementRecords.filter(record => !drop.has(record));
    renderMeasurementList(); applyStyle();
    updateStatus(polarCountText(polarCounts(gone.map(record => ({ type: record.interaction })))).replace(/^./, letter => letter.toUpperCase()) + ' between ' + row.chains[0] + ' and ' + row.chains[1] + ' removed · one undo step');
  }

  /* One row per interaction of every analysed pair. `donor` says which atom donates a hydrogen bond
     — a, b, or either when both atoms can — and for a salt bridge which atom is the cation. */
  function downloadInteractionsCsv() {
    if (!interfaceResults || !interfaceResults.rows.some(row => row.polar && row.polar.length)) return;
    const entry = entryById(interfaceResults.entryId);
    const lines = [['model', 'chain_a', 'resi_a', 'resn_a', 'atom_a', 'chain_b', 'resi_b', 'resn_b', 'atom_b', 'type', 'distance_angstrom', 'donor', 'by_element'].join(',')];
    let count = 0;
    interfaceResults.rows.forEach(row => (row.polar || []).forEach(item => {
      count += 1;
      const donor = item.donor === item.a ? 'a' : item.donor === item.b ? 'b' : 'either';
      lines.push([entry ? entry.name : '', item.a.chain || '', residueNumber(item.a), item.a.resn || '', item.a.atom || '', item.b.chain || '', residueNumber(item.b), item.b.resn || '', item.b.atom || '', item.type === 'hbond' ? 'hydrogen bond' : 'salt bridge', item.distance.toFixed(3), donor, item.byElement ? 'yes' : 'no'].map(csvCell).join(','));
    }));
    downloadBlob(lines.join('\n'), 'text/csv', 'interface-interactions.csv');
    announce('Interactions CSV downloaded · ' + count + ' row' + (count === 1 ? '' : 's'));
  }

  /* A new histidine rule is a new answer: the analysed pairs are counted again on the spot. */
  function polarHistidineChanged() {
    const entry = interfaceResults && entryById(interfaceResults.entryId);
    if (entry && entry.model && interfaceResults.rows.length) {
      const atoms = heavyAtoms(entry).filter(atom => !isWater(atom));
      const byChain = new Map();
      atoms.forEach(atom => { const chain = atom.chain || ''; if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push(atom); });
      interfaceResults.histidineCharged = polarHistidineCharged();
      polarInterfaceRows(entry, interfaceResults.rows, byChain, interfaceResults.histidineCharged);
      renderInterfaceResults();
    }
    /* The card's tags follow too. */
    if (contactsPanelOpen()) { cardContacts = null; openResidueContacts(); }
    updateStatus('Histidine is ' + (polarHistidineCharged() ? 'now counted as charged: its ND1 and NE2 can make salt bridges' : 'no longer counted as charged: its ND1 and NE2 make hydrogen bonds only'));
  }

  /* The residues joined by interaction records, per model — `entryId|chain|resi|icode` — and the
     signature that says whether they changed since the models were last styled. */
  function polarStickKeys() {
    const keys = new Map();
    measurementRecords.forEach(record => {
      if (!record.interaction) return;
      record.points.forEach(point => {
        if (!keys.has(point.entryId)) keys.set(point.entryId, new Set());
        keys.get(point.entryId).add((point.chain || '') + '|' + point.resi + '|' + insertionCodeOf(point));
      });
    });
    return keys;
  }

  /* Called by applyModelStyle (03): the residues an interaction joins drawn as sticks over whatever
     the model is drawn as, on the main view, every panel and every export, as compared positions are.
     A hidden chain stays hidden. */
  function polarStyleSticks(model, entry) {
    const keys = polarStickKeys().get(entry.id);
    if (!keys || !keys.size) return;
    const hidden = entry.hiddenChains || [];
    model.setStyle({ predicate: atom => !hidden.includes(atom.chain || '') && keys.has((atom.chain || '') + '|' + atom.resi + '|' + insertionCodeOf(atom)) }, { stick: { radius: 0.22, colorscheme: 'default' } }, true);
  }

  /* Called first by rebuildOverlays (03): true, once, when the residues the interaction records join
     are not the ones the models were last styled with — a row's Remove, Clear measurements and the
     editor's Remove change the records and redraw only the overlays — so the sticks follow. Kept on
     the function itself: rebuildOverlays can run before this part's own declarations have. */
  function polarSticksStale() {
    const keys = polarStickKeys();
    const signature = [...keys.entries()].map(([id, set]) => id + ':' + [...set].sort().join(',')).sort().join(';');
    if (signature === (polarSticksStale.signature || '')) return false;
    polarSticksStale.signature = signature;
    return true;
  }

  /* The interaction records a view draws: every point in a model the figure (or, for 'screen', the
     page) shows. */
  function polarShownRecords(kind = 'figure') {
    const shown = new Set((kind === 'screen' ? displayedEntries() : figureEntries()).map(entry => entry.id));
    return measurementRecords.filter(record => record.interaction && record.points.every(point => shown.has(point.entryId)));
  }

  /* The legend's entries for them (31 legendItems): one per type, colour and line as they are drawn
     now — a recoloured hydrogen bond gets an entry of its own colour — hydrogen bonds first. */
  function polarLegendItems(kind = 'figure') {
    const records = polarShownRecords(kind);
    const seen = new Map();
    ['hbond', 'salt'].forEach(type => records.forEach(record => {
      if (record.interaction !== type) return;
      const color = String(measurementColor(record) || '').toLowerCase(); const line = record.dashed === false ? 'solid' : 'dashed';
      const key = type + '|' + color + '|' + line;
      if (!seen.has(key)) seen.set(key, [color, polarTypeName(type), polarTypeName(type) + ' (' + line + ' line)', line]);
    }));
    return [...seen.values()];
  }

  /* Called by rebuildOverlays (03): true, once, when the legend entries the interaction records make
     have changed since the legend was last drawn — a colour, a dash — so the on-screen legend, the
     legend key and its text follow at once. Kept on the function, as polarSticksStale's signature is. */
  function polarLegendStale() {
    const signature = JSON.stringify([polarLegendItems('screen'), polarLegendItems('figure')]);
    if (signature === (polarLegendStale.signature || '[[],[]]')) return false;
    polarLegendStale.signature = signature;
    return true;
  }

  /* The figure legend's sentence (28): "Dashed lines: 12 hydrogen bonds (blue) and 3 salt bridges
     (red), by geometry (…)", in the colours and line the records are drawn in now. */
  function polarLegendSentence(shownIds) {
    const records = measurementRecords.filter(record => record.interaction && record.points.every(point => shownIds.has(point.entryId)));
    if (!records.length) return '';
    const part = type => {
      const own = records.filter(record => record.interaction === type); if (!own.length) return '';
      const colours = [...new Set(own.map(record => colourName(measurementColor(record))))];
      return own.length + ' ' + (type === 'hbond' ? 'hydrogen bond' : 'salt bridge') + (own.length === 1 ? '' : 's') + ' (' + colours.join(', ') + ')';
    };
    const dashed = records.every(record => record.dashed !== false); const solid = records.every(record => record.dashed === false);
    return (dashed ? 'Dashed lines' : solid ? 'Solid lines' : 'Lines') + ': ' + ['hbond', 'salt'].map(part).filter(Boolean).join(' and ') + ', by geometry (donor–acceptor ≤ 3.5 Å, angles ≥ 90°; N–O ≤ 4.0 Å between charged groups).';
  }

  /* The methods text's sentence (28): the definitions behind the lines, once any is drawn. */
  function polarMethodsSentence(shownIds) {
    const records = measurementRecords.filter(record => record.interaction && record.points.every(point => shownIds.has(point.entryId)));
    if (!records.length) return '';
    const histidine = polarHistidineCharged() ? 'histidine ND1 and NE2 counted as charged' : 'histidine treated as neutral';
    return 'Hydrogen bonds and salt bridges were identified from heavy-atom geometry (no hydrogens were placed): a hydrogen bond joined a donor and an acceptor N or O of different residues at ≤ 3.5 Å with every antecedent–donor···acceptor and donor···acceptor–antecedent angle ≥ 90°, roles being assigned by atom name for the standard amino acids and nucleotides and by element otherwise; a salt bridge joined a charged N (Lys NZ, Arg NE/NH1/NH2, the chain N-terminus) and a charged O (Asp OD1/OD2, Glu OE1/OE2, the C-terminus, nucleotide phosphate) at ≤ 4.0 Å, one per residue pair (' + histidine + '; water excluded).';
  }

  /* The debug hook's view (validate.mjs, validate-experimental.mjs, the suite): the hydrogen bonds and
     salt bridges between two chains of a model — within one chain when the two are the same — as rows
     [chainA, resiA, atomA, chainB, resiB, atomB, distance], the shape tests/reference.py writes, with
     the insertion codes and the by-element flag beside them. Water out, histidine as the option says
     unless `histidineCharged` is given. */
  function debugPolarInteractions(entryId, chainA, chainB, histidineCharged = null) {
    const entry = debugEntry(entryId); if (!entry) return null;
    const context = polarModel(entry, histidineCharged === null ? polarHistidineCharged() : histidineCharged);
    const side = chain => context.all.filter(atom => (atom.chain || '') === (chain || ''));
    const atomsA = side(chainA); const atomsB = (chainA || '') === (chainB || '') ? atomsA : side(chainB);
    const list = polarInteractions(atomsA, atomsB, { context });
    const row = item => [item.a.chain || '', item.a.resi, item.a.atom || '', item.b.chain || '', item.b.resi, item.b.atom || '', item.distance];
    return {
      hbonds: list.filter(item => item.type === 'hbond').map(row), salt_bridges: list.filter(item => item.type === 'salt').map(row),
      icodes: list.map(item => [insertionCodeOf(item.a), insertionCodeOf(item.b)]), byElement: list.filter(item => item.byElement).length,
      donors: list.map(item => (item.donor === item.a ? 'a' : item.donor === item.b ? 'b' : 'either'))
    };
  }

  root.querySelector('#gpv-interface-polar-csv').addEventListener('click', downloadInteractionsCsv);
  root.querySelector('#gpv-interface-histidine').addEventListener('change', polarHistidineChanged);
