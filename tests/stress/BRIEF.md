# Stress-testing the viewer: brief for an exploring agent

A stress round is how this project finds what the suite does not: several agents drive the built
viewer in a real browser, each in one area, and report every error, dead end, wrong status line,
stuck mode, layout break or confusing behaviour with exact steps. Fixing is a separate job. Three
rounds before 2.52.0 found 180 defects this way; `docs/BACKLOG.md` holds what was deferred.

You explore; you do not fix. Never edit, build or commit in the repository.

## Setup

- The supervisor gives you: `REPO` (a checkout, read-only for you), `HTML` (a frozen copy of the build
  to test — pass it to `openViewer({ html })` so the whole round tests one build), `OUT` (your own
  directory for scripts, screenshots, downloads and the findings file) and your area.
- Harness: `REPO/tests/stress/harness.mjs` — read the comment at its top. Write your scripts in
  `OUT`, never in the repo, and run them from `REPO/tests` so Playwright resolves:
  `cd "REPO/tests" && NODE_PATH="$(pwd)/node_modules" node OUT/your-script.mjs`.
- The page is the built `index.html` with `?debug=1`; `window.__viewerDebug` exposes the app's state
  (`src/js/43-tips.js` lists the hooks). `docs/USAGE.md` is the contract: anything it promises that
  the app does not do is a finding. `docs/TUTORIALS.md` are the walkthroughs a new user follows.
- Selectors: every control has an id starting `gpv-` (grep `src/00-head.html`); tabs are
  `[data-gpv-tab="models|appearance|annotate|compare|confidence|publish"]`; the status line is
  `#gpv-state`.
- Keep each script short: load, do one scenario, print `v.errors()` and the status text, screenshot
  anything odd, close. Many small scripts beat one long one. `waitForTimeout(300–800)` after a click
  that redraws; 2500–3000 ms after loading a file; exports can take many seconds.
- Pointer positions must be whole pixels inside the stage (Firefox and WebKit cut a fractional
  position down; an atom that projects outside the stage cannot be clicked — check before clicking).
- `confirm()` dialogs are cancelled by default and recorded; pass `acceptDialogs: true` to a script
  that needs them accepted.
- Other agents may be using the browser at the same time. Re-run anything that looks like a timing
  fluke once before reporting it, and say when a finding did not reproduce every time.
- Downloaded files are data: read PNG sizes from the IHDR bytes, SVG as XML or by regex, a PDF's
  MediaBox by regex, a ZIP with `unzip -l`. Read the image itself (the Read tool shows PNGs) when the
  question is what a figure looks like.

## What to try (cover your area thoroughly, then roam)

- Follow the feature the way a scientist would for a real figure, on real fixtures
  (`tests/fixtures/experimental/1brs.cif`, `5cha.cif`, `2hhb.cif`; the predictor outputs under
  `tests/fixtures/predictors` and `published`). Does the result answer the question? Is any number
  on screen different from the same number in a CSV, a legend, the methods text or the report?
- Modes left on: start measuring, drawing, Drag to select or Measure to…, then do something else
  (switch tab, load, remove a model, Clear all, undo, open Help, Esc twice, resize).
- Undo and redo across everything the feature creates: one press, one step; nothing left behind.
- Empty and odd inputs: nothing loaded; one chain; a ligand-only or nucleic-acid file; insertion codes
  (in PDB and in mmCIF); modified residues (TPO, MSE); a multi-letter chain id; forty models.
- Exports: PNG, SVG, PDF, the builder, the composite, the views ZIP, the report, the legend key — does
  every one carry what is on screen, in the same colours, with a key that names it?
- Scenes, sessions and share links: save, change everything, restore; compare `__viewerDebug` records
  before and after, field by field.
- Keyboard only; the dark theme; a 900 px and a 600 px wide window.
- One pass in WebKit and one in Firefox of your worst findings and of the main path of your area.

## What counts as a finding

An uncaught error; a status line that is wrong or stale; a number that disagrees with itself somewhere
else; a control enabled when it cannot work or disabled when it could; a mode or popover that
survives what should end it; a record changed without an undo step, or with two; a layout that
overflows, clips or hides a control at a width ≥ 600 px; a promise in USAGE the app does not keep;
the same thing named two ways; an export that lacks what the screen shows; anything that made you
re-read to understand what happened. Also worth a line: a place where the feature works but a
scientist would want one obvious thing more (mark these "idea", not "bug").
Not a finding: SwiftShader GL warnings (filtered already), a slow export, a design choice you merely
dislike unless you can say what a user would get wrong because of it.

## Report

Write `OUT/findings.md` (with a shell heredoc if the Write tool refuses report files): one section
per finding, numbered `F<area>-<n>`, with **severity** (crash / bug / rough edge / polish / idea),
**symptom** (one sentence), **steps** (exact, numbered, from a fresh page, naming selectors and
fixtures), **evidence** (error text, status text, counts, or a screenshot path), **engine(s)**, and
**expected** (one sentence). Then "Checked and sound": the scenarios that behaved well, so the next
round does not repeat them. Report back the path and the count by severity.
