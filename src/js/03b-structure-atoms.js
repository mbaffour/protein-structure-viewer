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

  /* One category of an mmCIF file — `_atom_site`, `_entity_poly`, `_struct_asym` — as columns of
     values, read from the file's text, whether it is written as a `loop_` table or as single
     `_category.item value` rows. `items` names the columns wanted (all when omitted), so a large
     atom_site loop keeps three columns, not twenty. Values keep the file's spelling ('?' and '.' are
     left to the caller). A value may be quoted ('…' or "…", a quote ending it only where whitespace
     follows, so C1' stays one value) or a text field: a line starting with ';' opens it and the next
     line starting with ';' closes it, the lines between joined with newlines. A text field that never
     closes gives null, so nothing is guessed. Returns { loop, columns, count, values, textFields } or null when
     the category is not in the file. The data of a loop end at the next tag, loop_, data_, save_ or
     '#' line, as the PDB's own files separate categories with '#'. */
  function mmcifCategory(text, category, items = null) {
    if (typeof text !== 'string') return null;
    const name = String(category).toLowerCase();
    const prefix = '_' + name + '.';
    const found = new RegExp('^[ \\t]*_' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.', 'im').exec(text);
    if (!found) return null;
    let at = found.index;
    const readLine = () => {
      if (at >= text.length) return null;
      let end = text.indexOf('\n', at); if (end < 0) end = text.length;
      const line = text.slice(at, end); at = end + 1;
      return line.endsWith('\r') ? line.slice(0, -1) : line;
    };
    /* A loop_ header is the line before the first tag (blank lines aside). */
    let back = found.index - 1; let previous = '';
    while (back > 0) {
      const start = text.lastIndexOf('\n', back - 1) + 1;
      previous = text.slice(start, back).trim();
      if (previous) break;
      back = start - 1;
    }
    const loop = /^loop_$/i.test(previous);
    const token = /'(.*?)'(?=\s|$)|"(.*?)"(?=\s|$)|(\S+)/g;
    const tokens = line => { const out = []; token.lastIndex = 0; let match; while ((match = token.exec(line))) out.push({ value: match[1] ?? match[2] ?? match[3], bare: match[3] !== undefined }); return out; };
    /* The rest of a text field whose first line is `line`; null if it never closes. The closing line
       may carry more values after its ';'. */
    const textField = line => {
      const parts = [line.slice(1)];
      for (let next = readLine(); next !== null; next = readLine()) {
        if (next.startsWith(';')) return { value: parts.join('\n'), rest: next.slice(1) };
        parts.push(next);
      }
      return null;
    };
    const columns = []; const values = {}; let textFields = false;
    if (loop) {
      let line;
      while (at < text.length) {
        const mark = at; line = readLine();
        if (!line.trim().toLowerCase().startsWith(prefix)) { at = mark; break; }
        columns.push(line.trim().split(/\s/)[0].slice(prefix.length).toLowerCase());
      }
      if (!columns.length) return null;
      const wanted = new Map();
      (items ? items.map(item => item.toLowerCase()) : columns).forEach(item => { const place = columns.indexOf(item); if (place >= 0) { wanted.set(place, item); values[item] = []; } });
      let cell = 0;
      const take = value => { const item = wanted.get(cell % columns.length); if (item !== undefined) values[item][Math.floor(cell / columns.length)] = value; cell += 1; };
      while ((line = readLine()) !== null) {
        if (/^(_|loop_|data_|save_|#)/i.test(line.trim())) break;
        if (line.startsWith(';')) {
          const field = textField(line); if (!field) return null;
          textFields = true; take(field.value); tokens(field.rest).forEach(item => take(item.value));
          continue;
        }
        tokens(line).forEach(item => take(item.value));
      }
      return { loop: true, columns, count: Math.ceil(cell / columns.length), values, textFields };
    }
    /* Single rows: `_category.item value`, the value on the same line or the next (a text field). */
    const row = {}; let item = null; let done = false;
    for (let line = readLine(); line !== null && !done; line = readLine()) {
      if (line.startsWith(';')) {
        const field = textField(line); if (!field) return null;
        textFields = true;
        if (item !== null) { row[item] = field.value; item = null; }
        line = field.rest;
      } else if (/^(loop_|data_|save_|#)/i.test(line.trim())) break;
      for (const part of tokens(line)) {
        if (part.bare && part.value.startsWith('_')) {
          if (!part.value.toLowerCase().startsWith(prefix)) { done = true; break; }
          item = part.value.slice(prefix.length).toLowerCase(); columns.push(item);
        } else if (item !== null) { row[item] = part.value; item = null; }
      }
    }
    (items ? items.map(entry => entry.toLowerCase()) : columns).forEach(key => { if (key in row) values[key] = [row[key]]; });
    return { loop: false, columns, count: 1, values, textFields };
  }

  /* The insertion code of every row of an mmCIF file's atom_site loop, by row — 3Dmol's mmCIF reader
     numbers its atoms' `serial` by that row (TER rows included, though it skips them) — with each
     row's residue number and atom name to check the pairing against. null when the file has no such
     column or no such loop, so nothing is guessed. */
  function mmcifInsertionCodes(text) {
    if (typeof text !== 'string' || !/^_atom_site\.pdbx_PDB_ins_code\b/im.test(text)) return null;
    const table = mmcifCategory(text, 'atom_site', ['pdbx_pdb_ins_code', 'auth_seq_id', 'label_seq_id', 'auth_atom_id', 'label_atom_id']);
    /* An atom_site row split by a text field is not a file 3Dmol numbers row by row: no codes. */
    if (!table || !table.loop || table.textFields || !table.values.pdbx_pdb_ins_code) return null;
    const { values } = table;
    const codes = values.pdbx_pdb_ins_code.map(value => (value === '?' || value === '.' ? '' : value));
    return { codes, numbers: values.auth_seq_id || values.label_seq_id || [], names: values.auth_atom_id || values.label_atom_id || [] };
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

