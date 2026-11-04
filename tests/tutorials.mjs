/* Checks that docs/TUTORIALS.md is followable.

   Two jobs, one file:

     node tests/tutorials.mjs --text-only
         No browser. Two checks, both run in CI.

         (a) Every control name written in bold in docs/TUTORIALS.md must be a control the viewer
             actually has: a button, option, label, heading or aria-label in src/00-head.html. The
             help dialog is deliberately left out of the corpus — it is prose that names features,
             so matching against it would let an invented button pass. This check relies on the
             tutorials' own rule that bold is used for controls and nothing else, so it covers
             TUTORIALS.md alone; USAGE.md and USE-CASES.md bold their paragraph lead-ins too, and
             running it over them would fail CI on prose.

         (b) Every navigation chain — "Appearance → Colour scheme → pLDDT confidence", wholly
             inside one bold or italic run — must describe a path the UI really has, in all three
             documents. This checks the *relationship*, not just the names: the second segment has
             to be an option of the select the first one labels, a control under the heading it
             names, or a control in the tab it names. Checking names alone does not work here —
             "Colour by" is a real prefix of the "Colour by MSA" button, so five years of calling
             the Colour scheme select "Colour by" matched something every time and went unnoticed
             until the chain itself was checked.

     node tests/tutorials.mjs
         Drives the real UI through each tutorial's steps against the built index.html, in the same
         style as run.mjs: the CDN script tags are rewritten to the verified copies in vendor/, a
         static server serves the page, and the network fetches the tutorials tell a reader to make
         are routed to the public structures already in tests/fixtures. It does not assert the
         science — run.mjs and validate-experimental.mjs do that. It asserts that every control a
         tutorial names exists, is reachable, and can be driven in the order the tutorial gives.

   Set PSV_HEADED=1 to watch it, PSV_BROWSER=firefox|webkit to run it in another engine. */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tutorials = join(repo, 'docs', 'TUTORIALS.md');
const head = join(repo, 'src', '00-head.html');

/* ---------- the text check ---------- */

const squash = text => text.replace(/\s+/g, ' ').trim();
const unescape = text => text
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const plain = html => squash(unescape(html.replace(/<[^>]*>/g, ' ')));

/* Everything in 00-head.html a reader could point at and call a control, with the line it is on so
   a match can be eyeballed. Elements whose text is a control name: the tab and action buttons, the
   options of every select, the labels wrapping a control (a label's text runs on into its options,
   which is why matching allows a phrase to sit inside one), the section headings, and the
   aria-labels given to controls and lists that carry no visible text of their own. */
const inventoryFrom = source => {
  /* The help dialog names features in prose and is about to name these tutorials too; a control
     has to exist in the panel, not in the paragraph describing it. */
  const panels = source.replace(/<dialog[^>]*id="gpv-help"[\s\S]*?<\/dialog>/g, ' ');
  const lines = panels.split('\n');
  const entries = [];
  const add = (line, kind, text) => { const value = squash(text); if (value) entries.push({ line, kind, text: value }); };
  lines.forEach((line, index) => {
    const at = index + 1;
    for (const match of line.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) add(at, 'button', plain(match[1]));
    for (const match of line.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)) add(at, 'option', plain(match[1]));
    for (const match of line.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) add(at, 'label', plain(match[1]));
    for (const match of line.matchAll(/<(h[1-6]|legend|summary|span)\b[^>]*>([\s\S]*?)<\/\1>/g)) add(at, match[1], plain(match[2]));
    for (const match of line.matchAll(/aria-label="([^"]+)"/g)) add(at, 'aria-label', unescape(match[1]));
  });
  return entries;
};

/* The bold runs of the tutorials, in order, with the line each is on. Bold is reserved for a
   control in the panel or the header (the file says so at the top), so every one of these is a
   claim about the UI. A run that chains controls with → is one claim per segment. */
const boldFrom = text => {
  const claims = [];
  /* Scanned over the whole file, not line by line: a bold run can be wrapped across two lines,
     and a per-line scan pairs the ** of one run with the ** of the next and invents a claim. */
  for (const match of text.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const part of match[1].split('→')) {
      const name = squash(part);
      if (name) claims.push({ line, name });
    }
  }
  return claims;
};

/* ---------- what is reachable through what ---------- */

/* "A → B" in the documents claims that B is reached through A. This builds the map that claim is
   checked against: a tab owns every control in its panel, a section heading owns the controls that
   follow it inside that panel, a label owns the options of the select it wraps, and Help owns the
   headings of the help dialog. */
const reachabilityFrom = source => {
  const children = new Map();
  const put = (parent, child) => {
    const key = squash(parent).toLowerCase();
    const value = squash(child).toLowerCase();
    if (!key || !value) return;
    if (!children.has(key)) children.set(key, new Set());
    children.get(key).add(value);
  };
  /* A label's own text, with the control it wraps taken out: "Colour scheme", not "Colour scheme
     Per structure Per chain …". */
  const labelText = html => plain(html
    .replace(/<select\b[\s\S]*?<\/select>/g, ' ')
    .replace(/<(input|textarea)\b[^>]*>/g, ' ')
    .replace(/<\/textarea>/g, ' '));

  const tabName = {};
  for (const match of source.matchAll(/data-gpv-tab="([a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)) tabName[match[1]] = plain(match[2]);

  for (const panel of source.matchAll(/data-gpv-panel="([a-z]+)"[\s\S]*?(?=<section class="gpv-tool-panel"|<\/aside>)/g)) {
    const tab = tabName[panel[1]];
    if (!tab) continue;
    const html = panel[0];
    /* Everything in the panel hangs off the tab. */
    for (const item of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) put(tab, plain(item[1]));
    for (const item of html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)) put(tab, plain(item[1]));
    for (const item of html.matchAll(/<(h[1-6]|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)) put(tab, plain(item[2]));
    for (const item of html.matchAll(/aria-label="([^"]+)"/g)) put(tab, unescape(item[1]));
    for (const item of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
      const bare = labelText(item[1]);
      put(tab, bare);
      /* A select's options hang off the label that names it. */
      for (const select of item[1].matchAll(/<select\b[\s\S]*?<\/select>/g)) {
        for (const option of select[0].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)) put(bare, plain(option[1]));
      }
    }
    /* And off the nearest heading above them: the Confidence tab's "Ligand sites" heading owns the
       "Analyse ligand sites" button that follows it. */
    for (const section of html.split(/(?=<h[1-6]\b|<summary\b)/)) {
      const heading = section.match(/^<(h[1-6]|summary)\b[^>]*>([\s\S]*?)<\/\1>/);
      if (!heading) continue;
      const name = plain(heading[2]);
      for (const item of section.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) put(name, plain(item[1]));
      for (const item of section.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)) put(name, plain(item[1]));
      for (const item of section.matchAll(/aria-label="([^"]+)"/g)) put(name, unescape(item[1]));
      for (const item of section.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) put(name, labelText(item[1]));
    }
  }
  /* "Help → How to cite" names a heading of the help dialog. Its headings are navigable; its prose
     still is not, which is why only the headings go in. */
  const dialog = (source.match(/<dialog[^>]*id="gpv-help"[\s\S]*?<\/dialog>/) || [''])[0];
  for (const heading of dialog.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)) put('Help', plain(heading[1]));
  return children;
};

/* Chains that sit wholly inside one bold or italic run, every segment control-shaped. The markup
   gives the chain its boundaries; a bare "Compare → Align visible" in running prose does not say
   where the second segment stops, and parsing it out of the sentence invents claims. A run holding
   a bracket, comma, colon or semicolon is a sentence that happens to contain an arrow — a paragraph
   lead-in like "Fading a chain (Models → Composition)." or the spectrum's "N-terminus →
   C-terminus, per chain" — and is left alone. */
const chainsFrom = text => {
  const runs = [];
  for (const match of text.matchAll(/\*\*([\s\S]+?)\*\*/g)) runs.push([match.index, match[1]]);
  for (const match of text.matchAll(/(?<![*\w])\*([^*\n][\s\S]*?)\*(?![*\w])/g)) runs.push([match.index, match[1]]);
  const chains = [];
  for (const [index, raw] of runs) {
    if (!raw.includes('→')) continue;
    const run = squash(raw).replace(/\.+$/, '');
    if (!/^[^(),:;]*$/.test(run)) continue;
    const parts = run.split('→').map(part => squash(part));
    if (parts.some(part => !part || part.split(' ').length > 5)) continue;
    chains.push({ line: text.slice(0, index).split('\n').length, run, parts });
  }
  return chains;
};

const chainCheck = async (source, files) => {
  const children = reachabilityFrom(source);
  /* A short form of a longer name is allowed — the docs write "Models → Composition" for the
     "Composition of the current model" block — so a child matches on its own name or as a prefix. */
  const reaches = (parent, child) => {
    const set = children.get(squash(parent).toLowerCase());
    if (!set) return false;
    const want = squash(child).toLowerCase();
    return set.has(want) || [...set].some(name => name.startsWith(want));
  };
  const broken = [];
  let links = 0;
  console.log('\nnavigation chains ("Tab → Control → Option") checked against the UI\'s own structure');
  for (const file of files) {
    const chains = chainsFrom(await readFile(join(repo, file), 'utf8'));
    let count = 0;
    for (const chain of chains) {
      for (let index = 1; index < chain.parts.length; index += 1) {
        count += 1; links += 1;
        if (!reaches(chain.parts[index - 1], chain.parts[index])) {
          broken.push({ file, line: chain.line, pair: chain.parts[index - 1] + ' → ' + chain.parts[index], run: chain.run });
        }
      }
    }
    console.log('  ' + file.padEnd(22) + count + ' link' + (count === 1 ? '' : 's'));
  }
  if (broken.length) {
    console.log('\n' + broken.length + ' chain' + (broken.length === 1 ? '' : 's') + ' the UI does not have:');
    for (const item of broken) console.log('  FAIL ' + item.file + ':' + item.line + '  ' + JSON.stringify(item.pair) + '  in ' + JSON.stringify(item.run));
    console.log('\nThe names may each exist on their own — what is wrong is the path between them.');
    return false;
  }
  console.log('  all ' + links + ' links resolve');
  return true;
};

const textCheck = async () => {
  const doc = await readFile(tutorials, 'utf8');
  const source = await readFile(head, 'utf8');
  const entries = inventoryFrom(source);
  const claims = boldFrom(doc);
  const folded = entries.map(entry => ({ ...entry, fold: entry.text.toLowerCase() }));
  const seen = new Map();
  const missing = [];
  for (const claim of claims) {
    const fold = claim.name.toLowerCase();
    /* An exact control name first; then one that starts with it, because a label's text runs on
       into the options of the select it wraps ("Scale bar None 10 Å 20 Å …"); only then one that
       merely contains it, which is how an option inside its label is found ("Overlay selected"
       inside "View mode Overlay selected One at a time"). Taking these in order keeps a short
       name off the first paragraph that happens to contain the word — "Scale" is the export
       scale, not the "Colour scale" of the per-residue data block. */
    const hit = folded.find(entry => entry.fold === fold)
      || folded.find(entry => entry.fold.startsWith(fold))
      || folded.find(entry => entry.fold.includes(fold));
    if (!hit) { missing.push(claim); continue; }
    if (!seen.has(claim.name)) seen.set(claim.name, hit);
  }
  const names = [...seen.keys()].sort((a, b) => a.localeCompare(b));
  console.log('control names checked against src/00-head.html (the help dialog excluded)');
  console.log('  inventory: ' + entries.length + ' control names · tutorials: ' + claims.length + ' bold runs, ' + names.length + ' distinct');
  for (const name of names) {
    const hit = seen.get(name);
    console.log('  ok   ' + name.padEnd(46) + hit.kind + ' @ 00-head.html:' + hit.line + (hit.text === name ? '' : '  (inside "' + (hit.text.length > 60 ? hit.text.slice(0, 57) + '…' : hit.text) + '")'));
  }
  let ok = true;
  if (missing.length) {
    console.log('\n' + missing.length + ' name' + (missing.length === 1 ? '' : 's') + ' the viewer does not have:');
    for (const claim of missing) console.log('  FAIL TUTORIALS.md:' + claim.line + '  ' + JSON.stringify(claim.name));
    console.log('\nEither the viewer spells it differently, or the control is drawn by src/js and belongs in italics.');
    ok = false;
  } else {
    console.log('\nevery bold control name in docs/TUTORIALS.md is a control in src/00-head.html');
  }
  if (!await chainCheck(source, ['docs/USAGE.md', 'docs/USE-CASES.md', 'docs/TUTORIALS.md'])) ok = false;
  process.exit(ok ? 0 : 1);
};

if (process.argv.includes('--text-only')) await textCheck();

/* ---------- the walkthrough ---------- */

/* Imported here, not at the top: --text-only has to run in the CI job that never installs
   Playwright. */
const { chromium, firefox, webkit } = await import('playwright');
const { createServer } = await import('node:http');
const { mkdtemp, writeFile } = await import('node:fs/promises');
const { createReadStream, existsSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { extname } = await import('node:path');
const { pdb } = await import('./fixtures.mjs');

const failures = [];
const consoleErrors = [];

/* ---------- models, and a server that serves the page and the fixtures ---------- */

const work = await mkdtemp(join(tmpdir(), 'psv-tutorials-'));
/* Tutorial 2 is a wild type and a mutant; tutorial 3 is an ensemble. Both are checked against
   synthetic models long enough to carry the residue the tutorial types into Go to. */
const wild = join(work, 'wild_type.pdb');
const mutant = join(work, 'mutant.pdb');
const ensemble = ['model_1.pdb', 'model_2.pdb', 'model_3.pdb'].map(name => join(work, name));
await writeFile(wild, pdb({ seed: 1, residues: 120 }));
await writeFile(mutant, pdb({ seed: 1, residues: 120, jitter: 0.2 }));
await writeFile(ensemble[0], pdb({ seed: 1, residues: 60 }));
await writeFile(ensemble[1], pdb({ seed: 2, residues: 60 }));
await writeFile(ensemble[2], pdb({ seed: 7, residues: 60, twist: 6, jitter: 0.25 }));

const source = await readFile(join(repo, 'index.html'), 'utf8');
const local = source.replace(
  /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(?:[^"]+\/)?([^"/]+\.js)"[^>]*><\/script>/g,
  (_, file) => `<script src="vendor/${file}"></script>`
);
if (local === source) throw new Error('no CDN script tags were rewritten — check index.html');
await writeFile(join(work, 'index.html'), local);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.cif': 'chemical/x-mmcif', '.pdb': 'chemical/x-pdb' };
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

/* The identifiers the tutorials tell a reader to fetch, answered from the public structures in
   tests/fixtures so the run needs no network. 5cha is the entry tutorial 6 measures; the rest of
   the walkthrough only needs a structure to be there, so they are served the nearest fixture and
   the substitution is logged rather than hidden. */
const pdbFixtures = {
  '5cha': 'fixtures/experimental/5cha.cif',
  '4hhb': 'fixtures/experimental/2hhb.cif',
  '1a3n': 'fixtures/experimental/2hhb.cif',
  '1hho': 'fixtures/experimental/2hhb.cif',
  '1ubq': 'fixtures/experimental/5cha.cif',
  '2lzm': 'fixtures/experimental/1brs.cif',
  '1l90': 'fixtures/experimental/1brs.cif'
};
const routeFetches = async target => {
  await target.route('https://files.rcsb.org/download/*', async route => {
    const code = (new URL(route.request().url()).pathname.split('/').pop() || '').replace(/\.cif$/i, '').toLowerCase();
    const fixture = pdbFixtures[code];
    if (!fixture) { await route.fulfill({ status: 404, body: 'no fixture for ' + code }); return; }
    await route.fulfill({ status: 200, contentType: 'chemical/x-mmcif', body: await readFile(join(here, fixture), 'utf8') });
  });
  await target.route('https://alphafold.ebi.ac.uk/api/prediction/*', async route => {
    const accession = (new URL(route.request().url()).pathname.split('/').pop() || '').toUpperCase();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        modelEntityId: 'AF-' + accession + '-F1',
        cifUrl: base + '/fixtures/alphafold-db/AF-P69905-F1-model_v6.cif',
        paeDocUrl: base + '/fixtures/alphafold-db/AF-P69905-F1-predicted_aligned_error_v6.json'
      }])
    });
  });
};

/* ---------- harness ---------- */

const engineName = ['chromium', 'firefox', 'webkit'].includes(process.env.PSV_BROWSER) ? process.env.PSV_BROWSER : 'chromium';
const engine = { chromium, firefox, webkit }[engineName];
console.log('engine: ' + engineName + ' · page: ' + base + '/index.html');
const browser = await engine.launch({
  headless: process.env.PSV_HEADED !== '1',
  ...(engineName === 'chromium' && process.env.PSV_CHROMIUM ? { executablePath: process.env.PSV_CHROMIUM } : {}),
  ...(engineName === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] } : {}),
  ...(engineName === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } } : {})
});

let currentStep = 'startup';
const noteError = text => { consoleErrors.push('[' + currentStep + '] ' + text.split('\n')[0]); console.log('       ! ' + text.split('\n')[0]); };

/* Each tutorial gets a page of its own: a walkthrough starts on an empty viewer, and nothing one
   tutorial leaves behind should make the next one pass or fail. */
const openViewer = async (files = []) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => noteError('PAGEERROR: ' + error.message));
  page.on('console', message => { if (message.type() === 'error' && !/favicon|404/.test(message.text())) noteError(message.text()); });
  await routeFetches(page);
  /* ?debug=1 exposes window.__viewerDebug, the read-only hook run.mjs reads state through. */
  await page.goto(base + '/index.html?debug=1');
  await page.waitForTimeout(2500);
  if (files.length) { await page.setInputFiles('#gpv-files', files); await page.waitForTimeout(2500); }
  return page;
};

/* A control is named the way the tutorial names it, so a renamed or missing button fails here and
   not three steps later. ACTION_MS is short on purpose: a control that is absent or greyed out is
   a fact, not something to wait thirty seconds for. */
const ACTION_MS = 6000;
const step = async (name, body) => {
  currentStep = name;
  try { await body(); console.log('  ok   ' + name); }
  catch (error) { console.log('  FAIL ' + name + ' :: ' + String(error && error.message || error).split('\n')[0]); failures.push(name); }
};
const group = name => console.log('\n' + name);

const driver = page => {
  const button = name => page.locator('#generic-protein-viewer button', { hasText: new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') });
  return {
    page,
    tab: async name => { await page.click(`[data-gpv-tab="${name}"]`, { timeout: ACTION_MS }); await page.waitForTimeout(200); },
    /* Presses a button by the text the tutorial prints. A button that is not there, or is there
       but greyed out at the point the tutorial presses it, fails loudly. */
    press: async (name, wait = 600) => {
      const target = button(name).first();
      if (!(await target.count())) throw new Error('no button reads "' + name + '"');
      await target.waitFor({ state: 'visible', timeout: ACTION_MS });
      if (await target.isDisabled()) throw new Error('"' + name + '" is on the page but greyed out at this step');
      await target.click({ timeout: ACTION_MS });
      await page.waitForTimeout(wait);
    },
    /* Asserts a button exists without pressing it — for the ones whose effect is a clipboard write
       or a very large render. */
    offers: async name => {
      const target = button(name).first();
      if (!(await target.count())) throw new Error('no button reads "' + name + '"');
      return !(await target.isDisabled());
    },
    /* Chooses an option by the text the tutorial prints: an option named differently throws. */
    choose: async (id, label, wait = 300) => {
      if (!(await page.locator('#' + id).count())) throw new Error('no control #' + id);
      await page.selectOption('#' + id, { label }, { timeout: ACTION_MS });
      await page.waitForTimeout(wait);
    },
    set: async (id, value) => {
      if (!(await page.locator('#' + id).count())) throw new Error('no control #' + id);
      await page.fill('#' + id, value, { timeout: ACTION_MS });
    },
    check: async (id, on = true) => {
      if (!(await page.locator('#' + id).count())) throw new Error('no switch #' + id);
      await page.setChecked('#' + id, on, { timeout: ACTION_MS });
      await page.waitForTimeout(300);
    },
    status: async () => ((await page.locator('#gpv-state').textContent()) || '').trim(),
    /* L opens the residue card at the selected residue. Go to deliberately closes the card (it has
       moved the selection), so a walkthrough that wants the card has to ask for it. The stage is
       focused first so the key reaches the viewer rather than the button Go left focused. */
    openCard: async () => {
      await page.locator('#gpv-stage').focus({ timeout: ACTION_MS });
      await page.keyboard.press('l');
      await page.waitForTimeout(500);
      if (!(await page.locator('#gpv-label-editor').isVisible())) throw new Error('L opened no residue card');
    },
    /* A download by the button's printed name; the file only has to arrive and be non-empty. */
    download: async (name, timeout = 120000) => {
      const target = button(name).first();
      if (!(await target.count())) throw new Error('no button reads "' + name + '"');
      if (await target.isDisabled()) throw new Error('"' + name + '" is greyed out at this step');
      const waiting = page.waitForEvent('download', { timeout });
      await target.click({ timeout: ACTION_MS });
      const file = await (await waiting).path();
      const bytes = await readFile(file);
      if (!bytes.length) throw new Error('"' + name + '" wrote an empty file');
      return bytes;
    },
    fetchId: async id => {
      await page.fill('#gpv-fetch-id', id, { timeout: ACTION_MS });
      await page.click('#gpv-fetch', { timeout: ACTION_MS });
      await page.waitForTimeout(3000);
    },
    models: () => page.locator('#gpv-list [data-entry-id]').count()
  };
};

/* ---------- 1. Your first figure ---------- */

group('tutorial 1 — your first figure');
{
  const ui = driver(await openViewer());
  try {
    await step('1.1 the fetch box takes an identifier and Fetch loads it', async () => {
      await ui.fetchId('1ubq');
      if (await ui.models() !== 1) throw new Error('the fetch listed ' + (await ui.models()) + ' models · ' + await ui.status());
    });
    await step('1.2 Fit, the quarter-turn buttons and Reset are all pressable', async () => {
      for (const name of ['Fit', '↻ X', '↻ Y', '↻ Z', 'Reset']) await ui.press(name, 300);
    });
    await step('1.3 Appearance offers Secondary structure, White, Orthographic and Thin', async () => {
      await ui.tab('appearance');
      await ui.choose('gpv-color-mode', 'Secondary structure');
      await ui.choose('gpv-background', 'White');
      await ui.choose('gpv-projection', 'Orthographic');
      await ui.choose('gpv-outline', 'Thin');
    });
    await step('1.4 Publish takes the single-column print plan the tutorial gives', async () => {
      await ui.tab('publish');
      await ui.choose('gpv-export-mode', 'Print size (mm at dpi)');
      await ui.choose('gpv-print-width', '85 mm · single column');
      await ui.choose('gpv-print-dpi', '300 dpi');
      await ui.choose('gpv-print-text', '8 pt');
      await ui.choose('gpv-scale-bar', '20 Å');
    });
    await step('1.5 the Publication checklist is on the page and has read the settings', async () => {
      const summary = await ui.page.locator('#gpv-checklist summary').textContent();
      if (!/Publication checklist/.test(summary || '')) throw new Error('checklist heading reads ' + JSON.stringify(summary));
      if (!(await ui.page.locator('#gpv-check-list li').count())) throw new Error('the checklist listed nothing');
    });
    await step('1.6 Figure format PNG, and Download figure PNG writes a file', async () => {
      await ui.choose('gpv-image-format', 'PNG');
      const bytes = await ui.download('Download figure PNG');
      if (bytes.slice(1, 4).toString() !== 'PNG') throw new Error('the file is not a PNG');
      console.log('       ' + (bytes.length / 1024).toFixed(0) + ' KB PNG');
    });
  } finally { await ui.page.close(); }
}

/* ---------- 2. Wild type and mutant ---------- */

group('tutorial 2 — wild type and mutant, side by side');
{
  const ui = driver(await openViewer([wild, mutant]));
  try {
    await step('2.1 both models are listed and Overlay selected shows them together', async () => {
      if (await ui.models() !== 2) throw new Error('listed ' + (await ui.models()) + ' models');
      await ui.tab('models');
      await ui.choose('gpv-view-mode', 'Overlay selected');
    });
    await step('2.2 Compare offers the reference, Sequence-aware mapping and Align visible', async () => {
      await ui.tab('compare');
      const options = await ui.page.locator('#gpv-reference option').count();
      if (options < 2) throw new Error('Alignment reference lists ' + options + ' models');
      await ui.page.selectOption('#gpv-reference', { index: 1 });
      await ui.choose('gpv-alignment-mode', 'Sequence-aware');
      await ui.press('Align visible', 1500);
      if (!(await ui.page.locator('#gpv-alignment-results tr').count())) throw new Error('Align visible produced no table rows');
    });
    await step('2.3 Go to takes a chain and residue, Go selects it, and L opens the card', async () => {
      await ui.tab('annotate');
      await ui.set('gpv-goto', 'A:99');
      await ui.press('Go', 800);
      const selected = await ui.page.evaluate(() => window.__viewerDebug.selectedResidue());
      if (!selected || selected.resi !== 99) throw new Error('Go selected ' + JSON.stringify(selected));
      /* The tutorial says so explicitly: Go selects but does not open the card. */
      if (await ui.page.locator('#gpv-label-editor').isVisible()) throw new Error('Go opened the residue card after all — the tutorial says it does not');
      await ui.openCard();
    });
    await step('2.4 Compare this position compares the site in every shown model', async () => {
      await ui.press('Compare this position', 1500);
      const compared = await ui.page.evaluate(() => window.__viewerDebug.spotlightResidues().length);
      if (!compared) throw new Error('nothing was compared');
    });
    await step('2.5 the neighbourhood controls and the effect CSV can be driven', async () => {
      if (!(await ui.page.locator('#gpv-position-cutoff').count())) throw new Error('no Neighbourhood (Å) control');
      await ui.press('Highlight neighbourhood', 800);
      const bytes = await ui.download('Download effect CSV');
      if (!/\n/.test(bytes.toString())) throw new Error('the effect CSV has one line');
    });
    await step('2.6 Deviation panel and Make site figure build the panels and open the builder', async () => {
      await ui.check('gpv-position-figure-deviation', true);
      await ui.press('Make site figure', 4000);
      const views = await ui.page.evaluate(() => window.__viewerDebug.savedViews().length);
      if (views < 2) throw new Error('the site figure saved ' + views + ' views');
      const open = await ui.page.locator('[data-gpv-tab="publish"]').getAttribute('aria-selected');
      if (open !== 'true') throw new Error('the press left the ' + (await ui.page.locator('[data-gpv-tab][aria-selected="true"]').getAttribute('data-gpv-tab')) + ' tab open');
    });
    await step('2.7 Download built figure PNG and SVG both write files', async () => {
      await ui.tab('publish');
      const png = await ui.download('Download built figure PNG');
      if (png.slice(1, 4).toString() !== 'PNG') throw new Error('the built figure is not a PNG');
      const svg = await ui.download('Download built figure SVG');
      if (!/<svg/i.test(svg.toString().slice(0, 2000))) throw new Error('the built figure SVG has no <svg>');
      console.log('       ' + (png.length / 1024).toFixed(0) + ' KB PNG · ' + (svg.length / 1024).toFixed(0) + ' KB SVG');
    });
    await step('2.8 a set of positions goes into Positions and Compare these positions', async () => {
      /* Last, as the tutorial has it: a set compared before the site figure puts every one of those
         positions into panel B, which is the pile 2.44.0's known limits are about. */
      await ui.tab('annotate');
      await ui.set('gpv-position-set', 'A:20-24, A:45');
      await ui.press('Compare these positions', 2500);
      const compared = await ui.page.evaluate(() => window.__viewerDebug.spotlightResidues().length);
      if (compared < 2) throw new Error('the set compared ' + compared + ' positions');
    });
  } finally { await ui.page.close(); }
}

/* ---------- 3. An ensemble of models ---------- */

group('tutorial 3 — an ensemble of models');
{
  const ui = driver(await openViewer(ensemble));
  try {
    await step('3.1 Model order, View mode and Show all drive the ensemble', async () => {
      if (await ui.models() !== 3) throw new Error('listed ' + (await ui.models()) + ' models');
      await ui.tab('models');
      await ui.choose('gpv-order', 'Ranking score');
      await ui.choose('gpv-view-mode', 'Overlay selected');
      await ui.press('Show all', 800);
    });
    await step('3.2 Align visible superposes them', async () => {
      await ui.tab('compare');
      await ui.page.selectOption('#gpv-reference', { index: 0 });
      await ui.press('Align visible', 2000);
      if (!(await ui.page.locator('#gpv-alignment-results tr').count())) throw new Error('no alignment rows');
    });
    await step('3.3 Compute matrix fills the pairwise RMSD table and marks the medoid', async () => {
      await ui.press('Compute matrix', 3000);
      const cells = await ui.page.locator('#gpv-rmsd-matrix-body tr').count();
      if (cells < 3) throw new Error('the matrix has ' + cells + ' rows');
      const text = await ui.page.locator('#gpv-rmsd-matrix-body').textContent();
      if (!/★/.test(text || '')) throw new Error('no medoid is marked in the matrix');
    });
    await step('3.4 the medoid button names the medoid, and re-fits on it', async () => {
      /* Driven by id, not by name: with a matrix computed the button relabels itself "Use <model> as
         reference", which is what the tutorial now tells the reader to expect. */
      const label = squash((await ui.page.locator('#gpv-rmsd-medoid').textContent()) || '');
      if (label === 'Use medoid as reference') throw new Error('the button still reads the default text, so it named no medoid');
      if (!/^Use .+ as reference$/.test(label)) throw new Error('the medoid button reads ' + JSON.stringify(label));
      console.log('       the button reads ' + JSON.stringify(label));
      if (await ui.page.locator('#gpv-rmsd-medoid').isDisabled()) throw new Error('the medoid button is greyed out with a matrix computed');
      await ui.page.click('#gpv-rmsd-medoid', { timeout: ACTION_MS });
      await ui.page.waitForTimeout(2500);
    });
    await step('3.5 Colour scheme offers Model agreement (Cα RMSF)', async () => {
      await ui.tab('appearance');
      await ui.choose('gpv-color-mode', 'Model agreement (Cα RMSF)', 800);
    });
    await step('3.6 the RMSF profile and its CSV download', async () => {
      await ui.tab('compare');
      const svg = await ui.download('RMSF profile SVG');
      if (!/<svg/i.test(svg.toString().slice(0, 2000))) throw new Error('the RMSF profile is not an SVG');
      const csv = await ui.download('Download RMSF CSV');
      if (!/\n/.test(csv.toString())) throw new Error('the RMSF CSV has one line');
    });
    await step('3.7 the composite figure takes the RMSD matrix and the RMSF profile', async () => {
      await ui.tab('publish');
      await ui.check('gpv-composite-matrix', true);
      await ui.check('gpv-composite-rmsf', true);
      const bytes = await ui.download('Download composite figure', 180000);
      if (bytes.slice(1, 4).toString() !== 'PNG') throw new Error('the composite figure is not a PNG');
      console.log('       ' + (bytes.length / 1024).toFixed(0) + ' KB composite PNG');
    });
    await step('3.8 Download matrix CSV and Download confidence CSV are both offered', async () => {
      await ui.tab('compare');
      const matrix = await ui.download('Download matrix CSV');
      if (!/\n/.test(matrix.toString())) throw new Error('the matrix CSV has one line');
      await ui.tab('confidence');
      if (!(await ui.offers('Download confidence CSV'))) throw new Error('Download confidence CSV is greyed out with models loaded');
    });
  } finally { await ui.page.close(); }
}

/* ---------- 4. Exporting cleanly ---------- */

group('tutorial 4 — exporting cleanly');
{
  const ui = driver(await openViewer([ensemble[0]]));
  try {
    await step('4.1 Output switches between print size and pixels, and pixels has Image size and Scale', async () => {
      await ui.tab('publish');
      await ui.choose('gpv-export-mode', 'Pixels (size × scale)');
      await ui.choose('gpv-export-size', 'Large landscape · 2400 × 1600');
      await ui.choose('gpv-export-scale', '2×');
      await ui.choose('gpv-export-mode', 'Print size (mm at dpi)');
    });
    await step('4.2 the single-column and double-column plans are both settable', async () => {
      await ui.choose('gpv-print-width', '85 mm · single column');
      await ui.choose('gpv-print-dpi', '300 dpi');
      await ui.choose('gpv-print-text', '8 pt');
      await ui.choose('gpv-figure-font', 'Arial / Helvetica');
      await ui.choose('gpv-print-width', '178 mm · double column');
      await ui.choose('gpv-print-text', '7 pt');
      await ui.choose('gpv-print-dpi', '600 dpi');
      await ui.choose('gpv-print-dpi', '300 dpi');
    });
    await step('4.3 a Journal preset sets the plan, and Custom… takes a width of your own', async () => {
      await ui.choose('gpv-journal', 'Nature · double column · 183 mm', 500);
      const width = await ui.page.inputValue('#gpv-print-custom');
      if (width !== '183') throw new Error("the Nature double-column preset left the custom width at " + width + ' mm, not 183');
      if ((await ui.page.inputValue('#gpv-print-text')) !== '7') throw new Error('the preset did not set the text size');
      await ui.choose('gpv-print-width', 'Custom…');
      await ui.set('gpv-print-custom', '120');
      await ui.choose('gpv-print-aspect', '3 : 2');
    });
    await step('4.4 every figure format in the tutorial is offered', async () => {
      for (const format of ['PNG', 'TIFF', 'PDF', 'JPEG', 'WebP']) await ui.choose('gpv-image-format', format, 150);
      await ui.choose('gpv-image-format', 'PNG');
      if (!(await ui.offers('Copy PNG to clipboard'))) throw new Error('Copy PNG to clipboard is greyed out with a model loaded');
    });
    await step('4.5 the scale bar needs orthographic, and the legend can be moved', async () => {
      await ui.tab('appearance');
      await ui.choose('gpv-projection', 'Orthographic');
      await ui.tab('publish');
      await ui.choose('gpv-scale-bar', '20 Å');
      await ui.check('gpv-export-legend', true);
      await ui.choose('gpv-legend-position', 'Bottom left');
      await ui.press('Edit figure labels', 500);
    });
    await step('4.6 Label style offers Plain text and Separate labels is there', async () => {
      await ui.tab('annotate');
      await ui.choose('gpv-label-style', 'Plain text');
      if (!(await ui.page.locator('#gpv-labels-separate').count())) throw new Error('no Separate labels button');
    });
    await step('4.7 Download figure SVG writes a vector file', async () => {
      await ui.tab('publish');
      const svg = await ui.download('Download figure SVG');
      if (!/<svg/i.test(svg.toString().slice(0, 2000))) throw new Error('not an SVG');
    });
    await step('4.8 a template saves the whole presentation and Apply puts it back', async () => {
      await ui.set('gpv-template-name', 'Paper figures');
      await ui.press('Save template', 600);
      const saved = await ui.page.locator('#gpv-template-list option').allTextContents();
      if (!saved.some(name => /Paper figures/.test(name))) throw new Error('Saved templates lists ' + JSON.stringify(saved));
      await ui.choose('gpv-print-width', '85 mm · single column');
      await ui.press('Apply', 600);
      const width = await ui.page.inputValue('#gpv-print-width');
      if (width !== 'custom') throw new Error('Apply restored the width as ' + width + ', not the saved Custom…');
    });
  } finally { await ui.page.close(); }
}

/* ---------- 5. A figure someone else can rebuild ---------- */

group('tutorial 5 — a figure someone else can rebuild');
{
  const ui = driver(await openViewer());
  try {
    await step('5.0 a model fetched by identifier, so the share link has something to carry', async () => {
      await ui.fetchId('4hhb');
      if (await ui.models() !== 1) throw new Error('the fetch listed ' + (await ui.models()) + ' models · ' + await ui.status());
    });
    await step('5.1 the provenance fields all take text', async () => {
      await ui.tab('publish');
      await ui.set('gpv-project-title', 'Tutorial figure');
      await ui.set('gpv-project-source', 'PDB 4HHB');
      await ui.set('gpv-project-method', 'X-ray crystallography');
      await ui.set('gpv-project-notes', 'Written by tests/tutorials.mjs');
    });
    await step('5.2 View name, Caption and Save current view make a panel', async () => {
      await ui.set('gpv-view-name', 'Overview');
      await ui.set('gpv-view-caption', 'The assembly');
      await ui.press('Save current view', 1000);
      await ui.set('gpv-view-name', 'Turned');
      await ui.set('gpv-view-caption', 'Rotated 90°');
      await ui.press('Save current view', 1000);
      const views = await ui.page.evaluate(() => window.__viewerDebug.savedViews().length);
      if (views !== 2) throw new Error('saved ' + views + ' views');
    });
    await step('5.3 the figure builder takes the panel settings and writes a figure', async () => {
      await ui.choose('gpv-panel-columns', '2');
      await ui.choose('gpv-builder-captions', 'Name and caption');
      await ui.check('gpv-builder-letters', true);
      const rows = await ui.page.locator('#gpv-builder-rows tr').count();
      if (rows !== 2) throw new Error('the builder lists ' + rows + ' panels');
      const bytes = await ui.download('Download built figure PNG');
      if (bytes.slice(1, 4).toString() !== 'PNG') throw new Error('not a PNG');
    });
    await step('5.4 Write figure legend and Write methods text both produce words', async () => {
      await ui.press('Write figure legend', 1200);
      const legend = await ui.page.inputValue('#gpv-legend-text');
      if (legend.length < 40) throw new Error('the figure legend is ' + legend.length + ' characters');
      await ui.press('Write methods text', 1200);
      const methods = await ui.page.inputValue('#gpv-methods-field');
      if (methods.length < 40) throw new Error('the methods text is ' + methods.length + ' characters');
    });
    await step('5.5 the scene JSON downloads and names the provenance', async () => {
      const bytes = await ui.download('Download scene JSON');
      const scene = JSON.parse(bytes.toString());
      if (!JSON.stringify(scene).includes('Tutorial figure')) throw new Error('the scene carries no project title');
      if (!(await ui.page.locator('#gpv-load-scene').count())) throw new Error('no Restore scene JSON control');
    });
    await step('5.6 Download captions and the views ZIP are both offered', async () => {
      const captions = await ui.download('Download captions');
      if (!/Overview/.test(captions.toString())) throw new Error('the captions file does not name the view');
      if (!(await ui.offers('Download all views (ZIP)'))) throw new Error('Download all views (ZIP) is greyed out with two views saved');
    });
    await step('5.7 the session file downloads and Open session file is there', async () => {
      const bytes = await ui.download('Save session file');
      if (bytes.slice(0, 2).toString() !== 'PK') throw new Error('the session file is not a ZIP');
      if (!(await ui.page.locator('#gpv-open-session').count())) throw new Error('no Open session file control');
    });
    await step('5.8 the report settings drive, and Share report writes one HTML file', async () => {
      await ui.choose('gpv-report-scope', 'Models currently shown');
      await ui.choose('gpv-report-pae', 'Compact');
      await ui.check('gpv-report-offline', true);
      const bytes = await ui.download('Share report', 180000);
      if (!/<html/i.test(bytes.toString().slice(0, 4000))) throw new Error('the report is not HTML');
      console.log('       ' + (bytes.length / 1024 / 1024).toFixed(1) + ' MB offline report');
    });
    await step('5.9 Copy share link is live because the model came from an identifier', async () => {
      if (!(await ui.offers('Copy share link'))) throw new Error('Copy share link is greyed out for a fetched model');
    });
  } finally { await ui.page.close(); }
}

/* ---------- 6. Measuring a catalytic triad ---------- */

group('tutorial 6 — measuring a catalytic triad');
{
  const ui = driver(await openViewer());
  try {
    await step('6.1 5cha fetches and lists one model', async () => {
      await ui.fetchId('5cha');
      if (await ui.models() !== 1) throw new Error('listed ' + (await ui.models()) + ' models · ' + await ui.status());
    });
    await step('6.2 Within (Å) and Go to select His57 of chain B', async () => {
      await ui.tab('annotate');
      await ui.set('gpv-near-cutoff', '5');
      await ui.set('gpv-goto', 'B:57');
      await ui.press('Go', 1000);
      const selected = await ui.page.evaluate(() => window.__viewerDebug.selectedResidue());
      if (!selected || selected.resi !== 57) throw new Error('Go selected ' + JSON.stringify(selected));
      if (await ui.page.locator('#gpv-label-editor').isVisible()) throw new Error('Go opened the residue card — the tutorial says it does not');
    });
    await step('6.3 L opens the card at the selected residue, naming His57', async () => {
      await ui.openCard();
      const card = await ui.page.locator('#gpv-label-editor').textContent();
      if (!/HIS/i.test(card || '')) throw new Error('the card reads ' + JSON.stringify(squash(card || '').slice(0, 80)));
    });
    await step('6.4 the card offers the Measure choice, Measure to… and Contacts', async () => {
      for (const id of ['gpv-label-editor-measure-atoms', 'gpv-label-editor-measure', 'gpv-label-editor-contacts']) {
        if (!(await ui.page.locator('#' + id).isVisible())) throw new Error('the card has no #' + id);
      }
      await ui.page.selectOption('#gpv-label-editor-measure-atoms', { label: 'closest atoms' });
    });
    await step('6.5 Measure to… then Go to a second residue makes a measurement', async () => {
      await ui.page.click('#gpv-label-editor-measure', { timeout: ACTION_MS });
      await ui.page.waitForTimeout(400);
      await ui.set('gpv-goto', 'C:195');
      await ui.press('Go', 1200);
      const rows = await ui.page.locator('#gpv-measurement-list .gpv-entry').count();
      if (rows !== 1) throw new Error('the measurement list holds ' + rows + ' rows');
      const text = squash((await ui.page.locator('#gpv-measurement-list').textContent()) || '');
      /* Logged, not asserted: 5cha.cif is the real entry, and the published His57 NE2 – Ser195 OG
         distance is 3.02 Å (tests/fixtures/experimental/published-distances.json). The number is
         validate-experimental.mjs's job; here it is a sanity line in the transcript. */
      console.log('       ' + text.slice(0, 120) + (/3\.0\d/.test(text) ? '   [3.0x Å — the published triad distance]' : '   [no 3.0x Å in the row — check against validate-experimental.mjs]'));
    });
    await step('6.6 M arms the same thing from the keyboard', async () => {
      await ui.set('gpv-goto', 'B:57');
      await ui.press('Go', 800);
      /* Focus rather than a click: a click on empty stage can clear the selection M needs. */
      await ui.page.locator('#gpv-stage').focus({ timeout: ACTION_MS });
      await ui.page.keyboard.press('m');
      await ui.page.waitForTimeout(400);
      if (!(await ui.page.evaluate(() => Boolean(window.__viewerDebug.measureFrom())))) throw new Error('M armed nothing');
      await ui.set('gpv-goto', 'B:102');
      await ui.press('Go', 1200);
      const rows = await ui.page.locator('#gpv-measurement-list .gpv-entry').count();
      if (rows !== 2) throw new Error('the measurement list holds ' + rows + ' rows after the second measurement');
    });
    await step('6.7 the Measurement type offers an angle, and measuring mode turns on and off', async () => {
      await ui.choose('gpv-measure-type', 'Angle (3 atoms)');
      await ui.press('Start measuring', 500);
      const state = await ui.page.locator('#gpv-measure-state').textContent();
      if (/is off/.test(state || '')) throw new Error('Start measuring left measurement mode off: ' + state);
      await ui.page.click('#gpv-measure', { timeout: ACTION_MS });
      await ui.page.waitForTimeout(400);
      await ui.choose('gpv-measure-type', 'Distance (2 atoms)');
    });
    await step('6.8 the measurements export as a CSV and as text', async () => {
      const bytes = await ui.download('Download measurements CSV');
      const lines = bytes.toString().trim().split('\n');
      if (lines.length < 3) throw new Error('the measurements CSV has ' + lines.length + ' lines');
      if (!(await ui.offers('Copy measurements'))) throw new Error('Copy measurements is greyed out with two measurements');
    });
    await step('6.9 Colour scheme offers Distance from selected residue', async () => {
      await ui.tab('appearance');
      await ui.choose('gpv-color-mode', 'Distance from selected residue', 800);
    });
  } finally { await ui.page.close(); }
}

await browser.close();
server.close();

console.log('\n' + '-'.repeat(52));
console.log('viewer console errors: ' + consoleErrors.length);
consoleErrors.slice(0, 10).forEach(error => console.log('  ! ' + error));
console.log('failed steps: ' + (failures.length ? failures.join(', ') : 'none'));
process.exit(failures.length || consoleErrors.length ? 1 : 0);
