  /* ---------- Figure templates ----------
     Every figure of a paper has to match the others: the same panel grid, the same captions, the
     same width and resolution, the same legend in the same corner. A template is exactly that
     presentation, saved under a name in this browser and applied again in this session or a month
     later. What a template deliberately does not hold is the data — no ticked views, no models, no
     camera, no colours, no file names — so applying one to the next project is safe: it changes how
     the figure is drawn, never what is in it. */

  const figureTemplateKey = 'protein-structure-viewer:figure-templates';
  const maxFigureTemplates = 20;

  /* The controls a template carries: the figure builder's own options, the output plan
     exportDimensions() reads (both the print fields and the pixel ones, so a template is meaningful
     whichever mode it was saved in), the figure format, the figure font, and the legend and scale bar the export
     consults through legendWanted() and scaleBarSpec(). */
  const figureTemplateControls = [
    '#gpv-panel-columns', '#gpv-builder-captions', '#gpv-builder-letters', '#gpv-builder-legends', '#gpv-builder-architecture',
    '#gpv-export-mode', '#gpv-print-width', '#gpv-print-custom', '#gpv-print-aspect', '#gpv-print-dpi', '#gpv-print-text',
    '#gpv-export-size', '#gpv-export-scale',
    '#gpv-image-format', '#gpv-export-legend', '#gpv-legend-position', '#gpv-scale-bar', '#gpv-figure-font'
  ];

  function figureTemplateSettings() {
    return Object.fromEntries(figureTemplateControls.map(selector => {
      const control = root.querySelector(selector);
      return [selector, control.type === 'checkbox' ? control.checked : control.value];
    }));
  }

  function applyFigureTemplate(template) {
    if (!template || typeof template !== 'object') return;
    figureTemplateControls.forEach(selector => {
      const control = root.querySelector(selector);
      const value = template[selector];
      if (control.type === 'checkbox') {
        if (typeof value === 'boolean') siteFigureSet(selector, value);
        return;
      }
      if (typeof value !== 'string') return;
      /* Only values the control actually offers: a template written by an older version, or one
         hand-edited in localStorage, must not put a control into a state nothing handles. */
      if (control.tagName === 'SELECT' && ![...control.options].some(option => option.value === value)) return;
      siteFigureSet(selector, value);
    });
    renderFigureBuilder();
  }

  /* What the template does to the figure, in the few words that fit in a status line. */
  function figureTemplateSummary(settings) {
    const columns = String(settings['#gpv-panel-columns'] || 'auto');
    const grid = columns === 'auto' ? 'automatic columns' : columns + ' column' + (columns === '1' ? '' : 's');
    if (settings['#gpv-export-mode'] === 'print') {
      const width = settings['#gpv-print-width'] === 'custom' ? settings['#gpv-print-custom'] : settings['#gpv-print-width'];
      return grid + ' · ' + width + ' mm at ' + settings['#gpv-print-dpi'] + ' dpi';
    }
    return grid + ' · ' + String(settings['#gpv-export-size'] || '').replace('x', ' × ') + ' px at ' + settings['#gpv-export-scale'] + '×';
  }

  const compareTemplateNames = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

  /* Stored templates, kept sorted by name and filtered to the records this version understands, so
     a corrupt or foreign entry costs one template rather than the whole library. readJson and
     writeJson swallow the exception a private window throws. */
  function figureTemplates() {
    const stored = readJson(figureTemplateKey, []);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(item => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim() && item.settings && typeof item.settings === 'object')
      .map(item => ({ name: item.name.trim().slice(0, 60), created: typeof item.created === 'string' ? item.created : '', settings: item.settings }))
      .sort(compareTemplateNames)
      .slice(0, maxFigureTemplates);
  }

  function renderFigureTemplates(preferred) {
    const list = figureTemplates();
    const select = root.querySelector('#gpv-template-list');
    const wanted = preferred === undefined ? select.value : preferred;
    select.replaceChildren();
    if (!list.length) {
      const empty = document.createElement('option');
      empty.value = ''; empty.disabled = true; empty.selected = true; empty.textContent = 'No templates yet';
      select.append(empty);
    } else list.forEach(item => {
      const option = document.createElement('option');
      option.value = item.name; option.textContent = item.name;
      select.append(option);
    });
    if (list.some(item => item.name === wanted)) select.value = wanted;
    root.querySelector('#gpv-template-apply').disabled = !select.value;
    root.querySelector('#gpv-template-delete').disabled = !select.value;
    root.querySelector('#gpv-template-save').disabled = !root.querySelector('#gpv-template-name').value.trim();
  }

  function saveFigureTemplate() {
    const name = root.querySelector('#gpv-template-name').value.trim().slice(0, 60);
    if (!name) return;
    const list = figureTemplates();
    const existing = list.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
    /* Saving a name that is already taken is how a template gets corrected — overwrite it and say
       so, rather than asking a question whose only sensible answer is yes. */
    if (existing < 0 && list.length >= maxFigureTemplates) {
      announce(maxFigureTemplates + ' templates is the limit · delete one before saving another', 'error');
      return;
    }
    const settings = figureTemplateSettings();
    const record = { name, created: new Date().toISOString(), settings };
    if (existing >= 0) list[existing] = record; else list.push(record);
    list.sort(compareTemplateNames);
    writeJson(figureTemplateKey, list);
    renderFigureTemplates(name);
    announce('Template "' + name + '" ' + (existing >= 0 ? 'updated' : 'saved') + ' · ' + figureTemplateSummary(settings));
  }

  root.querySelector('#gpv-template-name').addEventListener('input', () => renderFigureTemplates());
  root.querySelector('#gpv-template-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveFigureTemplate(); } });
  root.querySelector('#gpv-template-save').addEventListener('click', saveFigureTemplate);
  root.querySelector('#gpv-template-list').addEventListener('change', () => renderFigureTemplates());
  root.querySelector('#gpv-template-apply').addEventListener('click', () => {
    const name = root.querySelector('#gpv-template-list').value;
    const template = figureTemplates().find(item => item.name === name);
    if (!template) return;
    applyFigureTemplate(template.settings);
    announce('Template "' + name + '" applied · ' + figureTemplateSummary(template.settings));
  });
  root.querySelector('#gpv-template-delete').addEventListener('click', () => {
    const name = root.querySelector('#gpv-template-list').value;
    if (!name) return;
    writeJson(figureTemplateKey, figureTemplates().filter(item => item.name !== name));
    renderFigureTemplates('');
    announce('Template "' + name + '" deleted');
  });
  renderFigureTemplates();
