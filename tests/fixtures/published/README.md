# Published predictor outputs

Real output files published by others, committed so that the suite reads each tool's files as that
tool actually wrote them — not only as `../predictors/make_fixtures.py` reconstructs them. Nothing
here is modified.

| Folder | Source | Licence |
| --- | --- | --- |
| `foldmetrics/` | [ChiaChunL/foldmetrics](https://github.com/ChiaChunL/foldmetrics) `examples/data/`, commit 99157cb9bdcc | BSD-3-Clause, © 2026 Jiajun Li — see `foldmetrics/LICENSE` |
| `ipsae-aurka-tpx2/` | [DunbrackLab/IPSAE](https://github.com/DunbrackLab/IPSAE) `Example/`, commit 6174cf9e71cb | MIT, © 2025 Lab of Dr. Roland Dunbrack — see `ipsae-aurka-tpx2/LICENSE` |

Downloaded 2026-09-27.

- **foldmetrics** — barnase–barstar predicted by six tools: `colabfold/` (ColabFold 1.6, PDB +
  scores JSON), `af2_multimer/` (AlphaFold 2.3 run locally: `unrelaxed_model_*_pred_0.cif`,
  `pae_…json`, `confidence_…json`, `ranking_debug.json`), `af3_server/` (AlphaFold Server),
  `af3_mpro_ligand/` (AlphaFold 3 run locally, SARS-CoV-2 Mpro with the ligand nirmatrelvir),
  `boltz2/` (Boltz-2, chains named A and D by the job) and `chai1/` (Chai-1; `pae_model_idx_0.npz` is
  not a file Chai-1 writes — the example's author saved the PAE separately). Two
  files the example's author made rather than the tools (`iptm_ptm.json`, `ranking_model_idx_0.json`)
  were left out.
- **ipsae-aurka-tpx2** — the AlphaFold Server prediction of Aurora A with TPX2 that the ipSAE
  authors ship as their example: a phosphothreonine that AlphaFold 3 tokenises atom by atom, ATP and
  two Mg²⁺ ions. No summary file was published with it.

`expected-ipsae.json` is ipsae.py (the version recorded by its SHA-256) run on these files at PAE /
distance cutoffs 10/10 and 15/15; `make_expected.py <path to ipsae.py>` regenerates it.
