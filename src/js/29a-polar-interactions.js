  /* ---------- Polar interactions: hydrogen bonds and salt bridges (2.53.0) ----------
     The chemistry only — tables, roles and the search — with no page and no records, so the
     Interfaces table (29), the residue card (04c), the debug hook and a test harness all ask the same
     functions. Heavy atoms only: most structures and every prediction carry no hydrogens, so the
     angles are heavy-atom proxies (the definitions are stated in USAGE, VALIDATION.md and the
     methods text, and tests/reference.py implements them again in Biopython).

     Hydrogen bond: a donor N or O and an acceptor N or O in different residues, not covalently
     bonded to each other, donor–acceptor ≤ 3.5 Å, and both angles antecedent–donor···acceptor and
     donor···acceptor–antecedent ≥ 90° for every antecedent (a heavy atom covalently bonded to the
     atom); an atom with no antecedent skips its test.
     Salt bridge: a cationic N within 4.0 Å of an anionic O, in different residues; one per residue
     pair, reported at its shortest N–O distance. A salt-bridged residue pair is not also listed as
     hydrogen bonds between its charged atoms (an N–O pair whose N is cationic and whose O is
     anionic); hydrogen bonds between its other atoms still are. A chain's N-terminal N is a cation
     and its C-terminal O and OXT anions unless the end is capped (bonded to another residue); a
     nucleotide's free 3′ or 5′ hydroxyl donates as well as accepts, and every free phosphate O
     (OP1, OP2, a 5′ phosphate's OP3) is an anion.

     Covalent bonds are read from geometry, as the residue card's peptide-bond tag is (04c
     contactBond): two heavy atoms of one residue within 1.9 Å, or the backbone link between two
     residues of one chain — C–N (peptide) or O3′–P (phosphodiester) within 1.9 Å. 3Dmol's own
     `bonds` are not used: they are its guess from element radii, and an independent implementation
     could not reproduce them. A residue is its chain, number and insertion code; where a crystal
     structure gives an atom alternate locations the first in the file is used, as everywhere else in
     the viewer (debugAtomPairDistance). */

  const polarHbondCutoff = 3.5;
  const polarSaltCutoff = 4.0;
  const polarBondLength = 1.9;
  /* More drawn at once than this and the values go: the lines alone say where they are. The type
     colours and names are polarTypeColor and polarTypeName (29), functions so that the legend and the
     measurement drawing, which can run before this part has, may ask for them at any time. */
  const polarValueLimit = 40;

  /* Donor (D), acceptor (A) or both (B), by atom name, for the residues whose chemistry is known.
     Backbone N, O and OXT are added in polarRole for every amino acid (PRO's N is no donor). */
  const polarAminoSide = {
    SER: { OG: 'B' }, THR: { OG1: 'B' }, TYR: { OH: 'B' },
    ASN: { OD1: 'A', ND2: 'D' }, GLN: { OE1: 'A', NE2: 'D' },
    HIS: { ND1: 'B', NE2: 'B' }, TRP: { NE1: 'D' }, LYS: { NZ: 'D' },
    ARG: { NE: 'D', NH1: 'D', NH2: 'D' }, ASP: { OD1: 'A', OD2: 'A' }, GLU: { OE1: 'A', OE2: 'A' },
    ALA: {}, CYS: {}, GLY: {}, ILE: {}, LEU: {}, MET: {}, PHE: {}, PRO: {}, VAL: {}
  };
  const polarBases = {
    A: { N1: 'A', N3: 'A', N6: 'D', N7: 'A' },
    G: { O6: 'A', N1: 'D', N2: 'D', N3: 'A', N7: 'A' },
    C: { O2: 'A', N3: 'A', N4: 'D' },
    U: { O2: 'A', N3: 'D', O4: 'A' },
    T: { O2: 'A', N3: 'D', O4: 'A' }
  };
  const polarNucleotideBase = { A: 'A', G: 'G', C: 'C', U: 'U', T: 'T', DA: 'A', DG: 'G', DC: 'C', DT: 'T', DU: 'U' };
  /* Sugar and phosphate, by the remediated names; the older O1P/O2P/O3P are the same atoms. O3′ and
     O5′ are the ester oxygens of a phosphodiester, acceptors only — except at a free end, where they
     are hydroxyls that donate as well (polarRole): a 3′ end's O3′ (no P of the next residue bonded to
     it) and a 5′ end's O5′ (its residue has no P). */
  const polarNucleotideBackbone = { "O2'": 'B', "O3'": 'A', "O4'": 'A', "O5'": 'A', OP1: 'A', OP2: 'A', OP3: 'A', O1P: 'A', O2P: 'A', O3P: 'A' };
  const polarCations = { LYS: ['NZ'], ARG: ['NE', 'NH1', 'NH2'] };
  const polarHistidineCations = ['ND1', 'NE2'];
  const polarAnions = { ASP: ['OD1', 'OD2'], GLU: ['OE1', 'OE2'] };
  /* Every free phosphate oxygen, a 5′-terminal phosphate's OP3 among them. */
  const polarPhosphateAnions = ['OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P'];

  /* An atom's name with the older '*' for a prime written as one, so O2* and O2′ are the same atom. */
  function polarAtomName(atom) {
    return String(atom.atom || '').replace(/\*/g, "'");
  }

  function polarResidueKey(atom) {
    return (atom.chain || '') + '|' + atom.resi + '|' + insertionCodeOf(atom);
  }

  /* The atoms the search works on: heavy atoms, water left out unless asked for, and one copy of each
     atom of a residue — the first, where alternate locations repeat a name. */
  function polarAtomsOf(atoms, options = {}) {
    const seen = new Set();
    return atoms.filter(atom => {
      const element = atomElement(atom);
      if (element === 'H' || element === 'D') return false;
      if (!options.water && isWater(atom)) return false;
      const key = polarResidueKey(atom) + '|' + polarAtomName(atom);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  /* What a role needs to know beyond the atom: every atom of the model (the antecedents of an atom
     at the edge of a chosen set are outside it), the termini and the options. Built once per model.
     An amino acid is a polymer residue (not hetflag — a modified residue bonded into its chain has
     had hetflag cleared, 03b) with N, CA and C; a chain's first such residue's N is its N-terminus,
     its last such residue's O and OXT its C-terminus. These are the first and last residues in the
     file: where a crystal structure leaves a disordered end out, the residue taken for a terminus is
     not the real one (USAGE says so). A capped end is not charged: an N bonded to another residue (an
     acetyl or formyl cap's C) is no N-terminus, and a C bonded to another residue's N (an amide cap,
     NH2) makes no C-terminus — otherwise a neutral amide N or carbonyl O makes salt bridges.
     The context's atoms are its own copies (`own`), kept once so a search need not rebuild them.
     Its grid is binned where the atoms were when it was built: whatever moves a model's atoms in
     place (Align visible, Restore coordinates) forgets it (polarForget). */
  function polarContext(atoms, options = {}) {
    const all = polarAtomsOf(atoms, options);
    const residues = new Map();
    all.forEach(atom => {
      const key = polarResidueKey(atom);
      if (!residues.has(key)) residues.set(key, []);
      residues.get(key).push(atom);
    });
    const firstOfChain = new Map(); const lastOfChain = new Map();
    residues.forEach((list, key) => {
      const names = new Set(list.map(polarAtomName));
      if (list[0].hetflag || !names.has('N') || !names.has('CA') || !names.has('C')) return;
      const chain = list[0].chain || '';
      if (!firstOfChain.has(chain)) firstOfChain.set(chain, key);
      lastOfChain.set(chain, key);
    });
    const context = { all, own: new Set(all), residues, grid: spatialGrid(all, 2), nTermini: new Set(), cTermini: new Set(), histidineCharged: Boolean(options.histidineCharged), water: Boolean(options.water), antecedentCache: new Map(), roleCache: new Map() };
    const named = (key, name) => residues.get(key).find(atom => polarAtomName(atom) === name);
    const linkedOut = atom => Boolean(atom) && polarAntecedents(atom, context).some(other => polarResidueKey(other) !== polarResidueKey(atom));
    firstOfChain.forEach(key => { const n = named(key, 'N'); if (n && !linkedOut(n)) context.nTermini.add(n); });
    lastOfChain.forEach(key => {
      if (linkedOut(named(key, 'C'))) return;
      residues.get(key).forEach(atom => { if (['O', 'OXT'].includes(polarAtomName(atom))) context.cTermini.add(atom); });
    });
    return context;
  }

  /* A model's cached context, forgotten: its atoms moved in place (Align visible, Restore
     coordinates) or were let go (03 releaseHiddenModels). The next search builds a new one. */
  function polarForget(entry) {
    if (entry) entry.polarCache = null;
  }

  /* An N or O atom's part: { donor, acceptor, cation, anion, byElement }, or null when it takes none
     (any other element, PRO's N, a nucleotide's glycosidic N). A residue whose chemistry is not in the
     tables — a ligand, a modified residue — takes every N and O as both donor and acceptor, and says
     so (byElement), so no chemistry is assumed. */
  function polarRole(atom, context) {
    if (context.roleCache.has(atom)) return context.roleCache.get(atom);
    const element = atomElement(atom);
    let made = null;
    if (element === 'N' || element === 'O') {
      const name = polarAtomName(atom); const resn = String(atom.resn || '').toUpperCase();
      const role = code => ({ donor: code === 'D' || code === 'B', acceptor: code === 'A' || code === 'B', cation: false, anion: false, byElement: false });
      if (isWater(atom)) made = element === 'O' ? role('B') : null;
      else if (!atom.hetflag && polarAminoSide[resn]) {
        const side = polarAminoSide[resn];
        if (name === 'N') made = resn === 'PRO' ? null : role('D');
        else if (name === 'O' || name === 'OXT') made = role('A');
        else if (side[name]) made = role(side[name]);
        if (made) {
          made.cation = Boolean(polarCations[resn] && polarCations[resn].includes(name)) || (resn === 'HIS' && context.histidineCharged && polarHistidineCations.includes(name));
          made.anion = Boolean(polarAnions[resn] && polarAnions[resn].includes(name));
        }
      } else if (!atom.hetflag && polarNucleotideBase[resn]) {
        let code = polarNucleotideBackbone[name] || polarBases[polarNucleotideBase[resn]][name];
        /* A free end's hydroxyl: O3′ with no next residue's P bonded to it, O5′ of a residue with no P. */
        if (name === "O3'" && !polarAntecedents(atom, context).some(other => polarAtomName(other) === 'P' && polarResidueKey(other) !== polarResidueKey(atom))) code = 'B';
        if (name === "O5'" && !(context.residues.get(polarResidueKey(atom)) || []).some(other => polarAtomName(other) === 'P')) code = 'B';
        if (code) { made = role(code); made.anion = polarPhosphateAnions.includes(name); }
      } else made = { donor: true, acceptor: true, cation: false, anion: false, byElement: true };
      /* The chain's ends, whatever the residue: its N-terminal N is a donor and a cation (PRO's too),
         its C-terminal O and OXT acceptors and anions. */
      if (context.nTermini.has(atom)) { made = made || role('D'); made.donor = true; made.cation = true; }
      if (context.cTermini.has(atom)) { made = made || role('A'); made.acceptor = true; made.anion = true; }
    }
    context.roleCache.set(atom, made);
    return made;
  }

  /* The heavy atoms covalently bonded to an atom, by the geometric rule at the top of this part. */
  function polarAntecedents(atom, context) {
    if (context.antecedentCache.has(atom)) return context.antecedentCache.get(atom);
    const limit = polarBondLength * polarBondLength;
    const key = polarResidueKey(atom); const name = polarAtomName(atom);
    const partner = name === 'N' ? 'C' : name === 'C' ? 'N' : name === "O3'" ? 'P' : name === 'P' ? "O3'" : null;
    const found = [];
    context.grid.near(atom).forEach(index => {
      const other = context.all[index];
      if (other === atom || squaredDistance(atom, other) > limit) return;
      if (polarResidueKey(other) === key) { found.push(other); return; }
      if (partner && polarAtomName(other) === partner && (other.chain || '') === (atom.chain || '')) found.push(other);
    });
    context.antecedentCache.set(atom, found);
    return found;
  }

  /* Whether every antecedent of `atom` makes an angle of at least 90° with `other` at `atom`. */
  function polarAnglesOpen(atom, other, context) {
    return polarAntecedents(atom, context).every(before => (before.x - atom.x) * (other.x - atom.x) + (before.y - atom.y) * (other.y - atom.y) + (before.z - atom.z) * (other.z - atom.z) <= 0);
  }

  /* The context's own copy of each atom (the first alternate location), so a set chosen from a
     model's atoms is searched as the context knows it. */
  function polarPick(atoms, context) {
    return atoms.filter(atom => context.own.has(atom)).map(atom => ({ atom, role: polarRole(atom, context) })).filter(item => item.role);
  }

  /* The context's atoms within reach of a few atoms (a residue): inside their box widened by the salt-
     bridge cutoff, so a search from one residue looks at its neighbourhood, not at the whole model. */
  function polarNear(atoms, context) {
    if (!atoms.length) return [];
    const low = ['x', 'y', 'z'].map(axis => Math.min(...atoms.map(atom => atom[axis])) - polarSaltCutoff);
    const high = ['x', 'y', 'z'].map(axis => Math.max(...atoms.map(atom => atom[axis])) + polarSaltCutoff);
    return context.all.filter(atom => atom.x >= low[0] && atom.x <= high[0] && atom.y >= low[1] && atom.y <= high[1] && atom.z >= low[2] && atom.z <= high[2]);
  }

  /* Every hydrogen bond and salt bridge between the atoms of `atomsA` and those of `atomsB` (the same
     array for the interactions within one set, each pair once): [{ type: 'hbond'|'salt', a, b,
     distance, byElement, donor, acceptor }], a from atomsA and b from atomsB. For a hydrogen bond
     `donor` and `acceptor` are the two atoms when the tables decide which is which, null when either
     could be; for a salt bridge they are the cationic N and the anionic O. Options: `context`
     (polarContext over the whole model; built from atomsA and atomsB when left out),
     `histidineCharged`, `water`. Sorted by the residues of a, then those of b, then distance. */
  function polarInteractions(atomsA, atomsB, options = {}) {
    const same = atomsA === atomsB;
    const context = options.context || polarContext(same ? atomsA : atomsA.concat(atomsB), options);
    const sideA = polarPick(atomsA, context); const sideB = same ? sideA : polarPick(atomsB, context);
    const grid = spatialGrid(sideB.map(item => item.atom), polarSaltCutoff);
    const hbondLimit = polarHbondCutoff * polarHbondCutoff; const saltLimit = polarSaltCutoff * polarSaltCutoff;
    const hbonds = []; const salts = new Map();
    sideA.forEach((first, indexA) => {
      const keyA = polarResidueKey(first.atom);
      grid.near(first.atom).forEach(indexB => {
        if (same && indexB <= indexA) return;
        const second = sideB[indexB];
        const keyB = polarResidueKey(second.atom);
        if (keyB === keyA) return;
        const d2 = squaredDistance(first.atom, second.atom);
        if (d2 > saltLimit) return;
        const distance = Math.sqrt(d2);
        const byElement = first.role.byElement || second.role.byElement;
        const pairKey = keyA < keyB ? keyA + '>' + keyB : keyB + '>' + keyA;
        /* A salt bridge: one per residue pair, at its shortest cation–anion distance. */
        const cationFirst = first.role.cation && second.role.anion; const cationSecond = second.role.cation && first.role.anion;
        const charged = cationFirst || cationSecond;
        if (charged) {
          const held = salts.get(pairKey);
          if (!held || distance < held.distance) salts.set(pairKey, { type: 'salt', a: first.atom, b: second.atom, distance, byElement, donor: cationFirst ? first.atom : second.atom, acceptor: cationFirst ? second.atom : first.atom });
        }
        if (d2 > hbondLimit) return;
        const forward = first.role.donor && second.role.acceptor; const backward = second.role.donor && first.role.acceptor;
        if (!forward && !backward) return;
        if (polarAntecedents(first.atom, context).includes(second.atom)) return;
        if (!polarAnglesOpen(first.atom, second.atom, context) || !polarAnglesOpen(second.atom, first.atom, context)) return;
        const either = forward && backward;
        hbonds.push({ item: { type: 'hbond', a: first.atom, b: second.atom, distance, byElement, donor: either ? null : forward ? first.atom : second.atom, acceptor: either ? null : forward ? second.atom : first.atom }, charged, pairKey });
      });
    });
    /* A salt-bridged pair's charged N–O pairs are the salt bridge, not hydrogen bonds beside it. */
    const kept = hbonds.filter(found => !(found.charged && salts.has(found.pairKey))).map(found => found.item);
    const code = atom => insertionCodeOf(atom);
    const order = (x, y) => compareChains(x.a.chain || '', y.a.chain || '') || x.a.resi - y.a.resi || (code(x.a) < code(y.a) ? -1 : code(x.a) > code(y.a) ? 1 : 0)
      || compareChains(x.b.chain || '', y.b.chain || '') || x.b.resi - y.b.resi || (code(x.b) < code(y.b) ? -1 : code(x.b) > code(y.b) ? 1 : 0) || x.distance - y.distance;
    return [...kept, ...salts.values()].sort(order);
  }

  /* Hydrogen bonds and salt bridges in a list of interactions. */
  function polarCounts(list) {
    const hbonds = list.filter(item => item.type === 'hbond').length;
    return { hbonds, salts: list.length - hbonds };
  }

  /* The context over a model's atoms, cached on the atoms array and the histidine option it was
     made with — so the card, the table and the debug hook build it once. */
  function polarModel(entry, histidineCharged = polarHistidineCharged()) {
    const charged = Boolean(histidineCharged);
    if (!entry.polarCache || entry.polarCache.atoms !== entry.atoms || entry.polarCache.histidineCharged !== charged) {
      entry.polarCache = { atoms: entry.atoms, histidineCharged: charged, context: polarContext(entry.atoms, { histidineCharged: charged }) };
    }
    return entry.polarCache.context;
  }

  /* "12 hydrogen bonds and 3 salt bridges", "1 hydrogen bond", "no hydrogen bonds or salt bridges". */
  function polarCountText(counts) {
    const parts = [];
    if (counts.hbonds) parts.push(counts.hbonds + ' hydrogen bond' + (counts.hbonds === 1 ? '' : 's'));
    if (counts.salts) parts.push(counts.salts + ' salt bridge' + (counts.salts === 1 ? '' : 's'));
    return parts.length ? parts.join(' and ') : 'no hydrogen bonds or salt bridges';
  }
