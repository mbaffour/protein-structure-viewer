  /* ---------- Figure legend ---------- */

  function compactRange(values) {
    const sorted = [...new Set(values.map(Number))].sort((a, b) => a - b);
    if (!sorted.length) return '';
    const parts = []; let start = sorted[0]; let previous = sorted[0];
    for (let index = 1; index <= sorted.length; index += 1) {
      const value = sorted[index];
      if (value === previous + 1) { previous = value; continue; }
      parts.push(start === previous ? String(start) : start + '–' + previous);
      start = value; previous = value;
    }
    return parts.join(', ');
  }

  function figureLegendText() {
    const shown = displayedEntries().filter(entry => entry.model);
    const provenance = provenanceValues();
    const mode = root.querySelector('#gpv-color-mode').value;
    let colourText = {
      structure: 'coloured per model' + (shown.length > 1 ? ' (' + shown.map(entry => displayName(entry) + ' ' + entry.color).join('; ') + ')' : ''),
      chain: 'coloured by chain',
      entity: 'coloured by entity — chains with identical sequences share a colour' + (shown[0] ? ' (' + entityGroups(shown[0]).map(group => group.label + ' ×' + group.chains.length).join(', ') + ')' : ''),
      plddt: 'coloured by per-residue pLDDT (very low <50 orange, low 50–70 yellow, confident 70–90 light blue, very high ≥90 dark blue)',
      agreement: 'coloured by per-residue Cα RMSF across ' + (ensembleSpread ? ensembleSpread.count + ' aligned models' : 'the aligned models') + ' (<0.5 Å blue, 0.5–1 Å green, 1–2 Å yellow, 2–4 Å orange, ≥4 Å red; residues present in one model grey)',
      deviation: 'coloured by Cα deviation from the reference after superposition (<1 Å blue, 1–2 Å green, 2–4 Å yellow, 4–8 Å orange, ≥8 Å red; unmatched residues grey)',
      spectrum: 'coloured as a sequence spectrum from the N- to the C-terminus',
      element: 'coloured by element',
      charge: 'coloured by residue charge at neutral pH (Lys and Arg blue, His light blue, Asp and Glu red, others grey)',
      hydrophobicity: 'coloured by Kyte–Doolittle hydrophobicity (hydrophilic blue through white to hydrophobic orange)',
      restype: 'coloured by residue type (hydrophobic amber, aromatic purple, polar green, positive blue, negative red, Gly/Pro/Cys grey)',
      amino: 'coloured by amino acid identity (RasMol colours)',
      ss: 'coloured by secondary structure (helix magenta, strand yellow, loop grey)',
      domain: 'coloured by PAE-derived domains' + (shown[0] && shown[0].domains && shown[0].domains.domains.length ? ' (' + shown[0].domains.domains.length + ' domains; ten-residue segments merged while the mean PAE between groups stayed below ' + shown[0].domains.cutoff + ' Å; grey residues unassigned)' : ' (none computed)'),
      data: residueData ? 'coloured by ' + residueData.name + ' (' + ({ viridis: 'viridis', diverging: 'blue–white–red diverging', heat: 'white–red' })[residueData.scale] + ' scale from ' + formatDataValue(dataRange().min) + ' to ' + formatDataValue(dataRange().max) + '; residues without a value grey)' : 'coloured by per-residue data (none loaded)',
      annotated: 'coloured by annotated domains (' + (domainRecords.length ? [...new Map(domainRecords.map(record => [record.name, record])).values()].map(record => record.name + ' ' + domainRecordRanges(record) + ' ' + record.color).join('; ') : 'none defined') + '; other residues grey)'
    }[mode] || 'coloured per model';
    const legend = legendItems('figure');
    if (figureLabelsCustomised(legend)) colourText += '; legend: ' + legend.title + ' — ' + legend.items.map(item => item[1]).join(', ');
    const surfaceChoice = root.querySelector('#gpv-surface').value;
    if (surfaceChoice !== 'none') colourText += ', with a ' + (surfaceChoice === 'translucent' ? 'translucent' : 'solid') + ' molecular surface in the same colours';
    if (mode === 'deviation' && !alignmentResults.length) colourText = 'shown in grey (Cα deviation colouring is selected but no alignment has been made)';
    if (mode === 'agreement' && !ensembleSpread) colourText = 'shown in grey (model agreement colouring is selected but no models have been aligned)';
    const representation = { cartoon: 'Cartoon representation', stick: 'Stick representation', sphere: 'Space-filling representation', line: 'Line representation' }[root.querySelector('#gpv-style').value] || 'Representation';
    const sentences = [];
    sentences.push((provenance.title ? provenance.title + '. ' : '') + representation + ' of ' + (shown.length ? shown.map(displayName).join(', ') : 'the model') + (provenance.method ? ' predicted with ' + provenance.method : '') + (provenance.source ? ' (' + provenance.source + ')' : '') + ', ' + colourText + '.');
    const cut = hideBelow();
    if (cut && shown.some(entry => entry.scores.length)) sentences.push('Residues with pLDDT below ' + cut + ' are not shown.');
    const hetero = root.querySelector('#gpv-hetero').value;
    if (hetero !== 'hide' && shown.some(entry => entry.atoms.some(atom => atom.hetflag && !isWater(atom)))) sentences.push('Ligands and ions are drawn as ' + (hetero === 'sphere' ? 'spheres' : 'sticks') + '; water is omitted.');
    if (alignmentResults.length) sentences.push('Models were superposed on ' + alignmentResults[0].reference + ' by ' + alignmentResults[0].method + (alignmentResults[0].fitRegion ? ', fitting on ' + alignmentResults[0].fitRegion : '') + ' (' + alignmentResults.map(result => result.name + ': ' + result.count + ' Cα pairs, RMSD ' + result.rmsd.toFixed(2) + ' Å' + (result.fitRegion ? '; fitted region ' + result.fitCount + ' Cα, RMSD ' + result.fitRmsd.toFixed(2) + ' Å' : '')).join('; ') + ').');
    if (root.querySelector('#gpv-side-by-side').checked && comparePanels.length) sentences.push('Panels share one orientation' + (root.querySelector('#gpv-sync-mode').value === 'full' ? ' and zoom' : '') + '.');
    const shownIds = new Set(shown.map(entry => entry.id));
    const labels = labelRecords.filter(label => shownIds.has(label.entryId));
    if (labels.length) sentences.push('Labelled residues: ' + labels.map(label => label.text).join(', ') + '.');
    const highlights = selectionRecords.filter(record => record.action === 'highlight' && shownIds.has(record.entryId));
    if (highlights.length) sentences.push('Highlighted residues: ' + highlights.map(record => (record.chain ? 'chain ' + record.chain + ' ' : '') + compactRange(record.residues)).join('; ') + '.');
    const measurements = measurementRecords.filter(record => record.points.every(point => shownIds.has(point.entryId)));
    if (measurements.length) sentences.push('Measurements: ' + measurements.map(record => record.points.map(point => (point.chain ? point.chain + ':' : '') + point.resi).join('–') + ' ' + measurementText(record)).join('; ') + '.');
    const annotations = annotationRecords.filter(record => record.text && record.points.every(point => shownIds.has(point.entryId)));
    if (annotations.length) sentences.push('Annotations: ' + annotations.map(record => record.text).join('; ') + '.');
    const plan = exportDimensions();
    if (plan.mm) sentences.push('Figure prepared at ' + plan.mm + ' mm width, ' + plan.dpi + ' dpi, ' + plan.points + ' pt labels.');
    if (provenance.notes) sentences.push(provenance.notes);
    sentences.push('Rendered with Protein Structure Viewer ' + viewerVersion + ' (3Dmol.js; Rego & Koes, 2015).');
    return sentences.join(' ');
  }

  async function writeFigureLegend() {
    const text = figureLegendText();
    const field = root.querySelector('#gpv-legend-text');
    field.value = text; field.hidden = false;
    try { await navigator.clipboard.writeText(text); announce('Figure legend written and copied to the clipboard'); }
    catch (error) { field.focus(); field.select(); announce('Figure legend written — copy it from the field'); }
  }

  /* A methods paragraph in the past tense, stating the definitions behind every number the
     viewer can show, so a paper's Methods section describes what was actually computed. */
  function methodsText() {
    const shown = displayedEntries().filter(entry => entry.model);
    const first = shown[0] || structures.find(entry => entry.model) || null;
    const mode = root.querySelector('#gpv-color-mode').value;
    const sentences = [];
    sentences.push('Predicted structures were inspected in Protein Structure Viewer ' + viewerVersion + ' (Awuah, 2026; github.com/mbaffour/protein-structure-viewer), a browser application built on 3Dmol.js 2.4.2 (Rego & Koes, 2015).');
    if (shown.some(entry => entry.scores.length)) sentences.push('Per-residue pLDDT was read from the B-factor column of the model files and mean pLDDT was calculated over Cα atoms' + (shown.some(entry => entry.confidence && entry.confidence.pae) ? '; predicted aligned error (PAE) matrices were read from the accompanying confidence files' : '') + '.');
    if (alignmentResults.length) {
      const bySequence = alignmentResults[0].method !== 'chain/residue IDs';
      sentences.push('Models were superposed on ' + alignmentResults[0].reference + ' by least-squares (Kabsch) fitting of Cα atoms paired by ' + (bySequence ? 'global Needleman–Wunsch alignment of each chain pair (match +2, mismatch −1, gap −2), chains being matched greedily by sequence identity' : 'chain and residue identifier') + (alignmentResults[0].fitRegion ? '; the rotation was computed from ' + alignmentResults[0].fitRegion + ' alone' : '') + '; RMSD is reported over all paired Cα atoms without outlier rejection' + (alignmentResults[0].fitRegion ? ', and separately over the fitted region' : '') + ' (' + alignmentResults.map(result => result.name + ': n = ' + result.count + ', ' + result.rmsd.toFixed(2) + ' Å').join('; ') + ').');
      sentences.push('Per-residue Cα deviation is the distance between paired Cα atoms after superposition.');
    }
    if (ensembleSpread) sentences.push('Model agreement was expressed per residue as the Cα root-mean-square fluctuation about the mean Cα position across the ' + ensembleSpread.count + ' superposed models, for residues present in at least two models.');
    if (contactResult && contactResult.pairs.size) { const target = entryById(contactResult.entryId); sentences.push('Inter-chain contacts between chains ' + (contactResult.chainA || '—') + ' and ' + (contactResult.chainB || '—') + (target ? ' of ' + displayName(target) : '') + ' were defined as residue pairs with ' + (contactResult.mode === 'ca' ? 'Cα atoms' : 'any pair of heavy atoms') + ' within ' + contactResult.cutoff + ' Å; ' + contactResult.pairs.size + ' residue pairs (' + contactResult.residuesA.length + ' residues on chain ' + (contactResult.chainA || '—') + ', ' + contactResult.residuesB.length + ' on chain ' + (contactResult.chainB || '—') + ') met the criterion.'); }
    if (residueData && residueData.msa && root.querySelector('#gpv-color-mode').value === 'data') sentences.push('Per-residue ' + (residueData.msa.metric === 'depth' ? 'alignment coverage (number of sequences with a residue at the column)' : residueData.msa.metric === 'identity' ? 'identity to the query (fraction of aligned sequences sharing the query residue)' : 'conservation, defined as 1 − H/log₂20 with H the Shannon entropy of the amino-acid distribution at the column (gaps excluded' + (residueData.msa.weighted ? '; sequences weighted with the position-based scheme of Henikoff & Henikoff, 1994' : '; sequences unweighted') + '),') + ' was computed from the unpaired multiple sequence alignment written by AlphaFold 3 (' + residueData.msa.sequences.join(' and ') + ' sequences) and mapped onto the chains whose sequence matches the query.');
    const domains = first && first.domains;
    if (domains && domains.domains.length) sentences.push('Domains were derived from the PAE matrix by greedy agglomeration of ten-residue segments: the pair with the lowest mean inter-segment PAE was merged while that mean stayed below ' + domains.cutoff + ' Å; groups of fewer than twenty residues were absorbed into the nearest domain when within twice the cutoff and otherwise left unassigned. This segmentation is a heuristic and differs from the graph clustering used by the AlphaFold Protein Structure Database.');
    if (nearbyResult && nearbyResult.residues) sentences.push('Contacting residues were defined as residues with any heavy atom within ' + nearbyResult.cutoff + ' Å of any heavy atom of the ' + (nearbyResult.mode === 'chain' ? 'target chain' : nearbyResult.mode === 'hetero' ? 'ligands and ions' : 'target residue') + ' (hydrogens and water excluded).');
    if (siteResults && siteResults.rows.length) sentences.push('Ligand-binding sites were defined as protein residues with any heavy atom within ' + siteResults.cutoff + ' Å of a ligand or ion heavy atom' + (siteResults.rows.some(row => row.pae !== null) ? '; ligand–site PAE is the mean of the symmetrised PAE between ligand tokens and site-residue tokens' : '') + '.');
    if (first) {
      const size = assemblyDimensions(first);
      if (size) sentences.push('Assembly size was summarised as the Cα extent (' + (size.exact ? 'the maximum Cα–Cα distance' : 'a two-pass lower-bound estimate of the maximum Cα–Cα distance, used above 6 000 residues') + ') and the radius of gyration over Cα atoms with equal weights.');
    }
    const colourNotes = {
      plddt: 'pLDDT colouring used the AlphaFold bands (<50 very low, 50–70 low, 70–90 confident, ≥90 very high).',
      charge: 'Residue charge colouring used formal charges at neutral pH (Lys and Arg positive; Asp and Glu negative; His shown as partially positive).',
      hydrophobicity: 'Hydrophobicity colouring used the Kyte–Doolittle scale.',
      entity: 'Chains were grouped into entities by identical sequence.',
      data: residueData ? 'Per-residue values (' + residueData.name + ') were mapped linearly onto a ' + ({ viridis: 'viridis', diverging: 'diverging blue–white–red', heat: 'white–red' })[residueData.scale] + ' scale between the minimum and maximum of the data.' : null
    };
    if (colourNotes[mode]) sentences.push(colourNotes[mode]);
    if (hideBelow()) sentences.push('Residues with pLDDT below ' + hideBelow() + ' were hidden from the figures.');
    const plan = exportDimensions();
    if (plan.mm) sentences.push('Figures were exported at ' + plan.mm + ' mm width and ' + plan.dpi + ' dpi' + (safePaletteOn ? ' using the Okabe–Ito colour-blind-safe palette' : '') + '.');
    sentences.push('Definitions and their cross-validation against Biopython are documented in the software repository (SCIENTIFIC-AUDIT.md, VALIDATION.md).');
    return sentences.join(' ');
  }

  async function writeMethodsText() {
    const text = methodsText();
    const field = root.querySelector('#gpv-methods-field');
    field.value = text; field.hidden = false;
    try { await navigator.clipboard.writeText(text); announce('Methods text written and copied to the clipboard'); }
    catch (error) { field.focus(); field.select(); announce('Methods text written — copy it from the field'); }
  }

