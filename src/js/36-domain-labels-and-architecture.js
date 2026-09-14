  /* ---------- Domain labels and architecture ----------
     Two things a domain figure needs beyond colouring: the domain names written on the
     structure, and the linear architecture bar under it. Both read the domain definition that
     is colouring the structure (annotated domains or PAE domains), use the figure-label names,
     and share the domain colours. Labels are ordinary residue labels placed at the Cα nearest
     each domain's centroid, so they export, share and undo like any label. */
  function figureLabelFor(mode, short, fallback) { return figureLabels[mode + '|' + short] || fallback; }
  function domainSets(entry, prefer = null) {
    if (!entry) return { source: null, items: [] };
    const mode = root.querySelector('#gpv-color-mode').value;
    const annotated = domainRecords.filter(record => domainApplies(record, entry));
    const pae = entry.domains && entry.domains.domains.length ? entry.domains : null;
    const source = prefer === 'annotated' && annotated.length ? 'annotated' : prefer === 'pae' && pae ? 'pae' : mode === 'domain' && pae ? 'pae' : annotated.length ? 'annotated' : pae ? 'pae' : null;
    if (source === 'annotated') {
      const seen = new Map();
      annotated.forEach(record => { if (!seen.has(record.name)) seen.set(record.name, { key: 'annotated|' + record.name, name: figureLabelFor('annotated', clipText(record.name, 18), record.name), color: record.color, tags: new Set() }); });
      domainLookup(entry).forEach((record, tag) => { const item = seen.get(record.name); if (item) item.tags.add(tag); });
      return { source, items: [...seen.values()].filter(item => item.tags.size) };
    }
    if (source === 'pae') return { source, items: pae.domains.map(domain => ({ key: 'domain|D' + domain.id, name: figureLabelFor('domain', 'D' + domain.id, 'D' + domain.id), color: domainColorFor(domain.id), tags: new Set(domain.tags) })) };
    return { source: null, items: [] };
  }
  function labelDomains(prefer = null) {
    const entry = activeEntry(); if (!entry || !entry.model) { announce('Show a model first', 'error'); return; }
    const sets = domainSets(entry, prefer);
    if (!sets.items.length) { announce(prefer === 'pae' ? 'Find PAE domains first (Confidence → Find domains)' : 'Define domains first (Annotate → Domains) or find PAE domains (Confidence)', 'error'); return; }
    remember('domain labels');
    let added = 0;
    sets.items.forEach(item => {
      const cas = entry.atoms.filter(atom => atom.atom === 'CA' && !atom.hetflag && item.tags.has(residueTag(atom)));
      if (!cas.length) return;
      const centre = { x: mean(cas.map(atom => atom.x)), y: mean(cas.map(atom => atom.y)), z: mean(cas.map(atom => atom.z)) };
      let best = cas[0]; let bestDistance = Infinity;
      cas.forEach(atom => { const d = (atom.x - centre.x) ** 2 + (atom.y - centre.y) ** 2 + (atom.z - centre.z) ** 2; if (d < bestDistance) { bestDistance = d; best = atom; } });
      const key = residueKey(entry.id, best.chain || '', best.resi);
      const record = { entryId: entry.id, chain: best.chain || '', resi: best.resi, resn: best.resn || 'RES', atom: 'CA', x: best.x, y: best.y, z: best.z, key, text: item.name, color: item.color, size: 15, kind: 'domain' };
      const index = labelRecords.findIndex(label => label.key === key);
      if (index >= 0) labelRecords[index] = { ...labelRecords[index], ...record }; else labelRecords.push(record);
      added += 1;
    });
    renderLabelList(); rebuildOverlays();
    announce(added + ' domain label' + (added === 1 ? '' : 's') + ' placed at the domain centroids (' + (sets.source === 'pae' ? 'PAE domains' : 'annotated domains') + ') · rename in Annotate → Labels, or rerun after renaming the legend');
  }
  function clearDomainLabels() {
    const before = labelRecords.length;
    if (!labelRecords.some(label => label.kind === 'domain')) { announce('No domain labels to remove'); return; }
    remember('domain labels'); labelRecords = labelRecords.filter(label => label.kind !== 'domain');
    renderLabelList(); rebuildOverlays(); announce((before - labelRecords.length) + ' domain label' + (before - labelRecords.length === 1 ? '' : 's') + ' removed');
  }

  /* The architecture bar: one row per chain, the sequence as a thin line from its first to its
     last residue, a coloured box per contiguous domain run with the name inside (or above when it
     does not fit), residue numbers at the ends and at every domain boundary. */
  function architectureModel(entry, prefer = null) {
    if (!entry || !entry.model) return null;
    const sets = domainSets(entry, prefer); if (!sets.items.length) return null;
    const byTag = new Map(); sets.items.forEach(item => item.tags.forEach(tag => byTag.set(tag, item)));
    const chains = residueRows(entry).map(row => {
      const residues = row.residues; const first = residues[0].resi; const last = residues[residues.length - 1].resi;
      const segments = []; let open = null;
      residues.forEach(atom => {
        const item = byTag.get(residueTag(atom)) || null;
        if (open && open.item === item && atom.resi === open.end + 1) { open.end = atom.resi; return; }
        if (open && open.item) segments.push(open);
        open = { item, start: atom.resi, end: atom.resi };
      });
      if (open && open.item) segments.push(open);
      return { chain: row.chain, first, last, segments };
    }).filter(row => row.segments.length);
    return chains.length ? { source: sets.source, items: sets.items, chains } : null;
  }
  function architectureMetrics(width, scale) {
    return { rowHeight: Math.round(46 * scale), labelWidth: Math.round(64 * scale), pad: Math.round(10 * scale), box: Math.round(14 * scale), font: Math.round(11 * scale), small: Math.round(9 * scale), barX: Math.round(74 * scale), barWidth: Math.max(10, width - Math.round(74 * scale) - Math.round(10 * scale)) };
  }
  function architectureHeight(model, scale) { return model ? model.chains.length * architectureMetrics(100, scale).rowHeight + Math.round(6 * scale) : 0; }
  function architectureRows(model, x0, y0, width, scale, measure) {
    const m = architectureMetrics(width, scale); const rows = [];
    model.chains.forEach((row, index) => {
      const y = y0 + Math.round(3 * scale) + index * m.rowHeight + m.rowHeight / 2; const span = Math.max(1, row.last - row.first); const unit = m.barWidth / span;
      const px = resi => x0 + m.barX + (resi - row.first) / span * m.barWidth; const barEnd = x0 + m.barX + m.barWidth;
      const boxes = row.segments.map((segment, i) => {
        const left = px(segment.start); const right = Math.min(barEnd, px(segment.end) + unit); const next = row.segments[i + 1];
        measure.font = '600 ' + m.font + 'px ' + figureFont();
        const inside = measure.measureText(segment.item.name).width <= right - left - 4 * scale;
        return { left, right, item: segment.item, inside, startLabel: segment.start !== row.first ? String(segment.start) : null, endLabel: segment.end !== row.last && !(next && next.start === segment.end + 1) ? String(segment.end) : null };
      });
      rows.push({ y, chain: 'Chain ' + (row.chain || '—'), barStart: px(row.first), barEnd, first: String(row.first), last: String(row.last), boxes });
    });
    return { m, rows };
  }
  function drawArchitecture(context, x0, y0, width, model, scale, palette) {
    const { m, rows } = architectureRows(model, x0, y0, width, scale, context);
    context.save(); context.textBaseline = 'middle';
    rows.forEach(row => {
      context.fillStyle = palette.ink; context.textAlign = 'left'; context.font = '500 ' + m.font + 'px ' + figureFont();
      context.fillText(truncateToWidth(context, row.chain, m.labelWidth), x0, row.y);
      context.globalAlpha = 0.35; context.fillRect(row.barStart, row.y - Math.max(1, Math.round(1.5 * scale)), row.barEnd - row.barStart, Math.max(2, Math.round(3 * scale))); context.globalAlpha = 1;
      context.font = '400 ' + m.small + 'px ' + figureFont();
      context.textAlign = 'left'; context.fillText(row.first, row.barStart, row.y + m.box / 2 + m.small);
      context.textAlign = 'right'; context.fillText(row.last, row.barEnd, row.y + m.box / 2 + m.small);
      row.boxes.forEach(box => {
        context.fillStyle = box.item.color; context.fillRect(box.left, row.y - m.box / 2, box.right - box.left, m.box);
        context.textAlign = 'center';
        if (box.inside) { context.fillStyle = hexLuminance(box.item.color) > 0.6 ? '#111827' : '#ffffff'; context.font = '600 ' + m.font + 'px ' + figureFont(); context.fillText(box.item.name, (box.left + box.right) / 2, row.y); }
        else { context.fillStyle = palette.ink; context.font = '500 ' + m.small + 'px ' + figureFont(); context.fillText(truncateToWidth(context, box.item.name, Math.max(box.right - box.left + 24 * scale, 40 * scale)), (box.left + box.right) / 2, row.y - m.box / 2 - m.small * 0.8); }
        context.fillStyle = palette.ink; context.font = '400 ' + m.small + 'px ' + figureFont();
        if (box.startLabel) context.fillText(box.startLabel, box.left, row.y + m.box / 2 + m.small);
        if (box.endLabel) context.fillText(box.endLabel, box.right, row.y + m.box / 2 + m.small);
      });
    });
    context.restore();
    return architectureHeight(model, scale);
  }
  function svgArchitecture(x0, y0, width, model, scale, palette) {
    const { m, rows } = architectureRows(model, x0, y0, width, scale, svgMeasure);
    const text = (x, y, size, weight, anchor, fill, value) => '<text x="' + f(x) + '" y="' + f(y) + '" dominant-baseline="central" text-anchor="' + anchor + '" font-family="' + svgFont + '" font-size="' + f(size) + '" font-weight="' + weight + '" fill="' + fill + '">' + svgEscape(value) + '</text>';
    const parts = ['<g id="architecture">'];
    rows.forEach(row => {
      parts.push(text(x0, row.y, m.font, 500, 'start', palette.ink, row.chain));
      parts.push('<rect x="' + f(row.barStart) + '" y="' + f(row.y - Math.max(1, 1.5 * scale)) + '" width="' + f(row.barEnd - row.barStart) + '" height="' + f(Math.max(2, 3 * scale)) + '" fill="' + palette.ink + '" fill-opacity="0.35"/>');
      parts.push(text(row.barStart, row.y + m.box / 2 + m.small, m.small, 400, 'start', palette.ink, row.first));
      parts.push(text(row.barEnd, row.y + m.box / 2 + m.small, m.small, 400, 'end', palette.ink, row.last));
      row.boxes.forEach(box => {
        parts.push('<rect x="' + f(box.left) + '" y="' + f(row.y - m.box / 2) + '" width="' + f(box.right - box.left) + '" height="' + f(m.box) + '" fill="' + box.item.color + '"/>');
        if (box.inside) parts.push(text((box.left + box.right) / 2, row.y, m.font, 600, 'middle', hexLuminance(box.item.color) > 0.6 ? '#111827' : '#ffffff', box.item.name));
        else { svgMeasure.font = '500 ' + m.small + 'px ' + svgFont; parts.push(text((box.left + box.right) / 2, row.y - m.box / 2 - m.small * 0.8, m.small, 500, 'middle', palette.ink, truncateToWidth(svgMeasure, box.item.name, Math.max(box.right - box.left + 24 * scale, 40 * scale)))); }
        if (box.startLabel) parts.push(text(box.left, row.y + m.box / 2 + m.small, m.small, 400, 'middle', palette.ink, box.startLabel));
        if (box.endLabel) parts.push(text(box.right, row.y + m.box / 2 + m.small, m.small, 400, 'middle', palette.ink, box.endLabel));
      });
    });
    parts.push('</g>');
    return { markup: parts.join(''), height: architectureHeight(model, scale) };
  }
  async function downloadArchitecture(kind) {
    const entry = activeEntry(); const model = architectureModel(entry);
    if (!model) { announce('No domains to draw: define domains in Annotate, or find PAE domains in Confidence', 'error'); return; }
    const plan = exportDimensions(); const scale = figureScale(plan); const palette = figurePalette(); const pad = Math.round(16 * scale);
    const width = plan.width; const height = architectureHeight(model, scale) + pad * 2;
    if (kind === 'png') {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
      context.fillStyle = palette.paper; context.fillRect(0, 0, width, height);
      drawArchitecture(context, pad, pad, width - pad * 2, model, scale, palette);
      downloadBlob(await pngWithDpi(canvas.toDataURL('image/png'), plan.dpi), 'image/png', exportFileName('protein-domain-architecture', plan, 'png'));
    } else {
      downloadBlob(svgDocument(width, height, palette.paper, svgArchitecture(pad, pad, width - pad * 2, model, scale, palette).markup), 'image/svg+xml', 'protein-domain-architecture.svg');
    }
    announce('Domain architecture ' + kind.toUpperCase() + ' downloaded · ' + model.chains.length + ' chain' + (model.chains.length === 1 ? '' : 's') + ' · ' + model.items.length + ' domain' + (model.items.length === 1 ? '' : 's') + ' (' + (model.source === 'pae' ? 'PAE domains' : 'annotated domains') + ') · ' + width + ' × ' + height + ' px' + (plan.dpi ? ' at ' + plan.dpi + ' dpi' : ''));
  }
  root.querySelector('#gpv-domain-labels').addEventListener('click', () => labelDomains('annotated'));
  root.querySelector('#gpv-pae-domain-labels').addEventListener('click', () => labelDomains('pae'));
  root.querySelector('#gpv-domain-labels-clear').addEventListener('click', clearDomainLabels);
  root.querySelector('#gpv-architecture-png').addEventListener('click', () => downloadArchitecture('png'));
  root.querySelector('#gpv-architecture-svg').addEventListener('click', () => downloadArchitecture('svg'));

