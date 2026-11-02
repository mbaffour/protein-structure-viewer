  /* ---------- Batch export ---------- */

  async function downloadViewsZip() {
    if (!savedViews.length) { announce('Save a view first (Publish → Save current view)', 'error'); return; }
    if (typeof JSZip === 'undefined') { announce('The ZIP writer did not load. Refresh the page and try again.', 'error'); return; }
    let plan = exportDimensions(); const button = root.querySelector('#gpv-views-zip');
    const done = setBusy('Rendering views…'); button.disabled = true;
    const restore = captureViewState();
    /* Said last, after the on-screen view is put back: putting it back restyles the models, and the
       restyle's status line ('Ready') would otherwise replace what was written. */
    let outcome = null;
    try {
      const zip = new JSZip();
      for (let index = 0; index < savedViews.length; index += 1) {
        button.textContent = 'Rendering ' + (index + 1) + ' / ' + savedViews.length + '…'; await afterPaint();
        /* Apply the view first so the legend and scale bar describe that view, not the one on screen;
           restore straight after so side-by-side views do not stack up WebGL panel contexts. */
        applyViewState(savedViews[index], { panels: false });
        const rendered = await renderFittedFigure(plan); plan = rendered.plan; const uri = rendered.uri;
        applyViewState(restore, { panels: false });
        const letter = panelLetter(savedViews[index]);
        zip.file(String(index + 1).padStart(2, '0') + '-' + (letter === '—' ? '' : letter + '-') + String(savedViews[index].name || 'view').replace(/[^\w.-]+/g, '_') + '.png', await pngWithDpi(uri, plan.dpi));
      }
      const provenance = provenanceValues();
      zip.file('captions.txt', [provenance.title || 'Protein structure figure', provenance.source, provenance.method, '', ...panelCaptionLines(), '', provenance.notes, '', figureLegendText()].filter((line, index, array) => line || array[index - 1]).join('\n'));
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'application/zip', exportFileName('protein-views', plan, 'zip'));
      outcome = [savedViews.length + ' view' + (savedViews.length === 1 ? '' : 's') + ' exported · ' + formatBytes(blob.size) + ' · ' + plan.width + ' × ' + plan.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi' : '') + exportCapNote(plan)];
    } catch (error) {
      outcome = ['Could not export the views: ' + error.message, 'error'];
    } finally {
      releaseExportViewer(); applyViewState(restore, { panels: false }); done(); button.disabled = savedViews.length === 0; button.textContent = 'Download all views (ZIP)';
      if (outcome) announce(...outcome);
    }
  }
