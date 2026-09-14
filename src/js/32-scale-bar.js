  /* ---------- Scale bar ---------- */

  let sceneCentreCache = null;
  function sceneCentre() {
    const shown = displayedEntries().filter(entry => entry.model);
    if (!shown.length) return null;
    const key = shown.map(entry => entry.id).join(',') + '|' + alignmentResults.length;
    if (sceneCentreCache && sceneCentreCache.key === key) return sceneCentreCache.centre;
    const centres = shown.map(modelCentroid);
    const centre = { x: mean(centres.map(c => c.x)), y: mean(centres.map(c => c.y)), z: mean(centres.map(c => c.z)) };
    sceneCentreCache = { key, centre };
    return centre;
  }

  /* Pixels per ångström along the screen's horizontal axis at the model centre. */
  function pixelsPerAngstrom(target) {
    if (!target || typeof target.modelToScreen !== 'function' || typeof target.getView !== 'function') return null;
    const centre = sceneCentre(); if (!centre) return null;
    const axis = screenAxisInModelSpace(target.getView(), { x: 1, y: 0, z: 0 });
    const a = target.modelToScreen(centre); const b = target.modelToScreen({ x: centre.x + axis.x, y: centre.y + axis.y, z: centre.z + axis.z });
    if (!a || !b) return null;
    const pixels = Math.hypot(b.x - a.x, b.y - a.y);
    return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
  }

  function scaleBarSpec(target, plan) {
    const length = Number(root.querySelector('#gpv-scale-bar').value) || 0;
    if (!length || !target) return null;
    const perAngstrom = pixelsPerAngstrom(target); if (!perAngstrom) return null;
    const pixels = length * perAngstrom;
    if (pixels < 8 || pixels > plan.width * 0.9) return null;
    return { length, pixels, width: plan.width, height: plan.height };
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

