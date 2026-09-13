# Protein Structure Viewer

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
3. Use the tool tabs underneath the viewport: **Models**, **Appearance**, **Annotate**,
   **Compare**, **Confidence**, **Publish**.

Press <kbd>?</kbd> in the viewer for keyboard shortcuts and inline help.

### What loads

| You drop | What happens |
| --- | --- |
| `.pdb`, `.cif`, `.mmcif` | Loaded as a model |
| AlphaFold result `.zip` | Every model is extracted and grouped under the archive name; template hits are ignored |
| `*_confidences.json`, `*_summary_confidences.json` | pTM, ipTM, ranking score, clash flag, and PAE are attached to matching models |
| `ranking_debug.json`, `ranking_scores.csv` | Ranks and ranking scores are attached to matching models |
| A scene JSON saved from the Publish tab | The whole annotated scene is restored once its structures are present |

Multi-model archives open one model at a time so the browser does not try to render hundreds of
predictions as a single overlay. Large archives load models lazily and skip their very large
`full_data` PAE payloads; those files can still be added individually when you need them.

## What it does

**Look at models.** Multiple structures at once with independent visibility, colour, and
ranking-score readout per model. Overlay mode or one-at-a-time mode, with previous/next controls,
arrow-key navigation, adjustable automatic cycling, and sorting by ranking score or mean pLDDT.
Source-archive filtering and name/stoichiometry search keep large prediction sets navigable, a
composition table lists each chain of the current model with a show/hide switch and counts its
ligands and ions, and the displayed models export as FASTA, one record per chain.
Cartoon, stick, sphere, and line representations, with an optional translucent or opaque molecular
surface; per-structure, per-chain, pLDDT, Cα-deviation, residue-charge, hydrophobicity, residue-type,
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
ligand, a chain, or a clicked residue. Click any atom to inspect its model, residue, chain, atom name, and pLDDT, or hover
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

## Your work is kept

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

A Content-Security-Policy header restricts the page to exactly those origins. If the libraries cannot
be reached, the viewer says so rather than failing silently.

## Scientific-use notes

- pLDDT is a per-residue confidence measure. It does not by itself establish that a multimeric
  interface or the relative placement of chains is correct — read PAE and ipTM for that.
- Alignment is for visual comparison of related models. Sequence-aware mode globally aligns amino-acid
  sequences and reports its chain mapping, identity, aligned Cα count, and RMSD; inspect those values
  before interpreting an overlay, and report them alongside any RMSD you quote.
- Generated reports and exported images are presentation artefacts, not replacements for the original
  coordinate files, confidence JSON, PAE data, or experimental validation.
- Present predictions as predictions, and keep them distinct from experimentally determined structures.

## Hosting it yourself

The application is one self-contained `index.html` with no build step, so any static host works.
For GitHub Pages: repository **Settings → Pages**, deploy from the `main` branch, root folder. The
`.nojekyll` file is already present so the site is served verbatim.

## Development

There is nothing to build or install — edit `index.html` and reload the page.

A headless regression suite lives in [`tests/`](tests/):

```
cd tests && npm install && npm test
```

It drives the real viewer in Chromium and covers import, navigation, appearance, both alignment modes,
annotation, confidence export, the full publish path, and the generated report. Run it before changing
the alignment or export code.

The file is laid out as: design-system CSS variables and base styles, the viewer markup, viewer-specific
CSS, the main application script, and a small inline icon set and tooltip helper. The application
script is a single IIFE holding all viewer state (`structures`, `labelRecords`, `selectionRecords`,
`measurementRecords`, `savedViews`, `confidenceAssets`) and the functions that render from it.

Third-party libraries are pinned by exact version *and* SRI hash. When bumping one, update the
`integrity` attribute together with the URL — the authoritative hash is available from
`https://api.cdnjs.com/libraries/<name>/<version>?fields=sri`.

## Publishing a figure

Publish → **Output: Print size** states the width (85 mm single column, 178 mm double column, or
custom), resolution (300 or 600 dpi) and text size in points; the PNG and TIFF carry the dpi in the
file, the SVG keeps text as text in the chosen figure font, and a scale bar can be added. The
**Colour-blind-safe palette** (Okabe–Ito) covers chains and domains, and **Write figure legend**
drafts the legend including the colour bands, cut-offs, alignment statistics, print settings and a
rendering credit. See [`docs/USAGE.md`](docs/USAGE.md#publishing-a-figure) for the checklist.

## How to cite

Awuah, M. B. (2026). *Protein Structure Viewer* (version 2.10.0) [software].
https://github.com/mbaffour/protein-structure-viewer — each GitHub release is archived on Zenodo
with a DOI; cite the DOI of the release you used. Metadata for reference managers is in
[`CITATION.cff`](CITATION.cff). Please also cite the rendering library: Rego, N. & Koes, D. (2015).
3Dmol.js: molecular visualization with WebGL. *Bioinformatics* 31(8), 1322–1324.
doi:10.1093/bioinformatics/btu829.

## License

MIT — see [`LICENSE`](LICENSE).

3Dmol.js, JSZip, and numeric.js are loaded at runtime under their own licences. The bundled icon set
is from [Lucide](https://lucide.dev) (ISC).
