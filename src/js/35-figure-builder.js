  /* ---------- Figure builder ----------
     Saved views are the panels. Each ticked view is rendered from its own camera, colour
     scheme and model selection at the same text size; the cells share the figure's aspect
     ratio and are sized so the whole figure is the chosen output width. Panel letters and
     captions go in a strip under each cell; legend and scale bar sit inside the cell. */
  function figurePanelsSelected() { return savedViews.filter(view => view.inFigure !== false); }
  function builderOptions() {
    const columns = root.querySelector('#gpv-panel-columns').value;
    return { columns, captions: root.querySelector('#gpv-builder-captions').value, letters: root.querySelector('#gpv-builder-letters').checked, legends: root.querySelector('#gpv-builder-legends').checked, architecture: root.querySelector('#gpv-builder-architecture').checked };
  }
  function applyBuilderOptions(options) {
    if (!options || typeof options !== 'object') return;
    if (['auto', '1', '2', '3', '4'].includes(String(options.columns))) root.querySelector('#gpv-panel-columns').value = String(options.columns);
    if (['both', 'name', 'caption', 'none'].includes(options.captions)) root.querySelector('#gpv-builder-captions').value = options.captions;
    if (typeof options.letters === 'boolean') root.querySelector('#gpv-builder-letters').checked = options.letters;
    if (typeof options.legends === 'boolean') root.querySelector('#gpv-builder-legends').checked = options.legends;
    if (typeof options.architecture === 'boolean') root.querySelector('#gpv-builder-architecture').checked = options.architecture;
  }
  function figureLayout(count, panels = []) {
    const requested = exportDimensions(); const options = builderOptions(); const total = Math.max(1, count);
    const columns = Math.max(1, Math.min(total, options.columns === 'auto' ? panelColumns(total) : Number(options.columns) || 2));
    const rows = Math.ceil(total / columns);
    const cellWidth = Math.floor(requested.width / columns);
    const cellHeight = Math.max(1, Math.floor(cellWidth * requested.height / Math.max(1, requested.width)));
    const fontPx = Math.max(10, Math.round(requested.dpi ? requested.points / 72 * requested.dpi : 12 * figureScale(requested)));
    /* Captions wrap onto a second line when they do not fit beside the letter; the strip is as
       tall as the longest caption in the figure needs, so every row lines up. */
    const inset = Math.round(cellWidth * 0.025);
    furnitureMeasure.font = '700 ' + Math.round(fontPx * 1.3) + 'px ' + figureFont();
    const letterWidth = options.letters ? furnitureMeasure.measureText('W').width + fontPx * 0.8 : 0;
    const captionWidth = cellWidth - inset - letterWidth - fontPx;
    furnitureMeasure.font = '500 ' + fontPx + 'px ' + figureFont();
    const captionLines = view => { const wrapped = wrapText(furnitureMeasure, builderCaption(view, options), captionWidth); return wrapped.length > 2 ? [wrapped[0], truncateToWidth(furnitureMeasure, wrapped.slice(1).join(' '), captionWidth)] : wrapped; };
    const lines = Math.max(1, ...panels.map(view => captionLines(view).length));
    const captionHeight = options.letters || options.captions !== 'none' ? Math.round(fontPx * (0.9 + 1.3 * lines)) : Math.round(fontPx * 0.5);
    const cellPlan = { width: cellWidth, height: cellHeight, dpi: requested.dpi, points: requested.points, textScale: requested.textScale, mm: requested.mm ? requested.mm / columns : undefined };
    /* The optional architecture row spans the figure width under the panels and reads the
       domains of the model on screen. */
    const scale = figureScale(cellPlan); const architecture = options.architecture ? architectureModel(activeEntry()) : null;
    const architectureRow = architecture ? architectureHeight(architecture, scale) + Math.round(24 * scale) : 0;
    return { requested, options, columns, rows, cellWidth, cellHeight, fontPx, inset, letterWidth, captionWidth, captionLines, lines, captionHeight, architecture, architectureRow, scale, width: columns * cellWidth, height: rows * (cellHeight + captionHeight) + architectureRow, cellPlan };
  }
  function builderCaption(view, options) {
    const name = String(view.name || ''); const caption = String(view.caption || '');
    return options.captions === 'name' ? name : options.captions === 'caption' ? caption : options.captions === 'none' ? '' : [name, caption].filter(Boolean).join(' — ');
  }
  function renderFigureBuilder() {
    const body = root.querySelector('#gpv-builder-rows'); if (!body) return;
    body.replaceChildren();
    let letter = 0;
    savedViews.forEach((view, index) => {
      const included = view.inFigure !== false;
      const tr = document.createElement('tr');
      const inCell = document.createElement('td'); const tick = document.createElement('input'); tick.type = 'checkbox'; tick.className = 'form-check-input'; tick.checked = included; tick.setAttribute('aria-label', 'Include ' + view.name + ' in the figure');
      tick.addEventListener('change', () => { remember('figure panels'); view.inFigure = tick.checked; renderFigureBuilder(); });
      /* The theme draws checkboxes only inside a .form-check label; a bare input is invisible. */
      const tickLabel = document.createElement('label'); tickLabel.className = 'form-check'; tickLabel.append(tick); inCell.append(tickLabel); tr.append(inCell);
      const letterCell = document.createElement('td'); letterCell.className = 'gpv-builder-letter'; letterCell.textContent = included ? String.fromCharCode(65 + letter) : '—'; if (included) letter += 1; tr.append(letterCell);
      const nameCell = document.createElement('th'); nameCell.scope = 'row'; nameCell.textContent = view.name; tr.append(nameCell);
      const captionCell = document.createElement('td'); const caption = document.createElement('input'); caption.type = 'text'; caption.className = 'form-control'; caption.value = view.caption || ''; caption.placeholder = 'Panel caption'; caption.maxLength = 200; caption.setAttribute('aria-label', 'Caption for ' + view.name);
      caption.addEventListener('input', () => { view.caption = caption.value.trim().slice(0, 200); renderSavedViews(false); });
      caption.addEventListener('change', () => remember('figure caption'));
      captionCell.append(caption); tr.append(captionCell);
      const orderCell = document.createElement('td'); const order = document.createElement('span'); order.className = 'gpv-builder-order';
      const move = (delta, label, glyph) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = glyph; button.setAttribute('aria-label', label + ' ' + view.name); button.disabled = index + delta < 0 || index + delta >= savedViews.length;
        button.addEventListener('click', () => { remember('figure panel order'); const target = index + delta; [savedViews[index], savedViews[target]] = [savedViews[target], savedViews[index]]; renderSavedViews(); }); return button; };
      order.append(move(-1, 'Move up', '↑'), move(1, 'Move down', '↓')); orderCell.append(order); tr.append(orderCell);
      body.append(tr);
    });
    const panels = figurePanelsSelected(); const estimate = root.querySelector('#gpv-builder-estimate');
    root.querySelector('#gpv-contact-sheet').disabled = !panels.length; root.querySelector('#gpv-builder-svg').disabled = !panels.length;
    if (!savedViews.length) { estimate.textContent = 'Save a view above to start a figure.'; return; }
    if (!panels.length) { estimate.textContent = 'No view is ticked.'; return; }
    const layout = figureLayout(panels.length, panels);
    estimate.textContent = panels.length + ' panel' + (panels.length === 1 ? '' : 's') + ' · ' + layout.columns + ' column' + (layout.columns === 1 ? '' : 's') + ' · ' + layout.width + ' × ' + layout.height + ' px' + (layout.requested.dpi ? ' · ' + layout.requested.mm + ' mm wide at ' + layout.requested.dpi + ' dpi · text ' + layout.requested.points + ' pt' : '') + ' · each panel ' + layout.cellWidth + ' × ' + layout.cellHeight + ' px' + (layout.architecture ? ' · architecture row ' + layout.architectureRow + ' px' : layout.options.architecture ? ' · no domains for an architecture row' : '');
  }
  async function downloadFigure(kind) {
    const panels = figurePanelsSelected();
    const button = root.querySelector(kind === 'svg' ? '#gpv-builder-svg' : '#gpv-contact-sheet'); const idle = button.textContent;
    if (!panels.length) { announce('Tick at least one saved view for the figure', 'error'); return; }
    const layout = figureLayout(panels.length, panels); const options = layout.options; const palette = figurePalette();
    const done = setBusy('Rendering figure…'); button.disabled = true; button.textContent = 'Rendering…'; await afterPaint();
    const restore = captureViewState();
    const canvas = kind === 'png' ? document.createElement('canvas') : null; let context = null;
    if (canvas) { canvas.width = layout.width; canvas.height = layout.height; context = canvas.getContext('2d'); context.fillStyle = palette.paper; context.fillRect(0, 0, canvas.width, canvas.height); }
    const parts = []; const scale = figureScale(layout.cellPlan);
    const svgText = (x, y, size, weight, value) => '<text x="' + f(x) + '" y="' + f(y) + '" dominant-baseline="central" font-family="' + svgFont + '" font-size="' + f(size) + '" font-weight="' + weight + '" fill="' + palette.ink + '">' + svgEscape(value) + '</text>';
    try {
      for (let index = 0; index < panels.length; index += 1) {
        button.textContent = 'Rendering ' + (index + 1) + ' / ' + panels.length + '…'; await afterPaint();
        applyViewState(panels[index], { panels: false });
        const x = (index % layout.columns) * layout.cellWidth; const y = Math.floor(index / layout.columns) * (layout.cellHeight + layout.captionHeight);
        const uri = await renderPublicationImage(null, layout.cellPlan, kind === 'png');
        const wanted = options.legends && legendItems('figure') !== null; const bar = options.legends ? scaleBarSpec(exportViewer, layout.cellPlan) : null;
        const letter = String.fromCharCode(65 + index); const captionLines = layout.captionLines(panels[index]);
        const firstLine = y + layout.cellHeight + Math.round(layout.fontPx * 1.1); const lineStep = Math.round(layout.fontPx * 1.3);
        const textX = x + layout.inset + layout.letterWidth;
        if (kind === 'png') {
          context.drawImage(await loadImage(uri), x, y, layout.cellWidth, layout.cellHeight);
          context.save(); context.translate(x, y); drawFurniture(context, layout.cellWidth, layout.cellHeight, scale, bar, palette, wanted); context.restore();
          context.fillStyle = palette.ink; context.textBaseline = 'middle';
          if (options.letters) { context.font = '700 ' + Math.round(layout.fontPx * 1.3) + 'px ' + figureFont(); context.fillText(letter, x + layout.inset, firstLine); }
          context.font = '500 ' + layout.fontPx + 'px ' + figureFont();
          captionLines.forEach((line, lineIndex) => context.fillText(line, textX, firstLine + lineIndex * lineStep));
        } else {
          parts.push(svgImage(uri, x, y, layout.cellWidth, layout.cellHeight));
          const overlay = overlaySvg(exportViewer, new Set(displayedEntries().map(entry => entry.id)), layout.cellPlan, false);
          parts.push('<g transform="translate(' + f(x) + ' ' + f(y) + ')">' + overlay + svgFurniture(layout.cellWidth, layout.cellHeight, scale, bar, palette, wanted) + '</g>');
          if (options.letters) parts.push(svgText(x + layout.inset, firstLine, layout.fontPx * 1.3, 700, letter));
          captionLines.forEach((line, lineIndex) => parts.push(svgText(textX, firstLine + lineIndex * lineStep, layout.fontPx, 500, line)));
        }
        /* Back to the on-screen state after each panel, so views with synchronized panels do not
           leave a WebGL context behind per panel (browsers drop the oldest context past their limit). */
        applyViewState(restore, { panels: false });
      }
      if (layout.architecture) {
        const top = layout.rows * (layout.cellHeight + layout.captionHeight) + Math.round(12 * layout.scale);
        if (kind === 'png') drawArchitecture(context, layout.inset, top, layout.width - layout.inset * 2, layout.architecture, layout.scale, palette);
        else parts.push(svgArchitecture(layout.inset, top, layout.width - layout.inset * 2, layout.architecture, layout.scale, palette).markup);
      }
      const stem = 'protein-figure-' + panels.length + '-panel' + (panels.length === 1 ? '' : 's');
      if (kind === 'png') downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), layout.requested.dpi), 'image/png', exportFileName(stem, layout.requested, 'png'));
      else downloadBlob(svgDocument(layout.width, layout.height, palette.paper, parts.join('\n')), 'image/svg+xml', stem + '.svg');
      announce('Figure ' + kind.toUpperCase() + ' downloaded · ' + panels.length + ' panel' + (panels.length === 1 ? '' : 's') + ' · ' + layout.width + ' × ' + layout.height + ' px' + (layout.requested.dpi ? ' · ' + layout.requested.mm + ' mm wide at ' + layout.requested.dpi + ' dpi' : ''));
    } catch (error) {
      announce('Could not render the figure: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); applyViewState(restore, { panels: false }); done(); button.textContent = idle; renderFigureBuilder();
    }
  }
  function downloadContactSheet() { return downloadFigure('png'); }
  root.querySelector('#gpv-builder-svg').addEventListener('click', () => downloadFigure('svg'));
  ['#gpv-panel-columns', '#gpv-builder-captions', '#gpv-builder-letters', '#gpv-builder-legends', '#gpv-builder-architecture', '#gpv-export-mode', '#gpv-print-width', '#gpv-print-custom', '#gpv-print-dpi', '#gpv-print-aspect', '#gpv-print-text', '#gpv-export-size', '#gpv-export-scale']
    .forEach(selector => root.querySelector(selector).addEventListener('change', () => renderFigureBuilder()));

  function downloadCaptions() {
    const provenance = provenanceValues();
    const lines = [provenance.title || 'Protein structure figure', provenance.source, provenance.method, '', ...savedViews.map((view, index) => String.fromCharCode(65 + index) + '. ' + view.name + (view.caption ? ': ' + view.caption : '')), '', provenance.notes].filter((line, index, array) => line || array[index - 1]);
    downloadBlob(lines.join('\n'), 'text/plain', 'protein-figure-captions.txt'); updateStatus('Figure captions downloaded');
  }

  function reportEntries() {
    if (root.querySelector('#gpv-report-scope').value === 'all') return structures;
    const visible = structures.filter(entry => entry.visible);
    return visible.length ? visible : structures;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function paeLimit() {
    const mode = root.querySelector('#gpv-report-pae').value;
    return mode === 'none' ? 0 : mode === 'compact' ? 200 : 400;
  }

  function updateReportEstimate() {
    const label = root.querySelector('#gpv-report-size');
    if (!structures.length) { label.textContent = 'Load models to estimate the report size.'; return; }
    const chosen = reportEntries();
    const limit = paeLimit();
    /* A PAE cell serialises to roughly five characters ("12.3,"). */
    const paeBytes = chosen.reduce((sum, entry) => {
      const matrix = entry.confidence && entry.confidence.pae;
      if (!Array.isArray(matrix) || !limit) return sum;
      const side = Math.min(matrix.length, limit); return sum + side * side * 5;
    }, 0);
    const libraryBytes = root.querySelector('#gpv-report-offline').checked ? 1500000 : 0;
    const bytes = chosen.reduce((sum, entry) => sum + entry.text.length, 0) + paeBytes + libraryBytes;
    label.textContent = chosen.length + ' model' + (chosen.length === 1 ? '' : 's') + ' · roughly ' + formatBytes(bytes)
      + (paeBytes ? ' (PAE ' + formatBytes(paeBytes) + ')' : '')
      + (bytes > 40 * 1024 * 1024 ? ' — large enough to be slow to open; narrow the selection or compact the PAE.' : '');
  }

  function reportConfidence(entry) {
    const confidence = { ...(entry.confidence || {}) };
    const matrix = confidence.pae;
    const limit = paeLimit();
    if (!limit) { delete confidence.pae; delete confidence.tokenChainIds; delete confidence.tokenResidueIds; confidence.paeOmitted = true; return confidence; }
    if (!Array.isArray(matrix)) return confidence;
    /* Float32 rows would serialise as objects, and as 17-digit floats; two decimals is the file precision. */
    const round = value => Math.round(Number(value) * 100) / 100;
    if (matrix.length <= limit) { if (matrix.length && !Array.isArray(matrix[0])) confidence.pae = matrix.map(row => Array.from(row, round)); return confidence; }
    const indices = Array.from({ length: limit }, (_, index) => Math.min(matrix.length - 1, Math.floor(index * matrix.length / limit)));
    confidence.pae = indices.map(row => indices.map(column => round(matrix[row][column])));
    if (Array.isArray(confidence.tokenChainIds)) confidence.tokenChainIds = indices.map(index => confidence.tokenChainIds[index]);
    if (Array.isArray(confidence.tokenResidueIds)) confidence.tokenResidueIds = indices.map(index => confidence.tokenResidueIds[index]);
    confidence.paeOriginalSize = matrix.length;
    confidence.paeDownsampled = true;
    return confidence;
  }

  function reportCoordinates(entry) {
    if (!entry.model || !entry.originalAtoms.length) return null;
    const moved = entry.atoms.some((atom, index) => {
      const original = entry.originalAtoms[index];
      return original && (Math.abs(atom.x - original.x) > 0.001 || Math.abs(atom.y - original.y) > 0.001 || Math.abs(atom.z - original.z) > 0.001);
    });
    if (!moved) return null;
    const round = value => Math.round(value * 1000) / 1000;
    return entry.atoms.flatMap(atom => [round(atom.x), round(atom.y), round(atom.z)]);
  }

  function reportShapes(entry) {
    const round = value => Math.round(value * 1000) / 1000;
    const xyz = point => ({ x: round(point.x), y: round(point.y), z: round(point.z) });
    const shapes = [];
    measurementRecords.forEach(record => {
      if (!record.points.every(point => point.entryId === entry.id)) return;
      const points = record.points.map(resolvePoint);
      if (points.some(point => !point)) return;
      shapes.push({ kind: 'line', start: xyz(points[0]), end: xyz(points[1]), color: '#e11d48', dashed: true });
      if (record.type === 'angle') shapes.push({ kind: 'line', start: xyz(points[1]), end: xyz(points[2]), color: '#e11d48', dashed: true });
      shapes.push({ kind: 'label', position: xyz(record.type === 'angle' ? points[1] : midpoint(points[0], points[1])), text: measurementText(record), color: '#111827', size: 1 });
    });
    annotationRecords.forEach(record => {
      if (record.type === 'screen' || !record.points.every(point => point.entryId === entry.id)) return;
      const points = record.points.map(resolvePoint);
      if (points.some(point => !point)) return;
      if (record.type === 'arrow') shapes.push({ kind: 'arrow', start: xyz(points[0]), end: xyz(points[1]), radius: 0.35 * record.size, color: record.color });
      if (record.type === 'line') shapes.push({ kind: 'cylinder', start: xyz(points[0]), end: xyz(points[1]), radius: 0.15 * record.size, color: record.color, dashed: record.dashed });
      if (record.type === 'marker') shapes.push({ kind: 'sphere', center: xyz(points[0]), radius: 1.4 * record.size, color: record.color, alpha: 0.55 });
      if (record.type === 'callout') {
        const anchor = calloutAnchor(points[0], record);
        shapes.push({ kind: 'cylinder', start: xyz(points[0]), end: xyz(anchor), radius: 0.08 * record.size, color: record.color, dashed: record.dashed });
        shapes.push({ kind: 'sphere', center: xyz(points[0]), radius: 0.45 * record.size, color: record.color, alpha: 1 });
        shapes.push({ kind: 'label', position: xyz(anchor), text: record.text || pointName(record.points[0]), color: record.color, size: record.size });
        return;
      }
      if (record.text) shapes.push({ kind: 'label', position: xyz(shiftBy(points.length > 1 ? midpoint(points[0], points[1]) : points[0], record.offset)), text: record.text, color: record.color, size: record.size });
    });
    return shapes;
  }

  function reportPanelNames() {
    const primary = activeEntry();
    if (!root.querySelector('#gpv-side-by-side').checked || !comparePanels.length) return primary ? [primary.name] : [];
    return [primary ? primary.name : null, ...panelNames()].filter(Boolean);
  }

  /* Offline reports inline the pinned 3Dmol build. The bytes are fetched from the
     same URL the page loaded, and re-checked against the tag's SRI hash so a
     substituted file cannot end up embedded in a report. */
  async function embeddedLibraryTag() {
    const tag = document.querySelector('script[src*="3Dmol"]');
    if (!tag) throw new Error('3Dmol script tag not found');
    const response = await fetch(tag.getAttribute('src'), { mode: 'cors' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const buffer = await response.arrayBuffer();
    const integrity = tag.getAttribute('integrity');
    if (integrity && window.crypto && crypto.subtle) {
      const [algorithm, expected] = integrity.split('-');
      const digest = await crypto.subtle.digest(algorithm.replace('sha', 'SHA-'), buffer);
      const actual = btoa(String.fromCharCode(...new Uint8Array(digest)));
      if (actual !== expected) throw new Error('integrity hash mismatch');
    }
    const text = new TextDecoder().decode(buffer).replace(/<\/script/gi, '<\\/script');
    return '<script>' + text + '<\/script>';
  }

  async function downloadReport() {
    const chosen = reportEntries();
    if (!chosen.length) { announce('Load a model before building a report', 'error'); return; }
    let library = "<script src='https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.4.2/3Dmol-min.js'><\/script>";
    if (root.querySelector('#gpv-report-offline').checked) {
      const done = setBusy('Embedding 3Dmol.js…');
      try { library = await embeddedLibraryTag(); }
      catch (error) { announce('Could not embed 3Dmol.js (' + error.message + '); the report will load it from the CDN instead.', 'error'); }
      finally { done(); }
    }
    const exported = chosen.map(entry => ({
      name: entry.name,
      label: displayName(entry),
      collection: entry.collection || '',
      text: entry.text,
      format: entry.format,
      color: entry.color,
      rank: entry.rank,
      hiddenChains: entry.hiddenChains || [],
      fadedChains: entry.fadedChains || [],
      confidence: reportConfidence(entry),
      coords: reportCoordinates(entry),
      shapes: reportShapes(entry),
      labels: labelRecords.filter(label => label.entryId === entry.id).map(label => ({ text: label.text, chain: label.chain, resi: label.resi, atom: label.atom, ...labelPosition(label), color: label.color || null, size: label.size || 12 }))
    }));
    const chosenNames = new Set(chosen.map(entry => entry.name));
    const contactOwner = contactResult ? entryById(contactResult.entryId) : null;
    const initial = {
      labelStyle: root.querySelector('#gpv-label-style').value,
      outline: root.querySelector('#gpv-outline').value,
      fog: root.querySelector('#gpv-fog').checked,
      contacts: contactOwner && chosenNames.has(contactOwner.name) && contactResult.pairs.size ? {
        model: contactOwner.name, chainA: contactResult.chainA, chainB: contactResult.chainB, cutoff: contactResult.cutoff, mode: contactResult.mode,
        residuesA: contactResult.rowA.residues.map(atom => atom.resi), residuesB: contactResult.rowB.residues.map(atom => atom.resi),
        pairs: [...contactResult.pairs.entries()].map(([key, d]) => { const [i, j] = key.split('|').map(Number); return [contactResult.rowA.residues[i].resi, contactResult.rowB.residues[j].resi, Math.round(d * 1000) / 1000]; })
      } : null,
      panels: reportPanelNames().filter(name => chosenNames.has(name)),
      sync: root.querySelector('#gpv-sync-mode').value,
      camera: typeof viewer.getView === 'function' ? viewer.getView() : null,
      representation: root.querySelector('#gpv-style').value,
      colorMode: root.querySelector('#gpv-color-mode').value,
      aligned: exported.some(entry => Array.isArray(entry.coords)),
      screenText: annotationRecords.filter(record => record.type === 'screen').map(record => ({ text: record.text, color: record.color, size: record.size, corner: record.corner, dx: record.dx || 0, dy: record.dy || 0 })),
      seconds: Number(root.querySelector('#gpv-video-length').value) || 5,
      generated: new Date().toISOString().slice(0, 10),
      version: viewerVersion
    };
    const embed = value => JSON.stringify(value).replace(/</g, '\\u003c');
    const html = reportTemplate({
      domains: JSON.stringify(domainRecords.map(record => { const owner = entryById(record.entryId); return { name: record.name, color: record.color, chain: record.chain, residues: record.residues, scope: record.scope, model: owner ? owner.name : null, collection: owner ? owner.collection || '' : '' }; })),
      chainColors: JSON.stringify(Object.fromEntries([...chainOrder.keys()].map(chain => [chain, chainColor(chain)]))),
      residueThemes: JSON.stringify(residueThemeTables()),
      residueData: JSON.stringify(residueData ? (() => { const owner = entryById(residueData.entryId); return { name: residueData.name, scale: residueData.scale, scope: residueData.scope, model: owner ? owner.name : null, collection: owner ? owner.collection || '' : '', min: dataRange().min, max: dataRange().max, stops: dataScales[residueData.scale] || dataScales.viridis, rows: [...residueData.values.entries()].map(([key, value]) => [key.split('|')[0], Number(key.split('|')[1]), value]).concat([...residueData.byResi.entries()].map(([resi, value]) => ['', resi, value])) }; })() : null),
      heteroMode: JSON.stringify(root.querySelector('#gpv-hetero').value),
      title: (provenanceValues().title || 'Protein Model Report').replace(/[<>&]/g, ''),
      structures: embed(exported),
      views: embed(savedViews),
      metadata: embed(provenanceValues()),
      initial: embed(initial),
      library
    });
    const blob = new Blob([html], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'protein-model-report.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    announce('HTML report downloaded · ' + chosen.length + ' model' + (chosen.length === 1 ? '' : 's') + ' · ' + formatBytes(blob.size));
  }

  /* The report is a standalone page: no build step, one CDN script, and every
     control wired by hand so it opens from a USB stick or an email attachment. */
  function reportTemplate(data) {
    return `<!doctype html>
<html lang='en'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>${data.title}</title>
<link rel='icon' type='image/svg+xml' href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23339cff'/><circle cx='16' cy='16' r='3' fill='%23fff'/></svg>">
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif}
[hidden]{display:none!important}
body{margin:0;padding:18px;background:#111827;color:#f8fafc}
body[data-background='light'],body[data-background='white']{background:#f8fafc;color:#0f172a;color-scheme:light}
main{max-width:1440px;margin:auto}
h1{margin:0 0 6px;font-size:1.5rem}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:0 0 12px}
label{display:grid;gap:4px;font-size:.85rem}
button,select,input{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:inherit}
body[data-background='light'] :is(button,select,input),body[data-background='white'] :is(button,select,input){background:#fff;border-color:#cbd5e1}
button{cursor:pointer}button:hover{filter:brightness(1.12)}button:disabled{opacity:.6;cursor:default}
#view{display:grid;gap:8px}
#view:fullscreen{background:#020617;padding:8px;overflow:hidden}
.pane{display:grid;gap:4px;min-width:0;align-content:start}
.pane-head{display:grid;gap:2px;min-width:0}
.pane-model{width:100%;min-width:0;padding:4px 8px}
.pane-stats{font-size:.78rem;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px}
.stage{position:relative;overflow:hidden;background:#020617;border-radius:10px;border:2px solid transparent;height:60vh;min-height:220px}
body[data-background='light'] .stage,body[data-background='white'] .stage{background:#e2e8f0}
.pane.is-focused .stage{border-color:#339cff}
.strip{display:block;width:100%;cursor:crosshair;border-radius:4px}
.readout{font-size:12px;color:#94a3b8;min-height:16px}
.stage canvas{display:block}
#status{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px;opacity:.85;font-size:.9rem}
.legend{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0;font-size:.85rem}
.legend span{display:flex;align-items:center;gap:5px}.swatch{width:12px;height:12px;display:inline-block;border-radius:2px}
.vlow{background:#ff7d45}.low{background:#ffdb13}.conf{background:#65cbf3}.vhigh{background:#0053d6}
#caption{padding:10px 12px;font-size:1.05rem;background:rgba(51,156,255,.12);border-left:3px solid #339cff;border-radius:8px;margin-bottom:10px}
#pae-wrap{max-width:360px;margin-top:14px}#pae{display:block;width:100%;height:auto}#pae-detail{margin-top:5px;opacity:.8}
#contacts-wrap{max-width:360px;margin-top:14px}#contacts{display:block;width:100%;height:auto;border:1px solid rgba(148,163,184,.4);image-rendering:pixelated}#contacts-detail{margin-top:5px;opacity:.8}
.meta{white-space:pre-wrap;opacity:.85;font-size:.9rem}
.tips{font-size:.85rem;opacity:.7;margin-top:12px}
kbd{font:inherit;padding:0 5px;border:1px solid currentColor;border-radius:4px;font-size:.8em}
</style></head><body data-background='dark'><main>
<h1 id='project-title' hidden></h1><p class='meta' id='project-meta'></p>
<p class='meta' id='generated'></p>
<div class='controls'>
<label id='guided-wrap'>Guided view<select id='guided'><option value=''>Choose a saved view</option></select></label>
<label>Panels<select id='panels'></select></label>
<label>Camera sync<select id='sync'><option value='rotation'>Rotation only</option><option value='full'>Rotation and zoom</option><option value='off'>Independent</option></select></label>
<button id='previous'>Previous</button><button id='next'>Next</button><button id='play'>Play cycle</button>
<label>Interval (seconds)<input id='interval' type='number' min='0.5' max='20' step='0.5' value='2'></label>
<label>Representation<select id='style'><option value='cartoon'>Cartoon</option><option value='stick'>Sticks</option><option value='sphere'>Spheres</option><option value='line'>Lines</option></select></label>
<label>Colors<select id='colors'><option value='plddt'>pLDDT</option><option value='structure'>Model color</option><option value='chain'>Chain</option><option value='charge'>Residue charge</option><option value='hydrophobicity'>Hydrophobicity</option><option value='restype'>Residue type</option><option value='amino'>Amino acid</option><option value='ss'>Secondary structure</option><option value='annotated'>Annotated domains</option><option value='data'>Per-residue data</option><option value='spectrum'>Spectrum</option><option value='element'>Element</option></select></label>
<label>Ligands<select id='hetero'><option value='stick'>Sticks</option><option value='sphere'>Spheres</option><option value='hide'>Hidden</option></select></label>
<label>Background<select id='background'><option value='dark'>Dark</option><option value='light'>Light</option><option value='white'>White</option><option value='transparent'>Transparent</option></select></label>
<button id='spin'>Spin</button><button id='fit'>Fit</button><button id='fullscreen'>Full screen</button><button id='png'>Download PNG</button><button id='video'>Record video</button>
</div>
<div id='caption' hidden></div>
<div class='legend' id='legend'><span><i class='swatch vlow'></i>&lt;50</span><span><i class='swatch low'></i>50–70</span><span><i class='swatch conf'></i>70–90</span><span><i class='swatch vhigh'></i>≥90</span></div><div class='legend' id='domain-legend' hidden></div>
<div id='view'></div>
<div id='status'><span id='name'></span><span id='score'></span><span id='model-confidence'></span><span id='position'></span></div>
<div id='pae-wrap' hidden><canvas id='pae' width='360' height='360' aria-label='Predicted aligned error heatmap'></canvas><div id='pae-detail'>Predicted aligned error (Å)</div></div>
<div id='contacts-wrap' hidden><canvas id='contacts' width='360' height='360' aria-label='Residue contact map between two chains'></canvas><div id='contacts-detail'></div></div>
<p class='tips'>Drag any panel to rotate them all · scroll to zoom · click a panel to focus it for the readout and PAE · <kbd>←</kbd> <kbd>→</kbd> step every panel · <kbd>Space</kbd> plays · <kbd>F</kbd> fits · <kbd>S</kbd> spins</p>
${data.library}
<script>
const structures=${data.structures};
const savedViews=${data.views};
const metadata=${data.metadata};
const initial=${data.initial};
const chainColors=${data.chainColors};
const domainRecords=${data.domains};
const residueDataset=${data.residueData};
const residueThemes=${data.residueThemes};
const initialHetero=${data.heteroMode};
const el = id => document.getElementById(id);
const directContexts = typeof OffscreenCanvas !== 'undefined' && !(window.chrome && /Chrom/.test(navigator.userAgent));
const MAX_PANES = 6;
const panes = [];
let timer = 0, spinning = false, syncing = false, syncFrame = 0, focused = 0, recording = false;
const title = el('project-title');
if (metadata.title) { title.hidden = false; title.textContent = metadata.title; }
el('project-meta').textContent = [metadata.source, metadata.method, metadata.notes].filter(Boolean).join(' · ');
el('generated').textContent = 'Interactive report generated by Protein Structure Viewer ' + initial.version + ' on ' + initial.generated + '. Predicted structures are predictions, not experimental determinations.' + (initial.aligned ? ' Superposed models are shown in their aligned positions.' : '');
const guided = el('guided'), guidedWrap = el('guided-wrap');
if (!savedViews.length) guidedWrap.hidden = true;
savedViews.forEach((v, i) => { const o = document.createElement('option'); o.value = i; o.textContent = String.fromCharCode(65 + i) + ' · ' + v.name; guided.append(o); });
const panelSelect = el('panels');
for (let n = 1; n <= Math.min(MAX_PANES, Math.max(1, structures.length)); n++) panelSelect.append(new Option(n === 1 ? '1 panel' : n + ' panels', String(n)));
if (['cartoon', 'stick', 'sphere', 'line'].includes(initial.representation)) el('style').value = initial.representation;
if (['plddt', 'structure', 'chain', 'charge', 'hydrophobicity', 'restype', 'amino', 'ss', 'annotated', 'data', 'spectrum', 'element'].includes(initial.colorMode)) el('colors').value = initial.colorMode;
if (['stick', 'sphere', 'hide'].includes(initialHetero)) el('hetero').value = initialHetero;
el('sync').value = initial.sync === 'full' ? 'full' : 'rotation';
el('video').textContent = 'Record ' + initial.seconds + 's video';
function pcolor(v) { return v < 50 ? '#ff7d45' : v < 70 ? '#ffdb13' : v < 90 ? '#65cbf3' : '#0053d6'; }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
function metric(v, d) { return Number.isFinite(Number(v)) ? Number(v).toFixed(d === undefined ? 3 : d) : '—'; }
function backgroundFor(mode) { if (mode === 'white') return { color: '#ffffff', alpha: 1 }; if (mode === 'light') return { color: '#e2e8f0', alpha: 1 }; if (mode === 'transparent') return { color: '#ffffff', alpha: 0 }; return { color: '#0f172a', alpha: 1 }; }
function columnsFor(n) { return n <= 3 ? n : n <= 4 ? 2 : 3; }
function layout() {
  const view = el('view'), n = panes.length, cols = columnsFor(n), rows = Math.ceil(n / cols);
  view.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
  const full = document.fullscreenElement === view;
  const height = full ? 'calc((100vh - ' + (rows * 58 + (rows - 1) * 8 + 16) + 'px) / ' + rows + ')' : n <= 2 ? 'clamp(300px, 62vh, 720px)' : n <= 4 ? 'clamp(240px, 40vh, 480px)' : 'clamp(200px, 32vh, 400px)';
  panes.forEach(p => { p.stage.style.height = height; });
  requestAnimationFrame(() => panes.forEach(p => { p.viewer.resize(); p.viewer.render(); }));
}
function mixHex(color, target, amount) {
  const parse = v => { const m = /^#([0-9a-f]{6})$/i.exec(String(v || '').trim()); return m ? [0, 2, 4].map(o => parseInt(m[1].slice(o, o + 2), 16)) : null; };
  const a = parse(color), b = parse(target); if (!a || !b) return color;
  return '#' + a.map((ch, i) => Math.round(ch + (b[i] - ch) * amount).toString(16).padStart(2, '0')).join('');
}
function luminance(hex) { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1; const [r, g, b] = [0, 2, 4].map(o => parseInt(m[1].slice(o, o + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function paperColor() { const bg = backgroundFor(el('background').value); return bg.alpha === 0 ? '#ffffff' : bg.color; }
/* Silhouette outline and depth cueing as set in the viewer when the report was made. */
function applyViewStyle(v) {
  if (!v || typeof v.setViewStyle !== 'function') return;
  const mode = initial.outline, dark = luminance(paperColor()) < 0.45;
  try {
    v.setViewStyle(mode === 'thin' || mode === 'bold' ? { style: 'outline', color: dark ? '#f8fafc' : '#111827', width: mode === 'bold' ? 0.12 : 0.06 } : { style: 'none' });
    if (typeof v.enableFog === 'function') v.enableFog(Boolean(initial.fog));
  } catch (e) { /* older engines keep the plain view */ }
}
function styleSpec(s) {
  const rep = el('style').value, mode = el('colors').value;
  let options = { color: s.color };
  if (mode === 'plddt') options = { colorfunc: a => pcolor(Number(a.b || 0)) };
  if (mode === 'chain') options = { colorfunc: a => chainColors[a.chain || ''] || '#9ca3af' };
  if (residueThemes[mode] && mode !== 'ss') options = { colorfunc: a => residueThemes[mode][String(a.resn || '').toUpperCase()] || residueThemes.fallback };
  if (mode === 'ss') options = { colorfunc: a => residueThemes.ss[a.ss] || residueThemes.ss.c };
  if (mode === 'data') options = { colorfunc: a => dataColorFor(s, a) };
  if (mode === 'annotated') { const lookup = domainLookupFor(s); options = { colorfunc: a => { const r = lookup.get((a.chain || '') + '|' + a.resi); return r ? r.color : '#9ca3af'; } }; }
  if (mode === 'spectrum') options = { colorscheme: 'spectrum' };
  if (mode === 'element') options = { colorscheme: 'default' };
  if (Array.isArray(s.fadedChains) && s.fadedChains.length) {
    const paper = paperColor(), colorOf = options.colorfunc ? options.colorfunc : options.color ? (() => options.color) : null;
    if (colorOf) options = { colorfunc: a => s.fadedChains.includes(a.chain || '') ? mixHex(colorOf(a), paper, 0.72) : colorOf(a) };
  }
  if (rep === 'line') options.linewidth = 2;
  const spec = {}; spec[rep] = options; return spec;
}
function drawContacts(s) {
  const wrap = el('contacts-wrap'), c = initial.contacts;
  if (!c || c.model !== s.name || !Array.isArray(c.pairs)) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const canvas = el('contacts'), ctx = canvas.getContext('2d'), size = 360, n = Math.max(1, c.residuesA.length), m = Math.max(1, c.residuesB.length);
  const light = luminance(paperColor()) >= 0.45;
  ctx.fillStyle = light ? '#ffffff' : '#1f2937'; ctx.fillRect(0, 0, size, size);
  const ia = new Map(c.residuesA.map((r, i) => [r, i])), ib = new Map(c.residuesB.map((r, i) => [r, i])), cw = size / m, ch = size / n;
  c.pairs.forEach(([a, b, d]) => { const i = ia.get(a), j = ib.get(b); if (i === undefined || j === undefined) return; ctx.fillStyle = mixHex('#1e3a8a', light ? '#bfdbfe' : '#93c5fd', Math.max(0, Math.min(1, d / c.cutoff))); ctx.fillRect(j * cw, i * ch, Math.max(1, cw), Math.max(1, ch)); });
  el('contacts-detail').textContent = 'Contacts · chain ' + (c.chainA || '—') + ' (rows) against chain ' + (c.chainB || '—') + ' (columns) · ' + c.pairs.length + ' residue pairs within ' + c.cutoff + ' Å (' + (c.mode === 'ca' ? 'Cα–Cα' : 'any heavy atom') + '); closer pairs darker';
}
function copyView(source, target) {
  const mode = el('sync').value; if (mode === 'off') return;
  const from = source.getView();
  if (mode === 'full') { target.setView(from); return; }
  const own = target.getView();
  target.setView([own[0], own[1], own[2], own[3], from[4], from[5], from[6], from[7]]);
}
const lastViews = new Map();
function sameView(a, b) { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false; return true; }
function seedViews() { panes.forEach(p => lastViews.set(p, p.viewer.getView())); }
function syncNow(pane) {
  if (!pane || el('sync').value === 'off' || panes.length < 2) { seedViews(); return; }
  panes.forEach(p => { if (p !== pane) copyView(pane.viewer, p.viewer); });
  seedViews();
}
function syncTick() {
  if (panes.length > 1 && el('sync').value !== 'off') {
    const changed = panes.find(p => !sameView(lastViews.get(p), p.viewer.getView()));
    if (changed) syncNow(changed);
  }
  requestAnimationFrame(syncTick);
}
requestAnimationFrame(syncTick);
function show(pane, preserveView) {
  const oldView = preserveView ? pane.viewer.getView() : null;
  pane.index = ((pane.index % structures.length) + structures.length) % structures.length;
  pane.select.value = String(pane.index);
  const s = structures[pane.index];
  pane.viewer.removeAllModels(); pane.viewer.removeAllLabels(); pane.viewer.removeAllShapes();
  const m = pane.viewer.addModel(s.text, s.format);
  if (Array.isArray(s.coords)) m.selectedAtoms({}).forEach((a, i) => { if (s.coords.length >= i * 3 + 3) { a.x = s.coords[i * 3]; a.y = s.coords[i * 3 + 1]; a.z = s.coords[i * 3 + 2]; } });
  m.setStyle({}, styleSpec(s));
  const het = el('hetero').value;
  m.setStyle({ hetflag: true }, het === 'hide' ? {} : het === 'sphere' ? { sphere: { scale: 0.35, colorscheme: 'default' } } : { stick: { radius: 0.25, colorscheme: 'default' }, sphere: { scale: 0.28, colorscheme: 'default' } });
  m.setStyle({ resn: ['HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'SOL'] }, {});
  if (Array.isArray(s.hiddenChains) && s.hiddenChains.length) m.setStyle({ chain: s.hiddenChains }, {});
  pane.rows = stripRows(m); drawStrip(pane, s);
  (s.labels || []).forEach(l => pane.viewer.addLabel(l.text, { position: { x: l.x, y: l.y, z: l.z }, backgroundColor: '#fff', fontColor: l.color || '#111827', borderColor: l.color || '#94a3b8', borderThickness: initial.labelStyle === 'plain' ? 0 : 1, showBackground: initial.labelStyle !== 'plain', fontSize: l.size || 12, inFront: true }));
  (s.shapes || []).forEach(sh => {
    if (sh.kind === 'arrow') pane.viewer.addArrow({ start: sh.start, end: sh.end, radius: sh.radius, radiusRatio: 2.2, mid: 0.72, color: sh.color });
    else if (sh.kind === 'cylinder') pane.viewer.addCylinder({ start: sh.start, end: sh.end, radius: sh.radius, color: sh.color, dashed: !!sh.dashed, fromCap: 1, toCap: 1 });
    else if (sh.kind === 'line') pane.viewer.addLine({ start: sh.start, end: sh.end, color: sh.color, dashed: !!sh.dashed, linewidth: 2 });
    else if (sh.kind === 'sphere') pane.viewer.addSphere({ center: sh.center, radius: sh.radius, color: sh.color, alpha: sh.alpha === undefined ? 1 : sh.alpha });
    else if (sh.kind === 'label') pane.viewer.addLabel(sh.text, { position: sh.position, backgroundColor: '#fff', fontColor: sh.color || '#111827', borderColor: sh.color || '#94a3b8', borderThickness: initial.labelStyle === 'plain' ? 0 : 1, showBackground: initial.labelStyle !== 'plain', fontSize: Math.round(13 * (sh.size || 1)), inFront: true, backgroundOpacity: 0.85 });
  });
  if (panes.indexOf(pane) === 0) (initial.screenText || []).forEach(t => {
    const w = pane.stage.clientWidth || 800, h = pane.stage.clientHeight || 480, margin = 16, right = t.corner.endsWith('right'), bottom = t.corner.startsWith('bottom');
    pane.viewer.addLabel(t.text, { position: { x: Math.max(0, Math.min(w, (right ? w - margin : margin) + (t.dx || 0))), y: Math.max(0, Math.min(h, (bottom ? h - margin : margin) + (t.dy || 0))), z: 0 }, useScreen: true, alignment: (bottom ? 'bottom' : 'top') + (right ? 'Right' : 'Left'), backgroundColor: '#fff', fontColor: t.color, borderColor: t.color, borderThickness: 1, fontSize: Math.round(16 * (t.size || 1)), inFront: true, backgroundOpacity: 0.85 });
  });
  if (oldView) pane.viewer.setView(oldView); else pane.viewer.zoomTo();
  pane.viewer.render();
  lastViews.set(pane, pane.viewer.getView());
  pane.plddt = mean(m.selectedAtoms({}).filter(a => a.atom === 'CA' && Number.isFinite(Number(a.b))).map(a => Number(a.b)));
  const c = s.confidence || {};
  pane.stats.textContent = (pane.plddt === null ? 'pLDDT —' : 'pLDDT ' + pane.plddt.toFixed(1)) + (Number.isFinite(Number(c.iptm)) ? ' · ipTM ' + metric(c.iptm, 2) : Number.isFinite(Number(c.ptm)) ? ' · pTM ' + metric(c.ptm, 2) : '');
  if (panes[focused] === pane) describe(pane);
}
function describe(pane) {
  const s = structures[pane.index], c = s.confidence || {};
  el('name').textContent = s.label || s.name;
  el('score').textContent = pane.plddt === null ? 'Mean pLDDT —' : 'Mean pLDDT ' + pane.plddt.toFixed(1);
  el('model-confidence').textContent = 'pTM ' + metric(c.ptm) + ' · ipTM ' + metric(c.iptm) + ' · ranking ' + metric(c.rankingScore) + (c.hasClash ? ' · clash warning' : '');
  el('position').textContent = (pane.index + 1) + ' / ' + structures.length + (panes.length > 1 ? ' · panel ' + (panes.indexOf(pane) + 1) : '');
  drawPae(s); drawContacts(s);
}
function focusPane(pane) {
  if (!pane) return;
  focused = Math.max(0, panes.indexOf(pane));
  panes.forEach(p => p.element.classList.toggle('is-focused', p === pane));
  describe(pane);
}
function drawPae(s) {
  const wrap = el('pae-wrap'), c = s.confidence || {}, matrix = c.pae;
  if (!Array.isArray(matrix) || !matrix.length) { wrap.hidden = !c.paeOmitted; if (c.paeOmitted) { el('pae').hidden = true; el('pae-detail').textContent = 'PAE heatmaps were omitted from this report to keep it small.'; } return; }
  wrap.hidden = false; el('pae').hidden = false;
  const canvas = el('pae'), ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height);
  let max = 1;
  matrix.forEach(r => r.forEach(v => { if (Number.isFinite(Number(v))) max = Math.max(max, Number(v)); }));
  for (let y = 0; y < canvas.height; y++) {
    const row = matrix[Math.min(matrix.length - 1, Math.floor(y * matrix.length / canvas.height))] || [];
    for (let x = 0; x < canvas.width; x++) {
      const v = Number(row[Math.min(row.length - 1, Math.floor(x * row.length / canvas.width))]) || 0, t = Math.max(0, Math.min(1, v / max)), o = (y * canvas.width + x) * 4;
      image.data[o] = Math.round(255 * t); image.data[o + 1] = Math.round(83 + 136 * t); image.data[o + 2] = Math.round(214 - 195 * t); image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  el('pae-detail').textContent = 'PAE · ' + (c.paeOriginalSize || matrix.length) + ' × ' + (c.paeOriginalSize || matrix.length) + ' tokens · maximum ' + max.toFixed(1) + ' Å' + (c.paeDownsampled ? ' · heatmap downsampled for report' : '');
}
function addPane(index) {
  const element = document.createElement('div'); element.className = 'pane';
  const head = document.createElement('div'); head.className = 'pane-head';
  const select = document.createElement('select'); select.className = 'pane-model'; select.setAttribute('aria-label', 'Model shown in this panel');
  structures.forEach((s, i) => select.append(new Option(s.label || s.name, String(i))));
  const stats = document.createElement('span'); stats.className = 'pane-stats';
  head.append(select, stats);
  const stage = document.createElement('div'); stage.className = 'stage';
  const strip = document.createElement('canvas'); strip.className = 'strip'; strip.setAttribute('role', 'img'); strip.setAttribute('aria-label', 'Sequence strip: residues coloured by the current scheme; click to zoom');
  const readout = document.createElement('div'); readout.className = 'readout'; readout.textContent = 'Hover the strip to read a residue; click to zoom to it.';
  element.append(head, stage, strip, readout); el('view').append(element);
  const viewer = $3Dmol.createViewer(stage, Object.assign({ backgroundColor: '#ffffff', backgroundAlpha: 0, antialias: true }, directContexts ? { row: 0, col: 0, rows: 1, cols: 1 } : {}));
  const pane = { element, stage, strip, readout, select, stats, viewer, index, plddt: null, rows: [], mark: null };
  strip.addEventListener('pointermove', e => {
    const hit = stripHit(pane, e); if (!hit) return;
    pane.mark = { row: hit.row, index: hit.index };
    readout.textContent = (hit.chain ? 'Chain ' + hit.chain + ' · ' : '') + (hit.atom.resn || 'RES') + hit.atom.resi + (Number.isFinite(Number(hit.atom.b)) ? ' · pLDDT ' + Number(hit.atom.b).toFixed(1) : '') + ' · click to zoom';
    drawStrip(pane, structures[pane.index]);
  });
  strip.addEventListener('pointerleave', () => { pane.mark = null; readout.textContent = 'Hover the strip to read a residue; click to zoom to it.'; drawStrip(pane, structures[pane.index]); });
  strip.addEventListener('click', e => {
    const hit = stripHit(pane, e); if (!hit) return;
    const sel = { resi: hit.atom.resi }; if (hit.chain) sel.chain = hit.chain;
    pane.viewer.zoomTo(sel); pane.viewer.render(); focusPane(pane);
  });
  const bg = backgroundFor(el('background').value); viewer.setBackgroundColor(bg.color, bg.alpha); applyViewStyle(viewer);
  select.addEventListener('change', () => { stop(); pane.index = Number(select.value); show(pane, true); focusPane(pane); });
  stage.addEventListener('pointerdown', () => focusPane(pane));
  new ResizeObserver(() => { viewer.resize(); drawStrip(pane, structures[pane.index]); }).observe(stage);
  panes.push(pane);
  return pane;
}
function removePane() {
  const pane = panes.pop(); if (!pane) return;
  lastViews.delete(pane);
  const canvas = pane.stage.querySelector('canvas');
  const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'));
  const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  pane.element.remove();
  if (focused >= panes.length && panes.length) focusPane(panes[panes.length - 1]);
}
function setPanels(count) {
  count = Math.max(1, Math.min(MAX_PANES, structures.length, Number(count) || 1));
  while (panes.length > count) removePane();
  while (panes.length < count) { const last = panes[panes.length - 1]; show(addPane(last ? last.index + 1 : 0), false); }
  panelSelect.value = String(panes.length);
  layout();
  syncNow(panes[0]);
  applySpin();
}
function shift(delta) { panes.forEach(p => { p.index += delta; show(p, true); }); }
function domainAppliesTo(r, s) { return r.scope === 'all' || (r.scope === 'model' ? r.model === s.name : r.collection === (s.collection || '')); }
function domainLookupFor(s) {
  if (s.domainLookup) return s.domainLookup;
  const map = new Map();
  domainRecords.filter(r => domainAppliesTo(r, s)).forEach(r => { const chains = r.chain ? [r.chain] : null; (r.residues || []).forEach(resi => (chains || ['*']).forEach(c => { const key = c + '|' + resi; if (!map.has(key)) map.set(key, r); })); });
  s.domainLookup = { get: key => map.get(key) || map.get('*|' + key.split('|')[1]) };
  return s.domainLookup;
}
function gradientAt(stops, t) {
  const c = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)); const p = c * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(p)); const f = p - i;
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }; const a = rgb(stops[i]), b = rgb(stops[i + 1]);
  return '#' + a.map((ch, k) => Math.round(ch + (b[k] - ch) * f).toString(16).padStart(2, '0')).join('');
}
function dataColorFor(s, a) {
  if (!residueDataset || !domainAppliesTo(residueDataset, s)) return '#d1d5db';
  if (!residueDataset.map) { residueDataset.map = new Map(); residueDataset.byResi = new Map(); residueDataset.rows.forEach(r => { if (r[0]) residueDataset.map.set(r[0] + '|' + r[1], r[2]); else residueDataset.byResi.set(Number(r[1]), r[2]); }); }
  const key = (a.chain || '') + '|' + a.resi; const v = residueDataset.map.has(key) ? residueDataset.map.get(key) : residueDataset.byResi.get(a.resi);
  if (v === undefined) return '#d1d5db';
  return gradientAt(residueDataset.stops, (v - residueDataset.min) / ((residueDataset.max - residueDataset.min) || 1));
}
function refreshDomainLegend() {
  const host = el('domain-legend'); if (!host) return;
  const mode = el('colors').value; const show = mode === 'annotated' || mode === 'data';
  host.hidden = !show; host.replaceChildren();
  if (!show) return;
  if (mode === 'data') {
    if (!residueDataset) { host.textContent = 'No per-residue data in this report.'; return; }
    const title = document.createElement('strong'); title.textContent = residueDataset.name; host.append(title);
    [0, 0.25, 0.5, 0.75, 1].forEach(t => { const span = document.createElement('span'); const swatch = document.createElement('i'); swatch.className = 'swatch'; swatch.style.background = gradientAt(residueDataset.stops, t); const v = residueDataset.min + (residueDataset.max - residueDataset.min) * t; span.append(swatch, Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)); host.append(span); });
    return;
  }
  const seen = new Map(); domainRecords.forEach(r => { if (!seen.has(r.name)) seen.set(r.name, r); });
  if (!seen.size) { host.textContent = 'No annotated domains in this report.'; return; }
  [...seen.values()].forEach(r => { const span = document.createElement('span'); const swatch = document.createElement('i'); swatch.className = 'swatch'; swatch.style.background = r.color; span.append(swatch, r.name); host.append(span); });
}
function stripRows(m) {
  const byChain = new Map();
  m.selectedAtoms({}).forEach(a => { if (a.hetflag || a.atom !== 'CA') return; const c = a.chain || ''; if (!byChain.has(c)) byChain.set(c, []); byChain.get(c).push(a); });
  return [...byChain.entries()].map(([chain, atoms]) => ({ chain, atoms: atoms.sort((x, y) => x.resi - y.resi) })).filter(r => r.atoms.length > 1).slice(0, 12);
}
function stripColor(s, a) {
  const mode = el('colors').value;
  if (mode === 'plddt') return pcolor(Number(a.b || 0));
  if (mode === 'chain') return chainColors[a.chain || ''] || '#9ca3af';
  if (mode === 'ss') return residueThemes.ss[a.ss] || residueThemes.ss.c;
  if (mode === 'annotated') { const r = domainLookupFor(s).get((a.chain || '') + '|' + a.resi); return r ? r.color : '#9ca3af'; }
  if (mode === 'data') return dataColorFor(s, a);
  if (residueThemes[mode]) return residueThemes[mode][String(a.resn || '').toUpperCase()] || residueThemes.fallback;
  return s.color;
}
const STRIP_ROW = 12, STRIP_GAP = 3;
function drawStrip(pane, s) {
  if (!pane.strip || !s) return;
  const rows = pane.rows || []; const canvas = pane.strip;
  const width = Math.max(1, pane.stage.clientWidth); const ratio = window.devicePixelRatio || 1;
  const height = rows.length ? rows.length * (STRIP_ROW + STRIP_GAP) - STRIP_GAP : 0;
  canvas.hidden = !rows.length; canvas.style.height = height + 'px';
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(Math.max(1, height) * ratio);
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, Math.max(1, height));
  const hidden = s.hiddenChains || [];
  rows.forEach((row, r) => {
    const cell = width / row.atoms.length; const y = r * (STRIP_ROW + STRIP_GAP);
    ctx.globalAlpha = hidden.includes(row.chain) ? 0.25 : (s.fadedChains || []).includes(row.chain) ? 0.45 : 1;
    row.atoms.forEach((a, i) => { ctx.fillStyle = stripColor(s, a); ctx.fillRect(i * cell, y, Math.max(0.5, cell - (cell > 3 ? 1 : 0)), STRIP_ROW); });
    ctx.globalAlpha = 1;
  });
  if (pane.mark && rows[pane.mark.row]) {
    const row = rows[pane.mark.row]; const cell = width / row.atoms.length;
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2; ctx.strokeRect(pane.mark.index * cell, pane.mark.row * (STRIP_ROW + STRIP_GAP), Math.max(3, cell), STRIP_ROW);
  }
}
function stripHit(pane, event) {
  const rows = pane.rows || []; if (!rows.length) return null;
  const box = pane.strip.getBoundingClientRect();
  const r = Math.min(rows.length - 1, Math.max(0, Math.floor((event.clientY - box.top) / (STRIP_ROW + STRIP_GAP))));
  const row = rows[r]; const index = Math.min(row.atoms.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / Math.max(1, box.width) * row.atoms.length)));
  return { row: r, index, atom: row.atoms[index], chain: row.chain };
}
function refreshAll() { panes.forEach(p => show(p, true)); }
function stop() { clearInterval(timer); timer = 0; el('play').textContent = 'Play cycle'; }
function play() { if (timer) { stop(); return; } const seconds = Math.max(0.5, Number(el('interval').value) || 2); timer = setInterval(() => shift(1), seconds * 1000); el('play').textContent = 'Pause cycle'; }
function applySpin() {
  panes.forEach((p, i) => p.viewer.spin(spinning && (i === 0 || el('sync').value === 'off') ? 'y' : false));
  el('spin').textContent = spinning ? 'Stop spin' : 'Spin';
}
function fit() { panes.forEach(p => { p.viewer.zoomTo(); p.viewer.render(); }); syncNow(panes[0]); }
function applyBackground() {
  const mode = el('background').value, bg = backgroundFor(mode);
  document.body.dataset.background = mode;
  panes.forEach(p => { p.viewer.setBackgroundColor(bg.color, bg.alpha); applyViewStyle(p.viewer); p.viewer.render(); });
  if (structures.some(s => Array.isArray(s.fadedChains) && s.fadedChains.length)) refreshAll();
  if (panes[focused]) describe(panes[focused]);
}
function guide(i) {
  const v = savedViews[Number(i)]; if (!v) return; stop();
  if (v.representation) el('style').value = v.representation;
  if (v.colorMode) el('colors').value = v.colorMode;
  const extra = v.sideBySide ? (Array.isArray(v.comparePanels) ? v.comparePanels : (v.rightModel ? [v.rightModel] : [])) : [];
  const indices = [v.activeModel].concat(extra).map(n => structures.findIndex(s => s.name === n)).filter(k => k >= 0);
  if (indices.length) { setPanels(indices.length); indices.forEach((idx, k) => { panes[k].index = idx; }); }
  panes.forEach(p => show(p, false));
  if (v.camera) { panes[0].viewer.setView(v.camera); panes[0].viewer.render(); }
  const cameras = Array.isArray(v.panelCameras) ? v.panelCameras : [];
  cameras.forEach((cam, k) => { if (cam && panes[k + 1]) { panes[k + 1].viewer.setView(cam); panes[k + 1].viewer.render(); } });
  if (!cameras.length) syncNow(panes[0]);
  focusPane(panes[0]);
  el('legend').hidden = el('colors').value !== 'plddt';
  const caption = el('caption'); caption.hidden = false;
  caption.textContent = String.fromCharCode(65 + Number(i)) + ' · ' + v.name + (v.caption ? ' — ' + v.caption : '');
}
function loadImage(uri) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = uri; }); }
async function downloadPng() {
  if (panes.length === 1) { const a = document.createElement('a'); a.href = panes[0].viewer.pngURI(); a.download = 'protein-model.png'; a.click(); return; }
  const images = await Promise.all(panes.map(p => loadImage(p.viewer.pngURI())));
  const cols = columnsFor(panes.length), rows = Math.ceil(panes.length / cols);
  const w = Math.max.apply(null, images.map(i => i.width)), h = Math.max.apply(null, images.map(i => i.height)), cap = Math.round(h * 0.09);
  const canvas = document.createElement('canvas'); canvas.width = cols * w; canvas.height = rows * (h + cap);
  const ctx = canvas.getContext('2d'), dark = el('background').value === 'dark';
  ctx.fillStyle = dark ? '#0f172a' : '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const x = (i % cols) * w, y = Math.floor(i / cols) * (h + cap);
    ctx.drawImage(img, x, y);
    ctx.fillStyle = dark ? '#f8fafc' : '#111827'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(cap * 0.46) + 'px ' + figureFont();
    ctx.fillText(String.fromCharCode(65 + i), x + Math.round(w * 0.025), y + h + cap / 2);
    ctx.font = '500 ' + Math.round(cap * 0.34) + 'px ' + figureFont();
    const s = structures[panes[i].index];
    ctx.fillText((s.label || s.name) + (panes[i].plddt === null ? '' : ' · mean pLDDT ' + panes[i].plddt.toFixed(1)), x + Math.round(w * 0.08), y + h + cap / 2);
  });
  const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'protein-comparison-' + panes.length + '-panels.png'; a.click();
}
function record() {
  if (recording) return;
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) { alert('Video recording is not supported by this browser. Chrome and Firefox support it; Safari does not.'); return; }
  const button = el('video'), seconds = initial.seconds;
  const sources = panes.map(p => p.stage.querySelector('canvas')).filter(Boolean);
  if (!sources.length) return;
  const cols = columnsFor(sources.length), rows = Math.ceil(sources.length / cols);
  const w = Math.max.apply(null, sources.map(c => c.width)), h = Math.max.apply(null, sources.map(c => c.height));
  const composite = document.createElement('canvas'); composite.width = cols * w; composite.height = rows * h;
  const ctx = composite.getContext('2d'), bg = backgroundFor(el('background').value);
  let frame = 0;
  const draw = () => { ctx.fillStyle = bg.alpha ? bg.color : '#ffffff'; ctx.fillRect(0, 0, composite.width, composite.height); sources.forEach((c, i) => ctx.drawImage(c, (i % cols) * w, Math.floor(i / cols) * h, w, h)); frame = requestAnimationFrame(draw); };
  const stream = composite.captureStream(30);
  const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: type }), chunks = [];
  const wasSpinning = spinning;
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop());
    spinning = wasSpinning; applySpin();
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), a = document.createElement('a');
    a.href = url; a.download = 'protein-spin.webm'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    recording = false; button.disabled = false; button.textContent = 'Record ' + seconds + 's video';
  };
  recording = true; button.disabled = true; button.textContent = 'Recording…';
  spinning = true; applySpin(); draw(); recorder.start();
  setTimeout(() => recorder.stop(), seconds * 1000);
}
guided.addEventListener('change', e => guide(e.target.value));
panelSelect.addEventListener('change', e => { stop(); setPanels(e.target.value); });
el('sync').addEventListener('change', () => { applySpin(); syncNow(panes[focused] || panes[0]); });
el('previous').onclick = () => { stop(); shift(-1); };
el('next').onclick = () => { stop(); shift(1); };
el('play').onclick = play;
el('style').onchange = refreshAll;
el('colors').onchange = () => { refreshAll(); el('legend').hidden = el('colors').value !== 'plddt'; refreshDomainLegend(); };
refreshDomainLegend();
el('hetero').onchange = () => refreshAll();
el('background').onchange = applyBackground;
el('spin').onclick = () => { spinning = !spinning; applySpin(); };
el('fit').onclick = fit;
el('fullscreen').onclick = () => { const view = el('view'); if (document.fullscreenElement) document.exitFullscreen(); else if (view.requestFullscreen) view.requestFullscreen(); };
document.addEventListener('fullscreenchange', () => { el('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; layout(); });
el('png').onclick = downloadPng;
el('video').onclick = record;
window.addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.matches('input,select,textarea')) return;
  if (e.key === 'ArrowLeft') { stop(); shift(-1); }
  if (e.key === 'ArrowRight') { stop(); shift(1); }
  if (e.key === ' ') { e.preventDefault(); play(); }
  if (e.key === 'f' || e.key === 'F') fit();
  if (e.key === 's' || e.key === 'S') { spinning = !spinning; applySpin(); }
});
const startIndices = (initial.panels || []).map(n => structures.findIndex(s => s.name === n)).filter(k => k >= 0);
setPanels(Math.max(1, startIndices.length));
startIndices.forEach((idx, k) => { if (panes[k]) panes[k].index = idx; });
panes.forEach(p => show(p, false));
if (initial.camera && panes[0]) { const own = panes[0].viewer.getView(); panes[0].viewer.setView([own[0], own[1], own[2], own[3], initial.camera[4], initial.camera[5], initial.camera[6], initial.camera[7]]); panes[0].viewer.render(); }
syncNow(panes[0]);
focusPane(panes[0]);
el('legend').hidden = el('colors').value !== 'plddt';
applyBackground();
<\/script></main></body></html>`;
  }

