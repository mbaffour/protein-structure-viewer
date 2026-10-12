  /* ---------- Canvas label editor ----------
     Labelling used to mean clicking a residue, finding the Annotate tab, typing in its field and
     pressing a button a screen away from the residue being named. The editor brings that field to
     the residue: a small popover inside the stage, anchored beside the residue, that takes the
     text and Enter. It is UI state only — a commit goes through the same records, the same undo
     step and the same renderers as the panel does, so nothing saved in a scene, session, share
     link or report changes shape because of it. */

  /* Which piece of text the arrow keys move and Delete removes. Stored by identity — a label's
     `key`, an annotation's `id` — rather than by object, because addOrEditLabel replaces a record
     with a merged copy and undo rebuilds every array from a clone: a stored reference would go on
     pointing at an object nothing draws any more. */
  let activeText = null;
  /* { kind: 'new' | 'label' | 'annotation', entryId, atom, key, id, textKind } while the editor is
     open; null when it is closed. */
  let labelEditor = null;
  let labelEditorFrame = 0;
  let labelEditorHost = null;
  /* The Annotate panel's readout before anything is selected; the same words as the page's markup,
     so Clear all puts back what a fresh page shows. */
  const idleResidueText = 'Click a residue in the viewer or the sequence strip to inspect it — a label editor opens at it. L opens it for the selected residue.';

  function canvasTextIdentity(kind, record) {
    if (kind === 'label') return { kind, key: record.key || null, record };
    return { kind, id: record.id, record };
  }

  /* The live record behind an identity, or null once it has gone (removed, cleared, undone). */
  function resolveCanvasText(identity) {
    if (!identity) return null;
    if (identity.kind === 'label') {
      const record = identity.key ? labelRecords.find(label => label.key === identity.key) : labelRecords.find(label => label === identity.record);
      return record ? { kind: 'label', record } : null;
    }
    const record = annotationRecords.find(item => item.id === identity.id);
    return record ? { kind: record.type === 'screen' ? 'screen' : 'annotation', record } : null;
  }

  function activeCanvasText() {
    const resolved = resolveCanvasText(activeText);
    if (!resolved && activeText) activeText = null;
    return resolved;
  }

  /* Read by drawLabels on the main viewer only: the outline says which label the arrows will move,
     and must never reach a figure. */
  function activeLabelRecord() {
    const resolved = activeCanvasText();
    return resolved && resolved.kind === 'label' ? resolved.record : null;
  }

  /* A 2 px ring in the interface accent. A plain-text label has no box to ring, so it is given a
     transparent one — the border alone shows, and the text keeps its look. */
  function activeLabelStyle(style) {
    const ring = { ...style, borderColor: themeColor('--primary', '#339cff'), borderOpacity: 1, borderThickness: 2 };
    if (!style.showBackground) { ring.showBackground = true; ring.backgroundOpacity = 0; }
    return ring;
  }

  function setActiveText(kind, record, shouldRender = true) {
    activeText = record ? canvasTextIdentity(kind, record) : null;
    if (shouldRender) rebuildOverlays();
  }

  function clearActiveText(shouldRender = true) {
    if (!activeText) return;
    activeText = null;
    if (shouldRender) rebuildOverlays();
  }

  /* One move for every way a label is moved — the mouse drag, the arrow keys, the row buttons — in
     screen pixels with y growing downward. Text attached to the structure keeps a model-space
     offset, so the screen step is turned into ångström along the camera's own right and up axes;
     a corner title keeps screen pixels. Callers take their own undo step: a drag takes one for the
     whole gesture, a key press one per press. */
  function nudgeCanvasText(item, dxScreen, dyScreen, perAngstrom = pixelsPerAngstrom(viewer) || 20) {
    const record = item.record;
    if (item.kind === 'screen') {
      record.dx = (record.dx || 0) + dxScreen;
      record.dy = (record.dy || 0) + dyScreen;
      return;
    }
    const view = typeof viewer.getView === 'function' ? viewer.getView() : [0, 0, 0, 0, 0, 0, 0, 1];
    const right = screenAxisInModelSpace(view, { x: 1, y: 0, z: 0 });
    const up = screenAxisInModelSpace(view, { x: 0, y: 1, z: 0 });
    const step = 1 / perAngstrom;
    const offset = record.offset || { x: 0, y: 0, z: 0 };
    record.offset = {
      x: offset.x + (right.x * dxScreen - up.x * dyScreen) * step,
      y: offset.y + (right.y * dxScreen - up.y * dyScreen) * step,
      z: offset.z + (right.z * dxScreen - up.z * dyScreen) * step
    };
    /* Once a hand has been on it the placement is the user's, and Separate labels leaves it alone. */
    if (item.kind === 'label') delete record.autoPlaced;
  }

  function renderCanvasTextLists(kind) {
    if (kind === 'label') renderLabelList(); else renderAnnotationList();
  }

  function labelEditorElement() {
    if (labelEditorHost) return labelEditorHost;
    const host = document.createElement('div');
    host.id = 'gpv-label-editor'; host.className = 'gpv-label-editor'; host.hidden = true;
    host.setAttribute('role', 'group');
    const head = document.createElement('div'); head.className = 'gpv-label-editor-head';
    const residue = document.createElement('span'); residue.className = 'gpv-label-editor-residue text-small';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'btn btn-ghost gpv-label-editor-close';
    close.textContent = '×'; close.title = 'Close (Esc)'; close.setAttribute('aria-label', 'Close the label editor');
    head.append(residue, close);
    const input = document.createElement('input');
    input.id = 'gpv-label-editor-text'; input.className = 'form-control'; input.type = 'text'; input.maxLength = 120;
    input.autocomplete = 'off'; input.setAttribute('aria-label', 'Label text');
    const actions = document.createElement('div'); actions.className = 'gpv-label-editor-actions';
    const commit = document.createElement('button'); commit.type = 'button'; commit.className = 'btn btn-primary'; commit.id = 'gpv-label-editor-commit';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost'; remove.id = 'gpv-label-editor-remove'; remove.textContent = 'Remove';
    actions.append(commit, remove);
    host.append(head, input, actions);
    /* Enter and Esc are the editor's own. Stopping them here keeps the page's shortcuts from also
       acting on them — Esc would otherwise leave full screen or stop a measurement as well. */
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      commitLabelEditor();
    });
    host.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      closeLabelEditor(true);
    });
    commit.addEventListener('click', commitLabelEditor);
    remove.addEventListener('click', removeFromLabelEditor);
    close.addEventListener('click', () => closeLabelEditor(true));
    /* The editor sits inside the stage, which is also 3Dmol's container: a drag that selects text in
       the field would otherwise reach 3Dmol as a mouse drag and turn the model, and a two-finger
       scroll over the editor would zoom it. These events are the editor's own. */
    ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu', 'dblclick'].forEach(type => host.addEventListener(type, event => event.stopPropagation()));
    root.querySelector('#gpv-stage').append(host);
    labelEditorHost = host;
    return host;
  }

  function isInLabelEditor(target) {
    return Boolean(labelEditorHost && target instanceof Node && labelEditorHost.contains(target));
  }

  function labelEditorDefaultText(atom) {
    return (atom.resn || 'RES') + atom.resi + (atom.chain ? ' · ' + atom.chain : '');
  }

  function locationText(chain, resi) {
    return (chain ? chain + ':' : '') + resi;
  }

  /* A residue picked in the viewer or the strip: a new label, or the one already on it. */
  function openLabelEditorForResidue(entry, atom) {
    const key = residueKey(entry.id, atom.chain, atom.resi);
    const existing = labelRecords.find(label => label.key === key);
    if (existing) { openLabelEditor({ kind: 'label', entryId: entry.id, atom, key }, existing.text, describeResidue(entry, atom)); setActiveText('label', existing); return; }
    /* selectResidue has just filled the panel's field; that is the suggestion, so the panel and the
       popover never disagree about what the label would say. */
    const field = root.querySelector('#gpv-label-text');
    const suggestion = field && field.value.trim() ? field.value.trim() : labelEditorDefaultText(atom);
    openLabelEditor({ kind: 'new', entryId: entry.id, atom, key }, suggestion, describeResidue(entry, atom));
  }

  /* A label, callout text or corner title clicked without being moved. */
  function openLabelEditorForItem(item) {
    if (item.kind === 'label') {
      const label = item.record;
      const entry = entryById(label.entryId);
      const atom = { chain: label.chain, resi: label.resi, resn: label.resn, b: label.b, x: label.x, y: label.y, z: label.z, atom: label.atom };
      openLabelEditor({ kind: 'label', entryId: label.entryId, atom, key: label.key, record: label }, label.text, entry ? describeResidue(entry, atom) : (label.resn || 'RES') + label.resi);
    } else {
      openLabelEditor({ kind: 'annotation', id: item.record.id, textKind: item.kind }, String(item.record.text || ''), null);
    }
    setActiveText(item.kind, item.record);
  }

  /* L: the residue already selected — by a click, the strip, Go to or the arrow keys of the strip —
     gets the editor without another click. */
  function openLabelEditorForSelection() {
    if (!selectedResidue) { updateStatus('Select a residue first — click it in the viewer or the sequence strip — then press L to label it'); return; }
    const entry = entryById(selectedResidue.entryId);
    if (!entry) { updateStatus('The selected residue’s model is no longer loaded'); return; }
    openLabelEditorForResidue(entry, selectedResidue);
  }

  function openLabelEditor(target, text, residueLine) {
    const host = labelEditorElement();
    labelEditor = target;
    const residue = host.querySelector('.gpv-label-editor-residue');
    /* Annotation text belongs to no one residue, so its editor has no residue line. */
    residue.textContent = residueLine || '';
    residue.hidden = !residueLine;
    host.setAttribute('aria-label', residueLine ? 'Label for ' + residueLine : 'Edit annotation text');
    const commit = host.querySelector('#gpv-label-editor-commit');
    commit.textContent = target.kind === 'new' ? 'Label' : 'Update';
    host.querySelector('#gpv-label-editor-remove').hidden = target.kind !== 'label';
    const input = host.querySelector('#gpv-label-editor-text');
    input.maxLength = target.kind === 'annotation' ? 160 : 120;
    input.value = text;
    host.hidden = false;
    positionLabelEditor();
    /* preventScroll: the stage is usually already in view, and a jump of the page would move the
       very residue the editor was opened at. */
    input.focus({ preventScroll: true });
    input.select();
    if (!labelEditorFrame) labelEditorFrame = requestAnimationFrame(followLabelEditor);
  }

  /* There is no render event to listen to, and the camera moves under the editor through 3Dmol's
     own mouse handling, spin, rock, cycling and the X/Y/Z keys — so the editor follows its anchor
     every frame while it is open, and the loop stops the moment it closes. */
  function followLabelEditor() {
    labelEditorFrame = 0;
    if (!labelEditor) return;
    /* The text it was editing may have been removed from its row, cleared or undone. */
    if (labelEditor.kind !== 'new' && !labelEditorRecord()) { closeLabelEditor(false); return; }
    positionLabelEditor();
    labelEditorFrame = requestAnimationFrame(followLabelEditor);
  }

  function labelEditorRecord() {
    const editor = labelEditor; if (!editor) return null;
    if (editor.kind === 'label') return labelRecords.find(label => (editor.key ? label.key === editor.key : label === editor.record)) || null;
    if (editor.kind === 'annotation') return annotationRecords.find(item => item.id === editor.id) || null;
    return null;
  }

  /* Where the editor points, in stage pixels. */
  function labelEditorAnchor() {
    const editor = labelEditor; if (!editor || typeof viewer.modelToScreen !== 'function') return null;
    const stage = root.querySelector('#gpv-stage');
    const rect = stage.getBoundingClientRect();
    const record = labelEditorRecord();
    let point = null;
    if (editor.kind === 'annotation') {
      const item = record && draggableLabels().find(candidate => candidate.record === record);
      if (item && item.screen) return { x: item.screen.x, y: item.screen.y };
      point = item ? item.position : null;
    } else if (editor.kind === 'label' && record) point = labelPosition(record);
    /* A new label is anchored where it will be drawn — labelAnchor, the residue's Cα as a rule —
       not at whichever atom of the residue the click happened to land nearest. */
    else point = labelAnchor({ entryId: editor.entryId, chain: editor.atom.chain || '', resi: editor.atom.resi, atom: editor.atom.atom || '', x: editor.atom.x, y: editor.atom.y, z: editor.atom.z });
    if (!point || !Number.isFinite(point.x)) return null;
    const screen = viewer.modelToScreen(point);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
    return { x: screen.x - (rect.left + scrollX), y: screen.y - (rect.top + scrollY) };
  }

  /* Below the residue and centred on it, so neither the residue nor its label is covered; above it
     when there is no room below; and always inside the stage — a residue turned out of view leaves
     the editor at the nearest edge rather than zooming to bring it back. */
  function positionLabelEditor() {
    const host = labelEditorHost; if (!host || host.hidden) return;
    const stage = root.querySelector('#gpv-stage');
    const anchor = labelEditorAnchor() || { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const width = host.offsetWidth; const height = host.offsetHeight; const gap = 22; const margin = 4;
    let left = anchor.x - width / 2;
    let top = anchor.y + gap;
    if (top + height > stage.clientHeight - margin && anchor.y - gap - height >= margin) top = anchor.y - gap - height;
    left = Math.max(margin, Math.min(stage.clientWidth - width - margin, left));
    top = Math.max(margin, Math.min(stage.clientHeight - height - margin, top));
    const x = Math.round(left) + 'px'; const y = Math.round(top) + 'px';
    if (host.style.left !== x) host.style.left = x;
    if (host.style.top !== y) host.style.top = y;
  }

  function closeLabelEditor(returnFocus = false) {
    if (!labelEditor) return;
    const host = labelEditorHost;
    const hadFocus = isInLabelEditor(document.activeElement);
    labelEditor = null;
    if (labelEditorFrame) { cancelAnimationFrame(labelEditorFrame); labelEditorFrame = 0; }
    if (host) host.hidden = true;
    /* Focus goes back to the stage so the arrow keys and Delete reach the label just edited — and so
       focus is never left on an element that has just been hidden. */
    if (returnFocus || hadFocus) root.querySelector('#gpv-stage').focus({ preventScroll: true });
  }

  function commitLabelEditor() {
    const editor = labelEditor; if (!editor) return;
    const text = labelEditorHost.querySelector('#gpv-label-editor-text').value.trim();
    /* An empty commit is a cancel: a label of nothing is never created, and an existing label is
       removed with Remove, not by emptying it. */
    if (!text) { closeLabelEditor(true); return; }
    if (editor.kind === 'new') {
      const entry = entryById(editor.entryId);
      if (!entry) { closeLabelEditor(true); return; }
      /* The panel's own path, so a label added here is the label the panel would have added: one
         record, one undo step. If something else was selected meanwhile, re-select this residue
         first so the panel names what is being labelled. */
      const selected = selectedResidue && residueKey(selectedResidue.entryId, selectedResidue.chain, selectedResidue.resi);
      if (selected !== editor.key) selectResidue(entry, editor.atom);
      root.querySelector('#gpv-label-text').value = text;
      addOrEditLabel();
      const record = labelRecords.find(label => label.key === editor.key);
      closeLabelEditor(true);
      if (record) setActiveText('label', record);
      updateStatus('Label added at ' + locationText(editor.atom.chain, editor.atom.resi) + ' · arrow keys move it, Esc lets go');
      return;
    }
    const record = labelEditorRecord();
    if (!record) { closeLabelEditor(true); return; }
    if (editor.kind === 'label') {
      if (record.text !== text) {
        /* Text only: a position-comparison or domain label carries fields of its own (kind, colour,
           size) that a full upsert from the selected residue would overwrite. */
        remember('label change');
        record.text = text;
        renderLabelList(); rebuildOverlays();
        updateStatus('Label updated');
      }
      closeLabelEditor(true);
      setActiveText('label', record);
      return;
    }
    if (record.text !== text) {
      remember('annotation text');
      record.text = text;
      renderAnnotationList(); rebuildOverlays();
      updateStatus('Annotation text updated');
    }
    closeLabelEditor(true);
    setActiveText(editor.textKind || 'annotation', record);
  }

  function removeFromLabelEditor() {
    const record = labelEditor && labelEditor.kind === 'label' ? labelEditorRecord() : null;
    if (!record) { closeLabelEditor(true); return; }
    remember('label removal');
    labelRecords = labelRecords.filter(label => label !== record);
    closeLabelEditor(true);
    clearActiveText(false);
    renderLabelList(); rebuildOverlays();
    updateStatus('Label removed');
  }

  /* Anything that changes what is on screen underneath the editor or the active text — another
     model, Clear labels, Clear all — leaves neither behind. Nothing is committed. */
  function dismissCanvasText() {
    closeLabelEditor(false);
    activeText = null;
  }

  function nudgeActiveText(dx, dy, repeat) {
    const resolved = activeCanvasText(); if (!resolved) return;
    /* Holding an arrow key is one move, not sixty undo steps. */
    if (!repeat) remember('label nudge');
    nudgeCanvasText(resolved, dx, dy);
    renderCanvasTextLists(resolved.kind);
    rebuildOverlays();
  }

  function removeActiveText() {
    const resolved = activeCanvasText(); if (!resolved) return;
    closeLabelEditor(false);
    activeText = null;
    if (resolved.kind === 'label') {
      remember('label removal');
      labelRecords = labelRecords.filter(label => label !== resolved.record);
      renderLabelList(); rebuildOverlays();
      updateStatus('Label removed');
    } else {
      remember('annotation removal');
      annotationRecords = annotationRecords.filter(item => item.id !== resolved.record.id);
      renderAnnotationList(); rebuildOverlays();
      updateStatus('Annotation removed');
    }
  }

  /* The page's keyboard reach for labels, called from the global keydown handler before its own
     shortcuts. Returns true when the key was used. Never acts while someone is typing: the editor's
     own input is a text field like any other. */
  function canvasTextKeydown(event, typing) {
    if (typing) return false;
    if (event.key === 'Escape') {
      if (labelEditor) { closeLabelEditor(true); return true; }
      if (activeText) { clearActiveText(); updateStatus('No label selected'); return true; }
      return false;
    }
    if (event.key.toLowerCase() === 'l') { event.preventDefault(); openLabelEditorForSelection(); return true; }
    /* Arrows belong to the label only while one is active and nothing else (a tab button, say)
       has already taken the key; with nothing active ← and → still step through the models. */
    if (event.defaultPrevented || !activeCanvasText()) return false;
    const step = event.shiftKey ? 1 : 8;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) { event.preventDefault(); nudgeActiveText(moves[event.key][0], moves[event.key][1], event.repeat); return true; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeActiveText(); return true; }
    return false;
  }

