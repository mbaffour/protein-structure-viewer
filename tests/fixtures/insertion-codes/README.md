# Insertion-code models

Small hand-made models, written by `make_fixtures.mjs` (`node make_fixtures.mjs` regenerates every
file here), for the suite's steps on insertion codes — residues 100, 100A and 100B, as antibody (Kabat)
numbering writes them. The same atoms are written as PDBx/mmCIF (`_atom_site.pdbx_PDB_ins_code`, `?`
for none) and, where a step compares the two, as fixed-column PDB (column 27), so any difference the
viewer shows between the two files is the reader's, not the model's.

| File | What it is | Used by |
| --- | --- | --- |
| `kabat_insertions.cif` | Heavy chain H 98, 99, 100, 100A, 100B, 101 (glycine N, Cα, C; pLDDT 90, 90, 92, 41, 62, 90 in the B column) beside light chain L 1–4 — the model the step "insertion codes: 100, 100A and 100B are three residues…" builds as PDB | its mmCIF variant |
| `j2_insertions.cif` | Chain A 50–56, 57, 57A, 57B, 60–64 and chain B 50–64 alongside at 5 Å, alanines with Cβ on an extended backbone (3.8 Å a residue, each C 1.4 Å from the next N) — the model of the step "insertion codes: Measure to… from 57 to 57B…" | its mmCIF variant |
| `fab_h_insertions.pdb`, `fab_h_insertions.cif` | Five residues of a heavy chain, H 99 GLY, 100 ALA, 100A SER, 100B TYR, 101 GLY (N, Cα, C, O), in both formats | the step comparing the two formats |

These are geometric constructions, not structures of anything. They exist because 3Dmol's mmCIF reader
does not read the insertion-code column (the viewer reads it from the file itself, `03b`), and every
insertion-code step before 2.52.0's batch L built a PDB file.
