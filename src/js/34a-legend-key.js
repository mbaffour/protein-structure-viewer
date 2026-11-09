  /* ---------- Legend key ----------
     The figure's colour key on its own: a small image of every entry with its exact colour and its
     name, to set beside a figure or in a multi-panel layout where the key belongs outside the
     panels, and a sentence naming each entry's colour in words to paste into the figure legend.
     Nothing here is stored: the key is drawn from legendItems('figure') at the moment it is asked
     for, so it follows the colour scheme, the models shown, their colours and the Figure labels —
     there is no copy to go stale. The image is drawn by the code that draws the legend on every
     exported figure (legendMetrics' rows walked by drawPlddtLegend, and by svgLegend for the SVG),
     at the figure's text scale and in its font, ink and background; the one thing that differs is
     that it is always a row, wrapping at its own width, where the figure's legend may be shrunk,
     stacked down a side, or wrapped to fit a panel. */

  /* Why there is no key, in the words the buttons' tooltips and the text box use; '' when there is. */
  function legendKeyUnavailable() {
    if (!structures.length) return 'Load a model first — the key names what the figure is coloured by.';
    if (legendItems('figure')) return '';
    const mode = root.querySelector('#gpv-color-mode').value;
    const shown = displayedEntries().filter(entry => entry.model);
    const reasons = {
      element: 'Element colouring has no colour key: every atom takes the colour of its element.',
      amino: 'Amino-acid colouring uses twenty colours and prints no key — Residue type or Charge colouring has one.',
      spectrum: 'A sequence spectrum is a ramp from the N- to the C-terminus, not a set of colours, so it has no key.',
      agreement: 'Model agreement is grey until the models are aligned (Compare → Align visible), so it has no key yet.',
      deviation: 'Cα deviation is grey until the models are aligned (Compare → Align visible), so it has no key yet.',
      plddt: 'The shown models carry no pLDDT and are drawn in their model colours, so pLDDT has no key.',
      structure: shown.length > 8 ? 'More than eight models are shown — too many for a per-model key.' : 'One model in its own colour needs no key — show two to eight models, or colour by chain.'
    };
    return reasons[mode] || 'This colour scheme has nothing for a key to name.';
  }

  /* "pLDDT: <50 (orange); 50–70 (yellow); 70–90 (light blue); ≥90 (dark blue)." Each entry as the
     key draws it (item[1], renamed by Figure labels), its colour as a word (colourName, 01), and
     the hex as well only where two entries share a word, so the sentence never names two colours
     alike. A key that stopped at '+N more' is written out in full here — the text has the room. */
  function legendKeyText(legend = legendItems('figure')) {
    if (!legend) return '';
    const entries = legend.full.filter(([, label]) => String(label || '').trim());
    const words = entries.map(([color]) => colourName(color));
    const shared = word => words.filter(other => other === word).length > 1;
    const colour = (color, word) => word + (shared(word) && /^#/.test(String(color)) ? ', ' + String(color).toLowerCase() : '');
    return legend.title + ': ' + entries.map(([color, label], index) => label + ' (' + colour(color, words[index]) + ')').join('; ') + '.';
  }

  /* The key as one row at the figure's text scale, wrapping at the figure's width or at 1200 px of
     screen-scale text (1200 × the text scale), whichever is narrower — so a print key wraps where a
     screen one would, whatever the dpi. (x, y) puts the legend's box at the image's top-left corner:
     the drawers paint it from (x − gap, y + top). */
  function legendKeyLayout(measure) {
    const plan = exportDimensions(); const scale = figureScale(plan);
    const available = Math.min(plan.width, Math.round(1200 * scale));
    const metrics = legendMetrics(measure, scale, 'figure', false, available);
    if (!metrics) return null;
    return { plan, scale, available, metrics, x: metrics.gap, y: -metrics.top, width: Math.ceil(metrics.boxWidth), height: Math.ceil(metrics.height) };
  }
  /* The figure's ink and paper. On a transparent figure the key stays transparent: the paper panel
     the figure puts behind its legend (to keep it legible over the molecule) has nothing to cover
     here, so it is drawn in no colour. */
  function legendKeyPalette(vector) {
    const palette = figurePalette();
    return backgroundSpec().alpha ? palette : { ...palette, paper: vector ? 'none' : 'rgba(0, 0, 0, 0)' };
  }
  function legendKeyCanvas() {
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
    const layout = legendKeyLayout(context); if (!layout) return null;
    canvas.width = layout.width; canvas.height = layout.height;
    const background = backgroundSpec();
    if (background.alpha) { context.fillStyle = background.color; context.fillRect(0, 0, canvas.width, canvas.height); }
    drawPlddtLegend(context, layout.x, layout.y, layout.scale, legendKeyPalette(false), 'figure', false, false, layout.available);
    return { canvas, layout };
  }
  function legendKeySvg() {
    const layout = legendKeyLayout(svgMeasure); if (!layout) return null;
    const background = backgroundSpec();
    const legend = svgLegend(layout.x, layout.y, layout.scale, legendKeyPalette(true), 'figure', false, layout.available);
    return { svg: svgDocument(layout.width, layout.height, background.alpha ? background.color : null, legend.markup), layout };
  }
  /* The raster key in a figure format, encoded as the figure is: the resolution in a PNG or TIFF,
     the physical page in a PDF, flattened onto the paper for JPEG and WebP (which have no alpha). */
  async function legendKeyImage(key = 'png') {
    const drawn = legendKeyCanvas(); if (!drawn) return null;
    const { canvas, layout } = drawn; const plan = layout.plan; const uri = canvas.toDataURL('image/png');
    if (key === 'png') return { blob: await pngWithDpi(uri, plan.dpi), extension: 'png', label: 'PNG', layout };
    if (key === 'tiff') return { blob: await tiffFromImage(uri, plan.dpi || 96), extension: 'tiff', label: 'TIFF', layout };
    if (key === 'pdf') return { blob: (await pdfFromImage(uri, plan)).blob, extension: 'pdf', label: 'PDF', layout };
    const format = imageFormats[key];
    const flat = document.createElement('canvas'); flat.width = canvas.width; flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = figurePalette().paper; context.fillRect(0, 0, flat.width, flat.height); context.drawImage(canvas, 0, 0);
    const blob = await encodeCanvas(flat, format.mime, 0.95);
    if (!blob) throw new Error('this browser could not encode the image');
    const fellBack = blob.type !== format.mime;
    return { blob, extension: fellBack ? 'png' : format.extension, label: fellBack ? 'PNG' : format.label, fellBack, layout };
  }
  function legendKeyFileName(extension) {
    const title = provenanceValues().title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
    return (title || 'protein-figure') + '-legend-key.' + extension;
  }

  async function downloadLegendKey(vector = false) {
    const reason = legendKeyUnavailable();
    if (reason) { announce('No legend key to download: ' + reason, 'error'); return; }
    const button = root.querySelector(vector ? '#gpv-legend-key-svg' : '#gpv-legend-key');
    button.disabled = true;
    try {
      const entries = legendItems('figure').items.length; const count = entries + ' entr' + (entries === 1 ? 'y' : 'ies');
      if (vector) {
        const made = legendKeySvg();
        downloadBlob(made.svg, 'image/svg+xml', legendKeyFileName('svg'));
        announce('Legend key SVG downloaded · ' + count + ' · ' + made.layout.width + ' × ' + made.layout.height + ' · editable text');
      } else {
        const made = await legendKeyImage(imageFormat());
        const plan = made.layout.plan;
        downloadBlob(made.blob, made.blob.type, legendKeyFileName(made.extension));
        announce('Legend key ' + made.label + ' downloaded · ' + count + ' · ' + made.layout.width + ' × ' + made.layout.height + (plan.dpi ? ' at ' + plan.dpi + ' dpi, the figure’s text size' : '') + (made.fellBack ? ' · this browser cannot write ' + imageFormats[imageFormat()].label + ', so a PNG was saved instead' : ''));
      }
    } catch (error) {
      announce('Could not draw the legend key: ' + error.message, 'error');
    } finally { renderLegendKey(); }
  }

  /* Called from renderScreenLegend (31), which every change to the key passes through. The buttons'
     tooltips carry the reason when there is no key, and so does the text box, where it can be read
     without hovering a greyed-out button. */
  function renderLegendKey() {
    const reason = legendKeyUnavailable();
    ['#gpv-legend-key', '#gpv-legend-key-svg'].forEach(selector => {
      const button = root.querySelector(selector);
      if (!button.dataset.keyTip) button.dataset.keyTip = button.dataset.tooltip || '';
      button.disabled = Boolean(reason);
      button.dataset.tooltip = reason ? 'No legend key: ' + reason : button.dataset.keyTip;
    });
    root.querySelector('#gpv-legend-key-copy').disabled = Boolean(reason);
    const field = root.querySelector('#gpv-legend-key-text');
    field.value = reason ? '' : legendKeyText();
    field.placeholder = reason;
  }

  root.querySelector('#gpv-legend-key').addEventListener('click', () => { downloadLegendKey(false); });
  root.querySelector('#gpv-legend-key-svg').addEventListener('click', () => { downloadLegendKey(true); });
  root.querySelector('#gpv-legend-key-copy').addEventListener('click', () => {
    renderLegendKey();
    const text = root.querySelector('#gpv-legend-key-text').value;
    if (text) copyTextOrShow(text, 'Legend text copied — every key entry with its colour in words', 'the legend text');
  });
  /* A faded model's swatch is its tint on the paper, so a new background can change its colour word. */
  ['#gpv-background', '#gpv-background-color'].forEach(selector => root.querySelector(selector).addEventListener('change', renderLegendKey));
