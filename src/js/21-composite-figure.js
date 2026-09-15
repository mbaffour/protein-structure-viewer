  /* ---------- Composite figure ----------
     The 3D view and the confidence panels a paper puts beside it — PAE heatmap, pLDDT profile,
     contact map — stitched into one lettered figure at the chosen print size. Each panel is
     rendered fresh at output resolution; nothing is scaled up from the screen. */
  function compositeAvailability() {
    const entry = activeEntry();
    const shown = displayedEntries().filter(item => item.model);
    return {
      pae: Boolean(entry && entry.confidence && Array.isArray(entry.confidence.pae) && entry.confidence.pae.length),
      profile: shown.some(item => item.scores.length),
      contacts: Boolean(contactResult && entry && contactResult.entryId === entry.id && contactResult.pairs.size),
      architecture: Boolean(entry && architectureModel(entry)),
      matrix: Boolean(rmsdMatrix && rmsdMatrix.names.length >= 2),
      rmsf: Boolean(ensembleSpread && ensembleSpread.values.size)
    };
  }

  function renderCompositeControls() {
    const available = compositeAvailability();
    [['#gpv-composite-pae', available.pae], ['#gpv-composite-profile', available.profile], ['#gpv-composite-contacts', available.contacts], ['#gpv-composite-architecture', available.architecture], ['#gpv-composite-matrix', available.matrix], ['#gpv-composite-rmsf', available.rmsf]].forEach(([selector, ok]) => {
      const control = root.querySelector(selector); control.disabled = !ok; control.closest('label').title = ok ? '' : 'Not available for the current model';
    });
    root.querySelector('#gpv-composite').disabled = structures.length === 0;
  }

  function drawPaePanel(entry, size) {
    const matrix = entry.confidence.pae; const n = matrix.length;
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d'); const image = context.createImageData(size, size);
    const maximum = finiteNumber(entry.confidence.paeMaximum) || matrixMaximum(matrix);
    for (let y = 0; y < size; y += 1) {
      const row = matrix[Math.min(n - 1, Math.floor(y * n / size))] || [];
      for (let x = 0; x < size; x += 1) {
        const value = finiteNumber(row[Math.min(row.length - 1, Math.floor(x * row.length / size))]) || 0;
        const color = paeColor(value, maximum); const offset = (y * size + x) * 4;
        image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const chains = entry.confidence.tokenChainIds || [];
    context.strokeStyle = '#111827'; context.globalAlpha = 0.7; context.lineWidth = Math.max(1, size / 600);
    for (let index = 1; index < chains.length; index += 1) {
      if (chains[index] === chains[index - 1]) continue;
      const position = Math.round(index * size / n) + 0.5;
      context.beginPath(); context.moveTo(position, 0); context.lineTo(position, size); context.moveTo(0, position); context.lineTo(size, position); context.stroke();
    }
    context.globalAlpha = 1;
    return { canvas, caption: 'Predicted aligned error, ' + n + ' × ' + n + ' tokens, 0 (dark) to ' + maximum.toFixed(1) + ' Å' };
  }

  async function downloadCompositeFigure() {
    const entry = activeEntry(); if (!entry || !entry.model) { announce('Show a model first', 'error'); return; }
    const button = root.querySelector('#gpv-composite');
    const requested = exportDimensions();
    const available = compositeAvailability();
    const wanted = {
      pae: available.pae && root.querySelector('#gpv-composite-pae').checked,
      profile: available.profile && root.querySelector('#gpv-composite-profile').checked,
      contacts: available.contacts && root.querySelector('#gpv-composite-contacts').checked,
      architecture: available.architecture && root.querySelector('#gpv-composite-architecture').checked,
      matrix: available.matrix && root.querySelector('#gpv-composite-matrix').checked,
      rmsf: available.rmsf && root.querySelector('#gpv-composite-rmsf').checked
    };
    const columns = Math.max(1, Math.min(3, Number(root.querySelector('#gpv-composite-columns').value) || 2));
    const count = 1 + Object.values(wanted).filter(Boolean).length;
    const rows = Math.ceil(count / columns);
    const cell = Math.max(300, Math.floor(requested.width / columns));
    const cellHeight = Math.round(cell / (requested.width / requested.height));
    const captionHeight = Math.round(Math.max(28, cell * 0.08));
    const palette = figurePalette();
    const done = setBusy('Rendering composite…'); button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const panels = [];
      /* The panel is a fraction of the figure width, so text and legend scale down with it. */
      const panelPlan = { ...requested, width: cell, height: cellHeight, textScale: (requested.textScale || 1) * cell / requested.width };
      const uri = await withLegend(await renderPublicationImage(null, panelPlan), panelPlan);
      panels.push({ image: await loadImage(uri), caption: displayName(entry) + (root.querySelector('#gpv-color-mode').value !== 'structure' ? ', coloured by ' + root.querySelector('#gpv-color-mode').selectedOptions[0].textContent.toLowerCase() : '') });
      if (wanted.pae) { const pae = drawPaePanel(entry, Math.min(cell, cellHeight)); panels.push({ image: pae.canvas, caption: pae.caption }); }
      if (wanted.profile) {
        const profile = plddtProfileSvg();
        if (profile) { const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg)); panels.push({ image, caption: 'Per-residue pLDDT' + (displayedEntries().filter(item => item.scores.length).length > 1 ? ' of the displayed models' : ''), aspect: profile.width / profile.height }); }
      }
      if (wanted.contacts) { const canvas = document.createElement('canvas'); drawContactMap(canvas, true, Math.max(1, Math.round(cell / 600 * 2))); panels.push({ image: canvas, caption: 'Contacts between chains ' + (contactResult.chainA || '—') + ' and ' + (contactResult.chainB || '—') + ' within ' + contactResult.cutoff + ' Å' }); }
      if (wanted.rmsf) {
        const profile = rmsfProfileSvg();
        if (profile) { const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg)); panels.push({ image, caption: 'Per-residue Cα RMSF across ' + ensembleSpread.count + ' aligned models' }); }
      }
      if (wanted.matrix) {
        const scale = figureScale(panelPlan); const pad = Math.round(16 * scale); const side = Math.min(cell, cellHeight) - pad * 2;
        const canvasM = document.createElement('canvas'); const metrics = rmsdMatrixMetrics(side, scale); canvasM.width = metrics.width + pad * 2; canvasM.height = metrics.height + pad * 2;
        const contextM = canvasM.getContext('2d'); contextM.fillStyle = palette.paper; contextM.fillRect(0, 0, canvasM.width, canvasM.height);
        drawRmsdMatrix(contextM, pad, pad, side, scale, palette);
        panels.push({ image: canvasM, caption: 'Pairwise Cα RMSD between ' + rmsdMatrix.names.length + ' models' + (rmsdMatrix.fitRegion ? ', fitted on ' + rmsdMatrix.fitRegion : '') + (rmsdMatrix.byPosition ? ', identical chains matched by position' : '') });
      }
      if (wanted.architecture) {
        const model = architectureModel(entry); const scale = figureScale(panelPlan); const pad = Math.round(16 * scale);
        const canvasA = document.createElement('canvas'); canvasA.width = cell; canvasA.height = architectureHeight(model, scale) + pad * 2;
        const contextA = canvasA.getContext('2d'); contextA.fillStyle = palette.paper; contextA.fillRect(0, 0, canvasA.width, canvasA.height);
        drawArchitecture(contextA, pad, pad, cell - pad * 2, model, scale, palette);
        panels.push({ image: canvasA, caption: 'Domain architecture (' + (model.source === 'pae' ? 'PAE domains, heuristic' : 'annotated domains') + ')' });
      }
      const canvas = document.createElement('canvas');
      canvas.width = columns * cell; canvas.height = rows * (cellHeight + captionHeight);
      const context = canvas.getContext('2d');
      context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height);
      panels.forEach((panel, index) => {
        const x = (index % columns) * cell; const y = Math.floor(index / columns) * (cellHeight + captionHeight);
        const pad = Math.round(cell * 0.03); const boxW = cell - 2 * pad; const boxH = cellHeight - 2 * pad;
        const ratio = panel.image.width / panel.image.height; let w = boxW; let h = w / ratio; if (h > boxH) { h = boxH; w = h * ratio; }
        context.drawImage(panel.image, x + pad + (boxW - w) / 2, y + pad + (boxH - h) / 2, w, h);
        context.fillStyle = palette.ink; context.textBaseline = 'middle'; context.textAlign = 'left';
        context.font = '700 ' + Math.round(captionHeight * 0.5) + 'px ' + figureFont();
        context.fillText(String.fromCharCode(65 + index), x + pad, y + cellHeight + captionHeight / 2);
        context.font = '400 ' + Math.round(captionHeight * 0.36) + 'px ' + figureFont();
        context.fillText(truncateToWidth(context, panel.caption, cell - pad * 2 - Math.round(captionHeight * 0.9)), x + pad + Math.round(captionHeight * 0.9), y + cellHeight + captionHeight / 2);
      });
      downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), requested.dpi), 'image/png', exportFileName('protein-composite-' + panels.length + '-panels', requested, 'png'));
      announce('Composite figure downloaded · ' + panels.length + ' panels · ' + canvas.width + ' × ' + canvas.height + (requested.dpi ? ' at ' + requested.dpi + ' dpi' : ''));
    } catch (error) {
      announce('Could not render the composite figure: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done(); button.textContent = 'Download composite figure'; button.disabled = structures.length === 0;
    }
  }


