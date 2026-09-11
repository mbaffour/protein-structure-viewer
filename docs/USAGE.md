# Usage guide

A task-oriented walkthrough of the viewer. For an overview see the [README](../README.md); for the
interpretation caveats see [`SCIENTIFIC-AUDIT.md`](../SCIENTIFIC-AUDIT.md).

## Contents

- [Getting structures in](#getting-structures-in)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Models tab](#models-tab)
- [Appearance tab](#appearance-tab)
- [Annotate tab](#annotate-tab)
- [Compare tab](#compare-tab)
- [Confidence tab](#confidence-tab)
- [Publish tab](#publish-tab)
- [Reproducible scenes](#reproducible-scenes)
- [Recipes](#recipes)
- [Working with large AlphaFold archives](#working-with-large-alphafold-archives)
- [Troubleshooting](#troubleshooting)

## Getting structures in

**Drag and drop.** Drop files anywhere on the page — the drop target is the whole window, not just
the upload card. Several archives can be dropped together.

**File picker.** The **Choose model files** control accepts `.pdb`, `.cif`, `.mmcif`, `.json`, `.csv`,
and `.zip`, multiple at a time.

**Fetch by identifier.** Type an ID and press **Fetch**:

| Input | Resolves to |
| --- | --- |
| `1ubq`, `7cn3` | `files.rcsb.org` — the mmCIF for that PDB entry |
| `P69905`, `P0DTC2` | AlphaFold DB — the current model for that UniProt accession |
| `AF-P0DTC2-F1` | AlphaFold DB — that specific entry and fragment |

AlphaFold DB entries are resolved through the EBI API rather than by guessing a file name, so the
current model version is always used, and the entry's predicted-aligned-error file is pulled in with
the coordinates when it is available.

**Confidence and ranking metadata.** Drop these alongside (or inside) your models and they attach
automatically by file-name matching:

- `*_confidences.json` / `*_summary_confidences.json` (AlphaFold 3) — pTM, ipTM, ranking score,
  fraction disordered, clash flag, PAE, chain-pair ipTM, chain-pair minimum PAE
- `ranking_debug.json` (AlphaFold 2) — model order and per-model ranking confidence
- `ranking_scores.csv` (AlphaFold Server) — seed/sample ranking scores, converted to ranks

Anything the viewer cannot interpret is skipped and reported in the red notice below the upload card.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next model |
| <kbd>C</kbd> | Start or pause automatic cycling |
| <kbd>F</kbd> | Fit every panel to what it displays |
| <kbd>S</kbd> | Start or stop spinning |
| <kbd>Shift</kbd> + <kbd>F</kbd> | Toggle full screen |
| <kbd>1</kbd>–<kbd>6</kbd> | Jump to Models / Appearance / Annotate / Compare / Confidence / Publish |
| <kbd>?</kbd> | Open in-app help |
| <kbd>Esc</kbd> | Close help, leave full screen, or stop measuring or drawing |

Shortcuts are suppressed while you are typing in a field.

## Models tab

- **Source** filters to one loaded archive. **Find models** filters by name or stoichiometry.
- **View mode** switches between overlaying every shown model and displaying one at a time.
- **Model order** sorts by load order, ranking score, or mean pLDDT. Models without the chosen score
  sort last.
- **Cycle models** steps through the currently filtered, visible models at the chosen interval.
  Navigation and cycling both switch the view to one-at-a-time mode.
- Each row has its own visibility switch, mean pLDDT readout, colour picker, and remove button.
  Changing a row's colour switches the colour scheme to *Per structure* so the change is visible.
- Long lists are paged: **Show more** adds another 60 rows.

## Appearance tab

Representation (cartoon / sticks / spheres / lines), colour scheme, projection, background, and
motion. Two notes:

- **pLDDT** colouring uses the standard AlphaFold bands and reveals the legend under the viewport.
  It reads the B-factor column, so it is only meaningful for files that carry pLDDT there.
- **Transparent** background is the right choice for figures that will be composited; PNG export
  preserves the alpha channel.

Appearance choices, export settings, and animation speeds are remembered in the browser between
sessions.

## Annotate tab

**Inspecting.** Click any atom to see its model, residue, chain, atom name, and pLDDT. Clicks pick
the nearest atom within a few pixels, so a click on a cartoon ribbon lands on the closest Cα.

**Labels.** With an atom selected, edit the suggested text and press **Add or update**. *Label every
residue* annotates all Cα atoms of the current model — useful for small structures, unreadable for
large ones.

**Selections.** Pick a model, optionally a chain, and a residue range (`20-45`, or `20,24,31`, or a
mix), then **Highlight** it in a chosen colour or **Hide** it. Leaving the chain blank applies the
range to every chain.

**Measurements.** Choose distance (two atoms) or angle (three atoms), press **Start measuring**, and
click the atoms in the viewport. Values update as coordinates change — so aligning models updates
the distances between them. <kbd>Esc</kbd> leaves measurement mode.

**Figure annotations.** Pick a tool, press **Start drawing**, and click atoms in the main viewer:
an **arrow** or **line** joins two clicked atoms, a **residue marker** drops a translucent sphere on
one atom, and a **text callout** places your text on a leader line pointing away from the model.
Choose colour, size, dashed style, and optional label text before you click. **Screen text** adds a
corner title (for panel letters or captions) that stays put while the model rotates. Annotations are
anchored to atoms, so they follow rotation and alignment, and they are drawn into publication and
comparison PNGs, comparison panels, and the shared report. Remove any one from the list, or clear
them all. <kbd>Esc</kbd> stops drawing.

## Compare tab

**Alignment.** Choose a reference model and a residue-mapping strategy:

- *Sequence-aware* runs a global Needleman–Wunsch alignment between every reference chain and every
  target chain, then greedily pairs chains by identity. Use this when chain IDs or numbering differ
  between predictions.
- *Chain and residue IDs* pairs Cα atoms with identical chain and residue identifiers. Use this when
  the models genuinely share a numbering scheme, and you want no sequence heuristics involved.

**Align visible** superposes every visible model onto the reference using a Kabsch rotation over the
paired Cα atoms, and reports per-model Cα pairs, sequence identity, RMSD, and the chain mapping used.
**Restore coordinates** undoes the superposition. **Download RMSD CSV** exports the table.

Alignment needs at least three paired Cα atoms. If nothing aligns, the models likely share no chains
under the chosen mapping — try the sequence-aware mode.

**Synchronized multi-view.** Turn it on to place up to six models in linked viewports — the primary
panel plus up to five more, each with its own model picker and name badge. Two or three panels sit in
one row, four make a 2 × 2 grid, five or six use three columns. Dragging, wheel-zooming, spinning, or
rocking any panel moves them all. **Camera sync** chooses what is shared: *Rotation only* keeps each
model framed on its own centre, which suits assemblies of different size; *Rotation and zoom* locks
the cameras completely, which suits superposed models after **Align visible**. **Fit** (or
<kbd>F</kbd>) refits every panel. The panel set, sync mode, and each panel's camera are stored in saved
views and scene manifests, and the shared report opens with the same panels.

## Confidence tab

The metrics table lists mean pLDDT, pTM, ipTM, ranking score, rank, and clash flag per model, and
exports to CSV along with the source archive and which files each number came from.

The PAE heatmap shows the active model's predicted aligned error, with chain boundaries drawn in and
per-token inspection on hover. Chain-pair ipTM and minimum PAE appear underneath when the confidence
file provides them. Both export to PNG.

Read these together with pLDDT rather than instead of it: pLDDT is local and per-residue, PAE and
ipTM are what speak to domain and chain placement.

## Publish tab

**Images.** Choose a size and supersampling factor and export a PNG rendered off-screen at full
resolution, independent of your window size. Very large requests are capped at roughly 24 megapixels
for browser stability, and the status line says when that happened.

Rendering is one long synchronous WebGL call, so the page stops responding while it runs — expect a
few seconds on a machine with a real GPU and considerably longer without one. A warning appears above
6 megapixels. If you only need a figure for a slide, 1× scale is four times faster than 2×.

**Comparison figure.** With the synchronized multi-view on, **Download comparison PNG** renders every
panel at the chosen size and stitches them into one lettered figure with each model's name and mean
pLDDT in a caption strip. The total is capped at roughly 24 megapixels, so six panels at a large
size come out smaller per panel than one.

**Video.** Record a 5, 10, or 15 second WebM of the structure spinning. Chrome and Firefox support
this; Safari does not, and the viewer will say so.

**Saved views.** Save the current camera, model selection, colours, representation, and background
under a name and caption. Saved views can be reloaded, exported as a multi-panel contact sheet with
lettered captions, exported as caption text, and followed as a guided tour inside the shared report.

**Reports.** **Share report** builds a standalone HTML file with the coordinate data embedded —
including aligned positions if you superposed models, plus labels, measurements, and figure
annotations. Choose whether it carries the models currently shown or every loaded model; the
estimated size is shown before you build it. The report opens with no server and lets a reader show
one to six synchronized panels (it starts with the panels you had open), pick a model per panel, step
every panel forward and backward or cycle automatically, spin and fit them together, switch the
background, follow your guided views, read pLDDT and PAE for the focused panel, and export a stitched
lettered PNG or a composite video of their own.

**Provenance.** Fill in the figure title, model source, method and version, and notes. These travel
into the report header, the caption export, and the scene manifest.

## Reproducible scenes

**Download scene JSON** writes a manifest describing the scene without the coordinates: a SHA-256
hash of every structure file, the camera, model order and visibility, colours, labels, selections,
measurements, saved views, comparison and alignment settings, and your provenance notes.

To restore one, load the structure files first, then pick the scene JSON under **Restore scene JSON**
(or just drop the JSON in with the files — it is applied once structures are present). Hashes are
recomputed on restore, and the status line warns if any file no longer matches the one the scene was
saved from.

The manifest is what you archive alongside a figure so the scene can be rebuilt later. It is not a
substitute for keeping the coordinate files.

## Recipes

Three workflows the viewer was built around, end to end.

**A thesis figure comparing several predictions.** Drop the result archives. In **Models**, order by
ranking score and hide anything you will not show. In **Appearance**, colour by pLDDT confidence and
choose orthographic projection. In **Compare**, turn on **Synchronized multi-view**, add a panel per
model, and leave the sync on *Rotation only* if the models differ in size. Drag any panel until the
view makes your point, press <kbd>F</kbd> to refit. In **Annotate**, draw the arrow or callout that
names the feature, and add a corner title. In **Publish**, pick the size and scale, then **Download
comparison PNG**; save the view under a name too, so the same camera can be reused.

**A report a reviewer can open on a laptop.** Load only the models the report should carry, or set
*Report contents* to *Models currently shown*. Fill in the provenance fields — title, run, method —
they become the report header. Save two or three named views with captions; they become the guided
tour. Leave the multi-view on with the panels you want the reader to start from, and press **Share
report**. The single HTML file embeds coordinates, aligned positions, confidence, PAE, labels, and
annotations, and opens with no install. Download the scene JSON alongside it for your own records.

**Checking a superposition honestly.** Show the models to compare, pick the reference in **Compare**,
run **Align visible**, and read the table: aligned Cα count, identity, chain mapping, RMSD. If the
mapping is not what you expected, switch residue mapping and align again. Then enable the multi-view
with *Rotation and zoom* so every panel shares the exact camera, add a distance measurement across the
region of interest, and quote the alignment statistics next to any RMSD you report.

## Working with large AlphaFold archives

Archives with hundreds of predictions are handled with a few deliberate compromises:

- Multi-model archives open in one-at-a-time mode rather than as a single overlay.
- Only the first model of an archive is parsed eagerly; the rest are parsed when first displayed.
- Above 40 loaded models, models that are not displayed and not referenced by an annotation are
  released from GPU memory and re-parsed on demand.
- Above 25 models in one archive, the large `*_full_data_*.json` PAE payloads are skipped. Drop the
  specific ones you need separately.
- The model list renders 60 rows at a time.

## Troubleshooting

**"The 3Dmol.js rendering library could not be loaded."** The page could not reach
`cdnjs.cloudflare.com`. Check connectivity, and any extension or network policy blocking CDNs. The
viewer needs that one fetch at startup; everything afterwards is local.

**A model loads but shows nothing.** Check the red notice under the upload card. A file with no
readable atoms is reported there and its visibility switched off.

**pLDDT reads "—".** The file has no Cα B-factor values to average — normal for experimental
structures and for prediction tools that do not write pLDDT into the B-factor column.

**Confidence JSON did not attach.** Matching is by file name. A confidence file is paired with a model
when their stems match after stripping the `_confidences`, `_summary_confidences`, `_full_data`, and
`_model` suffixes, or via `ranked_N` ordering, or via a `seed-X_sample-Y` name. If yours does not
match any of those, rename it to its model's stem plus `_confidences.json`.

**Alignment produced no rows.** Fewer than three Cα atoms could be paired. Switch to sequence-aware
mapping, or check that the models actually contain protein chains.

**Video recording is unavailable.** `MediaRecorder` canvas capture is not implemented in Safari. Use
Chrome or Firefox, or export a PNG.

**The report is enormous.** It embeds coordinates for every model it carries. Switch **Report
contents** to *Models currently shown* and hide everything you do not need.
