  /* ---------- Workspace layout ----------
     'workspace' keeps the 3D view pinned beside a scrolling tool panel; 'stacked' is the
     single column. The choice is remembered; the CSS falls back to stacked below 1100px. */
  const layoutKey = 'protein-structure-viewer:layout';
  const panelWidthKey = 'protein-structure-viewer:panel-width';
  let layoutMode = (() => { try { const stored = localStorage.getItem(layoutKey); return stored === 'stacked' ? 'stacked' : 'workspace'; } catch (error) { return 'workspace'; } })();
  const workspaceActive = () => layoutMode === 'workspace' && window.matchMedia('(min-width: 1100px)').matches;
  const panelSideKey = 'protein-structure-viewer:panel-side';
  let panelSide = (() => { try { return localStorage.getItem(panelSideKey) === 'right' ? 'right' : 'left'; } catch (error) { return 'left'; } })();
  function applyPanelSide() {
    root.classList.toggle('is-panel-right', panelSide === 'right');
    const button = root.querySelector('#gpv-panel-side');
    button.setAttribute('aria-label', 'Tool panel on the ' + panelSide + ': click to move it ' + (panelSide === 'left' ? 'right' : 'left'));
    requestAnimationFrame(() => { viewer.resize(); viewer.render(); comparePanels.forEach(panel => { if (panel.viewer) { panel.viewer.resize(); panel.viewer.render(); } }); });
  }
  root.querySelector('#gpv-panel-side').addEventListener('click', () => {
    panelSide = panelSide === 'left' ? 'right' : 'left';
    try { localStorage.setItem(panelSideKey, panelSide); } catch (error) {}
    applyPanelSide(); announce('Tool panel on the ' + panelSide);
  });
  applyPanelSide();

  function fitStageToViewport() {
    const stage = root.querySelector('#gpv-stage');
    if (!workspaceActive()) { root.style.removeProperty('--gpv-stage-height'); return; }
    const column = root.querySelector('#gpv-stage-column');
    const grid = root.querySelector('#gpv-view-grid');
    const others = ['#gpv-session-banner', '.gpv-primary', '.gpv-status', '#gpv-sequence', '#gpv-tip', '#gpv-plddt-legend']
      .map(selector => root.querySelector(selector)).filter(node => node && !node.hidden)
      .reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
    const labels = [...grid.querySelectorAll('.gpv-view-label')].filter(node => !node.hidden).length ? 26 : 0;
    const rows = Math.max(1, Math.ceil(Math.max(1, grid.children.length) / Math.max(1, Number(getComputedStyle(grid).getPropertyValue('--gpv-columns')) || 1)));
    grid.style.setProperty('--gpv-rows', String(rows));
    /* Measure from the workspace's natural (unscrolled) top so the whole column — controls,
       stage, status and sequence — fits the window without scrolling, and the height stays
       stable while the page scrolls. */
    const workspaceTop = Math.max(0, root.querySelector('#gpv-workspace').getBoundingClientRect().top + window.scrollY);
    const available = window.innerHeight - workspaceTop - others - labels - 44;
    const height = Math.max(420, Math.min(available, 1200));
    const current = parseFloat(root.style.getPropertyValue('--gpv-stage-height')) || 0;
    if (Math.abs(current - height) < 8) return;
    root.style.setProperty('--gpv-stage-height', height + 'px');
    requestAnimationFrame(() => { viewer.resize(); viewer.render(); comparePanels.forEach(panel => { if (panel.viewer) { panel.viewer.resize(); panel.viewer.render(); } }); });
  }

  function applyLayout(announceChange) {
    root.classList.toggle('is-workspace', layoutMode === 'workspace');
    const button = root.querySelector('#gpv-layout');
    button.setAttribute('aria-pressed', String(layoutMode === 'workspace'));
    button.setAttribute('aria-label', 'Layout: ' + (layoutMode === 'workspace' ? 'side panel' : 'stacked'));
    button.dataset.tooltip = layoutMode === 'workspace' ? 'Side-panel workspace · click for the stacked layout' : 'Stacked layout · click to pin the 3D view beside the tool panel';
    fitStageToViewport();
    requestAnimationFrame(() => { viewer.resize(); viewer.render(); comparePanels.forEach(panel => { if (panel.viewer) { panel.viewer.resize(); panel.viewer.render(); } }); renderSequenceSoon(); });
    if (announceChange) announce(layoutMode === 'workspace' ? 'Side-panel layout · the 3D view stays in place while you work in the panel' : 'Stacked layout');
  }

  root.querySelector('#gpv-layout').addEventListener('click', () => {
    layoutMode = layoutMode === 'workspace' ? 'stacked' : 'workspace';
    try { localStorage.setItem(layoutKey, layoutMode); } catch (error) {}
    applyLayout(true);
  });
  window.addEventListener('resize', fitStageToViewport);
  new ResizeObserver(() => fitStageToViewport()).observe(root.querySelector('#gpv-sequence-rows'));
  new ResizeObserver(() => fitStageToViewport()).observe(root.querySelector('#gpv-plddt-legend'));
  root.querySelector('#gpv-sequence-toggle').addEventListener('click', () => setTimeout(fitStageToViewport, 0));

  /* Drag the divider to resize the tool panel (double-click or Enter resets it). */
  (() => {
    const splitter = root.querySelector('#gpv-splitter');
    const minWidth = 300; const maxWidth = () => Math.max(minWidth, Math.floor(root.getBoundingClientRect().width * 0.6));
    const setWidth = (width, persist) => {
      const clamped = Math.round(Math.max(minWidth, Math.min(maxWidth(), width)));
      root.style.setProperty('--gpv-panel-width', clamped + 'px');
      if (persist) { try { localStorage.setItem(panelWidthKey, String(clamped)); } catch (error) {} }
      fitStageToViewport(); requestAnimationFrame(() => { viewer.resize(); viewer.render(); });
    };
    try { const stored = Number(localStorage.getItem(panelWidthKey)); if (stored >= minWidth) setWidth(stored, false); } catch (error) {}
    let startX = 0; let startWidth = 0;
    const move = event => { setWidth(startWidth + (panelSide === 'right' ? startX - event.clientX : event.clientX - startX), false); };
    const stop = () => { splitter.classList.remove('is-dragging'); root.classList.remove('is-dragging-splitter'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); const width = parseFloat(root.style.getPropertyValue('--gpv-panel-width')); if (width) setWidth(width, true); };
    splitter.addEventListener('pointerdown', event => {
      event.preventDefault(); startX = event.clientX; startWidth = root.querySelector('#gpv-side-panel').getBoundingClientRect().width;
      splitter.classList.add('is-dragging'); root.classList.add('is-dragging-splitter');
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
    });
    splitter.addEventListener('dblclick', () => { root.style.removeProperty('--gpv-panel-width'); try { localStorage.removeItem(panelWidthKey); } catch (error) {} fitStageToViewport(); requestAnimationFrame(() => { viewer.resize(); viewer.render(); }); });
    splitter.addEventListener('keydown', event => {
      const current = root.querySelector('#gpv-side-panel').getBoundingClientRect().width;
      const grow = panelSide === 'right' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(current + (grow ? 20 : -20), true); }
      else if (event.key === 'Enter') { event.preventDefault(); root.style.removeProperty('--gpv-panel-width'); try { localStorage.removeItem(panelWidthKey); } catch (error) {} fitStageToViewport(); }
    });
  })();
  applyLayout(false);
