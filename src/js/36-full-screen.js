  /* ---------- Full screen ---------- */

  function setFullscreen(next) {
    fullscreen = next;
    const grid = root.querySelector('#gpv-view-grid');
    grid.classList.toggle('is-fullscreen', fullscreen);
    if (!fullscreen) setTimeout(fitStageToViewport, 0);
    document.body.style.overflow = fullscreen ? 'hidden' : '';
    const button = root.querySelector('#gpv-fullscreen');
    const host = button.querySelector('[data-icon]');
    host.setAttribute('data-icon', fullscreen ? 'minimize' : 'maximize');
    host.replaceChildren();
    if (typeof gpvRenderIcons === 'function') gpvRenderIcons(button);
    button.lastChild.textContent = fullscreen ? 'Exit full screen' : 'Full screen';
    requestAnimationFrame(() => {
      viewer.resize();
      viewer.render();
      comparePanels.forEach(panel => { if (panel.viewer) { panel.viewer.resize(); panel.viewer.render(); } });
    });
  }

