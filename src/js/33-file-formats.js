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

  /* One page, the figure at its physical size. The composed figure goes in as a single image —
     deflated when the browser can (lossless), JPEG otherwise — and the page box is written in
     points from the print width, so the PDF opens at exactly the millimetres asked for. Text is
     part of the image: the SVG export is the one with editable type. */
  async function pdfFromImage(uri, plan) {
    const image = await loadImage(uri);
    const width = image.naturalWidth; const height = image.naturalHeight;
    const dpi = plan.dpi || 96;
    const pageWidth = width / dpi * 72; const pageHeight = height / dpi * 72;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    /* PDF images have no alpha channel here, so flatten onto the figure's paper first. */
    context.fillStyle = figurePalette().paper; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    let stream; let filter;
    if (typeof CompressionStream === 'function') {
      const pixels = context.getImageData(0, 0, width, height).data;
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) { rgb[j] = pixels[i]; rgb[j + 1] = pixels[i + 1]; rgb[j + 2] = pixels[i + 2]; }
      stream = new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      filter = '/FlateDecode';
    } else {
      stream = new Uint8Array(await (await fetch(canvas.toDataURL('image/jpeg', 0.95))).arrayBuffer());
      filter = '/DCTDecode';
    }
    const encoder = new TextEncoder();
    const chunks = []; let length = 0;
    const push = part => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; chunks.push(bytes); length += bytes.length; };
    const offsets = [];
    const object = (number, body, streamBytes) => {
      offsets[number] = length;
      push(number + ' 0 obj\n' + body + '\n');
      if (streamBytes) { push('stream\n'); push(streamBytes); push('\nendstream\n'); }
      push('endobj\n');
    };
    const points = value => (Math.round(value * 100) / 100).toString();
    push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + points(pageWidth) + ' ' + points(pageHeight) + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    object(4, '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ' + filter + ' /Length ' + stream.length + ' >>', stream);
    const content = encoder.encode('q\n' + points(pageWidth) + ' 0 0 ' + points(pageHeight) + ' 0 0 cm\n/Im0 Do\nQ\n');
    object(5, '<< /Length ' + content.length + ' >>', content);
    const xref = length;
    let table = 'xref\n0 6\n0000000000 65535 f \n';
    for (let number = 1; number <= 5; number += 1) table += String(offsets[number]).padStart(10, '0') + ' 00000 n \n';
    push(table);
    push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return { blob: new Blob(chunks, { type: 'application/pdf' }), lossless: filter === '/FlateDecode', pageWidth, pageHeight };
  }

  /* Every format the figure can be saved in. PNG and TIFF carry the resolution in the file; PDF
     carries the physical page size; JPEG and WebP are for slides and email, not for print. */
  const imageFormats = {
    png: { label: 'PNG', extension: 'png' },
    tiff: { label: 'TIFF', extension: 'tiff' },
    pdf: { label: 'PDF', extension: 'pdf' },
    jpeg: { label: 'JPEG', extension: 'jpg', mime: 'image/jpeg', lossy: true },
    webp: { label: 'WebP', extension: 'webp', mime: 'image/webp', lossy: true }
  };
  function imageFormat() {
    const value = root.querySelector('#gpv-image-format').value;
    return imageFormats[value] ? value : 'png';
  }
  function renderImageButton() {
    const format = imageFormats[imageFormat()];
    const button = root.querySelector('#gpv-image');
    if (!button.dataset.busy) button.textContent = 'Download figure ' + format.label;
  }
  /* toBlob falls back to PNG when a browser cannot encode the type asked for; say so rather than
     handing over a .jpg that is really a PNG. */
  function encodeCanvas(canvas, mime, quality) {
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), mime, quality));
  }
  async function downloadPublicationImage() {
    const key = imageFormat(); const format = imageFormats[key];
    const button = root.querySelector('#gpv-image');
    const plan = exportDimensions();
    if (plan.width * plan.height > 6000000) toast('Rendering ' + plan.width + ' × ' + plan.height + ' — this can take a while and the page will not respond meanwhile.');
    const done = setBusy('Rendering ' + format.label + '…');
    button.dataset.busy = '1'; button.disabled = true; button.textContent = 'Rendering…';
    await afterPaint();
    try {
      const uri = await withLegend(await renderPublicationImage(null, plan), plan);
      const size = plan.width + ' × ' + plan.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi (' + plan.mm + ' mm wide)' : '');
      if (key === 'png') {
        const blob = await pngWithDpi(uri, plan.dpi);
        downloadBlob(blob, 'image/png', exportFileName('protein-publication', plan, 'png'));
        announce('Figure PNG downloaded · ' + size + (plan.capped ? ' · size capped for browser stability' : ''));
      } else if (key === 'tiff') {
        const blob = await tiffFromImage(uri, plan.dpi || 96);
        downloadBlob(blob, 'image/tiff', exportFileName('protein-publication', plan, 'tiff'));
        announce('Figure TIFF downloaded · ' + formatBytes(blob.size) + ' · ' + size);
      } else if (key === 'pdf') {
        const pdf = await pdfFromImage(uri, plan);
        downloadBlob(pdf.blob, 'application/pdf', exportFileName('protein-publication', plan, 'pdf'));
        announce('Figure PDF downloaded · page ' + (Math.round(pdf.pageWidth / 72 * 25.4)) + ' × ' + Math.round(pdf.pageHeight / 72 * 25.4) + ' mm · ' + size + ' · ' + (pdf.lossless ? 'lossless image' : 'JPEG image, this browser cannot deflate') + ' · text is part of the image, use SVG for editable type');
      } else {
        const image = await loadImage(uri);
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = figurePalette().paper; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const blob = await encodeCanvas(canvas, format.mime, 0.95);
        const fellBack = !blob || blob.type !== format.mime;
        const extension = fellBack ? 'png' : format.extension;
        downloadBlob(blob, blob ? blob.type : 'image/png', exportFileName('protein-publication', plan, extension));
        announce('Figure ' + (fellBack ? 'PNG' : format.label) + ' downloaded · ' + formatBytes(blob.size) + ' · ' + size + (fellBack ? ' · this browser cannot write ' + format.label + ', so a PNG was saved instead' : ' · lossy, and without a resolution field: use PNG, TIFF or PDF for print'));
      }
    } catch (error) {
      announce('Could not render the figure ' + format.label + ': ' + error.message, 'error');
    } finally {
      releaseExportViewer(); done();
      delete button.dataset.busy; button.disabled = structures.length === 0; renderImageButton();
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
    const shownIds = new Set([entry.id]);
    /* Camera first, then the overlays: this panel's labels are placed in this panel's projection,
       which does not exist until the camera is on. The second zoomTo keeps the clipping planes this
       panel has always had — they are computed with the overlay shapes in the scene. */
    const frame = () => { target.zoomTo(); if (camera && typeof target.setView === 'function') target.setView(camera); };
    frame();
    if (overlays) drawOverlays(target, shownIds, dimensions, false, panelLabelPlacement(target, dimensions, shownIds));
    frame();
    target.render();
    await afterPaint();
    return target.pngURI();
  }

