# Changelog

All notable changes to this project are recorded here.

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
