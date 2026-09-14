  /* ---------- Batch export ---------- */

  async function downloadViewsZip() {
    if (!savedViews.length) { announce('Save a view first (Publish → Save current view)', 'error'); return; }
    if (typeof JSZip === 'undefined') { announce('The ZIP writer did not load. Refresh the page and try again.', 'error'); return; }
    const plan = exportDimensions(); const button = root.querySelector('#gpv-views-zip');
    const done = setBusy('Rendering views…'); button.disabled = true;
    try {
      const zip = new JSZip();
      for (let index = 0; index < savedViews.length; index += 1) {
        button.textContent = 'Rendering ' + (index + 1) + ' / ' + savedViews.length + '…'; await afterPaint();
        const uri = await withLegend(await renderPublicationImage(savedViews[index], plan), plan);
        zip.file(String(index + 1).padStart(2, '0') + '-' + String.fromCharCode(65 + index) + '-' + String(savedViews[index].name || 'view').replace(/[^\w.-]+/g, '_') + '.png', await pngWithDpi(uri, plan.dpi));
      }
      const provenance = provenanceValues();
      zip.file('captions.txt', [provenance.title || 'Protein structure figure', provenance.source, provenance.method, '', ...savedViews.map((view, index) => String.fromCharCode(65 + index) + '. ' + view.name + (view.caption ? ': ' + view.caption : '')), '', provenance.notes, '', figureLegendText()].filter((line, index, array) => line || array[index - 1]).join('\n'));
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, 'application/zip', exportFileName('protein-views', plan, 'zip'));
      announce(savedViews.length + ' view' + (savedViews.length === 1 ? '' : 's') + ' exported · ' + formatBytes(blob.size) + (plan.dpi ? ' · ' + plan.dpi + ' dpi' : ''));
    } catch (error) {
      announce('Could not export the views: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done(); button.disabled = savedViews.length === 0; button.textContent = 'Download all views (ZIP)';
    }
  }

