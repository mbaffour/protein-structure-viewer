  /* ---------- Scale bar ---------- */

  let sceneCentreCache = null;
  /* `shown` is the models the bar is measured among: the screen's, or the ones an export is drawing
     (figureEntries, 31), which a model cycled to mid-render is not. */
  function sceneCentre(shown = displayedEntries().filter(entry => entry.model)) {
    if (!shown.length) return null;
    const key = shown.map(entry => entry.id).join(',') + '|' + alignmentResults.length;
    if (sceneCentreCache && sceneCentreCache.key === key) return sceneCentreCache.centre;
    const centres = shown.map(modelCentroid);
    const centre = { x: mean(centres.map(c => c.x)), y: mean(centres.map(c => c.y)), z: mean(centres.map(c => c.z)) };
    sceneCentreCache = { key, centre };
    return centre;
  }

  /* Pixels per ångström along the screen's horizontal axis at the model centre — or, given a point,
     at that point. In perspective the two differ by the point's depth: a label in front of the centre
     is drawn larger and moves further per ångström, so text being moved by a given number of pixels
     is measured at its own anchor (04a, 04), while the scale bar keeps the centre. */
  function pixelsPerAngstrom(target, at = null) {
    if (!target || typeof target.modelToScreen !== 'function' || typeof target.getView !== 'function') return null;
    const centre = at && Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z) ? at : sceneCentre(); if (!centre) return null;
    const axis = screenAxisInModelSpace(target.getView(), { x: 1, y: 0, z: 0 });
    const a = target.modelToScreen(centre); const b = target.modelToScreen({ x: centre.x + axis.x, y: centre.y + axis.y, z: centre.z + axis.z });
    if (!a || !b) return null;
    const pixels = Math.hypot(b.x - a.x, b.y - a.y);
    return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
  }

  /* An export's stroke of `px` figure pixels as a cylinder radius in ångströms, at `at` in the export
     viewer's projection (null for any other viewer — the screen, a comparison panel — or without a
     projection). 3Dmol's addLine is a GL line,
     and browsers clamp GL lines to one device pixel: a measurement exported at 300 or 600 dpi was a
     0.6 px hairline where the SVG of the same figure draws 2 × the text scale (5.6 px at 8 pt and 300
     dpi). A cylinder of this radius prints at the SVG's width (03 drawMeasurements and drawLabels). */
  function exportStrokeRadius(target, at, px) {
    if (!target || target !== exportViewer) return null;
    const perAngstrom = pixelsPerAngstrom(target, at);
    return perAngstrom ? px / 2 / perAngstrom : null;
  }

  /* A bar that does not fit its panel — wider than 90 % of it, or under 8 px — is drawn at the nearest
     offered length that does: the longest shorter one for a bar too wide (50 Å in a close-up becomes
     20 Å), the shortest longer one for a bar too small. Its label states the length drawn, and the
     export says so ("scale bar shortened to 20 Å in panel B"), since the panels of one figure may then
     carry bars of different lengths. Only when no offered length fits is the bar left out. Either used
     to happen in silence — a site figure's close-up printed without the bar its overview had and the
     checklist kept "✓ 50 Å scale bar" — so while an export runs (beginExport, 40) each panel whose bar
     was changed or left out is noted, for the export's status line, and the last export's notes stay
     for the checklist. */
  let scaleBarMisses = null;
  let lastScaleBarMiss = null;
  function scaleBarLengths() {
    return [...root.querySelector('#gpv-scale-bar').options].map(option => Number(option.value)).filter(value => value > 0).sort((a, b) => a - b);
  }
  function scaleBarSpec(target, plan, panel = '') {
    const requested = Number(root.querySelector('#gpv-scale-bar').value) || 0;
    if (!requested || !target) return null;
    const perAngstrom = pixelsPerAngstrom(target, target === viewer ? null : sceneCentre(figureEntries())); if (!perAngstrom) return null;
    const fits = length => length * perAngstrom >= 8 && length * perAngstrom <= plan.width * 0.9;
    const small = requested * perAngstrom < 8;
    let length = requested;
    if (!fits(requested)) {
      const offered = scaleBarLengths();
      length = small ? offered.find(value => value > requested && fits(value)) : offered.filter(value => value < requested && fits(value)).pop();
      if (scaleBarMisses && !scaleBarMisses.some(miss => miss.panel === panel)) scaleBarMisses.push({ length: requested, panel, small, drawn: length || null });
      if (!length) return null;
    }
    return { length, requested, pixels: length * perAngstrom, width: plan.width, height: plan.height };
  }
  /* " · scale bar shortened to 20 Å in panel B — 50 Å is wider than the panel", or " · scale bar left
     out of panel C — no offered length fits (10 Å is wider than the panel); zoom out", once per export;
     empty when every panel drew the bar asked for. Read once, at the export's status line. */
  function scaleBarMissNote() {
    const misses = scaleBarMisses || [];
    scaleBarMisses = null;
    const changed = misses.filter(miss => miss.drawn); const left = misses.filter(miss => !miss.drawn);
    lastScaleBarMiss = misses.length ? {
      length: misses[0].length, small: misses.every(miss => miss.small),
      left: left.length > 0, drawn: changed.map(miss => miss.drawn)
    } : null;
    if (!misses.length) return '';
    const panelsOf = (list, word) => { const panels = list.map(miss => miss.panel).filter(Boolean); return panels.length ? ' ' + word + ' panel' + (panels.length === 1 ? ' ' : 's ') + panels.join(', ') : ''; };
    const lengths = scaleBarLengths(); const requested = misses[0].length;
    let note = '';
    if (changed.length) {
      const longer = changed.every(miss => miss.small);
      const drawn = [...new Set(changed.map(miss => miss.drawn))];
      note += ' · scale bar ' + (longer ? 'lengthened' : 'shortened') + ' to ' + drawn.map(length => length + ' Å' + panelsOf(changed.filter(miss => miss.drawn === length), 'in')).join(', ')
        + ' — ' + requested + ' Å is ' + (longer ? 'under 8 px there' : 'wider than the panel');
    }
    if (left.length) {
      const small = left.every(miss => miss.small);
      note += ' · scale bar left out' + panelsOf(left, 'of') + ' — no offered length fits (' + (small ? Math.max(...lengths) + ' Å is under 8 px there); zoom in' : Math.min(...lengths) + ' Å is wider than the panel); zoom out');
    }
    return note;
  }

  function drawScaleBar(context, bar, scale, palette) {
    const margin = Math.round(24 * scale); const thickness = Math.max(2, Math.round(3 * scale)); const font = Math.round(13 * scale);
    const x = bar.width - margin - bar.pixels; const y = bar.height - margin;
    context.save();
    context.fillStyle = palette.paper; context.globalAlpha = 0.85;
    context.fillRect(x - margin / 3, y - font - thickness - margin / 3, bar.pixels + margin * 2 / 3, font + thickness * 2 + margin / 2); context.globalAlpha = 1;
    context.fillStyle = palette.ink; context.fillRect(x, y, bar.pixels, thickness);
    context.font = '600 ' + font + 'px ' + figureFont(); context.textAlign = 'center'; context.textBaseline = 'bottom';
    context.fillText(bar.length + ' Å', x + bar.pixels / 2, y - Math.round(3 * scale));
    context.restore();
  }

  function scaleBarSvg(bar, scale, palette) {
    if (!bar) return '';
    const margin = 24 * scale; const thickness = Math.max(2, 3 * scale); const fontSize = 13 * scale;
    const x = bar.width - margin - bar.pixels; const y = bar.height - margin;
    return '<g id="scale-bar"><rect x="' + f(x - margin / 3) + '" y="' + f(y - fontSize - thickness - margin / 3) + '" width="' + f(bar.pixels + margin * 2 / 3) + '" height="' + f(fontSize + thickness * 2 + margin / 2) + '" fill="' + palette.paper + '" fill-opacity="0.85"/>'
      + '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(bar.pixels) + '" height="' + f(thickness) + '" fill="' + palette.ink + '"/>'
      + '<text x="' + f(x + bar.pixels / 2) + '" y="' + f(y - 3 * scale) + '" text-anchor="middle" font-family="' + svgFont + '" font-size="' + f(fontSize) + '" font-weight="600" fill="' + palette.ink + '">' + svgEscape(bar.length + ' Å') + '</text></g>';
  }

  let scaleBarFrame = 0;
  function updateScreenScaleBar() {
    scaleBarFrame = 0;
    const host = root.querySelector('#gpv-scalebar');
    const length = Number(root.querySelector('#gpv-scale-bar').value) || 0;
    const perAngstrom = length ? pixelsPerAngstrom(viewer) : null;
    const pixels = perAngstrom ? length * perAngstrom : 0;
    const stage = root.querySelector('#gpv-stage');
    const show = pixels >= 8 && pixels <= stage.clientWidth * 0.9 && structures.length > 0;
    host.hidden = !show;
    if (show) { root.querySelector('#gpv-scalebar-line').style.width = Math.round(pixels) + 'px'; root.querySelector('#gpv-scalebar-label').textContent = length + ' Å'; }
    if (length) scaleBarFrame = requestAnimationFrame(updateScreenScaleBar);
  }

  function ensureScaleBarLoop() {
    if (scaleBarFrame) return;
    scaleBarFrame = requestAnimationFrame(updateScreenScaleBar);
  }

