  /* ---------- Orientation ---------- */

  function rotateView(axis, degrees) {
    if (typeof viewer.rotate !== 'function') return;
    viewer.rotate(degrees, axis);
    viewer.render();
    syncViewsFrom(viewer);
    updateStatus('Rotated ' + (degrees > 0 ? '+' : '') + degrees + '° about ' + axis.toUpperCase());
  }

  function resetOrientation() {
    if (typeof viewer.getView !== 'function') return;
    const view = viewer.getView();
    viewer.setView([view[0], view[1], view[2], view[3], 0, 0, 0, 1]);
    viewer.render();
    syncViewsFrom(viewer);
    updateStatus('Orientation reset to the coordinate frame of the file');
  }

