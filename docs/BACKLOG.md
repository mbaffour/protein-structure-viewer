# Backlog

Warts and design questions found in the stress loop and left for a later round, each with where it
lives and why it waited.

## Round 3 — Fixer I (publish, export, share)

- **FC-13 · measurement lines in a PNG are hairlines — measured, fix in batch M.** On headless
  Chromium (SwiftShader, `ALIASED_LINE_WIDTH_RANGE` [1, 1]) the PNG's measurement line is 0.6 px wide at
  85 mm/300 dpi, 178 mm/300 dpi and 178 mm/600 dpi, where the SVG draws 5.56, 5.56 and 9.31 px. The
  helper is in 32 (`exportStrokeRadius`); the drawing is 03 (`drawMeasurements`, `drawLabels`' leader),
  so the cylinder lines are batch M, with the step "a measurement line in an exported PNG is as wide as
  in the SVG…" (5.59 px against 5.56 with them). Remove this entry when batch M lands.
- **FC-14 · the busy badge keeps one label.** `setBusy` (01) overwrites the label and never restores
  it, so a job started during an export leaves the badge naming that job. Since round 3 the export
  guard no longer reads the label (an explicit count in 40), so this is cosmetic; a label stack in
  `setBusy` would fix it.
- **The badge-label test in `exportRendering()` (40).** Kept for the exports that do not call
  `beginExport` yet (views ZIP 13, Copy image 24, Save session 12, batch M). Once they do, the label
  test can go.
- **PNG label leaders follow the interface theme.** A label with no colour of its own draws its leader
  in `leaderColor()` (03), the theme's muted foreground — light grey in the dark theme, on a white
  figure. The SVG draws it `#94a3b8` whatever the theme. Same family as FC-2; 03 is not area C.
- **A scale bar that does not fit could shrink instead of leaving.** Since round 3 the export says the
  bar was left out and which panel; falling back to the longest offered length that fits (10 or 20 Å)
  would keep a bar in the panel — a design choice, since the length then differs from panel to panel.
- **The report's domain and data colours ignore insertion codes.** Domain records and per-residue data
  name residues by number, and the report looks them up by `chain|resi`, so a domain over 100 colours
  100A and 100B too. That matches the viewer's rule for records without codes (decision 5: a record
  without `icodes` takes every code of its number), so it waits for that rule to change.
- **A report of a model never drawn parses it once more.** `reportAtomNotes` (35) reads an unviewed
  archive model on the export surface to carry its insertion codes and polymer HETATM residues; a
  report of forty unviewed models parses forty files. Fine at today's sizes; measure if reports of
  large archives become slow.
