# Backlog

Known defects and warts deferred from a stress round, one line each: ID, what is wrong, why it waits.

- **FA-5** · Entities are grouped by observed sequence, so copies of one entity with different disordered ends (1BRS: barnase ×3, barstar ×3) read as separate entities in Stoichiometry, entity colours and the entity legend · deferred to round 4: batch L's mmCIF reader (`03b`, `mmcifInsertionCodes`) is specific to the insertion-code column — it returns null without `pdbx_PDB_ins_code` and applies nothing when no code is set — so reading `label_entity_id` / `_entity_poly.pdbx_strand_id` needs that reader generalised, plus a ragged-end rule for PDB input.
- **J3-1** · The contact map's axis ticks write every residue whose number is a multiple of the step, so 100, 100A and 100B each print "100" · cosmetic, found while fixing FA-4; the pairs, readout and CSVs are right.
- **J3-2** · A nucleotide's pLDDT in the strip hint and on the residue card is still its P's, while Composition, the FASTA, the profile and the header now use C1′ (FA-15) · the hint and card read the picked atom, a per-atom display; changing them is a separate decision.
- **J3-3** · A ligand site's mean pLDDT averages whichever heavy atom of each site residue the search met first, not its Cα (or C1′) · identical for AlphaFold 2 (one value per residue) and off only for per-atom pLDDT; needs `residueConfidence` from the residue, not the atom found.
