  /* ---------- Publication checklist ----------
     Reads the current export and appearance settings and lists what a journal or a reviewer
     would flag: physical size and resolution, text size, colour-blind safety, legend, scale-bar
     projection, unaligned models, missing title. Each warning has a one-click fix where one exists. */
  function publicationChecks() {
    const items = [];
    const push = (level, text, fix) => items.push({ level, text, fix });
    const plan = exportDimensions();
    const mode = root.querySelector('#gpv-color-mode').value;
    const shown = displayedEntries().filter(entry => entry.model);
    const format = imageFormat();
    if (format === 'jpeg' || format === 'webp') push('warn', imageFormats[format].label + ' is lossy and carries no resolution field: fine for slides, not for a figure a journal will print. Save PNG, TIFF or PDF instead.', { label: 'Use PNG', action: () => { root.querySelector('#gpv-image-format').value = 'png'; root.querySelector('#gpv-image-format').dispatchEvent(new Event('change', { bubbles: true })); } });
    else if (format === 'pdf') push('ok', 'PDF at the physical page size; the text in it is part of the image, so keep the SVG if an editor needs to retype a label.');
    if (plan.dpi) push('ok', 'Print size ' + plan.mm + ' × ' + Math.round(plan.heightMm) + ' mm at ' + plan.dpi + ' dpi (' + plan.width + ' × ' + plan.height + ' px), written into the PNG and TIFF.');
    else push('warn', 'Pixel export: the file carries no physical size. Choose a print width and 300 dpi so the journal sees the figure at the size you intend.', { label: 'Use print size', action: () => { root.querySelector('#gpv-export-mode').value = 'print'; root.querySelector('#gpv-export-mode').dispatchEvent(new Event('change', { bubbles: true })); } });
    if (plan.dpi && plan.dpi < 300) push('warn', plan.dpi + ' dpi is below the 300 dpi most journals require for images.');
    if (plan.points) push(plan.points >= 7 ? 'ok' : 'info', 'Text ' + plan.points + ' pt at the printed width' + (plan.points < 7 ? ' — 7 pt is the common minimum; check the journal guide.' : '.'));
    if (['chain', 'entity', 'domain'].includes(mode)) {
      if (safePaletteOn) push('ok', 'Chains and domains use the Okabe–Ito colour-blind-safe palette.');
      else push('warn', 'Chain and domain colours are not colour-blind safe. Turn on the Okabe–Ito palette, or make sure no comparison depends on red against green.', { label: 'Use Okabe–Ito', action: () => { root.querySelector('#gpv-safe-palette').checked = true; root.querySelector('#gpv-safe-palette').dispatchEvent(new Event('change', { bubbles: true })); } });
    }
    if (legendItems('figure') !== null) {
      if (root.querySelector('#gpv-export-legend').checked) push('ok', 'The colour legend is drawn on exports.');
      else push('warn', 'The colours need a key: the legend is switched off for exports.', { label: 'Draw legend', action: () => { root.querySelector('#gpv-export-legend').checked = true; root.querySelector('#gpv-export-legend').dispatchEvent(new Event('change', { bubbles: true })); } });
    }
    const scaleBar = Number(root.querySelector('#gpv-scale-bar').value) || 0;
    const projection = root.querySelector('#gpv-projection').value;
    if (scaleBar && projection !== 'orthographic') push('warn', 'A scale bar is only exact in orthographic projection; in perspective its length depends on depth.', { label: 'Switch to orthographic', action: () => { root.querySelector('#gpv-projection').value = 'orthographic'; applyAppearance(); } });
    else if (scaleBar) push('ok', scaleBar + ' Å scale bar in orthographic projection.');
    if (measurementRecords.length && projection !== 'orthographic') push('info', 'Distances and angles are drawn in perspective; the numbers are exact, but orthographic projection keeps their lengths comparable across a panel.');
    if (shown.length > 1 && !alignmentResults.length) push('warn', shown.length + ' models are shown without superposition. Run Align visible, or state in the legend that the coordinates are as predicted.');
    else if (shown.length > 1) push('ok', shown.length + ' models shown after superposition (' + alignmentResults[0].method + ').');
    const cut = hideBelow();
    if (cut && shown.some(entry => entry.scores.length)) push('info', 'Residues below pLDDT ' + cut + ' are hidden; the figure legend says so — keep that sentence.');
    const background = root.querySelector('#gpv-background').value;
    if (background === 'dark' || background === 'custom') push('info', 'Non-white background. Fine for slides; most journals expect white or transparent for print.');
    const chains = shown.reduce((sum, entry) => sum + residueRows(entry).length, 0);
    if (chains > 4 && root.querySelector('#gpv-outline').value === 'none') push('info', chains + ' chains in view: a thin outline (Appearance → Outline) keeps overlapping chains legible at column width.');
    if (!provenanceValues().title) push('info', 'No figure title yet. A title in Provenance names the exports and appears in the report.');
    else push('ok', 'Figure title set: ' + clipText(provenanceValues().title, 60) + '.');
    if (shown.some(entry => entry.scores.length) && !['plddt', 'deviation', 'agreement'].includes(mode) && !legendWanted('figure')) push('info', 'pLDDT is available but not shown; a confidence panel or legend note helps a reviewer weigh the model.');
    return items;
  }

  function renderPublicationChecks() {
    const list = root.querySelector('#gpv-check-list'); const badge = root.querySelector('#gpv-check-badge');
    if (!list) return;
    if (!structures.length) { list.replaceChildren(); badge.textContent = ''; const li = document.createElement('li'); li.className = 'is-info'; li.innerHTML = '<i>i</i><span>Load a model to check its figure settings.</span>'; list.append(li); return; }
    const items = publicationChecks();
    list.replaceChildren();
    items.forEach(item => {
      const li = document.createElement('li'); li.className = 'is-' + item.level;
      const icon = document.createElement('i'); icon.textContent = item.level === 'ok' ? '✓' : item.level === 'warn' ? '!' : 'i'; icon.setAttribute('aria-label', item.level);
      const text = document.createElement('span'); text.textContent = item.text + ' ';
      if (item.fix) { const button = document.createElement('button'); button.type = 'button'; button.textContent = item.fix.label; button.addEventListener('click', () => { item.fix.action(); renderPublicationChecks(); }); text.append(button); }
      li.append(icon, text); list.append(li);
    });
    const warnings = items.filter(item => item.level === 'warn').length;
    badge.textContent = warnings ? warnings + ' to fix' : 'ready';
  }


