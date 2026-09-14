  const root = document.getElementById('generic-protein-viewer');

  /* 3Dmol.js is the one hard dependency. Without it nothing below can run, so
     fail loudly and usefully instead of leaving a blank page behind. */
  if (typeof $3Dmol === 'undefined' || typeof $3Dmol.createViewer !== 'function') {
    const notice = root.querySelector('#gpv-import-errors');
    notice.hidden = false;
    notice.textContent = 'The 3Dmol.js rendering library could not be loaded from the CDN. '
      + 'Check your internet connection (or any blocker or offline cache) and reload the page.';
    root.querySelector('#gpv-stage-empty').hidden = true;
    root.querySelectorAll('button, select, input').forEach(control => { control.disabled = true; });
    return;
  }

  /* 3Dmol draws every viewer through one shared OffscreenCanvas when the browser has
     one, transferring a bitmap into each canvas. Firefox and WebKit fail that transfer
     as soon as a second viewer of a different size exists — the multi-view and export
     cases — so those engines get a WebGL context of their own per canvas, which is
     3Dmol's grid path with a single cell. */
  const directContexts = typeof OffscreenCanvas !== 'undefined' && !(window.chrome && /Chrom/.test(navigator.userAgent));
  function viewerOptions(extra = {}) {
    return { backgroundColor: '#ffffff', backgroundAlpha: 0, antialias: true, ...(directContexts ? { row: 0, col: 0, rows: 1, cols: 1 } : {}), ...extra };
  }
  const viewer = $3Dmol.createViewer(root.querySelector('#gpv-stage'), viewerOptions());
  const palette = ['#8b5cf6', '#06b6d4', '#f97316', '#22c55e', '#ec4899', '#eab308', '#3b82f6', '#ef4444'];
  /* Chain colours are assigned in sorted order the first time a chain is seen and
     never change afterwards, so chain A is the same blue in every model, every
     panel, the legend, the sequence strip, and the report. */
  const chainPalette = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444', '#6366f1', '#84cc16', '#0ea5e9', '#d946ef'];
  const chainOrder = new Map();
  const compareChains = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  /* Okabe & Ito (2008) palette, ordered so chain A stays blue. Black is replaced by grey for ribbons. */
  const okabeIto = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#999999'];
  let safePaletteOn = false;
  function chainColor(chain) {
    const key = chain || '';
    if (!chainOrder.has(key)) chainOrder.set(key, chainOrder.size);
    const source = safePaletteOn ? okabeIto : chainPalette;
    return source[chainOrder.get(key) % source.length];
  }
  function seedChainColors(atoms) {
    [...new Set(atoms.map(atom => atom.chain || ''))].sort(compareChains).forEach(chainColor);
  }
  const clipText = (text, limit) => String(text).length > limit ? String(text).slice(0, limit - 1) + '…' : String(text);
  let structures = [];
  let animationFrame = 0;
  let rockPhase = 0;
  let rockDirection = 1;
  let activeId = null;
  let cycleTimer = 0;
  let selectedResidue = null;
  let labelRecords = [];
  let nextStructureId = 1;
  let confidenceAssets = [];
  let alignmentResults = [];
  let selectionRecords = [];
  let measurementRecords = [];
  let measurementDraft = [];
  let measurementActive = false;
  let annotationRecords = [];
  let interfaceResults = null;
  let annotationDraft = [];
  let annotationActive = false;
  let savedViews = [];
  let nextAnnotationId = 1;
  let comparePanels = [];
  let nextPanelId = 1;
  const maxComparePanels = 5;
  let syncingView = false;
  let compareSyncFrame = 0;
  let pendingScene = null;
  let listLimit = 60;
  let fullscreen = false;
  let busyDepth = 0;
  let restoreMotion = null;
  const listPageSize = 60;
  const viewerVersion = '2.23.0';
  const preferenceKey = 'protein-structure-viewer:preferences';
  const themeKey = 'protein-structure-viewer:theme';
  const labelColors = getComputedStyle(root);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

