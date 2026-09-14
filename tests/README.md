# Regression tests

A headless-browser suite that drives the real viewer in Chromium. It exists because
the viewer is a single file with no unit-testable seams: the bugs worth catching here
are ones only a browser can show you — a leaked WebGL context, a canvas covering its
own toolbar, a click that never lands.

## Running

```
cd tests
npm install
npm test
```

`npm install` pulls Playwright; the first run downloads a Chromium build. `npm test`
runs `vendor.mjs` first, which downloads the three libraries `../index.html` pins and
**verifies each against the SRI hash in that file** before writing it to `vendor/`.
The suite then serves a copy of the viewer with the CDN tags rewritten to those local
copies, so the tests do not depend on CDN reachability and cannot silently run against
a substituted library.

Set `PSV_BROWSER=firefox` or `PSV_BROWSER=webkit` to run the same suite in another engine (Playwright's
WebKit is the closest headless stand-in for Safari; install them once with `npx playwright install
firefox webkit`). Set `PSV_HEADED=1` to watch the run in a visible browser. Set `PSV_CHROMIUM` to an existing
Chromium binary to skip Playwright's own download — useful in CI images that already ship one:

```
PSV_CHROMIUM=/opt/pw-browsers/chromium/chrome-linux/chrome npm test
```

## What it covers

- Boot: 3Dmol present, no error banner, inline icons rendered
- Import: three models load, mean pLDDT computed from Cα B-factors, search filters, a model takes a
  display name that the model picker adopts
- Navigation: previous/next, arrow keys, digit shortcuts for all six tabs
- Appearance: entity colouring groups the two identical chains (α ×2, 30 aa) and the composition line
  reports the Cα extent and radius of gyration, and the extent equals a brute-force maximum Cα–Cα distance; the Okabe–Ito switch recolours chain A to rgb(0, 114, 178) and back; every representation, colour scheme, projection, background, motion;
  pLDDT legend; theme cycling; preference persistence across a reload
- Compare: sequence-aware and identifier alignment, non-zero RMSD against a
  deliberately different model, CSV export, synchronised multi-view with a third panel that
  follows a real drag on the primary, restore
- Import: the composition table lists both chains, hides one on request (render changes, strip marks
  it) and restores it; FASTA export has one record per chain with length and mean pLDDT in the header.
- Appearance: the five residue colour themes apply and the charge legend names its classes; a
  translucent surface changes the render and clears; 90° rotation changes the render and Shift+R resets it; the ligand control and the
  Thesis preset apply; hiding residues below pLDDT 70 changes the render and is named in the strip title;
  colour by chain lists the chains in the on-screen legend.
- Compare: the Cα-deviation colour scheme shows its band legend; after alignment, model agreement paints
  residue 5 and the RMSF CSV has a row per residue.
- Confidence: the synthetic models report no ligand sites; the pLDDT profile SVG has one panel per chain and a trace per model; the PNG variant downloads;
  a block-diagonal PAE matrix loaded as `model_a.json` yields two domains (A:1–30 and B), the domain
  colour scheme lists them in the legend, and Highlight all adds two selections; an AlphaFold 3-style
  `full_data` file with a `contact_probs` matrix attaches its 60 × 60 PAE as Float32Array rows with the
  right values and maximum, and the heatmap draws.
- Annotate: the motif `A{5}` highlights 12 matches as one selection per chain, with no-match and
  invalid-pattern messages; a 30-row `resi,value` CSV colours residue 30 viridis-yellow and residue 1 viridis-purple with
  a legend stating the range; residues within 6 Å of chain B are highlighted and listable; a named domain (residues 1–15, same-source scope) paints the sibling model's residue 5
  in its colour and appears in the legend on both models; the sequence strip lists both chains, a click selects a residue, a drag fills the
  selection range, Go to `B:12` selects that residue, the sequence-letters panel lists both chains with sixty clickable letters and a
  Copy button, overlay mode gives one row per model and chain; undo and redo (keyboard and buttons) walk a label change back and forth;
  residue-range highlight, blank chain meaning every chain, rejection of an
  unparseable range, an arrow annotation from two real atom clicks plus a corner title, nudging a
  label right and up, label-every-residue
- Confidence: metrics table, CSV export, interface geometry on the active model with highlight and
  CSV export
- Publish: export reachability, the busy state painting before the render blocks,
  button re-enabling, contact sheet, **the main viewport surviving seven off-screen
  renders**, captions, size estimate, scene manifest round-trip with hash check, figure and
  comparison SVG exports, an offline report that embeds the library
- Interface: help via `?`, `?` not hijacked while typing, full screen, cycle button
  keeping its icon, invalid fetch identifier
- Generated report: colouring by per-residue data shows its legend; colouring by annotated domains shows the domain legend; each panel carries a sequence strip whose hover names a residue and whose click zooms the panel;
  offers the residue colour themes and a ligand control; renders, carries provenance, **keeps its canvas inside `#view`**,
  guided views, navigation by real click, play/pause, element colouring, two panels that
  rotate together under a real drag
- Publish: all saved views download as a ZIP with a captions file; print-size export at 85 mm / 300 dpi yields a 1004 × 669 PNG carrying a `pHYs` chunk of
  11811 px/m; the TIFF is a little-endian baseline TIFF of the same size at 300 dpi; a 20 Å scale bar
  appears on screen and in the SVG with the Arial font; the legend text ends with the rendering credit;
  copying the PNG to the clipboard reports an outcome; the figure legend names the models,
  representation and colouring; the methods text names the Kabsch superposition, the RMSD rule, the
  dimension definitions and the software versions.
- Report parity: a report made with outline, depth cueing, a faded chain and computed contacts carries all four; the
  contact panel is visible with the pair count, and stays so after the background switches.
- MSA: a synthetic .a3m colours both fixture chains; the varied column scores below the half-varied and the invariant
  one, coverage counts 9 and 7, and the methods text gains the alignment sentence. Switching the Henikoff weights off
  changes the varied column's value, keeps the ordering, and the dataset name, the debug hook and the methods text say
  "unweighted"; switching them back on puts "Henikoff & Henikoff, 1994" in the methods text.
- PAE domains: the panel state and the figure legend call the segmentation a heuristic.
- Figure builder: with six saved views, unticking three and moving one up gives panels A–C in the order View 1, View 3,
  View 2; at 178 mm, 300 dpi and three columns the estimate and the PNG are 2100 px wide with a dpi chunk, and the SVG
  carries three images, the letters, the edited caption and the panels in builder order.
- Figure labels: the legend's Edit button opens the Publish editor listing the title and both domains; renaming the title
  and D1 changes the on-screen legend (ranges kept), the scene settings, the generated legend text and the SVG export;
  Reset restores the defaults and empties the scene's labels.
- Composite figure: with contacts computed, the three-panel composite downloads at the 178 mm width (2102 px) with
  resolution metadata.
- Publication checklist: pixel export with chain colours yields at least two warnings; the two one-click fixes switch
  to print size and the Okabe–Ito palette and the warning count drops by two.
- Contact map: chains A and B of the fixture within 6 Å yield residue pairs, two interface selections, a CSV with one
  row per pair and a PNG with resolution metadata; the plain label style is a scene setting; the methods text names
  the contact rule.
- Figure finishing: outline and depth cueing switch on without errors and survive a scene round-trip; fading
  chain B lightens its colour and dims its strip row; a journal preset sets width, dpi, text size and font; the
  per-model figure downloads as a PNG three panels wide with resolution metadata.
- Layout: at 1280 px the tool panel sits on the left of the pinned stage; the arrows button moves it right and the
  side survives a reload; the panel and scrolls on its own; the divider resizes it;
  the header button switches to the stacked layout and the choice survives a reload; 900 px stacks.
- Session: reloading the page offers to restore the autosaved session; Restore brings back every model and label;
  a session file downloads as a ZIP with `session.json` and reopens every model, label and PAE matrix both through
  *Open session file* and when dropped as a structure file.
- AlphaFold DB entry: a real, committed download for human haemoglobin alpha (UniProt P69905,
  `fixtures/alphafold-db/`) loads from disk as a 142-residue, 1000+-atom entry with one pLDDT score
  per residue; fetching the same accession (routed to the same two files instead of the network)
  attaches the real 142×142 PAE matrix, and PAE domains, assembly dimensions, the confidence
  summary and pLDDT colouring all run against it.
- Share links: a model fetched by ID (served from a stubbed RCSB response) enables *Copy share
  link*; opening the link in a fresh page refetches the model and restores its corner text.

The two emphasised checks are regressions against bugs that shipped in 2.0.

## Cross-validation against Biopython

`reference.py` (Biopython + numpy) and `validate.mjs` check the viewer's analysis numbers on a real
AlphaFold 3 run — mean Cα pLDDT, Kabsch RMSD onto model 0, per-residue Cα RMSF, radius of gyration,
exact Cα extent and the residue set within a cutoff of a chain:

```
python3 reference.py /path/to/run K 6       # writes /path/to/run/reference.json
node validate.mjs /path/to/run              # or: node validate.mjs /path/to/run /path/to/run.zip
```

The folder holds the run's `*_model_*.cif` and `*_full_data_*.json` / `*_summary_confidences_*.json`.
Passing the archive as well loads through the ZIP path instead of individual files. The validator prints
a Markdown table, writes `validation.json` next to the reference and exits non-zero on any disagreement
(0.01 pLDDT, 0.001 Å, exact residue set). Results on three runs are in `../VALIDATION.md`. No run data
is committed; point the scripts at your own.

## Notes

- A step that fails only because Playwright timed out (a `TimeoutError`, or "Timeout … exceeded" in the message)
  is retried once and logged as `RETRY`; the summary counts these. Assertion failures are never retried, so a
  wrong answer still fails the run on the first attempt.
- An unhandled promise rejection (typically a `waitForEvent('download')` left behind by a click that timed out) is
  logged with the step it happened in and does not abort the run.
- The suite fronts the viewer tab after the generated-report group; a headed engine otherwise leaves the report
  tab in front and clicks on the viewer hang.

- Most fixtures are synthetic (`fixtures.mjs`) — two-chain poly-alanine helices with
  pLDDT-like B-factors, generated from a seeded PRNG so runs are reproducible. No
  synthetic structure data is committed. The one exception is
  `fixtures/alphafold-db/`, a real AlphaFold Protein Structure Database download
  (CC-BY-4.0, see its README) used by the "AlphaFold DB entry" group.
- Timings assume software rendering. A supersampled export takes roughly 18 seconds
  under SwiftShader and under a second on a real GPU, so the render-blocking assertion
  is skipped when nothing blocks for more than 300 ms.
- `vendor/` and `node_modules/` are generated; both are git-ignored.

The suite opens the page with `?debug=1`, which exposes `window.__viewerDebug` (the 3Dmol viewer, the
atom picker and the displayed entries). Setting `PSV_DIAG=/path/to/screenshot.png` makes the suite save a
screenshot and print picking diagnostics at the start of the Annotate group.


The validation harness (`reference.py` + `validate.mjs`) also compares the Compare tab's contact map with
Biopython: `python3 reference.py <folder> <chain> <cutoff> [chainA chainB]` chooses the second chain with the
most contacts when it is not given.

## Continuous integration

`.github/workflows/tests.yml` runs on every push and pull request to `main`. A `playwright` job runs this
suite as a matrix over the three engines (`chromium`, `firefox`, `webkit`) — each runs `npm ci` and
`npx playwright install --with-deps <engine>` in `tests/`, then `npm test` with `PSV_BROWSER` set to that
engine. The three engines run in parallel and independently (`fail-fast: false`), so one engine failing
does not cancel the others; a superseded run on the same branch or PR is cancelled automatically. A
separate `validate-scripts` job does a quick sanity check that `fixtures.mjs` imports cleanly and that
`reference.py` compiles, without installing Playwright or Biopython. To read a failure, open the failed
job's log: each regression step prints its own name followed by `FAIL` when it fails, and the run ends with
a summary — look for `failed steps: none` (success) versus a list of the failing step names, plus any
`console error` lines the suite captured from the page.
