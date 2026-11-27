# Backlog

Known defects, warts and design questions deferred from a stress round: what is wrong, where it lives, why it waits.

## Round 3 — Fixer J (loading, compare, annotate)

- **FA-5** · Entities are grouped by observed sequence, so copies of one entity with different disordered ends (1BRS: barnase ×3, barstar ×3) read as separate entities in Stoichiometry, entity colours and the entity legend · deferred to round 4: batch L's mmCIF reader (`03b`, `mmcifInsertionCodes`) is specific to the insertion-code column — it returns null without `pdbx_PDB_ins_code` and applies nothing when no code is set — so reading `label_entity_id` / `_entity_poly.pdbx_strand_id` needs that reader generalised, plus a ragged-end rule for PDB input.
- **J3-1** · The contact map's axis ticks write every residue whose number is a multiple of the step, so 100, 100A and 100B each print "100" · cosmetic, found while fixing FA-4; the pairs, readout and CSVs are right.
- **J3-2** · A nucleotide's pLDDT in the strip hint and on the residue card is still its P's, while Composition, the FASTA, the profile and the header now use C1′ (FA-15) · the hint and card read the picked atom, a per-atom display; changing them is a separate decision.
- **J3-3** · A ligand site's mean pLDDT averages whichever heavy atom of each site residue the search met first, not its Cα (or C1′) · identical for AlphaFold 2 (one value per residue) and off only for per-atom pLDDT; needs `residueConfidence` from the residue, not the atom found.

## Round 3 — Fixer I (publish, export, share)

- **FC-14 · the busy badge keeps one label.** `setBusy` (01) overwrites the label and never restores
  it, so a job started during an export leaves the badge naming that job. Since round 3 the export
  guard no longer reads the label (an explicit count in 40), so this is cosmetic; a label stack in
  `setBusy` would fix it.
- **The badge-label test in `exportRendering()` (40).** Kept for the exports that did not call
  `beginExport` (views ZIP 13, Copy image 24, Save session 12). Since batch M they do, so the label
  test can go once nothing else is found to rely on it.
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
