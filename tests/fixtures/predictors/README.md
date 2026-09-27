# Predictor-output fixtures

One small two-chain complex, written out the way four structure predictors write their results, so
the viewer's readers can be tested against each format without committing anyone's real prediction.
`make_fixtures.py` regenerates every file here; run it with `python make_fixtures.py <path to ipsae.py>`
(needs numpy, biopython and python-modelcif).

| Folder / file | Tool | Layout |
| --- | --- | --- |
| `colabfold/` | ColabFold 1.5+ | `hbdimer_unrelaxed_rank_00N_alphafold2_multimer_v3_model_M_seed_000.pdb` + `hbdimer_scores_rank_00N_…json` (plddt, pae, max_pae, ptm, iptm, and ColabFold's own ipsae / pdockq / pdockq2), `config.json` |
| `boltz/`, `boltz_results_hbdimer.zip` | Boltz-2 | `hbdimer_model_N.cif` (ModelCIF, pLDDT × 100 in B_iso) + `confidence_hbdimer_model_N.json` + `pae_`, `plddt_`, `pde_hbdimer_model_N.npz` (`np.savez_compressed`); a six-atom ligand as chain C, so the PAE has 134 rows for 128 residues |
| `chai/`, `chai_hbdimer.zip` | Chai-1 | `pred.model_idx_N.cif` (ModelCIF, per-atom pLDDT × 100) + `scores.model_idx_N.npz` (`np.savez`, leading batch dimension of 1); sample 1 has the higher aggregate score |
| `af3/` | AlphaFold 3 (server names) | `fold_hbdimer_model_0.cif` + `fold_hbdimer_full_data_0.json` (per-atom pLDDT, Cβ 3 lower than Cα) + `fold_hbdimer_summary_confidences_0.json` |
| `expected-ipsae.json` | — | Interface scores computed by the reference implementation on these files |

## What is real and what is not

- **Coordinates**: residues 1–64 of the AlphaFold DB model of human haemoglobin α
  (`../alphafold-db/AF-P69905-F1-model_v6.cif`, CC-BY-4.0), and a second copy placed by a two-fold
  rotation so the two chains pack against each other (closest heavy atoms 3.2 Å, 17 Cβ pairs within
  8 Å). The dimer is a construction, not a known assembly.
- **pLDDT**: that model's own per-residue pLDDT, for both chains.
- **PAE**: synthetic. The intra-chain blocks are the real AlphaFold DB PAE of residues 1–64; the
  inter-chain block grows with the Cβ–Cβ distance, so the interface has low PAE and the far side high,
  with the A→B direction 0.4 Å worse than B→A so the two directions differ.
- **Summary scores** (pTM, ipTM, ranking score, clash flags): made-up values of a plausible size.

These files test that each format is read correctly. They are not predictions of anything.

## Where each layout comes from

Read from each tool's own writer:

- **ColabFold** — `colabfold/batch.py` (`file_manager`, the scores dict, the `rank_NNN_` renaming) and
  `colabfold/alphafold/ipsae.py` (the interface keys, computed here with the same formula).
- **Boltz** — `boltz/data/write/writer.py` (file names, confidence keys, `np.savez_compressed`),
  `boltz/data/write/mmcif.py` (python-modelcif, polymer chains as ATOM, ligands as HETATM, pLDDT × 100),
  `boltz/data/tokenize/boltz2.py` (one token per polymer residue, one per ligand atom).
- **Chai-1** — `chai_lab/chai1.py` (`pred.model_idx_N.cif`, `np.savez` of `get_scores`) and
  `chai_lab/data/io/cif_utils.py` (python-modelcif, per-atom pLDDT × 100). The PAE is returned in
  memory by `run_inference` and not written.
- **AlphaFold 3** — the AlphaFold Server's `fold_<job>_*` names; `_atom_site` columns in the order the
  server writes them.

## Reference scores

`expected-ipsae.json` is the output of DunbrackLab/IPSAE `ipsae.py` (Dunbrack, 2025, bioRxiv
10.1101/2025.02.10.637595; MIT licence) run on the ColabFold rank-1, Boltz model-0 and AlphaFold 3
model-0 files at PAE/distance cutoffs 10/10 and 15/15, with the script's SHA-256 recorded. The script
itself is not committed; `make_fixtures.py` takes its path.
