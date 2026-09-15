# Usage guide

A task-oriented walkthrough of the viewer. For an overview see the [README](../README.md); for the
interpretation caveats see [`SCIENTIFIC-AUDIT.md`](../SCIENTIFIC-AUDIT.md).


## Contents

- [Layout](#layout)
- [Composite figure](#composite-figure)
- [Publication checklist](#publication-checklist)
- [Figure finishing](#figure-finishing)
- [Interface contact map](#interface-contact-map)
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
- [Validation](#validation)
- [Troubleshooting](#troubleshooting)

## Layout

**Workspace (default on screens 1100 px and wider).** The tool tabs — Models, Appearance, Annotate,
Compare, Confidence, Publish — sit in a panel on the left that scrolls on its own; the 3D view, the
status line and the sequence strip stay pinned beside it on the right. The arrows button in the header
swaps the two sides, and the choice is remembered. The stage
grows to fill the window height, so a colour change, a label or an alignment is visible the
moment it is made. Drag the divider between the columns to give the panel more or less room
(tables inside it scroll sideways when it is narrow); double-click the divider, or press Enter
on it, to reset the width. The panel button in the header switches to the **stacked layout**,
the single column, and back; the choice is remembered on this browser. Full screen still
expands the 3D view alone. Screens narrower than 1100 px always use the stacked layout.

## Getting structures in

Files downloaded from the AlphaFold Database pair up on their names: drop `AF-P69905-F1-model_v6.cif`
together with `AF-P69905-F1-predicted_aligned_error_v6.json` and the PAE is attached, exactly as when
you fetch the accession.

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
| <kbd>X</kbd> / <kbd>Y</kbd> / <kbd>Z</kbd> | Rotate 90° about that axis (<kbd>Shift</kbd> reverses) |
| <kbd>Shift</kbd> + <kbd>R</kbd> | Reset orientation to the file's coordinate frame |
| <kbd>1</kbd>–<kbd>6</kbd> | Jump to Models / Appearance / Annotate / Compare / Confidence / Publish |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo the last label, selection, measurement or annotation change (add <kbd>Shift</kbd> to redo) |
| <kbd>?</kbd> | Open in-app help |
| <kbd>Esc</kbd> | Close help, leave full screen, or stop measuring or drawing |

Shortcuts are suppressed while you are typing in a field.

## Orientation

The toolbar's **↻ X**, **↻ Y** and **↻ Z** buttons (and the <kbd>X</kbd>, <kbd>Y</kbd>, <kbd>Z</kbd>
keys) rotate the view by exactly 90° about that axis; hold <kbd>Shift</kbd> to go the other way.
**Reset** (<kbd>Shift</kbd>+<kbd>R</kbd>) returns to the orientation of the coordinate file. With the
synchronized multi-view on, every panel turns together. This is how to make a front, side and top
panel of the same model that line up exactly.

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

**Display names.** **Rename** on a model row sets the name that badges, captions, the confidence
table, annotation names, and the report show. The file name stays underneath as the identifier that
scene manifests and saved views match on, so renaming never breaks a restore. Clear the field to go
back to the file name.

**Composition of the current model** lists each chain with its residue count, residue range, mean
pLDDT and colour swatch, and a **Shown** switch. Unticking a chain hides it everywhere — viewer,
synchronized panels, PNG and SVG exports, the surface — while the sequence strip keeps the row, dimmed
and marked *hidden*, so you still see what is missing. **Show all chains** restores them. The line
underneath counts ligands and ions by residue name (HEM ×4, ZN ×2 …); water is never counted. Hidden
chains are stored in scene JSON, carried by share links, and respected by the report.

Under the table, a line gives the **stoichiometry** (entities by identical sequence with their chains
and lengths) and the **Cα extent** (the exact maximum Cα–Cα distance, or a lower bound marked ≥ above 6 000 residues) and **radius of gyration**, both in
nanometres, so a capsid diameter or a filament length is read off directly.

**Download FASTA** writes the sequences of the displayed models, one record per chain. Headers carry
the model's display name, chain, length and — for models with pLDDT — the chain's mean pLDDT.
Standard amino acids and nucleotides get their single-letter codes; anything else is X.

## Appearance tab

Representation (cartoon / sticks / spheres / lines), colour scheme, projection, background, and
motion.

**Presets** at the top set several controls at once: **Thesis figure** (white background,
orthographic cartoon, legend on exports, 1800 × 1200 at 2×), **Dark slide** (dark background,
perspective, colour by chain) and **Confidence review** (pLDDT colouring with the legend, every residue
shown, ligands as sticks). Nothing is locked; adjust any control afterwards.

**Ligands and ions** decides how hetero groups are drawn — AlphaFold 3 ligands, cofactors, ions and
glycans, or the ligands in an experimental structure: sticks with small spheres (default), spheres
only, or hidden. Water is never drawn. Cartoon mode alone would hide all of them.

**Surface** adds a molecular surface — translucent or opaque — coloured by the current scheme, on top
of the representation. Combined with *Residue charge* or *Hydrophobicity* it gives the familiar
electrostatics-style view of a binding face without any external calculation (it is a property map,
not a Poisson–Boltzmann potential; say so in the legend). Hidden low-confidence residues and hetero
groups are left out of the surface. Panels and exports build the same surface. Models above forty
thousand atoms are skipped with a message, because the surface calculation would stall the page.

Notes on the colour schemes:

- **pLDDT** colouring uses the standard AlphaFold bands and reveals the legend under the viewport.
  It reads the B-factor column, so it is only meaningful for files that carry pLDDT there.
- **Per entity** gives every chain with the same sequence one colour, so a sixty-copy capsid shows
  its two or three distinct proteins; the legend names each entity with a Greek letter and its copy
  count, chains and length (α ×60 · A, B, … · 426 aa). The composition table carries the same line.
- **Per chain** colouring uses a fixed palette in sorted chain order, so chain A is the same colour in
  every model, every synchronized panel, the sequence strip, the exported legend, and the report. The
  legend under the viewport names each chain (up to twelve). In overlay mode with per-structure
  colouring the legend names the models instead.
- **Cα deviation after alignment** colours each residue by the distance between its Cα and the
  matched residue of the reference once you have used *Align visible* (Compare tab): under 1 Å blue,
  1–2 Å green, 2–4 Å yellow, 4–8 Å orange, 8 Å and above red; residues the alignment did not match
  are grey. The reference model shows its mean deviation across the aligned models. Before an
  alignment everything is grey and the status line says so.
- **Residue charge**, **Hydrophobicity (Kyte–Doolittle)**, **Residue type**, **Amino acid** and
  **Secondary structure** colour by what the residue is rather than by model or confidence. Charge:
  Lys and Arg blue, His light blue (partial), Asp, Glu and nucleotides red, everything else grey.
  Hydrophobicity runs from hydrophilic blue through white to hydrophobic orange on the Kyte–Doolittle
  scale. Residue type groups hydrophobic, aromatic, polar, positive, negative, Gly/Pro/Cys and
  nucleotides. Amino acid uses the RasMol colours. Secondary structure shows helix, strand and loop
  as assigned in the file or by the renderer. Each has a legend and colours the sequence strip too.
- **Model agreement (Cα RMSF)** colours each residue by how much its Cα position varies across the
  models you aligned with *Align visible* (Compare tab): under 0.5 Å blue, 0.5–1 Å green, 1–2 Å
  yellow, 2–4 Å orange, 4 Å and above red; residues present in only one model are grey. Where
  *Cα deviation* compares one model to a reference, this asks the whole run at once. **Download RMSF
  CSV** in the Compare tab writes the values per residue with the models used.
- **Low confidence** hides residues below pLDDT 50 or 70 — in the viewer, in every synchronized
  panel, and in every PNG and SVG export, so a figure without disordered tails takes one click. The
  sequence strip dims the hidden residues and its title says what is hidden. The setting is stored in
  scene JSON. It applies only to models that carry pLDDT.
- **Transparent** background is the right choice for figures that will be composited; PNG export
  preserves the alpha channel.

Appearance choices, export settings, and animation speeds are remembered in the browser between
sessions.

## Annotate tab

**Inspecting.** Click any atom to see its model, residue, chain, atom name, and pLDDT. Clicks pick
the nearest atom within a few pixels, so a click on a cartoon ribbon lands on the closest Cα.
Hovering shows the nearest residue in the status bar without clicking.

**Go to.** Type a residue in the *Go to* field — `B:45`, `45B`, or plain `45` for any chain — and
press **Go** or <kbd>Enter</kbd>. The residue is selected as if clicked (the label field fills in, and
a drawing or measurement in progress takes it as a point), the camera zooms to it, and the strip
marks it.

**Sequence strip.** Under the viewer, each chain of the displayed model is drawn as a row of residues
coloured by pLDDT (or by chain, when that colouring is on), with residue numbers along the bottom.
Hover to read a residue, **click** to select it — the label field fills in, ready for *Add or
update* — **drag** across a range to fill the model, chain, and range fields of *Selections*, and
**double-click** to zoom the camera to that residue. Labelled residues carry a small marker above
their cell and highlighted ranges are underlined in the highlight colour, so the strip doubles as an
index of your annotations. In **overlay** mode the strip shows one row per displayed model and chain,
active model first, so the pLDDT of competing predictions lines up residue by residue; one-at-a-time
and side-by-side views show the active model alone. Hovering the PAE heatmap in the Confidence tab
marks both residues of the pair on the strip in magenta. *Hide sequence* collapses it; the choice is
remembered. Very large sets show the first twenty-four rows.

**Sequence letters.** Open *Sequence letters* under the strip to read each chain's one-letter
sequence, fifty residues a line in blocks of ten with the first residue number of each line in the
gutter. Every letter is a chip in the current colour scheme, so charge, hydrophobicity or pLDDT can be
read residue by residue; hidden low-confidence residues are faded. Click a letter to select that
residue (the label field fills in), and **Copy** puts the chain's sequence on the clipboard. The strip
cells also print their letters when the window is wide enough for them. *Download FASTA* in the Models
tab writes the same sequences to a file.

**Undo and redo.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> undoes the last change to labels,
selections, measurements, or figure annotations — additions, removals, text or colour edits, nudges,
and clears — and <kbd>Shift</kbd> with it redoes. The Undo and Redo buttons beside the residue
readout do the same. Sixty steps are kept. Loading a scene or *Clear all* starts a fresh history.

**Labels.** With an atom selected, edit the suggested text and press **Add or update**. *Label every
residue* annotates all Cα atoms of the current model — useful for small structures, unreadable for
large ones.

**Selections.** Pick a model, optionally a chain, and a residue range (`20-45`, or `20,24,31`, or a
mix), then **Highlight** it in a chosen colour or **Hide** it. Leaving the chain blank applies the
range to every chain.

**Domains.** Name a region — for example *N-lobe*, chain blank for every chain or a chain ID for
one, residues `1-75` or `1-75,120-140`, a colour — and choose where it applies: **Every model from the
same source** (the models of one AlphaFold run, which share a sequence), **This model only**, or
**Every loaded model**. **Add domain** stores it; the list lets you rename, recolour, re-scope or
remove it, and every change can be undone. **Colour by annotated domains** switches the colour scheme
so the domains are painted in their colours and everything else is grey; the legend under the viewer
and on every export lists the domains by name, so a figure legend can point at "the N-lobe in blue"
and the picture agrees. Where two definitions overlap, the earlier one wins. **Adopt PAE domains**
takes the groups found under *Confidence → PAE domains* and turns them into named domains you can
edit. Domains are stored in scene JSON, travel in share links, and the shared report offers the same
colour scheme with a legend of names.

**Per-residue data.** Choose or paste a table with a residue column and a numeric value column —
a chain column is optional; header names such as `resi`, `residue`, `position`, `chain`, `value`,
`score` are recognised, and a header-less `resi,value` or `chain,resi,value` table works too. Give the
dataset a name, a colour scale (viridis for sequential values, blue–white–red centred on zero for
signed ones such as ΔΔG, white–red for densities), and a scope (this model, every model from the
same source, every model). **Colour by data** paints the values; the legend shows five steps of the
scale with their values; residues without a value are grey; the sequence strip follows. Datasets are
stored in scene JSON and share links. A CSV dropped together with the structures is read as
per-residue data when it is not an AlphaFold ranking file.

**Nearby residues.** Under *Selections*, **Near** highlights every residue of the current model with a
heavy atom within the cutoff (default 4.5 Å) of the **ligands and ions**, of **a chain** you name, or
of **the selected residue** (click one first). The result is an ordinary highlight selection in the
chosen colour, so it can be edited, undone, and it appears in exports and reports; **Copy residue
list** puts `A:HIS87, A:LEU91, …` on the clipboard for a methods section.

**Sequence motif.** Type a regular expression over one-letter codes and press **Highlight motif**:
`N[^P][ST]` finds N-glycosylation sequons, `RGD` an integrin-binding motif, `C.{2,4}C` a zinc knuckle,
`[KR]{4,}` a basic patch. Every match in every chain of the current model becomes a highlight selection
in the chosen colour, and the hits are listed by chain and position. Unknown residues are `X`.

**Measurements.** Choose distance (two atoms) or angle (three atoms), press **Start measuring**, and
click the atoms in the viewport. Values update as coordinates change — so aligning models updates
the distances between them. <kbd>Esc</kbd> leaves measurement mode.

**Figure annotations.** Pick a tool, press **Start drawing**, and click atoms in the main viewer:
an **arrow** or **line** joins two clicked atoms, a **residue marker** drops a translucent sphere on
one atom, and a **text callout** places your text on a leader line pointing away from the model.
Choose colour, size, dashed style, and optional label text before you click. A residue clicked on the
sequence strip or in the sequence letters counts as an atom click while drawing or measuring, so an
arrow between residue 16 and residue 112 needs no hunting in three dimensions. **Screen text** adds a
corner title (for panel letters or captions) that stays put while the model rotates. Annotations are
anchored to atoms, so they follow rotation and alignment, and they are drawn into publication and
comparison PNGs, comparison panels, and the shared report. Remove any one from the list, or clear
them all. <kbd>Esc</kbd> stops drawing.

Every annotation with text has arrow buttons in its row: they move the label in screen space — left,
right, up, down — and the offset is stored in model coordinates, so the label stays where you put it
when the model rotates. Callouts also take a leader length in Å. **Reset** puts a label back.

**pLDDT profile.** **pLDDT profile SVG** and **pLDDT profile PNG** (Confidence tab) plot per-residue
confidence for every displayed model that carries pLDDT — one panel per chain, one line per model in
the model's colour, the four confidence bands shaded behind, residue numbers along the axis, and a
legend of model names. The figure title comes from *Provenance*. The SVG is fully editable; the PNG is
rendered at twice the nominal size. Up to eight models and twelve chains are plotted.

**Ligand sites.** With a model that carries ligands or ions shown, choose a contact cutoff (default
4.5 Å) and press **Analyse ligand sites**. Each ligand or ion group gets a row: its atom count, the
residues with a heavy atom within the cutoff, the mean pLDDT of those residues and — when the PAE
matrix carries AlphaFold 3 ligand tokens — the mean predicted aligned error between the ligand's tokens
and the site's residues. **Highlight** adds the site as a selection in the interface colour; **Download
sites CSV** lists everything with the residue lists. Read the two numbers together: a site with high
pLDDT but high ligand–site PAE is a well-folded pocket with an uncertain pose.

**PAE domains.** With a model that carries a PAE matrix shown, choose a cutoff (4 Å strict, 6 Å,
8 Å loose) and press **Find domains**. Ten-residue segments along each chain are merged greedily —
the pair with the lowest mean PAE between them first — while that mean stays below the cutoff, so
groups that the prediction places rigidly relative to one another end up together, even across
chains or with gaps. A domain needs at least twenty residues; smaller leftovers join the nearest domain when they are
within twice the cutoff and are otherwise reported as unassigned. The panel, the hint and the figure
legend label the result a *heuristic*: it is a segmentation of the PAE matrix, it differs from the graph
clustering the AlphaFold Protein Structure Database uses, and it is not a curated domain assignment. The table gives each domain's
residue ranges per chain, its size, and the mean PAE within it; **Highlight** adds a selection for one
domain, **Highlight all** does so for every domain in the domain colours, and **Colour by domains**
switches the colour scheme (the legend lists the domains). AlphaFold 3 token ids are honoured, so
ligand tokens are skipped; for AlphaFold 2 and AlphaFold DB the tokens are matched to Cα atoms in
file order. This is a reading of the PAE matrix — which parts the model treats as one unit — not a
structural domain assignment, and it says nothing about whether that unit is placed correctly.

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


### Interface contact map

At the foot of the Compare tab. Choose two chains of the current model, a **cutoff** (default
4.5 Å) and whether **any heavy atom** or **Cα only** counts, then **Compute contacts**. Every
residue pair whose atoms come within the cutoff is a cell in the map — the first chain runs down
the side, the second along the top, and closer pairs are darker; faint lines mark every 10, 25,
50 or 100 residues depending on chain length. Hover a cell to read the pair and the closest-atom
distance; click a contact to select both residues and zoom to them. **Highlight interface** adds
two selections, one per chain, in the interface colour. **Download map PNG** writes the map with
axes, title and distance scale at 300 dpi; **Download contacts CSV** lists one row per pair with
the closest-atom distance. The definition is the same heavy-atom distance rule as *Nearby
residues*, which VALIDATION.md checks against Biopython, and the methods text states the rule and
the counts. A predicted interface is still a prediction: read the contact map alongside the
inter-chain PAE and the interface pTM before believing it.

## Confidence tab

The metrics table lists mean pLDDT, pTM, ipTM, ranking score, rank, and clash flag per model, and
exports to CSV along with the source archive and which files each number came from.

The PAE heatmap shows the active model's predicted aligned error, with chain boundaries drawn in and
per-token inspection on hover. Chain-pair ipTM and minimum PAE appear underneath when the confidence
file provides them. Both export to PNG.

Read these together with pLDDT rather than instead of it: pLDDT is local and per-residue, PAE and
ipTM are what speak to domain and chain placement.

**Interfaces.** Pick a model and a contact cutoff (3–6 Å, default 4) and press **Analyse
interfaces**. For every pair of chains in contact the table lists heavy-atom contacts, residue pairs,
interface residues on each chain, and buried surface area — the solvent-accessible area each chain
loses on forming the pair, by Shrake–Rupley with a 1.4 Å probe and 92 points per atom. **Highlight**
adds the interface residues of a pair as a coloured selection you can manage in the Annotate tab;
**Download interface CSV** exports the table with the residue lists. This is geometry of the model as
loaded — it says how the prediction is packed, not whether the interaction exists — so read it next
to the chain-pair ipTM and PAE above it.


### Colour by MSA

AlphaFold 3 archives include, under `msas/`, the unpaired multiple sequence alignment for each
entity as an `.a3m` file. The viewer keeps these when the archive is opened (an `.a3m` can also be
added on its own with *Add structures*), and **Colour by MSA** maps the alignment's per-column
statistic onto every chain whose sequence matches the alignment's query. Three statistics:
**conservation**, 1 − H/log₂20 where H is the Shannon entropy of the amino-acid distribution at the
column with gaps and X excluded (1 = one residue everywhere, 0 = uniform). By default the entropy uses
the position-based sequence weights of Henikoff & Henikoff (1994): at each column a sequence receives
1/(r·n), r being the number of residue types in the column and n the number of sequences sharing its
residue; a sequence's weight is the sum over the columns where it has a residue, scaled so the weights
average 1. A family represented by fifty near-identical sequences and one distant one then no longer
looks invariant wherever the fifty agree. The **Henikoff weights** switch turns this off and gives the
plain column entropy; the dataset name, legend, CSV and methods text record which was used, and both are
cross-validated in `VALIDATION.md`. Identity and coverage are never weighted; **identity to the
query**, the fraction of aligned sequences carrying the query residue; **coverage**, the number of
sequences with a residue at the column. The result is loaded as a per-residue dataset named for the
statistic, so it behaves like any pasted table: the viridis legend, the sequence strip, exports, the
shared report and the methods text all follow, **Download data CSV** writes it as `chain,resi,resn,value`, and
*Clear data* removes it. Lowercase letters in the
`.a3m` are insertions relative to the query and are dropped; sequences whose match-column length
differs from the query are skipped. Conservation reflects the alignment AlphaFold used, not a curated
family alignment, so read the coverage first: a column supported by eleven sequences says little.

## Publish tab

**Images.** **Output** chooses between **Print size** — a physical width (85 mm single column,
114 mm, 178 mm double column, or a custom width), an aspect ratio, a resolution of 300 or 600 dpi,
and a text size in points — and **Pixels**, a fixed size times a supersampling factor. In print mode
the estimate line gives the pixel dimensions and the physical size, the PNG carries its dpi in the
file (a `pHYs` chunk, which is what journal figure checkers read), and every residue label, callout,
measurement value, legend and caption is drawn so its text prints at the chosen point size. The
**figure font** (Arial/Helvetica by default, Times, or the system font) applies to all of them and to
SVG text. **Download publication TIFF** writes a baseline uncompressed RGBA TIFF with the resolution
set; it is large (about 4 bytes per pixel) but it is what some journals ask for. The PNG is rendered
off-screen at full resolution, independent of your window size. Very large requests are capped at roughly 24 megapixels
for browser stability, and the status line says when that happened.

Rendering is one long synchronous WebGL call, so the page stops responding while it runs — expect a
few seconds on a machine with a real GPU and considerably longer without one. A warning appears above
6 megapixels. If you only need a figure for a slide, 1× scale is four times faster than 2×.

**Copy PNG to clipboard** renders the same publication figure and places it on the clipboard, so a
figure goes into a slide or a manuscript draft without a file in between. Chrome and Edge support
image clipboard writes; Firefox and Safari may refuse, in which case the viewer says so and the
download remains.

**RMSF profile.** Once models are aligned, **RMSF profile SVG** and **RMSF profile PNG** plot the
per-residue Cα root-mean-square fluctuation across the aligned models — the quantity *Model agreement*
colouring paints — as one panel per chain: residue number along the bottom, RMSF in ångströms up the
side, the agreement bands as pale stripes behind the trace so the stretches the models agree on are
read at a glance, and the y-axis ceiling set just above the largest value. The SVG is editable text
and paths; the PNG is rendered at the output width and resolution. The same plot can be ticked into the
composite figure as the ensemble counterpart of the pLDDT profile.

**Pairwise RMSD matrix.** **Compute matrix** under *Pairwise RMSD* superposes every shown model onto
every other — up to twelve — with the same rules as *Align visible*: the residue mapping, the fit
region and positional chain matching if switched on. Nothing on screen moves; the fits are computed on
copies. The table tints each cell from white to red by RMSD; hovering a cell gives the number of Cα
pairs and the chain mapping that pair used. **Download matrix CSV** writes the values, the pair counts
and the settings; **Download matrix PNG** and **SVG** draw the heat map at the output resolution with
the values in the cells and a colour bar, and the same panel can be ticked into the composite figure.
The **Mean** column gives each model's mean RMSD to the others and ★ marks the **medoid**, the
model closest to all the rest — usually the one to show, and not necessarily the top-ranked one.
**Use medoid as reference** sets it as the alignment reference, superposes every shown model onto it,
and draws it solid with the others faded, in one press. The methods text gains a sentence stating
how the pairs were superposed, the range of values and which model is the medoid. Recompute after
aligning on a different region or changing the mapping; the state line says which settings the
current matrix used.

**Emphasising one model.** An overlay of several models drawn identically is a tangle. Each row of the
Models list carries a fade switch, and **Emphasise** fades every other shown model in one press: the
emphasised model keeps its colour and full ribbon while the others are mixed towards the paper and
drawn thin, so the figure reads as one subject against context. Pressing **Emphasise** again on a
model that is already the only solid one puts them all back. Fading is per model and independent of
the per-chain fading in the composition table, it dims the sequence strip as well, and it is carried
by scenes, session files, share links and the shared report.

**Assemblies of identical subunits.** When several chains share a sequence, every chain pairs equally
well with every copy, and the pairing falls back on the order the chains appear in each file. A prediction that puts the same
subunit in a different position is then measured against the wrong copy, and the RMSD says more about
the bookkeeping than about the models. **Match identical chains by position** fits once, re-pairs
chains of identical sequence by the distance between their centroids (nearest first, each chain used
once), and fits again, keeping the new pairing only when it brings the models closer. The mapping it
chose — `K→L; L→K` — is printed with each result and in the RMSD CSV, because the matching is greedy:
where subunits sit closer to each other than to their counterparts it can still choose badly, and you
should read the mapping before trusting the number. The switch is off by default, so numbers from
earlier versions are reproduced exactly.

**Fitting on a region.** By default **Align visible** computes the superposition from every residue
that matches between the models. **Fit on** changes that to a chain (`A`), a residue range
(`A:20-140`, or `20-140` across all chains), or **the selected residues** — whatever you have
highlighted in the Annotate tab. Only that region drives the rotation; the pairing, and therefore
what is measured, is unchanged. The results table then carries two numbers per model: **RMSD (Å)**
over every matched Cα, and **Fit RMSD (Å)** over the fitted region, with the region and its residue
count beside them. A small fitted RMSD next to a large overall one is the signature of a hinge or a
domain that has moved, and colouring by *Cα deviation* shows which residues they are. The RMSD CSV
and the methods text carry both numbers and the region. If fewer than three residues of the region
match between two models, that pair is fitted on everything and the table says so.

**Moving labels.** Every piece of text in the 3D view can be dragged with the mouse: residue labels,
callout and measurement text, and corner titles. Hover one and the pointer becomes a grab cursor while
the readout names the label; drag it where the figure needs it. The camera stays put during the drag,
and on a touchscreen a finger drag still rotates the model, so nothing is lost on a tablet. A residue
label that has moved keeps a thin leader line back to its residue in the label's colour — on screen and
in every export, the composite and built figures and the shared report — so a reader can still tell what
is being named. The move is kept as a model-space offset, which means it holds its place against the
structure as the camera turns rather than sliding across the screen, and it travels with scenes,
sessions and share links and is undone with ⌘Z. **Reset** in the label's row puts it back on its
residue; the arrow buttons in an annotation's row nudge its text by small steps for fine work.

**Comparing one position across models.** Two runs of the same protein — a wild type and a point
mutant — are the usual reason for loading two models of the same length. Select the residue in
question (click it, pick it from the sequence strip, or type it into **Go to**) and press **Compare
this position** in Annotate. In every shown model the viewer draws the side chain at that position as
sticks on top of the current representation, places a label naming *that model's* residue there —
`Ala15` in one, `Gly15` in the other, each in its model's colour — and writes a single line under the
button: `A:15 · Ala in all 3 models` when the models agree, or `A:15 · model_wt Arg → model_mut His ·
differs` when they do not, using the shortened model names. Compare a second position and both stay
marked. The sticks are part of the style, so the main view, each panel of a side-by-side comparison
and every export agree; **Side chains at compared positions** turns them off while keeping the
labels, and **Clear compared positions** removes only the labels and sticks the comparison placed,
leaving your own labels alone. The labels are ordinary residue labels — drag them, recolour them,
resize them, undo with ⌘Z — and the comparison travels with scenes, sessions and share links. The
generated figure legend names the position and what each model has there, and the methods text
records how the comparison was made. **Positions are matched by the alignment pairing when the models
are superposed, and by chain and residue number otherwise.** Once **Align visible** has run, the
selected residue is taken in the reference model and each other model contributes the residue the
superposition paired with it — the pairing that was actually fitted on, fit region and positional
chain matching included — so a construct that numbers the same residue differently is still compared
correctly, and the labels and the readout name the number each model carries (`Ala15` against
`Gly17`). Without an alignment the numbers are all there is to go on, and an insertion or a deletion
between two runs shifts them; the readout says `Align visible first to measure what moved`.

**What the substitution did to its surroundings.** After a superposition, the same press also measures
the local effect. **Neighbourhood (Å)** (3–12, default 5) defines the neighbourhood: every residue of
the reference model with any heavy atom that close to any heavy atom of the compared residue. The
table under the controls gives one row for the site (bold, marked *(site)*) and one for each
neighbour, with a column per other shown model holding that residue's Cα deviation from the reference
after the fit, the rows ordered by how far they moved and closed by a **Neighbourhood mean** row; the
readout adds `site moved 0.42 Å in model_mutant · 7 neighbours within 5 Å moved 0.31 Å on average`.
A substitution that only swaps a side chain leaves a table of near-zero deviations; one that shifts a
helix shows it residue by residue. **Highlight neighbourhood** puts the neighbours into the Selections
list as an ordinary orange highlight on the reference model — one row per chain, so it can be
recoloured, removed or undone — and **Download effect CSV** writes `chain,resi,resn,role` with
`role` reading `site` or `neighbour`, plus one deviation column per model. Change the cutoff and the
table is measured again; the value is remembered between sessions and travels in scenes and share
links. The figure legend gains the sentence *After superposition the Cα at A:15 moved 0.42 Å in
model_mutant, and the 7 residues within 5 Å moved 0.31 Å on average*, and the methods text states the
neighbourhood rule.

**Make site figure.** With a position compared, one press builds the whole figure. **Make site figure**
saves two panels: **Overview**, every shown model solid with the superposition in frame and the site
marked, and **Site A:15**, the camera on the compared residue in the reference model, backed off a
little so the neighbours stay in the panel, with the side chains drawn, each model's own residue
labelled, and the reference — the wild type — solid against every other shown model faded. It needs a
compared position and at least two shown models; it switches colouring to one colour per model and turns
**Side chains at compared positions** on. The close-up takes the comparison readout as its caption.
Both panels are ticked as the *only* two panels of the figure builder, in two columns with letters,
captions and a legend on each, and the Publish tab opens at the builder, so the next press is
**Download figure PNG** or **Download figure SVG**. The screen goes back to what it was — solid, never
left faded — the panels keep their own emphasis, and the whole press is a single ⌘Z. If several
positions are compared, the figure is built around the first of them; compare the next one on its own
and press again for its figure.

**Legend position.** The **Legend position** control in Publish decides where the colour legend is drawn
on exports: any of the four corners, or stacked as a column down the **left** or **right** side, which
is what a tall single-panel figure usually wants. It applies to the publication PNG and TIFF, the figure
SVG, each panel of a figure built from saved views, and the composite figure, and it is part of the
scene. Wherever the legend and the scale bar would meet, the bar is lifted clear; a legend too wide for
the figure is shrunk, to 55 % of the figure's text size at most.

**Domain labels and the architecture bar.** With domains defined (Annotate → Domains) or found
(Confidence → PAE domains), **Label domains** writes each domain's name on the structure: one residue
label at the Cα nearest the domain's centroid, in the domain colour, using the legend's names — so a
PAE domain renamed "N-lobe" under *Figure labels* is labelled "N-lobe". Which definition is used
follows the colour scheme: PAE domains when the structure is coloured by them, otherwise annotated
domains, otherwise PAE domains if any were found; the button under the PAE domains always uses those.
The labels are ordinary residue labels: edit their text or size in the label list, export them in PNG
and SVG, carry them in scenes and reports, undo them, and **Clear domain labels** removes only them
(rerun *Label domains* after renaming a domain to relabel). **Download architecture PNG** and **SVG**
draw the linear domain diagram at the output width and resolution: one row per chain, the sequence as a
thin line from its first to its last residue, a coloured box per contiguous domain run with the name
inside (or above when it does not fit), and residue numbers at the chain ends and at every domain
boundary. The same bar is offered as a panel of the composite figure (*Domain architecture*) and, with
**Domain architecture row under the panels** ticked in the figure builder, spans the bottom of the
built figure, reading the domains of the model on screen.

**Figure labels.** The colour legend carries an **Edit labels** button (also *Publish → Edit figure
labels*). It opens a table with the legend's title and each entry in the current colour scheme —
"PAE domains (heuristic)", "D1", "D2"; "Entity", "α ×2"; "Chain", "A" — and a text field beside each.
Type the name the figure should use: "N-lobe" for a domain, the protein's name for an entity, the
subunit for a chain. The legend under the viewport, every PNG, TIFF and SVG export, the composite and
comparison figures and the generated figure legend text ("legend: Lobes — N-lobe, D2") all use the new
names; renamed entries keep their residue ranges on screen, and nothing in the data changes. Blank
keeps the default. Labels are keyed by colour scheme and default entry, so a name given to "D1" in PAE
domain colouring does not touch the chain legend, and they are part of the scene: scenes, session files
and share links carry them, undo covers them, and **Reset labels** clears the current scheme's names.
Model names in the *Model* legend come from the display name set in the Models tab; annotated domains
are named where they are defined, in Annotate → Domains.

**Figure format.** One button saves the figure, and **Figure format** decides what it writes.
**PNG** and **TIFF** carry the resolution in the file, which is what a journal's figure checker reads.
**PDF** writes a single page whose box is the physical size you chose — 85 mm at 300 dpi becomes a
240.96 pt page — with the figure embedded as one image, deflated losslessly where the browser supports
it and JPEG-compressed where it does not; the text in a PDF is part of that image, so keep the SVG if
an editor may need to retype a label. **JPEG** and **WebP** are lossy and carry no resolution field:
they are for slides and email, and the publication checklist says so and offers PNG in one click. A
browser that cannot encode WebP saves a PNG instead and the status line tells you. **Download figure
SVG** is unchanged: raster molecule, vector labels, legend and scale bar.

**Comparison figure.** With the synchronized multi-view on, **Download comparison PNG** renders every
panel at the chosen size and stitches them into one lettered figure with each model's name and mean
pLDDT in a caption strip. The total is capped at roughly 24 megapixels, so six panels at a large
size come out smaller per panel than one. With *pLDDT legend on exports* ticked and confidence
colouring active, the four-band legend is drawn onto both kinds of PNG, and the comparison figure gets
a footer with the legend and your project title.

**Scale bar.** Choose 10, 20, 50 or 100 Å. The bar is measured along the screen's horizontal axis
at the model centre, shown bottom-right on screen, and drawn into PNG, TIFF and SVG exports with the
legend. In perspective projection the bar is exact only at the model's depth; use orthographic
projection for figures that carry one.

**Vector figures.** **Download figure SVG** and **Download comparison SVG** write the same figures with
the molecule as a raster image and everything drawn over it — residue labels, measurements, arrows,
callouts, markers, corner titles, panel letters, captions, legend — as SVG elements. Open the file in
Illustrator, Inkscape, or Affinity to restyle type, recolour arrows, or move a label without
re-rendering.

**Video.** Record a 5, 10, or 15 second WebM of the structure spinning. Chrome and Firefox support
this; Safari does not, and the viewer will say so.

**All views as a ZIP.** **Download all views (ZIP)** renders each saved view as a publication PNG
at the current output settings — print size, resolution, text size, legend, scale bar — named
`01-A-<view>.png` onward, together with `captions.txt` (title, captions, notes and the generated
figure legend). Large view sets take a while; the button counts progress.

**Saved views.** Save the current camera, model selection, colours, representation, and background
under a name and caption. Saved views can be reloaded, become the panels of the figure builder,
be exported as caption text, and be followed as a guided tour inside the shared report.

**Figure builder.** Saved views are the panels. The table under *Figure builder* lists every saved
view with an include switch, its panel letter, an editable caption and move up/down buttons; the
letters follow the order of the included views. Choose **Panel columns** (Auto picks a near-square
grid, or 1 to 4), the **Captions** style (name and caption, name only, caption only, none), and
whether each panel carries its **legend and scale bar**. **Download figure PNG** renders every
ticked view from its own camera, colour scheme, model selection and background at the same text
size, puts the letter and caption in a strip under each cell, and writes the resolution into the
file; **Download figure SVG** does the same with vector captions, labels, legends and scale bars.
The cells share the aspect ratio set under *Output* and are sized so the whole figure is exactly the
chosen figure width: a 178 mm double-column figure stays 178 mm whether it holds two panels or six,
and the estimate line gives the pixel size of the figure and of each panel before you render. The
builder options are part of the scene and which views are included travels with the saved views,
so a session file or share link reproduces the figure.

**Reports.** **Share report** builds a standalone HTML file with the coordinate data embedded —
including aligned positions if you superposed models, plus labels, measurements, and figure
annotations. Choose whether it carries the models currently shown or every loaded model; the
estimated size is shown before you build it. The report opens with no server and lets a reader show
one to six synchronized panels (it starts with the panels you had open), pick a model per panel, step
every panel forward and backward or cycle automatically, spin and fit them together, switch the
background and the colour scheme (including residue charge, hydrophobicity, residue type, amino acid
and secondary structure), show ligands as sticks or spheres or hide them, follow your guided views,
read pLDDT and PAE for the focused panel, and export a stitched lettered PNG or a composite video of
their own. Chains you hid stay hidden in the report. Under every panel a sequence strip shows the model's
residues in the panel's colour scheme, one row per chain, hidden chains dimmed: hover to read chain,
residue and pLDDT, click to zoom that panel to the residue.

Two controls govern size and portability. **PAE in report** keeps the heatmaps at full detail (up to
400 × 400), compacts them to 200 × 200, or omits them; the size estimate updates as you switch.
**Embed 3Dmol.js for offline use** inlines the rendering library — about 1.5 MB — after re-checking it
against the page's integrity hash, so the report opens with no network at all. Leave it off when the
recipient will be online and you want the smallest file.

**Provenance.** Fill in the figure title, model source, method and version, and notes. These travel
into the report header, the caption export, and the scene manifest.

**Figure legend.** **Write figure legend** drafts a legend from the scene: models shown,
representation, colour scheme with its bands written out, any low-confidence cut, ligand handling,
the alignment reference, method and per-model Cα RMSD, whether panels are synchronized, labelled
residues, highlighted ranges, measurements with their values, annotation text, and your provenance
notes. The text is copied to the clipboard and appears in an editable field. It is a draft in the
tool's words; edit it into yours.

**Methods text.** **Write methods text** drafts the paragraph a Methods section needs: how the
models were superposed (Kabsch least squares on Cα atoms, and whether the pairs came from chain and
residue identifiers or from sequence alignment), that RMSD is over all paired Cα atoms without outlier
rejection, how RMSF and Cα deviation are defined, the PAE-domain heuristic with its cutoff, the
contact and ligand-site cutoffs, how extent and radius of gyration are computed, the colour scale in
use, any hidden low-confidence residues and the export size — with the viewer and 3Dmol.js versions
and a pointer to the validation record. Only sentences that apply to the current scene are written.

**Session files.** **Save session file** writes one ZIP that carries the models themselves (their
coordinate text), every confidence matrix as binary floats, the current alignment, labels, selections,
measurements, annotations, named domains, per-residue data, saved views, provenance and every setting.
**Open session file** — or dropping the ZIP onto the page, or choosing it with *Add structures* —
restores all of it, on any computer, with no other files. It is the way to stop work and continue
later, to move between machines, or to give a colleague the exact state behind a figure. The file
name starts with the figure title when one is set. Compared with the two other ways of keeping work:
the browser autosave is automatic but stays on this machine and skips coordinates over 80 MB and PAE
matrices over 1 500 tokens; scene JSON is small and reproducible but expects the original files
alongside it.

**What the report carries.** Beyond models, coordinates after alignment, labels, selections,
measurements, callouts, named domains and per-residue data, the report reproduces the silhouette
outline and depth cueing you had on, draws faded chains the same way, and shows the interface
contact map beside the PAE heatmap when one was computed for a model that is in the report.

**Share links.** **Copy share link** builds a URL that reopens the current scene in the viewer:
the models that were fetched by identifier, plus the camera, representation, colours, projection,
background, synchronized panels, labels, selections, measurements, figure annotations, and title.
The scene is compressed into the URL fragment (the part after `#`), so nothing is sent to a server
and the link works wherever the viewer is hosted. Files you opened from disk cannot travel this way —
the recipient has no way to fetch them — so they are left out, and the status line says how many.
Saved views whose models were fetched by identifier travel in the link too, so the recipient can
follow your guided tour. Links are typically one
to three kilobytes; a scene with many annotations may run longer, and every modern browser accepts
fragments far larger than that.

## Publishing a figure

A checklist that fits most journals and theses:

1. **Set the view.** Fit, then rotate in 90° steps (X/Y/Z keys) so companion panels share an
   orientation; orthographic projection for anything with a scale bar or distances.
2. **Choose what the colours mean.** pLDDT for confidence, Cα deviation after *Align visible* for
   disagreement, chain or annotated domains for architecture, Okabe–Ito (*Appearance → Colour-blind-safe
   palette*) whenever chains or domains carry the message. Keep the legend on.
3. **Hide what distracts.** Low-confidence residues below 50 or 70, chains not under discussion, water
   (never shown), ligands as sticks or hidden.
4. **Annotate.** Residue labels, arrows, callouts, measurements; nudge labels into place; a corner
   title for the panel letter.
5. **Set the output.** *Print size*, 85 mm for a single column or 178 mm for a double, 300 dpi (600 for
   line-heavy figures), 7–8 pt text, Arial/Helvetica unless the journal says otherwise, scale bar if
   dimensions matter.
6. **Export.** PNG or TIFF for submission systems, SVG when a designer or Illustrator will finish the
   type. Comparison PNG/SVG for lettered multi-panel figures.
7. **Write the legend.** *Write figure legend* drafts it with the colour bands, cut-offs, alignment
   statistics, print settings and rendering credit; edit it into your voice.
8. **Keep the scene.** Download scene JSON next to the structure files so the figure can be rebuilt,
   and share a link or report with co-authors.

## How to cite

Awuah, M. B. (2026). *Protein Structure Viewer* (version 2.10.0) [software].
https://github.com/mbaffour/protein-structure-viewer. Each GitHub release is archived on Zenodo with
its own DOI; cite the DOI of the release you used, which the release page shows. Metadata for
reference managers is in `CITATION.cff` (GitHub shows a "Cite this repository" button from it). The
viewer renders with 3Dmol.js, which should be cited as well: Rego, N. & Koes, D. (2015). 3Dmol.js:
molecular visualization with WebGL. *Bioinformatics* 31(8), 1322–1324.
doi:10.1093/bioinformatics/btu829. *Help → How to cite* in the viewer has both.

## Your work is kept

A moment after every change, the open models (coordinates and confidence data), annotations,
domains, per-residue data, views and settings are saved in the browser's IndexedDB. Reopening the
page shows *Restore your last session?* with the model count and time; **Restore** rebuilds it,
**Not now** leaves it for later, **Forget it** deletes it. Sessions above 80 MB of coordinates are
not autosaved (the viewer says so once). The copy lives only in that browser profile; scene JSON,
reports and share links remain the deliberate ways to keep or hand over work.



**Label style (Annotate).** *Boxed* labels sit on a small card and read on any background;
*Plain text* drops the card and border for clean figures where the box would cover the model.
The choice applies to residue labels, measurements and callouts, is saved with scenes, and is
carried into the shared report.



## Composite figure

In the Publish tab, under the export buttons. **Download composite figure** renders one lettered
figure at the chosen print size and resolution: panel A is the 3D view as it stands (with the legend
and scale bar you have chosen), followed by the panels you tick — the **PAE heatmap** of the current
model, the **pLDDT profile** of the displayed models, and the **interface contact map** when one has
been computed in the Compare tab. Each panel is rendered fresh at output resolution, never scaled up
from the screen, and carries a caption; the file carries its resolution. Choose one, two or three
columns. Panels that are not available for the current model are greyed out with the reason in their
tooltip. The result is the confidence figure most AlphaFold papers need, assembled in one step; open
it in Illustrator or Inkscape for the final layout if the journal needs a different arrangement.

## Publication checklist

At the foot of the Publish tab. The viewer reads its own settings and lists, with a tick, a warning
or a note, what a journal's figure guide or a careful reviewer would raise: a pixel export that
carries no physical size; resolution below 300 dpi; text under 7 pt at the printed width; chain,
entity or domain colours that are not colour-blind safe; a colour scheme whose legend is switched
off; a scale bar in perspective projection, where its length depends on depth; several models shown
without superposition; a pLDDT cut that hides residues; a dark or custom background; many chains
without an outline; no figure title. Warnings have a one-click fix where one exists (use print size,
use Okabe–Ito, draw legend, switch to orthographic). The list refreshes as you change settings, and
the badge on the heading reads *ready* when no warning remains. It is a checklist, not a judge:
notes are suggestions, and a warning you have a reason to ignore can be ignored.

## Figure finishing

**Outline and depth cueing (Appearance).** *Outline* draws a silhouette line around every
element — thin for most figures, bold for small panels — so overlapping chains stay legible at
column width; the line is dark on light backgrounds and light on dark ones. *Depth cueing* fades
the parts farthest from the camera. Both are properties of the view rather than of a model:
they apply to the main view, every synchronized panel, every PNG, TIFF and SVG export, and
they are saved with scenes and sessions.

**Fading a chain (Models → Composition).** The *Faded* switch keeps a chain visible but blends
its colour most of the way into the background, which spotlights the other chains without
removing the context. Faded chains are drawn that way in panels and exports, are dimmed on the
sequence strip, and are saved with scenes. *Show all chains* clears hidden and faded chains
together. Spectrum and element colouring cannot be faded, because those colours are computed
inside the renderer.

**Journal presets (Publish).** Choosing a journal sets the print width, the resolution (300 dpi),
the text size and Arial from that journal's figure guide: Nature 89 / 183 mm, Science 55 / 121 /
184 mm, Cell Press 85 / 114 / 174 mm, PNAS 87 / 178 mm, PLOS 190 mm, eLife 85 / 170 mm. Guides
change; treat the preset as a starting point and check the current instructions before you
submit. Every setting can still be changed afterwards.

**One panel per model (Publish).** Renders every shown model — or, when one model is shown,
every model of the current run — from the camera of the main view into one lettered figure at
the chosen size, with the model name and mean pLDDT under each panel and the resolution written
into the PNG. This is the "five models, identically framed" figure that a reviewer asks for
first. Align the models first if you want superposed frames rather than the raw coordinates.

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
- `*_full_data_*.json` files are scanned byte by byte rather than parsed whole: the PAE matrix is
  copied into compact Float32 rows and the contact-probability matrix, which the viewer does not use,
  is skipped. A five-model, 4 410-token assembly (175 MB of confidence JSON per model) opens in about
  eight seconds and keeps the browser well under a gigabyte.
- Above 25 models in one archive, the `*_full_data_*.json` PAE payloads are skipped altogether. Drop the
  specific ones you need separately.
- PAE matrices above 1 500 tokens are not written to the session autosave; everything else is. Reopen
  the archive to get them back.
- The model list renders 60 rows at a time.

## Validation

The analysis numbers are cross-checked against an independent implementation. In `tests/`:

```
python3 reference.py <folder of one run> <chain> <cutoff>   # Biopython + numpy → <folder>/reference.json
node validate.mjs <folder> [archive.zip]                    # drives the viewer, compares, exits non-zero on disagreement
```

The folder holds a run's `*_model_*.cif`, `*_full_data_*.json` and `*_summary_confidences_*.json`
(unzip the archive and drop `msas/` and `templates/`). The reference script computes the mean Cα pLDDT
of every model, the Kabsch RMSD of each model onto model 0 with Cα atoms paired by chain and residue
id, the per-residue Cα RMSF across the superposed models, the radius of gyration and the exact maximum
Cα–Cα distance of model 0, and the residues with any heavy atom within `<cutoff>` Å of `<chain>`. The
validator loads the same files (or the archive, to exercise the ZIP path), runs *Align visible* in
identifier mode with model 0 as reference, reads the same quantities through the viewer's debug hook and
prints a table. Tolerances are 0.01 for pLDDT and 0.001 Å for distances; the residue set must match
exactly. `VALIDATION.md` at the repository root records the results on three real runs.

Not covered by the check: the sequence-aware pairing (a design choice, not a computed quantity —
inspect its reported chain mapping and identity), the PAE-domain heuristic (it is only checked to run
on real matrices without error), interface geometry and buried area, and anything drawn rather than
computed.

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
