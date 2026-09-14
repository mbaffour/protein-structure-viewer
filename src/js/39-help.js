  /* ---------- Help ---------- */

  function openHelp() {
    const dialog = root.querySelector('#gpv-help');
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

