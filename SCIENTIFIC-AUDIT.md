# Scientific and publication-readiness audit

This audit evaluates the viewer as a tool for comparing predicted structures, sharing a self-contained
interactive review artefact, and preparing visual material for papers and theses. It is not a
validation of any biological hypothesis, and nothing in the tool should be read as one.

Audited against viewer version 2.2.0.

## What is already strong

- Local loading keeps unpublished coordinate files on the scientist's device. The only network traffic
  is the pinned rendering libraries at startup, and an explicit fetch when the user types a database
  identifier.
- PDB, CIF/mmCIF, and AlphaFold ZIP ingestion cover the most common prediction outputs, and direct
  fetch from RCSB and AlphaFold DB covers the most common reference structures.
- Full filenames, independent visibility toggles, one-at-a-time cycling, overlays, and editable colours
  make large model sets manageable.
- pLDDT colouring and per-model mean pLDDT help identify locally uncertain regions; PAE heatmaps,
  chain-pair ipTM, and minimum PAE carry the information pLDDT cannot.
- Click inspection and editable residue labels support annotated figures and reviewer walkthroughs.
  Clicks pick the nearest projected atom, so ribbons are as selectable as spheres.
- Atom-anchored figure annotations — arrows, lines, residue markers, text callouts, corner titles —
  follow rotation and re-alignment and are drawn into every export and the report, so a figure's
  argument does not drift out of register when the view changes.
- Synchronized multi-view places up to six models in linked viewports. Rotation-only sync keeps
  differently sized models framed; full sync is available for superposed models. A stitched, lettered
  comparison figure exports the panel set at publication size.
- Cα alignment makes conformational and prediction-to-prediction comparison possible without a desktop
  molecular-graphics package, and reports the chain mapping, aligned count, and identity it used
  rather than only an RMSD number.
- Portable HTML reports preserve the coordinates, names, colours, labels, guided views, confidence
  data, cycling controls, image export, and spin-video export.
- Scene manifests hash every structure file with SHA-256 and warn on restore when a file has changed
  since the scene was saved.

## Interpretation guardrails

- pLDDT reports local confidence. It is not evidence that the relative placement of chains or a
  protein–protein interface is biologically correct.
- For complexes, PAE and interface-specific confidence should accompany the 3D view. A high average
  pLDDT can coexist with entirely uncertain domain or chain placement.
- A visual overlay can suggest similarity but is not a statistical test. Alignment method, atom
  pairing, aligned residue count, RMSD, exclusions, and reference model should all be reported.
- The sequence-aware chain mapping is a greedy assignment over per-chain global alignments. For
  homo-oligomers with near-identical chains the assignment is essentially arbitrary among equivalent
  chains; inspect the reported mapping before quoting an RMSD.
- Predictions should be presented as predictions and kept distinct from experimentally determined
  structures.
- Original coordinate files and prediction metadata remain the source data; screenshots, contact
  sheets, and HTML reports are derived presentation artefacts.

## Implemented confidence and reproducibility milestone

- AlphaFold confidence JSON and ranking-score CSV import, plus direct PAE retrieval for AlphaFold DB
  fetches
- Interactive PAE heatmaps with chain boundaries and per-token inspection, and chain-pair interface
  summaries
- pTM, ipTM, ranking score, rank, clash, and confidence CSV reporting, including the source archive
  and the specific metadata files each number came from
- Sequence-aware structural alignment with chain mappings, aligned Cα counts, sequence identity,
  RMSD, and CSV export
- SHA-256-backed scene manifests retaining provenance, camera, labels, colours, model order, selections,
  measurements, saved views, and alignment state
- Confidence, PAE, provenance, labels, and media controls in portable reviewer reports

## Implemented publication and reviewer workflow

- Viewer-first tabbed interface that keeps the molecular scene visible while tools are grouped into
  Models, Appearance, Annotate, Compare, Confidence, and Publish
- Fixed-size, supersampled PNG export with transparent, white, dark, and custom backgrounds plus
  perspective or orthographic projection
- Named camera views and captions, downloadable multi-panel figure sheets, and caption text
- Chain/residue-range highlighting or hiding, atom distances, and three-atom angles
- Synchronized multi-view of up to six models with rotation-only or rotation-and-zoom camera sync,
  and a stitched lettered comparison figure of the panel set
- Figure annotations anchored to atoms (arrows, lines, residue markers, text callouts, corner titles),
  carried into PNG exports, comparison panels, scene manifests, and reports
- Guided saved views and captions in the downloadable live HTML report, which now offers one to six
  synchronized panels, per-panel model pickers, aligned coordinates, and stitched PNG or composite
  video export, with explicit control over whether the report carries the displayed models or all of
  them

## Supply-chain and integrity posture

Reviewers and institutional IT increasingly ask what a browser tool loads and from where. As of 2.2.0:

- All three runtime libraries (3Dmol.js, JSZip, numeric.js) are pinned by exact version *and*
  Subresource Integrity hash, so a substituted CDN file will refuse to execute.
- The icon set and tooltip layer are inline rather than fetched, removing two further third-party
  origins.
- A Content-Security-Policy restricts scripts to `cdnjs.cloudflare.com` and network requests to
  `files.rcsb.org` and `alphafold.ebi.ac.uk`, with `object-src`, `frame-src`, `base-uri`, and
  `form-action` all disabled.
- A library that fails to load is reported to the user rather than leaving a blank page.

## Remaining roadmap

### P1 — remaining publication refinements

1. **Vector overlays.** Export labels, legends, titles, and scale bars as SVG layered over a
   high-resolution molecular render. 2.2.0 draws annotations into the raster export; an editable
   vector layer remains open.
2. **Editable measurement labels.** Allow authors to override automatically generated distance and
   angle text.
3. **Batch style locking.** Explicitly lock molecular scale and orientation across exported panel sets
   when cameras were not saved from the same frame.

### P2 — deeper structural analysis

4. **Interface analysis.** Contact maps, inter-chain contact counts, buried-surface estimates,
   interface-residue tables, and exportable selections.
5. **Membrane context.** Adjustable membrane planes and hydrophobic slab guides — particularly useful
   for holins and other membrane proteins.
6. **Ensemble summaries.** Cluster models by structural similarity, show representative conformations,
   and graph pairwise RMSD alongside confidence metrics.
7. **Sequence viewer.** Linked sequence and structure selection, residue search, domain annotations,
   mutation markers, and chain-aware numbering.
8. **Validation warnings.** Flag missing residues/atoms, duplicate identifiers, implausible coordinate
   ranges, absent pLDDT, and incompatible models before alignment.

### P3 — engineering

9. **Wire the regression suite into CI.** [`tests/`](tests/) now drives the real viewer in headless
   Chromium and covers import, navigation, appearance, both alignment modes, annotation, confidence
   export, the full publish path, and the generated report — including explicit regressions for the
   two bugs that shipped in 2.0. It is not yet run automatically on push.
10. **Widen the fixtures.** The suite currently uses synthetic two-chain helices. Real monomers,
    multimers with alternate chain IDs, files with missing residues, non-AlphaFold B-factors, and a
    large AlphaFold archive would each catch a class of bug the synthetic fixtures cannot.
11. **Split the single file for development** while still shipping one artefact, if the file continues
    to grow. The single-file property is a feature for distribution, not for editing.

## Recommended next milestone

The most valuable next release remains **membrane-aware interface analysis**: membrane planes, contact
maps, interface-residue tables, contact counts, and ensemble clustering. Those additions would be
especially useful for evaluating holin oligomer models — without implying that a prediction proves
pore formation.

Wiring the suite into CI (P3.9) should land first or alongside, because interface analysis will touch
the alignment and selection code, and a suite nobody runs automatically protects nothing.

## Technical notes

- Keep mmCIF as a first-class format because it preserves richer structural metadata and avoids legacy
  PDB format limits.
- Third-party library versions are pinned and integrity-checked, and the viewer version is recorded in
  both reports and scene manifests.
- Keep calculations transparent and downloadable; never present an interface or confidence threshold
  as proof of interaction.
- Large-archive handling makes deliberate trade-offs (lazy parsing, model release above 40 loaded
  models, skipping `full_data` PAE payloads above 25 models per archive, paged model list). These are
  documented in the [usage guide](docs/USAGE.md) so results are not silently incomplete.
