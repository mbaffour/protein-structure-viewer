  /* ---------- Figure annotations ---------- */

  const annotationTools = {
    arrow: { points: 2, label: 'Arrow' },
    line: { points: 2, label: 'Line' },
    marker: { points: 1, label: 'Residue marker' },
    callout: { points: 1, label: 'Text callout' }
  };
  const screenCorners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  function annotationSettings() {
    return {
      color: root.querySelector('#gpv-annotation-color').value,
      size: Number(root.querySelector('#gpv-annotation-size').value) || 1,
      dashed: root.querySelector('#gpv-annotation-dashed').checked,
      text: root.querySelector('#gpv-annotation-text').value.trim()
    };
  }

  function annotationLabelStyle(position, record, scale = 1) {
    return { ...labelStyle(position), fontSize: Math.round(13 * record.size * scale), fontColor: record.color, borderColor: record.color, backgroundOpacity: 0.85 };
  }

  function modelCentroid(entry) {
    const alphaCarbons = entry.atoms.filter(atom => atom.atom === 'CA');
    const source = alphaCarbons.length ? alphaCarbons : entry.atoms;
    if (!source.length) return { x: 0, y: 0, z: 0 };
    const sum = source.reduce((total, atom) => ({ x: total.x + atom.x, y: total.y + atom.y, z: total.z + atom.z }), { x: 0, y: 0, z: 0 });
    return { x: sum.x / source.length, y: sum.y / source.length, z: sum.z / source.length };
  }

  function shiftBy(position, offset) {
    if (!offset) return position;
    return { x: position.x + (offset.x || 0), y: position.y + (offset.y || 0), z: position.z + (offset.z || 0) };
  }

  /* view[4..7] is the quaternion that turns model space into camera space; rotating a
     camera axis by its conjugate gives the model-space direction that reads as
     "screen right" or "screen up" at the current orientation. */
  function screenAxisInModelSpace(view, axis) {
    const x = -view[4], y = -view[5], z = -view[6], w = view[7];
    const ix = w * axis.x + y * axis.z - z * axis.y;
    const iy = w * axis.y + z * axis.x - x * axis.z;
    const iz = w * axis.z + x * axis.y - y * axis.x;
    const iw = -x * axis.x - y * axis.y - z * axis.z;
    return { x: ix * w - iw * x - iy * z + iz * y, y: iy * w - iw * y - iz * x + ix * z, z: iz * w - iw * z - ix * y + iy * x };
  }

  /* A callout floats outward from the model centre so its leader line clears the structure. */
  function calloutAnchor(point, record) {
    const entry = entryById(record.points[0].entryId);
    const centre = entry ? modelCentroid(entry) : { x: 0, y: 0, z: 0 };
    const direction = { x: point.x - centre.x, y: point.y - centre.y, z: point.z - centre.z };
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const distance = Number.isFinite(record.distance) ? record.distance : 8 * record.size;
    return shiftBy({ x: point.x + direction.x / length * distance, y: point.y + direction.y / length * distance, z: point.z + direction.z / length * distance }, record.offset);
  }

  function screenTextSpec(record, dimensions, scale) {
    const margin = Math.round(16 * scale);
    const width = dimensions && dimensions.width ? dimensions.width : 800;
    const height = dimensions && dimensions.height ? dimensions.height : 480;
    const right = record.corner.endsWith('right'); const bottom = record.corner.startsWith('bottom');
    const top = margin + (dimensions && dimensions.topInset ? dimensions.topInset : 0);
    const x = Math.max(0, Math.min(width, (right ? width - margin : margin) + (record.dx || 0) * scale));
    const y = Math.max(0, Math.min(height, (bottom ? height - margin : top) + (record.dy || 0) * scale));
    return {
      ...annotationLabelStyle({ x, y, z: 0 }, record, scale),
      useScreen: true, font: figureFont(),
      alignment: (bottom ? 'bottom' : 'top') + (right ? 'Right' : 'Left'),
      fontSize: Math.round(16 * record.size * scale)
    };
  }

  function drawAnnotations(target, shownIds, dimensions, includeScreenText = true) {
    /* Exports are several times wider than the on-screen stage; keep annotation text legible at print size. */
    const scale = dimensions && dimensions.textScale ? dimensions.textScale : dimensions && dimensions.width ? Math.max(1, dimensions.width / 600) : 1;
    annotationRecords.forEach(record => {
      if (record.type === 'screen') {
        if (includeScreenText) target.addLabel(record.text, screenTextSpec(record, dimensions, scale));
        return;
      }
      if (!record.points.every(point => shownIds.has(point.entryId))) return;
      const points = record.points.map(resolvePoint);
      if (points.some(point => !point)) return;
      if (record.type === 'arrow') target.addArrow({ start: points[0], end: points[1], radius: 0.35 * record.size, radiusRatio: 2.2, mid: 0.72, color: record.color });
      if (record.type === 'line') target.addCylinder({ start: points[0], end: points[1], radius: 0.15 * record.size, color: record.color, dashed: record.dashed, fromCap: 1, toCap: 1 });
      if (record.type === 'marker') target.addSphere({ center: points[0], radius: 1.4 * record.size, color: record.color, alpha: 0.55 });
      if (record.type === 'callout') {
        const anchor = calloutAnchor(points[0], record);
        target.addCylinder({ start: points[0], end: anchor, radius: 0.08 * record.size, color: record.color, dashed: record.dashed, fromCap: 1, toCap: 1 });
        target.addSphere({ center: points[0], radius: 0.45 * record.size, color: record.color });
        target.addLabel(record.text || pointName(record.points[0]), annotationLabelStyle(anchor, record, scale));
        return;
      }
      if (record.text) target.addLabel(record.text, annotationLabelStyle(shiftBy(points.length > 1 ? midpoint(points[0], points[1]) : points[0], record.offset), record, scale));
    });
  }

  function annotationSummary(record) {
    if (record.type === 'screen') return 'Screen text · "' + record.text + '" · ' + record.corner.replace('-', ' ');
    return annotationTools[record.type].label + ' · ' + record.points.map(pointName).join(' → ') + (record.text ? ' · "' + record.text + '"' : '');
  }

  /* A row button is one 12 px step on screen; dyScreen counts upward, as the buttons read. */
  function nudgeAnnotation(record, dxScreen, dyScreen) {
    remember('label nudge');
    nudgeCanvasText({ kind: record.type === 'screen' ? 'screen' : 'annotation', record }, dxScreen * 12, -dyScreen * 12);
    rebuildOverlays();
  }

  function annotationHasLabel(record) {
    return record.type === 'screen' || record.type === 'callout' || Boolean(record.text);
  }

  function renderAnnotationList() {
    const list = root.querySelector('#gpv-annotation-list'); list.replaceChildren();
    annotationRecords.forEach(record => {
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const swatch = document.createElement('i'); swatch.className = 'gpv-swatch'; swatch.style.background = record.color;
      const copy = document.createElement('span'); copy.className = 'gpv-edit-copy';
      const text = document.createElement('input'); text.className = 'form-control'; text.type = 'text'; text.maxLength = 160;
      text.value = record.text || ''; text.placeholder = record.type === 'screen' ? 'Title text' : record.type === 'callout' ? 'Callout text' : 'Optional label';
      text.setAttribute('aria-label', 'Text for this ' + (record.type === 'screen' ? 'screen text' : annotationTools[record.type].label.toLowerCase()));
      text.addEventListener('change', () => {
        const value = text.value.trim();
        if (!value && (record.type === 'screen')) { text.value = record.text; return; }
        remember('annotation text'); record.text = value; renderAnnotationList(); rebuildOverlays(); updateStatus('Annotation text updated');
      });
      text.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); text.blur(); } });
      const where = document.createElement('span'); where.className = 'gpv-entry-source text-small';
      where.textContent = record.type === 'screen' ? 'Screen text · ' + record.corner.replace('-', ' ') : annotationTools[record.type].label + ' · ' + record.points.map(pointName).join(' → ');
      copy.append(text, where);
      const tools = document.createElement('span'); tools.className = 'gpv-edit-tools';
      const color = document.createElement('input'); color.className = 'form-control form-control-color'; color.type = 'color'; color.value = record.color; color.setAttribute('aria-label', 'Annotation colour');
      color.addEventListener('input', () => { if (!color.dataset.remembered) { remember('annotation colour'); color.dataset.remembered = '1'; } record.color = color.value; swatch.style.background = record.color; rebuildOverlays(); });
      color.addEventListener('change', () => { delete color.dataset.remembered; });
      const size = document.createElement('input'); size.className = 'form-control'; size.type = 'number'; size.min = '0.5'; size.max = '3'; size.step = '0.25'; size.value = String(record.size); size.title = 'Size'; size.setAttribute('aria-label', 'Annotation size');
      size.addEventListener('change', () => { remember('annotation size'); record.size = Math.min(3, Math.max(0.5, Number(size.value) || 1)); size.value = String(record.size); rebuildOverlays(); });
      tools.append(color, size);
      row.append(swatch, copy, tools);
      if (annotationHasLabel(record)) {
        const nudge = document.createElement('span'); nudge.className = 'gpv-nudge';
        nudge.setAttribute('role', 'group'); nudge.setAttribute('aria-label', 'Move the label');
        [['←', 'Move label left', -1, 0], ['→', 'Move label right', 1, 0], ['↑', 'Move label up', 0, 1], ['↓', 'Move label down', 0, -1]].forEach(([glyph, title, dx, dy]) => {
          const button = document.createElement('button'); button.className = 'btn btn-ghost'; button.type = 'button'; button.textContent = glyph;
          button.setAttribute('aria-label', title); button.title = title;
          button.addEventListener('click', () => nudgeAnnotation(record, dx, dy));
          nudge.append(button);
        });
        if (record.type === 'callout') {
          const distance = document.createElement('input'); distance.className = 'form-control'; distance.type = 'number'; distance.min = '2'; distance.max = '60'; distance.step = '1';
          distance.value = String(Number.isFinite(record.distance) ? record.distance : Math.round(8 * record.size));
          distance.title = 'Leader length in Å'; distance.setAttribute('aria-label', 'Leader length in angstroms');
          distance.addEventListener('change', () => { remember('leader length'); record.distance = Math.max(2, Math.min(60, Number(distance.value) || 8)); rebuildOverlays(); });
          nudge.append(distance);
        }
        const reset = document.createElement('button'); reset.className = 'btn btn-ghost'; reset.type = 'button'; reset.textContent = 'Reset'; reset.title = 'Put the label back where it started';
        reset.addEventListener('click', () => { remember('label reset'); record.offset = { x: 0, y: 0, z: 0 }; record.dx = 0; record.dy = 0; record.distance = null; renderAnnotationList(); rebuildOverlays(); });
        nudge.append(reset);
        row.append(nudge);
      }
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('annotation removal'); annotationRecords = annotationRecords.filter(item => item.id !== record.id); renderAnnotationList(); rebuildOverlays(); updateStatus('Annotation removed'); });
      row.append(remove); list.append(row);
    });
  }

  function annotationPrompt() {
    const type = root.querySelector('#gpv-annotation-type').value;
    const remaining = annotationTools[type].points - annotationDraft.length;
    return 'Click ' + remaining + ' atom' + (remaining === 1 ? '' : 's') + ' in the main viewer for the ' + annotationTools[type].label.toLowerCase() + '.';
  }

  function toggleAnnotating(force = null) {
    annotationActive = force === null ? !annotationActive : force;
    annotationDraft = [];
    if (annotationActive && measurementActive) toggleMeasurement();
    if (annotationActive && boxSelectMode) setBoxSelectMode(false);
    measureToModesChanged();
    setButtonText(root.querySelector('#gpv-annotate'), annotationActive ? 'Stop drawing' : 'Start drawing');
    root.querySelector('#gpv-stage').classList.toggle('is-drawing', annotationActive);
    root.querySelector('#gpv-annotation-state').textContent = annotationActive ? annotationPrompt() : 'Pick a tool, start drawing, then click atoms in the main viewer.';
  }

  function handleAnnotationClick(entry, atom) {
    annotationDraft.push(atomReference(entry, atom));
    const type = root.querySelector('#gpv-annotation-type').value;
    const needed = annotationTools[type].points;
    if (annotationDraft.length < needed) { root.querySelector('#gpv-annotation-state').textContent = annotationPrompt(); return; }
    remember('annotation');
    annotationRecords.push({ id: nextAnnotationId++, type, points: annotationDraft.slice(0, needed), ...annotationSettings(), offset: { x: 0, y: 0, z: 0 }, distance: null });
    annotationDraft = [];
    renderAnnotationList(); rebuildOverlays();
    root.querySelector('#gpv-annotation-state').textContent = annotationTools[type].label + ' added. ' + annotationPrompt();
    updateStatus(annotationTools[type].label + ' added');
  }

  function addScreenText() {
    const text = root.querySelector('#gpv-screen-text').value.trim();
    if (!text) { updateStatus('Type the screen text first'); return; }
    const settings = annotationSettings();
    remember('corner text');
    annotationRecords.push({ id: nextAnnotationId++, type: 'screen', points: [], text, color: settings.color, size: settings.size, dashed: false, corner: root.querySelector('#gpv-screen-corner').value, dx: 0, dy: 0 });
    root.querySelector('#gpv-screen-text').value = '';
    renderAnnotationList(); rebuildOverlays(); updateStatus('Screen text added');
  }

  /* ---------- Measurements: the list, the editor's own controls, Copy and CSV ----------
     A measurement is { id, type, points } and, once someone has touched its text, { text, showValue,
     offset, color, dashed, autoPlaced }. Every one of those is optional and its absence is the
     measurement as it always was — a crimson dashed line and the bare value at the midpoint — so a
     record made by measurement mode, Measure to…, the card or the distance map, or read back from an
     old scene, needs nothing added to draw exactly as before. */

  /* The measurement whose row the pointer or focus is on: drawn with a thicker line on the main
     viewer only, as a contacts row names its residue (04c). Never saved, never exported. */
  let measurementHover = null;

  function setMeasurementHover(id) {
    if (measurementHover === id) return;
    measurementHover = id;
    rebuildOverlays();
  }

  /* "HIS57 · B NE2 ↔ SER195 · C OG · 3.02 Å": what the row names and the editor offers. */
  function measurementRowText(record) {
    return measurementAtomsText(record) + ' · ' + measurementText(record);
  }

  /* An edit to one measurement from anywhere — its row, the editor, the keyboard — redraws it, and
     the other of the row and the editor follows if it shows the same measurement. `list` false keeps
     the row in place, for a colour picker still being dragged in it. */
  function measurementChanged(record, list = true) {
    if (list) renderMeasurementList();
    if (labelEditor && labelEditor.kind === 'measurement' && labelEditor.id === record.id && labelEditorHost) fillMeasurementEditor(labelEditorHost, record);
    rebuildOverlays();
  }

  function setMeasurementText(record, value) {
    const text = String(value || '').trim().slice(0, 120);
    if ((record.text || '') === text) return false;
    remember('measurement text');
    if (text) record.text = text; else delete record.text;
    return true;
  }

  function setMeasurementFlag(record, field, on, what) {
    if ((record[field] !== false) === on) return;
    remember(what);
    if (on) delete record[field]; else record[field] = false;
    measurementChanged(record);
  }

  function centreOnMeasurement(record) {
    const anchor = measurementAnchor(null, record);
    if (!anchor || typeof viewer.getView !== 'function' || typeof viewer.setView !== 'function') return;
    /* The view's first three numbers are the model group's position — minus the point at the centre
       of the screen — so writing the anchor there centres it and leaves the zoom (view[3]) and the
       rotation exactly as they were. zoomTo would also zoom, and on a measurement between two models
       it has no selection to zoom to. */
    const view = viewer.getView();
    viewer.setView([-anchor.x, -anchor.y, -anchor.z, ...view.slice(3)]);
    viewer.render();
    syncViewsFrom(viewer);
  }

  /* Which row the pointer or focus is on is asked of the list, not of each row: a row is rebuilt by
     every edit made in it, and a row replaced under a resting pointer never hears that it was left —
     the list it sits in does. */
  function watchMeasurementHover(list) {
    if (list.dataset.hoverWatched) return;
    list.dataset.hoverWatched = '1';
    const rowId = target => { const row = target instanceof Element ? target.closest('.gpv-entry[data-measurement-id]') : null; return row && list.contains(row) ? Number(row.dataset.measurementId) : null; };
    list.addEventListener('mouseover', event => setMeasurementHover(rowId(event.target)));
    list.addEventListener('mouseleave', () => setMeasurementHover(rowId(document.activeElement)));
    list.addEventListener('focusin', event => setMeasurementHover(rowId(event.target)));
    list.addEventListener('focusout', event => { if (!list.contains(event.relatedTarget)) setMeasurementHover(list.matches(':hover') ? measurementHover : null); });
  }

  function renderMeasurementList() {
    const list = root.querySelector('#gpv-measurement-list'); list.replaceChildren();
    watchMeasurementHover(list);
    if (measurementHover !== null && !measurementRecords.some(record => record.id === measurementHover)) measurementHover = null;
    ['#gpv-measurements-copy', '#gpv-measurements-csv'].forEach(selector => { const button = root.querySelector(selector); if (button) button.disabled = !measurementRecords.length; });
    updateSeparateLabelsButton();
    measurementRecords.forEach(record => {
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const copy = document.createElement('span'); copy.className = 'gpv-edit-copy';
      const text = document.createElement('input'); text.className = 'form-control'; text.type = 'text'; text.maxLength = 120;
      text.value = record.text || ''; text.placeholder = 'Text (optional)';
      text.setAttribute('aria-label', 'Text for the measurement ' + measurementAtomsText(record));
      text.addEventListener('change', () => { if (setMeasurementText(record, text.value)) { measurementChanged(record); updateStatus('Measurement text updated'); } });
      text.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); text.blur(); } });
      /* The one element of the row with this class: what it names ends in the value, which the
         regression suite reads off the end of it. */
      const where = document.createElement('span'); where.className = 'gpv-entry-name gpv-entry-source text-small';
      where.textContent = measurementRowText(record);
      copy.append(text, where);
      const tools = document.createElement('span'); tools.className = 'gpv-edit-tools';
      const color = document.createElement('input'); color.className = 'form-control form-control-color'; color.type = 'color';
      color.value = measurementColor(record) || '#e11d48'; color.setAttribute('aria-label', 'Measurement colour');
      color.title = 'Colour of the line and the label';
      color.addEventListener('input', () => { if (!color.dataset.remembered) { remember('measurement colour'); color.dataset.remembered = '1'; } record.color = color.value; measurementChanged(record, false); });
      color.addEventListener('change', () => { delete color.dataset.remembered; });
      const toggle = (name, field, what, title) => {
        const wrap = document.createElement('label'); wrap.className = 'form-check gpv-check text-small'; wrap.title = title;
        const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'form-check-input'; box.checked = record[field] !== false;
        box.addEventListener('change', () => setMeasurementFlag(record, field, box.checked, what));
        const words = document.createElement('span'); words.className = 'form-check-label'; words.textContent = name;
        wrap.append(box, words);
        return wrap;
      };
      const dashed = toggle('Dashed', 'dashed', 'measurement dashed', 'Draw the line dashed, as measurements always have been, or solid');
      const value = toggle('Show value', 'showValue', 'measurement value', 'Write the distance or angle after the text; with no text the value is always written');
      const show = document.createElement('button'); show.className = 'btn btn-ghost'; show.type = 'button'; show.textContent = 'Show';
      show.title = 'Centre the view on this measurement without changing the zoom';
      show.addEventListener('click', () => centreOnMeasurement(record));
      const reset = document.createElement('button'); reset.className = 'btn btn-ghost'; reset.type = 'button'; reset.textContent = 'Reset';
      reset.title = 'Put the text back where it started'; reset.disabled = labelOffsetLength(record) === 0;
      reset.addEventListener('click', () => { remember('measurement position'); record.offset = null; delete record.autoPlaced; measurementChanged(record); updateStatus('Measurement text put back in place'); });
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('measurement removal'); measurementRecords = measurementRecords.filter(item => item.id !== record.id); renderMeasurementList(); rebuildOverlays(); });
      tools.append(color, dashed, value, show, reset, remove);
      /* The arrows and Select, as a label row has them: the way to move the text without a mouse. */
      const nudge = document.createElement('span'); nudge.className = 'gpv-nudge';
      nudge.setAttribute('role', 'group'); nudge.setAttribute('aria-label', 'Move the measurement text');
      [['←', 'Move the text left', -12, 0], ['→', 'Move the text right', 12, 0], ['↑', 'Move the text up', 0, -12], ['↓', 'Move the text down', 0, 12]].forEach(([glyph, title, dx, dy]) => {
        const button = document.createElement('button'); button.className = 'btn btn-ghost'; button.type = 'button'; button.textContent = glyph;
        button.setAttribute('aria-label', title); button.title = title;
        button.addEventListener('click', () => { remember('label nudge'); nudgeCanvasText({ kind: 'measurement', record }, dx, dy); reset.disabled = false; rebuildOverlays(); });
        nudge.append(button);
      });
      const select = document.createElement('button'); select.className = 'btn btn-ghost'; select.type = 'button'; select.textContent = 'Select';
      select.title = 'Make this the active text: the arrow keys move it (Shift for 1 px), Delete removes the measurement, Esc lets go';
      select.setAttribute('aria-label', 'Select this measurement to move its text with the arrow keys');
      select.addEventListener('click', () => {
        setActiveText('measurement', record);
        root.querySelector('#gpv-stage').focus({ preventScroll: true });
        updateStatus('“' + clipText(measurementLabelText(record), 40) + '” selected · arrow keys move it, Shift for 1 px, Delete removes it, Esc lets go');
      });
      nudge.append(select);
      row.dataset.measurementId = String(record.id);
      row.append(copy, tools, nudge); list.append(row);
    });
  }

  /* ---- The editor's measurement row ----
     Built once with the label editor (04a) and shown only while it edits a measurement. */
  function measurementEditorElement() {
    const row = document.createElement('div'); row.className = 'gpv-measure-editor gpv-label-editor-actions'; row.id = 'gpv-measure-editor'; row.hidden = true;
    const atoms = document.createElement('button'); atoms.type = 'button'; atoms.className = 'btn btn-ghost'; atoms.id = 'gpv-measure-editor-atoms'; atoms.textContent = 'Name the atoms';
    atoms.title = 'Put the atoms this measurement joins into the text — Enter or Update keeps it';
    atoms.addEventListener('click', () => {
      const record = labelEditorRecord(); if (!record || labelEditor.kind !== 'measurement') return;
      const input = labelEditorHost.querySelector('#gpv-label-editor-text');
      input.value = measurementAtomsText(record).slice(0, 120);
      input.focus({ preventScroll: true });
    });
    const check = (id, name, title) => {
      const wrap = document.createElement('label'); wrap.className = 'form-check gpv-check text-small'; wrap.title = title;
      const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'form-check-input'; box.id = id;
      const words = document.createElement('span'); words.className = 'form-check-label'; words.textContent = name;
      wrap.append(box, words);
      return { wrap, box };
    };
    const value = check('gpv-measure-editor-value', 'Show value', 'Write the distance or angle after the text');
    value.box.addEventListener('change', () => { const record = editorMeasurement(); if (record) setMeasurementFlag(record, 'showValue', value.box.checked, 'measurement value'); });
    const color = document.createElement('input'); color.type = 'color'; color.className = 'form-control form-control-color'; color.id = 'gpv-measure-editor-color';
    color.title = 'Colour of the line and the label'; color.setAttribute('aria-label', 'Measurement colour');
    color.addEventListener('input', () => {
      const record = editorMeasurement(); if (!record) return;
      if (!color.dataset.remembered) { remember('measurement colour'); color.dataset.remembered = '1'; }
      record.color = color.value; rebuildOverlays();
    });
    color.addEventListener('change', () => { delete color.dataset.remembered; const record = editorMeasurement(); if (record) renderMeasurementList(); });
    const dashed = check('gpv-measure-editor-dashed', 'Dashed', 'Draw the line dashed, or solid');
    dashed.box.addEventListener('change', () => { const record = editorMeasurement(); if (record) setMeasurementFlag(record, 'dashed', dashed.box.checked, 'measurement dashed'); });
    const pair = document.createElement('label'); pair.className = 'gpv-measure-editor-pair text-small'; pair.id = 'gpv-measure-editor-pair-wrap';
    pair.title = 'Which atoms of the two residues the distance joins: their Cα atoms, or their closest pair of heavy atoms';
    const select = document.createElement('select'); select.className = 'form-select'; select.id = 'gpv-measure-editor-pair';
    select.addEventListener('change', () => { const record = editorMeasurement(); if (record && select.value !== 'measured') repointMeasurement(record, select.value); });
    pair.append('Atoms ', select);
    row.append(atoms, value.wrap, color, dashed.wrap, pair);
    return row;
  }

  function editorMeasurement() {
    return labelEditor && labelEditor.kind === 'measurement' ? labelEditorRecord() : null;
  }

  /* "Distance · HIS57 · B NE2 ↔ SER195 · C OG · 3.02 Å". */
  function measurementEditorHead(record) {
    return (record.type === 'angle' ? 'Angle' : 'Distance') + ' · ' + measurementRowText(record);
  }

  /* The two residues of a two-point distance, when both are in loaded models and are not the same
     residue — the only measurement whose atoms can be chosen again — and which pair it joins now:
     'closest' when its atoms are the residues' closest heavy-atom pair, 'ca' when they are both Cα
     atoms, 'measured' otherwise. */
  function measurementPairState(record) {
    if (!record || record.type !== 'distance' || record.points.length !== 2) return null;
    const [first, second] = record.points;
    const entryA = entryById(first.entryId); const entryB = entryById(second.entryId);
    if (!entryA || !entryB || !entryA.model || !entryB.model) return null;
    if (first.entryId === second.entryId && (first.chain || '') === (second.chain || '') && first.resi === second.resi) return null;
    const residueA = { chain: first.chain || '', resi: first.resi }; const residueB = { chain: second.chain || '', resi: second.resi };
    const atomA = resolvePoint(first); const atomB = resolvePoint(second);
    const nearest = closestHeavyAtomPair(entryA, residueA, entryB, residueB);
    let state = 'measured';
    if (nearest && atomA === nearest.a && atomB === nearest.b) state = 'closest';
    else if (atomA && atomB && atomA === residueAlphaCarbon(entryA, residueA.chain, residueA.resi) && atomB === residueAlphaCarbon(entryB, residueB.chain, residueB.resi) && atomA.atom === 'CA' && atomB.atom === 'CA') state = 'ca';
    return { entryA, entryB, residueA, residueB, nearest, state };
  }

  /* The same two residues joined by other atoms: their Cα atoms, or their closest heavy-atom pair.
     The record keeps its id, its text, its offset and its colour — only the atoms change. */
  function repointMeasurement(record, choice) {
    const pair = measurementPairState(record);
    if (!pair || pair.state === choice) return;
    let first = null; let second = null;
    if (choice === 'closest' && pair.nearest) { first = pair.nearest.a; second = pair.nearest.b; }
    if (choice === 'ca') { first = residueAlphaCarbon(pair.entryA, pair.residueA.chain, pair.residueA.resi); second = residueAlphaCarbon(pair.entryB, pair.residueB.chain, pair.residueB.resi); }
    if (!first || !second) { updateStatus('Those atoms are not loaded'); return; }
    remember('measurement atoms');
    record.points = [atomReference(pair.entryA, first), atomReference(pair.entryB, second)];
    measurementChanged(record);
    updateStatus('Measurement now joins ' + measurementAtomsText(record) + ' · ' + measurementText(record));
  }

  /* Called by openLabelEditor with the measurement it is editing, or null for any other kind of
     text — which hides the row. */
  function fillMeasurementEditor(host, record) {
    const row = host.querySelector('#gpv-measure-editor');
    if (!row) return;
    row.hidden = !record;
    const head = host.querySelector('.gpv-label-editor-residue');
    if (!record) { head.removeAttribute('title'); return; }
    const line = measurementEditorHead(record);
    if (head.textContent !== line) head.textContent = line;
    head.hidden = false;
    head.title = line;
    host.querySelector('#gpv-measure-editor-value').checked = record.showValue !== false;
    host.querySelector('#gpv-measure-editor-dashed').checked = record.dashed !== false;
    const color = host.querySelector('#gpv-measure-editor-color');
    const wanted = measurementColor(record) || '#e11d48';
    if (color.value !== wanted) color.value = wanted;
    const pair = measurementPairState(record);
    const wrap = host.querySelector('#gpv-measure-editor-pair-wrap');
    const select = host.querySelector('#gpv-measure-editor-pair');
    wrap.hidden = !pair;
    if (!pair) return;
    const options = [['ca', 'Cα–Cα'], ['closest', 'closest atoms']];
    if (pair.state === 'measured') options.push(['measured', 'as measured']);
    select.replaceChildren(...options.map(([value, text]) => new Option(text, value)));
    select.value = pair.state;
  }

  function commitMeasurementText(text) {
    const record = labelEditorRecord();
    if (!record) { closeLabelEditor(true); return; }
    if (setMeasurementText(record, text)) { renderMeasurementList(); rebuildOverlays(); updateStatus('Measurement text updated'); }
    closeLabelEditor(true);
    setActiveText('measurement', record);
  }

  function removeMeasurementFromEditor() {
    const record = labelEditorRecord();
    if (!record) { closeLabelEditor(true); return; }
    remember('measurement removal');
    measurementRecords = measurementRecords.filter(item => item.id !== record.id);
    closeLabelEditor(true);
    clearActiveText(false);
    renderMeasurementList(); rebuildOverlays();
    updateStatus('Measurement removed');
  }

  /* One row per measurement, every point a model, chain, residue number, residue name and atom —
     the third left empty for a distance — then the value, its unit and the measurement's text. */
  const measurementColumns = ['type', 'model_1', 'chain_1', 'resi_1', 'resn_1', 'atom_1', 'model_2', 'chain_2', 'resi_2', 'resn_2', 'atom_2', 'model_3', 'chain_3', 'resi_3', 'resn_3', 'atom_3', 'value', 'unit', 'text'];
  function measurementTableRows() {
    return measurementRecords.map(record => {
      const cells = [record.type];
      for (let index = 0; index < 3; index += 1) {
        const point = record.points[index];
        if (!point) { cells.push('', '', '', '', ''); continue; }
        const entry = entryById(point.entryId); const atom = resolvePoint(point);
        cells.push(entry ? displayName(entry) : '', point.chain || '', point.resi, atom && atom.resn ? atom.resn : '', point.atom || '');
      }
      const value = measurementValue(record);
      cells.push(value === null ? '' : value.toFixed(3), record.type === 'angle' ? '°' : 'Å', record.text || '');
      return cells;
    });
  }

  function measurementsText() {
    const clean = value => String(value).replace(/[\t\r\n]+/g, ' ');
    return [measurementColumns, ...measurementTableRows()].map(row => row.map(clean).join('\t')).join('\n');
  }

  async function copyMeasurements() {
    if (!measurementRecords.length) return;
    const text = measurementsText();
    const what = plural(measurementRecords.length, 'measurement');
    try { await navigator.clipboard.writeText(text); announce(what + ' copied as tab-separated text'); }
    catch (error) { root.querySelector('#gpv-data-text').value = text; announce('Clipboard unavailable — the ' + what + ' are in the paste box of Per-residue data'); }
  }

  function downloadMeasurementsCsv() {
    if (!measurementRecords.length) return;
    const lines = [measurementColumns, ...measurementTableRows()].map(row => row.map(csvCell).join(','));
    downloadBlob(lines.join('\n'), 'text/csv', 'measurements.csv');
    updateStatus(plural(measurementRecords.length, 'measurement') + ' downloaded as CSV');
  }

  /* 3Dmol's own hit-testing only knows the geometry it drew — in cartoon mode
     that is a small sphere per Cα — so clicks on a ribbon mostly miss. Picking
     the nearest projected atom within a few pixels makes labels, measurements,
     and figure annotations land where the user clicked, in any representation. */
  function coarseAtoms(entry) {
    if (!entry.coarseCache || entry.coarseCache.atoms !== entry.atoms) entry.coarseCache = { atoms: entry.atoms, list: entry.atoms.filter(atom => atom.atom === 'CA' || atom.atom === 'P' || atom.hetflag) };
    return entry.coarseCache.list;
  }

  function pickAtomAt(pageX, pageY, coarse = false) {
    if (typeof viewer.modelToScreen !== 'function') return null;
    let best = null; let bestDistance = 14;
    displayedEntries().filter(entry => entry.model).forEach(entry => {
      const candidates = coarse || entry.atoms.length > 3000 ? coarseAtoms(entry) : entry.atoms;
      candidates.forEach(atom => {
        const screen = viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
        if (!screen) return;
        const distance = Math.hypot(screen.x - pageX, screen.y - pageY);
        if (distance < bestDistance) { bestDistance = distance; best = { entry, atom }; }
      });
    });
    return best;
  }

  /* ---- Dragging a label ----
     Every piece of text in the view can be picked up with the mouse: residue labels and the text
     of callouts, measurements and corner titles. The drag is stored where that kind of text keeps
     its position — a model-space offset for anything attached to the structure, screen pixels for
     a corner title — so the figure survives a camera move. Touch is left alone: on a touchscreen a
     drag rotates the model. */
  const labelMeasure = document.createElement('canvas').getContext('2d');
  function draggableLabels() {
    const shown = new Set(displayedEntries().map(entry => entry.id));
    const byId = entriesById();
    const stage = root.querySelector('#gpv-stage');
    const items = [];
    labelRecords.filter(label => shown.has(label.entryId)).forEach(label => {
      items.push({ kind: 'label', record: label, position: labelPosition(label, byId), text: label.text, size: label.size || 12 });
    });
    annotationRecords.forEach(record => {
      if (!annotationHasLabel(record)) return;
      if (record.type === 'screen') {
        const margin = 16; const fontSize = 16 * record.size;
        const right = record.corner.endsWith('right'); const bottom = record.corner.startsWith('bottom');
        const x = Math.max(0, Math.min(stage.clientWidth, (right ? stage.clientWidth - margin : margin) + (record.dx || 0)));
        const y = Math.max(0, Math.min(stage.clientHeight, (bottom ? stage.clientHeight - margin : margin) + (record.dy || 0))) + (bottom ? -fontSize * 0.8 : fontSize * 0.8);
        items.push({ kind: 'screen', record, screen: { x, y }, anchor: right ? 'end' : 'start', text: record.text, size: fontSize });
        return;
      }
      if (!record.points.every(point => shown.has(point.entryId))) return;
      const points = record.points.map(resolvePoint); if (points.some(point => !point)) return;
      const position = record.type === 'callout'
        ? calloutAnchor(points[0], record)
        : shiftBy(points.length > 1 ? midpoint(points[0], points[1]) : points[0], record.offset);
      items.push({ kind: 'annotation', record, position, text: record.text || pointName(record.points[0]), size: 13 * record.size });
    });
    measurementRecords.forEach(record => {
      if (!record.points.every(point => shown.has(point.entryId))) return;
      const points = record.points.map(resolvePoint); if (points.some(point => !point)) return;
      items.push({ kind: 'measurement', record, position: shiftBy(measurementAnchor(points, record), record.offset), text: measurementLabelText(record), size: 12 });
    });
    return items;
  }

  function labelHitAt(pageX, pageY) {
    if (typeof viewer.modelToScreen !== 'function') return null;
    const rect = root.querySelector('#gpv-stage').getBoundingClientRect();
    let best = null; let bestDistance = Infinity;
    draggableLabels().forEach(item => {
      const screen = item.screen ? { x: rect.left + scrollX + item.screen.x, y: rect.top + scrollY + item.screen.y } : viewer.modelToScreen(item.position);
      if (!screen) return;
      labelMeasure.font = '500 ' + item.size + 'px ' + figureFont();
      const halfWidth = Math.max(10, labelMeasure.measureText(String(item.text || '')).width / 2 + item.size * 0.45);
      const halfHeight = item.size * 0.95;
      const centre = item.anchor === 'end' ? { x: screen.x - halfWidth, y: screen.y } : item.anchor === 'start' ? { x: screen.x + halfWidth, y: screen.y } : screen;
      const dx = Math.abs(pageX - centre.x); const dy = Math.abs(pageY - centre.y);
      if (dx > halfWidth || dy > halfHeight) return;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) { bestDistance = distance; best = item; }
    });
    return best;
  }

  /* ---- Separating labels that landed on top of each other ----
     Compare this position writes one label per model at the same residue, and superposed models hold
     those atoms within a few ångström of each other: at anything but a close-up zoom the two boxes
     cover the same pixels and the press produces a figure that has to be repaired by hand — dozens
     of times over for a compared set. The boxes are measured exactly as the drag hit-test measures
     them, and the ones that collide are nudged down the screen into a stack. The nudge is written to
     the same `offset` the mouse writes, so it stays editable, resets from the label's own row,
     travels in the scene and undoes with the press that made it — and past leaderMinimum it grows
     the leader line back to the residue that says which label belongs to which. */
  const labelSeparationPadding = 3;
  const labelSeparationPasses = 6;
  /* A label may travel six of its own heights and no further, so one can never end up off the
     structure it names however tangled the pile it started in. */
  const labelSeparationCap = 6;

  /* Which boxes cover which is asked in three projections, and they do not agree. A figure panel is
     not the stage enlarged: its camera frames the scene its own way, while its text is drawn at
     overlayScale(plan) — at 178 mm, 300 dpi, 8 pt that is 2.78× the screen's text against a panel
     only ~1.11× the stage, so a label is about two and a half times larger *relative to the
     structure* on paper than on screen, and a pair that clears by a pixel on screen prints half on
     top of each other. So the geometry below is measured against whichever projection is asking —
     how it projects a point, its pixels per ångström, its camera and its text scale — and each
     caller hands in its own. */
  function labelBoxAt(projection, label, position) {
    const screen = projection.project(position);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
    const size = (label.size || 12) * projection.scale;
    labelMeasure.font = '500 ' + size + 'px ' + figureFont();
    const halfWidth = Math.max(10 * projection.scale, labelMeasure.measureText(String(label.text || '')).width / 2 + size * 0.45);
    return { x: screen.x, y: screen.y, halfWidth, halfHeight: size * 0.95 };
  }

  function labelScreenBox(label, byId = entriesById()) {
    if (typeof viewer.modelToScreen !== 'function') return null;
    return labelBoxAt({ project: point => viewer.modelToScreen(point), scale: 1 }, label, labelPosition(label, byId));
  }

  /* A measurement's text box on screen, measured as labelScreenBox measures a label's: what Separate
     labels compares (read by the regression suite). */
  function measurementScreenBox(record) {
    if (typeof viewer.modelToScreen !== 'function') return null;
    const anchor = measurementAnchor(null, record); if (!anchor) return null;
    return labelBoxAt({ project: point => viewer.modelToScreen(point), scale: 1 }, { text: measurementLabelText(record), size: 12 }, shiftBy(anchor, record.offset));
  }

  function screenProjection() {
    if (typeof viewer.modelToScreen !== 'function') return null;
    const perAngstrom = pixelsPerAngstrom(viewer);
    if (!perAngstrom) return null;
    return { project: point => viewer.modelToScreen(point), perAngstrom, view: typeof viewer.getView === 'function' ? viewer.getView() : [0, 0, 0, 0, 0, 0, 0, 1], scale: 1 };
  }

  /* The projection of one figure panel: the export viewer as the panel's camera has left it, and
     the text size that panel's plan will draw at. Page coordinates or panel-local ones makes no
     difference to which boxes overlap — the shift between them is the same for every label — so the
     raw projection is enough, and what comes back out is a model-space position each drawer
     projects its own way. */
  function panelProjection(target, dimensions) {
    if (!target || typeof target.modelToScreen !== 'function' || typeof target.getView !== 'function') return null;
    const perAngstrom = pixelsPerAngstrom(target);
    if (!perAngstrom) return null;
    const height = dimensions && dimensions.height > 0 ? dimensions.height : 0;
    return { project: point => target.modelToScreen(point), perAngstrom, view: target.getView(), scale: overlayScale(dimensions), frameHeight: height };
  }

  /* What a separation pass moves and avoids: every shown residue label and every shown measurement's
     text, each as { record, kind, anchor, text, size } — the box labelBoxAt measures is the text at
     its size, and the offset the pass writes is the record's own, so a label and a measurement mean
     the same thing by it. A measurement's model order is its first point's. */
  function separationItems(byId, shown) {
    const items = [];
    labelRecords.filter(label => shown.has(label.entryId)).forEach(label => {
      items.push({ record: label, kind: 'label', entryId: label.entryId, anchor: labelAnchor(label, byId), text: label.text, size: label.size || 12 });
    });
    measurementRecords.forEach(record => {
      if (!record.points.every(point => shown.has(point.entryId))) return;
      const points = record.points.map(resolvePoint); if (points.some(point => !point)) return;
      items.push({ record, kind: 'measurement', entryId: record.points[0].entryId, anchor: measurementAnchor(points, record), text: measurementLabelText(record), size: 12 });
    });
    return items;
  }

  /* options.include picks the labels this press is allowed to move — the position labels, say, or
     only the ones it just added. A measurement is moved only by a press with no such choice (Separate
     labels itself, and a figure panel's placement); a press that names its labels leaves measurement
     text where it is but still steers its labels clear of it. options.keepPlaced (on unless asked otherwise) leaves a label the
     user has dragged exactly where the user put it. Either way every label on screen still counts as
     something to avoid: a label moved out of one collision must not land in another.
     options.write off resolves without moving anything: the run answers where the labels would go
     and leaves labelRecords alone, which is how a panel gets its own placement without disturbing
     the one on screen. Either way `placed` carries the resolved model-space position of every label
     the run looked at, keyed by record. options.shown narrows the run to what one panel actually
     draws. */
  function separateLabelsIn(projection, options = {}) {
    const byId = entriesById();
    const shown = options.shown instanceof Set ? options.shown : new Set(displayedEntries().map(entry => entry.id));
    const order = new Map(structures.map((entry, index) => [entry.id, index]));
    const keepPlaced = options.keepPlaced !== false;
    const choosing = typeof options.include === 'function';
    const include = (item) => (item.kind === 'label' ? !choosing || options.include(item.record) : !choosing);
    const write = options.write !== false;
    const padding = labelSeparationPadding * projection.scale;
    const items = separationItems(byId, shown).map(item => ({
      ...item,
      movable: include(item) && !(keepPlaced && labelOffsetLength(item.record) > 0 && !item.record.autoPlaced),
      /* Ties are broken by the order the models were loaded, so the reference model's label is the
         one that keeps its place and the rest stack under it; within a model a residue label comes
         before a measurement, so of the two it is the measurement's text that gives way. */
      order: order.has(item.entryId) ? order.get(item.entryId) : structures.length,
      shift: 0
    }));
    const placed = new Map();
    if (items.length < 2) return { moved: 0, movedLabels: 0, movedMeasurements: 0, blocked: 0, overlapping: false, placed, items: [] };
    items.sort((a, b) => a.order - b.order);
    /* Which labels cover each other is a question about the current framing, and an offset this
       routine wrote at some earlier one is this run's to recompute rather than to build on: starting
       from the residue again makes a second press at the same camera a no-op instead of a drift,
       keeps the cap a real bound on how far a label can end up from its residue — and is what lets a
       panel place a label for print without inheriting the screen's answer. */
    items.forEach(item => {
      item.base = item.movable && item.record.autoPlaced ? null : item.record.offset || null;
      if (write && item.movable && item.record.autoPlaced) { item.record.offset = null; delete item.record.autoPlaced; }
    });
    const up = screenAxisInModelSpace(projection.view, { x: 0, y: 1, z: 0 });
    /* Screen y grows downward, the model-space "up" axis does not: the same sign convention the drag
       uses, so a separated label and a dragged one mean the same thing by their offset. */
    const offsetFor = item => {
      const base = item.base || { x: 0, y: 0, z: 0 };
      const step = item.shift / projection.perAngstrom;
      return { x: base.x - up.x * step, y: base.y - up.y * step, z: base.z - up.z * step };
    };
    const positionFor = item => shiftBy(item.anchor, offsetFor(item));
    let overlapping = false;
    let blocked = 0;
    for (let pass = 0; pass < labelSeparationPasses; pass += 1) {
      /* Re-projected every pass: a label that has just moved is in a new place, and the pixels it
         covers there are what the next collision has to be measured against. */
      const boxes = items.map(item => labelBoxAt(projection, item, positionFor(item)));
      let collided = false;
      blocked = 0;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = boxes[i]; const b = boxes[j];
          if (!a || !b) continue;
          if (Math.abs(b.x - a.x) >= a.halfWidth + b.halfWidth + padding) continue;
          const overlapY = a.halfHeight + b.halfHeight + padding - Math.abs(b.y - a.y);
          if (overlapY <= 0) continue;
          collided = true; overlapping = true;
          /* One of the pair keeps its place: the later model's label is the one that gives way, and
             only if both are locked is there nothing to be done about the collision. */
          const mover = items[j].movable ? j : items[i].movable ? i : -1;
          if (mover < 0) { blocked += 1; continue; }
          const other = mover === j ? i : j;
          const away = boxes[mover].y >= boxes[other].y ? 1 : -1;
          /* Six of the label's own heights — except that in a panel, at print text size, six heights
             can be more than the whole cell: a site with a dozen positions compared at it cannot be
             untangled however far the labels travel, and travelling that far only turns an overlap
             into a label the reader never sees, or, in the SVG, one sitting over the next panel. So a
             panel also bounds the travel by its own frame. The stage has no such frame — it scrolls
             and turns — and keeps the rule it has always had. */
          const cap = Math.min(labelSeparationCap * boxes[mover].halfHeight * 2, projection.frameHeight ? projection.frameHeight / 2 : Infinity);
          let wanted = Math.max(-cap, Math.min(cap, items[mover].shift + away * overlapY));
          if (projection.frameHeight) {
            const wall = Math.min(boxes[mover].halfHeight, projection.frameHeight / 2);
            const y = boxes[mover].y + wanted - items[mover].shift;
            wanted += Math.max(wall, Math.min(projection.frameHeight - wall, y)) - y;
          }
          boxes[mover].y += wanted - items[mover].shift;
          items[mover].shift = wanted;
        }
      }
      if (!collided) break;
    }
    items.forEach(item => {
      placed.set(item.record, positionFor(item));
      if (!write || !item.shift) return;
      item.record.offset = offsetFor(item);
      item.record.autoPlaced = true;
    });
    const moved = items.filter(item => item.shift !== 0);
    const movedMeasurements = moved.filter(item => item.kind === 'measurement').length;
    return { moved: moved.length, movedLabels: moved.length - movedMeasurements, movedMeasurements, blocked, overlapping, placed, items };
  }

  /* Returns null when the view cannot be projected yet, so the caller can say so rather than guess. */
  function separateLabels(options = {}) {
    const projection = screenProjection();
    return projection ? separateLabelsIn(projection, options) : null;
  }

  /* Where one figure panel's labels belong, worked out in that panel's own camera and text size and
     handed to the drawing pass as a position per label. The figure is a rendering, not an edit:
     labelRecords is not touched, so exporting never moves a label on screen, and a label the user
     placed by hand is left where the user put it here exactly as it is there. Null when the panel
     cannot be projected — then it draws what the screen has rather than guessing. */
  function panelLabelPlacement(target, dimensions, shownIds) {
    const projection = panelProjection(target, dimensions);
    if (!projection) return null;
    const resolved = separateLabelsIn(projection, { write: false, shown: shownIds });
    if (!resolved.placed.size) return null;
    /* Taken only when it is an improvement on what the panel would otherwise have printed. Eleven
       positions compared at one site is twenty-two boxes of print-size text in a cell that holds
       six: no placement untangles that, and the greedy one can end up covering more than the
       labels did where they were. Measured, so the panel is never made worse than it is today —
       labels and measurement text together, each where it would otherwise sit: its anchor and its
       own offset. */
    const items = resolved.items;
    const covered = positions => labelCoveredArea(items.map(item => labelBoxAt(projection, item, positions(item))));
    return covered(item => resolved.placed.get(item.record)) < covered(item => shiftBy(item.anchor, item.record.offset)) ? resolved.placed : null;
  }

  /* How much of itself a set of label boxes covers: the summed area of every overlapping pair. */
  function labelCoveredArea(boxes) {
    let total = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        if (!a || !b) continue;
        const wide = Math.min(a.x + a.halfWidth, b.x + b.halfWidth) - Math.max(a.x - a.halfWidth, b.x - b.halfWidth);
        const tall = Math.min(a.y + a.halfHeight, b.y + b.halfHeight) - Math.max(a.y - a.halfHeight, b.y - b.halfHeight);
        if (wide > 0 && tall > 0) total += wide * tall;
      }
    }
    return total;
  }

  let labelDrag = null;
  function startLabelDrag(item, event) {
    labelDrag = { item, x: event.pageX, y: event.pageY, perAngstrom: pixelsPerAngstrom(viewer) || 20, moved: false };
    root.querySelector('#gpv-stage').style.cursor = 'grabbing';
  }
  function moveLabelDrag(event) {
    const drag = labelDrag; if (!drag) return;
    const dx = event.pageX - drag.x; const dy = event.pageY - drag.y;
    if (!dx && !dy) return;
    /* The undo step is taken on the first real move, not on the press: a press that only opens the
       editor has changed nothing and must leave no empty step behind. */
    if (!drag.moved) remember('label position');
    drag.x = event.pageX; drag.y = event.pageY; drag.moved = true;
    nudgeCanvasText(drag.item, dx, dy, drag.perAngstrom);
    rebuildOverlays();
  }
  /* A press on a piece of text that never moved was a click on it: that opens the editor for it.
     A cancelled pointer (no event) is not a click, and while drawing or measuring a click on text
     does what it always did — nothing — so those modes behave exactly as before. */
  function endLabelDrag(event) {
    const drag = labelDrag; labelDrag = null;
    root.querySelector('#gpv-stage').style.cursor = '';
    if (!drag) return;
    renderCanvasTextLists(drag.item.kind);
    if (drag.moved) updateStatus('Label moved · drag it again, or Reset in its row to put it back');
    else if (event && !annotationActive && !measurementActive) openLabelEditorForItem(drag.item);
  }

  let pointerStart = null;
  function watchStageClicks() {
    const stage = root.querySelector('#gpv-stage');
    stage.addEventListener('pointerdown', event => {
      /* The label editor and the box selection's popover live inside the stage; a press on their
         own fields or buttons is not a press on the structure. Anywhere else on the stage closes
         them — the editor uncommitted, the popover keeping its highlight — before anything else. */
      if (isInLabelEditor(event.target) || isInBoxPopover(event.target)) return;
      closeLabelEditor(false);
      closeBoxPopover(false);
      if (event.button !== 0) return;
      /* Shift (or the Drag to select toggle) makes the drag a selection rectangle (04b). */
      if (beginBoxSelection(event)) return;
      if (event.pointerType !== 'touch') {
        const hit = labelHitAt(event.pageX, event.pageY);
        if (hit) {
          /* Capture phase: stopping here keeps the click away from 3Dmol, so the camera
             stays put while the label moves. */
          event.preventDefault(); event.stopPropagation();
          try { stage.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
          startLabelDrag(hit, event);
          return;
        }
      }
      pointerStart = { x: event.pageX, y: event.pageY, time: Date.now() };
    }, true);
    stage.addEventListener('pointermove', event => {
      if (!labelDrag) return;
      event.preventDefault(); event.stopPropagation();
      moveLabelDrag(event);
    }, true);
    stage.addEventListener('pointerup', event => {
      if (!labelDrag) return;
      event.preventDefault(); event.stopPropagation();
      endLabelDrag(event);
    }, true);
    stage.addEventListener('pointercancel', () => { if (labelDrag) endLabelDrag(); }, true);
    stage.addEventListener('pointerup', event => {
      const start = pointerStart; pointerStart = null;
      if (!start || event.button !== 0 || Math.hypot(event.pageX - start.x, event.pageY - start.y) > 4 || Date.now() - start.time > 700) return;
      /* A finger cannot drag a label (that turns the model), but a tap on one still edits it. */
      if (event.pointerType === 'touch' && !annotationActive && !measurementActive) {
        const text = labelHitAt(event.pageX, event.pageY);
        if (text) { openLabelEditorForItem(text); return; }
      }
      const hit = pickAtomAt(event.pageX, event.pageY);
      /* A click that no drawing or measurement took is a request to label the residue. */
      if (hit && !handleAtomClick(hit.entry, hit.atom)) openLabelEditorForResidue(hit.entry, hit.atom);
    });
    /* Scrolling zooms the camera under the editor; the editor goes rather than float over a
       residue it no longer marks. */
    stage.addEventListener('wheel', event => { if (!isInLabelEditor(event.target)) closeLabelEditor(false); }, { passive: true });
    /* Hover readout: nearest Cα within a few pixels, at most once per frame, and
       never while a drag is in progress. */
    const readout = root.querySelector('#gpv-hover');
    let hoverFrame = 0; let hoverAt = null;
    stage.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' || pointerStart || boxDrag) return;
      if (isInLabelEditor(event.target) || isInBoxPopover(event.target)) { hoverAt = null; stage.style.cursor = ''; return; }
      hoverAt = { x: event.pageX, y: event.pageY };
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!hoverAt) return;
        /* While Drag to select is on, a drag from a label draws a box, so it offers no move. */
        const overLabel = !boxSelectMode && labelHitAt(hoverAt.x, hoverAt.y);
        stage.style.cursor = overLabel ? 'grab' : '';
        if (overLabel) { readout.textContent = 'Drag to move · click to edit “' + clipText(String(overLabel.text || ''), 40) + '”'; return; }
        const hit = pickAtomAt(hoverAt.x, hoverAt.y, true);
        readout.textContent = hit ? describeResidue(hit.entry, hit.atom) + (displayedEntries().length > 1 ? ' · ' + displayName(hit.entry) : '') : '';
        const next = hit ? { entryId: hit.entry.id, chain: hit.atom.chain || '', resi: hit.atom.resi } : null;
        const changed = next ? !sequenceHover || sequenceHover.entryId !== next.entryId || sequenceHover.chain !== next.chain || sequenceHover.resi !== next.resi : Boolean(sequenceHover);
        if (changed) { sequenceHover = next; renderSequenceSoon(); }
      });
    });
    stage.addEventListener('pointerleave', () => { hoverAt = null; readout.textContent = ''; if (sequenceHover) { sequenceHover = null; renderSequenceSoon(); } });
  }

  /* Returns true when drawing or measuring took the click. The callers that open the label editor
     (a click in the viewer, a pick in the sequence strip) open it only when this returns false, so
     the mode check lives here alone; Go to and the contact map call it for selection only. */
  function handleAtomClick(entry, atom) {
    selectResidue(entry, atom);
    /* The second click of an armed Measure to… (04c); it is never armed while a mode is on. */
    if (measureFrom) { finishMeasureTo(entry, atom); return true; }
    if (annotationActive) { handleAnnotationClick(entry, atom); return true; }
    if (!measurementActive) return false;
    measurementDraft.push(atomReference(entry, atom));
    const required = root.querySelector('#gpv-measure-type').value === 'angle' ? 3 : 2;
    root.querySelector('#gpv-measure-state').textContent = 'Selected ' + measurementDraft.length + ' of ' + required + ' atoms.';
    if (measurementDraft.length >= required) {
      remember('measurement');
      measurementRecords.push({ id: nextAnnotationId++, type: root.querySelector('#gpv-measure-type').value, points: measurementDraft.slice(0, required) });
      measurementDraft = [];
      renderMeasurementList(); rebuildOverlays();
      root.querySelector('#gpv-measure-state').textContent = 'Measurement added. Select ' + required + ' atoms for another.';
    }
    return true;
  }

  function toggleMeasurement() {
    measurementActive = !measurementActive; measurementDraft = [];
    if (measurementActive && annotationActive) toggleAnnotating(false);
    if (measurementActive && boxSelectMode) setBoxSelectMode(false);
    measureToModesChanged();
    root.querySelector('#gpv-measure').textContent = measurementActive ? 'Stop measuring' : 'Start measuring';
    const required = root.querySelector('#gpv-measure-type').value === 'angle' ? 3 : 2;
    root.querySelector('#gpv-measure-state').textContent = measurementActive ? 'Select ' + required + ' atoms in the viewer.' : 'Measurement mode is off.';
  }

