# Scientific and Publication-Readiness Audit

This audit evaluates the viewer as a tool for comparing predicted structures, sharing a self-contained interactive review artifact, and preparing visual material for papers and theses. It is not a validation of any biological hypothesis.

## What is already strong

- Local loading keeps unpublished coordinate files on the scientist's device.
- PDB, CIF/mmCIF, and AlphaFold ZIP ingestion cover the most common prediction outputs.
- Full filenames, independent visibility toggles, one-at-a-time cycling, overlays, and editable colors make large model sets manageable.
- pLDDT coloring and per-model mean pLDDT help identify locally uncertain regions.
- Click inspection and editable residue labels support annotated figures and reviewer walkthroughs.
- Cα alignment makes conformational or prediction-to-prediction comparison possible without a desktop molecular-graphics package.
- Portable HTML reports preserve the coordinates, names, colors, labels, cycling controls, image export, and spin-video export.

## Interpretation guardrails

- pLDDT reports local confidence. It is not evidence that the relative placement of chains or a protein-protein interface is biologically correct.
- For complexes, PAE and interface-specific confidence should accompany the 3D view. A high average pLDDT can coexist with uncertain domain or chain placement.
- A visual overlay can suggest similarity but is not a statistical test. Alignment method, atom pairing, aligned residue count, RMSD, exclusions, and reference model should be reported.
- Predictions should be presented as predictions and kept distinct from experimentally determined structures.
- Original coordinate files and prediction metadata remain the source data; screenshots and HTML reports are derived presentation artifacts.

## Implemented confidence and reproducibility milestone

- AlphaFold confidence JSON and ranking-score CSV import
- Interactive PAE heatmaps and chain-pair interface summaries
- pTM, ipTM, ranking score, rank, clash, and confidence CSV reporting
- Sequence-aware structural alignment with chain mappings, aligned Cα counts, sequence identity, RMSD, and CSV export
- SHA-256-backed scene manifests that retain provenance, camera, labels, colors, model order, and alignment state
- Confidence, PAE, provenance, labels, and media controls in portable reviewer reports

## Remaining roadmap

### P1 — reviewer and publication workflow

1. **Publication export presets.** White/transparent/dark backgrounds, fixed canvas sizes, supersampled PNG at 2×–4×, and scale/orientation consistency across a batch.
2. **Figure panels.** Save named views (for example overview, interface, pore, and confidence), arrange them into labelled panels, and export a contact sheet plus caption text.
3. **Selections and measurements.** Select by chain/residue range, show/hide selections, highlight interfaces, and add distance/angle measurements with editable labels.
4. **Side-by-side synchronized views.** Compare two or more models with linked rotation/zoom, avoiding ambiguity caused by translucent overlays.
5. **Reviewer mode.** Read-only presentation mode with author-defined model order, captions, guided views, keyboard controls, and a table summarizing confidence and provenance.
6. **Vector overlays.** Export labels, legends, titles, and scale bars as SVG layered over a high-resolution molecular render.

### P2 — deeper structural analysis

7. **Interface analysis.** Contact maps, inter-chain contact counts, buried-surface estimates, interface-residue tables, and exportable selections.
8. **Membrane context.** Adjustable membrane planes and hydrophobic slab guides—particularly useful for holins and other membrane proteins.
9. **Ensemble summaries.** Cluster models by structural similarity, show representative conformations, and graph pairwise RMSD alongside confidence metrics.
10. **Sequence viewer.** Linked sequence and structure selection, residue search, domain annotations, mutation markers, and chain-aware numbering.
11. **Validation warnings.** Flag missing residues/atoms, duplicate identifiers, implausible coordinate ranges, absent pLDDT, and incompatible models before alignment.

## Recommended next milestone

The most valuable next release is **publication figure preparation**: fixed-size high-resolution exports, reusable named views, selection and measurement tools, synchronized side-by-side comparison, and a guided reviewer mode.

## Technical notes

- Keep mmCIF as a first-class format because it preserves richer structural metadata and avoids legacy PDB format limits.
- Pin third-party library versions and expose the viewer version in reports.
- Keep calculations transparent and downloadable; never present an interface or confidence threshold as proof of interaction.
- Add automated tests with monomers, multimers, alternate chain IDs, missing residues, non-AlphaFold B-factors, and large AlphaFold ZIPs.
