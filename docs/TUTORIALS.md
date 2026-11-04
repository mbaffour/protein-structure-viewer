# Tutorials

Six walkthroughs, start to finish, each ending in a file you can put in a paper, a thesis or a talk.

These are the *follow-along* companion to the other two documents. [`USE-CASES.md`](USE-CASES.md) shows
what the finished result looks like and gives you a link that opens the live viewer already in that
state; [`USAGE.md`](USAGE.md) is the reference — every control, what it computes, and the caveats. The
tutorials below do neither. They give you the keystrokes in order, say what you should see after each
one, and stop when the file is on disk. Where a step deserves more explanation than a walkthrough can
carry, there is a link into the usage guide instead of a paragraph.

Every tutorial can be followed with a public structure, so you can work through it before you have
your own data. Type the identifier into the box at the top of the page and press **Fetch**:

| Input | Where it comes from |
| --- | --- |
| `1ubq`, `5cha`, `2lzm` | RCSB PDB — the mmCIF for that entry |
| `P69905`, `P04637` | AlphaFold DB — the current model for that UniProt accession |
| `AF-P0DTC2-F1` | AlphaFold DB — that entry and fragment |

How controls are written. A bold name is a control in the tool panel or the header, spelled as the
viewer spells it, and bold is used for nothing else — so a bold name is always something you can go
and look for. An italic name is a control that appears in a row or on the residue card once there is
something to act on: a model's *Rename*, a chain's *Faded* switch, the card's *Measure to…*. Those
have no fixed place to point at, which is why they are written differently.

## Contents

1. [Your first figure](#1-your-first-figure)
2. [Wild type and mutant, side by side](#2-wild-type-and-mutant-side-by-side)
3. [An ensemble of models](#3-an-ensemble-of-models)
4. [Exporting cleanly](#4-exporting-cleanly)
5. [A figure someone else can rebuild](#5-a-figure-someone-else-can-rebuild)
6. [Measuring a catalytic triad](#6-measuring-a-catalytic-triad)

---

## 1. Your first figure

*One structure on screen, oriented, coloured, and out as a PNG at a journal's single-column width.*

You need nothing but the page. If you have a `.pdb` or `.cif` of your own, drop it anywhere on the
window and skip step 1. Otherwise fetch `1ubq` — ubiquitin, 76 residues, one chain, small enough that
every step below happens instantly.

1. Type `1ubq` into the box at the top and press **Fetch**. (The button on the empty stage, **Load an
   example (PDB 1ubq)**, does the same thing.)

   *You should see:* one row in the Models list, the structure in the viewport, and the status line
   under the view naming what was loaded.

2. Drag in the viewport to turn the structure until the feature you want to show faces you. Press
   **Fit** to recentre. Use **↻ X**, **↻ Y** and **↻ Z** for exact quarter turns — these are what make
   two panels of the same model line up — and **Reset** to go back to the orientation in the file.

   *You should see:* the view recentring on **Fit**, and each ↻ press turning the model by exactly 90°.

3. Open **Appearance**. Set **Colour scheme** to **Secondary structure**.

   *You should see:* helices, sheets and loops in different colours, and a colour key appearing at the
   corner of the view. That key is the legend that will be drawn on the export.

4. Still in **Appearance**: set **Background** to **White**, **Projection** to **Orthographic**, and
   **Outline** to **Thin**.

   *You should see:* a white stage, the slight perspective flare gone, and a dark silhouette line around
   the ribbon. Orthographic is not cosmetic — a scale bar and any distance you quote are only honest
   without perspective.

5. Open **Publish**. Leave **Output** on **Print size (mm at dpi)**. Set **Figure width** to
   **85 mm · single column**, **Resolution** to **300 dpi**, **Text size** to **8 pt**, and **Scale bar**
   to **20 Å**.

   *You should see:* the size estimate beside the controls changing to the pixel dimensions that width
   and resolution imply, and a scale bar appearing at the bottom right of the view.

6. Read the **Publication checklist** at the foot of the tab before you export. Anything it flags has a
   one-click fix beside it.

   *You should see:* the badge on the heading read *ready* once nothing is left flagged.

7. Export. Leave **Figure format** on **PNG** and press **Download figure PNG**.

The file is 85 mm wide at 300 dpi with the resolution written into it, so a submission system and a word
processor both place it at the right physical size without being told. [Tutorial 4](#4-exporting-cleanly)
is the long version of steps 5 to 7.

---

## 2. Wild type and mutant, side by side

*Two predictions of the same protein, superposed, with the substituted position compared and a
two-panel site figure out of one press.*

You need two structures of the same protein that differ at one position. For your own work those are
two prediction runs: drop both result archives (AlphaFold, ColabFold, Boltz or Chai-1 — see
[Getting structures in](USAGE.md#getting-structures-in)) and the models arrive grouped under their
archive names.

To follow along without them, use a pair of crystal structures of T4 lysozyme: `2lzm` is the wild type
and `1l90` is the L99A cavity mutant. Residue 99 of chain A is leucine in the first and alanine in the
second; everything else is the same protein. A share link cannot carry a prediction file, which is why
the public stand-in here is a pair of PDB entries.

1. Fetch `2lzm`, then `1l90`.

   *You should see:* two rows in the Models list. Use each row's *Rename* to call them "Wild type" and
   "L99A" — the names go into legends, panel captions and the figure builder, and the file names stay
   underneath as identifiers.

2. In **Models**, set **View mode** to **Overlay selected** and make sure both rows are ticked.

   *You should see:* both structures drawn at once, each in its own model colour.

3. Open **Compare**. Set **Alignment reference** to the wild type, leave **Residue mapping** on
   **Sequence-aware**, and press **Align visible**.

   *You should see:* the two structures snap together, and a row in the alignment table giving the Cα
   pairs used, the sequence identity, the chain mapping and the RMSD. Quote all four together, never the
   RMSD alone.

4. Open **Annotate**. Type `A:99` into **Go to** and press **Go**.

   *You should see:* the view centre on residue 99 and a small marker naming it on the view. **Go**
   selects the residue; it does not open the residue card, and it closes one that was already open,
   since the card would otherwise still name the residue you have just moved away from. Press
   <kbd>L</kbd>, or click the residue in the view, if you want the card's readout — the next step works
   off the selection either way.

5. Press **Compare this position**.

   *You should see:* the side chain drawn in every shown model, each labelled with that model's own
   residue (`Leu99`, `Ala99`), and a statement of whether the models agree. Because the models are
   aligned, the same press also builds the neighbourhood table: every residue with a heavy atom within
   **Neighbourhood (Å)** of the site, each row giving how far it moved from the reference.

6. Read the table. **Highlight neighbourhood** marks those residues on the structure, and **Download
   effect CSV** saves the table.

   *You should see:* the residues lining the cavity highlighted — the ones the substitution actually
   moved, as against the ones that merely sit nearby.

7. Turn on **Deviation panel**, then press **Make site figure**.

   *You should see:* three saved views appear and the Publish tab open at the **Figure builder** with
   those views ticked as the only panels: A, an overview of the superposed models with the site marked;
   B, a close-up with the side chains and each model's label, the reference solid and the rest faded;
   C, the same close-up coloured by how far each residue moved. ⌘Z (Ctrl+Z) takes the whole press back.

8. Export. Press **Download built figure PNG**, or **Download built figure SVG** if a designer
   will finish the type.

For a binding site rather than a single substitution, type a set into **Positions** — `A:20-30, A:45`,
or bare numbers and ranges, which use the chain of the selected residue — and press **Compare these
positions**. Up to 40 are compared in one press and one undo step, and the table then opens with a row
per site followed by the union of their neighbourhoods. Compare the set *before* the figure if you want
every site in panel B, but keep the number down: at print size a dozen labelled positions is more text
than a panel cell holds, and no automatic placement untangles that — see
[tutorial 4](#4-exporting-cleanly).

Turn on **Side chains at compared positions** if you want the side chains to stay drawn after you move
on, and see [Annotate tab](USAGE.md#annotate-tab) for what the agreement statement is actually
comparing.

---

## 3. An ensemble of models

*Five models of one prediction run: superpose them, find which agree, pick the one to show, and plot
where they disagree.*

You need several models of the same protein. The natural case is one prediction run — drop the
AlphaFold, ColabFold, Boltz or Chai-1 archive and all of its models load together with their ranks and
ranking scores. Without one, fetch four structures of human α-globin instead: `4hhb`, `1a3n`, `1hho` and
`P69905`, hiding every chain but A in the three crystal structures. That set, with its numbers, is
[use case 7](USE-CASES.md#7-compare-many-models).

1. Drop the archive. In **Models**, set **Model order** to **Ranking score** and **View mode** to
   **Overlay selected**.

   *You should see:* the models listed best first, all drawn at once. **Show all** and **Hide all** tick
   and untick them in one press.

2. Open **Compare**, pick any model as the **Alignment reference** and press **Align visible**.

   *You should see:* the models superposed and one table row per model.

3. Press **Compute matrix** under **Pairwise RMSD**.

   *You should see:* a square table of the Cα RMSD between every pair of shown models, a mean column, and
   a ★ against the medoid — the model whose mean distance to all the others is lowest. Nothing on screen
   moves; the matrix is computed, not applied.

4. Press **Use medoid as reference**. Once the matrix is in, the button names the model it found, so
   what you actually press reads "Use <that model> as reference".

   *You should see:* everything re-fitted onto the medoid, which is drawn solid while the rest fade. This
   is the honest answer to "which one do I show?" — the model that is most like the others, rather than
   the one that happened to rank first.

5. Open **Appearance** and set **Colour scheme** to **Model agreement (Cα RMSF)**.

   *You should see:* every model painted by how much the ensemble disagrees at that residue, with a band
   legend. Confident cores go one colour, the parts that move go another.

6. Back in **Compare**, press **RMSF profile SVG** (or **RMSF profile PNG**) for the same thing as a
   plot, one panel per chain, and **Download RMSF CSV** for the numbers.

   *You should see:* a per-residue trace with the agreement bands behind it — the ensemble counterpart of
   the pLDDT profile.

7. Export. In **Publish**, tick **RMSD matrix** and **RMSF profile** under **Composite figure**
   and press **Download composite figure**: one lettered figure with the 3D view, the matrix heat map and
   the profile, every panel rendered fresh at the output resolution. **Download matrix CSV** and
   **Download confidence CSV** give the underlying numbers for a supplementary table.

A high mean pLDDT across an ensemble does not mean the models agree; this is how you find out whether
they do. [Compare tab](USAGE.md#compare-tab) says exactly what the RMSD and RMSF are computed over.

---

## 4. Exporting cleanly

*Get a file out that is the physical size, resolution and text size the journal asked for — and that
still reads at that size.*

You need a scene you are happy with on screen. This tutorial is about the Publish tab alone, so any
structure will do.

### Print size, not pixels

**Output** has two modes and they are not interchangeable.

- **Print size (mm at dpi)** is the one to use. You state a physical width and a resolution; the viewer
  works out the pixels, writes the resolution into the file, and sizes every piece of text in *points at
  that width*. The figure then lands in a manuscript at the width you asked for.
- **Pixels (size × scale)** takes **Image size** and **Scale** and gives you exactly that many pixels and
  no physical size at all. A 2400 × 1600 PNG with no resolution is placed by whatever opens it. Use this
  for a slide or a web page; the **Publication checklist** flags it for anything else.

### What to set

For a single-column figure:

| Control | Set to |
| --- | --- |
| **Output** | **Print size (mm at dpi)** |
| **Figure width** | **85 mm · single column** |
| **Resolution** | **300 dpi** |
| **Text size** | **8 pt** |
| **Figure font** | **Arial / Helvetica** |

For a double-column figure, change **Figure width** to **178 mm · double column** and drop **Text size**
to **7 pt**; raise **Resolution** to **600 dpi** if the figure is line-heavy — a contact map, an RMSD
matrix, a domain architecture bar — and leave it at 300 for a rendered molecule, where 600 dpi mostly
buys file size.

**Journal preset** sets the width, resolution, text size and font together from a named journal's figure
guide (Nature 89 / 183 mm, Science 55 / 121 / 184 mm, Cell Press 85 / 114 / 174 mm, PNAS 87 / 178 mm,
PLOS 190 mm, eLife 85 / 170 mm). Guides change: treat it as a starting point and check the current
instructions. Change anything afterwards and the select returns to its unset state, because the figure
no longer follows that guide. A width no preset offers goes in **Figure width** → **Custom…** and
**Custom width (mm)**. **Aspect** sets the shape — **3 : 2** suits most single panels.

### Which format

| Format | When |
| --- | --- |
| **PNG** | The default. Carries the resolution in the file. Submission systems take it everywhere. |
| **TIFF** | Same raster image, for the journals that ask for TIFF by name. Larger files. |
| **PDF** | The page *is* the physical size you chose. Good for a thesis, and for anything placed in LaTeX. |
| **JPEG**, **WebP** | Lossy. For slides and the web, never for a figure under review. |
| **Download figure SVG** | Not in the format list — its own button. The molecule stays a raster layer; labels, arrows, callouts, captions and the legend come through as editable vector text, so a designer can restyle the type in Illustrator or Inkscape. |

**Copy PNG to clipboard** renders the same publication PNG straight onto the clipboard when the figure is
going into a slide.

### The scale bar and the legend

Set **Projection** to **Orthographic** in **Appearance** *before* you choose a **Scale bar**. In
perspective the bar's length depends on how far from the camera you measure it, so it is not a
measurement; the checklist flags it. Then pick a round length — **20 Å** reads well at single-column
width, **50 Å** or **100 Å** for an assembly.

**Colour legend on exports** draws the colour key on the figure, and **Legend position** puts it in any
corner or stacks it down either side — move it when it sits over the structure. **Edit figure labels**
renames what the legend *says* without touching the data: "N-lobe" instead of a PAE domain's `D1`, a
protein's name instead of a chain letter.

### The one thing that catches everyone

Label text prints about two and a half times larger relative to the structure than it looks on
screen. This is not a bug and it is not avoidable. At 178 mm, 300 dpi and 8 pt, a print export draws
label text at 2.78× the screen's text scale while the panel's geometry is only about 1.11× the stage —
so a label that sits neatly beside its residue in the viewport can cover the residue next to it on paper.

What follows from it:

- Judge label placement in the exported file, not in the viewport. Export, open the file, look, then
  come back and move things. The viewer resolves placement per panel at render time, in that panel's own
  projection and at the size that panel prints at, so the PNG and the SVG of one figure put every label
  on the same pixel — but it cannot resolve a pile that does not fit.
- **Separate labels** untangles overlapping text at the framing you are looking at, and never moves a
  label you placed by hand.
- If a close-up is still crowded, compare fewer positions in that panel or give the figure more panels.
  Twenty-two boxes of 8 pt text do not fit in a cell that holds six, and no automatic placement changes
  that.
- **Label style** → **Plain text** drops the box and border, which buys back a surprising amount of room.

### Making a paper's figures match

Once one figure is right, save the whole presentation under **Template name** → **Save template**: panel
columns, captions, panel letters, per-panel legends, the architecture row, the output mode with its
width, resolution and text size, the format, the legend switch and position, and the scale bar. Pick it
from **Saved templates** and press **Apply** for the next figure, and figures 2 and 3 of the paper are
drawn exactly like figure 1. A template holds no data — no views, models, cameras, colours or file
names — so one saved for an earlier project is safe to apply here.

Export. Press **Download figure PNG** (the button renames itself to the chosen format). Then open
the file and look at it at 100% before you do anything else.

More detail in [Publish tab](USAGE.md#publish-tab), [Figure finishing](USAGE.md#figure-finishing) and
[Publication checklist](USAGE.md#publication-checklist).

---

## 5. A figure someone else can rebuild

*Save the scene, the panels, the words and the provenance, so the figure can be made again — by a
reviewer, by a co-author, or by you in eighteen months.*

You need a finished scene. Any of the tutorials above leaves one.

1. Open **Publish** and fill in the provenance fields: **Figure or project title**, **Model source or
   run**, **Method and version** (for example `AlphaFold 3`), and **Notes**.

   *You should see:* nothing change on the view. These go into the scene JSON and become the header of
   the shared report.

2. Arrange the view for the first panel. Give it a **View name** and a **Caption**, then press **Save
   current view**. Repeat for each panel.

   *You should see:* a row per view in the saved-views list, each lettered. A saved view records the
   camera, the colour scheme, which models are shown and which chains are faded — so it rebuilds, it does
   not merely screenshot.

3. In the **Figure builder**, tick the views to include, order them, set **Panel columns** and
   **Captions**, and turn **Panel letters** on. Press **Download built figure PNG**.

   *You should see:* one lettered figure at the output width, each panel rendered from its own camera at
   the same text size. **Download all views (ZIP)** gives the panels as separate files and **Download
   captions** gives the caption text.

4. Press **Write figure legend**.

   *You should see:* a drafted legend naming the models, the colouring and its cut-offs, the alignment
   statistics, the labels, the measurements and the print settings. Edit it into your own voice — it is a
   draft of the facts, not a sentence to paste.

5. Press **Write methods text**.

   *You should see:* a Methods paragraph stating how each number on screen was computed — superposition,
   RMSD, RMSF, domains, contacts, dimensions, colour scales. Every definition in it is cross-checked
   against Biopython in [`VALIDATION.md`](../VALIDATION.md), so it is safe to quote.

6. Press **Download scene JSON** and keep it beside the structure files.

   *You should see:* a small file describing the scene without the coordinates: a SHA-256 hash of every
   structure file, the camera, model order and visibility, colours, labels, selections, measurements,
   saved views, alignment settings and your provenance notes. To rebuild, load the structure files first,
   then pick the JSON under **Restore scene JSON** (or drop it in with them). Hashes are rechecked on
   restore and the status line says so if a file no longer matches.

7. For a reader who has none of your files, press **Save session file** instead: one ZIP with the models
   themselves, so it reopens on any computer with nothing else. **Open session file** reads it back.

8. Export. Set **Report contents** to **Models currently shown**, **PAE in report** to
   **Compact**, tick **Embed 3Dmol.js for offline use**, and press **Share report**.

   *You should see:* one self-contained HTML file. It opens in any browser with no install, carries the
   coordinates, the confidence data, the labels and annotations, has its own controls and sequence
   strips, and uses your saved views as a guided tour. This is the thing to attach to a review.

   If every model came from a PDB or AlphaFold DB identifier, **Copy share link** does the same job in a
   URL — the models are refetched and the scene rebuilt. Files from your own computer are never put in a
   link.

How to cite. Cite the viewer and the rendering library it is built on. *Help → How to cite* has both,
with the version you are running filled in, and [How to cite](USAGE.md#how-to-cite) in the usage guide
has the full form. Each release is archived on Zenodo with its own DOI; cite the DOI of the release you
actually used, not the concept DOI.

---

## 6. Measuring a catalytic triad

*Pick a residue, read what is around it, measure the bonds that matter, and get the numbers and the
figure out together.*

You need a structure with a site worth measuring. Fetch `5cha` — bovine α-chymotrypsin at 1.67 Å,
whose catalytic triad is the example this project checks its own distances against. The triad spans two
chains of the same molecule: His57 and Asp102 on chain B, Ser195 on chain C.

1. Fetch `5cha`.

2. Open **Annotate**. Set **Within (Å)** to `5`, type `B:57` into **Go to** and press **Go**.

   *You should see:* the view centre on His57, with a marker naming it. **Go** selects a residue but
   does not open the residue card — it closes one, in fact, because the card names the residue it was
   opened at and the selection has just moved.

3. Press <kbd>L</kbd> to open the card at the selected residue. (Clicking His57 in the view does the
   same thing.)

   *You should see:* the card at the residue, giving the residue, chain, pLDDT or B-factor, secondary
   structure, and how many residues have an atom within 5 Å.

4. On the card, set the *Measure* choice to *closest atoms*, then press *Measure to…* and type `C:195`
   into **Go to**, pressing **Go**. (Pressing <kbd>M</kbd> arms the same thing from the keyboard, with
   no card open.)

   *You should see:* a measurement drawn between His57 NE2 and Ser195 OG reading 3.02 Å — the distance
   this structure's triad is published at. The choice of closest atoms rather than Cα–Cα is remembered.

5. Repeat from His57 to `B:102` — **Go to** `B:57`, <kbd>M</kbd>, then **Go to** `B:102`.

   *You should see:* 2.67 Å between Asp102 OD1 and His57 ND1. Two measurements now sit in **Annotate →
   Measurements**, a row each.

6. Click a measurement's value on the view.

   *You should see:* the editor open at it, headed with the atoms it joins. Type words before the value —
   `H-bond · 3.02 Å` — or press *Name the atoms* to fill the text with the atom names. Drag the text to
   move it; a leader line in the measurement's colour follows it back. *Show value* hides the number when
   the text says enough.

7. Open the card's *Contacts* list on His57.

   *You should see:* every residue within the cutoff, nearest first, with its closest atoms and the
   Cα–Cα distance. Hover a row to name it on the view, click it to measure it, or use *Measure all*,
   *Highlight* or *Copy*.

8. For a distance you want in a different register, **Measurement** → **Angle (3 atoms)** then **Start
   measuring** takes three clicked atoms instead of two.

9. Export. Press **Download measurements CSV** for one row per measurement — the type, each
   point's model, chain, residue number, residue name and atom, the value, its unit and the text — or
   **Copy measurements** for the same table as text. Then export the figure as in
   [tutorial 4](#4-exporting-cleanly): the measurement text, its colour and where you put it reach the
   PNG, TIFF, PDF and SVG, the shared report and the figure legend.

**Colour scheme** → **Distance from selected residue** paints the whole model by each residue's closest
heavy-atom distance to the one you have selected, which is the picture that goes with the numbers.

---

Every control in these tutorials is described in full in the [usage guide](USAGE.md). The numbers the
viewer computes are checked against Biopython, PDBePISA and published measurements in
[`VALIDATION.md`](../VALIDATION.md).
