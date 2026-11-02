  /* ---------- Vector overlay export ----------
     The molecule is a raster (WebGL has no vector path), but everything drawn on
     top of it — labels, measurements, arrows, callouts, captions, legend — is
     written as SVG elements so it can be restyled in Illustrator or Inkscape. */

  const svgMeasure = document.createElement('canvas').getContext('2d');
  let svgFont = 'Arial, Helvetica, sans-serif';
  const f = value => String(Math.round(value * 100) / 100);

  function svgEscape(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function projectorFor(target) {
    const canvas = target.container ? target.container.querySelector('canvas') : null;
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return point => {
      const screen = target.modelToScreen(point);
      return { x: screen.x - rect.left - window.scrollX, y: screen.y - rect.top - window.scrollY };
    };
  }

  function pixelRadius(target, project, point, radius) {
    const right = screenAxisInModelSpace(target.getView(), { x: 1, y: 0, z: 0 });
    const a = project(point); const b = project({ x: point.x + right.x * radius, y: point.y + right.y * radius, z: point.z + right.z * radius });
    return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  }

  function svgLine(a, b, color, width, dashed) {
    return '<line x1="' + f(a.x) + '" y1="' + f(a.y) + '" x2="' + f(b.x) + '" y2="' + f(b.y) + '" stroke="' + color + '" stroke-width="' + f(width) + '" stroke-linecap="round"' + (dashed ? ' stroke-dasharray="' + f(width * 3) + ' ' + f(width * 2) + '"' : '') + '/>';
  }

  function svgArrow(a, b, color, width) {
    const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy) || 1; const ux = dx / length; const uy = dy / length;
    const head = Math.max(9, width * 4); const base = { x: b.x - ux * head, y: b.y - uy * head }; const half = head * 0.55;
    const points = [b, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }].map(point => f(point.x) + ',' + f(point.y)).join(' ');
    return svgLine(a, base, color, width, false) + '<polygon points="' + points + '" fill="' + color + '"/>';
  }

  function svgLabel(position, text, fontSize, color, palette, anchor = 'middle') {
    svgMeasure.font = '500 ' + fontSize + 'px ' + svgFont;
    const width = svgMeasure.measureText(text).width + fontSize * 0.9; const height = fontSize * 1.6;
    const x = anchor === 'start' ? position.x : anchor === 'end' ? position.x - width : position.x - width / 2;
    const y = position.y - height / 2;
    return '<g><rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(width) + '" height="' + f(height) + '" rx="' + f(fontSize * 0.3) + '" fill="' + palette.paper + '" fill-opacity="0.88" stroke="' + color + '" stroke-width="1"/>'
      + '<text x="' + f(x + width / 2) + '" y="' + f(position.y) + '" text-anchor="middle" dominant-baseline="central" font-family="' + svgFont + '" font-size="' + f(fontSize) + '" font-weight="500" fill="' + color + '">' + svgEscape(text) + '</text></g>';
  }

  /* The same rows legendMetrics hands the canvas drawer, so a PNG and an SVG of one figure wrap
     and ellipsise identically — `available` is the width the legend has been given. */
  function svgLegend(x, y, scale, palette, kind = 'figure', vertical = false, available = Infinity) {
    const metrics = legendMetrics(svgMeasure, scale, kind, vertical, available);
    if (!metrics) return { markup: '', width: 0, height: 0 };
    const { swatch, gap, font } = metrics;
    const text = (tx, ty, value) => '<text x="' + f(tx) + '" y="' + f(ty) + '" dominant-baseline="central" font-family="' + svgFont + '" font-size="' + f(font) + '" font-weight="500" fill="' + palette.ink + '">' + svgEscape(value) + '</text>';
    const parts = ['<g id="legend"><rect x="' + f(x - gap) + '" y="' + f(y + metrics.top) + '" width="' + f(metrics.boxWidth) + '" height="' + f(metrics.height) + '" fill="' + palette.paper + '" fill-opacity="0.88"/>'];
    metrics.rows.forEach(row => row.cells.forEach(cell => {
      const rowY = y + row.dy;
      if (cell.color) parts.push('<rect x="' + f(x + cell.x) + '" y="' + f(rowY - swatch / 2) + '" width="' + f(swatch) + '" height="' + f(swatch) + '" fill="' + cell.color + '"/>');
      parts.push(text(x + cell.textX, rowY, cell.text));
    }));
    parts.push('</g>');
    return { markup: parts.join(''), width: metrics.width, height: metrics.height };
  }

  function svgFurniture(width, height, scale, bar, palette, wanted = legendWanted()) {
    const layout = furnitureLayout(width, height, scale, bar, palette, wanted);
    const parts = [];
    if (wanted) parts.push(svgLegend(layout.legendX, layout.legendY, layout.legendScale, palette, 'figure', layout.vertical, layout.legendAvailable).markup);
    if (bar) parts.push(layout.barLift ? '<g transform="translate(0 ' + f(-layout.barLift) + ')">' + scaleBarSvg(bar, scale, palette) + '</g>' : scaleBarSvg(bar, scale, palette));
    return parts.join('');
  }

  function svgScreenText(record, dimensions, scale, palette) {
    const fontSize = 16 * record.size * scale; const margin = 16 * scale;
    const right = record.corner.endsWith('right'); const bottom = record.corner.startsWith('bottom');
    const x = Math.max(0, Math.min(dimensions.width, (right ? dimensions.width - margin : margin) + (record.dx || 0) * scale));
    const y = Math.max(0, Math.min(dimensions.height, (bottom ? dimensions.height - margin : margin) + (record.dy || 0) * scale)) + (bottom ? -fontSize * 0.8 : fontSize * 0.8);
    return svgLabel({ x, y }, record.text, fontSize, record.color, palette, right ? 'end' : 'start');
  }

  function overlaySvg(target, shownIds, dimensions, includeScreenText) {
    const project = projectorFor(target);
    const scale = dimensions.textScale || Math.max(1, dimensions.width / 600);
    const palette = figurePalette(); const byId = entriesById(); const parts = [];
    const ink = themeColor('--card-foreground', '#111827');
    /* The same resolver the PNG of this panel draws with, run on the same viewer and the same plan,
       so the two files place every label on the same pixel. */
    const placement = panelLabelPlacement(target, dimensions, shownIds);
    labelRecords.filter(label => shownIds.has(label.entryId)).forEach(label => {
      const anchor = labelAnchor(label, byId);
      const position = (placement && placement.get(label)) || shiftBy(anchor, label.offset);
      if (leaderLength(anchor, position) > leaderMinimum) parts.push(svgLine(project(anchor), project(position), label.color || '#94a3b8', Math.max(1, scale), false));
      parts.push(svgLabel(project(position), label.text, (label.size || 12) * scale, label.color || ink, palette));
    });
    measurementRecords.forEach(record => {
      if (!record.points.every(point => shownIds.has(point.entryId))) return;
      const points = record.points.map(resolvePoint); if (points.some(point => !point)) return;
      const screen = points.map(project);
      /* The record's colour and dash when it has them, the crimson dashed line otherwise; the text and
         its place exactly as drawMeasurements puts them on this panel's PNG, leader line included. */
      const color = measurementColor(record) || '#e11d48'; const dashed = record.dashed !== false;
      parts.push(svgLine(screen[0], screen[1], color, 2 * scale, dashed));
      if (record.type === 'angle') parts.push(svgLine(screen[1], screen[2], color, 2 * scale, dashed));
      const anchor = measurementAnchor(points, record);
      const placed = placement && placement.get(record);
      const position = placed || shiftBy(anchor, record.offset);
      if (leaderLength(anchor, position) > leaderMinimum) parts.push(svgLine(project(anchor), project(position), color, Math.max(1, scale), false));
      /* A label nobody moved keeps the place it has always had in the SVG: halfway between the
         projected ends, which a perspective camera puts a fraction of a pixel from the projected
         midpoint. */
      const at = placed || labelOffsetLength(record) ? project(position) : record.type === 'angle' ? screen[1] : { x: (screen[0].x + screen[1].x) / 2, y: (screen[0].y + screen[1].y) / 2 };
      parts.push(svgLabel(at, measurementLabelText(record), 12 * scale, measurementColor(record) || ink, palette));
    });
    annotationRecords.forEach(record => {
      if (record.type === 'screen') { if (includeScreenText) parts.push(svgScreenText(record, dimensions, scale, palette)); return; }
      if (!record.points.every(point => shownIds.has(point.entryId))) return;
      const points = record.points.map(resolvePoint); if (points.some(point => !point)) return;
      const screen = points.map(project); const fontSize = 13 * record.size * scale; const stroke = Math.max(1.5, 2 * record.size * scale);
      if (record.type === 'arrow') parts.push(svgArrow(screen[0], screen[1], record.color, stroke));
      if (record.type === 'line') parts.push(svgLine(screen[0], screen[1], record.color, stroke, record.dashed));
      if (record.type === 'marker') parts.push('<circle cx="' + f(screen[0].x) + '" cy="' + f(screen[0].y) + '" r="' + f(pixelRadius(target, project, points[0], 1.4 * record.size)) + '" fill="' + record.color + '" fill-opacity="0.55"/>');
      if (record.type === 'callout') {
        const anchor = project(calloutAnchor(points[0], record));
        parts.push(svgLine(screen[0], anchor, record.color, Math.max(1, stroke / 2), record.dashed));
        parts.push('<circle cx="' + f(screen[0].x) + '" cy="' + f(screen[0].y) + '" r="' + f(pixelRadius(target, project, points[0], 0.45 * record.size)) + '" fill="' + record.color + '"/>');
        parts.push(svgLabel(anchor, record.text || pointName(record.points[0]), fontSize, record.color, palette));
        return;
      }
      if (record.text) parts.push(svgLabel(project(shiftBy(points.length > 1 ? midpoint(points[0], points[1]) : points[0], record.offset)), record.text, fontSize, record.color, palette));
    });
    return parts.join('\n');
  }

  function svgDocument(width, height, background, body) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">\n'
      + (background ? '<rect width="100%" height="100%" fill="' + background + '"/>\n' : '') + body + '\n</svg>\n';
  }

  function svgImage(uri, x, y, width, height) {
    return '<image href="' + uri + '" x="' + f(x) + '" y="' + f(y) + '" width="' + f(width) + '" height="' + f(height) + '"/>';
  }

  async function downloadPublicationSvg() {
    const button = root.querySelector('#gpv-svg');
    const requested = exportDimensions();
    const done = setBusy('Rendering SVG…');
    button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const uri = await renderPublicationImage(null, requested, false);
      const target = exportViewer;
      const overlay = overlaySvg(target, new Set(displayedEntries().map(entry => entry.id)), requested, true);
      const scale = figureScale(requested);
      const legend = svgFurniture(requested.width, requested.height, scale, scaleBarSpec(target, requested), figurePalette());
      const background = backgroundSpec();
      const svg = svgDocument(requested.width, requested.height, background.alpha ? background.color : null, svgImage(uri, 0, 0, requested.width, requested.height) + '\n<g id="overlay">\n' + overlay + '\n' + legend + '</g>');
      downloadBlob(svg, 'image/svg+xml', 'protein-figure-' + requested.width + 'x' + requested.height + '.svg');
      announce('Figure SVG downloaded · raster molecule, vector labels');
    } catch (error) {
      announce('Could not build the SVG: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done();
      button.textContent = 'Download figure SVG'; button.disabled = structures.length === 0;
    }
  }

  /* One layout for the comparison and per-model figures, PNG and SVG. The comparison keeps the chosen
     size per panel; the per-model figure (`fitWidth`) is the chosen width overall, as the builder is —
     before 2.52.0 it was N × 85 mm wide and named "…-85mm-…". Captions, letters and the footer's legend
     and title are at the chosen text size, not a fraction of the cell. */
  function panelFigureCaption(pane) {
    const score = mean(pane.entry.scores);
    return displayName(pane.entry) + (score === null ? '' : ' · mean pLDDT ' + score.toFixed(1));
  }
  function panelFigureLayout(panes, fitWidth = false) {
    const requested = exportDimensions();
    const columns = panelColumns(panes.length); const rows = Math.ceil(panes.length / columns);
    let cellWidth = requested.width; let cellHeight = requested.height;
    if (fitWidth) { cellWidth = Math.floor(requested.width / columns); cellHeight = Math.max(1, Math.floor(cellWidth * requested.height / Math.max(1, requested.width))); }
    const maxPixels = 24000000;
    if (cellWidth * cellHeight * panes.length > maxPixels) {
      const correction = Math.sqrt(maxPixels / (cellWidth * cellHeight * panes.length));
      cellWidth = Math.floor(cellWidth * correction); cellHeight = Math.floor(cellHeight * correction);
    }
    const fontPx = figureTextPx(requested); const textScale = figureScale(requested);
    const cellPlan = { width: cellWidth, height: cellHeight, textScale, dpi: requested.dpi, points: requested.points, mm: requested.mm ? requested.mm * cellWidth / requested.width : undefined };
    const captions = figureCaptionLayout(panes.map(panelFigureCaption), cellWidth, fontPx);
    const width = columns * cellWidth; const inset = Math.round(cellWidth * 0.025);
    const title = provenanceValues().title;
    const legend = legendWanted('comparison') ? legendMetrics(furnitureMeasure, textScale, 'comparison', false, width - inset * 2) : null;
    const footer = legend || title ? Math.round((legend ? legend.height : fontPx * 1.3) + fontPx * 1.2) : 0;
    const height = rows * (cellHeight + captions.height) + footer;
    /* The centre line of the footer's last row; a legend that wrapped stacks its rows above it. */
    const footerY = height - Math.round(fontPx * 0.6) - (legend ? legend.swatch : Math.round(fontPx * 0.65));
    return { requested, columns, rows, cellWidth, cellHeight, cellPlan, captions, fontPx, textScale, inset, title, legend, footer, footerY, width, height };
  }
  /* "W × H at D dpi (M mm wide)": the whole figure, which for a comparison is columns × the chosen size. */
  function panelFigureSize(layout) {
    const plan = layout.requested;
    return layout.width + ' × ' + layout.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi (' + Math.round(layout.width / plan.dpi * 25.4) + ' mm wide)' : '') + exportCapText(plan) + figureCaptionsCutNote(layout.captions);
  }

  async function downloadComparisonSvg() {
    const panes = comparisonPanes();
    if (panes.length < 2) { announce('Turn on the synchronized multi-view with at least one panel first', 'error'); return; }
    const button = root.querySelector('#gpv-compare-svg');
    const layout = panelFigureLayout(panes); const palette = figurePalette();
    const { columns, cellWidth, cellHeight, captions, width, height } = layout;
    const done = setBusy('Rendering comparison SVG…');
    button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const parts = [];
      const caption = (x, y, size, weight, value, anchor = 'start') => '<text x="' + f(x) + '" y="' + f(y) + '" dominant-baseline="central" text-anchor="' + anchor + '" font-family="' + svgFont + '" font-size="' + f(size) + '" font-weight="' + weight + '" fill="' + palette.ink + '">' + svgEscape(value) + '</text>';
      for (let index = 0; index < panes.length; index += 1) {
        button.textContent = 'Rendering ' + (index + 1) + ' / ' + panes.length + '…';
        await afterPaint();
        const uri = await renderEntryImage(panes[index].entry, panes[index].camera, layout.cellPlan, false);
        const overlay = overlaySvg(exportViewer, new Set([panes[index].entry.id]), layout.cellPlan, false);
        const x = (index % columns) * cellWidth; const y = Math.floor(index / columns) * (cellHeight + captions.height);
        parts.push(svgImage(uri, x, y, cellWidth, cellHeight));
        parts.push('<g transform="translate(' + f(x) + ' ' + f(y) + ')">' + overlay + '</g>');
        parts.push(svgFigureCaption(captions, index, x, y + cellHeight, palette));
      }
      if (layout.footer) {
        let used = 0;
        /* The footer band is as wide as the figure, so that is the legend's room — it wraps rather than running past the last panel. */
        if (layout.legend) { const legend = svgLegend(layout.inset, layout.footerY, layout.textScale, palette, 'comparison', false, width - layout.inset * 2); parts.push(legend.markup); used = legend.width + layout.fontPx * 1.5; }
        if (layout.title) { svgMeasure.font = '600 ' + layout.fontPx + 'px ' + svgFont; parts.push(caption(layout.inset + used, layout.footerY, layout.fontPx, 600, truncateToWidth(svgMeasure, layout.title, Math.max(layout.fontPx, width - used - layout.inset * 2)))); }
      }
      const svg = svgDocument(width, height, palette.paper, parts.join('\n'));
      downloadBlob(svg, 'image/svg+xml', 'protein-comparison-' + panes.length + '-panels.svg');
      announce('Comparison SVG downloaded · ' + panes.length + ' panels · ' + panelFigureSize(layout) + ' · vector captions');
    } catch (error) {
      announce('Could not build the comparison SVG: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done();
      button.textContent = 'Download comparison SVG';
      button.disabled = !(root.querySelector('#gpv-side-by-side').checked && comparePanels.length);
    }
  }

  function comparisonPanes() {
    const panes = [{ entry: activeEntry(), camera: typeof viewer.getView === 'function' ? viewer.getView() : null }];
    comparePanels.forEach(panel => panes.push({ entry: entryById(panel.entryId), camera: panel.viewer && typeof panel.viewer.getView === 'function' ? panel.viewer.getView() : null }));
    return panes.filter(pane => pane.entry);
  }

  async function downloadComparisonPng() {
    const panes = comparisonPanes();
    if (panes.length < 2) { announce('Turn on the synchronized multi-view with at least one panel first', 'error'); return; }
    await renderPanelFigure(panes, root.querySelector('#gpv-compare-image'), {
      idle: 'Download comparison PNG', noun: 'Comparison figure', filename: 'protein-comparison-' + panes.length + '-panels.png',
      disabledAfter: () => !(root.querySelector('#gpv-side-by-side').checked && comparePanels.length)
    });
  }

  /* One lettered panel per model, all rendered from the camera of the main view, so the
     models of a run are framed identically — the figure a reviewer asks for first. */
  async function downloadModelPanels() {
    const active = activeEntry();
    const shown = displayedEntries().filter(entry => entry.model);
    const entries = shown.length >= 2 ? shown : structures.filter(entry => active && entry.collection === active.collection);
    if (entries.length < 2) { announce('Load at least two models (or show two) to make a per-model figure', 'error'); return; }
    const failures = [];
    entries.forEach(entry => { try { materializeEntry(entry); } catch (error) { failures.push(entry.name); } });
    const ready = entries.filter(entry => entry.model);
    if (failures.length) showImportErrors(failures.map(name => name + ': could not be read'));
    const camera = typeof viewer.getView === 'function' ? viewer.getView() : null;
    await renderPanelFigure(ready.map(entry => ({ entry, camera })), root.querySelector('#gpv-model-panels'), {
      idle: 'Download one panel per model', noun: 'Per-model figure', fitWidth: true, filename: exportFileName('protein-models-' + ready.length + '-panels', exportDimensions(), 'png'),
      disabledAfter: () => structures.length < 2
    });
  }

  async function renderPanelFigure(panes, button, options) {
    const layout = panelFigureLayout(panes, options.fitWidth === true);
    const { requested, columns, cellWidth, cellHeight, captions } = layout;
    const palette = figurePalette();
    const done = setBusy('Rendering comparison…');
    button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const canvas = document.createElement('canvas');
      canvas.width = layout.width; canvas.height = layout.height;
      const context = canvas.getContext('2d');
      context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height);
      if (layout.footer) {
        let used = 0;
        /* The footer band is as wide as the figure, so that is the legend's room — it wraps rather than running past the last panel. */
        if (layout.legend) used = drawPlddtLegend(context, layout.inset, layout.footerY, layout.textScale, palette, 'comparison', false, false, canvas.width - layout.inset * 2) + layout.fontPx * 1.5;
        if (layout.title) {
          context.fillStyle = palette.ink; context.textBaseline = 'middle'; context.textAlign = 'left'; context.font = '600 ' + layout.fontPx + 'px ' + figureFont();
          context.fillText(truncateToWidth(context, layout.title, Math.max(layout.fontPx, canvas.width - used - layout.inset * 2)), layout.inset + used, layout.footerY);
        }
      }
      for (let index = 0; index < panes.length; index += 1) {
        button.textContent = 'Rendering ' + (index + 1) + ' / ' + panes.length + '…';
        await afterPaint();
        const uri = await renderEntryImage(panes[index].entry, panes[index].camera, layout.cellPlan);
        const imageValue = await loadImage(uri);
        const x = (index % columns) * cellWidth; const y = Math.floor(index / columns) * (cellHeight + captions.height);
        context.drawImage(imageValue, x, y, cellWidth, cellHeight);
        drawFigureCaption(context, captions, index, x, y + cellHeight, palette);
      }
      const uri = canvas.toDataURL('image/png');
      downloadBlob(await pngWithDpi(uri, requested.dpi), 'image/png', options.filename);
      announce(options.noun + ' downloaded · ' + panes.length + ' panels · ' + panelFigureSize(layout));
    } catch (error) {
      announce('Could not render the figure: ' + error.message, 'error');
    } finally {
      releaseExportViewer();
      done();
      button.textContent = options.idle;
      button.disabled = options.disabledAfter();
    }
  }

  function loadImage(uri) {
    return new Promise((resolve, reject) => { const imageValue = new Image(); imageValue.onload = () => resolve(imageValue); imageValue.onerror = reject; imageValue.src = uri; });
  }

  function wrapText(context, text, maxWidth) {
    const lines = [];
    let line = '';
    String(text || '').split(/\s+/).filter(Boolean).forEach(word => {
      const candidate = line ? line + ' ' + word : word;
      if (context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
      else line = candidate;
    });
    if (line) lines.push(line);
    return lines;
  }

