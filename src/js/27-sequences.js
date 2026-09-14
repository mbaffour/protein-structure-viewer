  /* ---------- Sequences ---------- */

  const nucleotides = { DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', A: 'A', C: 'C', G: 'G', U: 'U', I: 'I' };
  function residueLetter(resn) {
    const code = String(resn || '').toUpperCase().trim();
    return aminoAcids[code] || nucleotides[code] || 'X';
  }

  function fastaText(entries) {
    const records = [];
    entries.forEach(entry => residueRows(entry).forEach(row => {
      const sequence = row.residues.map(atom => residueLetter(atom.resn)).join('');
      const confidence = entry.scores.length ? mean(row.residues.map(atom => Number(atom.b) || 0)) : null;
      const header = '>' + displayName(entry).replace(/\s+/g, '_') + (row.chain ? '|chain_' + row.chain : '') + ' length=' + sequence.length + (confidence === null ? '' : ' mean_pLDDT=' + confidence.toFixed(1));
      records.push(header + '\n' + (sequence.match(/.{1,60}/g) || ['']).join('\n'));
    }));
    return records.join('\n') + '\n';
  }

  function downloadFasta() {
    const entries = displayedEntries().filter(entry => entry.model);
    if (!entries.length) { announce('Show at least one model first', 'error'); return; }
    downloadBlob(fastaText(entries), 'text/plain', 'sequences.fasta');
    updateStatus('FASTA for ' + entries.length + ' model' + (entries.length === 1 ? '' : 's') + ' downloaded');
  }

