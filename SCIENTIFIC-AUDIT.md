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

## Priority roadmap

### P0 — confidence and reproducibility

1. **PAE and ranking-data import.** Parse AlphaFold JSON files from result ZIPs; show an interactive PAE heatmap and model-level pTM/ipTM/ranking scores when present.
2. **Alignment report.** Add sequence-aware residue mapping, aligned residue count, Cα RMSD, optional chain selection, and downloadable CSV/JSON results. Remove or explicitly confirm order-based fallback for dissimilar proteins.
3. **Saved scene state.** Export/import a small JSON manifest containing file hashes, selected models, visibility, colors, camera orientation, labels, representation, alignment settings, and software version.
4. **Provenance panel.** Let authors enter a figure title, model source, run/date, sequence or construct name, prediction method/version, notes, and citation; embed this metadata in HTML reports.

### P1 — reviewer and publication workflow

5. **Publication export presets.** White/transparent/dark backgrounds, fixed canvas sizes, supersampled PNG at 2×–4×, and scale/orientation consistency across a batch.
6. **Figure panels.** Save named views (for example overview, interface, pore, and confidence), arrange them into labelled panels, and export a contact sheet plus caption text.
7. **Selections and measurements.** Select by chain/residue range, show/hide selections, highlight interfaces, and add distance/angle measurements with editable labels.
8. **Side-by-side synchronized views.** Compare two or more models with linked rotation/zoom, avoiding ambiguity caused by translucent overlays.
9. **Reviewer mode.** Read-only presentation mode with author-defined model order, captions, guided views, keyboard controls, and a table summarizing confidence and provenance.
10. **Vector overlays.** Export labels, legends, titles, and scale bars as SVG layered over a high-resolution molecular render.

### P2 — deeper structural analysis

11. **Interface analysis.** Contact maps, inter-chain contact counts, buried-surface estimates, interface-residue tables, and exportable selections.
12. **Membrane context.** Adjustable membrane planes and hydrophobic slab guides—particularly useful for holins and other membrane proteins.
13. **Ensemble summaries.** Cluster models by structural similarity, show representative conformations, and graph pairwise RMSD alongside confidence metrics.
14. **Sequence viewer.** Linked sequence and structure selection, residue search, domain annotations, mutation markers, and chain-aware numbering.
15. **Validation warnings.** Flag missing residues/atoms, duplicate identifiers, implausible coordinate ranges, absent pLDDT, and incompatible models before alignment.

## Recommended next milestone

The most scientifically valuable next release is **confidence + reproducibility**: PAE JSON import, model ranking metrics, sequence-aware alignment with RMSD, and a saved scene/provenance manifest. Those additions would make the viewer much safer for comparing AlphaFold complexes and much easier to cite or reproduce during peer review.

## Technical notes

- Keep mmCIF as a first-class format because it preserves richer structural metadata and avoids legacy PDB format limits.
- Pin third-party library versions and expose the viewer version in reports.
- Keep calculations transparent and downloadable; never present an interface or confidence threshold as proof of interaction.
- Add automated tests with monomers, multimers, alternate chain IDs, missing residues, non-AlphaFold B-factors, and large AlphaFold ZIPs.
