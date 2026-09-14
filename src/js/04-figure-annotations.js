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

  function nudgeAnnotation(record, dxScreen, dyScreen) {
    remember('label nudge');
    if (record.type === 'screen') {
      record.dx = (record.dx || 0) + dxScreen * 12;
      record.dy = (record.dy || 0) - dyScreen * 12;
    } else {
      const view = typeof viewer.getView === 'function' ? viewer.getView() : [0, 0, 0, 0, 0, 0, 0, 1];
      const step = 1.5 * record.size;
      const right = screenAxisInModelSpace(view, { x: 1, y: 0, z: 0 });
      const up = screenAxisInModelSpace(view, { x: 0, y: 1, z: 0 });
      const offset = record.offset || { x: 0, y: 0, z: 0 };
      record.offset = {
        x: offset.x + (right.x * dxScreen + up.x * dyScreen) * step,
        y: offset.y + (right.y * dxScreen + up.y * dyScreen) * step,
        z: offset.z + (right.z * dxScreen + up.z * dyScreen) * step
      };
    }
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

  function renderMeasurementList() {
    const list = root.querySelector('#gpv-measurement-list'); list.replaceChildren();
    measurementRecords.forEach(record => {
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const label = document.createElement('span'); label.className = 'gpv-entry-name';
      const value = measurementValue(record);
      label.textContent = record.points.map(pointName).join(record.type === 'distance' ? ' ↔ ' : ' → ') + ' · ' + (value === null ? '—' : value.toFixed(2) + (record.type === 'distance' ? ' Å' : '°'));
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('measurement removal'); measurementRecords = measurementRecords.filter(item => item.id !== record.id); renderMeasurementList(); rebuildOverlays(); });
      row.append(label, remove); list.append(row);
    });
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

  let labelDrag = null;
  function startLabelDrag(item, event) {
    remember('label position');
    labelDrag = { item, x: event.pageX, y: event.pageY, perAngstrom: pixelsPerAngstrom(viewer) || 20, moved: false };
    root.querySelector('#gpv-stage').style.cursor = 'grabbing';
  }
  function moveLabelDrag(event) {
    const drag = labelDrag; if (!drag) return;
    const dx = event.pageX - drag.x; const dy = event.pageY - drag.y;
    if (!dx && !dy) return;
    drag.x = event.pageX; drag.y = event.pageY; drag.moved = true;
    const record = drag.item.record;
    if (drag.item.kind === 'screen') {
      record.dx = (record.dx || 0) + dx; record.dy = (record.dy || 0) + dy;
    } else {
      const view = typeof viewer.getView === 'function' ? viewer.getView() : [0, 0, 0, 0, 0, 0, 0, 1];
      const right = screenAxisInModelSpace(view, { x: 1, y: 0, z: 0 });
      const up = screenAxisInModelSpace(view, { x: 0, y: 1, z: 0 });
      const step = 1 / drag.perAngstrom;
      const offset = record.offset || { x: 0, y: 0, z: 0 };
      record.offset = {
        x: offset.x + (right.x * dx - up.x * dy) * step,
        y: offset.y + (right.y * dx - up.y * dy) * step,
        z: offset.z + (right.z * dx - up.z * dy) * step
      };
    }
    rebuildOverlays();
  }
  function endLabelDrag() {
    const drag = labelDrag; labelDrag = null;
    root.querySelector('#gpv-stage').style.cursor = '';
    if (!drag) return;
    if (drag.item.kind === 'label') renderLabelList(); else renderAnnotationList();
    if (drag.moved) updateStatus('Label moved · drag it again, or Reset in its row to put it back');
  }

  let pointerStart = null;
  function watchStageClicks() {
    const stage = root.querySelector('#gpv-stage');
    stage.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
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
      endLabelDrag();
    }, true);
    stage.addEventListener('pointercancel', () => { if (labelDrag) endLabelDrag(); }, true);
    stage.addEventListener('pointerup', event => {
      const start = pointerStart; pointerStart = null;
      if (!start || event.button !== 0 || Math.hypot(event.pageX - start.x, event.pageY - start.y) > 4 || Date.now() - start.time > 700) return;
      const hit = pickAtomAt(event.pageX, event.pageY);
      if (hit) handleAtomClick(hit.entry, hit.atom);
    });
    /* Hover readout: nearest Cα within a few pixels, at most once per frame, and
       never while a drag is in progress. */
    const readout = root.querySelector('#gpv-hover');
    let hoverFrame = 0; let hoverAt = null;
    stage.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' || pointerStart) return;
      hoverAt = { x: event.pageX, y: event.pageY };
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!hoverAt) return;
        const overLabel = labelHitAt(hoverAt.x, hoverAt.y);
        stage.style.cursor = overLabel ? 'grab' : '';
        if (overLabel) { readout.textContent = 'Drag to move “' + clipText(String(overLabel.text || ''), 40) + '”'; return; }
        const hit = pickAtomAt(hoverAt.x, hoverAt.y, true);
        readout.textContent = hit ? describeResidue(hit.entry, hit.atom) + (displayedEntries().length > 1 ? ' · ' + displayName(hit.entry) : '') : '';
        const next = hit ? { entryId: hit.entry.id, chain: hit.atom.chain || '', resi: hit.atom.resi } : null;
        const changed = next ? !sequenceHover || sequenceHover.entryId !== next.entryId || sequenceHover.chain !== next.chain || sequenceHover.resi !== next.resi : Boolean(sequenceHover);
        if (changed) { sequenceHover = next; renderSequenceSoon(); }
      });
    });
    stage.addEventListener('pointerleave', () => { hoverAt = null; readout.textContent = ''; if (sequenceHover) { sequenceHover = null; renderSequenceSoon(); } });
  }

  function handleAtomClick(entry, atom) {
    selectResidue(entry, atom);
    if (annotationActive) { handleAnnotationClick(entry, atom); return; }
    if (!measurementActive) return;
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
  }

  function toggleMeasurement() {
    measurementActive = !measurementActive; measurementDraft = [];
    if (measurementActive && annotationActive) toggleAnnotating(false);
    root.querySelector('#gpv-measure').textContent = measurementActive ? 'Stop measuring' : 'Start measuring';
    const required = root.querySelector('#gpv-measure-type').value === 'angle' ? 3 : 2;
    root.querySelector('#gpv-measure-state').textContent = measurementActive ? 'Select ' + required + ' atoms in the viewer.' : 'Measurement mode is off.';
  }

