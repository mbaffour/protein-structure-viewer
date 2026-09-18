# Protein Structure Viewer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22741487.svg)](https://doi.org/10.5281/zenodo.22741487)
[![Tests](https://github.com/mbaffour/protein-structure-viewer/actions/workflows/tests.yml/badge.svg)](https://github.com/mbaffour/protein-structure-viewer/actions/workflows/tests.yml)

A single-file, browser-based viewer for predicted and experimental protein structures. It is built
for the everyday work around a structure prediction run: look at the models, compare them, check
what the confidence numbers actually say, annotate what matters, and get a figure or a shareable
interactive report out the other end.

Structure files you open stay in the browser. Nothing is uploaded.

- **Live viewer:** <https://mbaffour.github.io/protein-structure-viewer/>
- **Usage guide:** [`docs/USAGE.md`](docs/USAGE.md)
- **Scientific and publication-readiness audit:** [`SCIENTIFIC-AUDIT.md`](SCIENTIFIC-AUDIT.md)
- **Release notes:** [`CHANGELOG.md`](CHANGELOG.md)
- **Background and design notes:** [blog post](https://mbaffour.github.io/blog/protein-structure-viewer.html)

## Quick start

1. Open the [hosted viewer](https://mbaffour.github.io/protein-structure-viewer/), or open
   `index.html` from a local copy. On macOS you can double-click `Launch Protein Viewer.command`.
2. Drop a `.pdb`, `.cif`/`.mmcif`, or a complete AlphaFold result `.zip` anywhere on the page.
   You can also type an identifier and press **Fetch**:
   - `1ubq` — a PDB entry from RCSB
   - `P69905` — a UniProt accession, resolved against AlphaFold DB
   - `AF-P0DTC2-F1` — an AlphaFold DB entry name

   If you have a sequence but no structure, two links open a predictor in a new tab; download the
   result archive from either and drop it here. **Predict** opens
   [AlphaFold2 WebGPU](https://martin-steinegger.github.io/alphafold2-webgpu/), which folds a
   monomer or complex on your own GPU with no sign-in. **AlphaFold Server** opens
   [DeepMind's hosted AlphaFold 3](https://alphafoldserver.com/), which also models ligands,
   DNA/RNA and modified residues, but needs a Google account and sends the sequence to Google.
3. Use the tool tabs underneath the viewport: **Models**, **Appearance**, **Annotate**,
   **Compare**, **Confidence**, **Publish**.

Press <kbd>?</kbd> in the viewer for keyboard shortcuts and inline help.

### What loads

| You drop | What happens |
| --- | --- |
| `.pdb`, `.cif`, `.mmcif` | Loaded as a model |
| AlphaFold result `.zip` | Every model is extracted and grouped under the archive name; template hits are ignored |
| `*_confidences.json`, `*_summary_confidences.json` | pTM, ipTM, ranking score, clash flag, and PAE are attached to matching models — this is the shape [AlphaFold Server](https://alphafoldserver.com/) and the open-source AlphaFold 3 pipeline both write |
| `ranking_debug.json`, `ranking_scores.csv` | Ranks and ranking scores are attached to matching models |
| An [AlphaFold2 WebGPU](https://martin-steinegger.github.io/alphafold2-webgpu/) result `.zip` | The model, its `*_scores.json` and `*_predicted_aligned_error_v1.json`, its `.a3m` and its `config.json` are read together and paired by job name |
| `*_scores.json` | pTM, ipTM, ranking score and PAE are attached; a flat `predicted_aligned_error` is folded back into a square matrix |
| A scene JSON saved from the Publish tab | The whole annotated scene is restored once its structures are present |

Multi-model archives open one model at a time so the browser does not try to render hundreds of
predictions as a single overlay. Large archives load models lazily and skip their very large
`full_data` PAE payloads; those files can still be added individually when you need them.

## What it does

**Look at models.** Multiple structures at once with independent visibility, colour, and
ranking-score readout per model. Overlay mode or one-at-a-time mode, with previous/next controls,
arrow-key navigation, adjustable automatic cycling, and sorting by ranking score or mean pLDDT.
Source-archive filtering and name/stoichiometry search keep large prediction sets navigable, a composition table lists each chain of the current model with a show/hide switch, its stoichiometry
by identical sequence, its Cα extent and radius of gyration, and counts its ligands and ions, and the displayed models export as FASTA, one record per chain.
Cartoon, stick, sphere, and line representations, with an optional translucent or opaque molecular
surface; per-structure, per-chain, per-entity (identical sequences share a colour), pLDDT, Cα-deviation, residue-charge, hydrophobicity, residue-type,
amino-acid, secondary-structure, sequence-spectrum, and element colouring; a one-step cut that hides residues below pLDDT 50 or 70
everywhere; ligands and ions as sticks, spheres, or hidden; perspective or orthographic projection;
transparent, white, dark, or custom backgrounds; one-click presets for a thesis figure, a dark slide,
or a confidence review; and exact 90° rotations so panels of the same model line up.

**Read the confidence.** Mean pLDDT from Cα B-factors with the standard AlphaFold legend.
Model-level pTM, ipTM, ranking score, rank, and clash flag, plus chain-pair ipTM and minimum PAE
when the data is there. Interactive PAE heatmaps with per-token inspection that marks the residue pair on the sequence
strip, PNG export, a downloadable confidence-metrics CSV, and a per-residue pLDDT profile figure
(SVG or PNG, one panel per chain, every displayed model overlaid). Interface geometry per model: inter-chain heavy-atom contacts,
interface residues, and Shrake–Rupley buried surface area, with one-click highlighting and CSV export.
PAE-derived domains — groups of residues the prediction places together — as a table, a colour
scheme, and one-click highlights. Ligand sites: contact residues per ligand or ion, site mean pLDDT
and, for AlphaFold 3, ligand–site PAE.

**Compare.** Sequence-aware Cα alignment (global Needleman–Wunsch per chain pair, greedily matched)
or strict chain/residue-ID alignment, with per-model aligned-residue count, sequence identity, chain
mapping, and Cα RMSD, plus a CSV export, a one-click coordinate restore, a colour scheme that
paints each residue by its Cα deviation from the reference, and another that paints the per-residue
Cα RMSF across all aligned models (with a CSV) — where the models of a run agree and where they do not. Synchronized
multi-view of up to six models whose cameras follow each other — rotation only, so assemblies of
different size stay framed, or rotation and zoom for superposed models.

**Annotate.** Map your own per-residue values (conservation, mutational scores, ΔΔG) onto the
structure from a CSV with a gradient legend, and highlight every residue within a distance of a
ligand, a chain, or a clicked residue, or every match of a sequence motif. Click any atom to inspect its model, residue, chain, atom name, and pLDDT, or hover
to read it from the status bar. A sequence strip under the viewer draws every chain coloured by
the current scheme: click a residue to select it, drag a range to fill the selection fields,
double-click to zoom. A sequence-letters panel shows the one-letter sequence with residue numbers,
clickable and copyable per chain.
Type a residue number to go straight to it. Name domains by residue range and colour, apply one
definition to every model of an AlphaFold run, and colour by them with a legend that lists them by
name. Add or edit custom residue labels, or label every residue
in the current model. Highlight or hide chain/residue
ranges, and add atom-to-atom distance or three-atom angle measurements. Draw figure annotations —
arrows, lines, residue markers, text callouts, and corner titles — that follow rotation and alignment
and appear in every export; nudge any label into place and it stays there as the model turns. Give
models display names for captions. Undo and redo every one of these changes.

**Publish.** PNG, TIFF and SVG export at a stated print width and resolution with the dpi written
into the file (or fixed pixel sizes), text sized in points, a journal font, a scale bar, a stitched lettered comparison figure of every
synchronized panel, every saved view as a ZIP of print-size PNGs, SVG variants of both with labels, arrows, captions, and the colour legend
(pLDDT bands, chains, or models) as editable vector layers, and 5-, 10-, or 15-second WebM spin-video export. Reusable named views with
captions, multi-panel contact-sheet export, and caption-text export.
Self-contained interactive HTML reports (each panel with a hover-to-read, click-to-zoom sequence
strip), share links that reopen models fetched by identifier
with the same camera, colours, labels, and annotations, and a figure-legend writer that drafts the
legend from what is on screen. Reproducible scene manifests carrying SHA-256 structure-file
hashes, camera, model state, colours, labels, selections, measurements, saved views, comparison and
alignment settings, and your provenance notes.

## Shareable reports

1. Load the models that should appear in the report.
2. Optionally save named views and captions in the **Publish** tab.
3. Choose whether the report carries the models currently shown or every loaded model, then select
   **Share report**.
4. Open the resulting `protein-model-report.html` in any browser.

The report *is* the figure: it embeds the coordinate data — aligned positions included — and lets a
reader show one to six synchronized panels, pick a model per panel, step every panel forward and
backward, cycle automatically, spin and fit them together, switch the background, follow your saved
guided views and captions, inspect pLDDT and PAE, and export a stitched PNG or composite video of
their own. Labels, measurements, and figure annotations travel with it. It loads 3Dmol.js from a CDN
when opened unless you tick *Embed 3Dmol.js for offline use*, which inlines the integrity-verified
library so the file works with no network. Choose full, compact, or omitted PAE heatmaps to control
the size.

The Publish tab shows the estimated report size before you build it — embedding a few hundred models
produces a file that is slow to open, so narrow the selection when the report is for a reviewer.

## Layout

On a wide screen the viewer is a workspace: the tool tabs scroll in a panel on the left while the
3D view, status and sequence stay pinned on the right, so you see each change as you make it. The
arrows button in the header swaps the sides. Drag the divider to resize the panel; the header's panel button switches to the stacked
layout and back, and the choice is remembered. Screens narrower than 1100 px always stack.

## Colour by MSA

Confidence → *Colour by MSA* reads the unpaired alignment inside an AlphaFold 3 archive (or an
`.a3m` you add) and colours each matching chain by conservation, identity to the query or coverage.
Conservation is 1 − H/log₂20 with the sequences weighted by the position-based scheme of Henikoff &
Henikoff (1994) by default; a switch gives the unweighted column entropy. It loads as a per-residue
dataset, so legend, strip, exports, report and methods text follow and state which weighting was used.

## Composite figure

Publish → *Download composite figure* stitches the 3D view with the PAE heatmap, the pLDDT profile
and the interface contact map into one lettered figure at the chosen print size, each panel rendered
at output resolution with a caption. Tick the panels you want; unavailable ones are greyed out.

## What the report carries

The shared HTML report reproduces the outline, depth cueing and faded chains, and shows the
interface contact map beside the PAE heatmap when one was computed for a model in the report.

## Superposing models

Compare → **Align visible** superposes every shown model onto the reference by Kabsch fitting of
Cα atoms paired by sequence or by residue identifier. For assemblies of identical subunits,
**Match identical chains by position** re-pairs the chains by where they sit after a first fit, so a
model that places the same subunit differently is compared against the copy it corresponds to. In
the Models list, **Emphasise** draws one model solid and the rest as faded thin ribbons, which is
how an overlay of five predictions becomes a figure. **Compute matrix** superposes every shown model
onto every other and tabulates the pairwise Cα RMSDs, exportable as CSV and as a heat map, so an
ensemble figure can say which models agree; it marks the medoid, and **Use medoid as reference**
superposes everything onto that model and emphasises it in one press. **RMSF profile** plots the
per-residue Cα spread across the aligned models, one panel per chain, as SVG or PNG and as a
composite-figure panel. **Fit on** narrows what the rotation is
computed from — a chain, a residue range, or the residues you have selected — and the table reports
the RMSD over that region beside the RMSD over everything matched, which is how a hinge or a moved
domain is shown. Colour by *Cα deviation* to paint what moved, and by *Model agreement* for the
per-residue RMSF across the whole ensemble.

## Moving labels and placing the legend

Labels are draggable: pick one up in the 3D view and put it where the figure needs it. A residue
label keeps a leader line back to its residue and stores its move against the structure, so the
camera can turn without losing the arrangement; *Reset* in its row puts it back. Labels that land on
top of each other — one per model at the same residue of two superposed models — are stacked apart for
you when a position is compared and when a site figure is built, and **Separate labels** does it again
for the framing on screen; a label you moved by hand is left where you put it. An exported figure
works the arrangement out again for each panel, at the size that panel prints its text — print text is
several times larger against the structure than screen text — without moving anything in the view.
**Legend position**
in Publish puts the colour legend in any corner or stacks it down the left or right side of the
figure, on every export and on each panel of a built figure.

## Comparing positions across models

Loaded a wild type and a point mutant from two prediction runs? Select the residue and press
**Compare this position** in Annotate. Every shown model gets the side chain drawn at that position,
a label naming that model's own residue there — `Ala15` against `Gly15`, in the model's colour — and
a one-line readout saying whether the models agree or exactly how they differ. The sticks are part of
the style, so every panel and export shows them, and the labels behave like any other residue label.
Positions are matched by the Cα pairing of the superposition once the models have been aligned, and by
chain and residue number otherwise, so a construct that numbers the same residue differently is still
compared correctly; the methods text says which rule was used.

After **Align visible**, the same press measures what the substitution did to its surroundings: a
neighbourhood table of every residue of the reference model with a heavy atom within the cutoff
(default 5 Å) of the site, each row giving its Cα deviation from the reference in every other model,
with the site first, a neighbourhood mean at the bottom, and a one-line summary — *site moved 0.42 Å
in model_mutant · 7 neighbours within 5 Å moved 0.31 Å on average*. **Highlight neighbourhood** turns
those residues into a normal highlight selection and **Download effect CSV** exports the table.
A site is rarely one residue: type a set into **Positions** — `A:20-30, A:45`, or bare numbers and
ranges for the chain of the selected residue — and **Compare these positions** compares all of them in
one press (up to 40), skipping and counting any that only one shown model carries. The table then opens
with one row per site and follows with the union of their neighbourhoods, each residue counted once,
and the readout becomes one line for the set: *4 positions compared · A:20, A:21, A:24, A:45 · sites
moved 3.10 Å on average in model_3 · 18 neighbours within 5 Å moved 2.40 Å*.

**Make site figure** then turns the comparison into a finished two-panel figure in one press — an
overview of the superposed models with the site marked, and a close-up with the side chains, a label per
model and the wild type solid against the others faded — ticked, lettered and captioned in the figure
builder ready to download as PNG or SVG. With the models superposed it adds a third panel, the same
close-up coloured by Cα deviation from the reference so the reader sees how far each part of the site
moved, with the band scale as its legend; **Deviation panel** turns it off.

## Domain figures

Colour by annotated or PAE domains, then **Label domains** writes each domain's name on the
structure at its centroid in the domain colour, using the names from the legend. **Download
architecture PNG/SVG** draws the linear domain diagram — one row per chain, coloured boxes with
names and boundary residue numbers — which is also a composite-figure panel and an optional row
under the panels of the figure builder, so structure, legend and architecture bar come out of one
set of domain definitions.

## Figure builder

Save a view for each panel you want — an overview, the interface, a zoom — then under
Publish → *Figure builder* tick the views to include, order them, caption them and choose the
columns. **Download figure PNG** or **SVG** renders every panel from its own camera and colour
scheme at the same text size, with its legend and scale bar, and sizes the cells so the whole
figure is the output width you chose. The SVG keeps captions, labels and legends as text. **Save
template** stores the whole presentation — columns, captions, letters, legends, output width,
resolution, text size, format, legend position and scale bar — under a name in your browser, and
**Apply** puts it back on the next figure, so every figure of a paper matches; a template carries no
models, views, camera or colours, so it is safe to apply to another project.

## Publication checklist

The Publish tab lists what a journal or a reviewer would flag about the current figure — pixel
export with no physical size, low resolution, small text, colour-blind-unsafe chain colours, a
missing legend, a scale bar in perspective, unsuperposed models, no title — with one-click fixes.
The badge reads *ready* when nothing remains.

## Interface contact map

Compare → *Interface contact map*: choose two chains, a cutoff and whether any heavy atom or
only Cα counts, and the viewer draws every residue pair within the cutoff as a map, closer pairs
darker. Hover reads the pair, a click selects both residues and zooms to them, *Highlight
interface* colours the interface in 3D, and the map and the pair list download as a 300 dpi PNG
and a CSV. The methods text states the rule and the counts.

## Figure finishing

Appearance offers a silhouette **outline** (thin or bold) and **depth cueing** for figures
that stay legible at column width; both apply everywhere the scene is drawn. The composition
table can **fade** a chain into the background to spotlight the others. Publish has **journal
presets** (Nature, Science, Cell Press, PNAS, PLOS, eLife) that set width, resolution, text
size and font, and **one panel per model**, which renders the models of a run from one camera
into a lettered figure. **Edit labels** on the colour legend renames the legend's title and entries
as they should read on the figure ("N-lobe" for a PAE domain, the protein's name for an entity);
the names apply on screen, on every export and in the generated legend text, change nothing in the
data, and travel with the scene.

## Your work is kept

**Session files.** *Publish → Save session file* writes one ZIP with the models, confidence data,
alignment, annotations, domains, views and settings; *Open session file*, or dropping the ZIP on the
page, restores everything on any computer with no other files. Use it to stop and continue, to move
work between machines, or to hand a colleague the exact state behind a figure.


The open models, annotations, domains, views and settings autosave to the browser's own storage a
moment after every change; reopening the page offers to restore them. Nothing leaves the browser.
Scene JSON, reports and share links remain the way to keep or hand over work deliberately.

## Privacy and network use

Files you open are read by the browser and never leave the machine. The page makes network requests
in exactly two situations:

- On load, to fetch the pinned 3Dmol.js, JSZip, and numeric.js libraries from `cdnjs.cloudflare.com`.
  All three are integrity-pinned with SRI hashes, so a tampered or substituted file will not execute.
- When you use **Fetch** to download a structure by identifier, to `files.rcsb.org` or
  `alphafold.ebi.ac.uk`. That request sends only the identifier you typed.

**Predict** and **AlphaFold Server** are both ordinary links: each opens a separate site in a new tab
and sends nothing from this page with it. What that site then does with a sequence you type into it
is its own concern, not this page's — Predict's default alignment mode submits the sequence to the
public ColabFold MMseqs2 API (its single-sequence mode does not), and AlphaFold Server requires
signing in with a Google account and sends the sequence to Google under [AlphaFold Server's own
Terms of Service](https://alphafoldserver.com/terms-of-service), which restrict use to
non-commercial purposes.

A Content-Security-Policy header restricts the page to exactly those origins. If the libraries cannot
be reached, the viewer says so rather than failing silently.

If cdnjs cannot be reached, the same three files are requested from jsDelivr under the same integrity
hashes; no other host is ever contacted.

## Scientific-use notes

- pLDDT is a per-residue confidence measure. It does not by itself establish that a multimeric
  interface or the relative placement of chains is correct — read PAE and ipTM for that.
- Alignment is for visual comparison of related models. Sequence-aware mode globally aligns amino-acid
  sequences and reports its chain mapping, identity, aligned Cα count, and RMSD; inspect those values
  before interpreting an overlay, and report them alongside any RMSD you quote.
- Generated reports and exported images are presentation artefacts, not replacements for the original
  coordinate files, confidence JSON, PAE data, or experimental validation.
- Present predictions as predictions, and keep them distinct from experimentally determined structures.

## Validation

Every number the viewer reports is cross-checked against an independent implementation. `tests/reference.py`
computes, with Biopython and numpy, the mean Cα pLDDT, the Kabsch RMSD of each model onto the first,
per-residue Cα RMSF across the superposed models, radius of gyration, exact Cα extent and the residue
set within a cutoff of one chain; `tests/validate.mjs` drives the real viewer on the same files and
compares. On three AlphaFold 3 runs (an M13 virion tip, an MS2 maturation-protein–coat complex and a
phiX174 F–G complex) all 130 comparisons — including the interface contact map, the MSA statistics (weighted and unweighted conservation) and
buried surface area — agree within tolerance (rounding of the reference for distances; 5 % for
buried surface area, which two 92-point Shrake–Rupley samplings cannot match more closely).
[`VALIDATION.md`](VALIDATION.md) has the tables, what is and is not covered, and how to rerun the check on
your own run. The viewer also loads a five-model, 4 410-token assembly with 175 MB of confidence JSON per
model in under eight seconds and a fraction of a gigabyte of memory.

## Hosting it yourself

The application is one self-contained `index.html` with no build step, so any static host works.
For GitHub Pages: repository **Settings → Pages**, deploy from the `main` branch, root folder. The
`.nojekyll` file is already present so the site is served verbatim.

## Development

There is nothing to install, and nothing to build in order to *use* the viewer — open `index.html` and
reload the page. Edits, though, belong in `src/`: see [Building from source](#building-from-source).

A headless regression suite lives in [`tests/`](tests/):

```
cd tests && npm install && npm test
```

It drives the real viewer in Chromium and covers import, navigation, appearance, both alignment modes,
annotation, confidence export, the full publish path, and the generated report. Run it before changing
the alignment or export code. `tests/validate.mjs` cross-checks the analysis numbers on a real run against
`tests/reference.py` (Biopython); see [Validation](#validation).

The file is laid out as: design-system CSS variables and base styles, the viewer markup, viewer-specific
CSS, the main application script, and a small inline icon set and tooltip helper. The application
script is a single IIFE holding all viewer state (`structures`, `labelRecords`, `selectionRecords`,
`measurementRecords`, `savedViews`, `confidenceAssets`) and the functions that render from it.

Third-party libraries are pinned by exact version *and* SRI hash. When bumping one, update the
`integrity` attribute together with the URL — the authoritative hash is available from
`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri` — and confirm that the jsDelivr copy named in
the fallback block still has the same hash, or drop the fallback for that library.

## Publishing a figure

Publish → **Output: Print size** states the width (85 mm single column, 178 mm double column, or
custom), resolution (300 or 600 dpi) and text size in points. **Figure format** then saves it as
PNG or TIFF with the dpi in the file, as a PDF whose page is that physical size, or as JPEG or WebP
for slides; the PNG and TIFF carry the dpi in the file, the SVG keeps text as text in the chosen figure font, and a scale bar can be added. The
**Colour-blind-safe palette** (Okabe–Ito) covers chains and domains, and **Write figure legend**
drafts the legend including the colour bands, cut-offs, alignment statistics, print settings and a
rendering credit. See [`docs/USAGE.md`](docs/USAGE.md#publishing-a-figure) for the checklist.

## Building from source

`index.html` stays the shipped artefact: one self-contained HTML file, committed to the repository, that
needs no build step to open. It is *generated*, though, from the parts in [`src/`](src/), so that work can
happen in files small enough to read:

```
src/00-head.html      doctype, head, styles and markup, up to the main script's `(() => {`
src/js/00-preamble.js the start of the application IIFE
src/js/NN-<name>.js   one file per section of the IIFE, in order
src/99-tail.html      the closing `})();` and everything after it
```

Edits belong in `src/`, never in `index.html` directly. Then regenerate:

```
node scripts/build.mjs
```

The build is a plain concatenation of the parts in lexical order — no dependencies, no transform, no
reformatting — so the generated file is byte-identical to the sum of its sources. Commit `index.html`
along with the `src/` change.

To check that the two have not drifted apart:

```
node scripts/build.mjs --check
```

It exits non-zero and names the first differing line if `index.html` was edited directly or `src/` was
edited without rebuilding. CI runs this check on every change.

`scripts/split.mjs` is the one-off that produced `src/` from `index.html` in the first place. It is kept,
and is idempotent, so the split can be re-derived and audited rather than taken on trust.

## How to cite

Awuah, M. B. (2026). *Protein Structure Viewer* (version 2.10.0) [software].
https://github.com/mbaffour/protein-structure-viewer — each GitHub release is archived on Zenodo
with a DOI; cite the DOI of the release you used (this release: https://doi.org/10.5281/zenodo.22741488; all versions: https://doi.org/10.5281/zenodo.22741487). Metadata for reference managers is in
[`CITATION.cff`](CITATION.cff). Please also cite the rendering library: Rego, N. & Koes, D. (2015).
3Dmol.js: molecular visualization with WebGL. *Bioinformatics* 31(8), 1322–1324.
doi:10.1093/bioinformatics/btu829.

## License

MIT — see [`LICENSE`](LICENSE).

3Dmol.js, JSZip, and numeric.js are loaded at runtime under their own licences. The bundled icon set
is from [Lucide](https://lucide.dev) (ISC).
