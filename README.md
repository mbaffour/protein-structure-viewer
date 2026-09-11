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
Source-archive filtering and name/stoichiometry search keep large prediction sets navigable.
Cartoon, stick, sphere, and line representations; per-structure, per-chain, pLDDT, sequence-spectrum,
and element colouring; perspective or orthographic projection; transparent, white, dark, or custom
backgrounds.

**Read the confidence.** Mean pLDDT from Cα B-factors with the standard AlphaFold legend.
Model-level pTM, ipTM, ranking score, rank, and clash flag, plus chain-pair ipTM and minimum PAE
when the data is there. Interactive PAE heatmaps with per-token inspection and PNG export, and a
downloadable confidence-metrics CSV.

**Compare.** Sequence-aware Cα alignment (global Needleman–Wunsch per chain pair, greedily matched)
or strict chain/residue-ID alignment, with per-model aligned-residue count, sequence identity, chain
mapping, and Cα RMSD, plus a CSV export and a one-click coordinate restore. Synchronized
multi-view of up to six models whose cameras follow each other — rotation only, so assemblies of
different size stay framed, or rotation and zoom for superposed models.

**Annotate.** Click any atom to inspect its model, residue, chain, atom name, and pLDDT. Add or edit
custom residue labels, or label every residue in the current model. Highlight or hide chain/residue
ranges, and add atom-to-atom distance or three-atom angle measurements. Draw figure annotations —
arrows, lines, residue markers, text callouts, and corner titles — that follow rotation and alignment
and appear in every export.

**Publish.** Fixed-size, supersampled PNG export, a stitched lettered comparison figure of every
synchronized panel, and 5-, 10-, or 15-second WebM spin-video export. Reusable named views with
captions, multi-panel contact-sheet export, and caption-text export.
Self-contained interactive HTML reports. Reproducible scene manifests carrying SHA-256 structure-file
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
their own. Labels, measurements, and figure annotations travel with it. Like the main viewer it
loads 3Dmol.js from a CDN when opened.

The Publish tab shows the estimated report size before you build it — embedding a few hundred models
produces a file that is slow to open, so narrow the selection when the report is for a reviewer.

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

## License

MIT — see [`LICENSE`](LICENSE).

3Dmol.js, JSZip, and numeric.js are loaded at runtime under their own licences. The bundled icon set
is from [Lucide](https://lucide.dev) (ISC).
