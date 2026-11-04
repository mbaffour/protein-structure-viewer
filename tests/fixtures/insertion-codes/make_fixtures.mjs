#!/usr/bin/env node
/* Writes the hand-made insertion-code models in this folder: node make_fixtures.mjs
   Each model is one list of atoms written twice when both formats are wanted — as fixed-column PDB
   (insertion code in column 27, the way the suite's pdbAtom writes it) and as PDBx/mmCIF
   (_atom_site.pdbx_PDB_ins_code, '?' for none, the way the wwPDB and AlphaFold write it) — so a
   difference between what the viewer shows for the two can only be the reader's. */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const pdbLine = ({ name, resn, chain, resi, icode, x, y, z, element, b }, serial) =>
  'ATOM  ' + String(serial).padStart(5) + ' ' + (name.length < 4 ? ' ' + name.padEnd(3) : name) + ' ' + resn.padStart(3) + ' ' + chain + String(resi).padStart(4) + (icode || ' ') + '   '
  + x.toFixed(3).padStart(8) + y.toFixed(3).padStart(8) + z.toFixed(3).padStart(8) + '  1.00' + b.toFixed(2).padStart(6) + '          ' + element.padStart(2);
const pdbText = atoms => atoms.map((atom, index) => pdbLine(atom, index + 1)).join('\n') + '\nEND\n';

const columns = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id',
  'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id', 'pdbx_PDB_model_num'];
const cifText = (name, atoms) => {
  /* label_seq_id counts the residues of a chain from 1, insertions included; the entity is the chain. */
  const seq = new Map(); const entity = new Map(); let last = '';
  const rows = atoms.map((atom, index) => {
    if (!entity.has(atom.chain)) entity.set(atom.chain, entity.size + 1);
    const residue = atom.chain + '|' + atom.resi + '|' + (atom.icode || '');
    if (residue !== last) { seq.set(atom.chain, (seq.get(atom.chain) || 0) + 1); last = residue; }
    return ['ATOM', index + 1, atom.element, atom.name, '.', atom.resn, atom.chain, entity.get(atom.chain), seq.get(atom.chain), atom.icode || '?',
      atom.x.toFixed(3), atom.y.toFixed(3), atom.z.toFixed(3), '1.00', atom.b.toFixed(2), atom.resi, atom.resn, atom.chain, atom.name, 1].join(' ');
  });
  return 'data_' + name + '\n#\n_entry.id ' + name + '\n#\nloop_\n' + columns.map(column => '_atom_site.' + column).join('\n') + '\n' + rows.join('\n') + '\n#\n';
};

/* An extended backbone, 3.8 Å a residue along x, so each C sits 1.4 Å from the next N. */
const residue = (list, resn, chain, resi, icode, x, y, b, names = ['N', 'CA', 'C', 'O']) => {
  const place = { N: [-1.2, 0.5, 0, 'N'], CA: [0, 0, 0, 'C'], C: [1.2, 0.5, 0, 'C'], O: [1.2, 1.7, 0, 'O'], CB: [0, -1.0, 1.2, 'C'] };
  names.forEach(name => { const [dx, dy, dz, element] = place[name]; list.push({ name, resn, chain, resi, icode, x: x + dx, y: y + dy, z: dz, element, b }); });
};

/* 1. The Kabat stretch of the suite's step "insertion codes: 100, 100A and 100B are three residues…":
   heavy chain H 98, 99, 100, 100A, 100B, 101 (pLDDT 90, 90, 92, 41, 62, 90 in the B column) beside a
   light chain L 1–4, N, Cα and C only, as that step builds it in PDB. */
const kabat = [];
[[98, '', 90], [99, '', 90], [100, '', 92], [100, 'A', 41], [100, 'B', 62], [101, '', 90]].forEach(([resi, icode, b], index) => {
  const x = index * 3.8;
  kabat.push({ name: 'N', resn: 'GLY', chain: 'H', resi, icode, x: x - 1.2, y: 0.8, z: 0, element: 'N', b });
  kabat.push({ name: 'CA', resn: 'GLY', chain: 'H', resi, icode, x, y: 0, z: 0, element: 'C', b });
  kabat.push({ name: 'C', resn: 'GLY', chain: 'H', resi, icode, x: x + 1.2, y: 0.8, z: 0, element: 'C', b });
});
[1, 2, 3, 4].forEach((resi, index) => {
  const x = index * 3.8;
  kabat.push({ name: 'N', resn: 'ALA', chain: 'L', resi, icode: '', x: x - 1.2, y: 9.8, z: 0, element: 'N', b: 80 });
  kabat.push({ name: 'CA', resn: 'ALA', chain: 'L', resi, icode: '', x, y: 9, z: 0, element: 'C', b: 80 });
  kabat.push({ name: 'C', resn: 'ALA', chain: 'L', resi, icode: '', x: x + 1.2, y: 9.8, z: 0, element: 'C', b: 80 });
});
writeFileSync(join(here, 'kabat_insertions.cif'), cifText('KABAT', kabat));

/* 2. The model of the step "insertion codes: Measure to… from 57 to 57B…" (j2InsertionModel): chain A
   50–56, 57, 57A, 57B, 60–64 of alanines with Cβ, chain B 50–64 alongside at 5 Å. */
const j2 = [];
const j2Numbering = [[50, ''], [51, ''], [52, ''], [53, ''], [54, ''], [55, ''], [56, ''], [57, ''], [57, 'A'], [57, 'B'], [60, ''], [61, ''], [62, ''], [63, ''], [64, '']];
j2Numbering.forEach(([resi, icode], index) => residue(j2, 'ALA', 'A', resi, icode, index * 3.8, 0, 80, ['N', 'CA', 'C', 'O', 'CB']));
j2Numbering.forEach((unused, index) => residue(j2, 'ALA', 'B', 50 + index, '', index * 3.8, 5, 80, ['N', 'CA', 'C', 'O', 'CB']));
writeFileSync(join(here, 'j2_insertions.cif'), cifText('J2', j2));

/* 3. Five residues of a heavy chain, H 99 GLY, 100 ALA, 100A SER, 100B TYR, 101 GLY, in both formats:
   distinct letters, so a merged or reordered residue shows in the FASTA as well as in the strip. */
const five = [];
[[99, '', 'GLY'], [100, '', 'ALA'], [100, 'A', 'SER'], [100, 'B', 'TYR'], [101, '', 'GLY']].forEach(([resi, icode, resn], index) => residue(five, resn, 'H', resi, icode, index * 3.8, 0, 80));
writeFileSync(join(here, 'fab_h_insertions.pdb'), pdbText(five));
writeFileSync(join(here, 'fab_h_insertions.cif'), cifText('FABH', five));
console.log('wrote kabat_insertions.cif, j2_insertions.cif, fab_h_insertions.pdb, fab_h_insertions.cif');
