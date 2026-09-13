/* Cross-validation of the viewer's numbers against an independent implementation.

   1. Unpack an AlphaFold 3 archive (models + confidence JSON) into a folder.
   2. python3 reference.py <folder> <chain> <cutoff>   → writes <folder>/reference.json with Biopython/numpy
   3. node validate.mjs <folder> [archive.zip]         → drives the real viewer on the same files and compares

   Compared: mean Cα pLDDT per model, Kabsch RMSD of every model onto model 0 (Cα paired by chain and
   residue id), per-residue Cα RMSF across the superposed models, radius of gyration and exact Cα extent,
   and the residue set within <cutoff> Å of <chain>. Exits non-zero when any value disagrees beyond
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

const inputs = archive ? [archive] : (await readdir(folder)).filter(name => /_model_\d+\.cif$|_full_data_\d+\.json$|_summary_confidences_\d+\.json$/.test(name)).map(name => join(folder, name));
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
await writeFile(join(folder, 'validation.json'), JSON.stringify({ run: basename(folder), models: expected, atoms: plddt[0].atoms, rows, domains, errors }, null, 1));
await browser.close(); server.close();
process.exit(failed || errors.length ? 1 : 0);
