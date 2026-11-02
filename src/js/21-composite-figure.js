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
      /* The All distances view is a figure even when no pair is within the cutoff. */
      contacts: Boolean(contactResult && entry && contactResult.entryId === entry.id && (contactResult.pairs.size || contactResult.view === 'distances')),
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

  /* The heatmap with a colour bar beside it when `font` (its label size in pixels) is given: a PAE
     panel with no key left the reader to guess what dark meant. */
  function drawPaePanel(entry, size, font = 0, palette = figurePalette()) {
    const matrix = entry.confidence.pae; const n = matrix.length;
    const barWidth = font ? Math.round(font * 0.9) : 0; const barArea = font ? Math.round(font * 4.6) : 0;
    const canvas = document.createElement('canvas'); canvas.width = size + barArea; canvas.height = size;
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
    const chains = paeTokenIds(entry).chainIds;
    context.strokeStyle = '#111827'; context.globalAlpha = 0.7; context.lineWidth = Math.max(1, size / 600);
    for (let index = 1; index < chains.length; index += 1) {
      if (chains[index] === chains[index - 1]) continue;
      const position = Math.round(index * size / n) + 0.5;
      context.beginPath(); context.moveTo(position, 0); context.lineTo(position, size); context.moveTo(0, position); context.lineTo(size, position); context.stroke();
    }
    context.globalAlpha = 1;
    if (font) {
      context.fillStyle = palette.paper; context.fillRect(size, 0, barArea, size);
      const x = size + Math.round(font * 0.7); const top = Math.round(font * 1.8); const bottom = size - Math.round(font * 0.8); const span = bottom - top;
      for (let row = 0; row < span; row += 1) { const color = paeColor(maximum * (1 - row / Math.max(1, span - 1)), maximum); context.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')'; context.fillRect(x, top + row, barWidth, 1); }
      context.strokeStyle = palette.ink; context.lineWidth = Math.max(1, font / 14); context.strokeRect(x, top, barWidth, span);
      context.fillStyle = palette.ink; context.font = '500 ' + font + 'px ' + figureFont(); context.textBaseline = 'middle'; context.textAlign = 'left';
      context.fillText(maximum.toFixed(0), x + barWidth + Math.round(font * 0.3), top);
      context.fillText('0', x + barWidth + Math.round(font * 0.3), bottom);
      context.fillText('Å', x, Math.round(font * 0.8));
    }
    return { canvas, caption: 'Predicted aligned error, ' + n + ' × ' + n + ' tokens, 0 (dark) to ' + maximum.toFixed(1) + ' Å' };
  }

  /* The caption strip under a row of panels, as the figure builder lays it out (35): the letter in bold
     at 1.3 × the text size, the caption at the text size wrapped onto up to three lines, the strip as
     tall as the longest caption needs. The text size is the one chosen for print — before 2.52.0 the
     composite, comparison and per-model figures sized it from the cell, 3–5 pt at 85 mm. */
  function figureCaptionLayout(captions, cellWidth, fontPx) {
    const inset = Math.round(cellWidth * 0.025);
    furnitureMeasure.font = '700 ' + Math.round(fontPx * 1.3) + 'px ' + figureFont();
    const letterWidth = furnitureMeasure.measureText('W').width + fontPx * 0.8;
    const width = Math.max(fontPx * 3, cellWidth - inset * 2 - letterWidth);
    furnitureMeasure.font = '500 ' + fontPx + 'px ' + figureFont();
    const cut = [];
    const lines = captions.map((caption, index) => {
      const wrapped = wrapText(furnitureMeasure, caption, width).map(line => truncateToWidth(furnitureMeasure, line, width));
      if (wrapped.length <= 3) return wrapped.length ? wrapped : [''];
      cut.push(String.fromCharCode(65 + index));
      return [wrapped[0], wrapped[1], truncateToWidth(furnitureMeasure, wrapped.slice(2).join(' '), width)];
    });
    const most = Math.max(1, ...lines.map(item => item.length));
    return { fontPx, inset, letterWidth, width, lines, height: Math.round(fontPx * (0.9 + 1.3 * most)), cut };
  }
  function figureCaptionsCutNote(layout) {
    return layout.cut.length ? ' · caption' + (layout.cut.length === 1 ? ' of panel ' : 's of panels ') + layout.cut.join(', ') + ' shortened to fit three lines' : '';
  }
  /* (x, top) is the left edge of the cell and the top of its caption strip. */
  function drawFigureCaption(context, layout, index, x, top, palette) {
    const first = top + Math.round(layout.fontPx * 1.1); const step = Math.round(layout.fontPx * 1.3);
    context.save(); context.fillStyle = palette.ink; context.textBaseline = 'middle'; context.textAlign = 'left';
    context.font = '700 ' + Math.round(layout.fontPx * 1.3) + 'px ' + figureFont();
    context.fillText(String.fromCharCode(65 + index), x + layout.inset, first);
    context.font = '500 ' + layout.fontPx + 'px ' + figureFont();
    layout.lines[index].forEach((line, lineIndex) => context.fillText(line, x + layout.inset + layout.letterWidth, first + lineIndex * step));
    context.restore();
  }
  function svgFigureCaption(layout, index, x, top, palette) {
    const first = top + Math.round(layout.fontPx * 1.1); const step = Math.round(layout.fontPx * 1.3);
    const text = (tx, ty, size, weight, value) => '<text x="' + f(tx) + '" y="' + f(ty) + '" dominant-baseline="central" font-family="' + svgFont + '" font-size="' + f(size) + '" font-weight="' + weight + '" fill="' + palette.ink + '">' + svgEscape(value) + '</text>';
    return [text(x + layout.inset, first, Math.round(layout.fontPx * 1.3), 700, String.fromCharCode(65 + index)), ...layout.lines[index].map((line, lineIndex) => text(x + layout.inset + layout.letterWidth, first + lineIndex * step, layout.fontPx, 500, line))].join('\n');
  }
  /* The text size of a print figure in pixels: the chosen points at the figure's dpi, or the screen
     export's 12 px scaled with its width. */
  function figureTextPx(plan) {
    return Math.max(10, Math.round(plan.dpi ? plan.points / 72 * plan.dpi : 12 * figureScale(plan)));
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
    const palette = figurePalette();
    const done = setBusy('Rendering composite…'); button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const panels = [];
      /* Every panel's text at the figure's text size: the 3D panel keeps the figure's textScale (its
         legend and labels were halved at two columns), and the charts are laid out at the size of the
         box they are drawn into, with their text at that size — drawn 1:1 (`natural`), never shrunk to
         fit. A chart that cannot hold its text in the cell makes its row taller instead. */
      const panelPlan = { ...requested, width: cell, height: cellHeight, mm: requested.mm ? requested.mm / columns : undefined, fixedText: true };
      const uri = await withLegend(await renderPublicationImage(null, panelPlan), panelPlan);
      /* "coloured by pLDDT confidence", not "plddt": only a leading capital that starts a word is lowered. */
      panels.push({ image: await loadImage(uri), whole: true, caption: displayName(entry) + (root.querySelector('#gpv-color-mode').value !== 'structure' ? ', coloured by ' + root.querySelector('#gpv-color-mode').selectedOptions[0].textContent.replace(/^[A-Z](?=[a-z])/, letter => letter.toLowerCase()) : '') });
      const pad = Math.round(cell * 0.03); const box = { width: cell - 2 * pad, height: cellHeight - 2 * pad };
      const labelPx = requested.dpi ? requested.points / 72 * requested.dpi : 12 * figureScale(requested);
      const fit = { ...box, scale: labelPx / 11 };
      const inner = Math.round(labelPx * 0.4);
      if (wanted.pae) { const pae = drawPaePanel(entry, Math.min(box.height, box.width - Math.round(labelPx * 4.6)), Math.round(labelPx), palette); panels.push({ image: pae.canvas, natural: true, caption: pae.caption }); }
      if (wanted.profile) {
        const profile = plddtProfileSvg(fit);
        if (profile) { const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg)); panels.push({ image, natural: true, caption: 'Per-residue pLDDT' + (displayedEntries().filter(item => item.scores.length).length > 1 ? ' of the displayed models' : ''), aspect: profile.width / profile.height }); }
      }
      if (wanted.contacts) {
        /* Ticks and titles at the text size (11-unit ticks, as the profile's), the grid sized to the
           width that is left — up to square, the row growing to hold it: a map squeezed into the cell's
           height left its title no room at all at 8 pt. */
        const canvas = document.createElement('canvas'); const textScale = labelPx / 11;
        const n = contactResult.rowA.residues.length; const m = contactResult.rowB.residues.length;
        const gridWidth = Math.max(20, box.width - 96 * textScale); const gridHeight = Math.max(gridWidth, box.height - 118 * textScale);
        const side = Math.min(gridWidth / m, gridHeight / n);
        drawContactMap(canvas, true, textScale, side / contactCell(canvas));
        panels.push({ image: canvas, natural: true, caption: contactCaption() });
      }
      if (wanted.rmsf) {
        const profile = rmsfProfileSvg(fit);
        if (profile) { const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(profile.svg)); panels.push({ image, natural: true, caption: 'Per-residue Cα RMSF across ' + ensembleSpread.count + ' aligned models' }); }
      }
      if (wanted.matrix) {
        /* Model names at the text size (10-unit labels); a matrix too short for its values takes the width. */
        const scale = labelPx / 10; const n = rmsdMatrix.names.length;
        const side = Math.min(box.width - inner * 2, Math.max(box.height - inner * 2, Math.round(labelPx * (4 + 2.5 * n))));
        const canvasM = document.createElement('canvas'); const metrics = rmsdMatrixMetrics(side, scale); canvasM.width = metrics.width + inner * 2; canvasM.height = metrics.height + inner * 2;
        const contextM = canvasM.getContext('2d'); contextM.fillStyle = palette.paper; contextM.fillRect(0, 0, canvasM.width, canvasM.height);
        drawRmsdMatrix(contextM, inner, inner, side, scale, palette);
        panels.push({ image: canvasM, natural: true, caption: 'Pairwise Cα RMSD between ' + n + ' models' + (rmsdMatrix.fitRegion ? ', fitted on ' + rmsdMatrix.fitRegion : '') + (rmsdMatrix.byPosition ? ', identical chains matched by position' : '') });
      }
      if (wanted.architecture) {
        const model = architectureModel(entry); const scale = labelPx / 11;
        const canvasA = document.createElement('canvas'); canvasA.width = box.width; canvasA.height = architectureHeight(model, scale) + inner * 2;
        const contextA = canvasA.getContext('2d'); contextA.fillStyle = palette.paper; contextA.fillRect(0, 0, canvasA.width, canvasA.height);
        drawArchitecture(contextA, 0, inner, box.width, model, scale, palette);
        panels.push({ image: canvasA, natural: true, caption: 'Domain architecture (' + (model.source === 'pae' ? 'PAE domains, heuristic' : 'annotated domains') + ')' });
      }
      const captions = figureCaptionLayout(panels.map(panel => panel.caption), cell, figureTextPx(requested));
      /* Each row as tall as the cell, or as its tallest chart drawn at its own size. */
      const drawnSize = panel => { const k = panel.natural ? Math.min(1, box.width / panel.image.width) : 1; return { w: panel.image.width * k, h: panel.image.height * k }; };
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(cellHeight, ...panels.slice(row * columns, row * columns + columns).filter(panel => panel.natural).map(panel => Math.ceil(drawnSize(panel).h) + 2 * pad)));
      const rowTops = rowHeights.map((_, row) => rowHeights.slice(0, row).reduce((sum, value) => sum + value + captions.height, 0));
      const grown = rowHeights.some(value => value > cellHeight);
      const canvas = document.createElement('canvas');
      canvas.width = columns * cell; canvas.height = rowHeights.reduce((sum, value) => sum + value + captions.height, 0);
      const context = canvas.getContext('2d');
      context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height);
      panels.forEach((panel, index) => {
        const row = Math.floor(index / columns); const x = (index % columns) * cell; const y = rowTops[row]; const rowHeight = rowHeights[row];
        if (panel.whole) context.drawImage(panel.image, x, y + (rowHeight - cellHeight) / 2, cell, cellHeight);
        else if (panel.natural) { const { w, h } = drawnSize(panel); context.drawImage(panel.image, x + pad + (box.width - w) / 2, y + pad + (rowHeight - 2 * pad - h) / 2, w, h); }
        else {
          const boxH = rowHeight - 2 * pad; const ratio = panel.image.width / panel.image.height; let w = box.width; let h = w / ratio; if (h > boxH) { h = boxH; w = h * ratio; }
          context.drawImage(panel.image, x + pad + (box.width - w) / 2, y + pad + (boxH - h) / 2, w, h);
        }
        drawFigureCaption(context, captions, index, x, y + rowHeight, palette);
      });
      downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), requested.dpi), 'image/png', exportFileName('protein-composite-' + panels.length + '-panel' + (panels.length === 1 ? '' : 's'), requested, 'png'));
      announce('Composite figure downloaded · ' + panels.length + ' panel' + (panels.length === 1 ? '' : 's') + ' · ' + canvas.width + ' × ' + canvas.height + (requested.dpi ? ' at ' + requested.dpi + ' dpi' : '') + exportCapText(requested) + (grown ? ' · rows made taller to keep the text at ' + (requested.dpi ? requested.points + ' pt' : 'its size') : '') + figureCaptionsCutNote(captions));
    } catch (error) {
      announce('Could not render the composite figure: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done(); button.textContent = 'Download composite figure'; button.disabled = structures.length === 0;
    }
  }
