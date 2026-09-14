# AlphaFold DB fixture — P69905 (human haemoglobin subunit alpha)

Real files downloaded from the AlphaFold Protein Structure Database, used as a
committed regression fixture for `tests/run.mjs` (group "AlphaFold DB entry").

- **Entry**: AF-P69905-F1 (UniProt P69905, HBA_HUMAN, human haemoglobin subunit alpha)
- **Files**:
  - `AF-P69905-F1-model_v6.cif` — predicted structure, mmCIF, model version 6
  - `AF-P69905-F1-predicted_aligned_error_v6.json` — predicted aligned error (PAE) matrix
- **Source**: the AlphaFold Protein Structure Database (EMBL-EBI / DeepMind).
  Fetched via the AlphaFold DB API (`https://alphafold.ebi.ac.uk/api/prediction/P69905`),
  which reported `cifUrl` / `paeDocUrl` pointing at:
  - https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif
  - https://alphafold.ebi.ac.uk/files/AF-P69905-F1-predicted_aligned_error_v6.json

  (The `v4` file names given in the AlphaFold DB documentation/older links have since
  been superseded — the database is now on model version 6 for this entry — so the
  API lookup was used to find the current URLs, as AlphaFold DB recommends.)
- **Licence**: CC-BY-4.0 (AlphaFold DB data, EMBL-EBI/DeepMind).
- **Downloaded**: 2026-09-14.
- **Citation**:
  - Jumper, J. et al. "Highly accurate protein structure prediction with AlphaFold." *Nature* 596, 583–589 (2021).
  - Varadi, M. et al. "AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences." *Nucleic Acids Research* 52, D368–D375 (2024).

## Note on residue count

The canonical UniProt sequence for P69905 is **142 residues** (it retains the
initiator methionine); AlphaFold DB predicts and reports a full-length model of
142 residues. The commonly cited "141 residues" refers to the mature,
post-translationally processed chain (initiator Met removed), which is a
UniProt *feature* annotation, not the modelled sequence length. The regression
group in `tests/run.mjs` checks for **142** residues/scores accordingly.

## Note on PAE attachment

Loading both files together through the viewer's file picker (`#gpv-files`)
does **not** automatically attach the PAE matrix to the model: the viewer's
local file-name matching (`associationKey`/`assetFitsEntry` in `index.html`)
is written for AlphaFold 2/3 batch output names (`ranked_0.pdb` +
`summary_confidences_0.json`, etc.) and does not recognise AlphaFold DB's own
naming convention (`..._model_vN` / `..._predicted_aligned_error_vN`). The
viewer's own "Fetch" feature (`resolveAlphafold`/`fetchIdentifier` in
`index.html`) attaches PAE for an AlphaFold DB accession directly instead,
without relying on that heuristic. The regression group exercises both paths:
it loads the two files from disk to check the base model (atom count, one
pLDDT score per residue), then drives the "Fetch" workflow — routed to these
same committed files instead of the network — to exercise the PAE-dependent
checks (PAE domains, confidence summary, colour-by-pLDDT) against the real
142×142 PAE matrix.
