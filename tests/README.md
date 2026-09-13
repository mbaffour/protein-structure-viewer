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
- Appearance: every representation, colour scheme, projection, background, motion;
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
- Compare: the Cα-deviation colour scheme shows its band legend.
- Confidence: the pLDDT profile SVG has one panel per chain and a trace per model; the PNG variant downloads;
  a block-diagonal PAE matrix loaded as `model_a.json` yields two domains (A:1–30 and B), the domain
  colour scheme lists them in the legend, and Highlight all adds two selections.
- Annotate: a named domain (residues 1–15, same-source scope) paints the sibling model's residue 5
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
- Generated report: colouring by annotated domains shows the domain legend; each panel carries a sequence strip whose hover names a residue and whose click zooms the panel;
  offers the residue colour themes and a ligand control; renders, carries provenance, **keeps its canvas inside `#view`**,
  guided views, navigation by real click, play/pause, element colouring, two panels that
  rotate together under a real drag
- Publish: copying the PNG to the clipboard reports an outcome; the figure legend names the models,
  representation and colouring.
- Share links: a model fetched by ID (served from a stubbed RCSB response) enables *Copy share
  link*; opening the link in a fresh page refetches the model and restores its corner text.

The two emphasised checks are regressions against bugs that shipped in 2.0.

## Notes

- Fixtures are synthetic (`fixtures.mjs`) — two-chain poly-alanine helices with
  pLDDT-like B-factors, generated from a seeded PRNG so runs are reproducible. No
  structure data is committed.
- Timings assume software rendering. A supersampled export takes roughly 18 seconds
  under SwiftShader and under a second on a real GPU, so the render-blocking assertion
  is skipped when nothing blocks for more than 300 ms.
- `vendor/` and `node_modules/` are generated; both are git-ignored.

The suite opens the page with `?debug=1`, which exposes `window.__viewerDebug` (the 3Dmol viewer, the
atom picker and the displayed entries). Setting `PSV_DIAG=/path/to/screenshot.png` makes the suite save a
screenshot and print picking diagnostics at the start of the Annotate group.
