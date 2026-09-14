  /* ---------- Entities, stoichiometry and dimensions ---------- */

  const greekLetters = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ'];
  function entityColorFor(index) { const source = safePaletteOn ? okabeIto : chainPalette; return source[index % source.length]; }

  /* Chains with identical sequences form one entity; entities are numbered in order of
     first appearance and named with Greek letters like a stoichiometry formula. */
  function entityGroups(entry) {
    if (!entry || !entry.model) return [];
    if (entry.entityCache && entry.entityCache.atoms === entry.atoms) return entry.entityCache.groups;
    const bySequence = new Map();
    residueRows(entry).forEach(row => {
      const sequence = row.residues.map(atom => residueLetter(atom.resn)).join('');
      if (!bySequence.has(sequence)) bySequence.set(sequence, { chains: [], length: row.residues.length });
      bySequence.get(sequence).chains.push(row.chain);
    });
    const groups = [...bySequence.values()].map((group, index) => ({ ...group, index, label: greekLetters[index] || 'e' + (index + 1) }));
    const chainToGroup = new Map(); groups.forEach(group => group.chains.forEach(chain => chainToGroup.set(chain, group.index)));
    entry.entityCache = { atoms: entry.atoms, groups, chainToGroup };
    return groups;
  }

  function entityColor(entry, atom) {
    entityGroups(entry);
    const index = entry.entityCache ? entry.entityCache.chainToGroup.get(atom.chain || '') : undefined;
    return index === undefined ? '#9ca3af' : entityColorFor(index);
  }

  /* Maximum Cα–Cα distance and radius of gyration of the Cα atoms, in Å. */
  function assemblyDimensions(entry) {
    const cas = entry.atoms.filter(atom => atom.atom === 'CA' && !atom.hetflag);
    if (cas.length < 2) return null;
    const centre = { x: mean(cas.map(a => a.x)), y: mean(cas.map(a => a.y)), z: mean(cas.map(a => a.z)) };
    const gyration = Math.sqrt(mean(cas.map(a => squaredDistance(a, centre))));
    /* The exact maximum Cα–Cα distance up to 6 000 residues (18 million pairs, under a
       second). Beyond that a two-pass estimate — farthest from the centre, then farthest
       from that point — which is a lower bound and is reported as one (exact: false). */
    let extent = 0; let exact = true;
    if (cas.length <= 6000) {
      const xs = Float64Array.from(cas, a => a.x); const ys = Float64Array.from(cas, a => a.y); const zs = Float64Array.from(cas, a => a.z);
      for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) {
        const d = (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2 + (zs[i] - zs[j]) ** 2; if (d > extent) extent = d;
      }
    } else {
      exact = false;
      let far = cas[0]; cas.forEach(a => { if (squaredDistance(a, centre) > squaredDistance(far, centre)) far = a; });
      cas.forEach(a => { extent = Math.max(extent, squaredDistance(a, far)); });
    }
    return { extent: Math.sqrt(extent), gyration, exact, residues: cas.length };
  }

