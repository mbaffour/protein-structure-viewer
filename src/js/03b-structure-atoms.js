  /* ---------- What the parsers leave out of a structure's atoms ----------
     Two facts 3Dmol 2.4.2 does not put on the atoms it reads, set here once, as a model is made
     (materializeEntry), so the strip, the card, picking, the contact map and every export read the
     same residues whichever format the file came in.

     1. An mmCIF file's insertion codes. 3Dmol's mmCIF reader never reads
        _atom_site.pdbx_PDB_ins_code, so 100, 100A and 100B came in as three residues all numbered 100
        and every lookup by chain and number merged them — for every .cif, including every structure
        fetched by PDB ID — while its PDB reader fills `icode` from column 27. The code is read here
        from the file's own atom_site loop and set as `icode`, the property the PDB reader fills, so
        one path (insertionCodeOf) serves both formats.

     2. Modified residues written as HETATM. TPO, SEP, PTR, MSE and the like are residues of their
        chain, but they are HETATM records, and 3Dmol's `hetflag` is the record name — so the viewer,
        which reads `hetflag` as "ligand", dropped them from the strip, Composition, the FASTA, the
        contact map and the card, and listed them under Ligands. The rule: a HETATM residue that has a
        backbone (N, Cα and C; or C1′ with P or O3′ for a nucleotide) and is bonded into its chain —
        its C within 1.9 Å of another residue's N, or its N of another's C (O3′–P for a nucleotide),
        the bond length the residue card already calls a peptide bond — is a polymer residue: its
        `hetflag` is cleared and `polymerHetatm` keeps the record type. A name list would miss any
        modification it did not know; the bond test asks the structure. A free amino acid, a
        cap (ACE, NH2: no Cα) or a ligand is not bonded into a chain this way and stays a ligand.
        The neighbour may itself be HETATM, so two phosphothreonines in a row both count. */

  /* The parent of common modified residues (the wwPDB chemical component dictionary's
     mon_nstd_parent_comp_id), for the one-letter code only: membership is the bond test above. */
  const modifiedResidueParents = {
    MSE: 'MET', FME: 'MET', TPO: 'THR', SEP: 'SER', PTR: 'TYR', HYP: 'PRO', MLY: 'LYS', M3L: 'LYS',
    ALY: 'LYS', KCX: 'LYS', LLP: 'LYS', CSO: 'CYS', CSD: 'CYS', CME: 'CYS', OCS: 'CYS', NEP: 'HIS',
    HIC: 'HIS', CGU: 'GLU', PSU: 'U', '5MU': 'U', H2U: 'U', '4SU': 'U', '5MC': 'C', OMC: 'C',
    '1MA': 'A', OMG: 'G', '1MG': 'G', '2MG': 'G', M2G: 'G', '7MG': 'G'
  };

  /* The insertion code of every row of an mmCIF file's atom_site loop, by row — 3Dmol's mmCIF reader
     numbers its atoms' `serial` by that row (TER rows included, though it skips them) — with each
     row's residue number and atom name to check the pairing against. null when the file has no such
     column or a loop this reader cannot follow (a ;-delimited text field), so nothing is guessed. */
  function mmcifInsertionCodes(text) {
    if (typeof text !== 'string' || !/^_atom_site\.pdbx_PDB_ins_code\b/im.test(text)) return null;
    const lines = text.split(/\r?\n/);
    let at = lines.findIndex((line, index) => /^_atom_site\./i.test(line.trim()) && index > 0 && /^loop_$/i.test(lines[index - 1].trim()));
    if (at < 0) return null;
    const columns = [];
    for (; at < lines.length && /^_atom_site\./i.test(lines[at].trim()); at += 1) columns.push(lines[at].trim().split(/\s/)[0].toLowerCase());
    const column = name => columns.indexOf('_atom_site.' + name);
    const code = column('pdbx_pdb_ins_code'); const seq = column('auth_seq_id') >= 0 ? column('auth_seq_id') : column('label_seq_id');
    const name = column('auth_atom_id') >= 0 ? column('auth_atom_id') : column('label_atom_id');
    if (code < 0) return null;
    const codes = []; const numbers = []; const names = [];
    /* CIF quoting: a quote ends a value only where whitespace follows it, so C1' stays one value. */
    const token = /'(.*?)'(?=\s|$)|"(.*?)"(?=\s|$)|(\S+)/g;
    let cell = 0;
    for (; at < lines.length; at += 1) {
      const line = lines[at];
      if (/^(_|loop_|data_|#)/i.test(line.trim())) break;
      if (line.startsWith(';')) return null;
      token.lastIndex = 0; let match;
      while ((match = token.exec(line))) {
        const value = match[1] ?? match[2] ?? match[3]; const row = Math.floor(cell / columns.length); const place = cell % columns.length;
        if (place === code) codes[row] = value === '?' || value === '.' ? '' : value;
        else if (place === seq) numbers[row] = value;
        else if (place === name) names[row] = value;
        cell += 1;
      }
    }
    return { codes, numbers, names };
  }

  /* Sets `icode` on the atoms of an mmCIF model from the table above. Every atom must line up with
     its row (same residue number, same atom name) or none is changed: a file 3Dmol read some other
     way keeps the merged residues it had rather than codes from the wrong atoms. Cached per text,
     since a model is made again when a hidden one comes back (releaseHiddenModels). */
  function applyMmcifInsertionCodes(entry, atoms) {
    if (!entry.insertionCodes || entry.insertionCodes.text !== entry.text) entry.insertionCodes = { text: entry.text, table: mmcifInsertionCodes(entry.text) };
    const table = entry.insertionCodes.table;
    if (!table || !table.codes.some(Boolean)) return;
    const lined = atoms.every(atom => {
      const row = atom.serial;
      if (!Number.isInteger(row) || table.codes[row] === undefined) return false;
      if (table.numbers[row] !== undefined && Number.parseInt(table.numbers[row], 10) !== Number(atom.resi)) return false;
      return table.names[row] === undefined || table.names[row].replace(/"/g, '') === atom.atom;
    });
    if (!lined) return;
    atoms.forEach(atom => { const value = table.codes[atom.serial]; if (value) atom.icode = value; });
  }

  /* The HETATM atoms of residues bonded into their chain, by the rule at the top of this section. */
  function linkedHetatmAtoms(atoms) {
    const bond = 1.9 * 1.9;
    const keyOf = atom => (atom.chain || '') + '|' + atom.resi + '|' + insertionCodeOf(atom);
    const groups = new Map();
    atoms.forEach(atom => {
      if (!atom.hetflag || isWater(atom)) return;
      const key = keyOf(atom);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(atom);
    });
    const has = (list, ...names) => names.every(name => list.some(atom => (Array.isArray(name) ? name : [name]).includes(atom.atom)));
    const candidates = [...groups.entries()].filter(([, list]) => has(list, 'N', 'CA', 'C') || has(list, ["C1'", 'C1*'], ['P', "O3'", 'O3*']));
    if (!candidates.length) return [];
    const partners = { C: ['N'], N: ['C'], P: ["O3'", 'O3*'], "O3'": ['P'], 'O3*': ['P'] };
    const ends = new Map();
    atoms.forEach(atom => {
      if (!partners[atom.atom] || isWater(atom)) return;
      const chain = atom.chain || '';
      if (!ends.has(chain)) ends.set(chain, []);
      ends.get(chain).push(atom);
    });
    const linked = [];
    candidates.forEach(([key, list]) => {
      const pool = ends.get(list[0].chain || '') || [];
      const bonded = list.some(atom => partners[atom.atom] && pool.some(other => partners[atom.atom].includes(other.atom) && keyOf(other) !== key && squaredDistance(atom, other) <= bond));
      if (bonded) linked.push(...list);
    });
    return linked;
  }

  /* Run on a model's atoms as it is made, before anything reads them. */
  function prepareStructureAtoms(entry, atoms) {
    if (entry.format === 'cif') applyMmcifInsertionCodes(entry, atoms);
    linkedHetatmAtoms(atoms).forEach(atom => { atom.hetflag = false; atom.polymerHetatm = true; });
  }

  /* A second copy of a model (an export, a compare panel) is parsed from the same text, so it has
     neither of the above: it takes them, with the coordinates, from the entry's atoms by index. */
  function adoptEntryAtoms(atoms, entry) {
    atoms.forEach((atom, index) => {
      const source = entry.atoms[index]; if (!source) return;
      atom.x = source.x; atom.y = source.y; atom.z = source.z;
      atom.hetflag = source.hetflag;
      if (source.icode !== undefined) atom.icode = source.icode;
      if (source.polymerHetatm) atom.polymerHetatm = true;
    });
  }

