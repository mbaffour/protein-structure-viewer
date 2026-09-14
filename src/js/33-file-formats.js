  /* ---------- File formats ---------- */

  const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  /* Canvas PNGs carry no resolution. Insert a pHYs chunk after IHDR so the file
     states its dpi, which is what journals check. */
  async function pngWithDpi(uri, dpi) {
    const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
    if (!dpi) return new Blob([bytes], { type: 'image/png' });
    const perMetre = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21); const view = new DataView(chunk.buffer);
    view.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); view.setUint32(8, perMetre); view.setUint32(12, perMetre); chunk[16] = 1;
    view.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, 33), 0); out.set(chunk, 33); out.set(bytes.subarray(33), 33 + chunk.length);
    return new Blob([out], { type: 'image/png' });
  }

  /* Baseline TIFF: uncompressed RGBA, one strip, resolution in dpi. */
  async function tiffFromImage(uri, dpi) {
    const image = await loadImage(uri); const width = image.naturalWidth; const height = image.naturalHeight;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const tagCount = 14; const ifdOffset = 8; const ifdSize = 2 + tagCount * 12 + 4;
    const bitsOffset = ifdOffset + ifdSize; const xresOffset = bitsOffset + 8; const yresOffset = xresOffset + 8; const dataOffset = yresOffset + 8;
    const buffer = new ArrayBuffer(dataOffset + pixels.length); const view = new DataView(buffer); const bytes = new Uint8Array(buffer);
    bytes.set([0x49, 0x49, 0x2a, 0x00], 0); view.setUint32(4, ifdOffset, true);
    let p = ifdOffset; view.setUint16(p, tagCount, true); p += 2;
    const entry = (tag, type, count, value) => { view.setUint16(p, tag, true); view.setUint16(p + 2, type, true); view.setUint32(p + 4, count, true); if (type === 3 && count === 1) view.setUint16(p + 8, value, true); else view.setUint32(p + 8, value, true); p += 12; };
    entry(256, 4, 1, width); entry(257, 4, 1, height); entry(258, 3, 4, bitsOffset); entry(259, 3, 1, 1); entry(262, 3, 1, 2); entry(273, 4, 1, dataOffset);
    entry(277, 3, 1, 4); entry(278, 4, 1, height); entry(279, 4, 1, pixels.length); entry(282, 5, 1, xresOffset); entry(283, 5, 1, yresOffset); entry(284, 3, 1, 1); entry(296, 3, 1, 2); entry(338, 3, 1, 2);
    view.setUint32(p, 0, true);
    [0, 2, 4, 6].forEach(offset => view.setUint16(bitsOffset + offset, 8, true));
    view.setUint32(xresOffset, dpi, true); view.setUint32(xresOffset + 4, 1, true); view.setUint32(yresOffset, dpi, true); view.setUint32(yresOffset + 4, 1, true);
    bytes.set(pixels, dataOffset);
    return new Blob([buffer], { type: 'image/tiff' });
  }

  async function downloadPublicationTiff() {
    const button = root.querySelector('#gpv-tiff');
    const plan = exportDimensions();
    const done = setBusy('Rendering TIFF…');
    button.disabled = true;
    await afterPaint();
    try {
      const uri = await withLegend(await renderPublicationImage(null, plan), plan);
      const blob = await tiffFromImage(uri, plan.dpi || 96);
      downloadBlob(blob, 'image/tiff', exportFileName('protein-publication', plan, 'tiff'));
      announce('Publication TIFF downloaded · ' + formatBytes(blob.size) + (plan.dpi ? ' · ' + plan.dpi + ' dpi' : ''));
    } catch (error) {
      announce('Could not render the publication TIFF: ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done(); button.disabled = structures.length === 0;
    }
  }

  function exportFileName(stem, plan, extension) {
    return stem + '-' + (plan.mm ? plan.mm + 'mm-' + plan.dpi + 'dpi' : plan.width + 'x' + plan.height) + '.' + extension;
  }

  function truncateToWidth(context, text, maxWidth) {
    let value = String(text || '');
    if (context.measureText(value).width <= maxWidth) return value;
    while (value.length > 1 && context.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
    return value + '…';
  }

  async function renderEntryImage(entry, camera, dimensions, overlays = true) {
    const target = acquireExportViewer(dimensions.width, dimensions.height);
    const background = backgroundSpec();
    target.setBackgroundColor(background.color, background.alpha);
    if (typeof target.setProjection === 'function') target.setProjection(root.querySelector('#gpv-projection').value);
    applyViewStyle(target);
    if (!entry.model) materializeEntry(entry);
    const model = target.addModel(entry.text, entry.format);
    model.selectedAtoms({}).forEach((atom, index) => { const source = entry.atoms[index]; if (source) { atom.x = source.x; atom.y = source.y; atom.z = source.z; } });
    await applyModelStyle(model, entry, target);
    if (overlays) drawOverlays(target, new Set([entry.id]), dimensions, false);
    target.zoomTo();
    if (camera && typeof target.setView === 'function') target.setView(camera);
    target.render();
    await afterPaint();
    return target.pngURI();
  }

