/* Headless regression suite for the Protein Structure Viewer.
   Serves a copy of ../index.html with the CDN script tags rewritten to the
   locally verified copies in vendor/ (see vendor.mjs), then drives the real UI.

   Usage:  npm install && npm test
   Set PSV_HEADED=1 to watch it run. */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixtures } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const consoleErrors = [];

/* ---------- fixtures and a local static server ---------- */

const work = await mkdtemp(join(tmpdir(), 'psv-tests-'));
const models = (await writeFixtures(work)).map(name => join(work, name));

const source = await readFile(join(here, '..', 'index.html'), 'utf8');
const local = source.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g,
  (_, file) => `<script src="vendor/${file}"></script>`
);
if (local === source) throw new Error('no CDN script tags were rewritten — check index.html');
await writeFile(join(work, 'index.html'), local);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const roots = [work, here];
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (name.includes('..')) { response.writeHead(400).end(); return; }
  const file = roots.map(root => resolve(root, name)).find(candidate => existsSync(candidate));
  if (!file) { response.writeHead(404).end('not found'); return; }
  response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- harness ---------- */

/* PSV_BROWSER=firefox or webkit runs the same suite in another engine (Playwright's
   WebKit is the closest headless stand-in for Safari). */
const engineName = ['chromium', 'firefox', 'webkit'].includes(process.env.PSV_BROWSER) ? process.env.PSV_BROWSER : 'chromium';
const engine = { chromium, firefox, webkit }[engineName];
console.log('engine: ' + engineName);
const browser = await engine.launch({
  headless: process.env.PSV_HEADED !== '1',
  /* PSV_CHROMIUM lets CI or a sandbox point at a Chromium it already has,
     instead of Playwright downloading its own. */
  ...(engineName === 'chromium' && process.env.PSV_CHROMIUM ? { executablePath: process.env.PSV_CHROMIUM } : {}),
  /* The viewer needs WebGL; most CI runners have no GPU. */
  ...(engineName === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] } : {})
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let currentStep = 'startup';
const noteError = text => { consoleErrors.push(text); console.log('       ! [' + currentStep + '] ' + text.split('\n')[0]); };
page.on('pageerror', error => noteError('PAGEERROR: ' + error.message));
page.on('console', message => {
  /* The static server has no favicon; that 404 is the harness, not the page. */
  if (message.type() === 'error' && !/favicon|404/.test(message.text())) noteError(message.text());
});

const step = async (name, body) => {
  currentStep = name;
  try { await body(); console.log('  ok   ' + name); }
  catch (error) { console.log('  FAIL ' + name + ' :: ' + String(error.message).split('\n')[0]); failures.push(name); }
};
const tab = async name => { await page.click(`[data-gpv-tab="${name}"]`); await page.waitForTimeout(150); };
/* A human click is a short press and release; WebKit does not reliably turn an instantaneous
   mouse.click into a pointerdown/pointerup pair on a canvas. */
const tap = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); };
/* Clicking a control lower on the page can scroll the stage out of the viewport (WebKit scrolls
   further than the others), and a tap at an off-screen coordinate reaches nothing. */
const tapStageCentre = async () => {
  await page.locator('#gpv-stage').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  const box = await page.locator('#gpv-stage').boundingBox();
  await tap(box.x + box.width / 2, box.y + box.height / 2); await page.waitForTimeout(500);
};
const group = name => console.log('\n' + name);

await page.goto(base + '/index.html?debug=1'); /* ?debug=1 exposes window.__viewerDebug, a read-only hook used to check colours */
await page.waitForTimeout(2500);

group('boot');
await step('3Dmol is available', async () => {
  if (!(await page.evaluate(() => typeof $3Dmol !== 'undefined'))) throw new Error('missing');
});
await step('no startup error banner', async () => {
  if (!(await page.locator('#gpv-import-errors').isHidden())) {
    throw new Error(await page.locator('#gpv-import-errors').textContent());
  }
});
await step('icons render from the inline set', async () => {
  const count = await page.locator('#generic-protein-viewer [data-icon] svg').count();
  if (count < 10) throw new Error('only ' + count + ' icons rendered');
});

group('import');
await page.setInputFiles('#gpv-files', models);
await page.waitForTimeout(2500);
await step('all three models are listed', async () => {
  const rows = await page.locator('#gpv-list .gpv-entry').count();
  if (rows !== 3) throw new Error('rows=' + rows);
});
await step('mean pLDDT is computed from Cα B-factors', async () => {
  const text = await page.locator('#gpv-confidence').textContent();
  if (!/Mean pLDDT \d/.test(text)) throw new Error(text);
});
await step('the viewport has a canvas', async () => {
  const ok = await page.evaluate(() => {
    const canvas = document.querySelector('#gpv-stage canvas');
    return Boolean(canvas) && canvas.width > 100;
  });
  if (!ok) throw new Error('no canvas');
});
await step('search filters the model list', async () => {
  await page.fill('#gpv-model-search', 'model_c'); await page.waitForTimeout(400);
  const rows = await page.locator('#gpv-list .gpv-entry').count();
  if (rows !== 1) throw new Error('rows=' + rows);
  await page.fill('#gpv-model-search', ''); await page.waitForTimeout(400);
});

await step('a model can be given a display name', async () => {
  await page.click('#gpv-list .gpv-entry button[aria-label^="Rename"]');
  const input = page.locator('#gpv-list .gpv-entry input[type="text"]');
  await input.fill('Reference helix'); await input.press('Enter'); await page.waitForTimeout(500);
  const shown = await page.locator('#gpv-list .gpv-entry .gpv-entry-name').first().textContent();
  if (shown !== 'Reference helix') throw new Error('row shows ' + shown);
  const options = await page.locator('#gpv-current option').allTextContents();
  if (!options.some(text => /Reference helix/.test(text))) throw new Error('model picker did not pick up the name');
});

await step('the composition table lists both chains and hides one on request', async () => {
  const rows = await page.locator('#gpv-chain-rows tr').count();
  if (rows !== 2) throw new Error('rows=' + rows);
  if (!/No ligands or ions/.test((await page.locator('#gpv-hetero-summary').textContent()) || '')) throw new Error('hetero summary missing');
  const snapshot = () => page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  const before = await snapshot();
  await page.locator('#gpv-chain-rows tr').nth(1).locator('input[type="checkbox"]').uncheck(); await page.waitForTimeout(600);
  if ((await snapshot()) === before) throw new Error('hiding chain B did not change the render');
  if (!/hidden/.test((await page.locator('#gpv-sequence-rows').textContent()) || '')) throw new Error('strip does not mark the hidden chain');
  await page.click('#gpv-chains-all'); await page.waitForTimeout(500);
  if (!(await page.locator('#gpv-chain-rows tr').nth(1).locator('input[type="checkbox"]').isChecked())) throw new Error('show all did not restore chain B');
});
await step('FASTA has one record per chain of the displayed models', async () => {
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-fasta');
  const file = join(work, 'sequences.fasta'); await (await download).saveAs(file);
  const fasta = await readFile(file, 'utf8');
  const records = (fasta.match(/^>/gm) || []).length;
  if (records < 2 || records % 2) throw new Error('records=' + records);
  if (!/chain_A length=30 mean_pLDDT=/.test(fasta)) throw new Error('header missing fields: ' + fasta.split('\n')[0]);
  if (!/^A{30}$/m.test(fasta)) throw new Error('poly-alanine sequence not found');
  console.log('       ' + records + ' FASTA records');
});

group('navigation');
await step('previous and next', async () => {
  await page.click('#gpv-next'); await page.waitForTimeout(400);
  await page.click('#gpv-previous'); await page.waitForTimeout(400);
});
await step('arrow keys navigate', async () => {
  await page.click('#gpv-stage'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
});
for (const [index, name] of ['models', 'appearance', 'annotate', 'compare', 'confidence', 'publish'].entries()) {
  await step(`digit ${index + 1} opens the ${name} tab`, async () => {
    await page.keyboard.press(String(index + 1)); await page.waitForTimeout(250);
    if (await page.locator(`[data-gpv-panel="${name}"]`).isHidden()) throw new Error('panel hidden');
  });
}

group('appearance');
await tab('appearance');
await step('90° rotation buttons turn the view and reset restores it', async () => {
  const snapshot = () => page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  const before = await snapshot();
  await page.click('#gpv-rotate-y'); await page.waitForTimeout(500);
  if ((await snapshot()) === before) throw new Error('rotation did not change the render');
  await page.keyboard.press('Shift+R'); await page.waitForTimeout(500);
  if (!/Orientation reset/.test((await page.locator('#gpv-state').textContent()) || '')) throw new Error('reset status missing');
});
await step('presets and the ligand control apply without errors', async () => {
  await page.selectOption('#gpv-hetero', 'sphere'); await page.waitForTimeout(300);
  await page.selectOption('#gpv-hetero', 'stick'); await page.waitForTimeout(300);
  await page.click('#gpv-preset-thesis'); await page.waitForTimeout(600);
  if ((await page.inputValue('#gpv-background')) !== 'white') throw new Error('background not white');
  if ((await page.inputValue('#gpv-projection')) !== 'orthographic') throw new Error('projection not orthographic');
  if (!/Preset applied/.test((await page.locator('#gpv-state').textContent()) || '')) throw new Error('status missing');
});
for (const [selector, value] of [
  ['#gpv-style', 'stick'], ['#gpv-style', 'sphere'], ['#gpv-style', 'line'],
  ['#gpv-color-mode', 'plddt'], ['#gpv-color-mode', 'spectrum'], ['#gpv-color-mode', 'element'],
  ['#gpv-background', 'dark'], ['#gpv-background', 'white'],
  ['#gpv-projection', 'orthographic'], ['#gpv-motion', 'rock']
]) {
  await step(`${selector} = ${value}`, async () => {
    await page.selectOption(selector, value); await page.waitForTimeout(400);
  });
}
await step('pLDDT colouring reveals the legend', async () => {
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
  if (await page.locator('#gpv-plddt-legend').isHidden()) throw new Error('legend hidden');
});
await step('hiding low-confidence residues changes the render', async () => {
  const before = await page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  await page.selectOption('#gpv-hide-below', '70'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  if (before === after) throw new Error('the render did not change');
  if (!/below 70 hidden/.test((await page.locator('#gpv-sequence-title').textContent()) || '')) throw new Error('strip title does not mention the cut');
  await page.selectOption('#gpv-hide-below', '0'); await page.waitForTimeout(400);
});
await step('residue colour themes apply and the charge legend names its classes', async () => {
  for (const mode of ['charge', 'hydrophobicity', 'restype', 'amino', 'ss']) { await page.selectOption('#gpv-color-mode', mode); await page.waitForTimeout(250); }
  await page.selectOption('#gpv-color-mode', 'charge'); await page.waitForTimeout(300);
  const text = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Charge/.test(text) || !/Positive/.test(text) || !/Negative/.test(text)) throw new Error('legend: ' + text);
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
});
await step('a translucent surface renders and clears', async () => {
  const snapshot = () => page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  const before = await snapshot();
  await page.selectOption('#gpv-surface', 'translucent'); await page.waitForTimeout(2500);
  if ((await snapshot()) === before) throw new Error('the surface did not change the render');
  await page.selectOption('#gpv-surface', 'none'); await page.waitForTimeout(600);
});
await step('the colour-blind-safe palette recolours chain A to Okabe–Ito blue', async () => {
  await page.selectOption('#gpv-color-mode', 'chain'); await page.check('#gpv-safe-palette'); await page.waitForTimeout(500);
  const swatch = await page.locator('#gpv-plddt-legend .gpv-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  if (swatch !== 'rgb(0, 114, 178)') throw new Error('chain A swatch: ' + swatch);
  await page.uncheck('#gpv-safe-palette'); await page.waitForTimeout(400);
  const restored = await page.locator('#gpv-plddt-legend .gpv-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  if (restored !== 'rgb(59, 130, 246)') throw new Error('default chain A swatch: ' + restored);
});
await step('entity colouring groups the two identical chains and reads as a stoichiometry', async () => {
  await page.selectOption('#gpv-color-mode', 'entity'); await page.waitForTimeout(400);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/α ×2/.test(legend) || !/A, B/.test(legend) || !/30 aa/.test(legend)) throw new Error('legend: ' + legend);
  const summary = (await page.locator('#gpv-assembly-summary').textContent()) || '';
  if (!/Stoichiometry: α ×2/.test(summary) || !/Cα extent \d+\.\d nm · radius of gyration \d+\.\d nm/.test(summary)) throw new Error('summary: ' + summary);
  console.log('       ' + summary.trim());
});
await step('chain colouring lists the chains in the legend', async () => {
  await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(400);
  const legend = page.locator('#gpv-plddt-legend');
  if (await legend.isHidden()) throw new Error('legend hidden');
  const text = (await legend.textContent()) || '';
  if (!/Chain/.test(text) || !/A/.test(text) || !/B/.test(text)) throw new Error('legend text: ' + text);
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
});
await step('motion off', async () => { await page.selectOption('#gpv-motion', 'off'); await page.waitForTimeout(300); });
await step('theme cycles system → light → dark → system', async () => {
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    await page.click('#gpv-theme'); await page.waitForTimeout(250);
    seen.push(await page.locator('#gpv-theme').getAttribute('data-mode'));
  }
  if (seen.join(',') !== 'light,dark,system') throw new Error(seen.join(','));
});
await step('preferences survive a reload', async () => {
  await page.selectOption('#gpv-style', 'stick'); await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(2500);
  await tab('appearance');
  const value = await page.locator('#gpv-style').inputValue();
  if (value !== 'stick') throw new Error('got ' + value);
  await page.setInputFiles('#gpv-files', models); await page.waitForTimeout(2500);
  await tab('appearance'); await page.selectOption('#gpv-style', 'cartoon'); await page.waitForTimeout(400);
});

group('compare');
await step('deviation colouring lists its bands after alignment', async () => {
  await page.selectOption('#gpv-color-mode', 'deviation'); await page.waitForTimeout(500);
  const text = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Cα deviation/.test(text) || !/<1 Å/.test(text) || !/unmatched/.test(text)) throw new Error('legend text: ' + text);
  const colours = await page.evaluate(() => { const legend = document.querySelector('#gpv-plddt-legend'); return legend.hidden ? 'hidden' : 'shown'; });
  if (colours !== 'shown') throw new Error('legend hidden');
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
});
await step('sequence-aware alignment reports a non-zero RMSD', async () => {
  await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(500);
  await tab('compare');
  await page.click('#gpv-align'); await page.waitForTimeout(3000);
  if ((await page.locator('#gpv-alignment-results tr').count()) < 2) throw new Error('no alignment rows');
  const cells = await page.locator('#gpv-alignment-results tr').nth(1).locator('td').allTextContents();
  console.log(`       ${cells[0]} Cα pairs · identity ${cells[1]} · RMSD ${cells[2]} Å`);
  if (Number(cells[0]) < 10) throw new Error('too few pairs: ' + cells[0]);
  if (!(Number(cells[2]) > 0)) throw new Error('RMSD not positive: ' + cells[2]);
});
await step('identifier alignment mode also runs', async () => {
  await page.selectOption('#gpv-alignment-mode', 'identifier');
  await page.click('#gpv-align'); await page.waitForTimeout(2500);
  if ((await page.locator('#gpv-alignment-results tr').count()) < 2) throw new Error('no rows');
  await page.selectOption('#gpv-alignment-mode', 'sequence');
});
await step('RMSD CSV downloads', async () => {
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-alignment-csv'); await download;
});
await step('model agreement colours residues by Cα RMSF and exports a CSV', async () => {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'agreement'); await page.waitForTimeout(500); await tab('compare');
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Cα RMSF/.test(legend) || !/<0\.5 Å/.test(legend)) throw new Error('legend: ' + legend);
  const painted = await page.evaluate(() => { const v = window.__viewerDebug; const entry = v.activeEntry(); const atom = entry.atoms.find(a => a.atom === 'CA' && a.resi === 5 && (a.chain || '') === 'A'); return v.colorOptions(entry).colorfunc(atom); });
  if (painted === '#9ca3af') throw new Error('residue 5 has no RMSF after alignment');
  if (await page.locator('#gpv-rmsf-csv').isDisabled()) throw new Error('RMSF CSV disabled');
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-rmsf-csv');
  const file = join(work, 'rmsf.csv'); await (await download).saveAs(file);
  const csv = await readFile(file, 'utf8');
  const rows = csv.split('\n').filter(line => /^[A-Z],\d+,\d+,/.test(line)).length;
  if (rows < 50) throw new Error('rmsf rows=' + rows);
  console.log('       RMSF rows ' + rows + ' · ' + painted);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('compare');
});
await step('side-by-side renders a second viewport', async () => {
  await page.check('#gpv-side-by-side'); await page.waitForTimeout(1500);
  if (!(await page.locator('#gpv-stage-compare canvas').count())) throw new Error('no compare canvas');
});
await step('a third synchronized panel follows a drag on the primary', async () => {
  await page.click('#gpv-add-panel'); await page.waitForTimeout(1500);
  if ((await page.locator('.gpv-stage-compare canvas').count()) < 2) throw new Error('second comparison panel missing');
  const columns = await page.evaluate(() => getComputedStyle(document.getElementById('gpv-view-grid')).gridTemplateColumns.split(' ').length);
  if (columns !== 3) throw new Error('expected 3 grid columns, got ' + columns);
  const before = await page.evaluate(() => [...document.querySelectorAll('.gpv-stage-compare canvas')].map(canvas => canvas.toDataURL()));
  const box = await page.locator('#gpv-stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 50, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => [...document.querySelectorAll('.gpv-stage-compare canvas')].map(canvas => canvas.toDataURL()));
  if (before.every((image, index) => image === after[index])) throw new Error('comparison panels did not follow the drag');
  await page.click('#gpv-clear-panels'); await page.waitForTimeout(600);
  if (await page.locator('.gpv-stage-compare').count()) throw new Error('panels were not removed');
  await page.uncheck('#gpv-side-by-side'); await page.waitForTimeout(600);
});
await step('coordinates restore', async () => { await page.click('#gpv-restore'); await page.waitForTimeout(800); });

group('annotate');
await tab('annotate');
/* The compare group leaves the camera dragged; refit so centre clicks land on the model. */
await page.keyboard.press('f'); await page.waitForTimeout(600);
if (process.env.PSV_DIAG) {
  await page.screenshot({ path: process.env.PSV_DIAG });
  console.log('       PROJ ' + JSON.stringify(await page.evaluate(() => {
    const debug = window.__viewerDebug; if (!debug) return 'no debug hook';
    const stage = document.querySelector('#gpv-stage').getBoundingClientRect();
    const centre = { x: stage.x + stage.width / 2 + window.scrollX, y: stage.y + stage.height / 2 + window.scrollY };
    const shown = debug.displayedEntries();
    const hit = debug.pickAtomAt(centre.x, centre.y);
    const projected = shown.map(entry => ({ name: entry.name, model: Boolean(entry.model), atoms: entry.atoms.length, ca: entry.atoms.filter(atom => atom.atom === 'CA').slice(0, 3).map(atom => { const p = debug.viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z }); return p ? [Math.round(p.x), Math.round(p.y)] : null; }) }));
    return { centre: [Math.round(centre.x), Math.round(centre.y)], hit: hit ? hit.atom.resn + hit.atom.resi : null, projected, view: debug.viewer.getView().map(v => Math.round(v * 100) / 100), width: debug.viewer.getWidth ? debug.viewer.getWidth() : null };
  })));
  console.log('       DIAG ' + JSON.stringify(await page.evaluate(() => {
    const stage = document.querySelector('#gpv-stage').getBoundingClientRect();
    const canvas = document.querySelector('#gpv-stage canvas');
    return { stage: [Math.round(stage.x), Math.round(stage.y), Math.round(stage.width), Math.round(stage.height)], canvas: canvas ? [canvas.width, canvas.height, canvas.getBoundingClientRect().width] : null, count: document.querySelector('#gpv-count').textContent, scroll: [window.scrollX, window.scrollY], dpr: window.devicePixelRatio, atCentre: (() => { const r = document.querySelector('#gpv-stage').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el ? el.tagName + '.' + el.className + '#' + el.id : null; })(), current: document.querySelector('#gpv-current').selectedOptions[0]?.textContent, mode: document.querySelector('#gpv-view-mode').value, side: document.querySelector('#gpv-side-by-side').checked, panels: document.querySelectorAll('.gpv-stage-compare').length, state: document.querySelector('#gpv-state').textContent };
  })));
}
await step('a residue range can be highlighted', async () => {
  await page.fill('#gpv-selection-chain', 'A'); await page.fill('#gpv-selection-range', '5-12');
  await page.click('#gpv-add-selection'); await page.waitForTimeout(600);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== 1) throw new Error('no row added');
});
await step('a blank chain applies to every chain', async () => {
  await page.fill('#gpv-selection-chain', ''); await page.fill('#gpv-selection-range', '20,21,22');
  await page.selectOption('#gpv-selection-action', 'hide');
  await page.click('#gpv-add-selection'); await page.waitForTimeout(600);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== 2) throw new Error('no second row');
  await page.selectOption('#gpv-selection-action', 'highlight');
});
await step('an unparseable range is rejected', async () => {
  await page.fill('#gpv-selection-range', 'nonsense');
  await page.click('#gpv-add-selection'); await page.waitForTimeout(400);
  const status = await page.locator('#gpv-state').textContent();
  if (!/valid residue/.test(status)) throw new Error('status: ' + status);
});
await step('selections clear', async () => { await page.click('#gpv-clear-selections'); await page.waitForTimeout(500); });
await step('figure annotations: an arrow from two real atom clicks and a corner title', async () => {
  await page.selectOption('#gpv-annotation-type', 'arrow');
  await page.fill('#gpv-annotation-text', 'helix');
  await page.click('#gpv-annotate'); await page.waitForTimeout(300);
  if (!(await page.locator('#gpv-stage.is-drawing').count())) throw new Error('drawing mode did not start');
  await tapStageCentre();
  if (!/Click 1 atom/.test((await page.locator('#gpv-annotation-state').textContent()) || '')) throw new Error('the centre click did not start the arrow: ' + await page.locator('#gpv-annotation-state').textContent());
  /* The second atom comes from the sequence strip — a residue picked by number is a
     click too — which keeps the step deterministic across engines. */
  const strip = await page.locator('#gpv-sequence-rows canvas').nth(1).boundingBox();
  await page.mouse.click(strip.x + strip.width * 0.9, strip.y + strip.height / 2); await page.waitForTimeout(500);
  const rows = await page.locator('#gpv-annotation-list .gpv-entry').count();
  if (rows !== 1) throw new Error('expected one annotation, found ' + rows + ' · ' + await page.locator('#gpv-annotation-state').textContent());
  await page.fill('#gpv-screen-text', 'A · Test'); await page.click('#gpv-add-screen-text'); await page.waitForTimeout(400);
  if ((await page.locator('#gpv-annotation-list .gpv-entry').count()) !== 2) throw new Error('screen text row missing');
  if ((await page.locator('#gpv-annotation-list .gpv-nudge').count()) !== 2) throw new Error('nudge controls missing');
  await page.click('#gpv-annotation-list .gpv-nudge button[aria-label="Move label right"]'); await page.waitForTimeout(300);
  await page.click('#gpv-annotation-list .gpv-nudge button[aria-label="Move label up"]'); await page.waitForTimeout(300);
  await page.click('#gpv-annotate'); await page.waitForTimeout(200);
  if (await page.locator('#gpv-stage.is-drawing').count()) throw new Error('drawing mode did not stop');
});
await step('a residue label is added by clicking and edited from its list row', async () => {
  await tapStageCentre();
  if (await page.locator('#gpv-add-label').isDisabled()) throw new Error('the centre click did not select a residue');
  await page.fill('#gpv-label-text', 'Site A'); await page.click('#gpv-add-label'); await page.waitForTimeout(400);
  if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== 1) throw new Error('label row missing');
  const text = page.locator('#gpv-label-list .gpv-entry input[type="text"]');
  await text.fill('Site A · catalytic'); await text.press('Enter'); await page.waitForTimeout(400);
  await page.selectOption('#gpv-label-list .gpv-entry select', '15'); await page.waitForTimeout(300);
  if ((await text.inputValue()) !== 'Site A · catalytic') throw new Error('edit did not stick');
  await page.click('#gpv-label-list .gpv-entry button:has-text("Remove")'); await page.waitForTimeout(300);
  if (await page.locator('#gpv-label-list .gpv-entry').count()) throw new Error('label was not removed');
});
await step('the sequence strip shows both chains and selects a residue on click', async () => {
  await tab('models'); await page.selectOption('#gpv-view-mode', 'single'); await tab('annotate'); await page.waitForTimeout(500);
  const canvases = page.locator('#gpv-sequence-rows canvas');
  if ((await canvases.count()) !== 2) throw new Error('canvases=' + (await canvases.count()));
  const box = await canvases.first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2); await page.waitForTimeout(300);
  const readout = (await page.locator('#gpv-residue').textContent()) || '';
  if (!/chain A/.test(readout)) throw new Error('readout: ' + readout);
  if (await page.locator('#gpv-add-label').isDisabled()) throw new Error('label button still disabled');
  const second = await canvases.nth(1).boundingBox();
  await page.mouse.move(second.x + second.width * 0.2, second.y + second.height / 2); await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.6, second.y + second.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const range = await page.inputValue('#gpv-selection-range');
  if (!/^\d+-\d+$/.test(range)) throw new Error('range not filled: ' + range);
  if ((await page.inputValue('#gpv-selection-chain')) !== 'B') throw new Error('chain field not filled');
  console.log('       range ' + range + ' of chain B');
});
await step('go to residue selects and zooms by chain and number', async () => {
  await page.fill('#gpv-goto', 'B:12'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
  const readout = (await page.locator('#gpv-residue').textContent()) || '';
  if (!/ALA 12 chain B/.test(readout)) throw new Error('readout: ' + readout);
  await page.fill('#gpv-goto', '999'); await page.press('#gpv-goto', 'Enter'); await page.waitForTimeout(400);
  await page.keyboard.press('f'); await page.waitForTimeout(400);
});
await step('sequence letters list both chains and select a residue on click', async () => {
  await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(500);
  const blocks = await page.locator('#gpv-sequence-letters .gpv-seq-block').count();
  if (blocks !== 2) throw new Error('blocks=' + blocks);
  const spans = page.locator('#gpv-sequence-letters .gpv-aa');
  if ((await spans.count()) !== 60) throw new Error('letters=' + (await spans.count()));
  await spans.nth(40).click(); await page.waitForTimeout(300);
  const readout = (await page.locator('#gpv-residue').textContent()) || '';
  if (!/ALA 11 chain B/.test(readout)) throw new Error('readout: ' + readout);
  if (!(await page.locator('#gpv-sequence-letters button:has-text("Copy")').count())) throw new Error('no Copy button');
  await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(300);
});
await step('overlay mode gives the strip one row per model and chain', async () => {
  await tab('models');
  const previous = await page.inputValue('#gpv-view-mode');
  await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(700);
  const rows = await page.locator('#gpv-sequence-rows canvas').count();
  if (rows !== 6) throw new Error('rows=' + rows);
  if (!(await page.locator('#gpv-sequence-rows.is-multi').count())) throw new Error('multi-model layout class missing');
  await page.selectOption('#gpv-view-mode', previous); await tab('annotate'); await page.waitForTimeout(500);
  if ((await page.locator('#gpv-sequence-rows canvas').count()) !== 2) throw new Error('did not return to a single model');
});
await step('a named domain applies across models from the same source and fills the legend', async () => {
  await page.fill('#gpv-domain-name', 'N-lobe'); await page.fill('#gpv-domain-range', '1-15');
  await page.selectOption('#gpv-domain-scope', 'source'); await page.click('#gpv-add-domain'); await page.waitForTimeout(400);
  if ((await page.locator('#gpv-domain-list .gpv-entry').count()) !== 1) throw new Error('domain row missing');
  await page.click('#gpv-domain-paint'); await page.waitForTimeout(500);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/N-lobe/.test(legend)) throw new Error('legend: ' + legend);
  const activeBefore = await page.inputValue('#gpv-current');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  if ((await page.inputValue('#gpv-current')) === activeBefore) throw new Error('did not move to another model');
  const legendOther = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/N-lobe/.test(legendOther)) throw new Error('domain did not apply to the sibling model: ' + legendOther);
  const painted = await page.evaluate(() => { const v = window.__viewerDebug; if (!v) return 'no debug hook'; const entry = v.activeEntry(); const atom = entry.atoms.find(a => a.atom === 'CA' && a.resi === 5); return v.colorOptions(entry).colorfunc(atom); });
  if (painted !== '#2563eb') throw new Error('residue 5 colour: ' + painted);
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('annotate');
  await page.click('#gpv-domain-list .gpv-entry button:has-text("Remove")'); await page.waitForTimeout(300);
  if (await page.locator('#gpv-domain-list .gpv-entry').count()) throw new Error('domain was not removed');
});
await step('a per-residue table colours the structure with a gradient legend', async () => {
  const csv = 'resi,value\n' + Array.from({ length: 30 }, (_, i) => (i + 1) + ',' + ((i + 1) / 30).toFixed(3)).join('\n') + '\n';
  const file = join(work, 'conservation.csv'); await writeFile(file, csv);
  await page.setInputFiles('#gpv-data-file', [file]); await page.waitForTimeout(600);
  const state = (await page.locator('#gpv-data-state').textContent()) || '';
  if (!/conservation · 30 values · 0\.03 to 1\.00/.test(state)) throw new Error('data state: ' + state);
  await page.click('#gpv-data-paint'); await page.waitForTimeout(500);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/conservation/.test(legend) || !/1\.00/.test(legend)) throw new Error('legend: ' + legend);
  const colours = await page.evaluate(() => { const v = window.__viewerDebug; const entry = v.activeEntry(); const fn = v.colorOptions(entry).colorfunc; const at = resi => fn(entry.atoms.find(a => a.atom === 'CA' && a.resi === resi && (a.chain || '') === 'A')); return [at(30), at(1)]; });
  if (colours[0] !== '#fde725' || colours[1] !== '#440154') throw new Error('gradient ends: ' + colours.join(' '));
  await page.click('#gpv-data-clear'); await page.waitForTimeout(300);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('annotate');
});
await step('a sequence motif is highlighted in every chain', async () => {
  const before = await page.locator('#gpv-selection-list .gpv-entry').count();
  await page.fill('#gpv-motif', 'A{5}'); await page.click('#gpv-motif-run'); await page.waitForTimeout(500);
  const state = (await page.locator('#gpv-motif-state').textContent()) || '';
  if (!/^12 matches/.test(state)) throw new Error('motif state: ' + state);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== before + 2) throw new Error('expected one selection per chain');
  await page.fill('#gpv-motif', 'WWW'); await page.click('#gpv-motif-run'); await page.waitForTimeout(300);
  if (!/No match/.test((await page.locator('#gpv-motif-state').textContent()) || '')) throw new Error('no-match message missing');
  await page.fill('#gpv-motif', '[unclosed'); await page.click('#gpv-motif-run'); await page.waitForTimeout(300);
  if (!/Not a valid pattern/.test((await page.locator('#gpv-motif-state').textContent()) || '')) throw new Error('invalid-pattern message missing');
  await page.click('#gpv-clear-selections'); await page.waitForTimeout(300);
});
await step('residues near a chain are highlighted and listed', async () => {
  const before = await page.locator('#gpv-selection-list .gpv-entry').count();
  await page.selectOption('#gpv-near-target', 'chain'); await page.fill('#gpv-near-chain', 'B'); await page.fill('#gpv-near-cutoff', '6');
  await page.click('#gpv-near-run'); await page.waitForTimeout(600);
  const state = (await page.locator('#gpv-state').textContent()) || '';
  if (!/residues? within 6 Å highlighted/.test(state)) throw new Error('status: ' + state);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) <= before) throw new Error('no selection added');
  if (await page.locator('#gpv-near-copy').isDisabled()) throw new Error('copy list disabled');
  console.log('       ' + state.trim().slice(0, 70));
  await page.click('#gpv-clear-selections'); await page.waitForTimeout(300);
});
await step('undo and redo walk label changes back and forth', async () => {
  await page.fill('#gpv-label-text', 'Undo me'); await page.click('#gpv-add-label'); await page.waitForTimeout(300);
  const count = () => page.locator('#gpv-label-list .gpv-entry').count();
  if ((await count()) !== 1) throw new Error('label not added');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  if ((await count()) !== 0) throw new Error('undo did not remove the label');
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(400);
  if ((await count()) !== 1) throw new Error('redo did not restore the label');
  await page.click('#gpv-undo'); await page.waitForTimeout(300);
  if ((await count()) !== 0) throw new Error('the Undo button did nothing');
});
await step('every residue can be labelled', async () => {
  await page.check('#gpv-all-labels'); await page.waitForTimeout(1200);
  await page.uncheck('#gpv-all-labels'); await page.waitForTimeout(600);
});

group('confidence');
await tab('confidence');
await step('the metrics table has a row per model', async () => {
  const rows = await page.locator('#gpv-metrics tr').count();
  if (rows !== 3) throw new Error('rows=' + rows);
});
await step('the pLDDT profile SVG has a panel per chain and a path per model', async () => {
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-profile-svg');
  const file = join(work, 'plddt-profile.svg'); await (await download).saveAs(file);
  const svg = await readFile(file, 'utf8');
  const chains = (svg.match(/<g id="chain-/g) || []).length; const paths = (svg.match(/<path /g) || []).length;
  console.log('       ' + chains + ' chain panels · ' + paths + ' pLDDT traces');
  if (chains !== 2) throw new Error('chain panels=' + chains);
  if (paths < 2) throw new Error('paths=' + paths);
  const png = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#gpv-profile-png'); await png;
});
await step('PAE domains are found from a block-diagonal matrix', async () => {
  const size = 60;
  const pae = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => ((i < 30) === (j < 30) ? 2 + Math.abs(i - j) * 0.05 : 18 + Math.abs(i - j) * 0.02)));
  const file = join(work, 'model_a.json');
  await writeFile(file, JSON.stringify({ pae, max_predicted_aligned_error: 31.75 }));
  await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1500);
  await page.evaluate(() => { const select = document.querySelector('#gpv-current'); const option = [...select.options].find(item => /model_a/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600);
  await tab('confidence');
  if (await page.locator('#gpv-domain-run').isDisabled()) throw new Error('Find domains stayed disabled: ' + (await page.locator('#gpv-domain-state').textContent()));
  await page.click('#gpv-domain-run'); await page.waitForTimeout(800);
  const rows = await page.locator('#gpv-domain-rows tr').count();
  const state = (await page.locator('#gpv-domain-state').textContent()) || '';
  console.log('       ' + state.trim());
  if (rows !== 2) throw new Error('domains=' + rows + ' · ' + state);
  const ranges = await page.locator('#gpv-domain-rows tr td').first().textContent();
  if (!/A:1–30/.test(ranges || '')) throw new Error('domain 1 ranges: ' + ranges);
  await page.click('#gpv-domain-color'); await page.waitForTimeout(500);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Domain 1/.test(legend) || !/Domain 2/.test(legend)) throw new Error('legend: ' + legend);
  const before = await page.locator('#gpv-selection-list .gpv-entry').count();
  await page.click('#gpv-domain-highlight'); await page.waitForTimeout(500);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== before + 2) throw new Error('highlight all did not add two selections');
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('confidence');
});
await step('ligand sites report that the synthetic models carry no ligands', async () => {
  if (!(await page.locator('#gpv-site-run').isDisabled())) throw new Error('analyse enabled without ligands');
  const state = (await page.locator('#gpv-site-state').textContent()) || '';
  if (!/no ligands or ions/.test(state)) throw new Error('state: ' + state);
});
await step('confidence CSV downloads', async () => {
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-confidence-csv'); await download;
});

await step('interface geometry runs on the active model', async () => {
  await tab('confidence');
  await page.click('#gpv-interface-run');
  await page.waitForFunction(() => !document.querySelector('#gpv-interface-run').disabled, null, { timeout: 120000 });
  const rows = await page.locator('#gpv-contacts-rows tr').count();
  const state = await page.locator('#gpv-interface-state').textContent();
  console.log('       ' + state.trim());
  if (!rows && !/No inter-chain contacts|single chain/.test(state)) throw new Error('no rows and no explanation: ' + state);
  if (rows) {
    const before = await page.locator('#gpv-selection-list .gpv-entry').count();
    await page.click('#gpv-contacts-rows button'); await page.waitForTimeout(600);
    if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== before + 2) throw new Error('highlight did not add two selections');
    const download = page.waitForEvent('download', { timeout: 20000 });
    await page.click('#gpv-interface-csv'); await download;
  }
});

group('publish and export');
await tab('publish');
/* Pixel mode keeps the size and scale selects visible for the steps below; the print-size step switches modes itself. */
await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
await step('the export button is reachable, not covered', async () => {
  const state = await page.evaluate(() => {
    const button = document.querySelector('#gpv-image');
    button.scrollIntoView({ block: 'center' });
    const box = button.getBoundingClientRect();
    const top = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)[0];
    return { disabled: button.disabled, top: top ? top.tagName + (top.id ? '#' + top.id : '') : null };
  });
  if (state.disabled) throw new Error('#gpv-image is disabled');
  if (!/BUTTON/.test(String(state.top))) throw new Error('covered by ' + state.top);
});
await step('the busy state paints before the export blocks the thread', async () => {
  /* A supersampled export is one long synchronous WebGL call. rAF callbacks run
     once per painted frame, so a sample with the badge visible immediately
     before a multi-second gap proves it reached the screen first. */
  await page.selectOption('#gpv-export-scale', '2'); await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__frames = [];
    const tick = time => {
      window.__frames.push([Math.round(time), document.getElementById('gpv-busy').hidden ? 0 : 1]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.click('#gpv-image', { noWaitAfter: true, timeout: 15000 });
  console.log('       ' + (await download).suggestedFilename());
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__frames);
  let longest = { gap: 0, at: -1 };
  for (let i = 1; i < frames.length; i += 1) {
    const gap = frames[i][0] - frames[i - 1][0];
    if (gap > longest.gap) longest = { gap, at: i - 1 };
  }
  if (longest.gap < 300) return; /* fast GPU: nothing blocked long enough to matter */
  if (!frames[longest.at][1]) throw new Error(`busy badge was not on screen before a ${longest.gap} ms block`);
  console.log(`       busy badge painted before a ${longest.gap} ms render block`);
});
await step('the export button re-enables afterwards', async () => {
  await page.waitForTimeout(600);
  if (await page.locator('#gpv-image').isDisabled()) throw new Error('still disabled');
  const label = await page.locator('#gpv-image').textContent();
  if (!/Download publication PNG/.test(label)) throw new Error('label not restored: ' + label);
});
await step('the publication PNG is not blank', async () => {
  await page.selectOption('#gpv-export-size', '1200x1200'); await page.selectOption('#gpv-export-scale', '1');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-image');
  const file = join(work, 'publication.png'); await (await download).saveAs(file);
  const bytes = (await readFile(file)).length;
  console.log('       ' + (bytes / 1024).toFixed(0) + ' KB');
  if (bytes < 30000) throw new Error('export is only ' + bytes + ' bytes — likely blank');
});
await step('six saved views render a contact sheet', async () => {
  for (let i = 1; i <= 6; i += 1) {
    await page.fill('#gpv-view-name', 'View ' + i);
    await page.fill('#gpv-view-caption', 'Caption ' + i + ' long enough that the wrapping logic has real work to do across several lines');
    await page.click('#gpv-save-view'); await page.waitForTimeout(250);
  }
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.click('#gpv-contact-sheet', { noWaitAfter: true });
  console.log('       ' + (await download).suggestedFilename());
});
await step('the main viewport survived seven off-screen renders', async () => {
  /* Regression: export used to leak a WebGL context per panel, and browsers
     silently discard the oldest context past their limit — the main one. */
  const state = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('#gpv-stage canvas')];
    const payloads = canvases.map(canvas => {
      try { return canvas.toDataURL('image/png').length; } catch { return -1; }
    });
    const lost = canvases.some(canvas => {
      for (const type of ['webgl2', 'webgl']) {
        let context = null;
        try { context = canvas.getContext(type); } catch { /* wrong type for this canvas */ }
        if (context) return context.isContextLost();
      }
      return false;
    });
    return { payloads, lost };
  });
  if (state.lost) throw new Error('a WebGL context reports lost');
  if (!state.payloads.length) throw new Error('no canvas');
  if (state.payloads.every(size => size > 0 && size < 5000)) throw new Error('viewport rendered blank');
});
await step('a figure SVG downloads with vector labels', async () => {
  await tab('publish');
  await page.selectOption('#gpv-export-size', '1200x1200'); await page.selectOption('#gpv-export-scale', '1');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-svg');
  const file = join(work, 'figure.svg'); await (await download).saveAs(file);
  const svg = await readFile(file, 'utf8');
  if (!/^<\?xml/.test(svg) || !/<image /.test(svg) || !/<text /.test(svg)) throw new Error('SVG lacks image or text layers');
});
await step('a comparison figure downloads with the multi-view on', async () => {
  await tab('compare'); await page.check('#gpv-side-by-side'); await page.waitForTimeout(1200);
  await tab('publish');
  await page.selectOption('#gpv-export-mode', 'pixels');
  await page.selectOption('#gpv-export-size', '1200x1200'); await page.selectOption('#gpv-export-scale', '1');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-compare-image'); await download;
  const vector = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-compare-svg');
  const file = join(work, 'comparison.svg'); await (await vector).saveAs(file);
  if (!/<image [^>]*x="1200"/.test(await readFile(file, 'utf8'))) throw new Error('comparison SVG lacks a second panel image');
  await tab('compare'); await page.uncheck('#gpv-side-by-side'); await page.waitForTimeout(600);
  await tab('publish');
});
await step('captions download', async () => {
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-captions'); await download;
});
await step('the report size estimate is shown', async () => {
  const text = await page.locator('#gpv-report-size').textContent();
  if (!/model/.test(text)) throw new Error(text);
  console.log('       ' + text.trim());
});
await step('a scene manifest round-trips without a hash mismatch', async () => {
  await page.fill('#gpv-project-title', 'Test figure');
  await page.fill('#gpv-project-method', 'Synthetic');
  const download = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#gpv-save-scene');
  const scene = join(work, 'scene.json');
  await (await download).saveAs(scene);
  await page.setInputFiles('#gpv-load-scene', scene);
  await page.waitForTimeout(2500);
  const status = await page.locator('#gpv-state').textContent();
  if (!/Scene restored/.test(status)) throw new Error('status: ' + status);
  if (/hash mismatch/.test(status)) throw new Error('unexpected hash mismatch: ' + status);
});

await step('an offline report embeds the rendering library', async () => {
  await page.check('#gpv-report-offline');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-report');
  const file = join(work, 'report-offline.html'); await (await download).saveAs(file);
  const html = await readFile(file, 'utf8');
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol/.test(html)) throw new Error('offline report still references the CDN');
  if (!/\$3Dmol/.test(html)) throw new Error('offline report has no embedded library');
  console.log('       offline report ' + (html.length / 1048576).toFixed(1) + ' MB');
  await page.uncheck('#gpv-report-offline');
});

let reportPath = null;
await step('an HTML report downloads', async () => {
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-report');
  reportPath = join(work, 'report.html');
  await (await download).saveAs(reportPath);
  const html = await readFile(reportPath, 'utf8');
  if (!/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol/.test(html)) throw new Error('report lost its 3Dmol tag');
  await writeFile(join(work, 'report-local.html'), html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol\/[^']+/, 'vendor/3Dmol-min.js'));
});

group('interface');
await step('"?" opens help and Escape closes it', async () => {
  await page.click('#gpv-stage'); await page.keyboard.press('?'); await page.waitForTimeout(500);
  if (!(await page.locator('#gpv-help').isVisible())) throw new Error('did not open');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  if (await page.locator('#gpv-help').isVisible()) throw new Error('did not close');
});
await step('typing "?" in a field does not open help', async () => {
  await tab('models');
  await page.click('#gpv-model-search');
  await page.keyboard.type('?ab'); await page.waitForTimeout(400);
  if (await page.locator('#gpv-help').isVisible()) throw new Error('help opened while typing');
  const value = await page.locator('#gpv-model-search').inputValue();
  if (value !== '?ab') throw new Error('field received "' + value + '"');
  await page.fill('#gpv-model-search', '');
});
await step('full screen toggles on and off', async () => {
  await page.click('#gpv-fullscreen'); await page.waitForTimeout(800);
  if (!(await page.locator('#gpv-view-grid.is-fullscreen').count())) throw new Error('did not enter');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  if (await page.locator('#gpv-view-grid.is-fullscreen').count()) throw new Error('did not leave');
});
await step('cycling keeps the button icon', async () => {
  await tab('models');
  await page.click('#gpv-cycle'); await page.waitForTimeout(1500);
  if (!(await page.locator('#gpv-cycle svg').count())) throw new Error('icon destroyed on start');
  if (!/Pause/.test(await page.locator('#gpv-cycle').textContent())) throw new Error('label did not change');
  await page.click('#gpv-cycle'); await page.waitForTimeout(400);
  if (!(await page.locator('#gpv-cycle svg').count())) throw new Error('icon destroyed on stop');
});
await step('an unrecognised fetch identifier is reported', async () => {
  await page.fill('#gpv-fetch-id', 'not an id!!');
  await page.click('#gpv-fetch'); await page.waitForTimeout(800);
  const status = await page.locator('#gpv-state').textContent();
  if (!/Enter a four-character/.test(status)) throw new Error('status: ' + status);
  await page.fill('#gpv-fetch-id', '');
});

group('generated report');
const reportErrors = [];
if (reportPath) {
  const report = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  report.on('pageerror', error => reportErrors.push('PAGEERROR: ' + error.message));
  report.on('console', message => {
    if (message.type() === 'error' && !/favicon|404/.test(message.text())) reportErrors.push(message.text());
  });
  await report.goto(base + '/report-local.html');
  await report.waitForTimeout(3000);
  await step('the report renders a canvas', async () => {
    if (!(await report.evaluate(() => Boolean(document.querySelector('#view .stage canvas'))))) throw new Error('no canvas');
  });
  await step('the report carries the provenance title', async () => {
    const title = await report.locator('#project-title').textContent();
    if (title !== 'Test figure') throw new Error('got ' + title);
  });
  await step('the report canvas stays inside its container', async () => {
    /* Regression: with a statically positioned #view, 3Dmol laid its absolutely
       positioned canvas out against the page and covered the whole toolbar. */
    const state = await report.evaluate(() => {
      const view = document.getElementById('view').getBoundingClientRect();
      const canvas = document.querySelector('#view .stage canvas');
      if (!canvas) return { ok: false, why: 'no canvas' };
      const box = canvas.getBoundingClientRect();
      const inside = box.top >= view.top - 2 && box.left >= view.left - 2
        && box.bottom <= view.bottom + 2 && box.right <= view.right + 2;
      const next = document.getElementById('next').getBoundingClientRect();
      const top = document.elementsFromPoint(next.x + next.width / 2, next.y + next.height / 2)[0];
      return { ok: inside, why: 'canvas escaped #view', top: top ? top.tagName : null };
    });
    if (!state.ok) throw new Error(state.why);
    if (state.top !== 'BUTTON') throw new Error('the Next button is covered by ' + state.top);
  });
  await step('a guided view sets the caption', async () => {
    await report.selectOption('#guided', '0'); await report.waitForTimeout(1000);
    if (await report.locator('#caption').isHidden()) throw new Error('caption hidden');
  });
  await step('report navigation works with a real click', async () => {
    const before = await report.locator('#position').textContent();
    await report.click('#next', { timeout: 15000 }); await report.waitForTimeout(800);
    const after = await report.locator('#position').textContent();
    if (before === after) throw new Error('position did not advance from ' + before);
    console.log('       ' + before.trim() + ' → ' + after.trim());
  });
  await step('report play and pause', async () => {
    await report.click('#play', { timeout: 15000 }); await report.waitForTimeout(600);
    if (!/Pause/.test(await report.locator('#play').textContent())) throw new Error('did not start');
    await report.click('#play', { timeout: 15000 }); await report.waitForTimeout(300);
  });
  await step('report element colouring is selectable', async () => {
    await report.selectOption('#colors', 'element'); await report.waitForTimeout(800);
  });
  await step('each report panel carries a sequence strip that zooms on click', async () => {
    const strips = await report.locator('#view .strip').count(); const paneCount = await report.locator('#view .pane').count();
    if (!strips || strips !== paneCount) throw new Error('strips=' + strips + ' panes=' + paneCount);
    const box = await report.locator('#view .strip').first().boundingBox();
    await report.mouse.move(box.x + box.width * 0.4, box.y + 6); await report.waitForTimeout(300);
    const readout = (await report.locator('#view .readout').first().textContent()) || '';
    if (!/ALA\d+/.test(readout)) throw new Error('readout: ' + readout);
    const before = await report.evaluate(() => document.querySelector('#view .stage canvas').toDataURL());
    await report.mouse.click(box.x + box.width * 0.4, box.y + 6); await report.waitForTimeout(900);
    const after = await report.evaluate(() => document.querySelector('#view .stage canvas').toDataURL());
    if (before === after) throw new Error('clicking the strip did not zoom the panel');
    console.log('       ' + readout.trim());
  });
  await step('the report offers per-residue data colouring with its legend', async () => {
    await report.selectOption('#colors', 'data'); await report.waitForTimeout(600);
    if (await report.locator('#domain-legend').isHidden()) throw new Error('data legend hidden');
    const text = (await report.locator('#domain-legend').textContent()) || '';
    if (!/No per-residue data|\d/.test(text)) throw new Error('legend text: ' + text);
    await report.selectOption('#colors', 'plddt'); await report.waitForTimeout(300);
  });
  await step('the report can colour by annotated domains and lists them', async () => {
    await report.selectOption('#colors', 'annotated'); await report.waitForTimeout(600);
    if (await report.locator('#domain-legend').isHidden()) throw new Error('domain legend hidden');
    const text = (await report.locator('#domain-legend').textContent()) || '';
    if (!/No annotated domains|[A-Za-z]/.test(text)) throw new Error('legend text: ' + text);
    await report.selectOption('#colors', 'plddt'); await report.waitForTimeout(300);
  });
  await step('the report offers residue themes and a ligand control', async () => {
    await report.selectOption('#colors', 'charge'); await report.waitForTimeout(600);
    await report.selectOption('#colors', 'ss'); await report.waitForTimeout(600);
    await report.selectOption('#hetero', 'hide'); await report.waitForTimeout(400);
    await report.selectOption('#hetero', 'stick'); await report.waitForTimeout(400);
    await report.selectOption('#colors', 'plddt'); await report.waitForTimeout(400);
  });
  await step('the report shows two panels that rotate together', async () => {
    await report.selectOption('#panels', '2'); await report.waitForTimeout(1500);
    if ((await report.locator('#view .stage canvas').count()) !== 2) throw new Error('expected two canvases');
    const before = await report.evaluate(() => document.querySelectorAll('#view .stage canvas')[1].toDataURL());
    const box = await report.locator('#view .stage canvas').first().boundingBox();
    await report.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await report.mouse.down();
    await report.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 10 }); await report.mouse.up();
    await report.waitForTimeout(900);
    const after = await report.evaluate(() => document.querySelectorAll('#view .stage canvas')[1].toDataURL());
    if (before === after) throw new Error('the second panel did not follow the drag');
    await report.click('#next', { timeout: 15000 }); await report.waitForTimeout(700);
    if (!/panel 1/.test(await report.locator('#position').textContent())) throw new Error('position lost its panel index');
  });
}

await step('print-size export writes 300 dpi into a PNG of the stated width', async () => {
  await tab('publish');
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85');
  await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '8'); await page.waitForTimeout(200);
  const estimate = (await page.locator('#gpv-export-estimate').textContent()) || '';
  if (!/1004 × 669 px · 85 × 57 mm at 300 dpi · text 8 pt/.test(estimate)) throw new Error('estimate: ' + estimate);
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-image');
  const file = join(work, 'print.png'); await (await download).saveAs(file);
  const png = await readFile(file);
  if (png.readUInt32BE(16) !== 1004 || png.readUInt32BE(20) !== 669) throw new Error('png size ' + png.readUInt32BE(16) + 'x' + png.readUInt32BE(20));
  const at = png.indexOf('pHYs');
  if (at < 0) throw new Error('no pHYs chunk');
  const perMetre = png.readUInt32BE(at + 4);
  if (Math.abs(perMetre - 11811) > 1 || png[at + 12] !== 1) throw new Error('pHYs ' + perMetre + ' unit ' + png[at + 12]);
  console.log('       ' + estimate.trim() + ' · pHYs ' + perMetre + ' px/m');
});
await step('the TIFF export is a baseline RGB TIFF with the resolution set', async () => {
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-tiff');
  const file = join(work, 'print.tiff'); await (await download).saveAs(file);
  const tiff = await readFile(file);
  if (tiff.toString('latin1', 0, 4) !== 'II*\u0000') throw new Error('not a little-endian TIFF');
  const ifd = tiff.readUInt32LE(4); const count = tiff.readUInt16LE(ifd);
  const tags = {}; for (let i = 0; i < count; i += 1) { const at = ifd + 2 + i * 12; tags[tiff.readUInt16LE(at)] = { type: tiff.readUInt16LE(at + 2), value: tiff.readUInt32LE(at + 8) }; }
  if (tags[256].value !== 1004 || tags[257].value !== 669) throw new Error('tiff size ' + tags[256].value + 'x' + tags[257].value);
  const dpi = tiff.readUInt32LE(tags[282].value) / tiff.readUInt32LE(tags[282].value + 4);
  if (dpi !== 300 || tags[296].value !== 2) throw new Error('resolution ' + dpi + ' unit ' + tags[296].value);
  console.log('       TIFF ' + tags[256].value + ' × ' + tags[257].value + ' at ' + dpi + ' dpi · ' + (tiff.length / 1048576).toFixed(1) + ' MB');
});
await step('a scale bar of known length appears in the figure SVG', async () => {
  await page.selectOption('#gpv-scale-bar', '20'); await page.waitForTimeout(400);
  if (await page.locator('#gpv-scalebar').isHidden()) throw new Error('on-screen scale bar hidden');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-svg');
  const file = join(work, 'scale.svg'); await (await download).saveAs(file);
  const svg = await readFile(file, 'utf8');
  if (!/id="scale-bar"/.test(svg) || !/20 Å/.test(svg)) throw new Error('scale bar missing from SVG');
  if (!/font-family="Arial, Helvetica, sans-serif"/.test(svg)) throw new Error('figure font not applied in SVG');
  await page.selectOption('#gpv-scale-bar', '0'); await page.waitForTimeout(300);
  await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
});
await step('all saved views download as a ZIP of print-size PNGs', async () => {
  if (await page.locator('#gpv-views-zip').isDisabled()) throw new Error('ZIP button disabled although views are saved');
  const download = page.waitForEvent('download', { timeout: 180000 });
  await page.click('#gpv-views-zip');
  const file = join(work, 'views.zip'); await (await download).saveAs(file);
  const zip = await readFile(file);
  if (zip.toString('latin1', 0, 2) !== 'PK') throw new Error('not a ZIP');
  if (!zip.includes('captions.txt') || !zip.includes('01-A-')) throw new Error('ZIP lacks expected entries');
  console.log('       views ZIP ' + (zip.length / 1024).toFixed(0) + ' KB');
});
await step('copying the PNG to the clipboard reports an outcome', async () => {
  await tab('publish');
  await page.click('#gpv-copy-image');
  await page.waitForFunction(() => !document.querySelector('#gpv-copy-image').disabled, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  const state = (await page.locator('#gpv-state').textContent()) || '';
  if (!/clipboard/i.test(state)) throw new Error('no clipboard outcome: ' + state);
  console.log('       ' + state.trim().slice(0, 80));
});
await step('the figure legend names the models and the colouring', async () => {
  await tab('publish');
  await page.click('#gpv-figure-legend'); await page.waitForTimeout(500);
  const text = await page.inputValue('#gpv-legend-text');
  if (!/representation of /.test(text) || !/coloured/.test(text)) throw new Error('legend text: ' + text.slice(0, 120));
  if (!/Rendered with Protein Structure Viewer \d+\.\d+\.\d+ \(3Dmol\.js; Rego & Koes, 2015\)\./.test(text)) throw new Error('citation sentence missing');
  if (!/model_/.test(text)) throw new Error('no model name in: ' + text.slice(0, 120));
  console.log('       ' + text.slice(0, 110).replace(/\s+/g, ' ') + '…');
});

group('session');
await step('reloading offers to restore the autosaved session', async () => {
  const models = await page.locator('#gpv-list [data-entry-id]').count();
  const labels = await page.locator('#gpv-label-list .gpv-entry').count();
  await page.waitForTimeout(2000);
  await page.reload(); await page.waitForTimeout(3000);
  if (await page.locator('#gpv-session-banner').isHidden()) throw new Error('restore banner not shown');
  const text = (await page.locator('#gpv-session-text').textContent()) || '';
  if (!new RegExp(models + ' models').test(text)) throw new Error('banner text: ' + text);
  await page.click('#gpv-session-yes'); await page.waitForTimeout(4000);
  const restored = await page.locator('#gpv-list [data-entry-id]').count();
  if (restored !== models) throw new Error('restored ' + restored + ' of ' + models + ' models');
  if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== labels) throw new Error('labels not restored');
  console.log('       ' + text.trim().slice(0, 60));
});

group('share links');
/* A minimal mmCIF built from the first fixture stands in for files.rcsb.org, so the
   fetch path and the share link round-trip run without network access. */
function cifFromPdb(text) {
  const rows = text.split('\n').filter(line => line.startsWith('ATOM')).map((line, index) => {
    const atom = line.slice(12, 16).trim(); const resn = line.slice(17, 20).trim(); const chain = line.slice(21, 22); const resi = line.slice(22, 26).trim();
    const x = line.slice(30, 38).trim(); const y = line.slice(38, 46).trim(); const z = line.slice(46, 54).trim(); const b = line.slice(60, 66).trim();
    return ['ATOM', index + 1, atom[0], atom, '.', resn, chain, '1', resi, '?', x, y, z, '1.00', b, resi, resn, chain, atom, '1'].join(' ');
  });
  const fields = ['group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id', 'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code', 'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv', 'auth_seq_id', 'auth_comp_id', 'auth_asym_id', 'auth_atom_id', 'pdbx_PDB_model_num'];
  return 'data_1TST\n#\nloop_\n' + fields.map(field => '_atom_site.' + field).join('\n') + '\n' + rows.join('\n') + '\n#\n';
}
const cifText = cifFromPdb(await readFile(models[0], 'utf8'));
const serveFetch = target => target.route('https://files.rcsb.org/**', route => route.fulfill({ status: 200, contentType: 'chemical/x-mmcif', body: cifText }));
await serveFetch(page);
await step('a model fetched by ID enables the share link', async () => {
  const before = await page.locator('#gpv-list [data-entry-id]').count();
  await page.fill('#gpv-fetch-id', '1tst'); await page.click('#gpv-fetch'); await page.waitForTimeout(2500);
  const after = await page.locator('#gpv-list [data-entry-id]').count();
  if (after !== before + 1) throw new Error('model count ' + before + ' → ' + after + ' · ' + (await page.locator('#gpv-state').textContent()));
  if (await page.locator('#gpv-share-link').isDisabled()) throw new Error('share link still disabled');
});
await step('the share link reopens the fetched model with its annotations', async () => {
  await tab('annotate');
  await page.fill('#gpv-screen-text', 'Shared panel'); await page.click('#gpv-add-screen-text'); await page.waitForTimeout(300);
  await tab('publish');
  await page.click('#gpv-share-link'); await page.waitForTimeout(1000);
  const link = await page.inputValue('#gpv-share-url');
  if (!/#scene=[zj]\./.test(link)) throw new Error('no scene token: ' + link.slice(0, 80));
  const shared = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  shared.on('pageerror', error => noteError('SHARED PAGEERROR: ' + error.message));
  shared.on('console', message => { if (message.type() === 'error' && !/favicon|404/.test(message.text())) noteError('shared: ' + message.text()); });
  await serveFetch(shared);
  await shared.goto(link); await shared.waitForTimeout(4000);
  const rows = await shared.locator('#gpv-list [data-entry-id]').count();
  if (rows !== 1) throw new Error('shared page lists ' + rows + ' models · ' + (await shared.locator('#gpv-state').textContent()));
  const texts = await shared.locator('#gpv-annotation-list input[type="text"]').evaluateAll(inputs => inputs.map(input => input.value));
  if (!texts.includes('Shared panel')) throw new Error('corner text missing from the shared page: ' + JSON.stringify(texts));
  console.log('       ' + (link.length / 1024).toFixed(1) + ' KB link · ' + ((await shared.locator('#gpv-state').textContent()) || '').trim());
  await shared.close();
});

await browser.close();
server.close();

console.log('\n' + '-'.repeat(52));
console.log('viewer console errors: ' + consoleErrors.length);
consoleErrors.slice(0, 10).forEach(error => console.log('  ! ' + error));
console.log('report console errors: ' + reportErrors.length);
reportErrors.slice(0, 10).forEach(error => console.log('  ! ' + error));
console.log('failed steps: ' + (failures.length ? failures.join(', ') : 'none'));
process.exit(failures.length || consoleErrors.length || reportErrors.length ? 1 : 0);
