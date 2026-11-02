  /* ---------- Clipboard ---------- */

  /* Text the clipboard refuses goes into a read-only box of its own under the view, selected for
     Ctrl/⌘+C — never into a field the user types in, whose contents it would silently replace. */
  async function copyTextOrShow(text, copied, what) {
    try { await navigator.clipboard.writeText(text); announce(copied); return true; }
    catch (error) {
      const field = root.querySelector('#gpv-copy-fallback-text');
      field.value = text; root.querySelector('#gpv-copy-fallback').hidden = false;
      field.focus({ preventScroll: true }); field.select();
      announce('Clipboard unavailable — the ' + what + ' are selected in the box under the view; press Ctrl/⌘+C');
      return false;
    }
  }
  root.querySelector('#gpv-copy-fallback-close').addEventListener('click', () => { root.querySelector('#gpv-copy-fallback').hidden = true; root.querySelector('#gpv-copy-fallback-text').value = ''; });

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
      /* The download's path: inside the GPU's limit, rendered once more at the size the browser allowed
         if it shrank the canvas, and the status states what was rendered rather than what was asked. */
      const { plan, uri } = await renderFittedFigure(requested);
      const blob = await (await fetch(uri)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      announce('Figure copied to the clipboard · ' + plan.width + ' × ' + plan.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi (' + plan.mm + ' mm wide)' : '') + exportCapNote(plan));
    } catch (error) {
      announce('Could not copy the figure to the clipboard: ' + error.message, 'error');
    } finally {
      releaseExportViewer();
      done();
      button.disabled = structures.length === 0;
    }
  }

