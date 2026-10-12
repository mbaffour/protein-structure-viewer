  /* ---------- Box selection ----------
     Labelling a stretch of the model one click at a time is a dozen trips through the editor for a
     helix or a binding pocket. A rectangle drawn over the model picks every Cα inside it at once:
     the residues become an ordinary highlight selection (one undo step) and a popover beside the
     rectangle offers to label them all (one more). Everything it makes is an ordinary selection or
     label record, so nothing saved in a scene, session, share link or report changes shape. A mouse
     draws the rectangle with Shift held — a plain drag still turns the model — and the Drag to
     select toggle in Annotate makes any drag draw it, which is the only way a finger or a keyboard
     user without Shift-drag gets one. */

  /* Below this in both directions a press-and-release is a click, not a rectangle: a hand holding
     Shift wobbles a pixel or two, and that should still label the residue it clicked. */
  const boxClickLimit = 6;
  let boxSelectMode = false;
  /* { pointerId, x0, y0, x1, y1 } in page coordinates while a rectangle is being drawn. */
  let boxDrag = null;
  let boxOverlay = null;
  let boxPopoverHost = null;
  /* What the open popover offers to label: the picked residues, and how many undo steps had been
     taken when the selection was made, so its Undo can tell whether it would still undo that. */
  let boxPopover = null;

  function setBoxSelectMode(on, announceIt = false) {
    boxSelectMode = Boolean(on);
    /* One mode at a time, as drawing and measuring already are with each other: a drag that both
       selected and fed a measurement would do neither well. */
    if (boxSelectMode && annotationActive) toggleAnnotating(false);
    if (boxSelectMode && measurementActive) toggleMeasurement();
    const button = root.querySelector('#gpv-box-select');
    if (button) { setButtonText(button, boxSelectMode ? 'Stop selecting' : 'Drag to select'); button.setAttribute('aria-pressed', String(boxSelectMode)); }
    root.querySelector('#gpv-stage').classList.toggle('is-box-selecting', boxSelectMode);
    if (!boxSelectMode) cancelBoxDrag();
    if (announceIt) updateStatus(boxSelectMode ? 'Drag across the model to select the residues inside · Esc stops' : 'Selecting by dragging is off · a drag turns the model again');
  }

  function isInBoxPopover(target) {
    return Boolean(boxPopoverHost && target instanceof Node && boxPopoverHost.contains(target));
  }

  function boxOverlayElement() {
    if (boxOverlay) return boxOverlay;
    const box = document.createElement('div');
    box.className = 'gpv-box-rect'; box.hidden = true;
    /* The rectangle is a picture of the gesture; the result is announced in words afterwards. */
    box.setAttribute('aria-hidden', 'true');
    root.querySelector('#gpv-stage').append(box);
    boxOverlay = box;
    return box;
  }

  function stageOrigin() {
    const rect = root.querySelector('#gpv-stage').getBoundingClientRect();
    return { x: rect.left + scrollX, y: rect.top + scrollY };
  }

  function boxBounds(drag) {
    return { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), right: Math.max(drag.x0, drag.x1), bottom: Math.max(drag.y0, drag.y1) };
  }

  /* Called first thing from the stage's capture-phase pointerdown (watchStageClicks). Returns true
     when the press starts a rectangle; the press is then the rectangle's and never reaches 3Dmol,
     which is what keeps the model still — the same interception the label drag uses. Shift takes
     precedence over a label under the pointer: Shift says what the drag is for. */
  function beginBoxSelection(event) {
    if (!boxSelectMode && !(event.shiftKey && event.pointerType !== 'touch')) return false;
    if (typeof viewer.modelToScreen !== 'function') return false;
    event.preventDefault(); event.stopPropagation();
    const stage = root.querySelector('#gpv-stage');
    try { stage.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    closeBoxPopover(false);
    boxDrag = { pointerId: event.pointerId, x0: event.pageX, y0: event.pageY, x1: event.pageX, y1: event.pageY };
    return true;
  }

  function moveBoxSelection(event) {
    const drag = boxDrag; if (!drag) return;
    drag.x1 = event.pageX; drag.y1 = event.pageY;
    const bounds = boxBounds(drag);
    const box = boxOverlayElement();
    /* Nothing is drawn until the press has become a drag, so a Shift-click does not flash a box. */
    if (bounds.right - bounds.left < boxClickLimit && bounds.bottom - bounds.top < boxClickLimit) { box.hidden = true; return; }
    const origin = stageOrigin();
    box.style.left = Math.round(bounds.left - origin.x) + 'px';
    box.style.top = Math.round(bounds.top - origin.y) + 'px';
    box.style.width = Math.round(bounds.right - bounds.left) + 'px';
    box.style.height = Math.round(bounds.bottom - bounds.top) + 'px';
    box.hidden = false;
  }

  function cancelBoxDrag() {
    boxDrag = null;
    if (boxOverlay) boxOverlay.hidden = true;
  }

  function endBoxSelection(event) {
    const drag = boxDrag; if (!drag) return;
    drag.x1 = event.pageX; drag.y1 = event.pageY;
    cancelBoxDrag();
    const bounds = boxBounds(drag);
    if (bounds.right - bounds.left < boxClickLimit && bounds.bottom - bounds.top < boxClickLimit) {
      /* A click after all. On a piece of text it edits that text, as a click on it always does. */
      const text = labelHitAt(event.pageX, event.pageY);
      if (text) { event.preventDefault(); event.stopPropagation(); openLabelEditorForItem(text); return; }
      /* Otherwise the stage's own pointerup listener runs next and does what any click on the
         structure does — selects the residue and opens the label editor — once it is told where
         the press started; starting it at the release keeps its own 4 px rule from turning a 5 px
         wobble back into nothing. */
      pointerStart = { x: event.pageX, y: event.pageY, time: Date.now() };
      return;
    }
    event.preventDefault(); event.stopPropagation();
    selectResiduesInBox(bounds);
  }

  /* Every Cα drawn on screen whose projection falls inside the rectangle, one per residue: the same
     projection pickAtomAt uses, so what the box encloses is what a click there would have picked.
     A hidden chain, and residues hidden under the low-confidence cut, are not drawn, so they are not
     picked; neither is a calcium ion, whose atom is also called CA. */
  function residuesInBox(bounds) {
    const picks = []; const seen = new Set();
    const threshold = hideBelow();
    displayedEntries().filter(entry => entry.model).forEach(entry => {
      const hidden = entry.hiddenChains || [];
      const cut = threshold && entry.scores.length;
      entry.atoms.forEach(atom => {
        if (atom.atom !== 'CA' || atom.hetflag || hidden.includes(atom.chain || '')) return;
        if (cut && Number(atom.b) < threshold) return;
        const screen = viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return;
        if (screen.x < bounds.left || screen.x > bounds.right || screen.y < bounds.top || screen.y > bounds.bottom) return;
        const key = residueKey(entry.id, atom.chain, atom.resi);
        if (seen.has(key)) return;
        seen.add(key); picks.push({ entry, atom });
      });
    });
    return picks;
  }

  function plural(count, one, many = one + 's') {
    return count + ' ' + (count === 1 ? one : many);
  }

  function selectResiduesInBox(bounds) {
    const picks = residuesInBox(bounds);
    if (!picks.length) { updateStatus('No residues inside the box — drag over the model itself'); return; }
    /* One record per model and chain, which is the shape every other highlight (motif, proximity,
       interface) already takes, so the list, the strip and the legend show it the same way. */
    const groups = new Map();
    picks.forEach(({ entry, atom }) => {
      const id = entry.id + '|' + (atom.chain || '');
      if (!groups.has(id)) groups.set(id, { entryId: entry.id, chain: atom.chain || '', residues: [] });
      groups.get(id).residues.push(atom.resi);
    });
    const color = root.querySelector('#gpv-selection-color').value;
    remember('box selection');
    groups.forEach(group => selectionRecords.push({ id: nextAnnotationId++, entryId: group.entryId, chain: group.chain, residues: [...new Set(group.residues)].sort((a, b) => a - b), action: 'highlight', color }));
    renderSelectionList(); applyStyle();
    const models = new Set(picks.map(pick => pick.entry.id)).size;
    const summary = plural(picks.length, 'residue') + ' in ' + plural(groups.size, 'chain') + ' of ' + plural(models, 'model');
    updateStatus('Selected ' + summary + ' · Label all labels them, Undo takes the selection back');
    const origin = stageOrigin();
    openBoxPopover(picks, summary, { x: bounds.left - origin.x, y: bounds.bottom - origin.y });
  }

  function boxPopoverElement() {
    if (boxPopoverHost) return boxPopoverHost;
    /* The label editor's card, head and button row, so the two popovers read as one family. */
    const host = document.createElement('div');
    host.id = 'gpv-box-popover'; host.className = 'gpv-label-editor gpv-box-popover'; host.hidden = true;
    host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Selected residues');
    const head = document.createElement('div'); head.className = 'gpv-label-editor-head';
    const summary = document.createElement('span'); summary.className = 'gpv-box-popover-summary text-small';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'btn btn-ghost gpv-label-editor-close';
    close.textContent = '×'; close.title = 'Close and keep the highlight (Esc)'; close.setAttribute('aria-label', 'Close and keep the highlight');
    head.append(summary, close);
    const actions = document.createElement('div'); actions.className = 'gpv-label-editor-actions';
    const labelAll = document.createElement('button'); labelAll.type = 'button'; labelAll.className = 'btn btn-primary'; labelAll.id = 'gpv-box-label-all'; labelAll.textContent = 'Label all';
    const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'btn btn-ghost'; keep.id = 'gpv-box-keep'; keep.textContent = 'Keep highlight only';
    const undoButton = document.createElement('button'); undoButton.type = 'button'; undoButton.className = 'btn btn-ghost'; undoButton.id = 'gpv-box-undo'; undoButton.textContent = 'Undo';
    actions.append(labelAll, keep, undoButton);
    host.append(head, actions);
    /* Enter labels, Esc closes — unless Enter is on one of the other buttons, which it presses as
       usual. Stopped here so the page's own Esc does not also stop a mode or leave full screen. */
    host.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBoxPopover(true); return; }
      if (event.key !== 'Enter') return;
      if (event.target instanceof HTMLButtonElement && event.target !== labelAll) return;
      event.preventDefault(); event.stopPropagation();
      labelBoxSelection();
    });
    labelAll.addEventListener('click', labelBoxSelection);
    keep.addEventListener('click', () => { closeBoxPopover(true); updateStatus('Highlight kept · Label residues in its row labels it later'); });
    undoButton.addEventListener('click', undoBoxSelection);
    close.addEventListener('click', () => closeBoxPopover(true));
    /* As with the label editor: presses, drags and scrolls on the popover are its own and must not
       turn or zoom the model under it. */
    ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu', 'dblclick'].forEach(type => host.addEventListener(type, event => event.stopPropagation()));
    root.querySelector('#gpv-stage').append(host);
    boxPopoverHost = host;
    return host;
  }

  function openBoxPopover(picks, summary, anchor) {
    const host = boxPopoverElement();
    boxPopover = { picks, steps: rememberedSteps };
    const line = host.querySelector('.gpv-box-popover-summary');
    const count = document.createElement('strong'); count.textContent = plural(picks.length, 'residue');
    line.replaceChildren(count, summary.slice(count.textContent.length));
    host.hidden = false;
    positionBoxPopover(anchor);
    host.querySelector('#gpv-box-label-all').focus({ preventScroll: true });
  }

  /* At the rectangle's bottom-left corner, clamped inside the stage like the label editor. The
     anchor is a point on the screen, not on the model, so it is placed once rather than followed. */
  function positionBoxPopover(anchor) {
    const host = boxPopoverHost; if (!host || host.hidden) return;
    const stage = root.querySelector('#gpv-stage');
    const gap = 6; const margin = 4;
    const left = Math.max(margin, Math.min(stage.clientWidth - host.offsetWidth - margin, anchor.x));
    const top = Math.max(margin, Math.min(stage.clientHeight - host.offsetHeight - margin, anchor.y + gap));
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  function closeBoxPopover(returnFocus = false) {
    if (!boxPopover) return;
    const hadFocus = isInBoxPopover(document.activeElement);
    boxPopover = null;
    if (boxPopoverHost) boxPopoverHost.hidden = true;
    /* Back to the stage, so focus is never left on a button that has just been hidden. */
    if (returnFocus || hadFocus) root.querySelector('#gpv-stage').focus({ preventScroll: true });
  }

  function labelBoxSelection() {
    const popover = boxPopover; if (!popover) return;
    closeBoxPopover(true);
    labelResidues(popover.picks, 'labels for the selection');
  }

  /* Undo here means the selection this popover describes. If anything has been remembered since
     (a label, another selection), the top of the history is something else, and pressing Undo
     would take that back instead — so it says so and leaves the history alone. */
  function undoBoxSelection() {
    const popover = boxPopover; if (!popover) return;
    closeBoxPopover(true);
    const last = undoStack[undoStack.length - 1];
    if (rememberedSteps !== popover.steps || !last || last.what !== 'box selection') { updateStatus('Something has changed since the selection — use Undo beside the residue readout'); return; }
    undo();
  }

  /* One residue label per residue, as the panel's Add would make it — the same fields, the same
     `RESN45 · A` text — skipping residues that already carry a label, whose text is the user's.
     One undo step for all of them, and the new labels (only those) are pushed apart once, so a
     dozen of them do not land in a pile. Shared by Label all and each highlight row's button. */
  function labelResidues(picks, what) {
    const taken = new Set(labelRecords.map(label => label.key));
    const fresh = [];
    let kept = 0;
    picks.forEach(({ entry, atom }) => {
      const key = residueKey(entry.id, atom.chain, atom.resi);
      if (taken.has(key)) { kept += 1; return; }
      taken.add(key);
      fresh.push({ entryId: entry.id, chain: atom.chain || '', resi: atom.resi, resn: atom.resn || 'RES', atom: atom.atom || '', x: atom.x, y: atom.y, z: atom.z, b: atom.b, key, text: labelEditorDefaultText(atom) });
    });
    if (!fresh.length) { updateStatus(picks.length ? 'Every one of these residues is already labelled' : 'No residues of this selection are loaded'); return 0; }
    remember(what);
    labelRecords.push(...fresh);
    const added = new Set(fresh.map(label => label.key));
    separateLabels({ include: label => added.has(label.key) });
    renderLabelList(); rebuildOverlays();
    updateStatus('Labelled ' + plural(fresh.length, 'residue') + (kept ? ' · ' + kept + ' already labelled kept' : ''));
    return fresh.length;
  }

  /* The residues of a selection record, one atom each — the Cα where there is one, otherwise the
     residue's first atom (a nucleotide has no Cα) — in the order the model lists them. A blank
     chain means every chain, as it does when the selection is drawn. */
  function selectionRecordResidues(record) {
    const entry = entryById(record.entryId);
    if (!entry || !entry.atoms.length) return [];
    const wanted = new Set(record.residues);
    const found = new Map();
    entry.atoms.forEach(atom => {
      if (atom.hetflag || !wanted.has(atom.resi) || (record.chain && (atom.chain || '') !== record.chain)) return;
      const key = residueKey(entry.id, atom.chain, atom.resi);
      const current = found.get(key);
      if (!current || (atom.atom === 'CA' && current.atom !== 'CA')) found.set(key, atom);
    });
    return [...found.values()].map(atom => ({ entry, atom }));
  }

  /* The Label residues button of a highlight row in the selection list. */
  function selectionLabelButton(record) {
    const button = document.createElement('button');
    button.className = 'btn btn-ghost'; button.type = 'button'; button.textContent = 'Label residues';
    button.title = 'Label every residue of this highlight (residues already labelled keep their text)';
    button.addEventListener('click', () => labelResidues(selectionRecordResidues(record), 'labels for the selection'));
    return button;
  }

  /* Wired once at start-up, after watchStageClicks, whose pointerdown hands a Shift-press (or any
     press while the toggle is on) to beginBoxSelection. */
  function watchBoxSelection() {
    const stage = root.querySelector('#gpv-stage');
    stage.addEventListener('pointermove', event => {
      if (!boxDrag || event.pointerId !== boxDrag.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      moveBoxSelection(event);
    }, true);
    stage.addEventListener('pointerup', event => {
      if (!boxDrag || event.pointerId !== boxDrag.pointerId) return;
      endBoxSelection(event);
    }, true);
    stage.addEventListener('pointercancel', () => { if (boxDrag) cancelBoxDrag(); }, true);
    /* A finger's drag reaches 3Dmol as touch events, which stopping the pointerdown does not stop;
       while the toggle is on they are held at the stage so the model stays still under the box. */
    ['touchstart', 'touchmove', 'touchend'].forEach(type => stage.addEventListener(type, event => {
      if ((boxSelectMode || boxDrag) && !isInBoxPopover(event.target) && !isInLabelEditor(event.target)) event.stopPropagation();
    }, true));
    root.querySelector('#gpv-box-select').addEventListener('click', () => setBoxSelectMode(!boxSelectMode, true));
  }
