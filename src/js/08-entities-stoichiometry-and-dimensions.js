  /* ---------- Entities, stoichiometry and dimensions ---------- */

  const greekLetters = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ'];
  function entityColorFor(index) { const source = safePaletteOn ? okabeIto : chainPalette; return source[index % source.length]; }

  /* Which polymer entity each chain belongs to, by the file's own word: an mmCIF file lists its
     polymer entities in _entity_poly, with the author chain ids of every copy in pdbx_strand_id — the
     ids 3Dmol names chains by, as it reads auth_asym_id first. A file whose atoms carry no
     auth_asym_id is named by label_asym_id, which _struct_asym maps to entities instead.
     _atom_site.label_entity_id alone is not trusted: a minimal mmCIF of atom_site alone (the suite's
     synthetic AlphaFold 3 file, its j3Cif builder) can give every chain an entity of its own, identical
     copies included, or every chain the same one.
     Map of chain → entity id, or null when the file says nothing usable. Cached per text. */
  function mmcifChainEntities(entry) {
    if (!entry || entry.format !== 'cif' || typeof entry.text !== 'string') return null;
    if (entry.chainEntities && entry.chainEntities.text === entry.text) return entry.chainEntities.map;
    const text = entry.text; let map = null;
    const poly = mmcifCategory(text, 'entity_poly', ['entity_id', 'pdbx_strand_id']);
    const ids = poly && poly.values.entity_id;
    const usable = value => value !== undefined && value !== '?' && value !== '.' && value !== '';
    if (ids) {
      map = new Map();
      if (/^_atom_site\.auth_asym_id\b/im.test(text)) {
        const strands = poly.values.pdbx_strand_id || [];
        ids.forEach((id, row) => { if (usable(strands[row])) strands[row].split(',').map(chain => chain.trim()).filter(Boolean).forEach(chain => { if (!map.has(chain)) map.set(chain, id); }); });
      } else {
        const asym = mmcifCategory(text, 'struct_asym', ['id', 'entity_id']);
        const polymer = new Set(ids);
        if (asym && asym.values.id && asym.values.entity_id) asym.values.id.forEach((chain, row) => { const id = asym.values.entity_id[row]; if (polymer.has(id) && !map.has(chain)) map.set(chain, id); });
      }
      if (!map.size) map = null;
    }
    entry.chainEntities = { text, map };
    return map;
  }

  /* Without the file's entities, chains are grouped by observed sequence. Two chains are one entity
     when they are the same kind of polymer, the shorter has at least 80 % of the longer's observed
     residues, and either its observed sequence is a contiguous stretch of the longer's — copies of
     one protein whose disordered ends were built to different lengths — or every residue it has
     is the same residue at the same number (and insertion code) in the longer, which also covers a
     copy with a disordered loop left out (barstar D and E of 1BRS, without residues 64–65). Each
     chain is compared with the longest copy of a group (chains are taken longest first), so a copy
     missing its N-terminus and one missing its C-terminus both join the full-length copy; two chains
     that merely share a short motif never meet the 80 %. */
  function sameEntitySequence(longer, shorter) {
    if (longer.unit !== shorter.unit || shorter.sequence.length < 0.8 * longer.sequence.length) return false;
    if (longer.sequence.includes(shorter.sequence)) return true;
    for (const [key, letter] of shorter.numbered) if (longer.numbered.get(key) !== letter) return false;
    return true;
  }

  /* Polymer chains grouped into entities — by the file's own entity table where an mmCIF file has one
     that names every chain, otherwise by observed sequence (above) — numbered in order of first
     appearance and named with Greek letters like a stoichiometry formula. A group's length is its
     longest observed copy, in the unit Composition and the entity legend print. Two of the file's
     entities whose copies read the same sequence are one group, as they always were here. */
  function entityGroups(entry) {
    if (!entry || !entry.model) return [];
    if (entry.entityCache && entry.entityCache.atoms === entry.atoms) return entry.entityCache.groups;
    /* `unit` is how the group's length is counted — nt, aa or residues — so every place that prints
       it (Composition, the entity legend) says the same thing about the same chain. */
    const chains = residueRows(entry).map((row, order) => {
      const letters = row.residues.map(atom => residueLetter(atom.resn));
      const numbered = new Map(row.residues.map((atom, index) => [atom.resi + '|' + insertionCodeOf(atom), letters[index]]));
      return { chain: row.chain, order, sequence: letters.join(''), numbered, length: row.residues.length, unit: residueCountUnit(row.residues) };
    });
    const fileEntities = mmcifChainEntities(entry);
    const fromFile = Boolean(fileEntities) && chains.length > 0 && chains.every(item => fileEntities.has(item.chain));
    const sets = [];
    if (fromFile) {
      const byId = new Map();
      chains.forEach(item => { const id = fileEntities.get(item.chain); if (!byId.has(id)) { byId.set(id, []); sets.push(byId.get(id)); } byId.get(id).push(item); });
      /* One group for entities whose copies read the same sequence, as sequence grouping gives. */
      for (let i = 0; i < sets.length; i += 1) for (let j = sets.length - 1; j > i; j -= 1) {
        if (sets[j].some(b => sets[i].some(a => a.unit === b.unit && a.sequence === b.sequence))) { sets[i].push(...sets[j]); sets.splice(j, 1); }
      }
    } else {
      [...chains].sort((a, b) => b.sequence.length - a.sequence.length || a.order - b.order).forEach(item => {
        const home = sets.find(set => sameEntitySequence(set[0], item));
        if (home) home.push(item); else sets.push([item]);
      });
    }
    const groups = sets
      .map(set => set.sort((a, b) => a.order - b.order))
      .sort((a, b) => a[0].order - b[0].order)
      .map((set, index) => {
        const longest = set.reduce((best, item) => (item.length > best.length ? item : best), set[0]);
        return { chains: set.map(item => item.chain), length: longest.length, unit: longest.unit, index, label: greekLetters[index] || 'e' + (index + 1), source: fromFile ? 'file' : 'sequence' };
      });
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

