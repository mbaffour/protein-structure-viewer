# Backlog

Known defects, warts and design questions deferred from a stress round: what is wrong, where it lives, why it waits.

## Round 3 — Fixer J (loading, compare, annotate)

- **J3-4** · The sequence strip's pLDDT colour for a nucleotide still reads its P's pLDDT, while the strip hint, the card, Composition, the FASTA and the profile read C1′ (FA-15, J3-2) · found while fixing J3-2 in 2.53.0; the strip's colour function is shared with the view's per-atom colouring, so changing it is a separate decision.

## Round 3 — Fixer I (publish, export, share)

- **The report's domain and data colours ignore insertion codes.** Domain records and per-residue data
  name residues by number, and the report looks them up by `chain|resi`, so a domain over 100 colours
  100A and 100B too. That matches the viewer's rule for records without codes (decision 5: a record
  without `icodes` takes every code of its number), so it waits for that rule to change.
- **A report of a model never drawn parses it once more.** `reportAtomNotes` (35) reads an unviewed
  archive model on the export surface to carry its insertion codes and polymer HETATM residues; a
  report of forty unviewed models parses forty files. Fine at today's sizes; measure if reports of
  large archives become slow.
