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
  /* A user can override any chain's automatic colour (Composition panel); the override wins
     everywhere chainColor() is read — main view, panels, sequence strip, legends, exports —
     since they all read colour through this one function rather than the palette directly. */
  const customChainColors = new Map();
  function chainColor(chain) {
    const key = chain || '';
    if (!chainOrder.has(key)) chainOrder.set(key, chainOrder.size);
    if (customChainColors.has(key)) return customChainColors.get(key);
    const source = safePaletteOn ? okabeIto : chainPalette;
    return source[chainOrder.get(key) % source.length];
  }
  function seedChainColors(atoms) {
    [...new Set(atoms.map(atom => atom.chain || ''))].sort(compareChains).forEach(chainColor);
  }
  /* Deliberately does not register the chain's palette position: a scene can restore overrides
     before its models are seeded, and claiming a position here would shift the palette colour of
     every chain that was not overridden. */
  function setChainColor(chain, color) {
    customChainColors.set(chain || '', color);
  }
  function resetChainColor(chain) {
    customChainColors.delete(chain || '');
  }
  function resetAllChainColors() {
    customChainColors.clear();
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
  const viewerVersion = '2.46.3';
  const preferenceKey = 'protein-structure-viewer:preferences';
  const themeKey = 'protein-structure-viewer:theme';
  const labelColors = getComputedStyle(root);
  /* The theme's colour tokens are light-dark() and color-mix() expressions. CSS resolves them;
     3Dmol, canvas 2D and a standalone SVG do not, and getPropertyValue hands back the expression —
     which 3Dmol reads as black and a canvas silently ignores. themeColor() lets the browser resolve a
     token for the current theme and returns an opaque hex, a translucent token composited over the
     page background the way the interface shows it. */
  const themeProbe = document.createElement('span');
  themeProbe.setAttribute('aria-hidden', 'true');
  themeProbe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
  root.append(themeProbe);
  const themeCanvas = document.createElement('canvas');
  themeCanvas.width = 1; themeCanvas.height = 1;
  const themeContext = themeCanvas.getContext('2d', { willReadFrequently: true });
  const themeCache = new Map();
  function cssRgba(value) {
    themeProbe.style.color = '';
    themeProbe.style.color = value;
    themeContext.clearRect(0, 0, 1, 1);
    themeContext.fillStyle = '#000000';
    themeContext.fillStyle = getComputedStyle(themeProbe).color;
    themeContext.fillRect(0, 0, 1, 1);
    const data = themeContext.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3] / 255];
  }
  function themeColor(name, fallback) {
    if (!labelColors.getPropertyValue(name).trim()) return fallback;
    const scheme = (document.documentElement.getAttribute('data-theme') || '') + (matchMedia('(prefers-color-scheme: dark)').matches ? '|dark' : '|light');
    const key = name + '|' + scheme;
    if (themeCache.has(key)) return themeCache.get(key);
    try {
      const [r, g, b, a] = cssRgba('var(' + name + ')');
      const [pr, pg, pb, pa] = cssRgba('var(--background)');
      const paper = pa > 0 ? [pr, pg, pb] : [255, 255, 255];
      const hex = '#' + [r, g, b].map((channel, index) => Math.round(channel * a + paper[index] * (1 - a)).toString(16).padStart(2, '0')).join('');
      themeCache.set(key, hex);
      return hex;
    } catch (error) {
      return fallback;
    }
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

