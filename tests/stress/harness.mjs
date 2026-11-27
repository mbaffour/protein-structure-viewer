/* Exploratory stress harness for the Protein Structure Viewer.
   Serves a built index.html (3Dmol from tests/vendor, no network) and opens it with every console
   error, page error, failed request and dialog recorded. An exploring agent writes short scripts of
   its own (outside the repo) that import this file:

     import { openViewer } from '<repo>/tests/stress/harness.mjs';
     const v = await openViewer({ html, browser: 'chromium', viewport: { width: 1400, height: 900 } });
     await v.load([v.fixture('experimental/5cha.cif')]);        // one or more files into #gpv-files
     … drive v.page …
     console.log(JSON.stringify(v.errors(), null, 1));          // what went wrong so far
     await v.close();

   `html` names a frozen copy of the build, so one round tests one build; without it the repo's own
   index.html is served. Run scripts from tests/ with NODE_PATH="$(pwd)/node_modules" so Playwright
   resolves. The page opens with ?debug=1, so window.__viewerDebug is there (src/js/43-tips.js lists
   its hooks). v.fixture(name) is a path under tests/fixtures; v.synthetic(name, options) writes a
   synthetic two-chain PDB from tests/fixtures.mjs (options: seed, residues, twist, jitter).
   acceptDialogs: true answers confirm() with OK (the default cancels it, and records it either way).
   See tests/stress/BRIEF.md for what an exploring agent is asked to do. */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engines = { chromium, firefox, webkit };
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function openViewer({ html = null, browser = 'chromium', viewport = { width: 1400, height: 900 }, colorScheme = 'light', headless = true, deviceScaleFactor = 1, acceptDialogs = false } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'psv-stress-'));
  const source = await readFile(html || join(here, '..', 'index.html'), 'utf8');
  const local = source.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g, (_, file) => `<script src="vendor/${file}"></script>`);
  await writeFile(join(work, 'index.html'), local);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.cif': 'text/plain', '.pdb': 'text/plain', '.zip': 'application/zip' };
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = [work, here].map(root => resolve(root, name)).find(candidate => existsSync(candidate));
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const launch = browser === 'chromium' ? { headless, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] } : { headless };
  const instance = await engines[browser].launch(launch);
  const context = await instance.newContext({ viewport, colorScheme, deviceScaleFactor, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  /* SwiftShader's GL driver chatter is not the app's. */
  const noise = /GL Driver Message|GPU stall due to ReadPixels/;
  page.on('console', message => { if ((message.type() === 'error' || message.type() === 'warning') && !noise.test(message.text())) errors.push({ kind: 'console.' + message.type(), text: message.text().slice(0, 400), at: new Date().toISOString() }); });
  page.on('pageerror', error => errors.push({ kind: 'pageerror', text: String(error && error.stack || error).slice(0, 600), at: new Date().toISOString() }));
  page.on('requestfailed', request => errors.push({ kind: 'requestfailed', text: request.url() + ' ' + (request.failure() || {}).errorText, at: new Date().toISOString() }));
  page.on('dialog', dialog => { errors.push({ kind: 'dialog', text: dialog.type() + ': ' + dialog.message() }); (acceptDialogs ? dialog.accept() : dialog.dismiss()).catch(() => {}); });
  const url = `http://127.0.0.1:${server.address().port}/index.html?debug=1`;
  await page.goto(url); await page.waitForTimeout(2500);
  const fixturesModule = await import(pathToFileURL(join(here, 'fixtures.mjs')).href);
  return {
    page, context, browser: instance, server, work, url, engine: browser,
    fixture: name => join(here, 'fixtures', name),
    async synthetic(name, options = {}) { const file = join(work, name.endsWith('.pdb') ? name : name + '.pdb'); await writeFile(file, fixturesModule.pdb(options)); return file; },
    async load(files, settle = 3000) { await page.click('[data-gpv-tab="models"]'); await page.setInputFiles('#gpv-files', files); await page.waitForTimeout(settle); },
    tab: name => page.click(`[data-gpv-tab="${name}"]`),
    status: async () => ((await page.locator('#gpv-state').textContent()) || '').trim(),
    debug: expression => page.evaluate(expression),
    errors: () => errors.slice(),
    /* Marks the point an exploration reached, so a crash afterwards can be placed. */
    mark: label => errors.push({ kind: 'mark', text: label, at: new Date().toISOString() }),
    shot: path => page.screenshot({ path, fullPage: false }),
    async close() { await instance.close(); server.close(); }
  };
}
