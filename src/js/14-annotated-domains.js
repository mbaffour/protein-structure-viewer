  /* ---------- Annotated domains ---------- */

  let domainRecords = [];
  let domainVersion = 0;

  function domainApplies(record, entry) {
    if (record.scope === 'all') return true;
    const owner = entryById(record.entryId);
    if (!owner) return false;
    if (record.scope === 'model') return owner.id === entry.id;
    return owner.collection === entry.collection;
  }

  /* Per-entry lookup from chain|resi to the domain that claims it, rebuilt when the
     records change. Earlier records win where definitions overlap. */
  function domainLookup(entry) {
    if (entry.domainCache && entry.domainCache.version === domainVersion) return entry.domainCache.map;
    const map = new Map();
    domainRecords.filter(record => domainApplies(record, entry)).forEach(record => {
      const chains = record.chain ? [record.chain] : [...new Set(entry.atoms.map(atom => atom.chain || ''))];
      chains.forEach(chain => record.residues.forEach(resi => { const key = chain + '|' + resi; if (!map.has(key)) map.set(key, record); }));
    });
    entry.domainCache = { version: domainVersion, map };
    return map;
  }

  function annotatedColor(entry, atom) {
    const record = domainLookup(entry).get(residueTag(atom));
    return record ? record.color : '#9ca3af';
  }

  function domainRecordRanges(record) {
    return (record.chain ? record.chain + ':' : '') + compactRange(record.residues);
  }

  const scopeNames = { model: 'this model', source: 'same source', all: 'all models' };

  function addDomainRecord() {
    const entry = activeEntry(); if (!entry) return;
    const name = root.querySelector('#gpv-domain-name').value.trim();
    const residues = parseResidueRange(root.querySelector('#gpv-domain-range').value);
    if (!name) { updateStatus('Give the domain a name'); root.querySelector('#gpv-domain-name').focus(); return; }
    if (!residues.length) { updateStatus('Enter a residue range such as 1-75 or 1-75,120-140'); root.querySelector('#gpv-domain-range').focus(); return; }
    remember('domain');
    domainRecords.push({ id: nextAnnotationId++, entryId: entry.id, name, color: root.querySelector('#gpv-domain-colour').value, chain: root.querySelector('#gpv-domain-chain').value.trim(), residues, scope: root.querySelector('#gpv-domain-scope').value });
    domainVersion += 1;
    root.querySelector('#gpv-domain-name').value = ''; root.querySelector('#gpv-domain-range').value = '';
    root.querySelector('#gpv-domain-colour').value = domainColorFor(domainRecords.length + 1);
    renderDomainList(); applyStyle();
    updateStatus('Domain "' + name + '" added · applies to ' + scopeNames[root.querySelector('#gpv-domain-scope').value]);
  }

  function adoptPaeDomains() {
    const entry = activeEntry();
    if (!entry || !entry.domains || !entry.domains.domains.length) { updateStatus('Find PAE domains in the Confidence tab first'); return; }
    remember('adopting PAE domains');
    const scope = root.querySelector('#gpv-domain-scope').value;
    entry.domains.domains.forEach(domain => {
      const byChain = new Map();
      domain.tags.forEach(tag => { const [chain, resi] = tag.split('|'); if (!byChain.has(chain)) byChain.set(chain, []); byChain.get(chain).push(Number(resi)); });
      byChain.forEach((residues, chain) => domainRecords.push({ id: nextAnnotationId++, entryId: entry.id, name: 'Domain ' + domain.id, color: domainColorFor(domain.id), chain, residues: residues.sort((a, b) => a - b), scope }));
    });
    domainVersion += 1;
    renderDomainList(); applyStyle();
    updateStatus(entry.domains.domains.length + ' PAE domain' + (entry.domains.domains.length === 1 ? '' : 's') + ' adopted as named domains · rename or recolour them in the list');
  }

  function renderDomainList() {
    const list = root.querySelector('#gpv-domain-list'); list.replaceChildren();
    const active = activeEntry();
    root.querySelector('#gpv-add-domain').disabled = !active;
    root.querySelector('#gpv-domain-adopt').disabled = !(active && active.domains && active.domains.domains.length);
    root.querySelector('#gpv-domain-paint').disabled = !domainRecords.length;
    domainRecords.forEach(record => {
      const owner = entryById(record.entryId);
      const row = document.createElement('div'); row.className = 'gpv-entry';
      const copy = document.createElement('span'); copy.className = 'gpv-edit-copy';
      const name = document.createElement('input'); name.className = 'form-control'; name.type = 'text'; name.value = record.name; name.maxLength = 60; name.setAttribute('aria-label', 'Domain name');
      name.addEventListener('change', () => { const value = name.value.trim(); if (!value) { name.value = record.name; return; } remember('domain name'); record.name = value; domainVersion += 1; applyStyle(); updateStatus('Domain renamed'); });
      name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); name.blur(); } });
      const where = document.createElement('span'); where.className = 'gpv-entry-source text-small';
      where.textContent = domainRecordRanges(record) + ' · ' + (record.chain ? 'chain ' + record.chain : 'all chains') + ' · ' + scopeNames[record.scope] + (owner ? ' (' + displayName(owner) + (record.scope === 'source' && owner.collection ? ' · ' + owner.collection : '') + ')' : '');
      copy.append(name, where);
      const tools = document.createElement('span'); tools.className = 'gpv-edit-tools';
      const color = document.createElement('input'); color.className = 'form-control form-control-color'; color.type = 'color'; color.value = record.color; color.setAttribute('aria-label', 'Domain colour');
      color.addEventListener('input', () => { if (!color.dataset.remembered) { remember('domain colour'); color.dataset.remembered = '1'; } record.color = color.value; domainVersion += 1; applyStyle(); });
      color.addEventListener('change', () => { delete color.dataset.remembered; });
      const scope = document.createElement('select'); scope.className = 'form-select'; scope.setAttribute('aria-label', 'Where the domain applies');
      [['source', 'Same source'], ['model', 'This model'], ['all', 'All models']].forEach(([value, label]) => scope.append(new Option(label, value)));
      scope.value = record.scope;
      scope.addEventListener('change', () => { remember('domain scope'); record.scope = scope.value; domainVersion += 1; renderDomainList(); applyStyle(); });
      const remove = document.createElement('button'); remove.className = 'btn btn-ghost'; remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', () => { remember('domain removal'); domainRecords = domainRecords.filter(item => item !== record); domainVersion += 1; renderDomainList(); applyStyle(); updateStatus('Domain removed'); });
      tools.append(color, scope, remove);
      row.append(copy, tools); list.append(row);
    });
  }

