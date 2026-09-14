# Validation

Every quantity the viewer reports was compared with an independent implementation on three real
AlphaFold 3 runs. This file records the method, the results and the limits of the check, and how to
rerun it on your own run. Last run: 2026-09-13, viewer 2.21.0.

## Method

`tests/reference.py` computes, with **Biopython 1.85** (`Bio.PDB.MMCIFParser`, `Bio.SVDSuperimposer`,
`Bio.PDB.NeighborSearch`) and **numpy 2.0.2**:

- the mean pLDDT of every model over Cα atoms (from the B-factor column);
- the Kabsch least-squares superposition of every model onto model 0, Cα atoms paired by chain and
  residue id, and the RMSD over the paired atoms;
- the per-residue Cα root-mean-square fluctuation about the mean position across the five superposed
  models (count, maximum, mean and the first five residues);
- the radius of gyration of model 0 over Cα atoms with equal weights, and its exact maximum Cα–Cα
  distance (full pairwise scan);
- the set of residues (chain, number, name) with any heavy atom within a cutoff of any heavy atom of
  one chain, hetero groups excluded;
- the inter-chain contact map of two chains on model 0: every residue pair with a heavy-atom pair
  within the cutoff, with the closest such distance (the Compare tab's *Interface contact map*);
- per-column statistics of every unpaired `.a3m` in the run — conservation (1 − H/log₂20, gaps and X
  excluded), identity to the query and coverage — with lowercase insertions dropped, exactly as the
  viewer's *Colour by MSA* defines them.

`tests/validate.mjs` then opens the same files in the real viewer (headless Chromium via Playwright),
runs *Align visible* in identifier mode with model 0 as reference, reads the same quantities through the
`?debug=1` hook, and compares. Tolerances: 0.01 for pLDDT, 0.001 Å for every distance, exact match for
the residue set. The reference values are rounded to four decimals, so differences of a few 10⁻⁵ Å are
the rounding of the reference, not of the viewer.

The runs are the author's own predictions of phage assemblies and are not committed; the scripts run on
any AlphaFold 3 archive.

## Results


### Run A — M13 virion tip, 15 chains (5 × 33, 5 × 32, 5 × 73 residues), 690 Cα, 5 models, loaded as the archive

| quantity | viewer | reference | abs. difference | |
|---|---:|---:|---:|:--:|
| Cα extent (Å) | 78.8932 | 78.8932 | 3.1e-05 | ✓ |
| radius of gyration (Å) | 27.2349 | 27.2349 | 2.5e-05 | ✓ |
| contacts within 6 Å of chain K (residue set) | 57 | 57 | 0.0e+00 | ✓ |
| Cα pairs · model 1 | 690 | 690 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 1 | 20.1718 | 20.1718 | 4.6e-05 | ✓ |
| Cα pairs · model 2 | 690 | 690 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 2 | 28.2407 | 28.2407 | 1.3e-05 | ✓ |
| Cα pairs · model 3 | 690 | 690 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 3 | 28.1157 | 28.1157 | 2.0e-05 | ✓ |
| Cα pairs · model 4 | 690 | 690 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 4 | 18.8659 | 18.8659 | 4.4e-05 | ✓ |
| RMSF residues | 690 | 690 | 0.0e+00 | ✓ |
| RMSF maximum (Å) | 30.3474 | 30.3474 | 4.2e-05 | ✓ |
| RMSF mean (Å) | 15.5558 | 15.5558 | 2.8e-05 | ✓ |
| RMSF A:1 (Å) | 12.0724 | 12.0724 | 3.5e-05 | ✓ |
| RMSF A:2 (Å) | 13.8633 | 13.8633 | 4.6e-05 | ✓ |
| RMSF A:3 (Å) | 15.4920 | 15.4920 | 3.6e-05 | ✓ |
| RMSF A:4 (Å) | 14.1056 | 14.1056 | 1.4e-05 | ✓ |
| RMSF A:5 (Å) | 13.6969 | 13.6969 | 3.7e-05 | ✓ |
| mean Cα pLDDT · model 0 | 45.4848 | 45.4850 | 2.0e-04 | ✓ |
| mean Cα pLDDT · model 1 | 43.0367 | 43.0370 | 2.8e-04 | ✓ |
| mean Cα pLDDT · model 2 | 45.7664 | 45.7660 | 3.6e-04 | ✓ |
| mean Cα pLDDT · model 3 | 45.4728 | 45.4730 | 2.2e-04 | ✓ |
| mean Cα pLDDT · model 4 | 46.2431 | 46.2430 | 1.3e-04 | ✓ |

PAE domains at 6 Å on model 0: 10 domains, 365 residues unassigned (heuristic; run without error, not compared). Console errors: 0.

### Run B — MS2 maturation protein with a coat-protein dimer, 3 chains (393, 130, 130 residues), 653 Cα, 5 models, loaded as files

| quantity | viewer | reference | abs. difference | |
|---|---:|---:|---:|:--:|
| mean Cα pLDDT · model 0 | 79.1519 | 79.1520 | 5.5e-05 | ✓ |
| mean Cα pLDDT · model 1 | 79.1366 | 79.1370 | 3.5e-04 | ✓ |
| mean Cα pLDDT · model 2 | 79.0363 | 79.0360 | 2.9e-04 | ✓ |
| mean Cα pLDDT · model 3 | 79.0368 | 79.0370 | 2.2e-04 | ✓ |
| mean Cα pLDDT · model 4 | 78.7073 | 78.7070 | 3.2e-04 | ✓ |
| Cα extent (Å) | 141.7048 | 141.7048 | 7.3e-06 | ✓ |
| radius of gyration (Å) | 41.3064 | 41.3064 | 2.2e-05 | ✓ |
| contacts within 5 Å of chain A (residue set) | 17 | 17 | 0.0e+00 | ✓ |
| Cα pairs · model 1 | 653 | 653 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 1 | 11.9874 | 11.9874 | 4.3e-05 | ✓ |
| Cα pairs · model 2 | 653 | 653 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 2 | 21.5298 | 21.5298 | 2.2e-05 | ✓ |
| Cα pairs · model 3 | 653 | 653 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 3 | 13.2599 | 13.2599 | 2.0e-05 | ✓ |
| Cα pairs · model 4 | 653 | 653 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 4 | 16.3028 | 16.3028 | 2.6e-05 | ✓ |
| RMSF residues | 653 | 653 | 0.0e+00 | ✓ |
| RMSF maximum (Å) | 35.2334 | 35.2334 | 4.4e-05 | ✓ |
| RMSF mean (Å) | 9.9836 | 9.9836 | 2.5e-05 | ✓ |
| RMSF A:1 (Å) | 5.0374 | 5.0374 | 1.0e-05 | ✓ |
| RMSF A:2 (Å) | 5.2609 | 5.2609 | 9.7e-07 | ✓ |
| RMSF A:3 (Å) | 4.9791 | 4.9791 | 1.0e-05 | ✓ |
| RMSF A:4 (Å) | 5.5625 | 5.5625 | 4.8e-05 | ✓ |
| RMSF A:5 (Å) | 5.6312 | 5.6312 | 1.0e-05 | ✓ |

PAE domains at 6 Å on model 0: 6 domains, 50 residues unassigned (heuristic; run without error, not compared). Console errors: 0.

### Run C — phiX174 F and G proteins, 2 chains (427, 175 residues), 602 Cα, 5 models, loaded as files

| quantity | viewer | reference | abs. difference | |
|---|---:|---:|---:|:--:|
| mean Cα pLDDT · model 0 | 94.8500 | 94.8500 | 3.3e-05 | ✓ |
| mean Cα pLDDT · model 1 | 94.8033 | 94.8030 | 2.9e-04 | ✓ |
| mean Cα pLDDT · model 2 | 94.7843 | 94.7840 | 3.0e-04 | ✓ |
| mean Cα pLDDT · model 3 | 94.9468 | 94.9470 | 1.9e-04 | ✓ |
| mean Cα pLDDT · model 4 | 94.8608 | 94.8610 | 1.7e-04 | ✓ |
| Cα extent (Å) | 112.7738 | 112.7738 | 5.0e-06 | ✓ |
| radius of gyration (Å) | 33.3298 | 33.3298 | 4.9e-05 | ✓ |
| contacts within 5 Å of chain A (residue set) | 10 | 10 | 0.0e+00 | ✓ |
| Cα pairs · model 1 | 602 | 602 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 1 | 0.3927 | 0.3927 | 4.9e-05 | ✓ |
| Cα pairs · model 2 | 602 | 602 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 2 | 0.7602 | 0.7602 | 3.6e-05 | ✓ |
| Cα pairs · model 3 | 602 | 602 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 3 | 0.7482 | 0.7482 | 1.7e-05 | ✓ |
| Cα pairs · model 4 | 602 | 602 | 0.0e+00 | ✓ |
| RMSD onto model 0 (Å) · model 4 | 0.5764 | 0.5764 | 4.7e-05 | ✓ |
| RMSF residues | 602 | 602 | 0.0e+00 | ✓ |
| RMSF maximum (Å) | 1.3968 | 1.3968 | 1.1e-05 | ✓ |
| RMSF mean (Å) | 0.3545 | 0.3545 | 4.0e-07 | ✓ |
| RMSF A:1 (Å) | 1.3860 | 1.3860 | 3.9e-05 | ✓ |
| RMSF A:2 (Å) | 1.3968 | 1.3968 | 1.1e-05 | ✓ |
| RMSF A:3 (Å) | 1.1258 | 1.1258 | 1.6e-05 | ✓ |
| RMSF A:4 (Å) | 1.1499 | 1.1499 | 2.6e-05 | ✓ |
| RMSF A:5 (Å) | 0.9598 | 0.9598 | 4.9e-05 | ✓ |

PAE domains at 6 Å on model 0: 4 domains, 10 residues unassigned (heuristic; run without error, not compared). Console errors: 0.

**All 105 comparisons agree within tolerance** (72 from the 2.14.0 pass, 12 for the contact map added in 2.18.1, 21 for the MSA statistics added in 2.21.0). RMSD, RMSF, radius of gyration and extent agree to
better than 5 × 10⁻⁵ Å; contact residue sets are identical; mean pLDDT agrees to 4 × 10⁻⁴.

## What the check found

The Cα *extent* reported up to 2.13.0 was a two-pass estimate (farthest atom from the centre, then farthest
from that atom). Against the exact maximum it under-read Run A by 3.9 Å (75.0 versus 78.9 Å, 4.9 %) and
Run C by 5.1 Å (107.7 versus 112.8 Å, 4.5 %). Since 2.14.0 the extent is the exact pairwise maximum for
assemblies up to 6 000 residues; above that the estimate is kept and shown with a ≥ sign. Everything else
agreed before and after.

## Scale

The same session measured the viewer on the author's three largest runs in headless Chromium with
software rendering (SwiftShader), before and after the 2.14.0 byte-level confidence parser:

| run | atoms per model | PAE tokens | confidence JSON per model | import (s) before → after | JS heap after import before → after |
|---|---:|---:|---:|---:|---:|
| M13 virion tip (Run A) | 5 215 | 690 | 4.5 MB | 1.1 → 1.0 | 51 MB → 12 MB |
| M13 virion, pointed tip | 22 780 | 3 045 | 84 MB | 4.7 → 4.3 | 1 016 MB → 31 MB |
| M13 five-protein sub-complex | 34 485 | 4 410 | 175 MB | 8.5 → 7.6 | 2 071 MB → 65 MB |

The heap figure is Chromium's `JSHeapUsedSize`, which excludes typed-array storage; the PAE matrices
themselves now occupy 4 bytes per cell (78 MB per model at 4 410 tokens, 390 MB for five models),
compared with the boxed doubles and the whole parsed contact matrix they replaced. Alignment of five
models, PAE domain detection and the heatmap gave the same values before and after, with zero console
errors. Rendering cost 0.5, 1.9 and 3.1 ms per frame under software rendering.

## Not covered

- **Sequence-aware pairing.** The Needleman–Wunsch chain pairing is a design choice, not a measured
  quantity; identifier pairing is what is validated. Inspect the chain mapping and identity the viewer
  reports before quoting an RMSD from sequence-aware mode.
- **PAE domains.** A heuristic (greedy merge of ten-residue segments below a mean-PAE cutoff, minimum
  twenty residues). It is checked only to run on real matrices without error. It is not the clustering
  used by the AlphaFold Protein Structure Database and will cut differently.
- **Buried surface area** (Confidence tab) and **ligand-site PAE** are not yet in the reference script. The
  Compare tab's contact map is (below); the Confidence tab's interface table uses the same distance rule.
- **Residue colour themes** are lookups (formal charge at neutral pH, Kyte–Doolittle hydrophobicity,
  RasMol amino colours); nothing to compute, but state the scale when you use one.
- Anything **drawn** — cartoons, surfaces, the PAE heatmap — is 3Dmol.js's or the canvas's rendering
  and is checked only for absence of errors.

## Contact map (added 2.18.1)

Chain pair chosen as the one with the most contacts to the chain used above; heavy atoms, hetero groups
excluded. The viewer's pair set, interface residue counts and every closest-atom distance were compared.

| run | chains | cutoff | pairs (viewer / reference) | interface residues (viewer / reference) | largest distance difference | |
|---|---|---:|---:|---:|---:|:--:|
| A — M13 virion tip | K–F | 6 Å | 42 / 42 | 20 + 19 / 20 + 19 | 4.9 × 10⁻⁵ Å | ✓ |
| B — MS2 maturation protein–coat | A–B | 5 Å | 31 / 31 | 15 + 16 / 15 + 16 | 4.7 × 10⁻⁵ Å | ✓ |
| C — phiX174 F–G | A–B | 5 Å | 18 / 18 | 9 + 10 / 9 + 10 | 4.6 × 10⁻⁵ Å | ✓ |

The differences are the four-decimal rounding of the reference values.

## MSA statistics (added 2.21.0)

For every unpaired alignment in the archive, the viewer's per-residue values on the first chain whose
sequence contains the query were compared column by column with the reference. Tolerance 10⁻⁵ for
conservation and identity, exact for coverage.

| run | alignment (chains) | sequences | columns | conservation | identity | coverage |
|---|---|---:|---:|---:|---:|---:|
| A — M13 virion tip | b_d_e_c_a (α) | 1 | 33 | 0 | 0 | exact |
| A — M13 virion tip | j_g_i_h_f (β) | 13 | 32 | 3.5 × 10⁻⁷ | 3.8 × 10⁻⁷ | exact |
| A — M13 virion tip | n_l_o_k_m (γ) | 90 | 73 | 5.0 × 10⁻⁷ | 4.9 × 10⁻⁷ | exact |
| B — MS2 maturation protein–coat | a | 1 875 | 393 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact |
| B — MS2 maturation protein–coat | b_c | 62 | 130 | 5.0 × 10⁻⁷ | 4.9 × 10⁻⁷ | exact |
| C — phiX174 F–G | a | 2 048 | 427 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact |
| C — phiX174 F–G | b | 798 | 175 | 4.9 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact |

Differences are the six-decimal rounding of the reference. Note the single-sequence alignment for the
M13 α entity: its "conservation" of 1 everywhere is a statement about the alignment, not the protein.

## Rerunning

```
cd tests && npm install && npm test            # once; installs Playwright and verifies the vendored libraries
mkdir run && unzip -d run fold_x.zip -x "templates/*" "msas/*paired*"   # keep the unpaired .a3m for the MSA check
python3 reference.py run K 6                    # chain K, 6 Å; needs biopython and numpy
python3 reference.py run K 6 K F                # optionally name the two chains for the contact map
node validate.mjs run                           # or: node validate.mjs run fold_x.zip
```

The validator prints the table above for your run, writes `run/validation.json`, and exits non-zero on
any disagreement.
