/* Validation of the viewer's atom-pair distances and residue contacts against values somebody else
   measured on deposited crystal structures — no reference computed by this project.

   node validate-experimental.mjs        (or: npm run validate:experimental)

   1. PDBePISA (Krissinel & Henrick 2007) lists the hydrogen bonds and salt bridges across the
      asymmetric-unit interfaces of 2HHB (human deoxyhaemoglobin) and 1BRS (barnase–barstar), each with
      the two atoms and their distance (fixtures/experimental/pisa-*.json). For every one of them the
      viewer's distance between the same two atoms (__viewerDebug.atomPairDistance — the first
      alternate location where an atom has several) must equal PISA's within 10⁻³ Å, and the residue
      card's contacts list of the first residue at 4.5 Å (__viewerDebug.residueContacts — the
      proximity rule the card, Highlight nearby residues and the count on the card share) must name
      the second residue with a closest heavy-atom distance no longer than PISA's: every bond is under
      4 Å, so every bonded pair is a contact.
   2. The catalytic triad of α-chymotrypsin (5CHA): the His57 NE2 – Ser195 OG and Asp102 OD1 – His57
      ND1 distances published from that entry (fixtures/experimental/published-distances.json) must be
      the viewer's to within 0.01 Å (the published values have two decimals), and the contacts list of
      the first residue must give exactly that atom pair as the closest pair of the two residues.

   Offline: the viewer is served with the libraries in vendor/ exactly as run.mjs serves it (run
   `npm test`, or `node vendor.mjs`, once). Prints a table and exits non-zero on any failure or console
   error. The fixtures are the wwPDB and PDBePISA files as downloaded (fixtures/experimental/README.md)
   and are never modified. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'experimental');
if (!existsSync(join(here, 'vendor', '3Dmol-min.js'))) { console.error('vendor/ is missing: run `npm test` or `node vendor.mjs` in tests/ once'); process.exit(2); }

/* ---------- the viewer, served with vendor/ as the suite serves it ---------- */
const work = await mkdtemp(join(tmpdir(), 'psv-experimental-'));
const source = await readFile(join(here, '..', 'index.html'), 'utf8');
const local = source.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g, (_, file) => `<script src="vendor/${file}"></script>`);
if (local === source) throw new Error('no CDN script tags were rewritten — check index.html');
await writeFile(join(work, 'index.html'), local);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const roots = [work, here];
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (name.includes('..')) { response.writeHead(400).end(); return; }
  const file = roots.map(root => resolve(root, name)).find(candidate => existsSync(candidate));
  if (!file) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PSV_CHROMIUM ? { executablePath: process.env.PSV_CHROMIUM } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/favicon|404/.test(message.text())) errors.push(message.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=1`); await page.waitForTimeout(1500);

const structureFiles = ['2hhb.cif', '1brs.cif', '5cha.cif'];
await page.setInputFiles('#gpv-files', structureFiles.map(name => join(fixtures, name)));
for (let i = 0; i < 240; i += 1) {
  await page.waitForTimeout(500);
  if ((await page.locator('#gpv-list .gpv-entry').count()) >= structureFiles.length && await page.locator('#gpv-import-state').isHidden()) break;
}
const entryIds = await page.evaluate(names => {
  const all = window.__viewerDebug.entries();
  return Object.fromEntries(names.map(name => { const stem = name.replace(/\.cif$/, ''); const entry = all.find(item => new RegExp(stem, 'i').test(item.name)); return [stem.toUpperCase(), entry ? entry.id : null]; }));
}, structureFiles);

const rows = []; let failed = 0;
const record = (structure, what, viewer, reference, delta, ok, note = '') => { rows.push({ structure, what, viewer, reference, delta, ok, note }); if (!ok) failed += 1; };
const missingEntry = Object.entries(entryIds).filter(([, id]) => id === null).map(([name]) => name);
if (missingEntry.length) { missingEntry.forEach(name => record(name, 'structure loaded', NaN, NaN, NaN, false, 'not loaded')); }

/* For a list of atom pairs on one model: the viewer's distance between the two named atoms, and the
   contacts list of the first residue at `cutoff`, looked up once per residue. */
const measurePairs = (id, pairs, cutoff) => page.evaluate(([id, pairs, cutoff]) => {
  const d = window.__viewerDebug; const lists = new Map();
  const contactsOf = (chain, resi) => { const key = chain + '|' + resi; if (!lists.has(key)) lists.set(key, d.residueContacts(id, chain, resi, cutoff)); return lists.get(key); };
  return pairs.map(pair => {
    const list = contactsOf(pair.chain_1, pair.resi_1);
    const row = list ? list.find(item => item.chain === pair.chain_2 && item.resi === pair.resi_2) : null;
    return { distance: d.atomPairDistance(id, pair.chain_1, pair.resi_1, pair.atom_1, pair.chain_2, pair.resi_2, pair.atom_2), listed: list !== null, row: row || null };
  });
}, [id, pairs, cutoff]);

/* ---------- 1. PDBePISA hydrogen bonds and salt bridges ---------- */
const pisaDetails = [];
for (const file of ['pisa-2hhb.json', 'pisa-1brs.json']) {
  const pisa = JSON.parse(await readFile(join(fixtures, file), 'utf8'));
  const id = entryIds[pisa.pdb];
  if (!id) continue;
  const seen = await measurePairs(id, pisa.bonds, 4.5);
  let worst = 0; let wrong = 0; let missing = 0; let notContact = 0;
  pisa.bonds.forEach((bond, index) => {
    const got = seen[index];
    const name = bond.resn_1 + bond.resi_1 + ' ' + bond.chain_1 + ':' + bond.atom_1 + ' – ' + bond.resn_2 + bond.resi_2 + ' ' + bond.chain_2 + ':' + bond.atom_2 + ' (' + bond.kind + ')';
    if (!Number.isFinite(got.distance)) { missing += 1; pisaDetails.push(pisa.pdb + ' ' + name + ': an atom was not found'); return; }
    const delta = Math.abs(got.distance - bond.dist); worst = Math.max(worst, delta);
    if (delta > 1e-3) { wrong += 1; pisaDetails.push(pisa.pdb + ' ' + name + ': viewer ' + got.distance.toFixed(4) + ' Å, PISA ' + bond.dist + ' Å'); }
    /* PISA's distance differs from the coordinates' by up to 10⁻³ Å (above), so the closest pair may
       read that much longer than PISA's figure for the same two atoms. */
    if (!got.row || !(got.row.closest <= bond.dist + 1e-3)) { notContact += 1; pisaDetails.push(pisa.pdb + ' ' + name + ': ' + (got.row ? 'listed with closest ' + got.row.closest.toFixed(4) + ' Å, longer than the bond' : 'not in the contacts list of the first residue')); }
  });
  const kinds = pisa.bonds.reduce((count, bond) => ({ ...count, [bond.kind]: (count[bond.kind] || 0) + 1 }), {});
  const what = Object.entries(kinds).map(([kind, count]) => count + ' ' + kind).join(' + ');
  record(pisa.pdb, 'PISA ' + what + ' · atom-pair distance, largest difference (Å)', worst, 0, worst, wrong === 0 && missing === 0, wrong || missing ? wrong + ' beyond 10⁻³ Å, ' + missing + ' atoms not found' : 'all ' + pisa.bonds.length + ' within 10⁻³ Å');
  record(pisa.pdb, 'PISA ' + what + ' · bonded residue pairs listed as contacts at 4.5 Å', pisa.bonds.length - notContact - missing, pisa.bonds.length, notContact === 0 && missing === 0 ? 0 : NaN, notContact === 0 && missing === 0, notContact ? notContact + ' missing or listed longer than the bond' : 'closest atoms never longer than the bond');
}

/* ---------- 2. published catalytic-triad distances ---------- */
const published = JSON.parse(await readFile(join(fixtures, 'published-distances.json'), 'utf8'));
for (const item of published.entries) {
  const id = entryIds[item.pdb];
  if (!id) continue;
  const seen = await measurePairs(id, item.distances, 4.5);
  item.distances.forEach((pair, index) => {
    const got = seen[index];
    const name = pair.resn_1 + pair.resi_1 + ' ' + pair.chain_1 + ':' + pair.atom_1 + ' – ' + pair.resn_2 + pair.resi_2 + ' ' + pair.chain_2 + ':' + pair.atom_2;
    const delta = Number.isFinite(got.distance) ? Math.abs(got.distance - pair.published) : NaN;
    record(item.pdb, name + ' (Å)', got.distance, pair.published, delta, delta <= 0.01, 'published to two decimals');
    const row = got.row;
    const samePair = Boolean(row && row.atomA === pair.atom_1 && row.atomB === pair.atom_2);
    const listed = row ? row.atomA + '–' + row.atomB + ' ' + row.closest.toFixed(3) + ' Å' : 'not listed';
    record(item.pdb, 'contacts of ' + pair.resn_1 + pair.resi_1 + ' · ' + pair.chain_1 + ': closest pair to ' + pair.resn_2 + pair.resi_2 + ' · ' + pair.chain_2, samePair ? 1 : 0, 1, samePair ? 0 : NaN, samePair, listed);
  });
}

/* ---------- the table ---------- */
const format = value => Number.isInteger(value) ? String(value) : Number.isFinite(value) ? value.toFixed(4) : '—';
console.log('\n| structure | quantity | viewer | reference | abs. difference | | note |\n|---|---|---:|---:|---:|:--:|---|');
rows.forEach(row => console.log('| ' + row.structure + ' | ' + row.what + ' | ' + format(row.viewer) + ' | ' + format(row.reference) + ' | ' + (Number.isFinite(row.delta) ? row.delta.toExponential(1) : '—') + ' | ' + (row.ok ? '✓' : '✗') + ' | ' + row.note + ' |'));
if (pisaDetails.length) { console.log('\nbonds that failed:'); pisaDetails.forEach(line => console.log('  ' + line)); }
console.log('\nconsole errors: ' + errors.length + (errors.length ? ' :: ' + errors[0].slice(0, 160) : ''));
console.log(failed ? 'FAILED ' + failed + ' check' + (failed === 1 ? '' : 's') : 'all ' + rows.length + ' checks pass');
await browser.close(); server.close();
process.exit(failed || errors.length ? 1 : 0);
