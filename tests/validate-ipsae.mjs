/* Cross-validation of the viewer's interaction scores against the reference implementation.

   node validate-ipsae.mjs <path to ipsae.py> <input> [more inputs…]

   An input is an AlphaFold 3 server archive (.zip) or a folder of loose files from AlphaFold 3
   (fold_<job>_model_N.cif + _full_data_N.json, or local <job>_model.cif + _confidences.json),
   ColabFold (*_unrelaxed_rank_NNN_*.pdb + *_scores_rank_NNN_*.json) or Boltz (<name>_model_N.cif +
   pae_<name>_model_N.npz) — the formats ipsae.py reads. For every model, DunbrackLab/IPSAE ipsae.py
   is run at PAE/distance cutoffs 10/10 and 15/15, and the viewer — driven headless on the same
   files — scores the same model at the same cutoffs. Every chain pair is compared in both
   directions and on the combined row: ipSAE, ipSAE_d0chn, ipSAE_d0dom, ipTM_d0chn, pDockQ, pDockQ2,
   LIS, the reported ipTM, and the residue counts n0res, n0chn, n0dom, nres1, nres2, dist1, dist2.
   The reference prints ipSAE-family values to 6 decimals and pDockQ, pDockQ2, LIS to 4, so the
   tolerances are half a unit in the last printed place — for the ipSAE family plus 1e-7, because the
   viewer keeps PAE as float32 and ipsae.py as float64: a true 0.413344501 prints 0.413345 there and
   is 0.413344481 here (seen on 4 of 186 750 values); counts must match exactly. Exits non-zero
   on any disagreement. The script needs python3 with numpy, `unzip`, and the suite's node_modules
   and vendor/ (run npm test once). The archives are the user's own and are never copied into the
   repository. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [ipsaeArg, ...archiveArgs] = process.argv.slice(2);
if (!ipsaeArg || !archiveArgs.length) { console.error('usage: node validate-ipsae.mjs <ipsae.py> <archive.zip>…'); process.exit(2); }
const ipsae = resolve(ipsaeArg);
const archives = archiveArgs.map(path => resolve(path));
const isFolder = input => statSync(input).isDirectory();
/* Which structure goes with which PAE file, in the naming each tool writes. */
function pairUp(names) {
  const pairs = [];
  names.forEach(name => {
    let match;
    if ((match = name.match(/^(.*)_model_(\d+)\.cif$/)) && names.includes(match[1] + '_full_data_' + match[2] + '.json')) pairs.push({ structure: name, pae: match[1] + '_full_data_' + match[2] + '.json', index: Number(match[2]) });
    else if ((match = name.match(/^(.*)_model\.cif$/)) && names.includes(match[1] + '_confidences.json')) pairs.push({ structure: name, pae: match[1] + '_confidences.json', index: 0 });
    else if ((match = name.match(/^(.*)_unrelaxed_(rank_(\d+)_.*)\.pdb$/)) && names.includes(match[1] + '_scores_' + match[2] + '.json')) pairs.push({ structure: name, pae: match[1] + '_scores_' + match[2] + '.json', index: Number(match[3]) });
    else if ((match = name.match(/^(.*_model_(\d+))\.cif$/)) && names.includes('pae_' + match[1] + '.npz')) pairs.push({ structure: name, pae: 'pae_' + match[1] + '.npz', index: Number(match[2]) });
  });
  return pairs;
}
const cutoffs = [[10, 10], [15, 15]];
const fields = ['chain1', 'chain2', 'pae', 'dist', 'type', 'ipSAE', 'ipSAE_d0chn', 'ipSAE_d0dom', 'ipTM_af', 'ipTM_d0chn', 'pDockQ', 'pDockQ2', 'LIS', 'n0res', 'n0chn', 'n0dom', 'd0res', 'd0chn', 'd0dom', 'nres1', 'nres2', 'dist1', 'dist2'];
/* reference column -> [viewer key, tolerance]; tolerance 0 means an exact match */
const compared = {
  ipSAE: ['ipsae', 6e-7], ipSAE_d0chn: ['ipsaeD0chn', 6e-7], ipSAE_d0dom: ['ipsaeD0dom', 6e-7], ipTM_d0chn: ['iptmD0chn', 6e-7],
  pDockQ: ['pdockq', 5.1e-5], pDockQ2: ['pdockq2', 5.1e-5], LIS: ['lis', 5.1e-5], ipTM_af: ['iptmModel', 5.1e-4],
  n0res: ['n0res', 0], n0chn: ['n0chn', 0], n0dom: ['n0dom', 0], nres1: ['nres1', 0], nres2: ['nres2', 0], dist1: ['dist1', 0], dist2: ['dist2', 0]
};

const run = promisify(execFile);
async function runReference(folder, model, confidence, pae, dist) {
  const stem = model.replace(/\.(cif|pdb)$/, '');
  await run('python3', [ipsae, confidence, model, String(pae), String(dist)], { cwd: folder, maxBuffer: 64 * 1024 * 1024 });
  return readFile(join(folder, `${stem}_${String(pae).padStart(2, '0')}_${String(dist).padStart(2, '0')}.txt`), 'utf8').then(text => text.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts.length >= 24 && parts[0] !== 'Chn1').map(parts => {
    const row = Object.fromEntries(fields.map((field, index) => [field, parts[index]]));
    fields.slice(5).forEach(field => { row[field] = Number(row[field]); });
    return row;
  }));
}

/* ---------- the reference, on every model, a few at a time ---------- */
const expected = new Map(); /* input -> structure file name -> "pae_dist" -> rows */
const jobs = [];
for (const archive of archives) {
  const folder = await mkdtemp(join(tmpdir(), 'psv-ipsae-'));
  if (isFolder(archive)) { for (const name of await readdir(archive)) if (statSync(join(archive, name)).isFile()) await copyFile(join(archive, name), join(folder, name)); }
  else execFileSync('unzip', ['-q', '-j', archive, '*_model_*.cif', '*_full_data_*.json', '*_summary_confidences_*.json', '-d', folder]);
  const perModel = new Map(); expected.set(archive, perModel);
  for (const pair of pairUp((await readdir(folder)).sort())) {
    perModel.set(pair.structure, {});
    cutoffs.forEach(([pae, dist]) => jobs.push(async () => { perModel.get(pair.structure)[pae + '_' + dist] = await runReference(folder, pair.structure, pair.pae, pae, dist); process.stdout.write('.'); }));
  }
}
/* IPSAE_CACHE=<file> keeps the reference results, which are the slow half, between runs;
   IPSAE_REFERENCE_ONLY=1 stops after computing them. */
const cache = process.env.IPSAE_CACHE ? resolve(process.env.IPSAE_CACHE) : null;
const ipsaeSha = createHash('sha256').update(await readFile(ipsae)).digest('hex');
const cached = cache && existsSync(cache) ? JSON.parse(await readFile(cache, 'utf8')) : null;
if (cached && cached.sha256 === ipsaeSha && archives.every(archive => cached.archives[archive])) {
  archives.forEach(archive => expected.set(archive, new Map(Object.entries(cached.archives[archive]))));
  console.log('reference results read from ' + cache);
} else {
  const parallel = Number(process.env.IPSAE_JOBS) || 4;
  await Promise.all(Array.from({ length: parallel }, async () => { while (jobs.length) await jobs.shift()(); }));
  process.stdout.write('\n');
  if (cache) await writeFile(cache, JSON.stringify({ sha256: ipsaeSha, archives: Object.fromEntries(archives.map(archive => [archive, Object.fromEntries(expected.get(archive))])) }));
}
if (process.env.IPSAE_REFERENCE_ONLY) { console.log('reference results computed for ' + archives.length + ' archives'); process.exit(0); }

/* ---------- the viewer, on the same archives ---------- */
const work = await mkdtemp(join(tmpdir(), 'psv-validate-ipsae-'));
const source = await readFile(join(here, '..', 'index.html'), 'utf8');
await writeFile(join(work, 'index.html'), source.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g, (_, file) => `<script src="vendor/${file}"></script>`));
const roots = [work, here];
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = roots.map(root => resolve(root, name)).find(candidate => existsSync(candidate));
  if (!file) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=1`); await page.waitForTimeout(1500);

const results = []; let failed = 0; let comparisons = 0; const worst = {};
for (const archive of archives) {
  /* One input at a time, so loose files with the same names from different tools never meet. */
  for (const id of await page.evaluate(() => window.__viewerDebug.entries().map(entry => entry.id))) { await page.click('#gpv-list [data-entry-id="' + id + '"] button:has-text("Remove")'); await page.waitForTimeout(100); }
  const folder = isFolder(archive);
  const files = folder ? (await readdir(archive)).map(name => join(archive, name)).filter(path => statSync(path).isFile()) : [archive];
  await page.setInputFiles('#gpv-files', files);
  const models = expected.get(archive).size;
  for (let i = 0; i < 600; i += 1) { await page.waitForTimeout(500); if ((await page.locator('#gpv-list .gpv-entry').count()) >= models && await page.locator('#gpv-import-state').isHidden()) break; }
  const viewer = await page.evaluate(({ collection, cutoffs }) => {
    const debug = window.__viewerDebug;
    const out = {};
    debug.entries().filter(entry => collection === null || entry.collection === collection).forEach(entry => {
      debug.materializeEntry(entry);
      const index = entry.name.split(' / ').pop();
      out[index] = {};
      cutoffs.forEach(([pae, dist]) => {
        const scores = debug.interactionScores(entry, pae, dist);
        const withReported = row => ({ ...row, iptmModel: debug.reportedPairIptm(entry, row.chain1, row.chain2) });
        out[index][pae + '_' + dist] = { asym: scores.asym.map(withReported), pairs: scores.pairs.map(pair => ({ ...pair, iptmModel: debug.reportedPairIptmMax(entry, pair.chain1, pair.chain2) })), reason: scores.reason };
      });
    });
    return out;
  }, { collection: folder ? null : basename(archive), cutoffs });
  for (const [index, runs] of expected.get(archive)) {
    for (const [run, rows] of Object.entries(runs)) {
      const mine = viewer[index.split('/').pop()] && viewer[index.split('/').pop()][run];
      if (!mine) { failed += 1; results.push({ archive: basename(archive), model: index, run, problem: 'the viewer produced no scores' }); continue; }
      if (mine.reason) { failed += 1; results.push({ archive: basename(archive), model: index, run, problem: mine.reason }); continue; }
      for (const row of rows) {
        const match = row.type === 'asym'
          ? mine.asym.find(item => item.chain1 === row.chain1 && item.chain2 === row.chain2)
          : mine.pairs.find(item => (item.chain1 === row.chain1 && item.chain2 === row.chain2) || (item.chain1 === row.chain2 && item.chain2 === row.chain1));
        if (!match) { failed += 1; results.push({ archive: basename(archive), model: index, run, problem: 'no viewer row for ' + row.type + ' ' + row.chain1 + row.chain2 }); continue; }
        for (const [column, [key, tolerance]] of Object.entries(compared)) {
          /* ipsae.py reports ipTM_af 0 when it found no summary file (a local AlphaFold 3 run
             names it differently, the IPSAE example ships without one). */
          if (column === 'ipTM_af' && row.ipTM_af === 0 && (match[key] === null || match[key] === undefined)) continue;
          /* nres and dist on the combined row are per chain of the printed pair. */
          let value = match[key];
          if (row.type === 'max' && (key === 'nres1' || key === 'nres2' || key === 'dist1' || key === 'dist2') && match.chain1 !== row.chain1) value = match[{ nres1: 'nres2', nres2: 'nres1', dist1: 'dist2', dist2: 'dist1' }[key]];
          const delta = Math.abs(Number(value) - row[column]);
          comparisons += 1;
          worst[column] = Math.max(worst[column] || 0, delta);
          if (!(delta <= tolerance)) { failed += 1; results.push({ archive: basename(archive), model: index, run, row: row.type + ' ' + row.chain1 + '→' + row.chain2, column, viewer: value, reference: row[column] }); }
        }
      }
    }
  }
  console.log(basename(archive) + ': ' + expected.get(archive).size + ' model' + (expected.get(archive).size === 1 ? '' : 's') + ' checked');
}
await browser.close(); server.close();

console.log('\nipsae.py sha256 ' + ipsaeSha);
console.log(comparisons + ' comparisons across ' + archives.length + ' archives, ' + failed + ' outside tolerance');
Object.entries(worst).forEach(([column, delta]) => console.log('  largest |Δ| ' + column.padEnd(12) + ' ' + delta.toExponential(2)));
results.slice(0, 40).forEach(result => console.log('  ' + JSON.stringify(result)));
if (errors.length) { console.log('page errors: ' + errors.join(' | ')); }
process.exit(failed || errors.length ? 1 : 0);
