  /* ---------- Small UI helpers ---------- */

  function toast(message, kind = 'info') {
    const host = root.querySelector('#gpv-toasts');
    const item = document.createElement('div');
    item.className = 'gpv-toast' + (kind === 'error' ? ' is-error' : '');
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    item.textContent = message;
    host.append(item);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 280);
    }, kind === 'error' ? 6000 : 3200);
  }

  function announce(message, kind = 'info') {
    updateStatus(message);
    toast(message, kind);
  }

  function setBusy(label) {
    busyDepth += 1;
    const badge = root.querySelector('#gpv-busy');
    root.querySelector('#gpv-busy-label').textContent = label;
    badge.hidden = false;
    return () => {
      busyDepth = Math.max(0, busyDepth - 1);
      if (busyDepth === 0) badge.hidden = true;
    };
  }

  function setButtonText(button, text) {
    const last = button.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.nodeValue = text;
    else button.append(text);
  }

  function showImportErrors(messages) {
    const panel = root.querySelector('#gpv-import-errors');
    panel.hidden = messages.length === 0;
    panel.textContent = messages.length
      ? messages.slice(0, 3).join(' · ') + (messages.length > 3 ? ' · +' + (messages.length - 3) + ' more' : '')
      : '';
    if (messages.length) console.warn('Protein viewer notes:', messages);
  }

  function readJson(key, fallback) {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch (error) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* private mode */ }
  }

  function plddtColor(score) {
    if (score < 50) return '#ff7d45';
    if (score < 70) return '#ffdb13';
    if (score < 90) return '#65cbf3';
    return '#0053d6';
  }

  function modelScores(model) {
    const scores = [];
    model.selectedAtoms({}).forEach(atom => {
      const score = Number(atom.b);
      if (atom.atom === 'CA' && Number.isFinite(score)) scores.push(score);
    });
    return scores;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatMetric(value, digits = 3) {
    const number = finiteNumber(value);
    return number === null ? '—' : number.toFixed(digits);
  }

  /* PAE rows are plain arrays when a small file went through JSON.parse and Float32Array
     rows when a large one went through the byte scanner below; both index the same way. */
  const isMatrixRow = row => Array.isArray(row) || (row !== null && typeof row === 'object' && ArrayBuffer.isView(row));

  function matrixMaximum(matrix) {
    let maximum = 0;
    if (!Array.isArray(matrix)) return maximum;
    matrix.forEach(row => {
      if (!isMatrixRow(row)) return;
      if (Array.isArray(row)) { row.forEach(value => { const number = finiteNumber(value); if (number !== null) maximum = Math.max(maximum, number); }); return; }
      for (let index = 0; index < row.length; index += 1) { const value = row[index]; if (value === value && value > maximum) maximum = value; }
    });
    return maximum;
  }

