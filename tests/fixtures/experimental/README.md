# Measured structures

Deposited crystal structures, and distances other people measured on them, used by
`tests/validate-experimental.mjs` (and one step of `tests/run.mjs`) to check the viewer's atom-pair
distances and residue contacts against numbers this project did not compute. Downloaded 2026-11-01.
**Nothing here is modified** — the values are checked as their sources give them.

| File | What it is | Source |
| --- | --- | --- |
| `2hhb.cif` | Human deoxyhaemoglobin, chains A–D (α₂β₂) with four haem groups | wwPDB entry 2HHB — Fermi, G., Perutz, M. F., Shaanan, B. & Fourme, R. (1984) The crystal structure of human deoxyhaemoglobin at 1.74 Å resolution. *J. Mol. Biol.* 175, 159–174 |
| `1brs.cif` | Barnase–barstar complex, chains A–C barnase and D–F barstar; Ser14 of chain D has two alternate locations | wwPDB entry 1BRS — Buckle, A. M., Schreiber, G. & Fersht, A. R. (1994) Protein–protein recognition: crystal structural analysis of a barnase–barstar complex at 2.0-Å resolution. *Biochemistry* 33, 8878–8889 |
| `5cha.cif` | Bovine α-chymotrypsin at 1.67 Å, two molecules; molecule 1 is chains A, B and C (His57 and Asp102 on B, Ser195 on C) | wwPDB entry 5CHA — Blevins, R. A. & Tulinsky, A. (1985) The refinement and the structure of the dimer of α-chymotrypsin at 1.67-Å resolution. *J. Biol. Chem.* 260, 4264–4275 |
| `pisa-2hhb.json`, `pisa-1brs.json` | Every hydrogen bond and salt bridge PDBePISA lists across the asymmetric-unit interfaces of the entry (both molecules at symmetry operator x,y,z): the two atoms and their distance — 44 for 2HHB, 77 for 1BRS, all under 4 Å | PDBePISA, `interfaces.pisa` of each entry — Krissinel, E. & Henrick, K. (2007) Inference of macromolecular assemblies from crystalline state. *J. Mol. Biol.* 372, 774–797 |
| `published-distances.json` | The catalytic-triad distances of 5CHA molecule 1 — His57 NE2 – Ser195 OG 3.02 Å and Asp102 OD1 – His57 ND1 2.67 Å — as printed by the source | J. D. Cronk, Gonzaga University, CHEM 440 "catalytic triad" page (web02.gonzaga.edu/faculty/cronk/CHEM440pub/catalytic-triad.html), a figure based on PDB entry 5CHA |

The `.cif` files are the wwPDB mmCIF files of the three entries; PDB archive data are free of all
copyright restrictions (CC0 1.0). The PISA files keep, per bond, the kind (`h-bonds` or
`salt-bridges`), each residue's chain, name, number and insertion code, the atom names and PISA's
distance; chains and numbers are the authors' (`auth_asym_id`, `auth_seq_id`), which is what the
viewer reads.

Why these: haemoglobin's α₁β₁/α₁β₂ interfaces and the barnase–barstar interface are classic,
well-characterised protein–protein interfaces with many polar contacts, three of them (2HHB) between a
haem and a protein side chain; the chymotrypsin triad is the textbook short-distance pair, with a value
printed by someone else for the same entry.
