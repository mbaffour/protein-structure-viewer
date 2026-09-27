  /* ---------- Interaction confidence ----------
     Whether a predicted interface is believable is what ipTM was meant to say, and for a whole
     complex it says it badly: it is averaged over every residue of both chains, so a small
     confident interface between large chains, or disordered tails, pull it around. These scores
     look at the interface itself:
       ipSAE    Dunbrack 2025 (bioRxiv 10.1101/2025.02.10.637595): for each residue of chain 1,
                the TM-score kernel over the chain-2 residues it is aligned to with PAE below a
                cutoff, d0 set from how many there are; the best residue gives the score. It is
                directional (A→B, B→A); the larger is reported.
       pDockQ   Bryant, Pozzati & Elofsson 2022: interface pLDDT × log10(Cβ contacts within 8 Å).
       pDockQ2  Zhu et al. 2023: interface pLDDT × the mean PAE kernel over those contacts.
       LIS      Kim et al. 2024: mean of (12 − PAE)/12 over inter-chain PAE below 12 Å.
     Everything here follows the reference implementation, DunbrackLab/IPSAE ipsae.py (version 4,
     2026-01-03), step for step — including its two d0 functions, which differ at L = 27 — so the
     numbers can be checked against it; VALIDATION.md records that check. Higher is more confident
     for all four. None of them is a measurement, and no single threshold separates a real
     interaction from a spurious one. */

  let interactionResults = null; /* { paeCutoff, distCutoff, byEntry: Map(entryId -> scores) } */

  const nucleicResidueNames = new Set(['DA', 'DC', 'DT', 'DG', 'A', 'C', 'U', 'G']);
  const ptmKernel = (value, d0) => 1 / (1 + (value / d0) ** 2);

  /* ipsae.py calc_d0: 1.0 up to L = 27, then the TM-score formula; 2.0 minimum for nucleic acids. */
  function interfaceD0(length, pairType) {
    const minimum = pairType === 'nucleic_acid' ? 2 : 1;
    const d0 = length > 27 ? 1.24 * Math.cbrt(length - 15) - 1.8 : 1;
    return Math.max(minimum, d0);
  }

  /* ipsae.py calc_d0_array, used for the per-residue d0 of ipSAE: L is raised to at least 26. */
  function interfaceD0Residue(length, pairType) {
    const minimum = pairType === 'nucleic_acid' ? 2 : 1;
    return Math.max(minimum, 1.24 * Math.cbrt(Math.max(26, length) - 15) - 1.8);
  }

  /* The residues ipsae.py scores, from the model: every polymer residue with a Cα (or a C1′ for a
     nucleotide), its Cβ (Cα for glycine, C3′ for a nucleotide) for distances, that atom's pLDDT
     from the B-factor column, and the PAE row of its Cα token. Ligands are left out, as there. */
  function interactionInput(entry) {
    const atoms = entry.atoms || [];
    /* pLDDT per atom: AlphaFold 3's full_data values when they are loaded and cover every atom,
       looked up by the atom's place in the file (ipsae.py's atom id − 1; 3Dmol's own serial is
       0-based for mmCIF and the file's number for PDB, so it is not used), otherwise the B-factor. */
    const atomPlddts = entry.confidence && Array.isArray(entry.confidence.atomPlddts) && entry.confidence.atomPlddts.length === atoms.length ? entry.confidence.atomPlddts : null;
    const position = atomPlddts ? new Map(atoms.map((atom, index) => [atom, index])) : null;
    const plddtOf = atom => atomPlddts ? Number(atomPlddts[position.get(atom)]) : Number(atom.b);
    const polymerChains = new Set(atoms.filter(atom => !atom.hetflag).map(atom => String(atom.chain ?? '')));
    const groups = []; const byKey = new Map();
    atoms.forEach(atom => {
      const chain = String(atom.chain ?? '');
      if (!polymerChains.has(chain) || /^(HOH|WAT|DOD)$/i.test(String(atom.resn || ''))) return;
      const key = chain + '|' + atom.resi + '|' + atom.resn;
      if (!byKey.has(key)) { const group = { chain, resi: Number(atom.resi), resn: String(atom.resn || '').toUpperCase(), atoms: [] }; byKey.set(key, group); groups.push(group); }
      byKey.get(key).atoms.push(atom);
    });
    const layout = paeTokenLayout(entry);
    const tokens = new Map();
    if (layout && !layout.mismatch) layout.chainIds.forEach((chain, index) => {
      const tag = String(chain) + '|' + Number(layout.residueIds[index]);
      if (!tokens.has(tag)) tokens.set(tag, []);
      tokens.get(tag).push(index);
    });
    const residues = [];
    groups.forEach(group => {
      const anchor = group.atoms.find(atom => atom.atom === 'CA' || String(atom.atom).includes('C1'));
      if (!anchor) return;
      const beta = group.atoms.find(atom => atom.atom === 'CB' || String(atom.atom).includes('C3') || (group.resn === 'GLY' && atom.atom === 'CA')) || anchor;
      /* A residue AlphaFold 3 tokenised atom by atom (a modified residue) has one token per heavy
         atom in file order; its Cα's token is the one that stands in for it. */
      const own = tokens.get(group.chain + '|' + group.resi);
      let token = null;
      if (own && own.length === 1) token = own[0];
      else if (own && own.length > 1) { const heavy = group.atoms.filter(atom => String(atom.elem || '').toUpperCase() !== 'H'); const at = heavy.indexOf(anchor); token = at >= 0 && at < own.length ? own[at] : null; }
      residues.push({ chain: group.chain, resi: group.resi, resn: group.resn, token, x: beta.x, y: beta.y, z: beta.z, plddt: plddtOf(beta) });
    });
    const chains = [...new Set(residues.map(residue => residue.chain))];
    const chainType = new Map(chains.map(chain => [chain, residues.some(residue => residue.chain === chain && nucleicResidueNames.has(residue.resn)) ? 'nucleic_acid' : 'protein']));
    const pae = entry.confidence && Array.isArray(entry.confidence.pae) && layout && !layout.mismatch && residues.every(residue => residue.token !== null) ? entry.confidence.pae : null;
    const reason = !(entry.confidence && Array.isArray(entry.confidence.pae)) ? (entry.confidence && entry.confidence.predictor === 'Chai-1' ? 'Chai-1 does not save its PAE' : 'no PAE matrix') : !pae ? (layout && layout.mismatch ? layout.mismatch : 'PAE rows could not be matched to residues') : null;
    return { residues, chains, chainType, pae, reason, hasPlddt: entry.scores.length > 0, plddtSource: atomPlddts ? 'atom_plddts' : 'B-factor' };
  }

  /* Every ordered chain pair, as ipsae.py computes it. PAE-based scores are null without a PAE. */
  function interactionScoresFrom(input, paeCutoff = 10, distCutoff = 10) {
    const { residues, chains, chainType, pae } = input;
    const indicesOf = new Map(chains.map(chain => [chain, []]));
    residues.forEach((residue, index) => indicesOf.get(residue.chain).push(index));
    const distance = (i, j) => Math.hypot(residues[i].x - residues[j].x, residues[i].y - residues[j].y, residues[i].z - residues[j].z);
    const pairType = (a, b) => chainType.get(a) === 'nucleic_acid' || chainType.get(b) === 'nucleic_acid' ? 'nucleic_acid' : 'protein';
    const asym = new Map();
    chains.forEach(chain1 => chains.forEach(chain2 => {
      if (chain1 === chain2) return;
      const one = indicesOf.get(chain1); const two = indicesOf.get(chain2); const type = pairType(chain1, chain2);
      const n0chn = one.length + two.length; const d0chn = interfaceD0(n0chn, type);
      /* pDockQ and pDockQ2: Cβ pairs within 8 Å. */
      const contactSet = new Set(); let contacts = 0; let contactKernel = 0;
      const unique1 = new Set(); const unique2 = new Set(); const near1 = new Set(); const near2 = new Set();
      let validPairs = 0; let nearPairs = 0; let lisSum = 0; let lisCount = 0;
      const iptmByResidue = new Float64Array(one.length); const d0chnByResidue = new Float64Array(one.length); const n0resByResidue = new Int32Array(one.length);
      one.forEach((i, position) => {
        const row = pae ? pae[residues[i].token] : null;
        let iptmSum = 0; let ipsaeSum = 0; let valid = 0; let near = false;
        two.forEach(j => {
          const d = distance(i, j);
          if (d <= 8) { contacts += 1; contactSet.add(i); contactSet.add(j); }
          if (!row) return;
          const value = Number(row[residues[j].token]);
          const kernel = ptmKernel(value, d0chn);
          iptmSum += kernel;
          if (d <= 8) contactKernel += ptmKernel(value, 10);
          if (value < 12) { lisSum += (12 - value) / 12; lisCount += 1; }
          if (value < paeCutoff) {
            valid += 1; ipsaeSum += kernel; unique2.add(residues[j].resi);
            if (d < distCutoff) { nearPairs += 1; near = true; near2.add(residues[j].resi); }
          }
        });
        if (!row) return;
        iptmByResidue[position] = two.length ? iptmSum / two.length : 0;
        d0chnByResidue[position] = valid ? ipsaeSum / valid : 0;
        n0resByResidue[position] = valid; validPairs += valid;
        if (valid) unique1.add(residues[i].resi);
        if (near) near1.add(residues[i].resi);
      });
      const interfaceResidues = [...contactSet];
      const meanPlddt = interfaceResidues.length ? interfaceResidues.reduce((sum, index) => sum + residues[index].plddt, 0) / interfaceResidues.length : 0;
      const pdockq = contacts ? 0.724 / (1 + Math.exp(-0.052 * (meanPlddt * Math.log10(contacts) - 152.611))) + 0.018 : 0;
      const result = { chain1, chain2, n0chn, d0chn, pdockq: input.hasPlddt ? pdockq : null, contacts, contactResidues: interfaceResidues.length, meanInterfacePlddt: input.hasPlddt && interfaceResidues.length ? meanPlddt : null,
        ipsae: null, ipsaeD0chn: null, ipsaeD0dom: null, iptmD0chn: null, pdockq2: null, lis: null, n0res: null, n0dom: null, d0res: null, d0dom: null, nres1: null, nres2: null, dist1: null, dist2: null, bestResidue: null };
      if (pae) {
        const n0dom = unique1.size + unique2.size; const d0dom = interfaceD0(n0dom, type);
        let best = { ipsae: -Infinity }; let bestD0chn = 0; let bestD0dom = 0; let bestIptm = 0;
        one.forEach((i, position) => {
          const row = pae[residues[i].token]; const n0res = n0resByResidue[position]; const d0res = interfaceD0Residue(n0res, type);
          let domSum = 0; let resSum = 0;
          if (n0res) two.forEach(j => { const value = Number(row[residues[j].token]); if (value < paeCutoff) { domSum += ptmKernel(value, d0dom); resSum += ptmKernel(value, d0res); } });
          const byResidue = n0res ? resSum / n0res : 0;
          if (byResidue > best.ipsae) best = { ipsae: byResidue, n0res, d0res, residue: residues[i] };
          bestD0dom = Math.max(bestD0dom, n0res ? domSum / n0res : 0);
          bestD0chn = Math.max(bestD0chn, d0chnByResidue[position]); bestIptm = Math.max(bestIptm, iptmByResidue[position]);
        });
        /* No residue with a PAE below the cutoff: ipsae.py reports 0, with n0res 0 and d0res 1. */
        if (!(best.ipsae > 0)) best = { ipsae: 0, n0res: 0, d0res: interfaceD0Residue(0, type), residue: null };
        Object.assign(result, {
          ipsae: best.ipsae, ipsaeD0chn: bestD0chn, ipsaeD0dom: bestD0dom, iptmD0chn: bestIptm,
          pdockq2: contacts ? 1.31 / (1 + Math.exp(-0.075 * (meanPlddt * (contactKernel / contacts) - 84.733))) + 0.005 : 0,
          lis: lisCount ? lisSum / lisCount : 0,
          n0res: best.n0res, n0dom, d0res: best.d0res, d0dom, nres1: unique1.size, nres2: unique2.size, dist1: near1.size, dist2: near2.size,
          bestResidue: best.residue ? best.residue.chain + ':' + best.residue.resn + best.residue.resi : null, validPairs, nearPairs
        });
        if (!input.hasPlddt) result.pdockq2 = null;
      }
      asym.set(chain1 + '\u0000' + chain2, result);
    }));
    /* One row per unordered pair, as ipsae.py's "max" line: the larger of the two directions for the
       ipSAE family and pDockQ2, the mean of the two for LIS; pDockQ is the same both ways. Ties go to
       the direction whose first chain sorts later, as there. */
    const pairs = [];
    chains.forEach((a, ia) => chains.forEach((b, ib) => {
      if (ib <= ia) return;
      const ab = asym.get(a + '\u0000' + b); const ba = asym.get(b + '\u0000' + a);
      const [later, earlier] = a > b ? [ab, ba] : [ba, ab];
      const pick = key => ab[key] === null || ba[key] === null ? null : Math.max(ab[key], ba[key]);
      const lead = ab.ipsae === null ? null : (later.ipsae >= earlier.ipsae ? later : earlier);
      const leadDomain = ab.ipsae === null ? null : (later.ipsaeD0dom >= earlier.ipsaeD0dom ? later : earlier);
      pairs.push({
        chain1: a, chain2: b, forward: ab, reverse: ba,
        ipsae: pick('ipsae'), ipsaeD0chn: pick('ipsaeD0chn'), ipsaeD0dom: pick('ipsaeD0dom'), iptmD0chn: pick('iptmD0chn'),
        pdockq: ab.pdockq, pdockq2: pick('pdockq2'), lis: ab.lis === null ? null : (ab.lis + ba.lis) / 2,
        n0res: lead ? lead.n0res : null, d0res: lead ? lead.d0res : null, bestResidue: lead ? lead.bestResidue : null,
        n0chn: ab.n0chn, n0dom: leadDomain ? leadDomain.n0dom : null, d0dom: leadDomain ? leadDomain.d0dom : null,
        nres1: ab.nres1 === null ? null : Math.max(ab.nres1, ba.nres2), nres2: ab.nres2 === null ? null : Math.max(ab.nres2, ba.nres1),
        dist1: ab.dist1 === null ? null : Math.max(ab.dist1, ba.dist2), dist2: ab.dist2 === null ? null : Math.max(ab.dist2, ba.dist1)
      });
    }));
    return { chains, pairs, asym: [...asym.values()], paeCutoff, distCutoff };
  }

  function interactionScores(entry, paeCutoff, distCutoff) {
    const input = interactionInput(entry);
    return { ...interactionScoresFrom(input, paeCutoff, distCutoff), reason: input.reason, residues: input.residues.length, plddtSource: input.plddtSource };
  }

  /* The ipTM the predictor itself reported for a chain pair: AlphaFold 3 chain_pair_iptm, Boltz
     pair_chains_iptm, Chai-1 per_chain_pair_iptm (all in the model's chain order), or for a
     two-chain ColabFold model its single ipTM. */
  function reportedPairIptm(entry, chain1, chain2) {
    const confidence = entry.confidence || {};
    const matrix = confidence.chainPairIptm;
    const listed = chainOrderFromIds(confidence.chainIds);
    const order = Array.isArray(matrix) && listed.length === matrix.length ? listed : modelChainOrder(entry);
    if (Array.isArray(matrix)) {
      const i = order.indexOf(chain1); const j = order.indexOf(chain2);
      const value = i >= 0 && j >= 0 && matrix[i] ? finiteNumber(matrix[i][j]) : null;
      if (value !== null) return value;
    }
    return modelChainOrder(entry).length === 2 ? finiteNumber(confidence.iptm) : null;
  }

  function interactionSettings() {
    return { paeCutoff: Number(root.querySelector('#gpv-ipsae-pae').value) || 10, distCutoff: Number(root.querySelector('#gpv-ipsae-dist').value) || 10 };
  }

  function scoreInteractions(entries) {
    const { paeCutoff, distCutoff } = interactionSettings();
    const byEntry = interactionResults && interactionResults.paeCutoff === paeCutoff && interactionResults.distCutoff === distCutoff ? interactionResults.byEntry : new Map();
    entries.forEach(entry => { materializeEntry(entry); byEntry.set(entry.id, interactionScores(entry, paeCutoff, distCutoff)); });
    interactionResults = { paeCutoff, distCutoff, byEntry };
  }

  const interactionCell = (value, digits = 3) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);

  function renderInteractions() {
    const entry = activeEntry();
    const body = root.querySelector('#gpv-ipsae-rows'); body.replaceChildren();
    const state = root.querySelector('#gpv-ipsae-state');
    const chains = entry && entry.atoms.length ? modelChainOrder(entry) : [];
    root.querySelector('#gpv-ipsae-run').disabled = !entry || chains.length < 2;
    root.querySelector('#gpv-ipsae-all').disabled = visibleEntries().length < 1 || chains.length < 2;
    const scores = entry && interactionResults ? interactionResults.byEntry.get(entry.id) : null;
    root.querySelector('#gpv-ipsae-csv').disabled = !interactionResults || !interactionResults.byEntry.size;
    root.querySelector('#gpv-ipsae-wrap').hidden = !scores || !scores.pairs.length;
    if (!entry) { state.textContent = 'Show a model with two or more chains.'; renderInteractionEnsemble(); return; }
    if (chains.length < 2) { state.textContent = displayName(entry) + ' has one chain; interaction scores need two.'; renderInteractionEnsemble(); return; }
    if (!scores) { state.textContent = 'Score the chain pairs of ' + displayName(entry) + ' (' + chains.length + ' chains).'; renderInteractionEnsemble(); return; }
    scores.pairs.forEach(pair => {
      const row = document.createElement('tr');
      const direction = pair.forward.ipsae === null ? '—' : interactionCell(pair.forward.ipsae) + ' / ' + interactionCell(pair.reverse.ipsae);
      const values = [pair.chain1 + '–' + pair.chain2, interactionCell(pair.ipsae), direction, interactionCell(reportedPairIptm(entry, pair.chain1, pair.chain2)), interactionCell(pair.pdockq), interactionCell(pair.pdockq2), interactionCell(pair.lis),
        pair.dist1 === null ? String(pair.forward.contactResidues) + ' within 8 Å' : pair.dist1 + ' + ' + pair.dist2];
      values.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        cell.textContent = value;
        if (index !== 0) cell.className = 'text-end';
        if (index === 1 && pair.bestResidue) cell.title = 'Highest per-residue ipSAE at ' + pair.bestResidue + ' (n0res ' + pair.n0res + ', d0 ' + Number(pair.d0res).toFixed(2) + ' Å)';
        if (index === 2 && pair.forward.ipsae !== null) cell.title = pair.chain1 + '→' + pair.chain2 + ' ' + interactionCell(pair.forward.ipsae) + ' · ' + pair.chain2 + '→' + pair.chain1 + ' ' + interactionCell(pair.reverse.ipsae);
        row.append(cell);
      });
      body.append(row);
    });
    const reported = entry.confidence && entry.confidence.reportedInterface;
    const colabfold = reported && reported.ipsae ? Object.entries(reported.ipsae).map(([key, value]) => key.replace('-', '→') + ' ' + interactionCell(value)).join(' · ') : '';
    state.textContent = displayName(entry) + ' · ' + scores.pairs.length + ' chain pair' + (scores.pairs.length === 1 ? '' : 's') + ' · PAE cutoff ' + scores.paeCutoff + ' Å, distance ' + scores.distCutoff + ' Å'
      + (scores.reason ? ' · ' + scores.reason + ', so only pDockQ is available' : '')
      + (colabfold ? ' · ColabFold’s own ipSAE (15 Å cutoff): ' + colabfold : '');
    renderInteractionEnsemble();
  }

  /* Across the scored models: the spread of each chain pair's ipSAE (pDockQ when there is no PAE). */
  function renderInteractionEnsemble() {
    const wrap = root.querySelector('#gpv-ipsae-ensemble-wrap'); const body = root.querySelector('#gpv-ipsae-ensemble-rows'); body.replaceChildren();
    const scored = interactionResults ? [...interactionResults.byEntry.entries()].map(([id, scores]) => ({ entry: entryById(id), scores })).filter(item => item.entry) : [];
    wrap.hidden = scored.length < 2;
    if (scored.length < 2) return;
    const byPair = new Map();
    scored.forEach(({ entry, scores }) => scores.pairs.forEach(pair => {
      const key = pair.chain1 + '–' + pair.chain2;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push({ entry, value: pair.ipsae !== null ? pair.ipsae : pair.pdockq, metric: pair.ipsae !== null ? 'ipSAE' : 'pDockQ' });
    }));
    byPair.forEach((items, key) => {
      const values = items.map(item => item.value).filter(Number.isFinite).sort((a, b) => a - b);
      const top = items.slice().sort((a, b) => (a.entry.rank ?? Infinity) - (b.entry.rank ?? Infinity))[0];
      const median = values.length ? (values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2) : null;
      const row = document.createElement('tr');
      [key, items[0].metric, String(items.length), interactionCell(median), values.length ? interactionCell(values[0]) + '–' + interactionCell(values[values.length - 1]) : '—', top ? displayName(top.entry) + ' ' + interactionCell(top.value) : '—'].forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = value; if (index >= 2 && index <= 4) cell.className = 'text-end'; row.append(cell);
      });
      body.append(row);
    });
  }

  function interactionCsv() {
    if (!interactionResults) return '';
    const header = ['model', 'chain1', 'chain2', 'type', 'pae_cutoff', 'dist_cutoff', 'ipsae', 'ipsae_d0chn', 'ipsae_d0dom', 'iptm_model', 'iptm_d0chn', 'pdockq', 'pdockq2', 'lis', 'n0res', 'n0chn', 'n0dom', 'd0res', 'd0chn', 'd0dom', 'nres1', 'nres2', 'dist1', 'dist2', 'best_residue'];
    const rows = [header];
    const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : String(Math.round(Number(value) * 1e6) / 1e6);
    interactionResults.byEntry.forEach((scores, id) => {
      const entry = entryById(id); if (!entry) return;
      scores.pairs.forEach(pair => {
        [pair.forward, pair.reverse].forEach(one => rows.push([displayName(entry), one.chain1, one.chain2, 'asym', scores.paeCutoff, scores.distCutoff, number(one.ipsae), number(one.ipsaeD0chn), number(one.ipsaeD0dom), number(reportedPairIptm(entry, one.chain1, one.chain2)), number(one.iptmD0chn), number(one.pdockq), number(one.pdockq2), number(one.lis), number(one.n0res), one.n0chn, number(one.n0dom), number(one.d0res), number(one.d0chn), number(one.d0dom), number(one.nres1), number(one.nres2), number(one.dist1), number(one.dist2), one.bestResidue || '']));
        rows.push([displayName(entry), pair.chain1, pair.chain2, 'max', scores.paeCutoff, scores.distCutoff, number(pair.ipsae), number(pair.ipsaeD0chn), number(pair.ipsaeD0dom), number(reportedPairIptm(entry, pair.chain1, pair.chain2)), number(pair.iptmD0chn), number(pair.pdockq), number(pair.pdockq2), number(pair.lis), number(pair.n0res), pair.n0chn, number(pair.n0dom), number(pair.d0res), number(pair.forward.d0chn), number(pair.d0dom), number(pair.nres1), number(pair.nres2), number(pair.dist1), number(pair.dist2), pair.bestResidue || '']);
      });
    });
    return rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  }

  function interactionMethodsSentence() {
    if (!interactionResults || !interactionResults.byEntry.size) return null;
    const anyPae = [...interactionResults.byEntry.values()].some(scores => scores.pairs.some(pair => pair.ipsae !== null));
    return 'Interface confidence was scored for each chain pair ' + (anyPae ? 'as ipSAE (Dunbrack, 2025; PAE cutoff ' + interactionResults.paeCutoff + ' Å, d0 from the number of aligned partner residues), pDockQ (Bryant et al., 2022), pDockQ2 (Zhu et al., 2023) and LIS (Kim et al., 2024)' : 'as pDockQ (Bryant et al., 2022), no PAE matrix being available')
      + ', following the reference implementation ipsae.py (version 4); contacts are Cβ (Cα for glycine) pairs within 8 Å, directional scores are reported as the larger of the two directions (LIS as their mean), and interface residue counts use a ' + interactionResults.distCutoff + ' Å Cβ distance.';
  }
