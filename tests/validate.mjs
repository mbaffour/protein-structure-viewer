/* Cross-validation of the viewer's numbers against an independent implementation.

   1. Unpack an AlphaFold 3 archive (models + confidence JSON) into a folder.
   2. python3 reference.py <folder> <chain> <cutoff>   → writes <folder>/reference.json with Biopython/numpy
   3. node validate.mjs <folder> [archive.zip]         → drives the real viewer on the same files and compares

   Compared: mean Cα pLDDT per model, Kabsch RMSD of every model onto model 0 (Cα paired by chain and
   residue id), per-residue Cα RMSF across the superposed models, radius of gyration and exact Cα extent,
   the residue set within <cutoff> Å of <chain>, the inter-chain contact map and the full Cα–Cα distance
   matrix of the same chain pair and of its first chain against itself, every residue's contacts on that
   first chain with their closest atom pairs and the distance from three of its residues to every residue
   (2.51.0), and the
   buried surface area of the chain interfaces (Shrake–Rupley, against Bio.PDB.SASA). Exits non-zero when any value disagrees beyond
   the tolerances below. Requires the suite's node_modules and vendor/ (run npm test once). */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const folder = resolve(process.argv[2] || '');
const archive = process.argv[3] ? resolve(process.argv[3]) : null;
if (!folder || !existsSync(join(folder, 'reference.json'))) { console.error('usage: node validate.mjs <folder with reference.json> [archive.zip]'); process.exit(2); }
const reference = JSON.parse(await readFile(join(folder, 'reference.json'), 'utf8'));
const tolerance = { plddt: 0.01, rmsd: 0.001, rmsf: 0.001, size: 0.001 };

const work = await mkdtemp(join(tmpdir(), 'psv-validate-'));
const source = await readFile(join(here, '..', 'index.html'), 'utf8');
const local = source.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g, (_, file) => `<script src="vendor/${file}"></script>`);
await writeFile(join(work, 'index.html'), local);
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const roots = [work, here];
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = roots.map(root => resolve(root, name)).find(candidate => existsSync(candidate));
  if (!file) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/favicon/.test(message.text())) errors.push(message.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=1`); await page.waitForTimeout(1500);

const inputs = archive ? [archive] : (await readdir(folder)).filter(name => /_model_\d+\.cif$|_full_data_\d+\.json$|_summary_confidences_\d+\.json$|unpaired.*\.a3m$/.test(name)).map(name => join(folder, name));
await page.setInputFiles('#gpv-files', inputs);
const expected = reference.models.length;
for (let i = 0; i < 600; i += 1) { await page.waitForTimeout(500); if ((await page.locator('#gpv-list .gpv-entry').count()) >= expected && await page.locator('#gpv-import-state').isHidden()) break; }

const rows = []; let failed = 0;
const check = (label, viewer, expectedValue, tol) => {
  const delta = Math.abs(viewer - expectedValue); const ok = delta <= tol; if (!ok) failed += 1;
  rows.push({ label, viewer, reference: expectedValue, delta, ok });
};
const modelIndex = name => Number((name.match(/_model_(\d+)/) || [])[1]);


/* dimensions on model 0 before any coordinates move */
const size = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name)); return d.assemblyDimensions(entry); });
check('Cα extent (Å)', size.extent, reference.extent_exact, tolerance.size);
check('radius of gyration (Å)', size.gyration, reference.rg_ca, tolerance.size);
if (!size.exact) console.log('  note: extent reported as a lower bound (over 6 000 residues)');

/* contacts within the cutoff of one chain, on model 0 */
await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(item => /_model_0\./.test(item.name)); document.querySelector('#gpv-list [data-entry-id="' + entry.id + '"]').click(); });
await page.waitForTimeout(800);
await page.click('[data-gpv-tab="annotate"]');
await page.selectOption('#gpv-near-target', 'chain'); await page.fill('#gpv-near-chain', reference.contacts.chain); await page.fill('#gpv-near-cutoff', String(reference.contacts.cutoff));
const near = await page.evaluate(() => { const result = window.__viewerDebug.nearbyResidues(); return result && result.residues ? { active: result.entry.name, residues: result.residues.map(item => [item.chain, item.resi, item.resn]) } : { error: result && result.error }; });
if (near.error) { rows.push({ label: 'contacts within ' + reference.contacts.cutoff + ' Å of chain ' + reference.contacts.chain, viewer: NaN, reference: reference.contacts.count, delta: NaN, ok: false }); failed += 1; }
else {
  const viewerSet = new Set(near.residues.map(item => item.join('|'))); const referenceSet = new Set(reference.contacts.residues.map(item => item.join('|')));
  const same = viewerSet.size === referenceSet.size && [...viewerSet].every(key => referenceSet.has(key));
  rows.push({ label: 'contacts within ' + reference.contacts.cutoff + ' Å of chain ' + reference.contacts.chain + ' (residue set)', viewer: viewerSet.size, reference: referenceSet.size, delta: same ? 0 : NaN, ok: same }); if (!same) failed += 1;
  if (!/_model_0\./.test(near.active)) console.log('  ! contacts measured on ' + near.active);
}

/* inter-chain contact map on model 0: the same residue pairs and closest distances as Biopython */
if (reference.contact_map) {
  const cm = reference.contact_map;
  await page.click('[data-gpv-tab="compare"]');
  await page.selectOption('#gpv-contact-a', cm.chains[0]); await page.selectOption('#gpv-contact-b', cm.chains[1]);
  await page.selectOption('#gpv-contact-atoms', 'heavy'); await page.fill('#gpv-contact-cutoff', String(cm.cutoff));
  await page.click('#gpv-contact-run'); await page.waitForTimeout(800);
  const map = await page.evaluate(() => { const c = window.__viewerDebug.contactResult(); if (!c) return null; return { pairs: [...c.pairs.entries()].map(([key, d]) => { const [i, j] = key.split('|').map(Number); return [c.rowA.residues[i].resi, c.rowB.residues[j].resi, d]; }), residuesA: c.residuesA.length, residuesB: c.residuesB.length }; });
  if (!map) { rows.push({ label: 'contact map ' + cm.chains.join('–'), viewer: NaN, reference: cm.pairs, delta: NaN, ok: false }); failed += 1; }
  else {
    const viewerPairs = new Map(map.pairs.map(([a, b, d]) => [a + '|' + b, d])); const referencePairs = new Map(cm.all_pairs.map(([a, b, d]) => [a + '|' + b, d]));
    const sameSet = viewerPairs.size === referencePairs.size && [...viewerPairs.keys()].every(key => referencePairs.has(key));
    rows.push({ label: 'contact map ' + cm.chains.join('–') + ' within ' + cm.cutoff + ' Å (pair set)', viewer: viewerPairs.size, reference: referencePairs.size, delta: sameSet ? 0 : NaN, ok: sameSet }); if (!sameSet) failed += 1;
    check('contact map · interface residues on ' + cm.chains[0], map.residuesA, cm.residues_a, 0);
    check('contact map · interface residues on ' + cm.chains[1], map.residuesB, cm.residues_b, 0);
    let worst = 0; referencePairs.forEach((d, key) => { if (viewerPairs.has(key)) worst = Math.max(worst, Math.abs(viewerPairs.get(key) - d)); });
    check('contact map · largest distance difference over ' + referencePairs.size + ' pairs (Å)', worst, 0, 0.001);
  }
}

/* distance map on model 0 (added 2.50.0): the viewer's Cα–Cα matrix for the contact-map chain pair and
   for the first chain against itself, cell by cell against numpy. Residues are matched by number along
   each axis; a residue on one side and not the other is counted and fails the axis check. */
if (reference.distance_map) {
  const dm = reference.distance_map;
  const compareMatrix = async (label, chainA, chainB, idsA, idsB, matrix) => {
    const viewerMatrix = await page.evaluate(([a, b]) => {
      const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name));
      const result = entry && d.distanceMatrix(entry.id, a, b);
      return result ? { a: result.a, b: result.b, ca: result.ca.map(row => Array.from(row)) } : null;
    }, [chainA, chainB]);
    if (!viewerMatrix) { rows.push({ label: label + ' (axes)', viewer: NaN, reference: idsA.length * idsB.length, delta: NaN, ok: false }); failed += 1; return; }
    const rowOf = new Map(viewerMatrix.a.map((resi, i) => [resi, i])); const columnOf = new Map(viewerMatrix.b.map((resi, j) => [resi, j]));
    const missing = idsA.filter(resi => !rowOf.has(resi)).length + idsB.filter(resi => !columnOf.has(resi)).length;
    const sameAxes = missing === 0 && viewerMatrix.a.length === idsA.length && viewerMatrix.b.length === idsB.length;
    rows.push({ label: label + ' · residues on the axes', viewer: viewerMatrix.a.length + viewerMatrix.b.length, reference: idsA.length + idsB.length, delta: sameAxes ? 0 : NaN, ok: sameAxes }); if (!sameAxes) failed += 1;
    let worst = 0; let cells = 0;
    idsA.forEach((resiA, i) => {
      const vi = rowOf.get(resiA); if (vi === undefined) return;
      idsB.forEach((resiB, j) => { const vj = columnOf.get(resiB); if (vj === undefined) return; worst = Math.max(worst, Math.abs(viewerMatrix.ca[vi][vj] - matrix[i][j])); cells += 1; });
    });
    check(label + ' · largest Cα–Cα difference over ' + cells + ' cells (Å)', worst, 0, 0.001);
  };
  await compareMatrix('distance map ' + dm.chains.join('–'), dm.chains[0], dm.chains[1], dm.residues_a, dm.residues_b, dm.ca);
  await compareMatrix('distance map ' + dm.intra.chain + '–' + dm.intra.chain + ' (intra-chain)', dm.intra.chain, dm.intra.chain, dm.intra.residues, dm.intra.residues, dm.intra.ca);
}

/* residue contacts and distance from a residue on model 0 (added 2.51.0): for every residue of the
   contact-map chain, the residue card's contacts list (__viewerDebug.residueContacts — the proximity
   rule for one residue, with the closest heavy-atom pair and the Cα–Cα distance of each contact)
   against Biopython's; and for the first three residues, the closest heavy-atom distance to every
   residue of the model (__viewerDebug.residueDistances — what Colour by distance from the selected
   residue bands). The neighbour sets must be identical; a closest atom pair may differ from the
   reference's only when the two pairs are equally far apart (a tie broken differently), which is
   checked by measuring the reference's pair in the viewer. */
if (reference.residue_contacts) {
  const rc = reference.residue_contacts;
  const viewerContacts = await page.evaluate(([chain, cutoff, contactResidues, distanceResidues]) => {
    const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name));
    if (!entry) return null;
    return { id: entry.id, contacts: contactResidues.map(resi => d.residueContacts(entry.id, chain, resi, cutoff)), distances: distanceResidues.map(resi => d.residueDistances(entry.id, chain, resi)) };
  }, [rc.chain, rc.cutoff, rc.residues.map(item => item.resi), rc.distances.map(item => item.resi)]);
  const label = 'residue contacts of chain ' + rc.chain + ' within ' + rc.cutoff + ' Å';
  if (!viewerContacts) { rows.push({ label, viewer: NaN, reference: rc.residues.length, delta: NaN, ok: false }); failed += 1; }
  else {
    let setDiffers = 0; let compared = 0; let worstClosest = 0; let worstCa = 0; const pairDiffers = [];
    let bondedViewer = 0; let bondedReference = 0; let bondDiffers = 0;
    rc.residues.forEach((item, index) => {
      const seen = viewerContacts.contacts[index];
      if (!seen) { setDiffers += 1; return; }
      const byKey = new Map(seen.map(row => [row.chain + '|' + row.resi, row]));
      const expected = new Map(item.contacts.map(row => [row[0] + '|' + row[1], row]));
      if (byKey.size !== expected.size || [...expected.keys()].some(key => !byKey.has(key))) setDiffers += 1;
      expected.forEach(([chain, resi, resn, closest, atomA, atomB, ca, bond], key) => {
        const row = byKey.get(key); if (!row) return;
        compared += 1;
        worstClosest = Math.max(worstClosest, Math.abs(row.closest - closest));
        worstCa = Math.max(worstCa, Math.abs(row.ca - ca));
        if (row.atomA !== atomA || row.atomB !== atomB) pairDiffers.push({ resi: item.resi, chain, other: resi, atomA, atomB, closest: row.closest });
        if (row.bond) bondedViewer += 1; if (bond) bondedReference += 1;
        if ((row.bond || '') !== (bond || '')) bondDiffers += 1;
      });
    });
    /* a different pair is a tie only if the reference's own pair is as close, measured in the viewer */
    const ties = await page.evaluate(([id, chain, pairs]) => pairs.map(pair => window.__viewerDebug.atomPairDistance(id, chain, pair.resi, pair.atomA, pair.chain, pair.other, pair.atomB)), [viewerContacts.id, rc.chain, pairDiffers]);
    const notTies = pairDiffers.filter((pair, index) => !(Number.isFinite(ties[index]) && Math.abs(ties[index] - pair.closest) <= 5e-5)).length;
    check(label + ' · residues whose neighbour set differs (of ' + rc.residues.length + ')', setDiffers, 0, 0);
    check(label + ' · largest closest heavy-atom difference over ' + compared + ' contacts (Å)', worstClosest, 0, 5e-5);
    check(label + ' · largest Cα–Cα difference over ' + compared + ' contacts (Å)', worstCa, 0, 1e-3);
    check(label + ' · closest atom pairs that differ, ties excepted (' + (pairDiffers.length - notTies) + ' ties)', notTies, 0, 0);
    /* the peptide-bond / disulfide flag: the same count on both sides, and no contact flagged differently */
    const bondsAgree = bondDiffers === 0 && bondedViewer === bondedReference;
    rows.push({ label: label + ' · bonded contacts (viewer / reference)', viewer: bondedViewer, reference: bondedReference, delta: bondDiffers, ok: bondsAgree }); if (!bondsAgree) failed += 1;
    rc.distances.forEach((item, index) => {
      const seen = viewerContacts.distances[index];
      const name = item.resn + item.resi + ' · ' + item.chain;
      if (!seen) { rows.push({ label: 'distance from ' + name + ' to every residue', viewer: NaN, reference: item.rows.length, delta: NaN, ok: false }); failed += 1; return; }
      const byKey = new Map(seen.map(row => [row.chain + '|' + row.resi, row.heavy]));
      let missing = 0; let worst = 0;
      item.rows.forEach(([chain, resi, , value]) => { const got = byKey.get(chain + '|' + resi); if (got === undefined || got === null) missing += 1; else worst = Math.max(worst, Math.abs(got - value)); });
      const sameSet = missing === 0 && byKey.size === item.rows.length;
      rows.push({ label: 'distance from ' + name + ' · residues coloured (viewer / reference)', viewer: byKey.size, reference: item.rows.length, delta: sameSet ? 0 : NaN, ok: sameSet }); if (!sameSet) failed += 1;
      check('distance from ' + name + ' · largest closest heavy-atom difference over ' + (item.rows.length - missing) + ' residues (Å)', worst, 0, 5e-5);
    });
  }
}

/* buried surface area of the chain interfaces on model 0 (Confidence tab → Interfaces).
   Shrake–Rupley is a sampling method: the viewer's 92 golden-spiral points and Biopython's 92 points
   are different quasi-uniform sets, so the two agree only to the sampling error of the point count.
   Raising both to 960 points makes them agree to 0.2 %, so the two differ only in sampling, not in
   definition. At 92 points the spread measured over these runs is up to 1.2 % on a per-chain SASA
   (worst for a 250-atom chain; 0.06 % for a 3 000-atom one) and up to 2.7 % on a BSA, which is a
   difference of three large numbers in which only the interface atoms survive the cancellation.
   Hence 2 % on SASA and 5 % on BSA: comfortably above the sampling spread, far below what a
   disagreement in definition would produce. */
if (reference.bsa && Number.isFinite(reference.bsa.bsa)) {
  const bs = reference.bsa; const relBsa = 0.05; const relSasa = 0.02;
  await page.click('[data-gpv-tab="confidence"]');
  await page.evaluate(cut => {
    const entry = window.__viewerDebug.entries().find(item => /_model_0\./.test(item.name));
    const select = document.querySelector('#gpv-interface-model'); select.value = String(entry.id); select.dispatchEvent(new Event('change', { bubbles: true }));
    const slider = document.querySelector('#gpv-interface-cutoff'); slider.value = String(cut); slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, bs.cutoff);
  await page.click('#gpv-interface-run');
  let interfaces = null;
  for (let i = 0; i < 600; i += 1) {
    await page.waitForTimeout(500);
    interfaces = await page.evaluate(() => { const r = window.__viewerDebug.interfaceResults(); return r ? { cutoff: r.cutoff, rows: r.rows.map(row => ({ chains: row.chains, contacts: row.contacts, bsa: row.bsa })) } : null; });
    if (interfaces) break;
  }
  if (!interfaces) { rows.push({ label: 'buried surface area ' + bs.chains.join('–'), viewer: NaN, reference: bs.bsa, delta: NaN, ok: false }); failed += 1; }
  else {
    const key = pair => pair.slice().sort().join('|');
    check('interface chain pairs in contact at ' + bs.cutoff + ' Å', interfaces.rows.length, bs.pairs, 0);
    const viewerRow = interfaces.rows.find(row => key(row.chains) === key(bs.chains));
    if (!viewerRow) { rows.push({ label: 'buried surface area ' + bs.chains.join('–'), viewer: NaN, reference: bs.bsa, delta: NaN, ok: false }); failed += 1; }
    else check('buried surface area ' + bs.chains.join('–') + ' (Å², ' + (relBsa * 100) + ' % band)', viewerRow.bsa, bs.bsa, bs.bsa * relBsa);
    const total = interfaces.rows.reduce((sum, row) => sum + (Number.isFinite(row.bsa) ? row.bsa : NaN), 0);
    check('total buried surface area over ' + bs.pairs + ' pairs (Å²)', total, bs.total_bsa, bs.total_bsa * relBsa);
  }
  /* the same Shrake–Rupley helper the BSA subtraction is built from, chain by chain */
  const sasa = await page.evaluate(chains => {
    const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name));
    const heavy = d.heavyAtoms(entry); const pick = list => heavy.filter(atom => list.includes(atom.chain || ''));
    return { a: d.solventAccessibleArea(pick([chains[0]])), b: d.solventAccessibleArea(pick([chains[1]])), ab: d.solventAccessibleArea(pick(chains)) };
  }, bs.chains);
  check('SASA of chain ' + bs.chains[0] + ' alone (Å², 2 % band)', sasa.a, bs.sasa_a, bs.sasa_a * relSasa);
  check('SASA of chain ' + bs.chains[1] + ' alone (Å², 2 % band)', sasa.b, bs.sasa_b, bs.sasa_b * relSasa);
  check('SASA of ' + bs.chains.join('+') + ' together (Å², 2 % band)', sasa.ab, bs.sasa_ab, bs.sasa_ab * relSasa);
}

/* ligand sites: report whether this run carries any ligand or ion at all. Ligand–site PAE cannot be
   cross-validated on a run without ligands, and no synthetic structure is substituted for one. */
const ligands = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name)); return d.ligandGroups(entry).map(group => group.resn + ' ' + group.chain + ':' + group.resi); });
console.log('ligand or ion groups on model 0: ' + (ligands.length ? ligands.join(', ') : 'none — ligand–site PAE not exercised by this run'));

/* MSA statistics: the viewer's per-residue values against the reference per-column values, for every
   alignment, on the first chain whose sequence contains the query */
for (const msa of (reference.msa || [])) {
  await page.click('[data-gpv-tab="confidence"]');
  for (const metric of ['conservation', 'conservation_unweighted', 'identity', 'depth']) {
    await page.selectOption('#gpv-msa-metric', metric === 'conservation_unweighted' ? 'conservation' : metric);
    await page.setChecked('#gpv-msa-weights', metric !== 'conservation_unweighted');
    if (await page.locator('#gpv-msa-paint').isDisabled()) { rows.push({ label: 'MSA ' + metric + ' (' + msa.file.slice(-24) + ')', viewer: NaN, reference: msa.query.length, delta: NaN, ok: false }); failed += 1; continue; }
    await page.click('#gpv-msa-paint'); await page.waitForTimeout(600);
    const viewerValues = await page.evaluate(query => {
      const d = window.__viewerDebug; const data = d.residueData(); const entry = d.activeEntry(); if (!data || !entry) return null;
      const rowsOf = window.__viewerDebug.residueRows ? window.__viewerDebug.residueRows(entry) : null;
      const chains = [...new Set([...data.values.keys()].map(key => key.split('|')[0]))];
      /* pick the chain whose residue letters contain the query, using the model's atoms */
      const letter = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V' };
      for (const chain of chains) {
        const cas = entry.atoms.filter(atom => (atom.chain || '') === chain && atom.atom === 'CA' && !atom.hetflag).sort((a, b) => a.resi - b.resi);
        const seq = cas.map(atom => letter[String(atom.resn || '').toUpperCase()] || 'X').join('');
        const offset = seq.indexOf(query); if (offset < 0) continue;
        return { chain, values: cas.slice(offset, offset + query.length).map(atom => data.values.get(chain + '|' + atom.resi)) };
      }
      return null;
    }, msa.query);
    if (!viewerValues) { rows.push({ label: 'MSA ' + metric + ' (' + msa.file.slice(-24) + ')', viewer: NaN, reference: msa.query.length, delta: NaN, ok: false }); failed += 1; continue; }
    const referenceValues = msa[metric];
    let worst = 0; let missing = 0;
    referenceValues.forEach((value, i) => { const seen = viewerValues.values[i]; if (seen === undefined) missing += 1; else worst = Math.max(worst, Math.abs(seen - value)); });
    check('MSA ' + metric.replace('conservation_unweighted', 'conservation (unweighted)').replace(/^conservation$/, 'conservation (Henikoff-weighted)') + ' · ' + referenceValues.length + ' columns on chain ' + viewerValues.chain + ' · largest difference', missing ? NaN : worst, 0, metric === 'depth' ? 0 : 1e-5);
  }
  await page.setChecked('#gpv-msa-weights', true);
}

/* Kabsch superposition of every model onto model 0 and per-residue RMSF */
await page.click('[data-gpv-tab="compare"]');
await page.selectOption('#gpv-alignment-mode', 'identifier');
await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(item => /_model_0\./.test(item.name)); const select = document.querySelector('#gpv-reference'); select.value = String(entry.id); select.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#gpv-align');
for (let i = 0; i < 120; i += 1) { await page.waitForTimeout(500); if ((await page.evaluate(() => window.__viewerDebug.alignmentResults().length)) >= expected - 1) break; }
const alignment = await page.evaluate(() => window.__viewerDebug.alignmentResults().map(result => ({ name: result.name, count: result.count, rmsd: result.rmsd })));
alignment.forEach(result => { const index = modelIndex(result.name); const item = reference.rmsd.find(entry => entry.model === index); if (!item) return; check('Cα pairs · model ' + index, result.count, item.pairs, 0); check('RMSD onto model 0 (Å) · model ' + index, result.rmsd, item.rmsd, tolerance.rmsd); });
const spread = await page.evaluate(() => { const s = window.__viewerDebug.ensembleSpread(); if (!s) return null; const values = [...s.values.values()]; const sample = {}; Object.keys(window.__viewerDebug.entries()[0] ? {} : {}); return { count: values.length, max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, entries: [...s.values.entries()] }; });
if (spread) {
  check('RMSF residues', spread.count, reference.rmsf.count, 0);
  check('RMSF maximum (Å)', spread.max, reference.rmsf.max, tolerance.rmsf);
  check('RMSF mean (Å)', spread.mean, reference.rmsf.mean, tolerance.rmsf);
  const lookup = new Map(spread.entries);
  Object.entries(reference.rmsf.sample).forEach(([tag, value]) => check('RMSF ' + tag.replace('|', ':') + ' (Å)', lookup.get(tag), value, tolerance.rmsf));
} else { rows.push({ label: 'RMSF', viewer: NaN, reference: reference.rmsf.count, delta: NaN, ok: false }); failed += 1; }

/* mean Cα pLDDT per model — after alignment, which parses every model of an archive (they load lazily) */
const plddt = await page.evaluate(() => window.__viewerDebug.entries().map(entry => ({ name: entry.name, mean: entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length, atoms: entry.atoms ? entry.atoms.length : 0, pae: entry.confidence && entry.confidence.pae ? entry.confidence.pae.length : 0 })));
plddt.forEach(item => { const index = modelIndex(item.name); if (Number.isFinite(index) && reference.plddt_mean_ca[index] !== undefined) check('mean Cα pLDDT · model ' + index, item.mean, reference.plddt_mean_ca[index], tolerance.plddt); });
console.log('PAE matrices attached: ' + plddt.map(item => item.pae).join(', '));

/* domains: only that the heuristic runs on real PAE without error */
const domains = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(item => /_model_0\./.test(item.name)); const found = d.paeDomains(entry, 6); return found ? { domains: found.domains.length, unassigned: found.unassigned } : null; });
console.log('PAE domains at 6 Å on model 0: ' + (domains ? domains.domains + ' domains, ' + domains.unassigned + ' residues unassigned' : 'no PAE'));

const format = value => Number.isInteger(value) ? String(value) : Number.isFinite(value) ? value.toFixed(4) : String(value);
console.log('\n' + basename(folder) + ' · ' + expected + ' models · ' + plddt[0].atoms + ' atoms per model\n');
console.log('| quantity | viewer | reference | abs. difference | |\n|---|---:|---:|---:|:--:|');
rows.forEach(row => console.log('| ' + row.label + ' | ' + format(row.viewer) + ' | ' + format(row.reference) + ' | ' + (Number.isFinite(row.delta) ? row.delta.toExponential(1) : 'set differs') + ' | ' + (row.ok ? '✓' : '✗') + ' |'));
console.log('\nconsole errors: ' + errors.length + (errors.length ? ' :: ' + errors[0].slice(0, 160) : ''));
console.log(failed ? 'FAILED ' + failed + ' comparison' + (failed === 1 ? '' : 's') : 'all ' + rows.length + ' comparisons within tolerance');
await writeFile(join(folder, 'validation.json'), JSON.stringify({ run: basename(folder), models: expected, atoms: plddt[0].atoms, rows, domains, ligands, errors }, null, 1));
await browser.close(); server.close();
process.exit(failed || errors.length ? 1 : 0);
