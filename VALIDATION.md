# Validation

The core structural quantities below were compared with an independent implementation on three real
AlphaFold 3 runs. Later sections record separate interaction-confidence checks on real and published
predictor outputs. This file records the methods, results, limits and ways to rerun them. The core
three-run check was last run on 2026-09-15 with viewer 2.37.0; the interaction-confidence check was
run on 2026-09-27 with viewer 2.48.0.

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
- the buried surface area of every chain pair in contact on model 0, with `Bio.PDB.SASA.ShrakeRupley`
  set to the viewer's parameters — probe radius 1.4 Å, 92 sphere points per atom, Bondi radii (C 1.70,
  N 1.55, O 1.52, S 1.80 Å; Biopython's defaults are identical for every element these runs contain),
  every non-hydrogen atom of the chain included — as
  BSA(A,B) = SASA(A alone) + SASA(B alone) − SASA(A and B together), **not** halved and floored at
  zero, which is exactly what the Confidence tab's interface table reports;
- per-column statistics of every unpaired `.a3m` in the run — conservation (1 − H/log₂20, gaps and X
  excluded) both with Henikoff & Henikoff (1994) position-based sequence weights and unweighted,
  identity to the query and coverage — with lowercase insertions dropped, exactly as the viewer's
  *Colour by MSA* defines them. The weights are computed independently in Python (1/(r·n) per column,
  summed over the columns where the sequence has a residue, scaled to a mean of 1).

`tests/validate.mjs` then opens the same files in the real viewer (headless Chromium via Playwright),
runs *Align visible* in identifier mode with model 0 as reference, reads the same quantities through the
`?debug=1` hook, and compares. Tolerances: 0.01 for pLDDT, 0.001 Å for every distance, exact match for
the residue set, 2 % on a solvent-accessible area and 5 % on a buried surface area (why those two are
loose is explained under *Buried surface area* below). The reference values are rounded to four
decimals, so differences of a few 10⁻⁵ Å are the rounding of the reference, not of the viewer.

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

**All 130 comparisons agree within tolerance** (72 from the 2.14.0 pass, 12 for the contact map added in 2.18.1, 21 for the MSA statistics added in 2.21.0 plus 7 for the Henikoff-weighted conservation added in 2.24.0, 18 for buried surface area added in 2.23.0). RMSD, RMSF, radius of gyration and extent agree to
better than 5 × 10⁻⁵ Å; contact residue sets are identical; mean pLDDT agrees to 4 × 10⁻⁴; buried
surface areas agree to 2.7 % of two independently sampled Shrake–Rupley calculations.

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
- **Ligand-site PAE** (Confidence tab's ligand-site table) is **not validated**: none of the three runs
  contains a ligand or an ion, so there is nothing to compare against and no synthetic structure has
  been substituted for one. The reference is written down under *Ligand-site PAE* below and can be run
  the day a ligand-bearing prediction exists.
- **Buried surface area** *is* cross-validated since 2.23.0 (below), but only to a few per cent: both
  implementations sample the sphere at 92 points and the two point sets differ.
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

## MSA statistics (added 2.21.0; Henikoff-weighted conservation added 2.24.0)

For every unpaired alignment in the archive, the viewer's per-residue values on the first chain whose
sequence contains the query were compared column by column with the reference. Tolerance 10⁻⁵ for
conservation and identity, exact for coverage. Since 2.24.0 conservation is checked twice: with the
Henikoff position-based weights the viewer applies by default, and with the weights switched off. The
last column gives the largest change the weighting makes to any column of that alignment — a
statement about the alignment, reported so nobody mistakes the weighting for a rounding detail.

| run | alignment (chains) | sequences | columns | conservation (weighted) | conservation (unweighted) | identity | coverage | max Δ weighting |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A — M13 virion tip | b_d_e_c_a (α) | 1 | 33 | 0 | 0 | 0 | exact | 0 |
| A — M13 virion tip | j_g_i_h_f (β) | 13 | 32 | 4.4 × 10⁻⁷ | 3.5 × 10⁻⁷ | 3.8 × 10⁻⁷ | exact | 0.117 |
| A — M13 virion tip | n_l_o_k_m (γ) | 90 | 73 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | 4.9 × 10⁻⁷ | exact | 0.121 |
| B — MS2 maturation protein–coat | a | 1 875 | 393 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact | 0.138 |
| B — MS2 maturation protein–coat | b_c | 62 | 130 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | 4.9 × 10⁻⁷ | exact | 0.130 |
| C — phiX174 F–G | a | 2 048 | 427 | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact | 0.262 |
| C — phiX174 F–G | b | 798 | 175 | 5.0 × 10⁻⁷ | 4.9 × 10⁻⁷ | 5.0 × 10⁻⁷ | exact | 0.317 |

Differences are the six-decimal rounding of the reference. Note the single-sequence alignment for the
M13 α entity: its "conservation" of 1 everywhere is a statement about the alignment, not the protein.
The weighting matters most for the deep phiX174 alignments, where clusters of near-identical
sequences otherwise make moderately variable columns look invariant.

## Buried surface area (added 2.23.0)

Same chain pair as the contact map above. The viewer computes the Shrake–Rupley area of each chain
alone and of the two together over all non-hydrogen atoms (probe 1.4 Å, 92 golden-spiral points,
Bondi radii) and reports BSA = SASA(A) + SASA(B) − SASA(A+B), not halved. `tests/reference.py` does
the same with `Bio.PDB.SASA.ShrakeRupley(probe_radius=1.4, n_points=92)`, whose default radii match
the viewer's table for every element present. The number of chain pairs found in contact and the sum
of BSA over all of them were compared as well as the named pair.

| run | chains | SASA A (viewer / ref, Å²) | SASA B (viewer / ref, Å²) | SASA A+B (viewer / ref, Å²) | BSA (viewer / ref, Å²) | rel. diff. | pairs | total BSA (viewer / ref, Å²) | |
|---|---|---:|---:|---:|---:|---:|---:|---:|:--:|
| A — M13 virion tip | K–F | 7 271.8 / 7 223.4 | 3 290.1 / 3 258.2 | 9 537.9 / 9 429.7 | 1 024.0 / 1 051.9 | 2.7 % | 34 / 34 | 22 246 / 22 089 | ✓ |
| B — MS2 maturation protein–coat | A–B | 22 101.3 / 22 134.0 | 9 554.0 / 9 556.0 | 30 585.4 / 30 628.7 | 1 069.9 / 1 061.4 | 0.8 % | 3 / 3 | 7 668 / 7 588 | ✓ |
| C — phiX174 F–G | A–B | 23 907.2 / 23 893.5 | 9 757.0 / 9 760.8 | 32 954.8 / 32 956.1 | 709.5 / 698.1 | 1.6 % | 1 / 1 | 710 / 698 | ✓ |

**Why the tolerance is per cent and not 10⁻⁵.** Shrake–Rupley is a sampling method: it counts how many
of a fixed set of points on each atom's expanded sphere escape every neighbour. The viewer and
Biopython both use 92 points laid out by a golden-angle spiral, but not the *same* 92 points (the
viewer spans the poles, `y = 1 − 2i/91`; Biopython offsets by half a step, `z = 1 − 1/n − 2i/n`), so
the two estimators differ by their sampling error even though their definitions are identical. That
they *are* identical was checked directly: recomputing both at 960 points brings them to within 0.2 %
of each other (run A: BSA 1 030.3 by the viewer's point set, 1 032.7 by Biopython's; run C: 709.4 and
710.2), so the per-cent gaps at 92 points are noise, not a disagreement about what BSA means.

The measured spread at 92 points is up to 1.2 % on a per-chain SASA — worst for run A, whose chains
are 250–540 atoms, against 0.06 % for run C's 3 000-atom chain — and up to 2.7 % on a BSA, which is a
difference of three numbers twenty times its own size, so only the interface atoms survive the
cancellation and the noise does not shrink with it. The check therefore allows 2 % on a SASA and 5 %
on a BSA: above the observed sampling spread, and far below what any real difference in definition
(halving the area, excluding hetero atoms, a different radii table, a different probe) would produce —
each of those is a 50–100 % effect.

A consequence for users: the viewer's BSA is worth about two significant figures. The table rounds it
to whole Å², which over-states the precision by roughly an order of magnitude; read 1 024 Å² as
"about 1 000 Å²".

## Ligand-site PAE — not validated

The viewer's ligand-site table reports, for each ligand or ion group, the mean of the symmetrised PAE
(½(PAE[i][j] + PAE[j][i])) over every ligand token *i* against every token of every site residue *j*,
the site being the residues with a heavy atom within the cutoff (default 4.5 Å) of any ligand atom,
with ligand tokens found through the AlphaFold 3 `token_chain_ids` / `token_res_ids` arrays.

**None of the three validation runs contains a ligand or an ion** — all three are protein-only
predictions, with no `HETATM` record and no ligand in the job request; the validator now prints this
for each run. No comparison is therefore possible and none is claimed. Building a synthetic
ligand-bearing structure would validate the arithmetic against itself, not the viewer against an
independent reading of a real AlphaFold 3 file, so it was not done.

When a ligand-bearing run exists, the reference is: parse `*_full_data_*.json`, read `pae`,
`token_chain_ids`, `token_res_ids`; take the ligand's tokens as every index whose chain and residue id
match the ligand group (AlphaFold 3 gives one token per ligand *atom*, all sharing the residue id);
take the site with Biopython — residues with any heavy atom within the cutoff of any ligand heavy
atom, water excluded — and map each to its tokens by chain and residue id; report
mean over (i, j) of ½(PAE[i][j] + PAE[j][i]). Tolerance 10⁻³ Å, since this is an exact mean over a
matrix read from disk, not a sampled quantity. The site residue set should be compared as a set, as
the contact residue set already is.

## Interaction confidence (added 2.48.0)

The reference is the published implementation itself: DunbrackLab/IPSAE `ipsae.py`, version 4
(2026-01-03, commit 6174cf9, SHA-256 `10cf9b08c68c91e06cb28526cf2026f47a3980c9048fd3226d13e3304eaf1c27`),
run unmodified with numpy 2.0.2. `tests/validate-ipsae.mjs` runs it on every model of an AlphaFold 3
archive at PAE/distance cutoffs 10/10 and 15/15, drives the viewer headless on the same archive, and
compares every chain pair in both directions and on the combined row: ipSAE, ipSAE_d0chn, ipSAE_d0dom,
ipTM_d0chn, pDockQ, pDockQ2, LIS, the ipTM the model reported for the pair, and the counts n0res,
n0chn, n0dom, nres1, nres2, dist1, dist2. The reference prints the ipSAE family to 6 decimals and
pDockQ, pDockQ2 and LIS to 4, so the tolerance is half a unit in that place — for the ipSAE family
with 1 × 10⁻⁷ added, because the viewer keeps PAE as float32 and ipsae.py as float64, and a value on
a rounding boundary can print differently (a true 0.413344501 prints 0.413345 in the reference and is
0.413344481 in the viewer; 4 of the 304 650 values below sit on such a boundary). Counts must be equal.

Run on 2026-09-27, viewer 2.48.0 (commit 9f88c9f), on 31 of the user's 33 AlphaFold 3 server runs —
155 models of phage M13, MS2, φX174 and other complexes, 2 to 15 chains, 65 to 2 348 residues,
homomers and heteromers. The first eight, which found the two bugs below:

| Run | Chains | Residues |
| --- | ---: | ---: |
| M13 pVII–pIX | 2 | 65 |
| M13 pV homodimer | 2 | 174 |
| gp75–gp63–gp62 | 3 | 357 |
| MS2 pool | 4 | 1 143 |
| M13 pVI pentamer | 5 | 560 |
| M13 virion pVIII segment | 10 | 730 |
| gp63 × 14 | 14 | 1 540 |
| M13 virion round tip | 15 | 690 |

and 23 more — M13 assembly, initiation, hypothesis and follow-up pools (up to 11 chains and 2 164
residues), M13 pools 0001–0003 (up to 14 chains and 2 348 residues), MS2 and φX174 confirmations and
pools.

**304 650 comparisons, none outside tolerance** (117 900 on the first eight, 186 750 on the rest). The
largest difference in every score is the rounding of the reference's printed value; the reported ipTM
and every count agree exactly.

The two remaining runs, the 5× subcomplex (4 410 residues, 15 chains) and the pointy tip (3 045
residues, 15 chains), were not compared: ipsae.py evaluates its kernel with `np.vectorize` over the
whole N × N matrix for every chain pair, which there needs about 1 GB per model and hours of CPU. The
viewer scores the 4 410-residue model in under half a second. On that model the smallest inter-chain
PAE is 11.6 Å, so at a 10 Å cutoff every chain pair's ipSAE is 0 — a property of the prediction,
checked directly on its full_data file.

What the check found on the way, both now fixed:

- **pDockQ and pDockQ2 differed by up to 7.5 × 10⁻⁵.** The AlphaFold Server writes each atom's pLDDT
  twice — in `full_data`'s `atom_plddts` and, rounded, in the mmCIF B-factor column — and the two
  differ by up to 0.1 (63.98 against 63.9 on one of these runs). ipsae.py reads `atom_plddts`; the
  viewer had read the B-factors. The interface scores now use `atom_plddts` whenever it is loaded.
  Mean pLDDT and pLDDT colouring still use the B-factors, as the models' own record of it.
- **The model's ipTM was missing for most multi-chain runs, and the chain-pair table was mislabelled.**
  The server's `summary_confidences` lists `chain_ids` once per *token* (1 143 entries for the MS2
  run), and the viewer took it as one entry per chain: the chain-pair ipTM lookup failed for runs of
  three or more chains, and the chain-pair ipTM table under the PAE map labelled its rows with the
  first entries of that list — "A–A". Chain order is now taken from the list with repeats removed.

**Published predictions.** The same comparison was then run on real files other people have
published, which cover what the user's runs do not (`tests/fixtures/published/`, with provenance and
licences; the suite repeats it on every run):

| Prediction | Tool | What it adds |
| --- | --- | --- |
| barnase–barstar | ColabFold 1.6 | a real ColabFold scores file |
| barnase–barstar | AlphaFold Server | — |
| barnase–barstar | Boltz-2 | a real `.npz` PAE; chains named A and D |
| SARS-CoV-2 Mpro + nirmatrelvir | AlphaFold 3, run locally | a ligand; local file names |
| Aurora A–TPX2 (the ipSAE authors' example) | AlphaFold Server | a phosphothreonine tokenised atom by atom, ATP, two Mg²⁺ |
| a single-chain RNA (coqylight/boltz_dap) and RNase T1 with a ligand (amitashnanda/ESM3-Guided…) | Boltz-2 | real Boltz files with one polymer chain each, so they test loading, the RNA's pLDDT and the ligand handling, not the scores; checked locally, not committed (no licence given) |

**354 comparisons, none outside tolerance** — the ligand chains left out as ipsae.py leaves them out,
the phosphothreonine's Cα token chosen as it chooses it. The published Chai-1 example's PAE (saved
by its author; Chai-1 does not write one) and a locally run AlphaFold 2.3 model load and pair too,
but ipsae.py reads neither format, so they are not in the count. foldmetrics, the tool those examples
come from, prints its own ipSAE and pDockQ for five of them; eleven of its twelve values match the
viewer's to three decimals, and the twelfth, Chai-1's pDockQ (0.513 here, 0.504 there), differs
because Chai-1 writes pLDDT per atom and the viewer — like ipsae.py for AlphaFold 3 — takes the Cβ
atom's.

**Not covered by real data.** DNA and protein–nucleic-acid interfaces (a published Boltz RNA model
was loaded, but it is a single chain), and real Chai-1 or AlphaFold 2.3 files against ipsae.py, which
reads neither. The nucleic-acid d0 minimum is tested on nothing real.

To rerun:

```
node validate-ipsae.mjs path/to/ipsae.py fold_a.zip fold_b.zip …        # IPSAE_JOBS=4 by default
IPSAE_CACHE=ref.json node validate-ipsae.mjs …                           # keep the slow reference half between runs
```

## Rerunning

```
cd tests && npm install && npm test            # once; installs Playwright and verifies the vendored libraries
mkdir run && unzip -d run fold_x.zip -x "templates/*" "msas/*paired*"   # keep the unpaired .a3m for the MSA check
python3 reference.py run K 6                    # chain K, 6 Å; needs biopython and numpy
python3 reference.py run K 6 K F                # optionally name the two chains for the contact map and BSA
node validate.mjs run                           # or: node validate.mjs run fold_x.zip
```

The validator prints the table above for your run, writes `run/validation.json`, and exits non-zero on
any disagreement.
