# Changelog

All notable changes to this project are recorded here.

## 2.31.1

- **Fixed: the Model legend showed full colours for faded models.** With one model emphasised, the others are drawn as
  pale tints but their legend swatches kept the full colour. The swatch is now the tint that is on the page, and the
  on-screen entry says "faded".

## 2.31.0

- **Emphasise one model in a superposition.** Each row of the Models list gained a fade switch and an **Emphasise**
  button: the model you emphasise is drawn solid while every other shown model fades towards the paper and is drawn as
  a thin ribbon, which is what an overlay of five predictions needs to be readable. Pressing Emphasise on a model that
  is already alone puts them all back. Faded models dim in the sequence strip too, and the state travels with scenes,
  sessions, share links and the shared report.

## 2.30.0

- **Match identical chains by position.** In an assembly of identical subunits every chain pairs equally well by
  sequence, so the pairing is arbitrary: a model that places the same subunit somewhere else is compared against the
  wrong copy and its RMSD means nothing. The new switch in Compare does a first fit, re-pairs chains of identical
  sequence by the distance between their centroids — nearest first, each chain used once — and fits again, keeping the
  result only when it brings the models closer. The chain mapping it chose is printed with every result and in the CSV.
  It is off by default, so existing numbers and the cross-validation are unchanged, and the matching is greedy rather
  than optimal, which is why the mapping is always shown.

## 2.29.1

- **The Model legend names the models again.** Overlaying the five models of one AlphaFold run gave a legend of five
  identical truncations, because every file starts with the same long stem. What all the names share is now dropped at
  a word boundary — `fold_m13_virion_round_tip_model_0.cif` and its siblings read as `model_0` … `model_4` — while
  names that would become too short, or that would collide, are clipped in full as before. The long name stays in the
  on-screen legend's tooltip text, and *Edit labels* still overrides everything.

## 2.29.0

- **Superpose on part of the structure.** *Compare → Fit on* takes **All matched residues** (as before), **a chain or
  residue range** (`A`, `A:20-140`, `20-140`), or **the selected residues**. The rotation is computed from that region
  alone, and the results table, the CSV and the methods text now carry the RMSD over the fitted region beside the RMSD
  over every matched Cα — the pair of numbers that shows a hinge or a shifted domain ("0.4 Å over the core, 6.8 Å
  overall"). Colouring by Cα deviation then paints exactly what moved. If too few residues of the region match, the fit
  falls back to all pairs and says so in the table. The choice is a scene setting and a saved preference, and fitting on
  all residues is byte-for-byte what earlier versions did, so the cross-validated numbers are unchanged.

## 2.28.1

- **Fixed: boxed labels printed dark boxes on a white figure.** A boxed label took its background from the
  interface's card colour, so with the dark interface and a white figure background every label came out as a black
  box — while the SVG export drew the same labels on white. The box now takes the figure's background colour whenever
  one is chosen, and the interface's only when the background is transparent, so the view, the PNG and the SVG agree.

## 2.28.0

- **Labels can be dragged.** Pick up any label in the 3D view with the mouse — a residue label, a callout, a
  measurement value, a corner title — and put it where the figure needs it. A residue label keeps a thin leader line
  back to its residue once it has moved, in the label's colour, drawn on screen, in every PNG and SVG export, in the
  composite and built figures and in the shared report. The move is stored as a model-space offset, so it holds its
  place against the structure as the camera turns, travels with scenes, sessions and share links, and is undone with
  ⌘Z; *Reset* in the label's row puts it back on its residue. The pointer shows a grab cursor and the readout says
  which label it would move, and the drag never moves the camera. Touch is untouched: a finger drag still rotates.
- **Legend position.** *Publish → Legend position* puts the colour legend in any corner of the figure, or stacks it as
  a column down the left or right side. It applies to every PNG, TIFF and SVG export, to each panel of a built figure,
  and travels with the scene; the scale bar is lifted clear wherever the two would meet.

## 2.27.1

- **Architecture bar: one name per domain, no piled-up numbers.** A domain that the PAE segmentation splits into several
  runs is named once, on its widest run (the other runs keep the colour); boundary residue numbers that would overlap a
  number already placed are dropped, the chain ends always stay. Seen on PARP1, where residues 531–691 alternate between
  two PAE domains.

## 2.27.0

- **Label domains.** *Annotate → Domains → Label domains* (and *Label domains* beside the PAE domains in Confidence)
  writes each domain's name on the structure: one residue label at the Cα nearest the domain's centroid, in the domain
  colour, using the legend's names (so a domain renamed under Figure labels is labelled with that name). They are
  ordinary labels — editable in the label list, exported in PNG and SVG, carried by scenes and the report, undone with
  ⌘Z — and *Clear domain labels* removes only them. Which definition is used follows the colour scheme: PAE domains
  when colouring by them, otherwise annotated domains, otherwise PAE domains if found.
- **Domain architecture bar.** *Download architecture PNG/SVG* draws the linear domain diagram: one row per chain, the
  sequence as a line from its first to its last residue, a coloured box per contiguous domain run with the name inside
  (or above when it does not fit), residue numbers at the chain ends and at every domain boundary, at the output width
  and resolution. The same bar is a panel of the composite figure and, with *Domain architecture row under the panels*
  ticked, spans the bottom of a figure-builder figure so the structure panels and the architecture read as one figure.

## 2.26.1

- **Legend and scale bar no longer collide on narrow exports.** The legend is shrunk (never below 55 %) when it would
  not fit the export's width, and the scale bar is lifted above it when the two would still overlap — on every PNG and
  SVG export, single or multi-panel. Builder captions wrap onto a second line instead of being cut, and the caption strip
  is as tall as the longest caption in the figure needs.
- **Fixed: the figure builder's include switches were invisible.** The theme only draws a checkbox inside a
  `.form-check` label; the builder rendered bare inputs, which worked but could not be seen. They are wrapped now.

## 2.26.0

- **Figure builder.** Saved views are now the panels of a figure. Under *Publish → Figure builder* each saved view has
  an include switch, a panel letter, an editable caption and move up/down buttons; choose the columns (auto, 1–4), the
  caption style and whether each panel carries its legend and scale bar, and download the figure as PNG (dpi written
  into the file) or SVG (vector captions, labels, legends and scale bars). Every panel is rendered from its own camera,
  colour scheme and model selection at the same text size, and the cells are sized so the whole figure is the width
  chosen under *Output* — a 178 mm figure is 178 mm with two panels or six. The builder options are part of the scene,
  and which views are included travels with the saved views. It replaces the fixed-size contact sheet.
- **Fixed: the all-views ZIP drew the wrong legend.** Each view's legend and scale bar were drawn after the on-screen
  state had been restored, so every file carried the legend of the view on screen rather than its own. The view is now
  applied first.
- **Exports no longer eat WebGL contexts.** Every export job used to lose and recreate the off-screen render
  context, and applying a saved view for an off-screen render recreated the synchronized panel viewers; a session
  with many exports then hit the browser's context limit (WebKit drops the oldest live context at sixteen, and a lost
  context still counts until it is collected), which could kill the main view. One export context now lives for the
  whole session, emptied and shrunk between jobs, and off-screen renders apply everything but the panels.

## 2.25.0

- **Editable figure labels.** *Edit labels* on the colour legend (or *Publish → Edit figure labels*) opens a table of
  the current legend's title and entries with a text field beside each: rename "D1" to "N-lobe", an entity's Greek
  letter to the protein's name, a chain letter to its subunit. The names apply on screen, on every PNG, TIFF and SVG
  export, in the composite and comparison figures and in the generated figure legend text ("legend: Lobes — N-lobe,
  D2"); renamed entries keep their residue ranges, and the data are untouched. Labels belong to the colour scheme and
  are part of the scene, so scenes, sessions and share links carry them; *Reset labels* clears them for that scheme.
  The SVG export already wrote the legend as text, so it stays editable in Illustrator or Inkscape as well.

## 2.24.1

- **Fixed: the Confidence tab collapsed inside the side panel.** In the workspace layout the tab kept its
  two-column arrangement (controls beside the PAE map), so with a large PAE matrix the map took the whole
  420 px panel and the MSA controls, the confidence exports and the *Henikoff weights* switch were squeezed to
  zero width underneath it. The panel now stacks the controls above the map, the map never exceeds the panel
  width, and a regression step checks the controls keep their width and do not overlap the map.
- **Suite hardening for headed engines.** After the generated-report group the suite brings the viewer tab back
  to the front (in headed Firefox under Xvfb the report tab stayed in front and every later click timed out);
  a download promise left behind by a timed-out click is logged against its step instead of aborting Node;
  the report-strip hover step reports what sat under the pointer when it fails.

## 2.24.0

- **Henikoff-weighted MSA conservation.** *Colour by MSA → Conservation* now applies the position-based
  sequence weights of Henikoff & Henikoff (1994) before the column entropy, so a cluster of near-identical
  homologues no longer counts as many independent observations. A *Henikoff weights* switch (on by default)
  gives the plain column entropy instead; the dataset name, the legend, the CSV, the report and the methods
  text all say which was used. Both versions are cross-validated against an independent Python implementation
  on the three AlphaFold 3 runs (weighted and unweighted differ by up to 0.32 at some columns of the phiX174
  alignments, so the choice is not cosmetic).
- **Heuristics say so in the interface.** PAE domains are labelled a heuristic segmentation in the panel state,
  the hint and the figure legend ("PAE domains (heuristic)"); the ligand-site state says its PAE column is a
  summary mean that has not been validated against a reference.
- **Suite retries a step once after a Playwright timeout** (never after an assertion failure) and logs the retry
  loudly, so a slow CI runner does not fail a green build while a real regression still does.
- **CI fixes.** Firefox runs headed under Xvfb on the Linux runner because headless Firefox cannot create a
  WebGL context there; the report-strip hover test polls for the readout instead of assuming the strip is
  drawn within 300 ms.

## 2.23.0

Built to be maintained.

### Added

- **Continuous integration.** `.github/workflows/tests.yml` runs the regression suite in Chromium,
  Firefox and WebKit on every push and pull request, checks that `index.html` is built from `src/`
  without drift, and compiles the validation scripts.
- **A source tree.** `index.html` is now generated from `src/` (one file per section of the
  application) by `node scripts/build.mjs`, byte for byte; the shipped artefact is still one HTML
  file. Edits belong in `src/`.
- **A real fixture.** The suite loads a committed AlphaFold Database entry (human haemoglobin α,
  P69905, CC-BY-4.0) from disk and through the fetch path, and checks its PAE, domains, extent and
  colouring.
- **Buried surface area is cross-validated** against Biopython's Shrake–Rupley on the three real
  runs (18 new comparisons; 123 in total). Ligand-site PAE remains unvalidated for want of a
  ligand-bearing run; VALIDATION.md states the reference to compute.

### Fixed

- Files downloaded from AlphaFold DB (`AF-…-model_v6.cif` with `…-predicted_aligned_error_v6.json`)
  now pair up when dropped in; before, only fetching by accession attached the PAE.

## 2.22.1

### Changed

- **The tool panel sits on the left** of the 3D view in the workspace layout, the way most
  molecular viewers place their menus; the arrows button in the header swaps the two sides, and
  the choice is remembered. The divider drags in the natural direction on either side.

## 2.22.0

The report shows what you saw.

### Added

- **Report parity.** The shared HTML report now carries the silhouette outline and depth cueing,
  draws faded chains the same way, and shows the interface contact map beside the PAE heatmap
  when one was computed for a model in the report, with the same rows-against-columns layout,
  closer pairs darker, and the pair count and cutoff spelled out. Switching the report's
  background recolours the outline and the fade to match.

## 2.21.1

### Added

- **Download data CSV** (Annotate → Per-residue data): the loaded dataset — a pasted table, a CSV,
  or the MSA statistics — as `chain,resi,resn,value` with the dataset name in the header, so the
  conservation or coverage behind a figure can be tabulated in the supplement.

## 2.21.0

What the alignment knew.

### Added

- **Colour by MSA** (Confidence tab). AlphaFold 3 archives carry the unpaired multiple sequence
  alignment per entity as `.a3m`; the viewer now reads it and colours every chain whose sequence
  matches the query by **conservation** (1 − H/log₂20, H the Shannon entropy of the column),
  **identity to the query**, or **coverage** (sequences per column). The result is a per-residue
  dataset, so the viridis legend, the sequence strip, exports, the report and the methods text all
  follow, and the CSV of values downloads from the Annotate tab. An `.a3m` can also be added on
  its own for models from any source.

### Validated

- The three statistics are compared column by column with an independent Python implementation on
  the seven alignments of the three real runs (21 new comparisons; 105 in total). See VALIDATION.md.

## 2.20.0

The whole figure, not just the picture.

### Added

- **Composite figure** (Publish tab). One lettered figure at the chosen print size: the 3D view
  first, then the panels a paper puts beside it — the PAE heatmap, the per-residue pLDDT profile
  and the interface contact map — each rendered fresh at output resolution, with captions under
  every panel and the resolution written into the PNG. Tick the panels you want; panels that are
  not available for the current model (no PAE, no scores, no computed contacts) are greyed out.
  One to three columns.

## 2.19.0

A reviewer's eye before you export.

### Added

- **Publication checklist** (Publish tab). Reads the current settings and lists what a journal
  or a reviewer would flag: no physical size on a pixel export, resolution below 300 dpi, text
  under 7 pt, chain or domain colours that are not colour-blind safe, a legend switched off, a
  scale bar in perspective projection, several models shown without superposition, a hidden
  pLDDT cut, a non-white background, many chains without an outline, no figure title. Warnings
  carry one-click fixes; the badge reads *ready* when none remain. The list refreshes as you
  change settings.

## 2.18.1

### Validated

- The interface contact map is now part of the Biopython cross-validation: on the three real
  runs, the residue-pair sets, the interface residue counts and every closest-atom distance
  agree with NeighborSearch to within 5 × 10⁻⁵ Å (12 new comparisons; 84 in total). See
  VALIDATION.md.

## 2.18.0

The interface, as a map.

### Added

- **Interface contact map** (Compare tab). Pick two chains of the current model, a cutoff and
  whether any heavy atom or only Cα counts; the map shows every residue pair within the cutoff,
  closer pairs darker, with the first chain down the side and the second along the top. Hover
  reads the pair and distance; a click selects both residues and zooms to them. *Highlight
  interface* colours every interface residue of both chains in the 3D view. Download the map as
  a 300 dpi PNG with axes, title and distance scale, or the pairs as CSV with the closest-atom
  distance. The methods text states the rule and the counts. Same distance definition as the
  proximity tool, which is cross-validated in VALIDATION.md.
- **Label style** (Annotate). *Boxed* or *plain text* for every residue label, measurement and
  callout; saved with scenes and preferences, and carried into the shared report.

## 2.17.0

Figures that read in print.

### Added

- **Outline and depth cueing.** Appearance → *Outline* draws a thin or bold silhouette line
  around every element, the ink-drawing look that keeps overlapping chains legible at column
  width; *Depth cueing* fades distant parts. Both apply to the main view, every synchronized
  panel and every export, and are saved with scenes and sessions.
- **Fade a chain.** The composition table gains a *Faded* switch per chain: the chain keeps
  its colour scheme but is blended most of the way into the background, spotlighting the
  others. Carried into panels, exports and the sequence strip; saved with scenes.
- **Journal presets.** Publish → *Journal preset* sets the printed width, resolution, text
  size and font from the figure guides of Nature, Science, Cell Press, PNAS, PLOS and eLife.
  Check the current guide before submitting; the presets are a starting point.
- **One panel per model.** Publish → *Download one panel per model* renders every shown
  model (or every model of the current run) from the same camera into one lettered figure at
  the chosen print size, with the resolution written into the file.

## 2.16.0

See the model while you work.

### Added

- **Workspace layout.** On screens 1100 px and wider the 3D view, status line and sequence
  strip stay pinned in the left column while the six tool tabs live in a scrolling panel on
  the right, so every change is visible as it is made. The stage grows to fill the window
  height. A header button switches to the stacked layout and back; the choice is remembered.
  Drag the divider to resize the panel (double-click or Enter to reset); tables inside the
  panel scroll sideways when it is narrow. Narrower screens keep the stacked layout.

## 2.15.0

Save your progress as a file and pick it up anywhere.

### Added

- **Session files.** *Publish → Save session file* writes one ZIP holding the models themselves,
  their confidence data (every PAE matrix, as compact binary), the alignment, labels, selections,
  measurements, annotations, named domains, per-residue data, saved views, provenance and settings.
  *Open session file*, or dropping the ZIP on the page, restores all of it on any computer with no
  other files. This complements the browser autosave (same machine, size-capped) and scene JSON (light,
  but expects the original files).

## 2.14.0

The numbers are checked, the big runs fit, and the methods write themselves.

### Added

- **Cross-validation.** Every quantity the viewer reports — mean Cα pLDDT, Kabsch RMSD, per-residue
  Cα RMSF, radius of gyration, Cα extent and residue contacts — is now compared against an independent
  implementation (Biopython and numpy) on three real AlphaFold 3 runs: an M13 virion tip (15 chains),
  an MS2 maturation-protein–coat complex and a phiX174 F–G complex. All 72 comparisons agree to
  within 5 × 10⁻⁵ Å (the reference's rounding). `tests/reference.py` and `tests/validate.mjs` rerun
  the check on any run; `VALIDATION.md` records the results.
- **Methods text.** *Publish → Write methods text* drafts a Methods paragraph that states exactly how
  the numbers on screen were computed — superposition and pairing rule, RMSD without outlier
  rejection, RMSF definition, the PAE-domain heuristic and its cutoff, contact and ligand-site
  cutoffs, extent and radius of gyration, colour scales, hidden residues and export settings — with
  the software versions. Like the figure legend, it is a draft in the tool's words.
- **A second CDN.** If cdnjs is blocked or down, the three libraries load from jsDelivr under the
  same integrity hashes; the two hosts serve byte-identical files for these versions.

### Changed

- **Large AlphaFold 3 archives.** A `full_data` confidence file carries two N×N matrices, and the
  viewer only needs one. The file is now scanned byte by byte: the predicted aligned error is copied
  straight into compact Float32 rows, the unused contact-probability matrix is skipped, and
  `JSON.parse` only ever sees the small remainder. On a five-model, 4 410-token M13 sub-complex
  (175 MB of confidence JSON per model) the JavaScript heap after import fell from 2.2 GB to
  0.16 GB, with the matrices themselves held in about 78 MB of typed arrays per model; RMSD,
  domain and PAE values are unchanged. Matrices above 1 500 tokens are left out of the session
  autosave to keep it fast; reopen the archive to get them back.
- **Exact extent.** The Cα extent is the exact maximum Cα–Cα distance for assemblies up to 6 000
  residues. The previous two-pass estimate under-read it by up to 5 % on real assemblies; it remains
  as an explicit lower bound (shown as ≥) above that size.

### Fixed

- The README had a duplicated *Development* heading.

## 2.13.0

Assemblies read as assemblies.

### Added

- **Colour by entity.** Chains with identical sequences share one colour and the legend reads like a
  stoichiometry — α ×60 (A, B, …) 426 aa — so a capsid or a filament shows its distinct proteins
  rather than sixty colours. The composition table adds the same stoichiometry line plus the Cα extent
  and radius of gyration in nanometres.
- **Sequence motif selection.** *Annotate → Selections → Sequence motif* takes a regular expression
  over one-letter codes (`N[^P][ST]` for N-glycosylation sequons, `RGD`, `C.{2,4}C`) and highlights
  every match in every chain of the current model, listing the hits.

## 2.12.0

Where the models of a run disagree, and whether a ligand pose deserves trust.

### Added

- **Model agreement.** After *Align visible*, a new colour scheme paints each residue by the
  root-mean-square fluctuation of its Cα across the aligned models (under 0.5 Å blue, 0.5–1 green,
  1–2 yellow, 2–4 orange, 4 Å and above red; residues present in one model only grey). The legend,
  strip, panels and exports follow, and *Compare → Download RMSF CSV* writes the per-residue values.
- **Ligand sites.** *Confidence → Ligand sites* lists every ligand and ion of the current model with
  its contact residues at a chosen cutoff, the site's mean pLDDT and — when the PAE matrix carries
  AlphaFold 3 ligand tokens — the mean predicted aligned error between ligand and site, with a
  Highlight per site and a CSV.
- **Reports** offer the per-residue data colour scheme with its gradient legend.

## 2.11.0

Your data on the structure, and your work kept. Scenes from 2.2 onward still load; scene manifests
gain an optional `residueData` block.

### Added

- **Per-residue data.** *Annotate → Per-residue data* takes a CSV or TSV (file or pasted) with a
  residue column, a numeric value column and an optional chain column — conservation, deep
  mutational scanning scores, ΔΔG, coverage — and a new colour scheme paints the values with a
  viridis, diverging (centred on zero) or white–red scale. The legend states the range, the strip
  follows, residues without a value are grey, and the dataset applies to this model, every model
  from the same source, or every model. A CSV dropped with the models that is not an AlphaFold ranking
  file is read the same way. Datasets travel in scene JSON and share links.
- **Nearby residues.** *Annotate → Selections → Near* highlights every residue of the current model
  with a heavy atom within a chosen distance of the ligands and ions, of a chain, or of the residue
  you clicked, and copies the residue list for a methods section.
- **Session autosave.** The open models, confidence data, annotations, domains, views and settings
  are saved in the browser's IndexedDB a moment after every change (up to 80 MB of coordinates).
  Reopening the page offers to restore them, or to forget the copy. Nothing leaves the browser.
- **All views as a ZIP.** *Publish → Download all views (ZIP)* renders every saved view as a
  publication PNG at the current output settings (print size, dpi, text size, legend, scale bar) and
  packs them with a captions file and the generated figure legend.

## 2.10.0

Publication output and citability. Scenes from 2.2 onward still load.

### Added

- **Print-size export.** *Publish → Output* defaults to a physical width (85 mm single column, 114 mm,
  178 mm double column, or custom), an aspect, a resolution (300 or 600 dpi) and a text size in points.
  Pixel dimensions follow, the estimate line shows them, and every label, callout, measurement, legend
  and caption is scaled so text prints at the chosen point size. Pixel mode (size × scale) remains.
- **Resolution in the file.** Publication PNGs carry a `pHYs` chunk stating the dpi, so journal
  checkers and image editors read the intended print size. A **publication TIFF** (baseline,
  uncompressed RGBA, resolution tags set) is available for journals that require TIFF.
- **Figure font.** Arial/Helvetica by default, Times, or the system font, applied to every label,
  legend, caption and to SVG text.
- **Scale bar.** 10, 20, 50 or 100 Å, measured along the screen's horizontal axis at the model
  centre, shown bottom-right on screen and drawn into PNG, TIFF and SVG exports. Exact in orthographic
  projection.
- **Colour-blind-safe palette.** *Appearance* switches chain and domain colours to Okabe–Ito, with
  chain A staying blue.
- **Citation.** *Help → How to cite* gives the viewer and 3Dmol.js references; the generated figure
  legend ends with a rendering credit and, in print mode, the width, dpi and text size. The repository
  gains `CITATION.cff` and `.zenodo.json` so each GitHub release is archived on Zenodo with a DOI.

### Fixed

- Exported residue labels, callouts and measurements were drawn at their on-screen pixel size, so a
  12-pixel label printed at about 2 pt in a 3600-pixel figure. Overlays now scale with the export.

## 2.9.0

Reading the PAE matrix as structure, and giving reviewers the strip. Scenes from 2.2 onward still load.

### Added

- **PAE domains.** *Confidence → PAE domains* segments the current model into groups of residues that
  the prediction places together: ten-residue segments are merged greedily, lowest mean PAE first,
  while the mean PAE between groups stays below a chosen cutoff (4, 6 or 8 Å). Domains need at least twenty residues, may be
  discontinuous and may span chains; smaller leftovers join the nearest domain or are reported as
  unassigned. The table lists each domain's residue ranges per chain, size and
  mean internal PAE, with a Highlight button per domain, *Highlight all*, and *Colour by domains* — a
  new colour scheme (with legend) in the viewer, the strip, the panels and every export. Token
  mapping follows AlphaFold 3 token ids when present and falls back to Cα order, so ligand tokens are
  skipped. The figure legend describes the scheme and cutoff.
- **Annotated domains.** *Annotate → Domains* names a region — chain (or all chains), residue
  ranges, colour — and chooses how far it applies: this model only, every model from the same source
  (one AlphaFold run), or every loaded model. *Colour by annotated domains* paints them in the viewer,
  the strip, the panels, every export and the report, and the legend lists them by name. Names,
  colours and scope are editable in the list; *Adopt PAE domains* turns the groups found in the
  Confidence tab into named domains. Domains take part in undo, scene JSON and share links.
- **Sequence strip in the report.** Every panel of the shared report carries a strip of its model's
  residues coloured by the panel's colour scheme, one row per chain, hidden chains dimmed. Hovering
  reads chain, residue and pLDDT; clicking zooms that panel to the residue.

## 2.8.0

Working on assemblies and answering by number. Scenes from 2.2 onward still load; scene manifests gain
an optional per-model `hiddenChains` list.

### Added

- **Composition table.** Under the Models list, the current model's chains are listed with residue
  count, residue range, mean pLDDT and a chain colour swatch, plus a **Shown** switch per chain and
  *Show all chains*. Hidden chains disappear from the viewer, every panel, every export and the surface,
  and are dimmed and marked on the sequence strip. A line beneath counts the model's ligands and ions
  (HEM ×4, ZN ×2 …), water excluded. Hidden chains travel in scene JSON, share links and reports.
- **Go to residue.** In the Annotate tab, type `B:45`, `45B` or `45` and press Go (or Enter) to select
  that residue of the current model, fill the label field, zoom to it and mark it on the strip.
- **Copy PNG to clipboard.** Publish renders the publication figure at the chosen size and puts it on
  the clipboard for pasting into a slide or document; browsers that cannot do this are told so.
- **Reports catch up.** The shared report now offers the residue colour themes (charge,
  hydrophobicity, residue type, amino acid, secondary structure) and a **Ligands** control (sticks,
  spheres, hidden); it starts from the ligand setting you had, and honours hidden chains.

### Fixed

- The **Shown** controls in the composition table are drawn as switches; as bare checkboxes the
  design system rendered them as empty squares whether on or off.

## 2.7.0

Reading the sequence, and colouring by what residues are. Scenes from 2.2 onward still load; scene
manifests gain an optional `surface` setting.

### Added

- **Residue colour themes.** Five new colour schemes: **residue charge** (Lys and Arg blue, His light
  blue, Asp, Glu and nucleotides red, others grey), **hydrophobicity** on the Kyte–Doolittle scale
  (hydrophilic blue through white to hydrophobic orange), **residue type** (hydrophobic, aromatic,
  polar, positive, negative, Gly/Pro/Cys, nucleotide), **amino acid** identity in RasMol colours, and
  **secondary structure** (helix, strand, loop). Each has a legend on screen and on exports (the
  twenty-colour amino-acid legend stays on screen only), colours the sequence strip and letters, and
  is spelled out by the figure-legend writer.
- **Molecular surface.** *Appearance → Surface* adds a translucent or opaque molecular surface
  coloured by the current scheme — charge or hydrophobicity on a surface reads like an electrostatics
  view of a binding face. Hidden low-confidence residues and hetero groups are excluded. Panels and
  exports build the same surface and wait for it before capturing. Models above forty thousand atoms
  are skipped with a message.
- **Sequence letters.** *Sequence letters* under the strip shows each chain's one-letter sequence,
  fifty residues a line in blocks of ten with residue numbers in the gutter, every letter a chip in
  the current colour scheme. Click a letter to select that residue for labelling; **Copy** puts the
  chain's sequence on the clipboard. The strip itself now prints letters in its cells when they are
  wide enough. The panel's open state is remembered.
- **Draw from the sequence.** While drawing annotations or measuring, a residue clicked on the strip or
  in the letters counts as an atom click, so arrows, callouts and distances can join residues chosen by
  number.

### Fixed

- Opening the viewer with `?debug=1` exposes a small `window.__viewerDebug` object (viewer, atom
  picking, displayed entries) for the regression suite and for bug reports; it has no effect otherwise.

## 2.6.0

Getting a figure out faster. Scenes from 2.2 onward still load; scene manifests gain an optional
`hetero` setting.

### Added

- **Ligands and ions.** Hetero groups — AlphaFold 3 ligands, cofactors, ions, glycans, and the ligands
  of experimental structures — are drawn as sticks with small spheres by default, or as spheres, or
  hidden (*Appearance → Ligands and ions*). Cartoon mode used to hide them entirely. Water is never
  drawn. The choice applies to panels and exports and is stored in scene JSON and preferences.
- **90° rotations.** Toolbar buttons and the <kbd>X</kbd>, <kbd>Y</kbd>, <kbd>Z</kbd> keys rotate the
  view by exactly 90° about that axis (<kbd>Shift</kbd> reverses), and <kbd>Shift</kbd>+<kbd>R</kbd>
  returns to the file's own orientation. Synchronized panels follow. Front, side and top panels of the
  same model now line up exactly.
- **Presets.** *Thesis figure* (white background, orthographic cartoon, legend on exports, 1800 × 1200
  at 2×), *Dark slide* (dark background, perspective, colour by chain) and *Confidence review* (pLDDT
  colouring with the legend, every residue shown, ligands as sticks). Every control stays editable
  afterwards.
- **FASTA export.** *Models → Download FASTA* writes the sequences of the displayed models, one record
  per chain, with length and mean pLDDT in the header. Nucleic acids use single-letter codes; unknown
  residues are X.
- **Figure legend writer.** *Publish → Write figure legend* drafts a legend from the scene: the
  models shown, representation, colour scheme with its bands spelled out, the low-confidence cut,
  ligand handling, the alignment reference, method and per-model RMSD, synchronized panels, labelled
  residues, highlighted ranges, measurements with values, and annotation text, followed by your
  provenance notes. It is copied to the clipboard and shown in an editable field.

## 2.5.0

Reading disagreement and confidence. Scenes and reports from 2.2 onward still load; scene manifests
gain an optional `hideBelow` setting, and share links now carry saved views.

### Added

- **Cα deviation colouring.** After *Align visible*, a new colour scheme paints each residue by how
  far its Cα sits from the matched residue in the reference (under 1 Å blue, 1–2 green, 2–4 yellow,
  4–8 orange, 8 Å or more red, unmatched grey). The reference is coloured by its mean deviation
  across the aligned models. The legend, the sequence strip, comparison panels and every export
  follow the scheme.
- **Hide low-confidence residues.** *Appearance → Low confidence* hides residues below pLDDT 50 or
  70 in the viewer, every synchronized panel and every PNG and SVG export at once; the sequence strip
  dims them. The setting travels in scene JSON.
- **pLDDT profile figure.** *Confidence → pLDDT profile SVG / PNG* plots per-residue confidence for
  every displayed model, one panel per chain with the four confidence bands shaded behind, residue
  numbers along the axis, and a model legend, using your figure title. The SVG is editable; the PNG is
  rendered at 2×.
- **Multi-model sequence strip.** In overlay mode the strip shows one row per model and chain (active
  model first), so competing predictions line up residue by residue. One-at-a-time and side-by-side
  views keep the single-model strip.
- **PAE to sequence.** Hovering the PAE heatmap marks both residues of the pair on the sequence strip.
- **Saved views in share links.** Views whose models were fetched by identifier now travel in the
  link, so a recipient gets the guided tour as well as the scene.

## 2.4.0

Working faster on residues, and sharing without files. Scenes and reports from 2.2 and 2.3 still load;
scene manifests gain an optional per-model `fetch` identifier.

### Added

- **Sequence strip.** Under the viewer, every chain of the displayed model is drawn as a row of
  residues coloured by pLDDT (or by chain, when that colouring is active). Hover reads the residue,
  click selects it for a label, drag across a range fills the Selections fields, and double-click
  zooms to it. Labelled residues carry a marker; highlighted ranges are underlined in their colour.
  The strip hides on request and remembers that choice.
- **Hover readout.** Moving over the 3D view names the nearest residue and its pLDDT in the status
  bar and highlights it in the sequence strip.
- **Undo and redo.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> (and Undo / Redo buttons in the
  Annotate tab) step back through label, selection, measurement and annotation changes, including
  edits, nudges and clears. Up to sixty steps are kept; loading a scene or clearing everything
  starts afresh.
- **Share links.** *Copy share link* in Publish encodes models fetched by identifier (PDB, UniProt,
  AlphaFold DB) together with the camera, colours, representation, panels, labels, selections,
  measurements and annotations into a compressed URL fragment. Opening the link fetches the same
  files and restores the scene. Files opened from disk are never included, and the status line says
  how many were left out.
- **Chain legend.** Colour by chain now uses a fixed palette in sorted chain order, so chain A is the
  same colour in every model, every panel, the sequence strip and the report. The on-screen legend
  and the export legend (PNG and SVG) name each chain; in overlay mode with model colouring the legend
  names the models instead. *pLDDT legend on exports* became *Colour legend on exports*.

### Changed

- Fetching by identifier is shared between the Fetch button and share links, and fetched models
  remember their identifier in scene JSON (`fetch`).

### Fixed

- Structures fetched from RCSB PDB no longer report their crystallographic B-factors as pLDDT; the
  status bar, confidence table, sequence strip and pLDDT colouring treat them as having no confidence
  scores.

## 2.3.0

Figure-readiness and analysis. Scenes and reports from 2.2 still load; scene manifests gain per-model
`label` and per-annotation `offset`, `distance`, `dx`, `dy`.

### Added

- **Display names.** Rename any model from the Models list. Badges, comparison captions, the confidence
  table, annotation names, and the report use the display name; the file name stays as the identifier
  that scenes and saved views match on.
- **pLDDT legend on exports.** Publication and comparison PNGs (and their SVG variants) carry the
  standard four-band legend when colouring by confidence; the comparison figure also prints the project
  title in a footer strip.
- **Adjustable annotation placement.** Every label — callout text, arrow and line captions, marker
  text, corner titles — has arrow buttons that nudge it in screen space; the offset is stored in model
  space so it stays put when the view rotates. Callouts take an explicit leader length. Offsets round-trip
  through scene JSON and the report.
- **Vector figure export.** *Download figure SVG* and *Download comparison SVG* write the rendered
  molecule as a raster and everything on top of it — residue labels, measurements, arrows, callouts,
  markers, corner titles, panel letters, captions, legend — as editable SVG elements.
- **Offline reports.** *Embed 3Dmol.js for offline use* inlines the pinned library into the report after
  re-verifying it against the page's Subresource Integrity hash, so the file opens with no network.
- **PAE detail in reports.** Choose full, compact (200 × 200), or omitted heatmaps; the size estimate
  now accounts for PAE data and the embedded library instead of counting coordinates alone.
- **Interface geometry.** In the Confidence tab, analyse a model for inter-chain heavy-atom contacts at a
  chosen cutoff, residue pairs, interface residues per chain, and buried surface area by Shrake–Rupley
  (1.4 Å probe, 92 points). Highlight a pair's interface residues in one click and export the table
  with residue lists as CSV.
- **Editable labels.** Residue labels are listed under the label controls; each row edits the text in
  place, sets Small/Normal/Large/Huge and a colour, zooms to its residue, or removes it. Annotation
  rows edit their text, colour, and size inline as well. All of it carries into scenes, exports, and
  the report.
- The regression suite runs in Firefox and WebKit as well as Chromium (`PSV_BROWSER=firefox|webkit`),
  attributes console errors to the step that produced them, checks that exports are not blank, and
  covers display names, nudging, SVG export, offline reports, and interface analysis.

### Fixed

- **Firefox and WebKit rendered multi-view panels and exports with page errors.** 3Dmol draws every
  viewer through one shared OffscreenCanvas and transfers a bitmap into each canvas; those engines fail
  the transfer as soon as a second viewer of a different size exists. They now get a WebGL context of
  their own per canvas (3Dmol's single-cell grid path); Chromium keeps the shared context. The export
  surface also no longer asks for 3Dmol's `upscale` mode, which used the same transfer.
- **Fit** framed the primary panel far too small while comparing, because it zoomed to every model the
  viewer held — including ones styled invisible — rather than the one displayed. Annotation rows now
  wrap on narrow screens instead of crushing their text, and corner titles clear the panel badge.

## 2.2.0

A capability release for comparing many predictions at once and for making figures. Scenes and
reports from 2.1 still load; scene manifests gain `annotations`, `comparePanels`, and `syncMode`.

### Added

- **Synchronized multi-view.** The comparison view takes up to six models (a primary panel plus five
  more), laid out one row for two or three panels, a 2 × 2 grid for four, and three columns for five
  or six. Every panel carries its model name. Dragging, wheel-zooming, spinning, or rocking any panel
  moves them all; the primary is no longer special.
- **Camera sync modes.** *Rotation only* (the default) shares orientation while each panel keeps its own
  centre and zoom, so assemblies of different size stay framed. *Rotation and zoom* locks the cameras
  completely, which is the right mode for superposed models after **Align visible**.
- **Download comparison PNG** stitches the current panels into one lettered figure at the chosen
  export size and scale, with each model's name and mean pLDDT in a caption strip.
- **Figure annotations.** In the Annotate tab: arrows and lines between two clicked atoms, residue
  markers and text callouts on one clicked atom, and corner titles as screen text. They are anchored to
  atoms, so they follow rotation and alignment, and they are drawn into publication PNGs, comparison
  figures, comparison panels, and the shared report. They round-trip through scene JSON.
- **Multi-panel reports.** The shared HTML report now shows one to six synchronized panels with their
  own model pickers, steps every panel together, spins and fits them together, switches background,
  exports a stitched lettered PNG or a composite video, and offers full screen. Superposed models are
  exported with their aligned coordinates, and labels, measurements, and figure annotations travel too.
- Nearest-atom picking: clicks in the main viewer select the closest projected atom within a few
  pixels, so labels, measurements, and annotations land in cartoon mode instead of requiring a hit on
  a Cα sphere.
- A rotating tips bar under the viewport, a **Load an example** button in the empty state, an `S`
  shortcut for spinning, and a *Tips for figures and reviewers* section in the help dialog.

### Fixed

- Adding a residue label no longer erases measurement labels: labels, measurements, and annotations
  are rebuilt in one pass.
- The comparison viewport is now genuinely synchronized. 3Dmol redraws drags through a path that
  bypasses its state-change callback, so the previous side-by-side view only matched the camera at
  the moment it was set up.
- Publication PNG export now includes residue labels and measurements.

## 2.1.0

A correctness, robustness, and interface pass over the 2.0 viewer. No file formats or exports changed
shape, so scenes and reports produced by 2.0 still load.

### Fixed

- **Dropping a file outside the upload card navigated the browser away from the viewer**, discarding
  the whole session. Drops are now accepted anywhere on the page, and the default browser handling is
  suppressed everywhere else.
- **Publication and contact-sheet export leaked a WebGL context per render.** Browsers cap the number
  of live contexts and silently discard the oldest, so a multi-panel contact sheet reliably killed the
  main viewport. Export now reuses one off-screen render target and explicitly releases it when the
  job finishes.
- **Generated HTML reports rendered the molecule on top of their own toolbar**, and every control in
  the report — previous, next, play, spin, download — was unclickable as a result. 3Dmol.js positions
  its canvas absolutely; the report's `#view` container had no positioning context, so the canvas laid
  itself out against the page instead. The container is now `position: relative`.
- **Structure fetch by AlphaFold accession** now resolves through the EBI API instead of assuming a
  `_v4` file name. AlphaFold DB is on v6, so the previous scheme would have returned 404 for every
  entry.
- **Highlight and hide selections with an empty chain field matched nothing.** The chain is now
  omitted from the selection rather than passed as an empty string, so a blank chain means every chain.
- Selections, labels, and measurements referring to a model that has been released to save memory no
  longer throw; they are skipped until the model is displayed again.
- `Restore coordinates` no longer throws when a model's atom list was released.
- Alignment reports missing or unreadable models instead of aborting, and says so when `numeric.js`
  failed to load rather than failing silently.
- The drag highlight no longer flickers when the pointer crosses a child element of the drop zone.
- Arrow-key navigation no longer throws when the keyboard event target is not an element.
- PAE hover readout indexes rows and columns independently, so it is correct for non-square matrices.
- The side-by-side comparison pane materialises its model before cloning coordinates, so it reflects
  alignment and styling instead of showing the raw file coordinates. It also resizes with its
  container now.
- The comparison **Left model** selection is no longer reset to the active model every time the model
  list re-renders.
- Spin-video recording restores the motion setting it interrupted, and refuses to start a second
  recording while one is running.
- `Cycle models` no longer destroys its own icon when its label changes.
- `Clear all` resets the source filter, PAE readout, error notice, fetch field, comparison viewer, and
  identifier counters, and asks for confirmation when more than one model would be discarded.
- Contact-sheet captions wrap across up to three lines instead of being horizontally squashed.
- Confidence CSV export no longer rescans every metadata asset per row, and now records each model's
  source archive.
- In generated reports: guided views apply their representation and colour scheme in one render rather
  than two, `Element` colouring is selectable, arrow keys no longer hijack typing in the interval
  field, and the recording length follows the length chosen in the Publish tab.

### Added

- **Fetch a structure by identifier** — a PDB ID from RCSB, or a UniProt accession or AlphaFold DB
  entry name from EMBL-EBI. AlphaFold fetches pull in the entry's predicted-aligned-error data too.
- **Appearance theme control** cycling system / light / dark, remembered between sessions.
- **Full-screen mode** for the 3D view (<kbd>Shift</kbd> + <kbd>F</kbd>).
- **In-app help** (<kbd>?</kbd>) covering import, interaction, shortcuts, and how to read the
  confidence numbers.
- **Keyboard shortcuts**: <kbd>C</kbd> to cycle, <kbd>F</kbd> to fit, <kbd>Shift</kbd> + <kbd>F</kbd>
  for full screen, <kbd>1</kbd>–<kbd>6</kbd> for tool tabs, <kbd>?</kbd> for help, <kbd>Esc</kbd> to
  back out.
- **Report scope control** — build a report from the models currently shown or from every loaded
  model — with a size estimate shown before you build it. Reports previously always embedded every
  loaded model regardless of what was displayed.
- Transient toast notifications for actions and errors, alongside the existing status line.
- A busy indicator on the viewport during imports, fetches, alignment, and rendering. A large
  supersampled export is one long synchronous WebGL call — around 18 seconds for 3600 × 2400 on a
  software renderer — so the indicator and the button's "Rendering…" label are now given a frame to
  paint before the main thread locks up, and a warning is shown above 6 megapixels.
- Tooltips on the controls whose effect is not obvious from their label.
- Preference persistence for representation, colours, projection, background, view mode, model order,
  alignment mode, export size and scale, panel columns, video length, and animation speeds.
- Paging in the model list, so archives with hundreds of models stay responsive.
- A headless regression suite in [`tests/`](tests/), driving the real viewer in Chromium. It carries
  explicit regressions for the WebGL context leak and the report canvas overlay, and verifies the
  pinned libraries against their SRI hashes before running.

### Changed

- **Third-party libraries are now integrity-pinned.** 3Dmol.js, JSZip, and numeric.js carry SRI
  hashes, so a tampered or substituted CDN file will not execute.
- **Two CDN dependencies removed.** The icon set (Lucide) and the tooltip implementation are now
  inline, cutting roughly 600 KB and two network round-trips from page load, and letting the interface
  render correctly with no connectivity.
- The Content-Security-Policy is narrowed from seven allowed origins to `cdnjs.cloudflare.com` for
  scripts and `files.rcsb.org` / `alphafold.ebi.ac.uk` for fetches.
- A failure to load 3Dmol.js now shows an explanatory message instead of a blank page.
- The page has a real header, title, and description; the document title is no longer "Generic
  Protein Viewer".
- Documentation restructured: a shorter README, a full [usage guide](docs/USAGE.md) with a
  troubleshooting section, and this changelog.

## 2.0.0

Publication and reviewer workflow: tabbed interface, publication PNG and WebM export, named views with
captions, contact sheets, chain/residue selections, distance and angle measurements, synchronised
side-by-side comparison, sequence-aware alignment, PAE heatmaps and interface confidence, reproducible
scene manifests with SHA-256 hashes, and portable interactive HTML reports.
