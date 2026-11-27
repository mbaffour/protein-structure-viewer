# Backlog

Known defects, warts and design questions deferred from a stress round: what is wrong, where it lives, why it waits.

## Round 3 — Fixer J (loading, compare, annotate)

- **J3-2** · A nucleotide's pLDDT in the strip hint and on the residue card is still its P's, while Composition, the FASTA, the profile and the header now use C1′ (FA-15) · the hint and card read the picked atom, a per-atom display; changing them is a separate decision.

## Round 3 — Fixer I (publish, export, share)

- **The report's domain and data colours ignore insertion codes.** Domain records and per-residue data
  name residues by number, and the report looks them up by `chain|resi`, so a domain over 100 colours
  100A and 100B too. That matches the viewer's rule for records without codes (decision 5: a record
  without `icodes` takes every code of its number), so it waits for that rule to change.
- **A report of a model never drawn parses it once more.** `reportAtomNotes` (35) reads an unviewed
  archive model on the export surface to carry its insertion codes and polymer HETATM residues; a
  report of forty unviewed models parses forty files. Fine at today's sizes; measure if reports of
  large archives become slow.
