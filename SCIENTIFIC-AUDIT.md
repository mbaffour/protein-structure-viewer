# Scientific and publication-readiness audit

This audit evaluates the viewer as a tool for comparing predicted structures, sharing a self-contained
interactive review artefact, and preparing visual material for papers and theses. It is not a
validation of any biological hypothesis, and nothing in the tool should be read as one.

Audited against viewer version 2.13.0.

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
  The sequence strip makes a residue reachable by number rather than by hunting in three dimensions,
  and undo makes annotation cheap to get wrong.
- Chain colours are assigned deterministically in sorted chain order and named in the legend, so a
  figure, its comparison panels, and the report agree on what colour a chain is.
- Share links carry only identifiers the recipient can fetch themselves; coordinates from local files
  never enter a URL.
- Deviation colouring shows where aligned predictions disagree residue by residue, which is the
  question a reviewer asks after seeing a single RMSD; unmatched residues are shown as such rather
  than coloured as agreement. Hiding low-pLDDT residues is a display choice that the sequence strip
  and the scene manifest both record, so a figure without disordered tails is still reproducible.
- The pLDDT profile is drawn from the same per-residue values the viewer colours by, with the
  standard band boundaries, so a profile figure and a coloured structure agree by construction.
- The generated figure legend states what the figure actually encodes — colour bands, cut-offs,
  alignment method and RMSD, ligand handling — which is the information reviewers most often find
  missing from structure figures. It is explicitly a draft.
- Hetero groups are visible by default; a figure that silently drops a bound ligand or ion misleads.
- Assemblies are described as assemblies: stoichiometry by identical sequence, exact Cα extent and
  radius of gyration, and a colour scheme that shows the distinct proteins of a capsid rather than its
  chains.
- The reported numbers are cross-validated: mean pLDDT, Kabsch RMSD, Cα RMSF, radius of gyration,
  extent and residue contacts agree with Biopython/numpy to 5 × 10⁻⁵ Å on three real AlphaFold 3 runs
  (`VALIDATION.md`), and the check can be rerun on any run. A generated methods paragraph states the
  definitions in the past tense so a paper describes what was actually computed.
- The models of one run can be asked where they disagree (per-residue Cα RMSF across the aligned
  ensemble), which is a more honest picture of local uncertainty than any one model's pLDDT, and
  ligand poses carry their site pLDDT and ligand–site PAE next to them.
- Experimental per-residue measurements can be shown on the model with a legend that states the
  scale and range, which is how a prediction is confronted with data rather than admired.
- Exports now state their physical size and resolution in the file and size text in points, so a
  figure meets journal requirements by construction rather than by resampling afterwards; a
  colour-blind-safe palette and a scale bar are one click each. The generated legend credits the
  renderer and records the print settings.
- The software is citable: `CITATION.cff` and `.zenodo.json` describe it, and releases are archived
  with DOIs, so a thesis or paper can reference the exact version used.
- PAE-derived domains are labelled as what they are: groups the model places together, found by a
  simple greedy merge with a stated cutoff, not a structural domain definition and not evidence of
  correct placement. The cutoff and the merging rule are stated in the interface and in the generated
  figure legend so that a reader can judge the grouping.
- The composition table makes the model's actual content — chains, lengths, ligands and ions —
  explicit before any figure is made, and hiding a chain is recorded in the scene manifest rather
  than happening silently.
- Residue-property colouring (charge, hydrophobicity, type) is a look-up on residue identity, and the
  surface option paints that property onto a molecular surface. It is not an electrostatic potential;
  the usage guide and the generated legend say so, so it is not mistaken for a Poisson–Boltzmann map.
  Clicks pick the nearest projected atom, so ribbons are as selectable as spheres.
- Atom-anchored figure annotations — arrows, lines, residue markers, text callouts, corner titles —
  follow rotation and re-alignment and are drawn into every export and the report, so a figure's
  argument does not drift out of register when the view changes.
- Synchronized multi-view places up to six models in linked viewports. Rotation-only sync keeps
  differently sized models framed; full sync is available for superposed models. A stitched, lettered
  comparison figure exports the panel set at publication size, with the pLDDT legend and title.
- Figures export as SVG with the molecule rasterised and every overlay — labels, arrows, callouts,
  captions, legend — as editable vector elements, so typography and colour can be finished in a figure
  editor without re-rendering.
- Interface geometry — inter-chain heavy-atom contacts, interface residues, Shrake–Rupley buried
  surface area — is computed from the model as loaded, reported per chain pair with the cutoff used,
  exportable with residue lists, and framed in the interface as packing of a prediction rather than
  evidence of an interaction.
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

## Implemented validation milestone

- Independent reference implementation (`tests/reference.py`, Biopython + numpy) and a validator that
  drives the real viewer on the same files (`tests/validate.mjs`); results recorded in `VALIDATION.md`
- Exact maximum Cα–Cα distance up to 6 000 residues, replacing a two-pass estimate that under-read
  real assemblies by up to 5 %; the estimate remains above that size and is labelled as a lower bound
- Byte-level parsing of AlphaFold 3 `full_data` files (PAE kept as Float32 rows, contact matrix
  skipped): a 4 410-token, five-model assembly holds 0.16 GB of JavaScript heap after import instead of
  2.2 GB, with unchanged RMSD, domain and PAE values
- Methods-text generator covering superposition, RMSD, RMSF, domains, contacts, ligand sites,
  dimensions, colour scales, hidden residues and export settings

## Supply-chain and integrity posture

Reviewers and institutional IT increasingly ask what a browser tool loads and from where. As of 2.3.0:

- All three runtime libraries (3Dmol.js, JSZip, numeric.js) are pinned by exact version *and*
  Subresource Integrity hash, so a substituted CDN file will refuse to execute.
- The icon set and tooltip layer are inline rather than fetched, removing two further third-party
  origins.
- A Content-Security-Policy restricts scripts to `cdnjs.cloudflare.com` and network requests to
  `files.rcsb.org` and `alphafold.ebi.ac.uk`, with `object-src`, `frame-src`, `base-uri`, and
  `form-action` all disabled.
- A library that fails to load is reported to the user rather than leaving a blank page.
- Offline reports embed 3Dmol.js only after fetching it from the same pinned URL and re-verifying the
  bytes against the page's SRI hash; a mismatch falls back to the CDN tag and says so.

## Remaining roadmap

### P1 — remaining publication refinements

1. **Vector overlays.** Done in 2.3.0 for labels, measurements, annotations, captions, and the pLDDT
   legend. A scale bar is not offered: perspective projection makes a single bar misleading, and in
   orthographic projection the honest equivalent is a measured distance, which the tool already draws.
2. **Editable measurement labels.** Allow authors to override automatically generated distance and
   angle text.
3. **Batch style locking.** Explicitly lock molecular scale and orientation across exported panel sets
   when cameras were not saved from the same frame.

### P2 — deeper structural analysis

4. **Interface analysis.** Contact counts, interface-residue tables, buried-surface estimates, and
   highlightable/exportable interface selections landed in 2.3.0. Still open: per-residue contact maps,
   and comparing interface tables across models of the same complex.
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

With contact counts, interface residues, and buried surface in place, the most valuable next release is
**membrane context and ensemble summaries**: membrane planes and hydrophobic slab guides for holins and
other membrane proteins, per-residue contact maps, and clustering of models by structural similarity so
an interface table can be compared across an ensemble — without implying that a prediction proves pore
formation.

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
