  /* ---------- PAE domains ---------- */

  const domainPalette = ['#2563eb', '#f97316', '#16a34a', '#a855f7', '#ec4899', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#65a30d', '#0ea5e9', '#c026d3'];
  const domainColorFor = id => { const source = safePaletteOn ? okabeIto : domainPalette; return source[(id - 1) % source.length]; };

  /* Map PAE token index -> residue tag (chain|resi), or null for tokens that are not
     protein residues (AlphaFold 3 ligand tokens, for example). */
  function paeTokens(entry) {
    const confidence = entry.confidence || {}; const matrix = confidence.pae;
    if (!Array.isArray(matrix) || !matrix.length || !isMatrixRow(matrix[0])) return null;
    const size = matrix.length;
    const protein = entry.atoms.filter(atom => atom.atom === 'CA' && !atom.hetflag);
    const known = new Set(protein.map(residueTag));
    if (Array.isArray(confidence.tokenChainIds) && Array.isArray(confidence.tokenResidueIds) && confidence.tokenChainIds.length === size) {
      return confidence.tokenChainIds.map((chain, index) => { const tag = String(chain) + '|' + Number(confidence.tokenResidueIds[index]); return known.has(tag) ? tag : null; });
    }
    if (protein.length === size) return protein.map(residueTag);
    const sorted = residueRows(entry).flatMap(row => row.residues);
    if (sorted.length === size) return sorted.map(residueTag);
    return null;
  }

  /* Greedy agglomerative segmentation: ten-residue segments merge, lowest mean PAE first,
     while the mean PAE between groups stays below the cutoff. Discontinuous domains can form. */
  function paeDomains(entry, cutoff) {
    const tags = paeTokens(entry); if (!tags) return null;
    const matrix = entry.confidence.pae;
    const value = (i, j) => (Number(matrix[i][j]) + Number(matrix[j][i])) / 2;
    const indices = []; tags.forEach((tag, i) => { if (tag) indices.push(i); });
    if (indices.length < 20) return { domains: [], tags, cutoff, unassigned: indices.length, tagToDomain: new Map(), reason: 'fewer than 20 protein residues in the PAE matrix' };
    const chainOf = i => tags[i].split('|')[0];
    const segments = []; let current = [];
    indices.forEach((i, position) => {
      const previous = indices[position - 1];
      const newChain = previous !== undefined && chainOf(previous) !== chainOf(i);
      if (current.length && (current.length >= 10 || newChain)) { segments.push(current); current = []; }
      current.push(i);
    });
    if (current.length) segments.push(current);
    for (let k = segments.length - 1; k > 0; k -= 1) {
      if (segments[k].length < 5 && chainOf(segments[k][0]) === chainOf(segments[k - 1][0])) { segments[k - 1] = segments[k - 1].concat(segments[k]); segments.splice(k, 1); }
    }
    const meanBetween = (a, b) => { let sum = 0; let count = 0; for (const i of a) for (const j of b) { sum += value(i, j); count += 1; } return sum / count; };
    const groups = segments.map(segment => segment.slice());
    const means = groups.map((g, i) => groups.map((h, j) => (i === j ? Infinity : meanBetween(g, h))));
    while (groups.length > 1) {
      let best = Infinity; let bi = -1; let bj = -1;
      for (let i = 0; i < groups.length; i += 1) for (let j = i + 1; j < groups.length; j += 1) if (means[i][j] < best) { best = means[i][j]; bi = i; bj = j; }
      if (best >= cutoff) break;
      const ni = groups[bi].length; const nj = groups[bj].length;
      groups[bi] = groups[bi].concat(groups[bj]);
      for (let k = 0; k < groups.length; k += 1) {
        if (k === bi || k === bj) continue;
        const merged = (means[bi][k] * ni + means[bj][k] * nj) / (ni + nj);
        means[bi][k] = merged; means[k][bi] = merged;
      }
      groups.splice(bj, 1); means.splice(bj, 1); means.forEach(row => row.splice(bj, 1));
    }
    /* A domain needs at least twenty residues; smaller leftovers join the nearest domain when
       they are within twice the cutoff, and are otherwise reported as unassigned. */
    const large = groups.filter(group => group.length >= 20); const small = groups.filter(group => group.length < 20);
    let unassigned = 0;
    small.forEach(group => {
      let best = Infinity; let target = null;
      large.forEach(candidate => { const m = meanBetween(group, candidate); if (m < best) { best = m; target = candidate; } });
      if (target && best < cutoff * 2) target.push(...group); else unassigned += group.length;
    });
    const domains = large.map(group => group.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]).map((tokens, index) => {
      const step = Math.max(1, Math.ceil(tokens.length / 200)); const sample = tokens.filter((_, i) => i % step === 0);
      let sum = 0; let count = 0;
      for (let x = 0; x < sample.length; x += 1) for (let y = x + 1; y < sample.length; y += 1) { sum += value(sample[x], sample[y]); count += 1; }
      return { id: index + 1, tokens, tags: tokens.map(i => tags[i]), internal: count ? sum / count : 0 };
    });
    const tagToDomain = new Map(); domains.forEach(domain => domain.tags.forEach(tag => tagToDomain.set(tag, domain.id)));
    return { domains, tags, cutoff, unassigned, tagToDomain };
  }

  function domainColor(entry, atom) {
    const found = entry.domains; if (!found) return '#9ca3af';
    const id = found.tagToDomain.get(residueTag(atom));
    return id ? domainColorFor(id) : '#9ca3af';
  }

  function domainRanges(domain) {
    const byChain = new Map();
    domain.tags.forEach(tag => { const [chain, resi] = tag.split('|'); if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push(Number(resi)); });
    return [...byChain.entries()].sort((a, b) => compareChains(a[0], b[0])).map(([chain, residues]) => (chain ? chain + ':' : '') + compactRange(residues)).join(', ');
  }

  function findDomains() {
    const entry = activeEntry(); if (!entry || !entry.model) return;
    const cutoff = Number(root.querySelector('#gpv-domain-cutoff').value) || 6;
    const tags = paeTokens(entry);
    if (!tags) { announce('No PAE matrix maps onto the residues of ' + displayName(entry), 'error'); return; }
    if (tags.length > 6000) { announce('The PAE matrix is too large to segment in the browser (' + tags.length + ' tokens)', 'error'); return; }
    const done = setBusy('Segmenting PAE…');
    try { entry.domains = paeDomains(entry, cutoff); } finally { done(); }
    renderDomains(entry);
    if (root.querySelector('#gpv-color-mode').value === 'domain') applyStyle();
    const count = entry.domains ? entry.domains.domains.length : 0;
    updateStatus(count + ' PAE domain' + (count === 1 ? '' : 's') + ' at ' + cutoff + ' Å in ' + displayName(entry));
  }

  function renderDomains(entry) {
    const hasPae = Boolean(entry && entry.model && paeTokens(entry));
    const found = entry && entry.domains;
    root.querySelector('#gpv-domain-run').disabled = !hasPae;
    root.querySelector('#gpv-domain-color').disabled = !found || !found.domains.length;
    root.querySelector('#gpv-domain-highlight').disabled = !found || !found.domains.length;
    root.querySelector('#gpv-domain-adopt').disabled = !found || !found.domains.length;
    const wrap = root.querySelector('#gpv-domain-wrap'); const body = root.querySelector('#gpv-domain-rows'); body.replaceChildren();
    const state = root.querySelector('#gpv-domain-state');
    if (!entry || !entry.model) { wrap.hidden = true; state.textContent = 'Show a model with a PAE matrix, then find its domains (heuristic).'; return; }
    if (!hasPae) { wrap.hidden = true; state.textContent = displayName(entry) + ' has no PAE matrix that maps onto its residues.'; return; }
    if (!found) { wrap.hidden = true; state.textContent = 'PAE loaded for ' + displayName(entry) + ' · choose a cutoff and find domains.'; return; }
    wrap.hidden = !found.domains.length;
    state.textContent = found.domains.length
      ? found.domains.length + ' domain' + (found.domains.length === 1 ? '' : 's') + ' at ' + found.cutoff + ' Å' + (found.unassigned ? ' · ' + found.unassigned + ' residue' + (found.unassigned === 1 ? '' : 's') + ' unassigned' : '') + ' · heuristic segmentation of the PAE matrix, not a curated domain assignment'
      : 'No group of twenty or more residues stayed under ' + found.cutoff + ' Å' + (found.reason ? ' (' + found.reason + ')' : '') + '.';
    found.domains.forEach(domain => {
      const tr = document.createElement('tr');
      const name = document.createElement('th'); const swatch = document.createElement('i'); swatch.className = 'gpv-swatch'; swatch.style.background = domainColorFor(domain.id);
      name.append(swatch, 'Domain ' + domain.id); tr.append(name);
      const ranges = document.createElement('td'); ranges.textContent = domainRanges(domain); tr.append(ranges);
      const count = document.createElement('td'); count.className = 'text-end'; count.textContent = String(domain.tags.length); tr.append(count);
      const internal = document.createElement('td'); internal.className = 'text-end'; internal.textContent = domain.internal.toFixed(2); tr.append(internal);
      const action = document.createElement('td'); const highlight = document.createElement('button'); highlight.className = 'btn btn-ghost'; highlight.type = 'button'; highlight.textContent = 'Highlight';
      highlight.addEventListener('click', () => highlightDomains(entry, [domain]));
      action.append(highlight); tr.append(action); body.append(tr);
    });
  }

  function highlightDomains(entry, domains) {
    remember('domain highlight');
    domains.forEach(domain => {
      const byChain = new Map();
      domain.tags.forEach(tag => { const [chain, resi] = tag.split('|'); if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push(Number(resi)); });
      byChain.forEach((residues, chain) => selectionRecords.push({ id: nextAnnotationId++, entryId: entry.id, chain, residues: residues.sort((a, b) => a - b), action: 'highlight', color: domainColorFor(domain.id) }));
    });
    renderSelectionList(); applyStyle();
    updateStatus(domains.length + ' domain' + (domains.length === 1 ? '' : 's') + ' highlighted on ' + displayName(entry) + ' · manage them in Annotate → Selections');
  }

