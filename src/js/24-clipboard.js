  /* ---------- Clipboard ---------- */

  async function copyPublicationPng() {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined' || typeof navigator.clipboard.write !== 'function') {
      announce('This browser cannot put images on the clipboard — download the PNG instead', 'error');
      return;
    }
    const requested = exportDimensions();
    const button = root.querySelector('#gpv-copy-image');
    const done = setBusy('Rendering for the clipboard…');
    button.disabled = true;
    await afterPaint();
    try {
      const uri = await withLegend(await renderPublicationImage(null, requested), requested);
      const blob = await (await fetch(uri)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      announce('Figure copied to the clipboard · ' + requested.width + ' × ' + requested.height);
    } catch (error) {
      announce('Could not copy the figure to the clipboard: ' + error.message, 'error');
    } finally {
      releaseExportViewer();
      done();
      button.disabled = structures.length === 0;
    }
  }

