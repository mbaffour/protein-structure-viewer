/* Headless regression suite for the Protein Structure Viewer.
   Serves a copy of ../index.html with the CDN script tags rewritten to the
   locally verified copies in vendor/ (see vendor.mjs), then drives the real UI.

   Usage:  npm install && npm test
   Set PSV_HEADED=1 to watch it run. */
import { chromium, firefox, webkit } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
  ...(engineName === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] } : {}),
  /* Headless Firefox on a Linux runner refuses to create a WebGL context unless forced; the
     workflow additionally runs Firefox headed under Xvfb (PSV_HEADED=1). */
  ...(engineName === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } } : {})
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let currentStep = 'startup';
const noteError = text => { consoleErrors.push(text); console.log('       ! [' + currentStep + '] ' + text.split('\n')[0]); };
page.on('pageerror', error => noteError('PAGEERROR: ' + error.message));
page.on('console', message => {
  /* The static server has no favicon; that 404 is the harness, not the page. */
  if (message.type() === 'error' && !/favicon|404/.test(message.text())) noteError(message.text());
});

/* A step that fails only because Playwright timed out waiting for the page (a slow CI runner,
   not a wrong answer) is retried once; the retry is logged loudly so a flaky step still shows
   up in the transcript. Assertion failures are never retried. */
const isTimeout = error => error && (error.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(String(error.message)));
let retries = 0;
/* A download or event promise created before a click that then times out rejects with nobody
   awaiting it; Node would abort the whole run. Log it against the current step and carry on. */
process.on('unhandledRejection', error => { console.log('  !    unhandled rejection during [' + currentStep + ']: ' + String(error && error.message || error).split('\n')[0]); });

/* ---------- a safety net under each step's own finally ---------- */

/* Every stateful step captures what it changes and puts it back in its own `finally`; that
   stays the primary mechanism and nothing below replaces it. But a step that hangs never
   reaches its finally — the cleanup times out too — and the leftovers then fail every later
   step that counts models, strip rows or compared positions, so one hung step is reported as
   ten. After a step FAILS (after the existing retry, which is unchanged) the harness puts the
   page back to a baseline captured once the fixtures were in, so the next step starts from the
   state it expects.

   Rules this obeys: it only ever restores *state*, never re-runs an assertion and never takes a
   name out of `failures`, so a genuinely broken viewer still goes red. Every action is
   individually guarded and given its own deadline, and the whole recovery has a hard cap, so
   recovery can never hang the run the way the step it is cleaning up after did. */
const ACTION_MS = 3000;    /* one recovery action — a click, a read, one control put back */
const RECOVERY_MS = 25000; /* the whole recovery, however many actions are left undone */
let baseline = null;          /* the state every later step assumes; see captureBaseline */
let steps = 0, recoveries = 0, incompleteRecoveries = 0, recoveryMs = 0, baselineMs = 0, markMs = 0;
let suspectSince = null;      /* the step after which a recovery could not finish */
const suspect = [];           /* steps that failed while that was true — their failures are not trustworthy */

/* Runs fn with its own deadline and never throws: the caller gets {ok} either way. Both
   branches of the race are handled, so a slow action that rejects after its deadline does not
   land in the unhandledRejection handler above. */
const guard = async (fn, ms) => {
  let timer = null;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('gave up after ' + ms + ' ms')), ms); })
    ]);
    return { ok: true, value };
  } catch (error) { return { ok: false, error: String(error && error.message || error).split('\n')[0] }; }
  finally { if (timer) clearTimeout(timer); }
};

/* The lists steps pile things into. Each is cleared by the app's own button where there is one;
   `#gpv-saved-views` has only a per-row Remove, and rows are removed from the end. */
const collections = [
  { key: 'positions', one: 'compared position', many: 'compared positions', tab: 'annotate', clear: '#gpv-position-clear', rows: null },
  { key: 'labels', one: 'label', many: 'labels', tab: 'annotate', clear: '#gpv-clear-labels', rows: '#gpv-label-list .gpv-entry' },
  { key: 'selections', one: 'selection', many: 'selections', tab: 'annotate', clear: '#gpv-clear-selections', rows: '#gpv-selection-list .gpv-entry' },
  { key: 'measurements', one: 'measurement', many: 'measurements', tab: 'annotate', clear: '#gpv-clear-measurements', rows: '#gpv-measurement-list .gpv-entry' },
  { key: 'annotations', one: 'annotation', many: 'annotations', tab: 'annotate', clear: '#gpv-clear-annotations', rows: '#gpv-annotation-list .gpv-entry' },
  { key: 'domains', one: 'named domain', many: 'named domains', tab: 'annotate', clear: '#gpv-clear-domains', rows: '#gpv-domain-list .gpv-entry' },
  { key: 'panels', one: 'comparison panel', many: 'comparison panels', tab: 'compare', clear: '#gpv-clear-panels', rows: '#gpv-compare-panels .gpv-entry' },
  { key: 'views', one: 'saved view', many: 'saved views', tab: 'publish', clear: null, rows: '#gpv-saved-views .gpv-entry' }
];

/* One round trip for everything recovery compares: which models are loaded and shown, which tab
   is open, how much each accumulating list holds, and the value of every control in the panel.
   Read through the app's own debug getters where they exist and off the rendered rows and
   controls where they do not. Controls are enumerated from the DOM rather than listed here, so
   one added to the viewer is covered without touching this file; the file picker cannot be
   written back and a read-only field is not a setting. */
const readSnapshot = () => page.evaluate(() => {
  const debug = window.__viewerDebug;
  const rows = selector => document.querySelectorAll(selector).length;
  const open = document.querySelector('[data-gpv-tab][aria-selected="true"]');
  const controls = {};
  document.querySelectorAll('#generic-protein-viewer input[id], #generic-protein-viewer select[id], #generic-protein-viewer textarea[id]').forEach(element => {
    if (['file', 'hidden', 'button', 'submit', 'reset', 'image'].includes(element.type) || element.readOnly) return;
    /* Whether it was accepting input matters at restore time: a control greyed out both before
       the step and after it is derived state, not something the step left behind. */
    controls[element.id] = element.type === 'checkbox' || element.type === 'radio'
      ? { checked: element.checked, off: element.disabled }
      : { value: element.value, off: element.disabled };
  });
  return {
    models: debug ? debug.entries().map(entry => ({ id: entry.id, name: entry.name, visible: entry.visible !== false })) : [],
    tab: (open && open.dataset.gpvTab) || 'models',
    controls,
    counts: {
      positions: debug ? debug.spotlightResidues().length : 0,
      labels: debug ? debug.labelRecords().length : 0,
      selections: debug ? debug.selectionRecords().length : 0,
      views: debug ? debug.savedViews().length : 0,
      measurements: rows('#gpv-measurement-list .gpv-entry'),
      annotations: rows('#gpv-annotation-list .gpv-entry'),
      domains: rows('#gpv-domain-list .gpv-entry'),
      panels: rows('#gpv-compare-panels > *')
    }
  };
});

/* Taken once, immediately after the import group: that is the first moment the three fixture
   models — the thing the remaining ~150 steps all assume — exist. The baseline is the reference
   for the models and their ticks, and for those alone: a step that loads a fixture should always
   have it taken away again, whatever else the run has done since. It is deliberately NOT the
   reference for the settings — see markState. */
const captureBaseline = async () => {
  const started = Date.now();
  const snapshot = await guard(readSnapshot, 8000);
  baselineMs = Date.now() - started;
  if (!snapshot.ok) {
    console.log('  !!   baseline snapshot failed (' + snapshot.error + ') — a failed step will not be recovered from');
    return;
  }
  baseline = snapshot.value;
  console.log('  ..   baseline: ' + baseline.models.length + ' models (' + baseline.models.map(model => model.name).join(', ') + ') · ' + baseline.tab + ' tab · ' + Object.keys(baseline.controls).length + ' controls · ' + baselineMs + ' ms');
};

/* The state as the step about to run found it: how full the accumulating lists are and what
   every control was set to. Recovery restores to *this*, not to the baseline, because the suite
   legitimately moves on as it goes — six saved views stay loaded for four later steps, and a
   passing step may deliberately leave a setting for the steps after it. Putting a control back
   to its import-time value would let one failure quietly undo a setting a later step depends on:
   a safety net with a state bug of its own, and an unreadable transcript when it bites.
   Restoring to the mark means recovery only ever puts back what the failed step itself moved. */
const markState = async () => {
  if (!baseline) return null;
  const started = Date.now();
  const result = await guard(readSnapshot, 3000);
  markMs += Date.now() - started;
  return result.ok ? result.value : null;
};

const recover = async (failedName, mark) => {
  if (!baseline) { console.log('  ..   no baseline yet — [' + failedName + '] leaves whatever it left'); return; }
  const started = Date.now();
  const previousStep = currentStep;
  currentStep = 'recovery after ' + failedName;
  recoveries += 1;
  const deadline = started + RECOVERY_MS;
  const did = [], trouble = [];
  const remaining = () => deadline - Date.now();
  /* One guarded action. Anything that fails is written down and the rest of the recovery
     carries on: no single piece can abort the others. */
  const act = async (what, fn, ms = ACTION_MS) => {
    if (remaining() <= 0) { trouble.push(what + ': no time left'); return null; }
    const result = await guard(fn, Math.min(ms, remaining()));
    if (!result.ok) { trouble.push(what + ': ' + result.error); return null; }
    return result.value === undefined ? true : result.value;
  };
  const openTab = name => act('open the ' + name + ' tab', async () => {
    await page.click(`[data-gpv-tab="${name}"]`, { timeout: ACTION_MS });
    await page.waitForTimeout(120);
  });
  /* A real click where the control is on screen, and the button's own handler through the DOM
     where the tab switch did not take — either way it is the app's Clear button doing the work. */
  const press = (what, selector) => act(what, async () => {
    try { await page.click(selector, { timeout: Math.max(600, Math.min(ACTION_MS, remaining()) - 600) }); }
    catch { await page.evaluate(id => { const button = document.querySelector(id); if (!button) throw new Error('no ' + id); button.click(); }, selector); }
    await page.waitForTimeout(250);
  });

  /* A step may have left the model list filtered or paged, which hides the rows recovery needs. */
  await act('clear the model search', () => page.evaluate(() => {
    const search = document.querySelector('#gpv-search');
    if (search && search.value) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
    const more = document.querySelector('#gpv-show-more');
    if (more && !more.hidden) more.click();
  }));

  const before = await act('read the page', readSnapshot, 5000);
  if (before) {
    /* 1. models the baseline does not know about, removed by their own row's Remove button. */
    const wanted = new Set(baseline.models.map(model => model.name));
    const extra = before.models.filter(model => !wanted.has(model.name));
    if (extra.length) await openTab('models');
    for (const model of extra) {
      const gone = await act('remove ' + model.name, async () => {
        const row = '#gpv-list [data-entry-id="' + model.id + '"] button:has-text("Remove")';
        try { await page.click(row, { timeout: Math.max(600, Math.min(ACTION_MS, remaining()) - 800) }); }
        catch {
          await page.evaluate(id => {
            const remove = [...document.querySelectorAll('#gpv-list [data-entry-id="' + id + '"] button')].find(item => item.textContent.trim() === 'Remove');
            if (!remove) throw new Error('its row is not on screen');
            remove.click();
          }, model.id);
        }
        await page.waitForTimeout(400);
        return true;
      }, 5000);
      if (gone) did.push('removed ' + model.name);
    }
    const lost = baseline.models.filter(model => !before.models.some(item => item.name === model.name));
    if (lost.length) trouble.push('the baseline model' + (lost.length === 1 ? ' ' : 's ') + lost.map(model => model.name).join(', ') + ' cannot be brought back');

    /* 2. the shown ticks, through each row's own switch. */
    const now = await act('re-read the model list', readSnapshot, 5000);
    let ticks = 0;
    for (const model of (now || before).models) {
      const want = baseline.models.find(item => item.name === model.name);
      if (!want || want.visible === model.visible) continue;
      if (!ticks) await openTab('models');
      const set = await act((want.visible ? 'show ' : 'hide ') + model.name, async () => {
        await page.setChecked('#gpv-list [data-entry-id="' + model.id + '"] input[type="checkbox"]', want.visible, { timeout: ACTION_MS });
        await page.waitForTimeout(250);
      }, 4000);
      if (set) ticks += 1;
    }
    if (ticks) did.push('re-ticked ' + ticks + ' model' + (ticks === 1 ? '' : 's'));

    /* 3. what the step piled up, cleared back to the mark taken before it ran. Counts are read
       again for each list because clearing one empties another: Clear compared positions takes
       the position labels with it. */
    let counts = (now || before).counts;
    for (const list of collections) {
      const floor = mark && mark.counts ? mark.counts[list.key] : 0;
      if (counts[list.key] - floor <= 0) continue;
      const fresh = await act('count the ' + list.many, readSnapshot, 4000);
      if (fresh) counts = fresh.counts;
      const surplus = counts[list.key] - floor;
      if (surplus <= 0) continue;
      await openTab(list.tab);
      let cleared = 0;
      if (list.clear && floor === 0) {
        const enabled = await act('look at ' + list.clear, () => page.evaluate(id => { const button = document.querySelector(id); return Boolean(button) && !button.disabled; }, list.clear));
        if (enabled && await press('press ' + list.clear, list.clear)) cleared = surplus;
      }
      if (!cleared && list.rows) {
        /* Rows are appended, so the surplus is at the end: take the last one off, that many times. */
        for (let index = 0; index < surplus && remaining() > 0; index += 1) {
          const off = await act('remove a ' + list.one, async () => {
            await page.locator(list.rows).last().locator('button:has-text("Remove")').click({ timeout: Math.min(ACTION_MS, Math.max(600, remaining())) });
            await page.waitForTimeout(200);
          }, 4000);
          if (!off) break;
          cleared += 1;
        }
      }
      if (cleared) did.push('cleared ' + cleared + ' ' + (cleared === 1 ? list.one : list.many));
      if (cleared < surplus) trouble.push((surplus - cleared) + ' ' + (surplus - cleared === 1 ? list.one : list.many) + ' could not be cleared');
    }
  }

  /* 4. every control the failed step moved and did not move back, put back the way the steps
     themselves do it: set the value, then fire input and change so the app reacts. The reference
     is the mark taken before the step, so a setting an earlier, passing step left on purpose is
     left alone; only if the mark could not be read does the baseline stand in for it. */
  const wantedControls = (mark && mark.controls) || baseline.controls;
  if (!(mark && mark.controls)) trouble.push('no pre-step control mark — settings were compared against the import-time baseline instead');
  const snapshot = await act('read the controls', readSnapshot, 5000);
  const controls = snapshot && snapshot.controls;
  const restoredIds = [], unreachable = [];
  let restored = 0;
  if (controls) {
    for (const [id, want] of Object.entries(wantedControls)) {
      const has = controls[id];
      if (!has) continue;
      if ('checked' in want ? has.checked === want.checked : has.value === want.value) continue;
      if (want.off && has.off) continue; /* greyed out before the step and after it: derived, not a leftover */
      if (remaining() <= 0) { unreachable.push('#' + id + ': no time left'); continue; }
      const outcome = await act('put #' + id + ' back', () => page.evaluate(([target, value]) => {
        const element = document.getElementById(target);
        if (!element) return 'gone from the page';
        if (element.disabled) return 'greyed out, still ' + ('checked' in value ? element.checked : JSON.stringify(element.value));
        if ('checked' in value) { if (element.checked === value.checked) return 'same'; element.checked = value.checked; }
        else { if (element.value === value.value) return 'same'; element.value = value.value; }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return 'set';
      }, [id, want]));
      if (outcome === 'set') { restored += 1; restoredIds.push('#' + id); await guard(() => page.waitForTimeout(120), 1000); }
      else if (outcome && outcome !== 'same') unreachable.push('#' + id + ': ' + outcome);
    }
  }
  /* Naming them matters: a control recovery puts back is a control the failed step moved and did
     not move back, and reading which ones is how you tell a leak from a deliberate change. */
  if (restored) did.push('restored ' + restored + ' control' + (restored === 1 ? '' : 's') + ' (' + restoredIds.slice(0, 8).join(', ') + (restoredIds.length > 8 ? ', …' : '') + ')');
  if (unreachable.length) trouble.push('could not put back ' + unreachable.join(', '));

  /* 5. the tab last, and to the panel the step found open rather than the one the run started
     on, for the same reason the controls go back to the mark. */
  const wantedTab = (mark && mark.tab) || baseline.tab;
  const openNow = await act('read the open tab', () => page.evaluate(() => { const open = document.querySelector('[data-gpv-tab][aria-selected="true"]'); return (open && open.dataset.gpvTab) || 'models'; }));
  if (openNow && openNow !== wantedTab && (await openTab(wantedTab))) did.push('back on the ' + wantedTab + ' tab');

  const spent = Date.now() - started;
  recoveryMs += spent;
  currentStep = previousStep;
  console.log('  ..   recovered after [' + failedName + ']: ' + (did.length ? did.join(', ') : 'nothing needed restoring') + ' · ' + (spent / 1000).toFixed(1) + ' s');
  if (trouble.length) {
    incompleteRecoveries += 1;
    suspectSince = failedName;
    console.log('  !!   RECOVERY INCOMPLETE after [' + failedName + ']: ' + trouble.join(' · '));
    console.log('  !!   the page was not put back — every later failure is suspect until a recovery finishes');
  } else if (suspectSince) {
    console.log('  ..   recovery finished cleanly — later failures count again');
    suspectSince = null;
  }
};

const step = async (name, body) => {
  currentStep = name;
  steps += 1;
  const mark = await markState();
  let failed = false;
  try { await body(); console.log('  ok   ' + name); return; }
  catch (error) {
    if (!isTimeout(error)) { console.log('  FAIL ' + name + ' :: ' + String(error.message).split('\n')[0]); failures.push(name); failed = true; }
    else { retries += 1; console.log('  RETRY ' + name + ' :: ' + String(error.message).split('\n')[0]); }
  }
  if (!failed) {
    try { await body(); console.log('  ok   ' + name + ' (after one retry)'); }
    catch (error) { console.log('  FAIL ' + name + ' :: ' + String(error.message).split('\n')[0]); failures.push(name); failed = true; }
  }
  if (!failed) return;
  if (suspectSince) suspect.push(name);
  await recover(name, mark);
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
/* A page of its own, in a browser context of its own — so its own IndexedDB and localStorage — for
   steps that clear, remove or reload: done on the main page, that would be done to every later step.
   The caller closes it in its finally. */
/* One fixed-column PDB ATOM/HETATM line, for the small hand-made models some steps need. */
const pdbAtom = (record, serial, name, resn, chain, resi, [x, y, z], element, icode = ' ', b = 80) =>
  record.padEnd(6) + String(serial).padStart(5) + ' ' + (name.length < 4 ? ' ' + name.padEnd(3) : name) + ' ' + resn.padStart(3) + ' ' + chain + String(resi).padStart(4) + icode + '   '
  + x.toFixed(3).padStart(8) + y.toFixed(3).padStart(8) + z.toFixed(3).padStart(8) + '  1.00' + b.toFixed(2).padStart(6) + '          ' + element.padStart(2);
const freshViewer = async (files = [], pageOptions = {}) => {
  const fresh = await browser.newPage({ viewport: { width: 1280, height: 1000 }, ...pageOptions });
  fresh.on('pageerror', error => noteError('FRESH PAGEERROR: ' + error.message));
  fresh.on('console', message => { if (message.type() === 'error' && !/favicon|404/.test(message.text())) noteError('fresh page: ' + message.text()); });
  await fresh.goto(base + '/index.html?debug=1'); await fresh.waitForTimeout(2000);
  if (files.length) { await fresh.setInputFiles('#gpv-files', files); await fresh.waitForTimeout(2000); }
  return fresh;
};

/* Helpers for the steps on pages of their own (stress loop, round 1, batch 2). */
const experimentalFile = name => join(here, 'fixtures', 'experimental', name);
const pngSize = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dpi: bytes.indexOf('pHYs') > 0 ? Math.round(bytes.readUInt32BE(bytes.indexOf('pHYs') + 4) * 0.0254) : null });
const freshDownload = async (fresh, selector, timeout = 120000) => {
  const download = fresh.waitForEvent('download', { timeout });
  await fresh.click(selector);
  return readFile(await (await download).path());
};
const freshStatus = async fresh => ((await fresh.locator('#gpv-state').textContent()) || '').trim();
const printPlan = async (fresh, width, dpi, points = '8') => {
  await fresh.click('[data-gpv-tab="publish"]');
  await fresh.selectOption('#gpv-export-mode', 'print'); await fresh.selectOption('#gpv-print-width', width); await fresh.selectOption('#gpv-print-dpi', dpi); await fresh.selectOption('#gpv-print-text', points);
  await fresh.waitForTimeout(300);
};
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

group('layout');
const layoutGeometry = () => page.evaluate(() => {
  const rect = selector => document.querySelector(selector).getBoundingClientRect();
  const stage = rect('#gpv-stage'); const panel = rect('#gpv-side-panel');
  const panelRight = panel.left >= stage.right - 1, panelLeft = stage.left >= panel.right - 1;
  return { workspace: document.querySelector('#generic-protein-viewer').classList.contains('is-workspace'), sideBySide: (panelRight || panelLeft) && panel.top < stage.bottom, side: panelLeft ? 'left' : panelRight ? 'right' : 'stacked', panelWidth: Math.round(panel.width), stageWidth: Math.round(stage.width) };
});
await step('at 1280 px the tool panel sits on the left of the pinned 3D view', async () => {
  const geometry = await layoutGeometry();
  if (!geometry.workspace || !geometry.sideBySide || geometry.side !== 'left') throw new Error(JSON.stringify(geometry));
  console.log('       panel ' + geometry.panelWidth + ' px on the ' + geometry.side + ' · stage ' + geometry.stageWidth + ' px');
});
await step('the arrows button moves the panel to the right and the side survives a reload', async () => {
  await page.click('#gpv-panel-side'); await page.waitForTimeout(400);
  if ((await layoutGeometry()).side !== 'right') throw new Error(JSON.stringify(await layoutGeometry()));
  await page.reload(); await page.waitForTimeout(2000);
  if ((await layoutGeometry()).side !== 'right') throw new Error('side not remembered');
  await page.click('#gpv-panel-side'); await page.waitForTimeout(400);
  if ((await layoutGeometry()).side !== 'left') throw new Error('could not move the panel back to the left');
});
await step('the panel scrolls on its own while the page and the stage stay put', async () => {
  await tab('publish');
  const result = await page.evaluate(() => { const panel = document.querySelector('#gpv-side-panel'); panel.scrollTop = 500; return { panelScroll: panel.scrollTop, pageScroll: window.scrollY, stageTop: Math.round(document.querySelector('#gpv-stage').getBoundingClientRect().top) }; });
  if (result.panelScroll < 100 || result.pageScroll !== 0 || result.stageTop < 0) throw new Error(JSON.stringify(result));
  await page.evaluate(() => { document.querySelector('#gpv-side-panel').scrollTop = 0; }); await tab('models');
});
await step('dragging the divider widens the panel', async () => {
  const before = (await layoutGeometry()).panelWidth;
  const box = await page.locator('#gpv-splitter').boundingBox();
  const direction = (await layoutGeometry()).side === 'right' ? -1 : 1;
  await page.mouse.move(box.x + 5, box.y + 150); await page.mouse.down(); await page.mouse.move(box.x + 5 + direction * 120, box.y + 150, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
  const after = (await layoutGeometry()).panelWidth;
  if (after < before + 80) throw new Error(before + ' -> ' + after);
  await page.dblclick('#gpv-splitter'); await page.waitForTimeout(300);
  if (Math.abs((await layoutGeometry()).panelWidth - before) > 4) throw new Error('reset failed');
});
await step('the header button switches to the stacked layout and the choice survives a reload', async () => {
  await page.click('#gpv-layout'); await page.waitForTimeout(400);
  let geometry = await layoutGeometry();
  if (geometry.workspace || geometry.sideBySide) throw new Error(JSON.stringify(geometry));
  await page.reload(); await page.waitForTimeout(2000);
  geometry = await layoutGeometry();
  if (geometry.workspace) throw new Error('stacked layout not remembered');
  await page.click('#gpv-layout'); await page.waitForTimeout(400);
  if (!(await layoutGeometry()).workspace) throw new Error('could not return to the workspace layout');
});
await step('a 900 px window falls back to the stacked layout', async () => {
  await page.setViewportSize({ width: 900, height: 1000 }); await page.waitForTimeout(500);
  const narrow = await layoutGeometry();
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(500);
  const wide = await layoutGeometry();
  if (narrow.sideBySide || !wide.sideBySide) throw new Error(JSON.stringify({ narrow, wide }));
});

await step('a phone keeps the compact 380 px viewport in workspace layout', async () => {
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const stage = await page.locator('#gpv-stage').boundingBox();
    if (!stage || Math.abs(stage.height - 380) > 1) throw new Error('phone stage: ' + JSON.stringify(stage));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) throw new Error('phone page scrolls horizontally');
  } finally { await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(500); }
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
/* The three fixtures are in, the canvas is up and no step has customised anything yet: this is
   the state the ~150 steps below all start from, so this is what a failed step is put back to. */
await captureBaseline();

group('figure finishing');
await step('outline and depth cueing switch on without errors and round-trip through a scene', async () => {
  await tab('appearance');
  await page.selectOption('#gpv-outline', 'bold'); await page.check('#gpv-fog'); await page.waitForTimeout(400);
  const scene = await page.evaluate(() => JSON.stringify(window.__viewerDebug.sceneSettings ? window.__viewerDebug.sceneSettings() : null));
  await page.selectOption('#gpv-outline', 'none'); await page.uncheck('#gpv-fog'); await page.waitForTimeout(200);
  if (!(await page.evaluate(() => Boolean(document.querySelector('#gpv-stage canvas'))))) throw new Error('canvas lost');
  await page.selectOption('#gpv-outline', 'thin'); await page.waitForTimeout(200);
  if ((await page.inputValue('#gpv-outline')) !== 'thin') throw new Error('outline select did not hold');
  await page.selectOption('#gpv-outline', 'none');
  console.log('       scene carries ' + (scene && /"outline":"bold"/.test(scene) ? 'outline + fog' : 'no view style (debug hook lacks sceneSettings)'));
});
await step('fading chain B lightens its colour and dims its strip row', async () => {
  await tab('models');
  const fade = page.locator('#gpv-chain-rows input[aria-label="Fade chain B"]');
  if (!(await fade.count())) throw new Error('no fade switch');
  await fade.check(); await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const d = window.__viewerDebug; const entry = d.activeEntry(); const options = d.colorOptions(entry);
    const a = entry.atoms.find(x => x.chain === 'A' && x.atom === 'CA'); const b = entry.atoms.find(x => x.chain === 'B' && x.atom === 'CA');
    const lum = hex => { const m = /^#([0-9a-f]{6})$/i.exec(hex); return m ? [0, 2, 4].reduce((sum, o) => sum + parseInt(m[1].slice(o, o + 2), 16), 0) : -1; };
    const strip = document.querySelector('#gpv-sequence-rows canvas[data-chain="B"]');
    return { faded: entry.fadedChains, a: options.colorfunc(a), b: options.colorfunc(b), lighter: lum(options.colorfunc(b)) > lum(options.colorfunc(a)), strip: strip ? strip.style.opacity : null };
  });
  if (!result.lighter || result.strip !== '0.45') throw new Error(JSON.stringify(result));
  await fade.uncheck(); await page.waitForTimeout(300);
  console.log('       A ' + result.a + ' · B faded to ' + result.b);
});
await step('a journal preset sets width, resolution, text size and font', async () => {
  await tab('publish');
  await page.selectOption('#gpv-journal', '183|300|7'); await page.waitForTimeout(400);
  const values = await page.evaluate(() => ({ mode: document.querySelector('#gpv-export-mode').value, width: document.querySelector('#gpv-print-width').value, custom: document.querySelector('#gpv-print-custom').value, dpi: document.querySelector('#gpv-print-dpi').value, pt: document.querySelector('#gpv-print-text').value, font: document.querySelector('#gpv-figure-font').value }));
  if (values.mode !== 'print' || values.width !== 'custom' || values.custom !== '183' || values.dpi !== '300' || values.pt !== '7' || !/Arial/.test(values.font)) throw new Error(JSON.stringify(values));
  await page.selectOption('#gpv-journal', '85|300|7'); await page.waitForTimeout(300);
  if ((await page.inputValue('#gpv-print-width')) !== '85') throw new Error('85 mm should pick the built-in single column');
  if (!(await page.inputValue('#gpv-journal'))) throw new Error('the journal select let go of the preset it just applied');
  /* A hand edit after the preset means the figure no longer follows that journal's guide. */
  await page.selectOption('#gpv-print-dpi', '600'); await page.waitForTimeout(150);
  if ((await page.inputValue('#gpv-journal')) !== '') throw new Error('after a hand edit the journal select still names ' + (await page.inputValue('#gpv-journal')));
  await page.selectOption('#gpv-print-dpi', '300');
  await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
});
await step('a journal width that is not one of the listed widths survives a reload', async () => {
  /* Nature's 89 mm goes through Custom width; before 2.52.0 that field was not remembered, so after a
     reload Figure width still said Custom… but printed at the default 120 mm. */
  const fresh = await freshViewer();
  try {
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.selectOption('#gpv-journal', '89|300|7'); await fresh.waitForTimeout(300);
    if ((await fresh.inputValue('#gpv-print-custom')) !== '89') throw new Error('setup: the preset set ' + await fresh.inputValue('#gpv-print-custom') + ' mm');
    await fresh.reload(); await fresh.waitForTimeout(2000);
    await fresh.click('[data-gpv-tab="publish"]');
    const after = { width: await fresh.inputValue('#gpv-print-width'), custom: await fresh.inputValue('#gpv-print-custom') };
    if (after.width !== 'custom' || after.custom !== '89') throw new Error('after a reload: ' + JSON.stringify(after));
  } finally { await fresh.close(); }
});
await step('the publication checklist flags pixel export and unsafe colours, and its fixes clear them', async () => {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(200);
  await tab('publish'); await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(500);
  const read = () => page.evaluate(() => ({ badge: document.querySelector('#gpv-check-badge').textContent, warnings: document.querySelectorAll('#gpv-check-list li.is-warn').length, texts: [...document.querySelectorAll('#gpv-check-list li')].map(li => li.textContent) }));
  const before = await read();
  if (before.warnings < 2 || !before.texts.some(text => /Pixel export/.test(text)) || !before.texts.some(text => /colour-blind/.test(text))) throw new Error(JSON.stringify(before));
  await page.click('#gpv-check-list li.is-warn button'); await page.waitForTimeout(400);
  await page.click('#gpv-check-list li.is-warn button'); await page.waitForTimeout(400);
  const after = await read();
  if (after.warnings !== before.warnings - 2 || (await page.inputValue('#gpv-export-mode')) !== 'print' || !(await page.isChecked('#gpv-safe-palette'))) throw new Error(JSON.stringify(after));
  await page.selectOption('#gpv-export-mode', 'pixels'); await tab('appearance'); await page.uncheck('#gpv-safe-palette'); await page.selectOption('#gpv-color-mode', 'structure'); await tab('publish'); await page.waitForTimeout(200);
  console.log('       ' + before.badge + ' → ' + after.badge);
});
await step('one panel per model downloads a lettered PNG of the chosen width, three panels across, with resolution metadata', async () => {
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85'); await page.waitForTimeout(200);
  if (await page.locator('#gpv-model-panels').isDisabled()) throw new Error('button disabled with three models loaded');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-model-panels');
  const file = join(work, 'model-panels.png'); await (await download).saveAs(file);
  const bytes = await readFile(file);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  /* The three panels share the chosen 85 mm (2.52.0); before, each was 85 mm and the figure 255 mm wide. */
  if (Math.abs(width - 1004) > 6 || !bytes.includes('pHYs')) throw new Error(width + 'x' + height + ' pHYs=' + bytes.includes('pHYs'));
  await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
  await tab('models');
  console.log('       ' + width + ' × ' + height + ' px, 300 dpi');
});
await step('the contact map counts residue pairs between chains A and B and exports them', async () => {
  await tab('compare');
  if (await page.locator('#gpv-contact-run').isDisabled()) throw new Error('compute disabled with a two-chain model');
  await page.fill('#gpv-contact-cutoff', '6'); await page.click('#gpv-contact-run'); await page.waitForTimeout(600);
  const state = (await page.locator('#gpv-contact-state').textContent()) || '';
  const pairs = Number((state.match(/^(\d+) residue pair/) || [])[1]);
  if (!(pairs > 0)) throw new Error('state: ' + state);
  const box = await page.locator('#gpv-contact-canvas').boundingBox();
  if (!box || box.width < 50) throw new Error('map not drawn');
  const before = await page.locator('#gpv-selection-list .gpv-entry').count();
  await page.click('#gpv-contact-highlight'); await page.waitForTimeout(400);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== before + 2) throw new Error('interface highlight did not add two selections');
  let download = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-contact-csv');
  const csv = (await readFile(await (await download).path(), 'utf8')).split('\n');
  if (!/^"?model"?,"?chain_a"?,"?resi_a/.test(csv[0]) || csv.length - 1 !== pairs) throw new Error('csv rows ' + (csv.length - 1) + ' vs ' + pairs);
  download = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-contact-png');
  const png = await readFile(await (await download).path());
  if (png.toString('latin1', 1, 4) !== 'PNG' || !png.includes('pHYs')) throw new Error('not a PNG with resolution');
  await tab('annotate'); await page.click('#gpv-clear-selections'); await page.waitForTimeout(300);
  console.log('       ' + pairs + ' pairs · ' + state.replace(/^\d+ residue pairs? within [^·]+· /, ''));
});
await step('the composite figure stitches the 3D view, the pLDDT profile and the contact map at print size', async () => {
  await tab('publish'); await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '178'); await page.waitForTimeout(400);
  const controls = await page.evaluate(() => ({ profile: document.querySelector('#gpv-composite-profile').disabled, contacts: document.querySelector('#gpv-composite-contacts').disabled, button: document.querySelector('#gpv-composite').disabled }));
  if (controls.profile || controls.contacts || controls.button) throw new Error(JSON.stringify(controls));
  const download = page.waitForEvent('download', { timeout: 180000 }); await page.click('#gpv-composite');
  const png = await readFile(await (await download).path());
  const width = png.readUInt32BE(16); const height = png.readUInt32BE(20);
  if (Math.abs(width - 2102) > 6 || height < 1200 || !png.includes('pHYs')) throw new Error(width + 'x' + height + ' pHYs=' + png.includes('pHYs'));
  await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
  console.log('       ' + width + ' × ' + height + ' px · 3 panels at 300 dpi');
});
await step('an a3m alignment colours both chains by conservation, identity or coverage', async () => {
  const query = 'A'.repeat(30); const lines = ['>query', query];
  for (let k = 0; k < 8; k += 1) { const letters = query.split(''); letters[4] = 'ACDEFGHI'[k]; letters[19] = k % 2 ? 'K' : 'A'; if (k > 5) letters[10] = '-'; lines.push('>seq' + k, letters.join('')); }
  const a3m = join(work, 'fixture_unpaired_msa_chains_a_b.a3m'); await writeFile(a3m, lines.join('\n') + '\n');
  await page.setInputFiles('#gpv-files', [a3m]); await page.waitForTimeout(800);
  await tab('confidence');
  if (await page.locator('#gpv-msa-paint').isDisabled()) throw new Error('paint disabled: ' + await page.locator('#gpv-msa-state').textContent());
  await page.click('#gpv-msa-paint'); await page.waitForTimeout(600);
  const painted = await page.evaluate(() => { const d = window.__viewerDebug.residueData(); return { mode: document.querySelector('#gpv-color-mode').value, name: d.name, count: d.count, varied: d.values.get('A|5'), conserved: d.values.get('A|6'), half: d.values.get('A|20'), b: d.values.get('B|5') }; });
  if (painted.mode !== 'data' || !/conservation/i.test(painted.name) || !/Henikoff/.test(painted.name) || painted.count !== 60 || !(painted.varied < painted.half && painted.half < painted.conserved) || painted.b !== painted.varied) throw new Error(JSON.stringify(painted));
  /* Switching the Henikoff weights off gives the plain column entropy: same ordering, a different
     number at the varied column (the fixture's sequences are not equally weighted), and the name,
     the debug hook and the methods text all say which was used. */
  await page.setChecked('#gpv-msa-weights', false); await page.click('#gpv-msa-paint'); await page.waitForTimeout(400);
  const raw = await page.evaluate(() => { const d = window.__viewerDebug.residueData(); return { name: d.name, weighted: d.msa.weighted, varied: d.values.get('A|5'), half: d.values.get('A|20'), conserved: d.values.get('A|1') }; });
  if (!/unweighted/.test(raw.name) || raw.weighted !== false || raw.varied === painted.varied || !(raw.varied < raw.half && raw.half < raw.conserved)) throw new Error('unweighted: ' + JSON.stringify(raw) + ' vs weighted ' + JSON.stringify(painted));
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
  if (!/sequences unweighted/.test(await page.inputValue('#gpv-methods-field'))) throw new Error('methods text does not say the conservation was unweighted');
  await tab('confidence'); await page.setChecked('#gpv-msa-weights', true); await page.click('#gpv-msa-paint'); await page.waitForTimeout(400);
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
  if (!/Henikoff & Henikoff, 1994/.test(await page.inputValue('#gpv-methods-field'))) throw new Error('methods text does not name the Henikoff weighting');
  await tab('confidence');
  await page.selectOption('#gpv-msa-metric', 'depth'); await page.click('#gpv-msa-paint'); await page.waitForTimeout(400);
  const depth = await page.evaluate(() => { const d = window.__viewerDebug.residueData(); return { gapped: d.values.get('A|11'), full: d.values.get('A|5') }; });
  if (!(depth.gapped === 7 && depth.full === 9)) throw new Error(JSON.stringify(depth));
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
  if (!/multiple sequence alignment/.test(await page.inputValue('#gpv-methods-field'))) throw new Error('methods text lacks the MSA sentence');
  await tab('annotate');
  const csvDownload = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-data-csv');
  const csv = (await readFile(await (await csvDownload).path(), 'utf8')).split('\n');
  if (!/^"?chain"?,"?resi"?,"?resn"?,/.test(csv[0]) || csv.length - 1 !== 60 || !/"A","11","ALA","7"/.test(csv.find(line => /"A","11",/.test(line)) || '')) throw new Error('data csv: ' + csv.slice(0, 3).join(' | '));
  await tab('annotate'); await page.click('#gpv-data-clear'); await tab('appearance'); await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(200);
  console.log('       conservation varied ' + painted.varied.toFixed(3) + ' (unweighted ' + raw.varied.toFixed(3) + ') · half ' + painted.half.toFixed(2) + ' · conserved ' + painted.conserved.toFixed(2) + ' · coverage 9 / 7');
});
await step('the plain label style is a scene setting and the methods text names the contact rule', async () => {
  await tab('annotate'); await page.selectOption('#gpv-label-style', 'plain'); await page.waitForTimeout(300);
  const scene = await page.evaluate(() => window.__viewerDebug.sceneSettings().labelStyle);
  if (scene !== 'plain') throw new Error('labelStyle in scene: ' + scene);
  await page.selectOption('#gpv-label-style', 'boxed');
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
  const text = await page.inputValue('#gpv-methods-field');
  if (!/Inter-chain contacts between chains A and B/.test(text)) throw new Error(text.slice(-200));
  await tab('models');
});
/* ---- The contact and distance map (2.50.0) ----
   The contact map's axes may be one chain twice or all chains, and its All distances view reads,
   measures and exports every residue pair, contacts or not. Every step puts the map back to the
   A–B contact view at 6 Å that the steps around it expect, and takes back any measurement it made. */
const computeMap = async (a, b, view = 'contacts') => {
  await tab('compare');
  await page.selectOption('#gpv-contact-a', a); await page.selectOption('#gpv-contact-b', b);
  await page.selectOption('#gpv-contact-atoms', 'heavy'); await page.selectOption('#gpv-contact-view', view);
  await page.fill('#gpv-contact-cutoff', '6'); await page.click('#gpv-contact-run'); await page.waitForTimeout(500);
};
const restoreMap = () => computeMap('A', 'B');
const mapShape = () => page.evaluate(() => {
  const c = window.__viewerDebug.contactResult(); const canvas = document.querySelector('#gpv-contact-canvas');
  return c ? { n: c.rowA.residues.length, m: c.rowB.residues.length, symmetric: c.symmetric, width: canvas.width, height: canvas.height, pairs: c.pairs.size, blocks: c.axisA.blocks.map(block => [block.chain, block.start, block.end]), entryId: c.entryId } : null;
});
/* The viewport point at the centre of cell (i, j) of the on-screen map: rows down, columns across. */
const mapCellPoint = async (i, j) => {
  await page.locator('#gpv-contact-canvas').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  const box = await page.locator('#gpv-contact-canvas').boundingBox(); const shape = await mapShape();
  return { x: box.x + (j + 0.5) * box.width / shape.m, y: box.y + (i + 0.5) * box.height / shape.n };
};
/* Cα–Cα distances straight from the atoms of the map's model, for [chainA, resiA, chainB, resiB] rows. */
const atomDistances = list => page.evaluate(list => {
  const d = window.__viewerDebug; const c = d.contactResult(); const entry = d.entries().find(item => item.id === c.entryId);
  const ca = (chain, resi) => entry.atoms.find(atom => atom.atom === 'CA' && !atom.hetflag && (atom.chain || '') === chain && atom.resi === resi);
  return list.map(([ca1, r1, ca2, r2]) => { const a = ca(ca1, r1); const b = ca(ca2, r2); return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null; });
}, list);
const csvCells = line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replace(/""/g, '"'));
/* `direct` presses the button through the DOM: the residue card follows its residue on the stage,
   so a pointer click would wait for it to hold still. */
const downloadText = async (selector, direct = false) => {
  const download = page.waitForEvent('download', { timeout: 60000 });
  if (direct) await page.evaluate(id => document.querySelector(id).click(), selector); else await page.click(selector);
  const saved = await download;
  return { name: saved.suggestedFilename(), lines: (await readFile(await saved.path(), 'utf8')).split('\n') };
};
const undoSteps = () => page.evaluate(() => window.__viewerDebug.rememberedSteps());
const undoOnce = async () => { await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await page.keyboard.press('Control+z'); await page.waitForTimeout(400); };
await step('an intra-chain map is square with an empty diagonal, and All chains lays both chains end to end', async () => {
  try {
    await computeMap('A', 'A');
    const intra = await page.evaluate(() => {
      const c = window.__viewerDebug.contactResult(); const keys = [...c.pairs.keys()].map(key => key.split('|').map(Number));
      return { diagonal: keys.filter(([i, j]) => i === j).length, lower: keys.filter(([i, j]) => j < i).length, state: document.querySelector('#gpv-contact-state').textContent };
    });
    const shape = await mapShape();
    if (shape.n !== 30 || shape.m !== 30 || !shape.symmetric || shape.width !== shape.height || !(shape.pairs > 0) || intra.diagonal || intra.lower || !/^\d+ residue pairs? within 6 Å/.test(intra.state)) throw new Error('intra-chain: ' + JSON.stringify({ ...shape, ...intra }));
    /* On the canvas the diagonal is paper like a distant pair, while its neighbour in contact is
       painted on both sides of the diagonal alike. */
    const pixels = await page.evaluate(() => {
      const canvas = document.querySelector('#gpv-contact-canvas'); const m = window.__viewerDebug.contactResult().rowB.residues.length; const cell = canvas.width / m;
      const at = (i, j) => [...canvas.getContext('2d').getImageData(Math.floor((j + 0.5) * cell), Math.floor((i + 0.5) * cell), 1, 1).data].join(',');
      return { diagonal: at(12, 12), neighbour: at(12, 13), mirror: at(13, 12), far: at(0, m - 1) };
    });
    if (pixels.diagonal !== pixels.far || pixels.neighbour === pixels.diagonal || pixels.neighbour !== pixels.mirror) throw new Error('diagonal cells: ' + JSON.stringify(pixels));
    await computeMap('*all*', '*all*');
    const all = await mapShape();
    if (all.n !== 60 || all.m !== 60 || JSON.stringify(all.blocks) !== '[["A",0,30],["B",30,60]]' || all.width !== all.height) throw new Error('all chains: ' + JSON.stringify(all));
    await computeMap('A', '*all*');
    const mixed = await mapShape();
    if (mixed.n !== 30 || mixed.m !== 60 || mixed.width !== 2 * mixed.height) throw new Error('chain A against all chains: ' + JSON.stringify(mixed));
    console.log('       A–A ' + shape.pairs + ' pairs on a ' + shape.width + ' px square · all chains ' + all.n + ' × ' + all.m + ' (' + all.pairs + ' pairs) · A × all ' + mixed.width + ' × ' + mixed.height + ' px');
  } finally { await restoreMap(); }
});
await step('All distances reads the Cα–Cα distance of a pair out of contact, and the closest atoms of a pair in contact', async () => {
  try {
    await computeMap('A', 'B');
    const contacts = await downloadText('#gpv-contact-csv');
    await page.selectOption('#gpv-contact-view', 'distances'); await page.waitForTimeout(300);
    const shape = await mapShape();
    /* A1 against B30: 45 Å apart along the helix axis, nowhere near a contact. */
    let point = await mapCellPoint(0, shape.m - 1);
    await page.mouse.move(point.x, point.y); await page.waitForTimeout(200);
    const far = (await page.locator('#gpv-contact-readout').textContent()) || '';
    const farValue = Number((far.match(/Cα–Cα (\d+\.\d+) Å · no contact/) || [])[1]);
    const [farDirect] = await atomDistances([['A', 1, 'B', 30]]);
    if (!/^A:ALA1 — B:ALA30/.test(far) || !(Math.abs(farValue - farDirect) <= 0.01)) throw new Error('far cell reads "' + far + '", the atoms are ' + farDirect.toFixed(3) + ' Å apart');
    /* A pair from the contacts CSV: the readout's closest atoms are the CSV's distance. */
    const row = csvCells(contacts.lines[1]);
    const pair = await page.evaluate(([resiA, resiB]) => { const c = window.__viewerDebug.contactResult(); return [c.rowA.residues.findIndex(atom => atom.resi === resiA), c.rowB.residues.findIndex(atom => atom.resi === resiB)]; }, [Number(row[2]), Number(row[5])]);
    point = await mapCellPoint(pair[0], pair[1]);
    await page.mouse.move(point.x, point.y); await page.waitForTimeout(200);
    const near = (await page.locator('#gpv-contact-readout').textContent()) || '';
    const closest = Number((near.match(/Cα–Cα \d+\.\d+ Å · closest atoms (\d+\.\d+) Å/) || [])[1]);
    if (!(Math.abs(closest - Number(row[7])) <= 0.01)) throw new Error('contact cell reads "' + near + '", the contacts CSV says ' + row[7] + ' Å');
    console.log('       ' + far + ' · ' + near);
  } finally { await restoreMap(); }
});
await step('a click on a map cell out of contact measures that Cα–Cα distance on the model in one undo step', async () => {
  try {
    await computeMap('A', 'B', 'distances');
    const startCount = await page.evaluate(() => window.__viewerDebug.measurementRecords().length); const steps = await undoSteps();
    const shape = await mapShape();
    const point = await mapCellPoint(2, shape.m - 3);
    await tap(point.x, point.y); await page.waitForTimeout(400);
    const records = await page.evaluate(() => JSON.parse(JSON.stringify(window.__viewerDebug.measurementRecords())));
    if (records.length !== startCount + 1) throw new Error((records.length - startCount) + ' new measurements, not 1');
    const record = records[records.length - 1];
    const keys = record.points.map(item => (item.chain || '') + item.resi + ':' + item.atom);
    if (record.type !== 'distance' || keys.join(' ') !== 'A3:CA B28:CA' || record.points.some(item => item.entryId !== shape.entryId)) throw new Error('made ' + JSON.stringify(record));
    const [expected] = await atomDistances([['A', 3, 'B', 28]]);
    const listed = (await page.locator('#gpv-measurement-list .gpv-entry .gpv-entry-name').last().textContent()) || '';
    const drawn = Number((listed.match(/· ([\d.]+) Å$/) || [])[1]);
    if (!(Math.abs(drawn - expected) <= 0.01)) throw new Error('the measurement reads ' + listed + ', the atoms are ' + expected.toFixed(3) + ' Å apart');
    const said = ((await page.locator('#gpv-state').textContent()) || '').trim();
    if (!/ALA3 · A — ALA28 · B: Cα–Cα \d+\.\d\d Å/.test(said)) throw new Error('status: ' + said);
    if ((await undoSteps()) - steps !== 1) throw new Error('took ' + ((await undoSteps()) - steps) + ' undo steps, not 1');
    await undoOnce();
    if ((await page.evaluate(() => window.__viewerDebug.measurementRecords().length)) !== startCount) throw new Error('undo did not take the measurement away');
    console.log('       ' + said);
  } finally {
    await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await restoreMap();
  }
});
await step('the distances CSV writes every pair of the map, blank closest atoms outside the cutoff', async () => {
  try {
    /* One chain against itself: each unordered pair once, no residue with itself — n(n − 1)/2 rows. */
    await computeMap('A', 'A', 'distances');
    let csv = await downloadText('#gpv-contact-distances');
    const header = csvCells(csv.lines[0]).join(',');
    if (header !== 'model,chain_a,resi_a,resn_a,chain_b,resi_b,resn_b,ca_distance_angstrom,min_heavy_distance_angstrom') throw new Error('header: ' + header);
    if (csv.lines.length - 1 !== 30 * 29 / 2) throw new Error('intra-chain rows ' + (csv.lines.length - 1) + ', not 435');
    if (!/Distances CSV downloaded · 435 residue pairs/.test((await page.locator('#gpv-state').textContent()) || '')) throw new Error('status: ' + await page.locator('#gpv-state').textContent());
    const spot = [1, 200, csv.lines.length - 1].map(index => csvCells(csv.lines[index]));
    const direct = await atomDistances(spot.map(row => [row[1], Number(row[2]), row[4], Number(row[5])]));
    spot.forEach((row, k) => { if (!(Math.abs(Number(row[7]) - direct[k]) <= 0.001)) throw new Error('row ' + row.join(',') + ' vs ' + direct[k]); });
    /* Two chains, heavy atoms: n × m rows; a pair out of contact has no closest-atom distance. */
    await computeMap('A', 'B', 'distances');
    csv = await downloadText('#gpv-contact-distances');
    if (csv.lines.length - 1 !== 900) throw new Error('A–B rows ' + (csv.lines.length - 1) + ', not 900');
    const far = csvCells(csv.lines.find(line => /^"[^"]*","A","1","ALA","B","30",/.test(line)) || '');
    if (far.length !== 9 || far[8] !== '') throw new Error('A1–B30 row: ' + far.join(','));
    const contact = csv.lines.map(csvCells).find(row => row[8] !== '' && row[0] !== 'model');
    if (!contact || !(Number(contact[8]) <= 6)) throw new Error('no pair in contact carries its closest-atom distance');
    console.log('       A–A 435 rows · A–B 900 rows · A1–B30 ' + far[7] + ' Å, no contact · ' + contact.slice(1, 7).join(' ') + ' closest ' + contact[8] + ' Å');
  } finally { await restoreMap(); }
});
await step('Distances from this residue lists every other residue of the model, nearest first and named in the status', async () => {
  try {
    await tab('annotate'); await page.fill('#gpv-goto', 'A:5'); await page.click('#gpv-goto-run'); await page.waitForTimeout(400);
    if (!(await page.locator('#gpv-label-editor').isVisible())) { await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await page.keyboard.press('l'); await page.waitForTimeout(300); }
    if (!(await page.locator('#gpv-label-editor-distances').isVisible())) throw new Error('the residue card has no Distances CSV button');
    const csv = await downloadText('#gpv-label-editor-distances', true);
    if (csvCells(csv.lines[0]).join(',') !== 'chain,resi,resn,ca_distance,min_heavy_distance') throw new Error('header: ' + csv.lines[0]);
    const residues = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(item => item.id === d.selectedResidue().entryId); return new Set(entry.atoms.filter(atom => !atom.hetflag).map(atom => (atom.chain || '') + '|' + atom.resi)).size; });
    if (csv.lines.length - 1 !== residues - 1) throw new Error((csv.lines.length - 1) + ' rows for ' + residues + ' residues (the residue itself is left out)');
    const said = ((await page.locator('#gpv-state').textContent()) || '').trim();
    const named = said.match(/nearest ([A-Z]+)(-?\d+)(?: · (\S+))? at (\d+\.\d+) Å/);
    const first = csvCells(csv.lines[1]);
    if (!named || named[2] !== first[1] || (named[3] || '') !== first[0] || !(Math.abs(Number(named[4]) - Number(first[3])) <= 0.01)) throw new Error('status "' + said + '" against first row ' + first.join(','));
    const [direct] = await page.evaluate(([chain, resi]) => {
      const d = window.__viewerDebug; const entry = d.entries().find(item => item.id === d.selectedResidue().entryId);
      const ca = (c, r) => entry.atoms.find(atom => atom.atom === 'CA' && (atom.chain || '') === c && atom.resi === r);
      const a = ca('A', 5); const b = ca(chain, resi); return [Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)];
    }, [first[0], Number(first[1])]);
    if (!(Math.abs(Number(first[3]) - direct) <= 0.001)) throw new Error('first row ' + first.join(',') + ', atoms ' + direct);
    const sorted = csv.lines.slice(1).map(line => Number(csvCells(line)[3])).every((value, k, list) => !k || list[k - 1] <= value);
    if (!sorted) throw new Error('rows are not nearest first');
    console.log('       ' + (csv.lines.length - 1) + ' rows · ' + said);
  } finally {
    for (let k = 0; k < 2; k += 1) { await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    await page.fill('#gpv-goto', '');
    await restoreMap();
  }
});
await step('the All distances map exports as a PNG whose scale runs from 0 Å to its maximum', async () => {
  try {
    await computeMap('A', 'B', 'distances');
    const download = await (async () => { const wait = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-contact-png'); return wait; })();
    const png = await readFile(await download.path());
    if (png.toString('latin1', 1, 4) !== 'PNG' || !png.includes('pHYs') || !/^distance-map-/.test(download.suggestedFilename())) throw new Error('not a distance-map PNG with resolution: ' + download.suggestedFilename());
    const scale = await page.evaluate(() => { const c = window.__viewerDebug.contactResult(); return { ...c.lastScale, caMax: c.caMax }; });
    if (scale.view !== 'distances' || scale.labels[0] !== '0 Å' || !/^\d+(\.\d)? Å$/.test(scale.labels[1]) || Math.abs(scale.maximum - Math.min(40, scale.caMax)) > 1e-9) throw new Error('scale: ' + JSON.stringify(scale));
    console.log('       ' + download.suggestedFilename() + ' · ' + png.readUInt32BE(16) + ' × ' + png.readUInt32BE(20) + ' px · scale ' + scale.labels.join('–'));
  } finally { await restoreMap(); await tab('models'); }
});

await step('a contact map whose settings change says it is out of date until computed again, and a hidden model drops the RMSD matrix', async () => {
  /* Before 2.52.0 the old map and its CSVs stood under the new cutoff with nothing to say so. */
  try {
    await restoreMap();
    if (await page.evaluate(() => document.querySelector('#gpv-contact-wrap').classList.contains('is-stale'))) throw new Error('a fresh map is marked out of date');
    await page.fill('#gpv-contact-cutoff', '8'); await page.locator('#gpv-contact-cutoff').dispatchEvent('change'); await page.waitForTimeout(200);
    const stale = await page.evaluate(() => ({ dimmed: document.querySelector('#gpv-contact-wrap').classList.contains('is-stale'), state: document.querySelector('#gpv-contact-state').textContent }));
    if (!stale.dimmed || !/^Settings changed · Compute map to update/.test(stale.state)) throw new Error('after a new cutoff: ' + JSON.stringify(stale));
    await page.click('#gpv-contact-run'); await page.waitForTimeout(400);
    const fresh = await page.evaluate(() => ({ dimmed: document.querySelector('#gpv-contact-wrap').classList.contains('is-stale'), state: document.querySelector('#gpv-contact-state').textContent }));
    if (fresh.dimmed || !/within 8 Å/.test(fresh.state)) throw new Error('after Compute map: ' + JSON.stringify(fresh));
  } finally { await restoreMap(); await tab('models'); }
  const viewer = await freshViewer([models[0], models[1], models[2]]);
  try {
    await viewer.click('[data-gpv-tab="models"]'); await viewer.selectOption('#gpv-view-mode', 'overlay'); await viewer.waitForTimeout(300);
    await viewer.click('[data-gpv-tab="compare"]'); await viewer.click('#gpv-rmsd-matrix-run'); await viewer.waitForTimeout(1500);
    if (!(await viewer.evaluate(() => Boolean(window.__viewerDebug.rmsdMatrix())))) throw new Error('setup: no matrix');
    await viewer.click('[data-gpv-tab="models"]'); await viewer.locator('#gpv-list .gpv-entry').nth(2).locator('input[aria-label^="Show "]').uncheck(); await viewer.waitForTimeout(400);
    if (await viewer.evaluate(() => Boolean(window.__viewerDebug.rmsdMatrix()))) throw new Error('the matrix still quotes a model that has been hidden');
  } finally { await viewer.close(); }
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
  await page.locator('#gpv-chain-rows tr').nth(1).locator('input[aria-label^="Show chain"]').uncheck(); await page.waitForTimeout(600);
  if ((await snapshot()) === before) throw new Error('hiding chain B did not change the render');
  if (!/hidden/.test((await page.locator('#gpv-sequence-rows').textContent()) || '')) throw new Error('strip does not mark the hidden chain');
  await page.click('#gpv-chains-all'); await page.waitForTimeout(500);
  if (!(await page.locator('#gpv-chain-rows tr').nth(1).locator('input[aria-label^="Show chain"]').isChecked())) throw new Error('show all did not restore chain B');
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

/* Clear all and Remove on a page of their own (freshViewer): on the main page they would take away
   the models every later step counts on. */
const freshGoTo = async (fresh, where) => {
  await fresh.click('[data-gpv-tab="annotate"]'); await fresh.waitForTimeout(150);
  await fresh.fill('#gpv-goto', where); await fresh.press('#gpv-goto', 'Enter'); await fresh.waitForTimeout(400);
};
const freshEntries = fresh => fresh.evaluate(() => window.__viewerDebug.entries().map(entry => ({ id: entry.id, name: entry.name })));
await step('Removing a model takes its card, its selected residue, its records and the modes with it', async () => {
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    const [first, second] = await freshEntries(fresh);
    await fresh.evaluate(id => { const select = document.querySelector('#gpv-current'); select.value = String(id); select.dispatchEvent(new Event('change', { bubbles: true })); }, second.id);
    await fresh.waitForTimeout(400);
    await freshGoTo(fresh, 'A:5');
    await fresh.click('#gpv-add-label'); await fresh.waitForTimeout(200);
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true }));
    await fresh.keyboard.press('l'); await fresh.waitForTimeout(400);
    if (!(await fresh.locator('#gpv-label-editor').isVisible())) throw new Error('the card did not open for the residue of the second model');
    await fresh.click('[data-gpv-tab="models"]'); await fresh.waitForTimeout(150);
    await fresh.click('#gpv-list [data-entry-id="' + second.id + '"] button:has-text("Remove")'); await fresh.waitForTimeout(500);
    const after = await fresh.evaluate(() => ({ selected: window.__viewerDebug.selectedResidue(), labels: window.__viewerDebug.labelRecords().length, add: document.querySelector('#gpv-add-label').disabled, status: document.querySelector('#gpv-state').textContent }));
    if (await fresh.locator('#gpv-label-editor').isVisible()) throw new Error('the card stayed open over the removed model');
    if (after.selected) throw new Error('the removed model’s residue is still selected: ' + JSON.stringify(after.selected));
    if (after.labels) throw new Error(after.labels + ' label(s) of the removed model left behind');
    if (!after.add) throw new Error('Add or update is still enabled');
    if (!/Removed /.test(after.status)) throw new Error('no status for the removal: ' + after.status);
    /* With the last model gone, a mode left on would have nothing to draw on and a disabled button. */
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.click('#gpv-annotate'); await fresh.waitForTimeout(200);
    await fresh.click('[data-gpv-tab="models"]'); await fresh.click('#gpv-list [data-entry-id="' + first.id + '"] button:has-text("Remove")'); await fresh.waitForTimeout(500);
    if (await fresh.locator('#gpv-stage.is-drawing').count()) throw new Error('drawing stayed on with no model left');
  } finally { await fresh.close(); }
});
await step('Clear all asks before discarding work on one model, and leaves no analysis to attach to the next models', async () => {
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    let asked = '';
    await fresh.click('[data-gpv-tab="compare"]'); await fresh.click('#gpv-align'); await fresh.waitForTimeout(2000);
    await fresh.click('#gpv-rmsd-matrix-run'); await fresh.waitForTimeout(2000);
    const before = await fresh.evaluate(() => ({ matrix: Boolean(window.__viewerDebug.rmsdMatrix()), spread: Boolean(window.__viewerDebug.ensembleSpread()), ids: window.__viewerDebug.entries().map(entry => entry.id) }));
    if (!before.matrix || !before.spread) throw new Error('setup: no matrix or agreement to clear ' + JSON.stringify(before));
    await fresh.click('[data-gpv-tab="models"]');
    fresh.once('dialog', dialog => dialog.accept());
    await fresh.click('#gpv-clear'); await fresh.waitForTimeout(600);
    if ((await freshEntries(fresh)).length) throw new Error('Clear all accepted but models remain');
    await fresh.setInputFiles('#gpv-files', [models[0], models[1]]); await fresh.waitForTimeout(2000);
    const after = await fresh.evaluate(() => ({ matrix: Boolean(window.__viewerDebug.rmsdMatrix()), spread: Boolean(window.__viewerDebug.ensembleSpread()), ids: window.__viewerDebug.entries().map(entry => entry.id), rmsf: document.querySelector('#gpv-rmsf-csv').disabled, matrixHidden: document.querySelector('#gpv-rmsd-matrix-wrap').hidden }));
    if (after.matrix || !after.matrixHidden) throw new Error('the old RMSD matrix survived Clear all');
    if (after.spread || !after.rmsf) throw new Error('the old model agreement survived Clear all');
    if (after.ids.some(id => before.ids.includes(id))) throw new Error('model ids restarted: ' + JSON.stringify({ before: before.ids, after: after.ids }));
    /* One model with a label: Clear all used to ask only with two or more models. */
    const [, second] = await freshEntries(fresh);
    await fresh.click('#gpv-list [data-entry-id="' + second.id + '"] button:has-text("Remove")'); await fresh.waitForTimeout(400);
    await freshGoTo(fresh, 'A:5'); await fresh.click('#gpv-add-label'); await fresh.waitForTimeout(200);
    await fresh.click('[data-gpv-tab="models"]');
    fresh.once('dialog', dialog => { asked = dialog.message(); dialog.dismiss(); });
    await fresh.click('#gpv-clear'); await fresh.waitForTimeout(400);
    if (!asked) throw new Error('Clear all discarded a labelled model without asking');
    if ((await freshEntries(fresh)).length !== 1) throw new Error('Cancel still cleared');
    fresh.once('dialog', dialog => dialog.accept());
    await fresh.click('#gpv-clear'); await fresh.waitForTimeout(600);
    if ((await freshEntries(fresh)).length) throw new Error('Clear all accepted but the labelled model remains');
    await fresh.setInputFiles('#gpv-files', [models[0]]); await fresh.waitForTimeout(2000);
    /* A single model with nothing on it clears without a question. */
    asked = '';
    fresh.once('dialog', dialog => { asked = dialog.message(); dialog.dismiss(); });
    await fresh.click('#gpv-clear'); await fresh.waitForTimeout(400);
    if (asked) throw new Error('asked before clearing one model with no work on it: ' + asked);
    if ((await freshEntries(fresh)).length) throw new Error('one bare model was not cleared');
  } finally { await fresh.close(); }
});

group('navigation');
await step('previous and next', async () => {
  await page.click('#gpv-next'); await page.waitForTimeout(400);
  await page.click('#gpv-previous'); await page.waitForTimeout(400);
});
await step('arrow keys navigate', async () => {
  /* A click on the stage that lands on a residue opens the label editor (2.49.0), which takes the
     focus; Esc closes it and hands the focus back to the stage, where this step wants it. A click on
     a label also makes it the active one, which the arrows would move: a second Esc lets go of it. */
  await page.click('#gpv-stage');
  if (await page.locator('#gpv-label-editor').isVisible()) await page.keyboard.press('Escape');
  if (await page.evaluate(() => Boolean(window.__viewerDebug && window.__viewerDebug.activeText()))) await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
});
await step('stepping to a model from an overlay says it shows one at a time, and remembers the mode', async () => {
  const before = await page.inputValue('#gpv-view-mode');
  try {
    await tab('models'); await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true }));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({ mode: document.querySelector('#gpv-view-mode').value, status: document.querySelector('#gpv-state').textContent, saved: (JSON.parse(localStorage.getItem('protein-structure-viewer:preferences') || '{}') || {})['#gpv-view-mode'] }));
    if (state.mode !== 'single') throw new Error('→ left the view mode at ' + state.mode);
    if (!/one model at a time/.test(state.status)) throw new Error('the switch was not stated: ' + state.status);
    if (state.saved !== 'single') throw new Error('the switched mode was not saved as a preference: ' + state.saved);
  } finally { await page.selectOption('#gpv-view-mode', before); await page.waitForTimeout(300); }
});
await step('the arrows on a tab button or the divider move the tab or the divider, never the model', async () => {
  /* Both controls use ← → themselves (the tablist pattern; resizing from the keyboard). Before
     2.52.0 the page's shortcut took the same key as well, stepped to the next model and switched the
     view to one at a time. */
  const state = () => page.evaluate(() => ({ active: (window.__viewerDebug.activeEntry() || {}).id, mode: document.querySelector('#gpv-view-mode').value }));
  const before = await state();
  try {
    await page.focus('[data-gpv-tab="models"]'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    if (await page.locator('[data-gpv-panel="appearance"]').isHidden()) throw new Error('→ on the Models tab did not open Appearance');
    let after = await state();
    if (after.active !== before.active || after.mode !== before.mode) throw new Error('→ on a tab also changed the model: ' + JSON.stringify({ before, after }));
    if (await page.locator('#gpv-splitter').isVisible()) {
      await page.focus('#gpv-splitter'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(300);
      after = await state();
      if (after.active !== before.active || after.mode !== before.mode) throw new Error('← → on the divider also changed the model: ' + JSON.stringify({ before, after }));
    }
  } finally { await tab('models'); }
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
/* The colour a chain is given overrides chainColor(), which every surface reads, so the check is
   that one edit reaches all of them and that both ways back — one chain, then all of them — return
   the palette colour. The reset is dispatched rather than really double-clicked: a real click on
   <input type="color"> opens the operating system's colour dialog in a headed run, which would hang
   the suite. fill() sets the value and fires input without opening anything. */
await step('a chain takes the colour it is given, in the view, the strip and the key, and gives it back', async () => {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(300);
  await tab('models');
  const picker = page.locator('#gpv-chain-rows input[aria-label="Colour for chain A"]');
  if (!(await picker.count())) throw new Error('no colour picker on the chain A row');
  const snapshot = () => page.evaluate(() => document.querySelector('#gpv-stage canvas').toDataURL());
  const before = await snapshot();
  await picker.fill('#ff00ff'); await page.waitForTimeout(600);
  /* Setting a colour from any other scheme has to switch to chain colouring, or the edit is invisible. */
  const mode = await page.inputValue('#gpv-color-mode');
  if (mode !== 'chain') throw new Error('colour mode after the edit: ' + mode);
  if ((await snapshot()) === before) throw new Error('the custom chain colour did not change the render');
  const key = await page.locator('#gpv-plddt-legend .gpv-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  if (key !== 'rgb(255, 0, 255)') throw new Error('chain A key swatch: ' + key);
  /* Scan the row rather than sample one pixel: the cells are drawn with a gap between them at this
     width, so a single sample can legitimately land on the background. */
  const strip = await page.locator('#gpv-sequence-rows canvas').first().evaluate(canvas => {
    const row = canvas.getContext('2d').getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data;
    let magenta = 0;
    for (let x = 0; x < row.length; x += 4) if (row[x] > 200 && row[x + 1] < 60 && row[x + 2] > 200) magenta += 1;
    return magenta;
  });
  if (!strip) throw new Error('the chain A strip row carries no magenta');
  await picker.dispatchEvent('dblclick'); await page.waitForTimeout(500);
  if ((await picker.inputValue()) !== '#3b82f6') throw new Error('double-click did not restore the palette colour: ' + (await picker.inputValue()));
  await picker.fill('#00ffff'); await page.waitForTimeout(400);
  await page.click('#gpv-chain-colors-reset'); await page.waitForTimeout(500);
  const cleared = await page.locator('#gpv-plddt-legend .gpv-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  if (cleared !== 'rgb(59, 130, 246)') throw new Error('Reset chain colours left chain A at ' + cleared);
  console.log('       view, strip and key all magenta · one chain reset, then all');
});
await step('the figure label editor recolours a chain without leaving the Publish tab', async () => {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(300);
  await tab('publish');
  await page.click('#gpv-labels-edit'); await page.waitForTimeout(300);
  const picker = page.locator('#gpv-labels-rows input[type="color"]').first();
  if (!(await picker.count())) throw new Error('the chain rows carry no colour picker');
  /* 2.46.0 shipped this picker as a 160 px bar: the table's min-width for its text fields caught it too. */
  const pickerWidth = await picker.evaluate(el => el.getBoundingClientRect().width);
  if (pickerWidth > 40) throw new Error('the figure-label colour picker is ' + pickerWidth + ' px wide, not a swatch');
  await picker.fill('#00ff00'); await page.waitForTimeout(600);
  const key = await page.locator('#gpv-plddt-legend .gpv-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  if (key !== 'rgb(0, 255, 0)') throw new Error('key swatch after editing from Publish: ' + key);
  /* One override, not a copy per tab: the Composition table must already agree. */
  await tab('models');
  const mirrored = await page.locator('#gpv-chain-rows input[aria-label="Colour for chain A"]').inputValue();
  if (mirrored !== '#00ff00') throw new Error('the Composition picker shows ' + mirrored);
  await page.click('#gpv-chain-colors-reset'); await page.waitForTimeout(400);
  await tab('publish'); await page.click('#gpv-labels-edit'); await page.waitForTimeout(200);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
});
await step('entity colouring groups the two identical chains and reads as a stoichiometry', async () => {
  await page.selectOption('#gpv-color-mode', 'entity'); await page.waitForTimeout(400);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/α ×2/.test(legend) || !/A, B/.test(legend) || !/30 aa/.test(legend)) throw new Error('legend: ' + legend);
  const summary = (await page.locator('#gpv-assembly-summary').textContent()) || '';
  if (!/Stoichiometry: α ×2/.test(summary) || !/Cα extent \d+\.\d nm · radius of gyration \d+\.\d nm/.test(summary)) throw new Error('summary: ' + summary);
  console.log('       ' + summary.trim());
});
await step('the Cα extent is the exact maximum Cα–Cα distance', async () => {
  const result = await page.evaluate(() => {
    const d = window.__viewerDebug; const entry = d.activeEntry();
    const cas = entry.atoms.filter(atom => atom.atom === 'CA' && !atom.hetflag);
    let best = 0;
    for (let i = 0; i < cas.length; i += 1) for (let j = i + 1; j < cas.length; j += 1) { const dd = (cas[i].x - cas[j].x) ** 2 + (cas[i].y - cas[j].y) ** 2 + (cas[i].z - cas[j].z) ** 2; if (dd > best) best = dd; }
    const size = d.assemblyDimensions(entry); return { brute: Math.sqrt(best), extent: size.extent, exact: size.exact, count: cas.length };
  });
  if (!result.exact || Math.abs(result.brute - result.extent) > 1e-6) throw new Error(JSON.stringify(result));
  console.log('       ' + result.count + ' Cα · extent ' + result.extent.toFixed(3) + ' Å, exact');
});
await step('chain colouring lists the chains in the legend', async () => {
  await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(400);
  const legend = page.locator('#gpv-plddt-legend');
  if (await legend.isHidden()) throw new Error('legend hidden');
  const text = (await legend.textContent()) || '';
  if (!/Chain/.test(text) || !/A/.test(text) || !/B/.test(text)) throw new Error('legend text: ' + text);
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
});
await step('a model with more chains than the fixtures still gets a chain key, wrapped to fit the panel', async () => {
  /* Fourteen short poly-alanine chains — more than the twelve above which 2.44.0 and earlier
     dropped the chain legend entirely, so a chain-coloured figure of an assembly this size (the
     M13 virion has fifteen) printed with no key at all. Since 2.42.0 a legend wraps inside the
     width it is given, so the key must now be drawn whatever the chain count: either naming every
     chain or, past the point where the rows would eat the panel, ending with a '+N more' item. */
  const chains = [...'ABCDEFGHIJKLMN'];
  const lines = []; let serial = 1;
  chains.forEach((chain, index) => {
    for (let residue = 1; residue <= 6; residue += 1) {
      for (const [atom, dx] of [['N', -0.6], ['CA', 0], ['C', 0.6], ['O', 1.0]]) {
        const x = 2.3 * Math.cos(residue) + dx + index * 6; const y = 2.3 * Math.sin(residue); const z = 1.5 * residue;
        lines.push('ATOM  ' + String(serial).padStart(5) + '  ' + atom.padEnd(3) + ' ALA ' + chain + String(residue).padStart(4) + '    ' +
          x.toFixed(3).padStart(8) + y.toFixed(3).padStart(8) + z.toFixed(3).padStart(8) + '  1.00 70.00           ' + atom[0]);
        serial += 1;
      }
    }
    lines.push('TER');
  });
  const file = join(work, 'model_fourteen_chains.pdb'); await writeFile(file, lines.join('\n') + '\nEND\n');
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'models');
  const startColorMode = await page.inputValue('#gpv-color-mode');
  /* Which models were ticked: the extra one is appended last, so once it is removed again the
     original rows are back in their original order and take their own ticks back by index. */
  const startShown = await page.evaluate(() => [...document.querySelectorAll('#gpv-list .gpv-entry input[type="checkbox"]')].map(box => box.checked));
  await tab('publish');
  const startLegendOn = await page.isChecked('#gpv-export-legend');
  const cleanup = async () => {
    await tab('publish');
    await page.setChecked('#gpv-export-legend', startLegendOn); await page.waitForTimeout(150);
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_fourteen_chains' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(500); }
    await page.evaluate(wanted => {
      [...document.querySelectorAll('#gpv-list .gpv-entry input[type="checkbox"]')].forEach((box, index) => {
        if (index < wanted.length && box.checked !== wanted[index]) box.click();
      });
    }, startShown);
    await page.waitForTimeout(600);
    await tab('appearance');
    await page.selectOption('#gpv-color-mode', startColorMode); await page.waitForTimeout(300);
    await tab(startTab);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(2000);
    await page.evaluate(() => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const box = entry.querySelector('input[type="checkbox"]'); const wanted = entry.textContent.includes('model_fourteen_chains');
        if (box && box.checked !== wanted) box.click();
      });
    });
    await page.waitForTimeout(900);
    await tab('publish'); await page.setChecked('#gpv-export-legend', true); await page.waitForTimeout(150);
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(700);
    const seen = await page.evaluate(() => [...new Set(window.__viewerDebug.activeEntry().atoms.map(atom => atom.chain || ''))].length);
    if (seen !== 14) throw new Error('the fixture loaded with ' + seen + ' chains, not 14');
    /* The same measurement the exporters make: the whole figure, and a panel narrow enough that
       the key has to wrap — a cell of a multi-panel figure. */
    const measured = await page.evaluate(() => {
      const debug = window.__viewerDebug; const context = document.createElement('canvas').getContext('2d');
      const plan = debug.exportDimensions(); const wanted = debug.legendWanted('figure');
      const at = (width, height) => {
        const layout = debug.furnitureLayout(width, height, debug.figureScale(plan), null, debug.figurePalette(), wanted);
        const metrics = wanted ? debug.legendMetrics(context, layout.legendScale, 'figure', layout.vertical, layout.legendAvailable) : null;
        return metrics ? { available: Math.round(layout.legendAvailable), width: Math.round(metrics.width), rows: metrics.rows.map(row => row.cells.map(cell => cell.text)) } : null;
      };
      return { wanted, full: at(plan.width, plan.height), narrow: at(600, 400) };
    });
    if (!measured.wanted || !measured.full || !measured.narrow) throw new Error('no chain legend for 14 chains: ' + JSON.stringify(measured));
    /* Every row after the title cell is an entry; the key is honest if it names all fourteen or
       says how many it left out. */
    const items = measured.full.rows.flat().slice(1);
    const namesEvery = chains.every(chain => items.includes(chain));
    const saysHowManyMore = /^\+\d+ more$/.test(items[items.length - 1]);
    if (!namesEvery && !saysHowManyMore) throw new Error('the key neither names every chain nor counts the rest: ' + JSON.stringify(items));
    [['full', measured.full], ['narrow', measured.narrow]].forEach(([where, metrics]) => {
      if (metrics.width > metrics.available + 1) throw new Error('the ' + where + ' legend is ' + metrics.width + ' px wide in ' + metrics.available + ' px');
      if (metrics.rows.some(row => row.some(text => /…/.test(text)))) throw new Error('the ' + where + ' legend truncated a chain name: ' + JSON.stringify(metrics.rows));
    });
    if (measured.narrow.rows.length < 2) throw new Error('the narrow panel did not wrap the key: ' + JSON.stringify(measured.narrow.rows));
    const onScreen = (await page.locator('#gpv-plddt-legend').textContent()) || '';
    if (await page.locator('#gpv-plddt-legend').isHidden()) throw new Error('the on-screen legend is hidden with 14 chains');
    if (!/Chain/.test(onScreen) || !/N/.test(onScreen)) throw new Error('on-screen legend: ' + onScreen);
    await tab('publish');
    const download = page.waitForEvent('download', { timeout: 180000 });
    await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const drawn = namesEvery ? chains : items;
    const missing = drawn.filter(label => !svg.includes('>' + label + '</text>'));
    if (missing.length) throw new Error('the figure SVG is missing legend labels: ' + missing.join(', '));
    console.log('       14 chains · key in ' + measured.full.rows.length + ' row' + (measured.full.rows.length === 1 ? '' : 's') +
      ' (' + measured.full.width + ' px in ' + measured.full.available + '), ' + measured.narrow.rows.length + ' rows in a 600 px panel · ' +
      (namesEvery ? 'every chain named' : 'abbreviated with ' + items[items.length - 1]) + ' · same labels in the SVG');
  } finally {
    await cleanup();
  }
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
await step('on-screen labels are legible in light and dark themes', async () => {
  /* The theme's colour tokens are light-dark() and color-mix() expressions. Before 2.46.3 labels read
     them raw, 3Dmol parsed each as black, and every on-screen label was a black box with black text. */
  await tab('appearance'); const backgroundBefore = await page.inputValue('#gpv-background');
  await page.selectOption('#gpv-background', 'transparent'); await page.waitForTimeout(200);
  const read = () => page.evaluate(() => {
    const d = window.__viewerDebug; const style = d.labelStyle({ x: 0, y: 0, z: 0 }, {});
    return { font: style.fontColor, paper: style.backgroundColor, border: style.borderColor, muted: d.themeColor('--muted-foreground', 'fallback') };
  });
  const results = {};
  try {
    for (const mode of ['light', 'dark']) {
      for (let i = 0; i < 3 && (await page.locator('#gpv-theme').getAttribute('data-mode')) !== mode; i += 1) { await page.click('#gpv-theme'); await page.waitForTimeout(250); }
      const style = await read();
      for (const [key, value] of Object.entries(style)) if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(mode + ' ' + key + ' is not a resolved colour: ' + value);
      const contrast = await page.evaluate(([a, b]) => Math.abs(window.__viewerDebug.hexLuminance(a) - window.__viewerDebug.hexLuminance(b)), [style.font, style.paper]);
      if (contrast < 0.5) throw new Error(mode + ' label text ' + style.font + ' on ' + style.paper + ' has luminance contrast ' + contrast.toFixed(2));
      results[mode] = style;
    }
    if (results.light.paper === results.dark.paper) throw new Error('label paper does not follow the theme: ' + results.light.paper);
    console.log('       light ' + results.light.font + ' on ' + results.light.paper + ' · dark ' + results.dark.font + ' on ' + results.dark.paper);
  } finally {
    for (let i = 0; i < 3 && (await page.locator('#gpv-theme').getAttribute('data-mode')) !== 'system'; i += 1) { await page.click('#gpv-theme'); await page.waitForTimeout(250); }
    await page.selectOption('#gpv-background', backgroundBefore); await page.waitForTimeout(200);
  }
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
await step('deviation colouring says to align first, and lists its bands after alignment', async () => {
  /* Before an alignment the legend is a screen note, not a band key over grey (2.52.0). */
  await page.selectOption('#gpv-color-mode', 'deviation'); await page.waitForTimeout(500);
  const before = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Grey until models are aligned/.test(before) || /unmatched/.test(before)) throw new Error('legend before an alignment: ' + before);
  await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(500);
  await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(3000);
  const text = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  await page.click('#gpv-restore'); await page.waitForTimeout(800); await tab('appearance');
  if (!/Cα deviation/.test(text) || !/<1 Å/.test(text) || !/unmatched/.test(text)) throw new Error('legend text after aligning: ' + text);
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
await step('Emphasise draws one model solid, fades and thins the others, and pressing it again restores them', async () => {
  await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(400);
  const viewBefore = await page.inputValue('#gpv-view-mode'); await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(600);
  const rows = page.locator('#gpv-list .gpv-entry');
  if ((await rows.count()) < 3) throw new Error('expected at least three models, found ' + (await rows.count()));
  /* Whatever happens, no model may stay faded for the steps that follow. */
  const cleanup = async () => {
    await tab('models');
    const fades = rows.locator('input[aria-label^="Fade"]');
    for (let index = 0; index < await fades.count(); index += 1) if (await fades.nth(index).isChecked()) await fades.nth(index).click();
    await page.selectOption('#gpv-view-mode', viewBefore); await page.waitForTimeout(400);
  };
  try {
    await rows.nth(0).locator('button:has-text("Emphasise")').click(); await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const d = window.__viewerDebug; const shown = d.entries().filter(entry => entry.visible && entry.model);
      const luminance = hex => { const v = hex.slice(1); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0); };
      const other = shown[1]; const atom = other.atoms.find(item => item.atom === 'CA');
      const drawn = () => { const options = d.colorOptions(other); return options.colorfunc ? options.colorfunc(atom) : options.color; };
      const fadedColour = drawn(); other.faded = false; const plainColour = drawn(); other.faded = true;
      return { flags: shown.map(entry => Boolean(entry.faded)), fadedLuminance: luminance(fadedColour), plainLuminance: luminance(plainColour) };
    });
    if (state.flags[0] !== false || !state.flags.slice(1).every(Boolean)) throw new Error('fade flags after Emphasise: ' + JSON.stringify(state.flags));
    if (!(state.fadedLuminance > state.plainLuminance + 0.05)) throw new Error('the faded model is not drawn lighter: ' + state.fadedLuminance.toFixed(3) + ' against ' + state.plainLuminance.toFixed(3));
    const switches = await rows.locator('input[aria-label^="Fade"]').evaluateAll(list => list.map(input => input.checked));
    if (switches[0] !== false || !switches.slice(1).every(Boolean)) throw new Error('fade switches do not reflect the emphasis: ' + JSON.stringify(switches));
    /* The Model legend (overlay view, colour per structure) shows the tint the faded models are drawn in. */
    await tab('appearance'); const modeBefore = await page.inputValue('#gpv-color-mode'); await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(500);
    const legend = await page.evaluate(() => { const d = window.__viewerDebug; const shown = d.displayedEntries().filter(entry => entry.model); const swatches = [...document.querySelectorAll('#gpv-plddt-legend .gpv-swatch')].map(el => getComputedStyle(el).backgroundColor); const rgb = hex => { const v = hex.slice(1); return 'rgb(' + [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)).join(', ') + ')'; }; return { swatches, full: shown.map(entry => rgb(entry.color)), text: document.querySelector('#gpv-plddt-legend').textContent }; });
    if (legend.swatches.length < 3) throw new Error('the Model legend did not appear: ' + JSON.stringify(legend));
    if (legend.swatches[0] !== legend.full[0]) throw new Error('the emphasised model lost its colour in the legend: ' + legend.swatches[0] + ' against ' + legend.full[0]);
    if (legend.swatches[1] === legend.full[1] || !/faded/.test(legend.text)) throw new Error('the legend does not show the faded tint: ' + JSON.stringify(legend));
    await page.selectOption('#gpv-color-mode', modeBefore); await page.waitForTimeout(300); await tab('models');
    await rows.nth(0).locator('button:has-text("Emphasise")').click(); await page.waitForTimeout(700);
    const restored = await page.evaluate(() => window.__viewerDebug.entries().filter(entry => entry.visible && entry.model).every(entry => !entry.faded));
    if (!restored) throw new Error('pressing Emphasise again did not restore the other models');
    console.log('       emphasised the first model · the others drawn at luminance ' + state.fadedLuminance.toFixed(2) + ' against ' + state.plainLuminance.toFixed(2) + ' · legend shows the tint · restored');
  } finally { await cleanup(); }
});
await step('undo takes back Emphasise, a renamed legend entry and MSA colouring, not just their names', async () => {
  /* Before 2.52.0 these steps took an undo step that restored nothing: the status said "Undid
     emphasis" and the models stayed faded. */
  await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(400);
  const faded = () => page.evaluate(() => window.__viewerDebug.entries().map(entry => Boolean(entry.faded)));
  const rows = page.locator('#gpv-list .gpv-entry');
  const before = await faded();
  try {
    await rows.nth(0).locator('button:has-text("Emphasise")').click(); await page.waitForTimeout(500);
    if (JSON.stringify(await faded()) === JSON.stringify(before)) throw new Error('setup: Emphasise faded nothing');
    await undoOnce();
    if (JSON.stringify(await faded()) !== JSON.stringify(before)) throw new Error('undo left the emphasis: ' + JSON.stringify(await faded()));
    if (!/Undid emphasis/.test(await page.locator('#gpv-state').textContent())) throw new Error('status: ' + await page.locator('#gpv-state').textContent());
  } finally {
    const fades = rows.locator('input[aria-label^="Fade"]');
    for (let index = 0; index < await fades.count(); index += 1) if (await fades.nth(index).isChecked() !== before[index]) await fades.nth(index).click();
  }
  /* A renamed legend title: the step is taken before the first keystroke, so undo restores the name
     the legend had before, not the one just typed. */
  await tab('appearance'); const modeBefore = await page.inputValue('#gpv-color-mode'); await page.selectOption('#gpv-color-mode', 'chain'); await page.waitForTimeout(300);
  try {
    await tab('publish'); if (await page.locator('#gpv-labels-wrap').isHidden()) await page.click('#gpv-labels-edit'); await page.waitForTimeout(200);
    const title = page.locator('#gpv-labels-rows input[data-gpv-label-key="chain|title"]');
    await title.fill('Renamed chains'); await title.press('Tab'); await page.waitForTimeout(300);
    const labels = () => page.evaluate(() => JSON.stringify(window.__viewerDebug.sceneSettings().figureLabels || {}));
    if (!/Renamed chains/.test(await labels())) throw new Error('setup: the title was not renamed: ' + await labels());
    await undoOnce();
    if (/Renamed chains/.test(await labels())) throw new Error('undo left the renamed legend title: ' + await labels());
  } finally {
    if (await page.locator('#gpv-labels-reset').isEnabled()) { await page.click('#gpv-labels-reset'); await page.waitForTimeout(200); }
    if (!(await page.locator('#gpv-labels-wrap').isHidden())) await page.click('#gpv-labels-edit');
    await tab('appearance'); await page.selectOption('#gpv-color-mode', modeBefore); await page.waitForTimeout(300);
  }
  /* MSA colouring changes the per-residue data and the colour scheme; undo takes both back. The
     alignment is the one the a3m step wrote; the reload since has dropped it, so it goes in again. */
  await page.setInputFiles('#gpv-files', [join(work, 'fixture_unpaired_msa_chains_a_b.a3m')]); await page.waitForTimeout(800);
  await tab('confidence');
  if (await page.locator('#gpv-msa-paint').isDisabled()) throw new Error('setup: no alignment to paint with: ' + await page.locator('#gpv-msa-state').textContent());
  const dataBefore = await page.evaluate(() => Boolean(window.__viewerDebug.residueData()));
  const schemeBefore = await page.inputValue('#gpv-color-mode');
  try {
    await page.click('#gpv-msa-paint'); await page.waitForTimeout(500);
    if ((await page.inputValue('#gpv-color-mode')) !== 'data') throw new Error('setup: MSA colouring did not switch to data');
    await undoOnce();
    const after = await page.evaluate(() => ({ data: Boolean(window.__viewerDebug.residueData()), mode: document.querySelector('#gpv-color-mode').value }));
    if (after.data !== dataBefore || after.mode !== schemeBefore) throw new Error('undo of MSA colouring left ' + JSON.stringify(after) + ', expected ' + JSON.stringify({ data: dataBefore, mode: schemeBefore }));
  } finally {
    if (!dataBefore && await page.evaluate(() => Boolean(window.__viewerDebug.residueData()))) { await tab('annotate'); await page.click('#gpv-data-clear'); }
    await tab('appearance'); await page.selectOption('#gpv-color-mode', schemeBefore); await page.waitForTimeout(300); await tab('models');
  }
});
await step('identical chains are re-paired by position when a model places the same subunit elsewhere', async () => {
  /* The fixture's two chains carry the same sequence, so every chain pairs equally well and the
     pairing falls back on the order the chains appear in the file. This copy swaps both the chain
     names and that order, which is what a prediction placing the same subunit elsewhere looks like:
     pairing then compares each chain with the wrong copy, and positional matching undoes it. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const isAtom = line => /^(ATOM|HETATM)/.test(line) && 'AB'.includes(line[21]);
  const rename = (line, chain) => line.slice(0, 21) + chain + line.slice(22);
  const swapped = [
    ...original.filter(line => isAtom(line) && line[21] === 'B').map(line => rename(line, 'A')),
    'TER',
    ...original.filter(line => isAtom(line) && line[21] === 'A').map(line => rename(line, 'B')),
    'TER', 'END', ''
  ].join('\n');
  const file = join(work, 'model_swapped.pdb'); await writeFile(file, swapped);
  const cleanup = async () => {
    await tab('compare'); await page.uncheck('#gpv-chain-position');
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_swapped' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(2500);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    const only = async names => page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, names);
    await only(['model_a.pdb', 'model_swapped.pdb']); await page.waitForTimeout(900);
    await tab('compare');
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_a\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    const rowFor = async () => {
      const rows = await page.locator('#gpv-alignment-results tr').evaluateAll(list => list.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)));
      const row = rows.find(cells => /model_swapped/.test(cells[0]));
      if (!row) throw new Error('no row for the swapped model: ' + JSON.stringify(rows));
      return { rmsd: Number(row[4]), mapping: row[7] };
    };
    await page.uncheck('#gpv-chain-position'); await page.click('#gpv-align'); await page.waitForTimeout(3000);
    const byName = await rowFor();
    await page.check('#gpv-chain-position'); await page.click('#gpv-align'); await page.waitForTimeout(3000);
    const byPosition = await rowFor();
    if (!(byName.rmsd > 1)) throw new Error('pairing in file order should compare the wrong copies: RMSD ' + byName.rmsd);
    if (!(byPosition.rmsd < byName.rmsd / 2)) throw new Error('pairing by position did not improve the fit: ' + byPosition.rmsd + ' against ' + byName.rmsd);
    if (!/A→B/.test(byPosition.mapping) || !/B→A/.test(byPosition.mapping)) throw new Error('the chain mapping was not swapped: ' + byPosition.mapping);
    if (!/matched by position/.test(byPosition.mapping)) throw new Error('the method does not say chains were matched by position: ' + byPosition.mapping);
    console.log('       swapped copies: ' + byName.rmsd.toFixed(2) + ' Å in file order → ' + byPosition.rmsd.toFixed(2) + ' Å by position · ' + byPosition.mapping);
  } finally { await cleanup(); }
});
await step('model agreement matches residues through the superposition when models number them differently', async () => {
  /* The same coordinates with every residue numbered 10 higher, as a model whose numbering is
     offset from the reference's (an AlphaFold DB model keeps the initiator Met a crystal structure's
     mature chain lacks). Before 2.46.3 the RMSF pooled Cα by chain and residue *number*, so it
     averaged each residue with the one ten positions away and reported a large spread for two
     identical structures. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const shifted = original.filter(line => /^(ATOM|HETATM)/.test(line))
    .map(line => line.slice(0, 22) + String(Number(line.slice(22, 26)) + 10).padStart(4) + line.slice(26))
    .concat(['END', '']).join('\n');
  const file = join(work, 'model_renumbered.pdb'); await writeFile(file, shifted);
  await tab('appearance'); const modeBefore = await page.inputValue('#gpv-color-mode');
  const cleanup = async () => {
    await tab('appearance'); await page.selectOption('#gpv-color-mode', modeBefore); await page.waitForTimeout(200);
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_renumbered' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(2500);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    await page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, ['model_a.pdb', 'model_renumbered.pdb']);
    await page.waitForTimeout(900);
    await tab('compare');
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_a\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.uncheck('#gpv-chain-position');
    await page.click('#gpv-align'); await page.waitForTimeout(3000);
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'agreement'); await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const d = window.__viewerDebug; const spread = d.ensembleSpread();
      if (!spread) return null;
      const renumbered = d.entries().find(e => /model_renumbered/.test(e.name));
      const atom = renumbered.atoms.find(a => a.atom === 'CA' && a.resi === 15 && (a.chain || '') === 'A');
      return { size: spread.values.size, max: spread.max, count: spread.count, painted: d.colorOptions(renumbered).colorfunc(atom) };
    });
    if (!state) throw new Error('no ensemble spread after aligning the renumbered copy');
    if (state.count !== 2) throw new Error('ensemble counts ' + state.count + ' models, expected 2');
    if (state.size < 50) throw new Error('only ' + state.size + ' residues were matched');
    if (!(state.max < 0.01)) throw new Error('identical structures report an RMSF of up to ' + state.max.toFixed(2) + ' Å');
    if (state.painted !== '#2563eb') throw new Error('the renumbered model’s residue 15 is painted ' + state.painted + ', not the <0.5 Å band');
    console.log('       ' + state.size + ' residues matched across a +10 numbering offset · max RMSF ' + state.max.toFixed(4) + ' Å');
  } finally { await cleanup(); }
});
await step('a positional re-pairing that fits worse is discarded whole, leaving the table, the coordinates and the deviations agreeing', async () => {
  /* Matching identical chains by position is a heuristic on centres of mass, and positionalPairs()
     says where it misleads: subunits closer to each other than to their partners. This pair of
     files is that case. Both chains carry the same sequence but different conformations — a plain
     helix and a twisted one — and their centres sit 0.6 Å apart, with the copy placing each
     conformation at the other's centre. Pairing in file order compares like with like; re-pairing
     by position lines the centres up exactly and then compares the plain helix against the twisted
     one, which fits far worse, so the second pass is rejected. What is checked here is that the
     rejected pass leaves no trace: the atoms on screen, the pairing kept for the deviations and the
     RMSD in the table must all describe the one fit that was applied. */
  const isAtom = line => /^(ATOM|HETATM)/.test(line);
  const position = line => [Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))];
  const withPosition = (line, point) => line.slice(0, 30) + point.map(value => value.toFixed(3).padStart(8)).join('') + line.slice(54);
  const centre = lines => {
    const alpha = lines.filter(line => line.slice(12, 16).trim() === 'CA').map(position);
    return [0, 1, 2].map(axis => alpha.reduce((sum, point) => sum + point[axis], 0) / alpha.length);
  };
  /* One chain of an existing fixture, moved so its Cα centre of mass sits exactly on `at` and renamed. */
  const place = (lines, at, chain) => {
    const from = centre(lines);
    return lines.map(line => {
      const moved = withPosition(line, position(line).map((value, axis) => value - from[axis] + at[axis]));
      return moved.slice(0, 21) + chain + moved.slice(22);
    });
  };
  const chainA = text => text.split('\n').filter(line => isAtom(line) && line[21] === 'A');
  const plain = chainA(await readFile(join(work, 'model_a.pdb'), 'utf8'));
  const twisted = chainA(await readFile(join(work, 'model_c.pdb'), 'utf8'));
  const assembly = (plainAt, twistedAt) => {
    let serial = 0;
    return [...place(plain, plainAt, 'A'), 'TER', ...place(twisted, twistedAt, 'B'), 'TER', 'END', '']
      .map(line => (isAtom(line) ? line.slice(0, 6) + String(serial += 1).padStart(5) + line.slice(11) : line)).join('\n');
  };
  const referenceFile = join(work, 'model_twins.pdb');
  const movedFile = join(work, 'model_twins_moved.pdb');
  await writeFile(referenceFile, assembly([0, 0, 0], [0.6, 0, 0]));
  await writeFile(movedFile, assembly([0.6, 0, 0], [0, 0, 0]));
  const cleanup = async () => {
    await tab('compare'); await page.uncheck('#gpv-chain-position');
    await tab('models');
    for (const label of ['model_twins_moved.pdb', 'model_twins.pdb']) {
      const row = page.locator('#gpv-list .gpv-entry', { hasText: label });
      if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(2500);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [referenceFile, movedFile]); await page.waitForTimeout(2200);
    await page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, ['model_twins.pdb', 'model_twins_moved.pdb']);
    await page.waitForTimeout(900);
    await tab('compare');
    await page.selectOption('#gpv-alignment-mode', 'sequence'); await page.waitForTimeout(200);
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_twins\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    const rowFor = async () => {
      const rows = await page.locator('#gpv-alignment-results tr').evaluateAll(list => list.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)));
      const row = rows.find(cells => /model_twins_moved/.test(cells[0]));
      if (!row) throw new Error('no row for the moved copy: ' + JSON.stringify(rows));
      return { count: Number(row[2]), rmsd: Number(row[4]), mapping: row[7] };
    };
    await page.uncheck('#gpv-chain-position'); await page.click('#gpv-align'); await page.waitForTimeout(3000);
    const bySequence = await rowFor();
    await page.check('#gpv-chain-position'); await page.click('#gpv-align'); await page.waitForTimeout(3000);
    const byPosition = await rowFor();
    /* What is on screen after the rejected pass: the fit the table claims, or the one thrown away? */
    const drawn = await page.evaluate(() => {
      const tag = atom => (atom.chain || '') + '|' + atom.resi;
      const entries = window.__viewerDebug.entries();
      const reference = entries.find(entry => /^model_twins\.pdb/.test(entry.name));
      const moved = entries.find(entry => /^model_twins_moved/.test(entry.name));
      const alpha = new Map(reference.atoms.filter(atom => atom.atom === 'CA').map(atom => [tag(atom), atom]));
      let squared = 0; let deviationGap = 0;
      moved.alignedPairs.forEach((atom, key) => {
        const anchor = alpha.get(key);
        const distance = Math.hypot(anchor.x - atom.x, anchor.y - atom.y, anchor.z - atom.z);
        squared += distance * distance;
        /* One model was aligned, so the reference's mean deviation is that one distance; a second
           pass left in the samples would average two. */
        deviationGap = Math.max(deviationGap, Math.abs(reference.deviations.get(key) - distance));
      });
      /* Centres of mass in the frame on screen: does the fixture actually tempt the re-pairing? */
      const centres = entry => {
        const chains = new Map();
        entry.atoms.filter(atom => atom.atom === 'CA').forEach(atom => { if (!chains.has(atom.chain)) chains.set(atom.chain, []); chains.get(atom.chain).push(atom); });
        return new Map([...chains].map(([chain, atoms]) => [chain, ['x', 'y', 'z'].map(axis => atoms.reduce((sum, atom) => sum + atom[axis], 0) / atoms.length)]));
      };
      const here = centres(reference); const there = centres(moved);
      const apart = (left, right) => Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
      return {
        rmsd: Math.sqrt(squared / moved.alignedPairs.size), pairs: moved.alignedPairs.size, deviationGap,
        matched: apart(here.get('A'), there.get('A')), crossed: apart(here.get('A'), there.get('B'))
      };
    });
    if (!(bySequence.rmsd > 0.4 && bySequence.rmsd < 0.9)) throw new Error('pairing in file order should compare like with like, 0.6 Å apart: RMSD ' + bySequence.rmsd);
    if (!(drawn.crossed < drawn.matched)) throw new Error('the fixture does not tempt positional matching: centres ' + drawn.crossed.toFixed(2) + ' Å crossed against ' + drawn.matched.toFixed(2) + ' Å matched');
    if (/matched by position/.test(byPosition.mapping)) throw new Error('the worse positional re-pairing was applied: ' + byPosition.mapping);
    if (!/A→A/.test(byPosition.mapping) || !/B→B/.test(byPosition.mapping)) throw new Error('the chain mapping should be the one in file order: ' + byPosition.mapping);
    if (Math.abs(byPosition.rmsd - bySequence.rmsd) > 0.005 || byPosition.count !== bySequence.count) throw new Error('a rejected second pass changed the result: ' + byPosition.rmsd + ' Å over ' + byPosition.count + ' pairs against ' + bySequence.rmsd + ' Å over ' + bySequence.count);
    if (drawn.pairs !== byPosition.count) throw new Error('the table counts ' + byPosition.count + ' pairs, the kept pairing ' + drawn.pairs);
    if (Math.abs(drawn.rmsd - byPosition.rmsd) > 0.005) throw new Error('the table reports ' + byPosition.rmsd + ' Å but the coordinates on screen are ' + drawn.rmsd.toFixed(3) + ' Å apart — a discarded fit was left in place');
    if (drawn.deviationGap > 0.005) throw new Error("the reference's mean deviation is not the distance on screen: off by " + drawn.deviationGap.toFixed(3) + ' Å — the discarded pass left its samples behind');
    console.log('       misleading centres: ' + drawn.crossed.toFixed(2) + ' Å crossed against ' + drawn.matched.toFixed(2) + ' Å matched · kept ' + byPosition.rmsd.toFixed(2) + ' Å in file order, drawn ' + drawn.rmsd.toFixed(2) + ' Å');
  } finally { await cleanup(); }
});
await step('the pairwise RMSD matrix agrees with the alignment table and exports as CSV, PNG, SVG and a composite panel', async () => {
  await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(400);
  const viewBefore = await page.inputValue('#gpv-view-mode'); await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(500);
  try {
    await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(2500);
    const table = await page.locator('#gpv-alignment-results tr').evaluateAll(list => list.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)));
    await page.click('#gpv-rmsd-matrix-run'); await page.waitForTimeout(1500);
    const matrix = await page.evaluate(() => { const m = window.__viewerDebug.rmsdMatrix(); return m && { names: m.names, values: m.values }; });
    if (!matrix || matrix.names.length < 3) throw new Error('matrix missing or too small: ' + JSON.stringify(matrix && matrix.names));
    const n = matrix.names.length;
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
      if (i === j && matrix.values[i][j] !== 0) throw new Error('diagonal is not zero at ' + i);
      if (Math.abs(matrix.values[i][j] - matrix.values[j][i]) > 1e-9) throw new Error('matrix is not symmetric at ' + i + ',' + j);
    }
    /* Row of the reference against the table: the same superposition, so the same number. */
    const reference = table[0][1]; const r = matrix.names.indexOf(reference); if (r < 0) throw new Error('reference ' + reference + ' not in the matrix ' + matrix.names.join(', '));
    table.forEach(cells => { const c = matrix.names.indexOf(cells[0]); if (c < 0) return; const tableRmsd = Number(cells[4]); if (Math.abs(matrix.values[r][c] - tableRmsd) > 0.005) throw new Error(cells[0] + ': matrix ' + matrix.values[r][c].toFixed(3) + ' against table ' + tableRmsd); });
    const shown = await page.locator('#gpv-rmsd-matrix-body tr').count(); if (shown !== n) throw new Error('table rows ' + shown + ' for ' + n + ' models');
    /* The medoid is the model with the lowest mean RMSD to the others; here a and b share a backbone, so it is one of them. */
    const medoid = await page.evaluate(() => window.__viewerDebug.rmsdMedoid());
    if (!medoid || !/model_[ab]\.pdb/.test(medoid.name)) throw new Error('medoid: ' + JSON.stringify(medoid));
    const means = matrix.values.map((row, i) => row.filter((value, j) => j !== i).reduce((sum, value) => sum + value, 0) / (n - 1));
    if (Math.abs(medoid.mean - Math.min(...means)) > 1e-9) throw new Error('medoid mean ' + medoid.mean + ' is not the smallest of ' + means.map(value => value.toFixed(3)).join(', '));
    const starred = await page.locator('#gpv-rmsd-matrix-body th').allTextContents(); if (starred.filter(text => text.startsWith('★')).length !== 1) throw new Error('exactly one row should carry the medoid star: ' + JSON.stringify(starred));
    const button = (await page.locator('#gpv-rmsd-medoid').textContent()) || ''; if (!/^Use .* as reference$/.test(button) || await page.locator('#gpv-rmsd-medoid').isDisabled()) throw new Error('medoid button: ' + button);
    await page.click('#gpv-rmsd-medoid'); await page.waitForTimeout(2500);
    const afterMedoid = await page.evaluate(() => { const d = window.__viewerDebug; const select = document.querySelector('#gpv-reference'); const referenceName = select.selectedOptions[0].textContent; const shownEntries = d.entries().filter(entry => entry.visible && entry.model); return { referenceName, faded: shownEntries.map(entry => Boolean(entry.faded)), solid: shownEntries.filter(entry => !entry.faded).map(entry => entry.name), rows: d.alignmentResults().length }; });
    if (!afterMedoid.referenceName.includes(medoid.name)) throw new Error('the reference was not set to the medoid: ' + afterMedoid.referenceName);
    if (afterMedoid.solid.length !== 1 || afterMedoid.solid[0] !== medoid.name || afterMedoid.faded.filter(Boolean).length !== n - 1) throw new Error('emphasis after medoid: ' + JSON.stringify(afterMedoid));
    if (afterMedoid.rows !== n - 1) throw new Error('models were not re-superposed onto the medoid: ' + afterMedoid.rows + ' results');
    /* Put the emphasis and the reference back for the steps that follow. */
    await page.evaluate(() => { [...document.querySelectorAll('#gpv-list .gpv-entry input[aria-label^="Fade"]')].forEach(input => { if (input.checked) input.click(); }); });
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_a\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#gpv-align'); await page.waitForTimeout(2500);
    let download = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-rmsd-matrix-csv');
    const csv = await readFile(await (await download).path(), 'utf8');
    if (!csv.startsWith('"model",') || !/"ca_pairs"/.test(csv) || !/chains_by_position=/.test(csv)) throw new Error('matrix CSV: ' + csv.slice(0, 120));
    download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-rmsd-matrix-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const cells = (svg.match(/<rect /g) || []).length; if (!/id="rmsd-matrix"/.test(svg) || cells < n * n || !/Cα RMSD/.test(svg)) throw new Error('matrix SVG: ' + cells + ' rects');
    download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-rmsd-matrix-png');
    const png = await readFile(await (await download).path()); if (png.readUInt32BE(16) < 300) throw new Error('matrix PNG too small: ' + png.readUInt32BE(16));
    await tab('publish'); if (await page.locator('#gpv-composite-matrix').isDisabled()) throw new Error('the composite figure does not offer the matrix panel');
    await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
    if (!/Pairwise Cα RMSDs between the \d+ (shown )?models/.test(await page.inputValue('#gpv-methods-field'))) throw new Error('the methods text does not describe the matrix');
    const off = matrix.values.flatMap((row, i) => row.filter((value, j) => j > i));
    console.log('       ' + n + ' × ' + n + ' · ' + Math.min(...off).toFixed(2) + ' to ' + Math.max(...off).toFixed(2) + ' Å · row of ' + reference.replace(/\.pdb$/, '') + ' matches the alignment table · medoid ' + medoid.name.replace(/\.pdb$/, '') + ' (mean ' + medoid.mean.toFixed(2) + ' Å) used as reference');
  } finally { await tab('models'); await page.selectOption('#gpv-view-mode', viewBefore); await page.waitForTimeout(300); await tab('compare'); }
});
await step('the RMSF profile plots one panel per chain with the agreement bands, as SVG, PNG and a composite panel', async () => {
  await tab('compare');
  if (await page.locator('#gpv-rmsf-svg').isDisabled()) { await page.click('#gpv-align'); await page.waitForTimeout(2500); }
  if (await page.locator('#gpv-rmsf-svg').isDisabled()) throw new Error('RMSF profile buttons stayed disabled after aligning');
  let download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-rmsf-svg');
  const svg = await readFile(await (await download).path(), 'utf8');
  const chains = (svg.match(/<g id="chain-/g) || []).length; const traces = (svg.match(/stroke-width="1.8"/g) || []).length;
  if (chains !== 2 || traces !== 2 || !/Per-residue Cα RMSF across \d+ models/.test(svg) || !/RMSF \(Å\)/.test(svg) || !/&lt;0\.5 Å/.test(svg)) throw new Error('RMSF SVG: ' + chains + ' chains, ' + traces + ' traces');
  download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-rmsf-png');
  const png = await readFile(await (await download).path()); const width = png.readUInt32BE(16);
  const expected = Number(((await page.locator('#gpv-export-estimate').textContent()) || '').match(/^(\d+) ×/)[1]);
  if (width < 1200 || Math.abs(width - Math.max(1200, expected)) > 2) throw new Error('RMSF PNG width ' + width + ' against an estimate of ' + expected);
  await tab('publish'); if (await page.locator('#gpv-composite-rmsf').isDisabled()) throw new Error('the composite figure does not offer the RMSF panel'); await tab('compare');
  console.log('       2 chains · trace per chain · PNG ' + width + ' px wide · composite panel offered');
});
await step('the model legend drops the shared part of long run file names', async () => {
  const cases = await page.evaluate(() => {
    const shorten = window.__viewerDebug.distinguishingNames;
    return {
      run: shorten(['fold_m13_virion_round_tip_model_0.cif', 'fold_m13_virion_round_tip_model_1.cif', 'fold_m13_virion_round_tip_model_4.cif']),
      mixed: shorten(['4hhb.cif', 'AF-P69905-F1.cif']),
      tiny: shorten(['model_a.pdb', 'model_b.pdb']),
      single: shorten(['fold_only_model_0.cif'])
    };
  });
  if (cases.run.join('|') !== 'model_0|model_1|model_4') throw new Error('run names: ' + JSON.stringify(cases.run));
  if (cases.mixed.join('|') !== '4hhb|AF-P69905-F1') throw new Error('mixed names: ' + JSON.stringify(cases.mixed));
  if (cases.tiny.join('|') !== 'model_a|model_b') throw new Error('short names should keep enough to read: ' + JSON.stringify(cases.tiny));
  if (cases.single.join('|') !== 'fold_only_model_0.cif') throw new Error('a single name should be left alone: ' + JSON.stringify(cases.single));
  console.log('       ' + cases.run.join(', ') + ' · ' + cases.mixed.join(', '));
});
await step('the superposition can be fitted on one region, reporting that RMSD beside the overall one', async () => {
  await tab('compare');
  /* However this ends, leave the tab and the fit scope as the later steps expect them. */
  const restore = async () => { await tab('compare'); await page.selectOption('#gpv-fit-scope', 'all'); await page.waitForTimeout(200); await page.click('#gpv-align'); await page.waitForTimeout(2500); };
  try {
  await page.click('#gpv-align'); await page.waitForTimeout(2500);
  const whole = await page.locator('#gpv-alignment-results tr').nth(1).locator('td').allTextContents();
  if (whole[3] !== 'all matched') throw new Error('the default fit is not over everything: ' + whole[3]);
  await page.selectOption('#gpv-fit-scope', 'region');
  await page.fill('#gpv-fit-region', 'A:1-12'); await page.waitForTimeout(300);
  const hint = (await page.locator('#gpv-fit-state').textContent()) || '';
  if (!/Fitting on chain A residues 1-12/.test(hint)) throw new Error('fit hint: ' + hint);
  await page.click('#gpv-align'); await page.waitForTimeout(2500);
  const fitted = await page.locator('#gpv-alignment-results tr').nth(1).locator('td').allTextContents();
  if (fitted[0] !== whole[0]) throw new Error('the matched pairs changed with the fit region: ' + fitted[0] + ' against ' + whole[0]);
  if (!/^chain A residues 1-12 · 12 Cα$/.test(fitted[3])) throw new Error('fitted-on cell: ' + fitted[3]);
  if (!(Number(fitted[4]) <= Number(fitted[2]) + 1e-6)) throw new Error('the fitted RMSD ' + fitted[4] + ' is not at or below the overall ' + fitted[2]);
  const csvDownload = page.waitForEvent('download', { timeout: 60000 }); await page.click('#gpv-alignment-csv');
  const csv = (await readFile(await (await csvDownload).path(), 'utf8')).split('\n');
  if (!/"fitted_on","fit_ca_pairs","fit_rmsd_angstrom"/.test(csv[0])) throw new Error('CSV header: ' + csv[0]);
  if (!/"chain A residues 1-12","12"/.test(csv[1])) throw new Error('CSV row: ' + csv[1]);
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(300);
  if (!/the rotation was computed from chain A residues 1-12 alone/.test(await page.inputValue('#gpv-methods-field'))) throw new Error('the methods text does not name the fitted region');
  await tab('publish'); await page.click('#gpv-figure-legend'); await page.waitForTimeout(300);
  if (!/fitting on chain A residues 1-12/.test(await page.inputValue('#gpv-legend-text'))) throw new Error('the figure legend does not name the fitted region');
  await tab('compare');
  await page.selectOption('#gpv-fit-scope', 'selection'); await page.waitForTimeout(200);
  const none = (await page.locator('#gpv-fit-state').textContent()) || '';
  if (!/No residues are selected/.test(none)) throw new Error('selection fit state: ' + none);
  console.log('       12 Cα of chain A · fitted RMSD ' + fitted[4] + ' Å against ' + fitted[2] + ' Å over all ' + fitted[0] + ' pairs');
  } finally { await restore(); }
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

/* ---- Stress loop, round 1, batch 2: loading, models and Compare (2.52.0) ----
   On pages of their own: each loads, removes or hides models. */
const freshText = async (fresh, selector) => ((await fresh.locator(selector).textContent()) || '').trim();
await step('an import shows what it loaded: the first new model is current, its confidence note is its own, a second copy is "name (2)"', async () => {
  /* A zip opened beside a loaded model switched to One at a time and left the old model current, so the
     new ones were loaded out of sight; every later import ended "· confidence attached", a failed one
     included; and a second copy was "Individual files › model_a.pdb", read twice in the model menus. */
  const fresh = await freshViewer([models[0]]);
  try {
    const shown = () => fresh.evaluate(() => ({ mode: document.querySelector('#gpv-view-mode').value, current: (window.__viewerDebug.activeEntry() || {}).name, shown: window.__viewerDebug.displayedEntries().map(entry => entry.name) }));
    const modeBefore = (await shown()).mode;
    await fresh.setInputFiles('#gpv-files', [join(here, 'fixtures', 'predictors', 'boltz_results_hbdimer.zip')]); await fresh.waitForTimeout(3000);
    let state = await shown(); let status = await freshStatus(fresh);
    if (state.mode !== modeBefore || state.current !== 'hbdimer / hbdimer_model_0.cif' || !state.shown.includes('hbdimer / hbdimer_model_0.cif')) throw new Error('after the zip: ' + JSON.stringify(state) + ' (mode before ' + modeBefore + ')');
    if (!/^Loaded 2 models from 1 source · showing hbdimer \/ hbdimer_model_0\.cif · confidence attached$/.test(status)) throw new Error('zip status: ' + status);
    /* One at a time: the new model is the one shown. */
    await fresh.selectOption('#gpv-view-mode', 'single'); await fresh.waitForTimeout(300);
    await fresh.setInputFiles('#gpv-files', [models[0]]); await fresh.waitForTimeout(2000);
    state = await shown(); status = await freshStatus(fresh);
    if (state.shown.join() !== 'model_a.pdb (2)') throw new Error('second copy: ' + JSON.stringify(state));
    if (!/^Loaded 1 model from 1 source · showing model_a\.pdb \(2\)$/.test(status)) throw new Error('second copy status: ' + status);
    const options = await fresh.evaluate(() => [...document.querySelectorAll('#gpv-current option')].map(option => option.textContent));
    if (!options.includes('Individual files › model_a.pdb (2)') || options.some(text => /›.*›/.test(text))) throw new Error('model menu: ' + JSON.stringify(options));
    await fresh.setInputFiles('#gpv-files', { name: 'broken.pdb', mimeType: 'text/plain', buffer: Buffer.from('REMARK nothing to read here\nEND\n') }); await fresh.waitForTimeout(1500);
    status = await freshStatus(fresh);
    if (status !== 'No supported structures found · 1 skipped') throw new Error('failed import status: ' + status);
    console.log('       zip → current hbdimer_model_0 · copy → model_a.pdb (2) · failed → ' + status);
  } finally { await fresh.close(); }
});
await step('a file of ligands and ions has no pLDDT and says it has no polymer chains', async () => {
  /* A header-less PDB is read as a prediction, but this one has no polymer, and its calcium ion — atom
     name CA — was taken for a Cα: "Mean pLDDT 20.0" over a table with a header and no rows. */
  const lines = [];
  for (let index = 0; index < 6; index += 1) lines.push(pdbAtom('HETATM', index + 1, 'C' + (index + 1), 'LIG', 'A', 1, [index * 1.4, 0, 0], 'C', ' ', 20));
  lines.push(pdbAtom('HETATM', 7, 'CA', 'CA', 'A', 2, [3, 3, 0], 'CA', ' ', 20), 'END');
  const file = join(work, 'ligands_only.pdb'); await writeFile(file, lines.join('\n') + '\n');
  const fresh = await freshViewer([file]);
  try {
    const state = await fresh.evaluate(() => ({ confidence: document.querySelector('#gpv-confidence').textContent, scores: window.__viewerDebug.entries()[0].scores.length, tableHidden: document.querySelector('#gpv-chain-rows').closest('table').hidden, summary: document.querySelector('#gpv-assembly-summary').textContent }));
    if (state.scores || state.confidence !== 'Mean pLDDT —') throw new Error('scored as pLDDT: ' + JSON.stringify(state));
    if (!state.tableHidden || state.summary !== 'No polymer chains (ligands and ions only).') throw new Error('composition: ' + JSON.stringify(state));
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'plddt'); await fresh.waitForTimeout(300);
    const legend = await freshText(fresh, '#gpv-plddt-legend');
    if (!/No pLDDT in ligands_only\.pdb — drawn in the model colour/.test(legend)) throw new Error('pLDDT legend: ' + legend);
  } finally { await fresh.close(); }
});
await step('a calcium ion in a predicted model is not read as a residue\'s pLDDT', async () => {
  /* modelScores took every atom named CA: the HETATM calcium ion, its B-factor 0, pulled the mean
     pLDDT of a five-residue prediction scored 80 down to 66.7. */
  const lines = []; let serial = 1;
  for (let resi = 1; resi <= 5; resi += 1) {
    [['N', 'N', -1.2], ['CA', 'C', 0], ['C', 'C', 1.4], ['O', 'O', 2.1]].forEach(([name, element, dx]) => lines.push(pdbAtom('ATOM', serial++, name, 'ALA', 'A', resi, [resi * 3.8 + dx, 0, 0], element, ' ', 80)));
  }
  lines.push(pdbAtom('HETATM', serial++, 'CA', 'CA', 'A', 101, [8, 6, 0], 'CA', ' ', 0), 'END');
  const file = join(work, 'predicted_with_calcium.pdb'); await writeFile(file, lines.join('\n') + '\n');
  const fresh = await freshViewer([file]);
  try {
    const state = await fresh.evaluate(() => ({ scores: window.__viewerDebug.entries()[0].scores, confidence: document.querySelector('#gpv-confidence').textContent }));
    if (state.scores.length !== 5 || state.scores.some(score => score !== 80)) throw new Error('scores: ' + JSON.stringify(state.scores));
    if (state.confidence !== 'Mean pLDDT 80.0') throw new Error('header reads ' + state.confidence);
  } finally { await fresh.close(); }
});
await step('Align visible, Restore and the matrix wait for two shown models; an unrelated pair aligns with a caution; the table follows renames and hides', async () => {
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    const buttons = () => fresh.evaluate(() => ({ align: document.querySelector('#gpv-align').disabled, restore: document.querySelector('#gpv-restore').disabled, matrix: document.querySelector('#gpv-rmsd-matrix-run').disabled }));
    let state = await buttons();
    if (!state.align || !state.restore || !state.matrix) throw new Error('one model: ' + JSON.stringify(state));
    /* Keys for colours that are not on the model say why instead. */
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'plddt'); await fresh.waitForTimeout(300);
    let legend = await freshText(fresh, '#gpv-plddt-legend');
    if (!/No pLDDT in 5cha\.cif \(experimental\) — drawn in the model colour/.test(legend)) throw new Error('pLDDT legend on 5CHA: ' + legend);
    await fresh.selectOption('#gpv-color-mode', 'agreement'); await fresh.waitForTimeout(300);
    legend = await freshText(fresh, '#gpv-plddt-legend');
    if (!/Grey until models are aligned — Compare → Align visible/.test(legend)) throw new Error('agreement legend before aligning: ' + legend);
    /* Choosing the scheme says so too, as Cα deviation does. */
    if ((await freshStatus(fresh)) !== 'Model agreement stays grey until you align: Compare → Align visible') throw new Error('choosing model agreement said: ' + (await freshStatus(fresh)));
    await fresh.selectOption('#gpv-color-mode', 'structure');
    await fresh.click('[data-gpv-tab="models"]'); await fresh.setInputFiles('#gpv-files', [experimentalFile('1brs.cif')]); await fresh.waitForTimeout(2500);
    await fresh.selectOption('#gpv-view-mode', 'overlay'); await fresh.waitForTimeout(300);
    state = await buttons();
    if (state.align || !state.restore) throw new Error('two models, nothing aligned: ' + JSON.stringify(state));
    await fresh.click('[data-gpv-tab="compare"]'); await fresh.selectOption('#gpv-reference', { label: 'Individual files › 5cha.cif' });
    await fresh.click('#gpv-align'); await fresh.waitForTimeout(4000);
    const status = await freshStatus(fresh);
    if (!/^Aligned 1 model · .* · caution: low identity \/ large RMSD — these models may not be comparable \(1brs\.cif\)$/.test(status)) throw new Error('status: ' + status);
    if ((await buttons()).restore) throw new Error('Restore coordinates disabled after an alignment');
    const row = () => fresh.evaluate(() => { const tr = document.querySelector('#gpv-alignment-results tr'); return { name: tr.querySelector('th').textContent, text: tr.textContent, opacity: tr.style.opacity }; });
    if (!/low identity \/ large RMSD/.test((await row()).text)) throw new Error('row: ' + (await row()).text);
    await fresh.click('[data-gpv-tab="models"]');
    await fresh.click('#gpv-list [aria-label="Rename 1brs.cif"]'); await fresh.keyboard.type('Barnase–barstar'); await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(300);
    if ((await row()).name !== 'Barnase–barstar') throw new Error('after a rename the row reads ' + (await row()).name);
    await fresh.uncheck('#gpv-list [aria-label="Show 1brs.cif"]'); await fresh.waitForTimeout(300);
    const hidden = await row();
    if (hidden.opacity !== '0.5' || !/hidden since — Align visible to update/.test(hidden.text)) throw new Error('after hiding: ' + JSON.stringify(hidden));
    await fresh.click('[data-gpv-tab="compare"]'); await fresh.click('#gpv-restore'); await fresh.waitForTimeout(500);
    if (!(await buttons()).restore) throw new Error('Restore coordinates still enabled with nothing superposed');
    console.log('       ' + status.replace(/^Aligned 1 model · /, ''));
  } finally { await fresh.close(); }
});
await step('in the multi-view ← → drive the primary panel; a removed model takes its panel; Add panel stops when every model has one', async () => {
  const fresh = await freshViewer([models[0], models[1], models[2]]);
  try {
    await fresh.click('[data-gpv-tab="compare"]'); await fresh.check('#gpv-side-by-side'); await fresh.waitForTimeout(1200);
    await fresh.click('#gpv-add-panel'); await fresh.waitForTimeout(1200);
    const badges = () => fresh.evaluate(() => [...document.querySelectorAll('.gpv-view-label')].filter(label => !label.hidden).map(label => label.textContent));
    if ((await badges()).join() !== 'model_a.pdb,model_b.pdb,model_c.pdb') throw new Error('setup panels: ' + (await badges()).join());
    const add = await fresh.evaluate(() => ({ disabled: document.querySelector('#gpv-add-panel').disabled, title: document.querySelector('#gpv-add-panel').title }));
    if (!add.disabled || add.title !== 'Every loaded model already has a panel') throw new Error('Add panel with every model in a panel: ' + JSON.stringify(add));
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await fresh.keyboard.press('ArrowRight'); await fresh.waitForTimeout(800);
    const after = await fresh.evaluate(() => ({ current: document.querySelector('#gpv-current').value, left: document.querySelector('#gpv-left-model').value, badge: document.querySelector('#gpv-left-label').textContent, mode: document.querySelector('#gpv-view-mode').value }));
    if (after.current !== after.left || after.badge !== 'model_b.pdb' || !/^Showing model_b\.pdb in the primary panel$/.test(await freshStatus(fresh))) throw new Error('→ in the multi-view: ' + JSON.stringify(after) + ' · ' + await freshStatus(fresh));
    await fresh.click('[data-gpv-tab="models"]');
    await fresh.locator('#gpv-list .gpv-entry', { hasText: 'model_c.pdb' }).locator('button', { hasText: 'Remove' }).click(); await fresh.waitForTimeout(800);
    const status = await freshStatus(fresh);
    if (!/^Removed model_c\.pdb · its panel closed$/.test(status) || (await badges()).includes('model_c.pdb') || (await badges()).length !== 2) throw new Error('after removing model_c: ' + status + ' · ' + (await badges()).join());
    console.log('       → primary ' + after.badge + ' · ' + status);
  } finally { await fresh.close(); }
});
await step('Hide all says so on the stage and in the status, and Cycle waits for a shown model', async () => {
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    await fresh.click('#gpv-hide-all'); await fresh.waitForTimeout(400);
    const state = await fresh.evaluate(() => ({ hint: Boolean(document.querySelector('#gpv-stage-hidden')) && !document.querySelector('#gpv-stage-hidden').hidden, cycle: document.querySelector('#gpv-cycle').disabled }));
    const status = await freshStatus(fresh);
    if (!state.hint || !state.cycle || status !== 'All models are hidden · Show all brings them back') throw new Error(JSON.stringify(state) + ' · ' + status);
    await fresh.click('#gpv-stage-hidden button'); await fresh.waitForTimeout(400);
    const shown = await fresh.evaluate(() => ({ shown: window.__viewerDebug.displayedEntries().length, hint: document.querySelector('#gpv-stage-hidden').hidden, cycle: document.querySelector('#gpv-cycle').disabled }));
    if (!shown.shown || !shown.hint || shown.cycle) throw new Error('after Show all: ' + JSON.stringify(shown));
  } finally { await fresh.close(); }
});
/* Five pages opened and closed in a row: put the main page back in front, as after the report, so its
   animation frames (the hover readout runs on them) are not held back as a background page's. */
await page.bringToFront();

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
await step('a label is dragged with the mouse, keeps a model-space offset, and resets back onto its residue', async () => {
  await tapStageCentre();
  await page.fill('#gpv-label-text', 'Drag me'); await page.click('#gpv-add-label'); await page.waitForTimeout(400);
  const read = () => page.evaluate(() => {
    const d = window.__viewerDebug; const label = d.labelRecords()[0];
    const screen = d.viewer.modelToScreen(d.labelPosition(label));
    return { x: screen.x, y: screen.y, offset: label.offset || null, view: d.viewer.getView().slice(0, 8), scrollX, scrollY };
  });
  const before = await read();
  /* The hover readout follows the pointer on an animation frame; on a loaded machine one move and
     300 ms is not always enough, so the pointer is nudged until the readout offers the drag. */
  let hint = '';
  for (let attempt = 0; attempt < 8 && !/Drag to move/.test(hint); attempt++) {
    await page.mouse.move(before.x - before.scrollX + (attempt % 2), before.y - before.scrollY); await page.waitForTimeout(300);
    hint = (await page.locator('#gpv-hover').textContent()) || '';
  }
  if (!/Drag to move/.test(hint)) throw new Error('the pointer over a label does not offer to move it: ' + hint);
  await page.mouse.down();
  await page.mouse.move(before.x - before.scrollX + 70, before.y - before.scrollY - 45, { steps: 10 });
  await page.mouse.up(); await page.waitForTimeout(400);
  const after = await read();
  const dx = after.x - before.x; const dy = after.y - before.y;
  if (Math.abs(dx - 70) > 14 || Math.abs(dy + 45) > 14) throw new Error('the label moved ' + dx.toFixed(0) + ', ' + dy.toFixed(0) + ' px for a drag of 70, -45');
  if (!after.offset || Math.hypot(after.offset.x, after.offset.y, after.offset.z) < 1) throw new Error('the drag left no model-space offset: ' + JSON.stringify(after.offset));
  /* The camera must not have moved: dragging a label is not dragging the scene. */
  if (after.view.some((value, index) => Math.abs(value - before.view[index]) > 1e-6)) throw new Error('the camera moved during the label drag');
  const reset = page.locator('#gpv-label-list .gpv-entry button:has-text("Reset")');
  if (await reset.isDisabled()) throw new Error('Reset stayed disabled after a drag');
  await reset.click(); await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__viewerDebug.labelRecords()[0].offset)) throw new Error('Reset did not put the label back on its residue');
  await page.click('#gpv-label-list .gpv-entry button:has-text("Remove")'); await page.waitForTimeout(200);
  console.log('       dragged ' + dx.toFixed(0) + ', ' + dy.toFixed(0) + ' px · offset kept in model space · camera still · reset');
});
/* ---- Labelling on the canvas (2.49.0) ----
   A click on a residue opens a small editor beside it; a click on a label edits it; the label just
   touched is the active one, which the arrow keys move and Delete removes. Each step makes its own
   label and takes it away again, and leaves the editor closed and nothing active. */
/* A Cα the pointer can land on: inside the stage with room for the editor around it, inside the
   window, picked back as that same residue, and under no label. */
const canvasResidue = async (avoid = [], on = page) => {
  await on.locator('#gpv-stage').scrollIntoViewIfNeeded(); await on.waitForTimeout(200);
  return on.evaluate(avoid => {
    const d = window.__viewerDebug;
    const rect = document.querySelector('#gpv-stage').getBoundingClientRect();
    const left = rect.left + scrollX; const top = rect.top + scrollY;
    const centre = { x: left + rect.width / 2, y: top + rect.height / 2 };
    const candidates = [];
    d.displayedEntries().filter(entry => entry.model).forEach(entry => entry.atoms.filter(atom => atom.atom === 'CA').forEach(atom => {
      const key = [entry.id, atom.chain || '', atom.resi].join('|');
      if (avoid.includes(key) || d.labelRecords().some(label => label.key === key)) return;
      const projected = d.viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
      if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return;
      /* Whole pixels: Firefox and WebKit round the pointer position, Chromium does not, and the
         residue the viewer picks must be the one the tap lands on in every engine. */
      const s = { x: Math.round(projected.x), y: Math.round(projected.y) };
      if (s.x < left + 140 || s.x > left + rect.width - 140 || s.y < top + 40 || s.y > top + rect.height - 140) return;
      if (s.y - scrollY < 20 || s.y - scrollY > innerHeight - 20) return;
      candidates.push({ entry, atom, key, s, distance: Math.hypot(s.x - centre.x, s.y - centre.y) });
    }));
    candidates.sort((a, b) => a.distance - b.distance);
    for (const c of candidates) {
      /* The fixture's chain B is chain A shifted 3.4 Å, so a residue's twin can project a pixel
         away; a tap must have no other Cα within reach of the pick radius. */
      const rival = candidates.find(other => other !== c && Math.hypot(other.s.x - c.s.x, other.s.y - c.s.y) < 10);
      if (rival) continue;
      const hit = d.pickAtomAt(c.s.x, c.s.y);
      if (!hit || hit.entry.id !== c.entry.id || (hit.atom.chain || '') !== (c.atom.chain || '') || hit.atom.resi !== c.atom.resi) continue;
      if (d.labelHitAt(c.s.x, c.s.y)) continue;
      return { key: c.key, text: (c.atom.resn || 'RES') + c.atom.resi + (c.atom.chain ? ' · ' + c.atom.chain : ''), x: c.s.x - scrollX, y: c.s.y - scrollY };
    }
    return null;
  }, avoid);
};
const editorShown = (on = page) => on.locator('#gpv-label-editor').isVisible();
const focusedId = (on = page) => on.evaluate(() => (document.activeElement && document.activeElement.id) || document.activeElement.tagName);
const rememberedSteps = () => page.evaluate(() => window.__viewerDebug.rememberedSteps());
const activeTextNow = () => page.evaluate(() => window.__viewerDebug.activeText());
const labelByKey = key => page.evaluate(key => { const label = window.__viewerDebug.labelRecords().find(item => item.key === key); return label ? JSON.parse(JSON.stringify(label)) : null; }, key);
const labelScreen = key => page.evaluate(key => {
  const d = window.__viewerDebug; const label = d.labelRecords().find(item => item.key === key);
  const s = label && d.viewer.modelToScreen(d.labelPosition(label));
  return s ? { x: s.x - scrollX, y: s.y - scrollY } : null;
}, key);
const focusStage = () => page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true }));
/* Close the editor and let go of the active label through the keyboard, the way a user would. */
const letGo = async () => {
  if (await editorShown()) { await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  if (await activeTextNow()) { await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
};
const removeLabelByKey = async key => {
  const index = await page.evaluate(key => window.__viewerDebug.labelRecords().findIndex(label => label.key === key), key);
  if (index < 0) return;
  await page.locator('#gpv-label-list .gpv-entry').nth(index).locator('button:has-text("Remove")').click(); await page.waitForTimeout(250);
};
/* Label a residue the way the editor is meant to be used: tap it, type, Enter. */
const labelOnCanvas = async text => {
  const target = await canvasResidue();
  if (!target) throw new Error('no residue on screen to tap');
  await tap(target.x, target.y); await page.waitForTimeout(400);
  if (!(await editorShown())) throw new Error('the editor did not open at ' + target.text);
  await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
  const label = await labelByKey(target.key);
  if (!label || label.text !== text) throw new Error('labelling ' + target.text + ' from the canvas left ' + JSON.stringify(label));
  return target;
};
/* The fixture's two helices run along the viewing axis, so chain B sits directly behind chain A and
   every Cα has a twin within a pixel of it on screen — which engines then pick differently as they
   round the pointer position. Turned 90° about X, the twins sit 3.4 Å apart across the screen and a
   tap has one residue to land on. The orientation is put back after the last canvas step. */
await step('the view is turned so that every residue has room around it on screen', async () => {
  await letGo();
  await focusStage(); await page.keyboard.press('x'); await page.waitForTimeout(500);
  if (!(await canvasResidue())) throw new Error('no isolated residue on screen even after turning the view');
});
await step('clicking a residue opens a label editor beside it, and Enter labels the residue', async () => {
  /* The steps above may leave an editor open from their own stage clicks. */
  await letGo();
  const target = await canvasResidue();
  if (!target) throw new Error('no residue on screen to tap');
  const steps = await rememberedSteps();
  try {
    await tap(target.x, target.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('the editor did not open at ' + target.text);
    const box = await page.locator('#gpv-label-editor').boundingBox();
    const gapX = Math.max(box.x - target.x, 0, target.x - (box.x + box.width));
    const gapY = Math.max(box.y - target.y, 0, target.y - (box.y + box.height));
    const gap = Math.hypot(gapX, gapY);
    if (gap > 40) throw new Error('the editor opened ' + gap.toFixed(0) + ' px from the residue');
    const value = await page.inputValue('#gpv-label-editor-text');
    if (value !== target.text) throw new Error('the editor suggests "' + value + '", not "' + target.text + '"');
    if ((await focusedId()) !== 'gpv-label-editor-text') throw new Error('focus is on ' + (await focusedId()) + ', not the editor field');
    const group = (await page.getAttribute('#gpv-label-editor', 'aria-label')) || '';
    if (!/^Label for /.test(group)) throw new Error('the editor is labelled "' + group + '"');
    if (((await page.locator('#gpv-label-editor-commit').textContent()) || '').trim() !== 'Label') throw new Error('the button for a new label does not read Label');
    await page.keyboard.type('Canvas site'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const label = await labelByKey(target.key);
    if (!label || label.text !== 'Canvas site') throw new Error('record: ' + JSON.stringify(label));
    const rows = await page.locator('#gpv-label-list .gpv-entry input[type="text"]').evaluateAll(inputs => inputs.map(input => input.value));
    if (!rows.includes('Canvas site')) throw new Error('the label list does not show it: ' + JSON.stringify(rows));
    const said = ((await page.locator('#gpv-state').textContent()) || '').trim();
    if (!/^Label added at /.test(said)) throw new Error('announced: ' + said);
    if ((await focusedId()) !== 'gpv-stage') throw new Error('focus went to ' + (await focusedId()) + ', not the stage');
    if (await editorShown()) throw new Error('the editor stayed open after Enter');
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the label took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    console.log('       ' + target.text + ' labelled from the canvas · editor ' + gap.toFixed(0) + ' px from it · "' + said + '"');
  } finally { await letGo(); await removeLabelByKey(target.key); }
});
await step('Esc closes the label editor without adding a label or an undo step', async () => {
  const target = await canvasResidue();
  if (!target) throw new Error('no residue on screen to tap');
  const count = await page.evaluate(() => window.__viewerDebug.labelRecords().length);
  const steps = await rememberedSteps();
  try {
    await tap(target.x, target.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('the editor did not open');
    await page.keyboard.type('Never mind'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    if (await editorShown()) throw new Error('Esc left the editor open');
    if ((await page.evaluate(() => window.__viewerDebug.labelRecords().length)) !== count) throw new Error('Esc added a label');
    if ((await rememberedSteps()) !== steps) throw new Error('Esc left ' + ((await rememberedSteps()) - steps) + ' undo steps behind');
    if ((await focusedId()) !== 'gpv-stage') throw new Error('focus went to ' + (await focusedId()) + ', not the stage');
  } finally { await letGo(); await removeLabelByKey(target.key); }
});
await step('a label clicked without moving it opens the editor on its text, and Enter changes the text only', async () => {
  let target = null;
  try {
    target = await labelOnCanvas('Edit me');
    await letGo();
    const before = await labelByKey(target.key);
    const at = await labelScreen(target.key);
    const steps = await rememberedSteps();
    await tap(at.x, at.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('clicking the label did not open the editor');
    if ((await page.inputValue('#gpv-label-editor-text')) !== 'Edit me') throw new Error('the editor holds "' + (await page.inputValue('#gpv-label-editor-text')) + '"');
    if (((await page.locator('#gpv-label-editor-commit').textContent()) || '').trim() !== 'Update') throw new Error('the button for an existing label does not read Update');
    if (!(await page.locator('#gpv-label-editor-remove').isVisible())) throw new Error('no Remove for an existing label');
    if ((await rememberedSteps()) !== steps) throw new Error('a click that moved nothing left an undo step');
    await page.keyboard.type('Edited on the canvas'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const after = await labelByKey(target.key);
    if (!after || after.text !== 'Edited on the canvas') throw new Error('text after the edit: ' + JSON.stringify(after));
    const rest = label => JSON.stringify(Object.keys(label).filter(name => name !== 'text').sort().map(name => [name, label[name]]));
    if (rest(after) !== rest(before)) throw new Error('more than the text changed: ' + rest(before) + ' → ' + rest(after));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the edit took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    if (((await page.locator('#gpv-state').textContent()) || '').trim() !== 'Label updated') throw new Error('announced: ' + (await page.locator('#gpv-state').textContent()));
  } finally { await letGo(); if (target) await removeLabelByKey(target.key); }
});
await step('while measuring, a click on a residue counts for the measurement and opens no editor', async () => {
  try {
    await page.click('#gpv-measure'); await page.waitForTimeout(200);
    if (!/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) throw new Error('measurement mode did not start');
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    if (await editorShown()) throw new Error('the editor opened while measuring');
    const state = (await page.locator('#gpv-measure-state').textContent()) || '';
    if (!/Selected 1 of/.test(state)) throw new Error('the click did not count for the measurement: ' + state);
  } finally {
    if (/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) { await page.click('#gpv-measure'); await page.waitForTimeout(200); }
    await letGo();
  }
});
await step('a residue picked in the sequence strip opens the editor, and L opens it for the selected residue', async () => {
  try {
    const strip = page.locator('#gpv-sequence-rows canvas').first();
    await strip.scrollIntoViewIfNeeded();
    const box = await strip.boundingBox();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('a strip pick did not open the editor');
    const hint = (await page.locator('#gpv-sequence-hint').textContent()) || '';
    if (!/press Enter/.test(hint)) throw new Error('the strip hint does not say the editor is open: ' + hint);
    const picked = await page.getAttribute('#gpv-label-editor', 'aria-label');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await editorShown()) throw new Error('Esc did not close the editor');
    await focusStage(); await page.keyboard.press('l'); await page.waitForTimeout(300);
    if (!(await editorShown())) throw new Error('L did not open the editor');
    const again = await page.getAttribute('#gpv-label-editor', 'aria-label');
    if (again !== picked) throw new Error('L opened "' + again + '", not the selected "' + picked + '"');
    if ((await focusedId()) !== 'gpv-label-editor-text') throw new Error('L left the focus on ' + (await focusedId()));
    const value = await page.inputValue('#gpv-label-editor-text');
    if (/l$/.test(value)) throw new Error('the L itself was typed into the editor: ' + value);
    console.log('       ' + picked + ' from the strip, and again from L');
  } finally { await letGo(); }
});
await step('the active label moves with the arrow keys, which leave the models alone until Esc', async () => {
  let target = null;
  const startModel = await page.inputValue('#gpv-current');
  const startMode = await page.inputValue('#gpv-view-mode');
  try {
    target = await labelOnCanvas('Arrow me');
    const active = await activeTextNow();
    if (!active || active.key !== target.key) throw new Error('the new label is not the active one: ' + JSON.stringify(active));
    /* Mark it as placed by Separate labels, so the step can see a hand move take that away. */
    await page.evaluate(key => { window.__viewerDebug.labelRecords().find(label => label.key === key).autoPlaced = true; }, target.key);
    const before = await labelByKey(target.key); const at0 = await labelScreen(target.key);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    const after = await labelByKey(target.key); const at1 = await labelScreen(target.key);
    if (!after.offset || JSON.stringify(after.offset) === JSON.stringify(before.offset)) throw new Error('ArrowRight left the offset at ' + JSON.stringify(after.offset));
    if (after.autoPlaced) throw new Error('a label moved by hand is still marked as placed automatically');
    if ((await page.inputValue('#gpv-current')) !== startModel) throw new Error('ArrowRight switched the model while a label was active');
    await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(250);
    const at2 = await labelScreen(target.key);
    const plain = at1.x - at0.x; const fine = at2.x - at1.x;
    if (!(plain > 4 && fine > 0 && fine < plain / 2)) throw new Error('the label moved ' + plain.toFixed(1) + ' px for ArrowRight and ' + fine.toFixed(1) + ' px for Shift+ArrowRight');
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250);
    if ((await page.inputValue('#gpv-current')) !== startModel) throw new Error('ArrowLeft switched the model while a label was active');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await activeTextNow()) throw new Error('Esc did not let go of the label');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
    if ((await page.inputValue('#gpv-current')) === startModel) throw new Error('with nothing active, ArrowRight no longer steps to the next model');
    console.log('       ArrowRight ' + plain.toFixed(1) + ' px, Shift+ArrowRight ' + fine.toFixed(1) + ' px · models untouched until Esc');
  } finally {
    await letGo();
    if (target) await removeLabelByKey(target.key);
    await page.evaluate(([model, mode]) => {
      const set = (selector, value) => { const select = document.querySelector(selector); if (select.value === value) return; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
      set('#gpv-current', model); set('#gpv-view-mode', mode);
    }, [startModel, startMode]);
    await page.waitForTimeout(500);
    await focusStage(); await page.keyboard.press('f'); await page.waitForTimeout(500);
  }
});
await step('Delete removes the active label, and undo brings it back', async () => {
  let target = null;
  try {
    target = await labelOnCanvas('Delete me');
    if (!(await activeTextNow())) throw new Error('the new label is not active');
    await page.keyboard.press('Delete'); await page.waitForTimeout(300);
    if (await labelByKey(target.key)) throw new Error('Delete left the label in place');
    if (((await page.locator('#gpv-state').textContent()) || '').trim() !== 'Label removed') throw new Error('announced: ' + (await page.locator('#gpv-state').textContent()));
    if (await activeTextNow()) throw new Error('a removed label is still active');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const back = await labelByKey(target.key);
    if (!back || back.text !== 'Delete me') throw new Error('undo did not bring the label back: ' + JSON.stringify(back));
  } finally { await letGo(); if (target) await removeLabelByKey(target.key); }
});
await step('a label row moves its label with the arrow buttons, and Select makes it the active label', async () => {
  let target = null;
  try {
    target = await labelOnCanvas('Row me');
    await letGo();
    const index = await page.evaluate(key => window.__viewerDebug.labelRecords().findIndex(label => label.key === key), target.key);
    const row = page.locator('#gpv-label-list .gpv-entry').nth(index);
    if ((await row.locator('.gpv-nudge button[aria-label^="Move label"]').count()) !== 4) throw new Error('the row has no four move buttons');
    const before = await labelByKey(target.key);
    await row.locator('button[aria-label="Move label up"]').click(); await page.waitForTimeout(250);
    const after = await labelByKey(target.key);
    if (!after.offset || JSON.stringify(after.offset) === JSON.stringify(before.offset)) throw new Error('the row button left the offset at ' + JSON.stringify(after.offset));
    if (await row.locator('button:has-text("Reset")').isDisabled()) throw new Error('Reset stayed disabled after a nudge');
    await row.locator('button:has-text("Select")').click(); await page.waitForTimeout(250);
    const active = await activeTextNow();
    if (!active || active.key !== target.key) throw new Error('Select did not make the label active: ' + JSON.stringify(active));
    if ((await focusedId()) !== 'gpv-stage') throw new Error('Select left the focus on ' + (await focusedId()) + ', not the stage');
  } finally { await letGo(); if (target) await removeLabelByKey(target.key); }
});
await step('a tap on a touchscreen opens the label editor (the touch path)', async () => {
  /* A context of its own: touch has to be switched on when a context is made, and its storage keeps
     this page's autosave away from the session the suite checks later. */
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, hasTouch: true });
  try {
    const touch = await context.newPage();
    await touch.goto(base + '/index.html?debug=1'); await touch.waitForTimeout(2500);
    await touch.setInputFiles('#gpv-files', [models[0]]); await touch.waitForTimeout(2500);
    /* A fresh page sits in the default orientation, where every residue has its twin behind it. */
    await touch.focus('#gpv-stage'); await touch.keyboard.press('x'); await touch.waitForTimeout(500);
    const target = await canvasResidue([], touch);
    if (!target) throw new Error('no residue on screen to tap');
    let path = 'touchscreen.tap';
    try { await touch.touchscreen.tap(target.x, target.y); }
    catch (error) {
      /* An engine whose Playwright build cannot drive a touchscreen still gets the touch pointer
         sequence the app listens for. */
      path = 'touch pointer events (' + String(error.message).split('\n')[0].slice(0, 60) + ')';
      await touch.evaluate(({ x, y }) => {
        const canvas = document.querySelector('#gpv-stage canvas');
        const init = { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 };
        canvas.dispatchEvent(new PointerEvent('pointerdown', init));
        canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      }, target);
    }
    await touch.waitForTimeout(500);
    if (!(await editorShown(touch))) throw new Error('a tap did not open the editor (' + path + ')');
    const value = await touch.inputValue('#gpv-label-editor-text');
    if (value !== target.text) throw new Error('the editor suggests "' + value + '", not "' + target.text + '"');
    console.log('       ' + target.text + ' opened by ' + path);
  } finally { await context.close(); }
});
await step('undo walks the canvas edits back one at a time: added, edited, nudged, removed', async () => {
  let target = null;
  try {
    const steps = await rememberedSteps();
    target = await labelOnCanvas('Undo walk');
    const at = await labelScreen(target.key);
    await tap(at.x, at.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('clicking the label did not open the editor');
    await page.keyboard.type('Undo walk edited'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
    await page.keyboard.press('Delete'); await page.waitForTimeout(300);
    if ((await rememberedSteps()) - steps !== 4) throw new Error('add, edit, nudge and remove took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 4');
    const expect = async (what, check) => {
      await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
      const label = await labelByKey(target.key);
      if (!check(label)) throw new Error('undoing the ' + what + ' left ' + JSON.stringify(label));
    };
    const moved = label => Boolean(label && label.offset && Math.hypot(label.offset.x || 0, label.offset.y || 0, label.offset.z || 0) > 0);
    await expect('removal', label => Boolean(label) && label.text === 'Undo walk edited' && moved(label));
    await expect('nudge', label => Boolean(label) && label.text === 'Undo walk edited' && !moved(label));
    await expect('edit', label => Boolean(label) && label.text === 'Undo walk' && !moved(label));
    await expect('label', label => !label);
    console.log('       four canvas edits, four undo steps, walked back in order');
  } finally { await letGo(); if (target) await removeLabelByKey(target.key); }
});
/* ---- Selecting a region of the model (2.49.0) ----
   A Shift-drag, or any drag while Drag to select is on, draws a box over the model; the Cα inside
   become a highlight and a popover offers to label them all. The box is built around a few known Cα
   atoms, and the residues it should catch are counted with the same projection just before the
   drag. Each step takes back the selections and labels it made and leaves the mode off. */
const boxRegion = async (seedKey = null) => {
  await page.locator('#gpv-stage').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  return page.evaluate(seedKey => {
    const d = window.__viewerDebug;
    const rect = document.querySelector('#gpv-stage').getBoundingClientRect();
    const left = rect.left + scrollX; const top = rect.top + scrollY;
    const centre = { x: left + rect.width / 2, y: top + rect.height / 2 };
    const points = [];
    /* The same residues the app counts as drawn: no hidden chain, nothing under the confidence cut. */
    const threshold = Number(document.querySelector('#gpv-hide-below').value) || 0;
    d.displayedEntries().filter(entry => entry.model).forEach(entry => {
      const hidden = entry.hiddenChains || [];
      entry.atoms.forEach(atom => {
        if (atom.atom !== 'CA' || atom.hetflag || hidden.includes(atom.chain || '')) return;
        if (threshold && entry.scores.length && Number(atom.b) < threshold) return;
        const s = d.viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
        if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return;
        points.push({ key: [entry.id, atom.chain || '', atom.resi].join('|'), entryId: entry.id, chain: atom.chain || '', resi: atom.resi, x: s.x, y: s.y });
      });
    });
    if (!points.length) return null;
    const seed = (seedKey && points.find(point => point.key === seedKey)) || points.slice().sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))[0];
    /* The seed and its neighbours along the chain are the residues the box is drawn around. */
    const known = points.filter(point => point.entryId === seed.entryId && point.chain === seed.chain && Math.abs(point.resi - seed.resi) <= 2);
    const clamp = box => ({
      left: Math.max(Math.round(box.left), Math.round(left) + 12), right: Math.min(Math.round(box.right), Math.round(left + rect.width) - 12),
      top: Math.max(Math.round(box.top), Math.round(top) + 12, Math.round(scrollY) + 12), bottom: Math.min(Math.round(box.bottom), Math.round(top + rect.height) - 12, Math.round(scrollY + innerHeight) - 12)
    });
    let box = clamp({ left: Math.min(...known.map(p => p.x)) - 8, right: Math.max(...known.map(p => p.x)) + 8, top: Math.min(...known.map(p => p.y)) - 8, bottom: Math.max(...known.map(p => p.y)) + 8 });
    /* No Cα within 2 px of an edge, so how an engine rounds pointer coordinates cannot decide whether
       a residue is in or out. */
    const nearEdge = b => points.some(p => ((Math.abs(p.x - b.left) < 2 || Math.abs(p.x - b.right) < 2) && p.y > b.top - 2 && p.y < b.bottom + 2) || ((Math.abs(p.y - b.top) < 2 || Math.abs(p.y - b.bottom) < 2) && p.x > b.left - 2 && p.x < b.right + 2));
    for (let tries = 0; tries < 20 && nearEdge(box); tries += 1) box = clamp({ left: box.left - 3, right: box.right + 3, top: box.top - 3, bottom: box.bottom + 3 });
    const keys = [...new Set(points.filter(p => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom).map(p => p.key))].sort();
    return { x0: box.left - scrollX, y0: box.top - scrollY, x1: box.right - scrollX, y1: box.bottom - scrollY, keys, known: known.map(p => p.key), clean: !nearEdge(box) };
  }, seedKey);
};
const selectionsNow = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__viewerDebug.selectionRecords())));
const boxKeys = records => [...new Set(records.flatMap(record => record.residues.map(resi => [record.entryId, record.chain || '', resi].join('|'))))].sort();
const boxPopoverShown = () => page.locator('#gpv-box-popover').isVisible();
const boxModeOn = () => page.evaluate(() => window.__viewerDebug.boxSelectMode());
const cameraNow = () => page.evaluate(() => window.__viewerDebug.viewer.getView().slice(0, 8));
const sameCamera = (a, b) => a.every((value, index) => Math.abs(value - b[index]) <= 1e-6);
/* Down, across in several moves, up — with Shift held unless the toggle is doing the work. Shift is
   always let go: a Shift left down would turn the next F into full screen. */
const dragBox = async (region, shift = true) => {
  if (shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.move(region.x0, region.y0); await page.mouse.down();
    await page.mouse.move((region.x0 + region.x1) / 2, (region.y0 + region.y1) / 2, { steps: 4 });
    await page.mouse.move(region.x1, region.y1, { steps: 4 });
    await page.mouse.up();
  } finally { if (shift) await page.keyboard.up('Shift'); }
  await page.waitForTimeout(450);
};
const closeBoxPopover = async () => { if (await boxPopoverShown()) { await page.click('#gpv-box-popover .gpv-label-editor-close'); await page.waitForTimeout(150); } };
const boxModeOff = async () => { if (await boxModeOn()) { await page.click('#gpv-box-select'); await page.waitForTimeout(150); } };
/* Back to the number of selections the step started with, newest rows first. */
const trimSelections = async count => {
  for (let guard = 0; guard < 40 && (await selectionsNow()).length > count; guard += 1) {
    await page.locator('#gpv-selection-list .gpv-entry').last().locator('button:has-text("Remove")').click(); await page.waitForTimeout(200);
  }
};
const removeLabelsByKey = async keys => { for (const key of keys) await removeLabelByKey(key); };
await step('a Shift-drag over the model highlights exactly the residues inside the box and leaves the camera still', async () => {
  await letGo();
  const startCount = (await selectionsNow()).length;
  try {
    const region = await boxRegion();
    if (!region || region.keys.length < 2) throw new Error('no box of residues on screen: ' + JSON.stringify(region));
    const camera = await cameraNow();
    const steps = await rememberedSteps();
    await dragBox(region);
    if (!sameCamera(await cameraNow(), camera)) throw new Error('the model turned during the Shift-drag');
    const added = (await selectionsNow()).slice(startCount);
    if (!added.length) throw new Error('no selection was added · ' + (await page.locator('#gpv-state').textContent()));
    if (added.some(record => record.action !== 'highlight')) throw new Error('the box made a selection that is not a highlight: ' + JSON.stringify(added));
    const colour = await page.inputValue('#gpv-selection-color');
    if (added.some(record => record.color !== colour)) throw new Error('the highlight is not in the chosen colour ' + colour);
    const got = boxKeys(added);
    if (JSON.stringify(got) !== JSON.stringify(region.keys)) throw new Error('selected ' + JSON.stringify(got) + ', expected the ' + region.keys.length + ' projected inside: ' + JSON.stringify(region.keys));
    if (!region.known.every(key => got.includes(key))) throw new Error('the residues the box was drawn around are not all in it');
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the box selection took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    if (!(await boxPopoverShown())) throw new Error('no popover after the box');
    const summary = ((await page.locator('#gpv-box-popover .gpv-box-popover-summary').textContent()) || '').trim();
    if (!summary.startsWith(region.keys.length + ' residue')) throw new Error('the popover says "' + summary + '" for ' + region.keys.length + ' residues');
    if ((await page.getAttribute('#gpv-box-popover', 'aria-label')) !== 'Selected residues') throw new Error('the popover is not labelled "Selected residues"');
    if ((await focusedId()) !== 'gpv-box-label-all') throw new Error('focus is on ' + (await focusedId()) + ', not Label all');
    console.log('       ' + summary + ' · ' + added.length + ' highlight row' + (added.length === 1 ? '' : 's') + ' · camera still' + (region.clean ? '' : ' · (an atom sat near an edge)'));
  } finally { await closeBoxPopover(); await trimSelections(startCount); }
});
await step('Label all labels each selected residue but leaves an existing label alone, pushes the new ones apart, and undoes in two steps', async () => {
  let existing = null; let made = [];
  const startCount = (await selectionsNow()).length;
  try {
    existing = await labelOnCanvas('Kept text');
    await letGo();
    const before = await labelByKey(existing.key);
    const region = await boxRegion(existing.key);
    if (!region || !region.keys.includes(existing.key) || region.keys.length < 3) throw new Error('no box of residues around the labelled one: ' + JSON.stringify(region));
    made = region.keys.filter(key => key !== existing.key);
    await dragBox(region);
    if (!(await boxPopoverShown())) throw new Error('no popover after the box');
    const groups = (await selectionsNow()).length - startCount;
    const steps = await rememberedSteps();
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    if (await boxPopoverShown()) throw new Error('the popover stayed open after Label all');
    const labels = await page.evaluate(() => JSON.parse(JSON.stringify(window.__viewerDebug.labelRecords())));
    const missing = made.filter(key => !labels.some(label => label.key === key));
    if (missing.length) throw new Error('Label all left ' + missing.length + ' residues unlabelled: ' + missing.join(', '));
    if (new Set(labels.map(label => label.key)).size !== labels.length) throw new Error('a residue got two labels');
    const wrong = labels.filter(label => made.includes(label.key) && label.text !== (label.resn || 'RES') + label.resi + (label.chain ? ' · ' + label.chain : ''));
    if (wrong.length) throw new Error('labels not in the RESN45 · A form: ' + wrong.map(label => label.text).join(', '));
    const whole = label => JSON.stringify(Object.keys(label).sort().map(name => [name, label[name]]));
    const kept = labels.find(label => label.key === existing.key);
    if (!kept || whole(kept) !== whole(before)) throw new Error('the label already there changed: ' + whole(before) + ' → ' + (kept ? whole(kept) : 'gone'));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('Label all took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    const said = ((await page.locator('#gpv-state').textContent()) || '').trim();
    if (!said.startsWith('Labelled ' + made.length + ' residue')) throw new Error('announced: ' + said);
    /* Separated: the new labels cover less of each other than they would sitting on their residues. */
    const cover = await page.evaluate(keys => {
      const d = window.__viewerDebug;
      const labels = d.labelRecords().filter(label => keys.includes(label.key));
      const area = boxes => {
        let total = 0;
        for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]; const b = boxes[j]; if (!a || !b) continue;
          const wide = Math.min(a.x + a.halfWidth, b.x + b.halfWidth) - Math.max(a.x - a.halfWidth, b.x - b.halfWidth);
          const tall = Math.min(a.y + a.halfHeight, b.y + b.halfHeight) - Math.max(a.y - a.halfHeight, b.y - b.halfHeight);
          if (wide > 0 && tall > 0) total += wide * tall;
        }
        return total;
      };
      return { now: area(labels.map(label => d.labelScreenBox(label))), piled: area(labels.map(label => d.labelScreenBox({ ...label, offset: null }))), moved: labels.filter(label => label.autoPlaced).length };
    }, region.keys);
    if (cover.piled > 0 && !(cover.moved > 0 && cover.now < cover.piled)) throw new Error('the new labels were not pushed apart: overlap ' + cover.piled.toFixed(0) + ' → ' + cover.now.toFixed(0) + ' px², ' + cover.moved + ' moved');
    await focusStage();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const afterOne = await page.evaluate(() => window.__viewerDebug.labelRecords().map(label => label.key));
    if (made.some(key => afterOne.includes(key))) throw new Error('the first undo did not take the new labels back');
    if (!afterOne.includes(existing.key)) throw new Error('the first undo took the existing label too');
    if ((await selectionsNow()).length !== startCount + groups) throw new Error('the first undo took the highlight back as well');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    if ((await selectionsNow()).length !== startCount) throw new Error('the second undo did not take the highlight back');
    if (!(await labelByKey(existing.key))) throw new Error('the second undo took the existing label');
    console.log('       ' + said + ' · overlap ' + cover.piled.toFixed(0) + ' → ' + cover.now.toFixed(0) + ' px² · two undos, labels then highlight');
  } finally {
    await closeBoxPopover(); await letGo();
    await removeLabelsByKey(made); if (existing) await removeLabelByKey(existing.key);
    await trimSelections(startCount);
  }
});
await step('a Shift-drag shorter than 6 px is a click: the label editor opens and nothing is selected', async () => {
  const startCount = (await selectionsNow()).length;
  try {
    await letGo();
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    const steps = await rememberedSteps();
    await page.keyboard.down('Shift');
    try {
      await page.mouse.move(target.x, target.y); await page.mouse.down();
      await page.mouse.move(target.x + 3, target.y + 2, { steps: 2 });
      await page.mouse.up();
    } finally { await page.keyboard.up('Shift'); }
    await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('a 3 × 2 px Shift-drag did not open the label editor');
    if (!/^Label for /.test((await page.getAttribute('#gpv-label-editor', 'aria-label')) || '')) throw new Error('the editor did not open on a residue');
    if (await boxPopoverShown()) throw new Error('a click opened the selection popover');
    if ((await selectionsNow()).length !== startCount) throw new Error('a click made a selection');
    if ((await rememberedSteps()) !== steps) throw new Error('a click left an undo step');
  } finally { await closeBoxPopover(); await letGo(); await trimSelections(startCount); }
});
await step('with Drag to select on a plain drag selects; Esc turns it off, and so does starting to measure', async () => {
  const startCount = (await selectionsNow()).length;
  try {
    await letGo();
    await page.click('#gpv-box-select'); await page.waitForTimeout(200);
    if (!(await boxModeOn())) throw new Error('the toggle did not turn selecting on');
    if (((await page.locator('#gpv-box-select').textContent()) || '').trim() !== 'Stop selecting') throw new Error('the toggle does not read Stop selecting');
    if ((await page.getAttribute('#gpv-box-select', 'aria-pressed')) !== 'true') throw new Error('the toggle is not marked pressed');
    const region = await boxRegion();
    if (!region || region.keys.length < 2) throw new Error('no box of residues on screen');
    const camera = await cameraNow();
    await dragBox(region, false);
    if (!sameCamera(await cameraNow(), camera)) throw new Error('a drag turned the model while Drag to select was on');
    const got = boxKeys((await selectionsNow()).slice(startCount));
    if (JSON.stringify(got) !== JSON.stringify(region.keys)) throw new Error('selected ' + got.length + ' residues, expected ' + region.keys.length);
    if (!(await boxPopoverShown())) throw new Error('no popover after the box');
    await closeBoxPopover();
    if (!(await boxModeOn())) throw new Error('closing the popover turned the mode off');
    await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await boxModeOn()) throw new Error('Esc did not turn Drag to select off');
    if (((await page.locator('#gpv-box-select').textContent()) || '').trim() !== 'Drag to select') throw new Error('the toggle does not read Drag to select again');
    await page.click('#gpv-box-select'); await page.waitForTimeout(150);
    await page.click('#gpv-measure'); await page.waitForTimeout(200);
    if (await boxModeOn()) throw new Error('starting to measure did not turn Drag to select off');
    await page.click('#gpv-box-select'); await page.waitForTimeout(150);
    if (/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) throw new Error('turning Drag to select on did not stop measuring');
  } finally {
    await closeBoxPopover(); await boxModeOff();
    if (/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) { await page.click('#gpv-measure'); await page.waitForTimeout(200); }
    await letGo(); await trimSelections(startCount);
  }
});
await step('Label residues on a highlight row labels its residues, and a hide row has no such button', async () => {
  const startCount = (await selectionsNow()).length;
  const fields = { chain: await page.inputValue('#gpv-selection-chain'), range: await page.inputValue('#gpv-selection-range'), action: await page.inputValue('#gpv-selection-action') };
  let made = [];
  try {
    await page.fill('#gpv-selection-chain', 'A'); await page.fill('#gpv-selection-range', '5-7'); await page.selectOption('#gpv-selection-action', 'highlight');
    await page.click('#gpv-add-selection'); await page.waitForTimeout(400);
    await page.fill('#gpv-selection-range', '20,21'); await page.selectOption('#gpv-selection-action', 'hide');
    await page.click('#gpv-add-selection'); await page.waitForTimeout(400);
    const records = (await selectionsNow()).slice(startCount);
    if (records.length !== 2) throw new Error('expected a highlight and a hide row, found ' + records.length);
    const rows = page.locator('#gpv-selection-list .gpv-entry');
    const count = await rows.count();
    if (await rows.nth(count - 1).locator('button:has-text("Label residues")').count()) throw new Error('a hide row offers Label residues');
    const expected = await page.evaluate(record => {
      const entry = window.__viewerDebug.entries().find(item => item.id === record.entryId);
      return [...new Set(entry.atoms.filter(atom => atom.atom === 'CA' && !atom.hetflag && (atom.chain || '') === 'A' && record.residues.includes(atom.resi)).map(atom => [entry.id, 'A', atom.resi].join('|')))].sort();
    }, records[0]);
    if (!expected.length) throw new Error('chain A has none of residues 5–7');
    const already = await page.evaluate(() => window.__viewerDebug.labelRecords().map(label => label.key));
    made = expected.filter(key => !already.includes(key));
    const steps = await rememberedSteps();
    await rows.nth(count - 2).locator('button:has-text("Label residues")').click(); await page.waitForTimeout(400);
    const now = await page.evaluate(() => window.__viewerDebug.labelRecords().map(label => label.key));
    const missing = expected.filter(key => !now.includes(key));
    if (missing.length) throw new Error('Label residues left ' + missing.join(', ') + ' unlabelled');
    if ((await rememberedSteps()) - steps !== 1) throw new Error('Label residues took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    const said = ((await page.locator('#gpv-state').textContent()) || '').trim();
    if (!said.startsWith('Labelled ' + made.length + ' residue')) throw new Error('announced: ' + said);
    console.log('       ' + said + ' from the A:5-7 highlight row');
  } finally {
    await removeLabelsByKey(made); await trimSelections(startCount);
    await page.fill('#gpv-selection-chain', fields.chain); await page.fill('#gpv-selection-range', fields.range); await page.selectOption('#gpv-selection-action', fields.action);
  }
});
await step('an RNA chain is box-selected and labelled per residue through its P atoms, and a calcium ion is not labelled', async () => {
  /* Before 2.52.0 both looked for atoms named CA: a nucleic acid had none, and a calcium ion's atom
     is called CA too. */
  const lines = []; let serial = 1;
  ['A', 'G', 'C', 'U', 'A', 'G'].forEach((base, index) => {
    const x = index * 6;
    lines.push(pdbAtom('ATOM', serial++, 'P', base, 'R', index + 1, [x, 0, 0], 'P'));
    lines.push(pdbAtom('ATOM', serial++, "C1'", base, 'R', index + 1, [x + 1.5, 2, 1], 'C'));
    lines.push(pdbAtom('ATOM', serial++, 'N1', base, 'R', index + 1, [x + 2, 3.2, 1.4], 'N'));
  });
  lines.push(pdbAtom('HETATM', serial++, 'CA', 'CA', 'R', 101, [15, 8, 0], 'CA'));
  const file = join(work, 'rna_with_calcium.pdb'); await writeFile(file, lines.join('\n') + '\nEND\n');
  const fresh = await freshViewer([file]);
  try {
    const labels = await fresh.evaluate(() => {
      const d = window.__viewerDebug; const shown = new Set(d.displayedEntries().map(entry => entry.id)); const texts = [];
      document.querySelector('#gpv-all-labels').checked = true;
      d.drawLabels({ addLabel: text => { texts.push(String(text)); return null; }, addLine: () => null }, shown);
      document.querySelector('#gpv-all-labels').checked = false;
      return texts;
    });
    if (labels.some(text => /^CA101/.test(text))) throw new Error('Label every residue labelled the calcium ion: ' + JSON.stringify(labels));
    if (labels.filter(text => /^[AGCU]\d · R$/.test(text)).length !== 6) throw new Error('Label every residue wrote ' + JSON.stringify(labels) + ', not one label per nucleotide');
    await fresh.click('[data-gpv-tab="annotate"]');
    const box = await fresh.locator('#gpv-stage').boundingBox();
    await fresh.keyboard.down('Shift');
    try {
      await fresh.mouse.move(box.x + 8, box.y + 8); await fresh.mouse.down();
      await fresh.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
      await fresh.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 4 }); await fresh.mouse.up();
    } finally { await fresh.keyboard.up('Shift'); }
    await fresh.waitForTimeout(500);
    const picked = await fresh.evaluate(() => window.__viewerDebug.selectionRecords().flatMap(record => record.residues).sort((a, b) => a - b));
    if (JSON.stringify(picked) !== JSON.stringify([1, 2, 3, 4, 5, 6])) throw new Error('a box over the whole RNA selected ' + JSON.stringify(picked) + ' · ' + await fresh.locator('#gpv-state').textContent());
  } finally { await fresh.close(); }
});
await step('the popover\'s Esc keeps the highlight, and its Undo takes the selection back', async () => {
  const startCount = (await selectionsNow()).length;
  try {
    await letGo();
    const region = await boxRegion();
    if (!region || region.keys.length < 2) throw new Error('no box of residues on screen');
    await dragBox(region);
    const first = (await selectionsNow()).length;
    if (first <= startCount || !(await boxPopoverShown())) throw new Error('the first box made no selection or no popover');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    if (await boxPopoverShown()) throw new Error('Esc left the popover open');
    if ((await selectionsNow()).length !== first) throw new Error('Esc took the highlight away');
    if ((await focusedId()) !== 'gpv-stage') throw new Error('Esc left the focus on ' + (await focusedId()) + ', not the stage');
    await dragBox(region);
    const second = (await selectionsNow()).length;
    if (second <= first || !(await boxPopoverShown())) throw new Error('the second box made no selection or no popover');
    await page.click('#gpv-box-undo'); await page.waitForTimeout(400);
    if (await boxPopoverShown()) throw new Error('Undo left the popover open');
    if ((await selectionsNow()).length !== first) throw new Error('Undo left ' + ((await selectionsNow()).length - startCount) + ' box rows, expected ' + (first - startCount));
  } finally { await closeBoxPopover(); await trimSelections(startCount); }
});
/* ---- The residue card, the residue marker and Measure to… (2.50.0) ----
   The editor that opens at a residue also says what it is; a marker on the main view keeps naming
   the selected residue; Measure to… (or M) measures Cα–Cα to the next residue tapped as an ordinary
   measurement record. Each step takes back what it made and leaves nothing armed and no residue
   selected. Still in the turned view, so every tap has one residue to land on. */
const markerNow = () => page.evaluate(() => window.__viewerDebug.residueMarker());
const selectedNow = () => page.evaluate(() => window.__viewerDebug.selectedResidue());
const measureArmed = () => page.evaluate(() => window.__viewerDebug.measureFrom());
const measuresNow = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__viewerDebug.measurementRecords())));
const statusNow = async () => ((await page.locator('#gpv-state').textContent()) || '').trim();
/* Esc drops an armed Measure to… first, then the editor and the active label (letGo), then — with
   nothing else open and no mode on — the selected residue. */
const clearSelection = async () => {
  if (await measureArmed()) { await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
  await letGo();
  if (await selectedNow()) { await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
};
/* Back to the number of measurements the step started with, newest rows first. */
const trimMeasurements = async count => {
  for (let guard = 0; guard < 20 && (await measuresNow()).length > count; guard += 1) {
    await page.locator('#gpv-measurement-list .gpv-entry').last().locator('button:has-text("Remove")').click(); await page.waitForTimeout(200);
  }
};
/* The labels drawLabels puts into the main viewer and into any other target, counted without
   touching 3Dmol's internals: the main viewer's addLabel is shadowed for the one call. */
const drawnLabels = () => page.evaluate(() => {
  const d = window.__viewerDebug; const v = d.viewer;
  const shown = new Set(d.displayedEntries().map(entry => entry.id));
  const main = [];
  const own = { label: Object.prototype.hasOwnProperty.call(v, 'addLabel'), line: Object.prototype.hasOwnProperty.call(v, 'addLine') };
  const original = { label: v.addLabel, line: v.addLine };
  v.addLabel = text => { main.push(String(text)); return null; };
  v.addLine = () => null;
  try { d.drawLabels(v, shown); } finally {
    if (own.label) v.addLabel = original.label; else delete v.addLabel;
    if (own.line) v.addLine = original.line; else delete v.addLine;
  }
  const other = [];
  d.drawLabels({ addLabel: text => { other.push(String(text)); return null; }, addLine: () => null }, shown);
  return { main, other, records: d.labelRecords().filter(label => shown.has(label.entryId)).length, everyResidue: document.querySelector('#gpv-all-labels').checked };
});
/* The Cα–Cα distance of two residue keys, from the atoms themselves. */
const alphaDistance = (firstKey, secondKey) => page.evaluate(([firstKey, secondKey]) => {
  const d = window.__viewerDebug;
  const find = key => {
    const [id, chain, resi] = key.split('|');
    const entry = d.entries().find(item => item.id === Number(id));
    return entry && entry.atoms.find(atom => atom.atom === 'CA' && !atom.hetflag && (atom.chain || '') === chain && atom.resi === Number(resi));
  };
  const a = find(firstKey); const b = find(secondKey);
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
}, [firstKey, secondKey]);
/* The newest measurement against what Measure to… promised: a distance between the two Cα atoms,
   drawn (the list row prints the drawn value) at the distance the atoms give, named in the status,
   in exactly one undo step — and undo takes it away again. */
const checkMeasureTo = async (first, second, startCount, steps, how) => {
  const records = await measuresNow();
  if (records.length !== startCount + 1) throw new Error(how + ' left ' + (records.length - startCount) + ' new measurements, not 1');
  const record = records[records.length - 1];
  if (record.type !== 'distance' || record.points.length !== 2) throw new Error(how + ' made ' + JSON.stringify(record));
  const keys = record.points.map(point => [point.entryId, point.chain || '', point.resi].join('|') + ':' + point.atom);
  if (keys[0] !== first.key + ':CA' || keys[1] !== second.key + ':CA') throw new Error(how + ' measured ' + keys.join(' → ') + ', not the two Cα atoms ' + first.key + ' → ' + second.key);
  const expected = await alphaDistance(first.key, second.key);
  const row = (await page.locator('#gpv-measurement-list .gpv-entry .gpv-entry-name').last().textContent()) || '';
  const drawn = Number((row.match(/· ([\d.]+) Å$/) || [])[1]);
  if (!(Math.abs(drawn - expected) <= 0.01)) throw new Error(how + ': the measurement reads ' + row + ', the atoms are ' + (expected === null ? '—' : expected.toFixed(3)) + ' Å apart');
  const said = await statusNow();
  if (!said.includes(first.text) || !said.includes(second.text) || !/Cα–Cα \d+\.\d\d Å/.test(said)) throw new Error(how + ' announced: ' + said);
  if ((await rememberedSteps()) - steps !== 1) throw new Error(how + ' took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
  if (await measureArmed()) throw new Error(how + ' is still armed after the second residue');
  await focusStage(); await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
  if ((await measuresNow()).length !== startCount) throw new Error('undo did not take the ' + how + ' measurement away');
  return { drawn, said };
};
await step('the residue card names a tapped residue with its pLDDT, secondary structure and the residues within the proximity cutoff', async () => {
  await clearSelection();
  const target = await canvasResidue();
  if (!target) throw new Error('no residue on screen to tap');
  try {
    await tap(target.x, target.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('the card did not open at ' + target.text);
    const card = await page.evaluate(key => {
      const d = window.__viewerDebug;
      const [id, chain, resi] = key.split('|');
      const entry = d.entries().find(item => item.id === Number(id));
      const ca = entry.atoms.find(atom => atom.atom === 'CA' && !atom.hetflag && (atom.chain || '') === chain && atom.resi === Number(resi));
      const near = d.nearbyResidues({ entry, mode: 'residue', residue: { chain, resi: Number(resi) } });
      const facts = document.querySelector('#gpv-residue-card-facts');
      return {
        head: document.querySelector('#gpv-label-editor .gpv-label-editor-residue').textContent,
        name: (ca.resn || 'RES') + ca.resi + (chain ? ' · chain ' + chain : ''),
        facts: facts.hidden ? '' : facts.textContent,
        scored: entry.scores.length > 0, b: Number(ca.b), many: d.entries().length > 1,
        count: near && !near.error ? near.residues.length : null, cutoff: near ? near.cutoff : null,
        group: document.querySelector('#gpv-label-editor').getAttribute('aria-label') || ''
      };
    }, target.key);
    if (!card.head.startsWith(card.name)) throw new Error('the card names "' + card.head + '", not ' + card.name);
    if (card.many && !(card.head.length > card.name.length + 3)) throw new Error('with several models loaded the card does not name the model: ' + card.head);
    if (!/^Label for /.test(card.group)) throw new Error('the card is labelled "' + card.group + '"');
    const match = card.facts.match(/^(?:pLDDT (\d+\.\d) · )?(?:(α-helix|β-strand|loop) · )?(\d+) residues? within ([\d.]+) Å$/);
    if (!match) throw new Error('the facts line is not well formed: "' + card.facts + '"');
    if (card.scored && match[1] !== card.b.toFixed(1)) throw new Error('the card says pLDDT ' + match[1] + ', the Cα\'s B-factor is ' + card.b.toFixed(1));
    if (!card.scored && match[1]) throw new Error('a model without scores shows pLDDT ' + match[1]);
    if (card.count === null || Number(match[3]) !== card.count) throw new Error('the card counts ' + match[3] + ' neighbours, the proximity tool ' + card.count);
    if (Number(match[4]) !== card.cutoff) throw new Error('the card counts within ' + match[4] + ' Å, the panel\'s cutoff is ' + card.cutoff);
    if (!(await page.locator('#gpv-label-editor-measure').isVisible()) || (await page.locator('#gpv-label-editor-measure').isDisabled())) throw new Error('the card has no usable Measure to…');
    console.log('       ' + card.head + ' · ' + card.facts);
  } finally { await clearSelection(); }
});
await step('the selected residue is named by a marker on the main view alone; Esc clears it, and a labelled residue gets none', async () => {
  await clearSelection();
  let labelled = null;
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    await letGo();
    if (await editorShown() || await activeTextNow()) throw new Error('the editor or an active label is still there');
    const marker = await markerNow();
    if (!marker || !marker.startsWith(target.text)) throw new Error('the marker reads ' + JSON.stringify(marker) + ', not ' + target.text);
    const drawn = await drawnLabels();
    if (drawn.everyResidue) throw new Error('Label every residue is on; the count below means nothing');
    if (drawn.main.length !== drawn.records + 1) throw new Error('the main view draws ' + drawn.main.length + ' labels for ' + drawn.records + ' label records');
    if (!drawn.main.includes(marker)) throw new Error('the main view does not draw the marker: ' + JSON.stringify(drawn.main));
    await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await selectedNow()) throw new Error('Esc left the residue selected');
    if (await markerNow()) throw new Error('Esc left the marker');
    if ((await statusNow()) !== 'No residue selected') throw new Error('announced: ' + (await statusNow()));
    if ((await drawnLabels()).main.length !== drawn.records) throw new Error('the main view still draws an extra label');
    labelled = await labelOnCanvas('Marker check');
    await letGo();
    const picked = await selectedNow();
    if (!picked || [picked.entryId, picked.chain, picked.resi].join('|') !== labelled.key) throw new Error('labelling did not leave the labelled residue selected');
    if (await markerNow()) throw new Error('a labelled residue got a marker as well: ' + (await markerNow()));
    console.log('       "' + marker + '" on screen · Esc cleared it · none on a labelled residue');
  } finally { await clearSelection(); if (labelled) await removeLabelByKey(labelled.key); await clearSelection(); }
});
await step('Measure to… on the card, and M for the selected residue, each measure Cα–Cα to the next residue tapped as one ordinary measurement', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  try {
    const first = await canvasResidue();
    if (!first) throw new Error('no residue on screen to tap');
    const steps = await rememberedSteps();
    await tap(first.x, first.y); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('the card did not open');
    await page.click('#gpv-label-editor-measure'); await page.waitForTimeout(200);
    if (await editorShown()) throw new Error('Measure to… left the card open');
    if (!(await measureArmed())) throw new Error('Measure to… armed nothing');
    if (!(await statusNow()).startsWith('Click a second residue to measure from ' + first.text)) throw new Error('announced: ' + (await statusNow()));
    if (!(await page.locator('#gpv-stage.is-measuring-to').count())) throw new Error('the cursor is not a crosshair');
    const second = await canvasResidue([first.key]);
    if (!second) throw new Error('no second residue on screen');
    await tap(second.x, second.y); await page.waitForTimeout(400);
    if (await editorShown()) throw new Error('the second tap opened the card instead of finishing the measurement');
    if (await page.locator('#gpv-stage.is-measuring-to').count()) throw new Error('the crosshair stayed after the measurement');
    const card = await checkMeasureTo(first, second, startCount, steps, 'Measure to…');
    await clearSelection();
    const third = await canvasResidue();
    if (!third) throw new Error('no residue on screen to tap');
    await tap(third.x, third.y); await page.waitForTimeout(400);
    await letGo();
    const keySteps = await rememberedSteps();
    await focusStage(); await page.keyboard.press('m'); await page.waitForTimeout(200);
    if (await editorShown()) throw new Error('M opened the card');
    if (!(await measureArmed())) throw new Error('M armed nothing for ' + third.text);
    await tap(third.x, third.y); await page.waitForTimeout(400);
    if ((await measuresNow()).length !== startCount) throw new Error('tapping the same residue again measured something');
    if (!/nothing measured/.test(await statusNow())) throw new Error('tapping the same residue again announced: ' + (await statusNow()));
    if (!(await measureArmed())) throw new Error('tapping the same residue again dropped the arm');
    const fourth = await canvasResidue([third.key]);
    if (!fourth) throw new Error('no second residue on screen');
    await tap(fourth.x, fourth.y); await page.waitForTimeout(400);
    const key = await checkMeasureTo(third, fourth, startCount, keySteps, 'M');
    console.log('       "' + card.said + '" · and by M: "' + key.said + '" · each one undo step, undone');
  } finally { await clearSelection(); await trimMeasurements(startCount); }
});
await step('Esc cancels an armed Measure to…, and the next tap is an ordinary click again', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  try {
    const first = await canvasResidue();
    if (!first) throw new Error('no residue on screen to tap');
    await tap(first.x, first.y); await page.waitForTimeout(400);
    await page.click('#gpv-label-editor-measure'); await page.waitForTimeout(200);
    if (!(await measureArmed())) throw new Error('Measure to… armed nothing');
    await focusStage(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await measureArmed()) throw new Error('Esc left Measure to… armed');
    if (!/cancelled/.test(await statusNow())) throw new Error('announced: ' + (await statusNow()));
    if (await page.locator('#gpv-stage.is-measuring-to').count()) throw new Error('the crosshair stayed after Esc');
    if (!(await selectedNow())) throw new Error('the Esc that cancelled also cleared the selected residue');
    const second = await canvasResidue([first.key]);
    if (!second) throw new Error('no second residue on screen');
    await tap(second.x, second.y); await page.waitForTimeout(400);
    if ((await measuresNow()).length !== startCount) throw new Error('a tap after the cancel still measured');
    if (!(await editorShown())) throw new Error('a tap after the cancel did not open the card');
  } finally { await clearSelection(); await trimMeasurements(startCount); }
});
await step('with measurement mode on, the card\'s Measure to… is disabled and M does not arm', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  try {
    await page.click('#gpv-measure'); await page.waitForTimeout(200);
    if (!/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) throw new Error('measurement mode did not start');
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    if (await editorShown()) throw new Error('the card opened while measuring');
    await focusStage(); await page.keyboard.press('l'); await page.waitForTimeout(300);
    if (!(await editorShown())) throw new Error('L did not open the card for the selected residue');
    const button = page.locator('#gpv-label-editor-measure');
    if (!(await button.isVisible()) || !(await button.isDisabled())) throw new Error('Measure to… is not disabled while measuring');
    if (!/measurement mode/.test((await button.getAttribute('title')) || '')) throw new Error('the disabled button says: ' + (await button.getAttribute('title')));
    await letGo();
    await focusStage(); await page.keyboard.press('m'); await page.waitForTimeout(200);
    if (await measureArmed()) throw new Error('M armed Measure to… while measuring');
  } finally {
    if (/Stop measuring/.test((await page.locator('#gpv-measure').textContent()) || '')) { await page.click('#gpv-measure'); await page.waitForTimeout(200); }
    await clearSelection(); await trimMeasurements(startCount);
  }
});
await step('a figure export and the comparison panels never draw the residue marker', async () => {
  await clearSelection();
  let labelled = null;
  try {
    /* One label record, so the export has a label of its own to show the count is being made. */
    labelled = await labelOnCanvas('Export check');
    await letGo();
    const target = await canvasResidue([labelled.key]);
    if (!target) throw new Error('no second residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    await letGo();
    const marker = await markerNow();
    if (!marker) throw new Error('no marker to look for');
    const drawn = await drawnLabels();
    if (drawn.other.length !== drawn.records || drawn.other.includes(marker)) throw new Error('a panel target gets ' + drawn.other.length + ' labels for ' + drawn.records + ' records: ' + JSON.stringify(drawn.other));
    const exported = await page.evaluate(async () => {
      const d = window.__viewerDebug;
      const proto = Object.getPrototypeOf(d.viewer); const original = proto.addLabel; const texts = [];
      proto.addLabel = function (text, ...rest) { if (this !== d.viewer) texts.push(String(text)); return original.call(this, text, ...rest); };
      try { await d.renderPublicationImage(); } finally { proto.addLabel = original; d.releaseExportViewer(); }
      return texts;
    });
    if (!exported.includes('Export check')) throw new Error('the export drew none of the labels, so it cannot show the marker is missing: ' + JSON.stringify(exported));
    if (exported.includes(marker)) throw new Error('the figure export drew the marker "' + marker + '"');
    if (!(await markerNow())) throw new Error('the export took the marker off the screen');
    console.log('       "' + marker + '" on screen · not in a ' + exported.length + '-label export or a panel');
  } finally { await clearSelection(); if (labelled) await removeLabelByKey(labelled.key); await clearSelection(); }
});
/* ---- A residue's contacts on the card, closest-atom measurements, colour by distance (2.51.0) ----
   The card's neighbour count (or Contacts) opens the residue's contacts — the proximity tool's own
   residues, nearest first, with their closest heavy atoms and Cα–Cα distance; a row measures, Measure
   all measures every one in one undo step, Highlight makes what Highlight nearby residues makes. The
   card's Measure choice (Cα–Cα or closest atoms) governs every residue-to-residue measurement it
   makes. Every step takes back what it made: records, selection, the measure choice, the colour
   scheme. Still in the turned view. */
const contactRowsNow = () => page.evaluate(() => [...document.querySelectorAll('#gpv-residue-contacts-rows .gpv-residue-contact')].map(button => ({
  chain: button.dataset.chain, resi: Number(button.dataset.resi), closest: Number(button.dataset.closest), atoms: button.dataset.atoms, bond: button.dataset.bond,
  /* the name cell's own text, before the bond tag it may hold */
  name: button.querySelector('.gpv-contact-name').firstChild.textContent, text: button.textContent
})));
const contactsShown = () => page.locator('#gpv-residue-contacts').isVisible();
/* The card's measure choice, put back without needing the card open: the select keeps its listener. */
const setMeasureChoice = value => page.evaluate(value => {
  const select = document.querySelector('#gpv-label-editor-measure-atoms'); if (!select || select.value === value) return;
  select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
const pointKey = point => [point.entryId, point.chain || '', point.resi].join('|') + ':' + point.atom;
/* A residue's contacts from the atoms alone: the residues with a heavy atom within the proximity
   tool's cutoff of one of its heavy atoms, each with its closest distance. */
const contactsFromAtoms = key => page.evaluate(key => {
  const d = window.__viewerDebug; const [id, chain, resi] = key.split('|');
  const entry = d.entries().find(item => item.id === Number(id));
  const near = d.nearbyResidues({ entry, mode: 'residue', residue: { chain, resi: Number(resi) } });
  const heavy = d.heavyAtoms(entry);
  const own = heavy.filter(atom => (atom.chain || '') === chain && atom.resi === Number(resi));
  const byResidue = new Map();
  heavy.forEach(atom => {
    if (atom.hetflag || ((atom.chain || '') === chain && atom.resi === Number(resi))) return;
    const k = (atom.chain || '') + '|' + atom.resi; let best = Infinity;
    own.forEach(mine => { best = Math.min(best, Math.hypot(atom.x - mine.x, atom.y - mine.y, atom.z - mine.z)); });
    if (!byResidue.has(k) || byResidue.get(k) > best) byResidue.set(k, best);
  });
  return { cutoff: near.cutoff, near: near.residues.map(item => item.chain + '|' + item.resi), closest: Object.fromEntries(byResidue) };
}, key);
/* The distance between two named atoms of two residues of one model, from the atoms themselves. */
const namedAtomDistance = (id, chainA, resiA, atomA, chainB, resiB, atomB) => page.evaluate(([id, chainA, resiA, atomA, chainB, resiB, atomB]) => {
  const entry = window.__viewerDebug.entries().find(item => item.id === id);
  const find = (chain, resi, name) => entry.atoms.find(atom => (atom.chain || '') === chain && atom.resi === resi && atom.atom === name);
  const a = find(chainA, resiA, atomA); const b = find(chainB, resiB, atomB);
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : null;
}, [id, chainA, resiA, atomA, chainB, resiB, atomB]);
const newestMeasurementText = async () => (await page.locator('#gpv-measurement-list .gpv-entry .gpv-entry-name').last().textContent()) || '';
const openCardAt = async target => {
  await tap(target.x, target.y); await page.waitForTimeout(400);
  if (!(await editorShown())) throw new Error('the card did not open at ' + target.text);
};
await step('the card lists a residue\'s contacts: the proximity tool\'s residues, nearest first, each with its closest atoms as the atoms give them', async () => {
  await clearSelection();
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await openCardAt(target);
    if (await contactsShown()) throw new Error('the contacts list was open before it was asked for');
    /* The count on the facts line is the way in. */
    await page.click('#gpv-residue-card-near'); await page.waitForTimeout(250);
    if (!(await contactsShown())) throw new Error('the neighbour count did not open the contacts list');
    if ((await page.getAttribute('#gpv-label-editor-contacts', 'aria-expanded')) !== 'true') throw new Error('Contacts does not say the list is open');
    const rows = await contactRowsNow();
    const truth = await contactsFromAtoms(target.key);
    const facts = (await page.locator('#gpv-residue-card-facts').textContent()) || '';
    const counted = Number((facts.match(/(\d+) residues? within/) || [])[1]);
    if (rows.length !== truth.near.length) throw new Error('the list has ' + rows.length + ' rows, the proximity tool ' + truth.near.length + ' residues');
    if (counted !== rows.length) throw new Error('the card counts ' + counted + ', the list has ' + rows.length + ' rows');
    const keys = rows.map(row => row.chain + '|' + row.resi);
    if (truth.near.some(key => !keys.includes(key))) throw new Error('the list leaves out ' + truth.near.filter(key => !keys.includes(key)).join(', '));
    const [entryId] = target.key.split('|'); const [, chain, resi] = target.key.split('|');
    for (const [index, row] of rows.entries()) {
      if (index && row.closest < rows[index - 1].closest - 1e-9) throw new Error('the list is not nearest first at ' + row.name);
      const direct = truth.closest[row.chain + '|' + row.resi];
      if (!(Math.abs(row.closest - direct) <= 0.001)) throw new Error(row.name + ' is listed at ' + row.closest + ' Å, the atoms say ' + direct.toFixed(3));
      if (!(row.closest <= truth.cutoff + 1e-9)) throw new Error(row.name + ' at ' + row.closest + ' Å is beyond the ' + truth.cutoff + ' Å cutoff');
      const pair = row.atoms.match(/^([A-Z0-9'"*]+)–([A-Z0-9'"*]+)$/);
      if (!pair) throw new Error(row.name + ' names the atom pair "' + row.atoms + '"');
      const named = await namedAtomDistance(Number(entryId), chain, Number(resi), pair[1], row.chain, row.resi, pair[2]);
      if (!(Math.abs(named - row.closest) <= 0.001)) throw new Error(row.name + ': ' + row.atoms + ' are ' + named + ' Å apart, the row says ' + row.closest);
      if (!/^\S+\d+ · \S+(?:peptide bond|disulfide)?\d+\.\d\d Å\S+–\S+Cα \d+\.\d\d Å$/.test(row.text)) throw new Error('a row reads "' + row.text + '"');
      const bonded = (row.atoms === 'C–N' || row.atoms === 'N–C') && row.closest <= 1.9 ? 'peptide' : '';
      if (row.bond !== bonded && !(row.atoms === 'SG–SG' && row.bond === 'disulfide')) throw new Error(row.name + ' (' + row.atoms + ' ' + row.closest + ' Å) is tagged "' + row.bond + '", not "' + bonded + '"');
      if (Boolean(row.bond) !== row.text.includes(row.bond === 'disulfide' ? 'disulfide' : 'peptide bond')) throw new Error(row.name + ' is tagged "' + row.bond + '" but reads "' + row.text + '"');
    }
    console.log('       ' + target.text + ' · ' + rows.length + ' contacts within ' + truth.cutoff + ' Å · nearest ' + (rows[0] ? rows[0].name + ' ' + rows[0].closest.toFixed(2) + ' Å ' + rows[0].atoms : '—'));
  } finally { await clearSelection(); }
});
await step('the card closes when its model or its chain is hidden, instead of following a residue no longer drawn', async () => {
  await clearSelection();
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  /* Showing a model again refits the view; the later steps want the turned view back exactly. */
  const view = await page.evaluate(() => window.__viewerDebug.viewer.getView());
  let target = await canvasResidue();
  if (!target) throw new Error('no residue on screen to tap');
  const id = target.key.split('|')[0];
  const modelSwitch = page.locator('#gpv-list [data-entry-id="' + id + '"] input[aria-label^="Show "]');
  let chainSwitch = null;
  try {
    await openCardAt(target);
    await tab('models'); await modelSwitch.uncheck(); await page.waitForTimeout(400);
    if (await editorShown()) throw new Error('the card stayed open over a hidden model');
    await modelSwitch.check(); await page.waitForTimeout(400);
    await page.evaluate(view => { const viewer = window.__viewerDebug.viewer; viewer.setView(view); viewer.render(); }, view); await page.waitForTimeout(200);
    /* The Composition table lists the active model's chains. */
    target = await canvasResidue();
    const [tid, chain] = target ? target.key.split('|') : [];
    chainSwitch = page.locator('#gpv-chain-rows input[aria-label="Show chain ' + chain + '"]');
    if (target && chain && await page.evaluate(id => (window.__viewerDebug.activeEntry() || {}).id === Number(id), tid) && await chainSwitch.count()) {
      await tab('annotate'); await openCardAt(target);
      await tab('models'); await chainSwitch.uncheck(); await page.waitForTimeout(400);
      if (await editorShown()) throw new Error('the card stayed open over a hidden chain');
    }
  } finally {
    await tab('models');
    if (!(await modelSwitch.isChecked())) { await modelSwitch.check(); await page.waitForTimeout(300); }
    if (chainSwitch && (await chainSwitch.count()) && !(await chainSwitch.isChecked())) { await chainSwitch.check(); await page.waitForTimeout(300); }
    await page.evaluate(view => { const viewer = window.__viewerDebug.viewer; viewer.setView(view); viewer.render(); }, view); await page.waitForTimeout(200);
    await clearSelection(); await tab(startTab);
  }
});
await step('a new proximity cutoff recounts the open card and its contacts list', async () => {
  await clearSelection();
  const cutoffBefore = await page.inputValue('#gpv-near-cutoff');
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await openCardAt(target);
    await page.evaluate(() => document.querySelector('#gpv-residue-card-near').click()); await page.waitForTimeout(250);
    const wanted = cutoffBefore === '8' ? '6' : '8';
    await page.evaluate(value => { const field = document.querySelector('#gpv-near-cutoff'); field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }, wanted);
    await page.waitForTimeout(300);
    if (!(await editorShown())) throw new Error('the card closed on a new cutoff');
    const facts = (await page.locator('#gpv-residue-card-facts').textContent()) || '';
    if (!facts.includes('within ' + Number(wanted) + ' Å')) throw new Error('the card still reads "' + facts + '" after the cutoff became ' + wanted + ' Å');
    const count = Number((facts.match(/(\d+) residues? within/) || [])[1]);
    const rows = await page.locator('#gpv-residue-contacts-rows .gpv-residue-contact').count();
    if (!(await contactsShown()) || rows !== count) throw new Error('the contacts list has ' + rows + ' rows for a count of ' + count);
  } finally {
    await page.evaluate(value => { const field = document.querySelector('#gpv-near-cutoff'); field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }, cutoffBefore);
    await clearSelection(); await tab(startTab);
  }
});
await step('on a phone the card with its contacts open fits inside the 380 px view and scrolls', async () => {
  await clearSelection();
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  /* Go to zooms onto the residue; the later steps want the turned view back exactly. */
  const view = await page.evaluate(() => window.__viewerDebug.viewer.getView());
  try {
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
    await tab('annotate'); await page.fill('#gpv-goto', 'A:5'); await page.click('#gpv-goto-run'); await page.waitForTimeout(400);
    await focusStage(); await page.keyboard.press('l'); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('L did not open the card');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(400);
    if (!(await contactsShown())) throw new Error('the contacts list did not open');
    const fit = await page.evaluate(() => {
      const host = document.querySelector('#gpv-label-editor'); const stage = document.querySelector('#gpv-stage');
      return { top: host.offsetTop, bottom: host.offsetTop + host.offsetHeight, stage: stage.clientHeight, scrolls: host.scrollHeight > host.clientHeight + 1 };
    });
    if (fit.top < 0 || fit.bottom > fit.stage) throw new Error('the card runs from ' + fit.top + ' to ' + fit.bottom + ' px in a ' + fit.stage + ' px view');
    console.log('       card ' + (fit.bottom - fit.top) + ' px in a ' + fit.stage + ' px view' + (fit.scrolls ? ', scrolling' : ''));
  } finally {
    await clearSelection();
    await page.setViewportSize({ width: 1280, height: 1000 }); await page.waitForTimeout(600);
    await page.evaluate(view => { const viewer = window.__viewerDebug.viewer; viewer.setView(view); viewer.render(); }, view); await page.waitForTimeout(200);
    await tab(startTab);
  }
});
await step('a click on a contact measures it — the two Cα atoms by default, the closest atoms when chosen — one undo step each, and the list stays open', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    const [entryId] = target.key.split('|');
    await openCardAt(target);
    if ((await page.inputValue('#gpv-label-editor-measure-atoms')) !== 'ca') throw new Error('the measure choice does not start at Cα–Cα');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
    const rows = await contactRowsNow();
    if (!rows.length) throw new Error('no contacts to click');
    const row = rows[0];
    let steps = await rememberedSteps();
    await page.locator('#gpv-residue-contacts-rows .gpv-residue-contact').first().click(); await page.waitForTimeout(300);
    let records = await measuresNow();
    if (records.length !== startCount + 1) throw new Error('a click on a contact made ' + (records.length - startCount) + ' measurements, not 1');
    let keys = records[records.length - 1].points.map(pointKey);
    if (keys[0] !== target.key + ':CA' || keys[1] !== [entryId, row.chain, row.resi].join('|') + ':CA') throw new Error('the click measured ' + keys.join(' → ') + ', not the two Cα atoms');
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the click took ' + ((await rememberedSteps()) - steps) + ' undo steps');
    if (!(await editorShown()) || !(await contactsShown())) throw new Error('measuring a contact closed the list');
    await undoOnce();
    if ((await measuresNow()).length !== startCount) throw new Error('undo did not take the Cα–Cα measurement away');
    /* Closest atoms: the record joins the two atoms the row names, at the row's distance. */
    await clearSelection();
    await openCardAt(target);
    await page.selectOption('#gpv-label-editor-measure-atoms', 'closest'); await page.waitForTimeout(150);
    if (await page.evaluate(() => window.__viewerDebug.measureAtoms()) !== 'closest') throw new Error('the choice did not take');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
    const again = (await contactRowsNow())[0];
    steps = await rememberedSteps();
    await page.locator('#gpv-residue-contacts-rows .gpv-residue-contact').first().click(); await page.waitForTimeout(300);
    records = await measuresNow();
    if (records.length !== startCount + 1) throw new Error('a click with closest atoms made ' + (records.length - startCount) + ' measurements, not 1');
    keys = records[records.length - 1].points.map(pointKey);
    const [atomA, atomB] = again.atoms.split('–');
    if (keys[0] !== target.key + ':' + atomA || keys[1] !== [entryId, again.chain, again.resi].join('|') + ':' + atomB) throw new Error('closest atoms measured ' + keys.join(' → ') + ', the row names ' + again.atoms);
    const drawn = Number(((await newestMeasurementText()).match(/· ([\d.]+) Å$/) || [])[1]);
    if (!(Math.abs(drawn - again.closest) <= 0.006)) throw new Error('the measurement reads ' + drawn + ' Å, the row ' + again.closest);
    /* The status writes a Cα as Cα, as every measurement status does. */
    const spoken = [atomA, atomB].map(name => (name === 'CA' ? 'Cα' : name)).join('–');
    if (!(await statusNow()).includes(': ' + spoken + ' ' + drawn.toFixed(2) + ' Å')) throw new Error('the status does not name the atoms: ' + (await statusNow()));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the click took ' + ((await rememberedSteps()) - steps) + ' undo steps');
    await undoOnce();
    if ((await measuresNow()).length !== startCount) throw new Error('undo did not take the closest-atom measurement away');
    console.log('       ' + target.text + ' → ' + row.name + ' Cα–Cα, then ' + again.name + ' ' + again.atoms + ' ' + drawn.toFixed(2) + ' Å · one undo step each');
  } finally { await setMeasureChoice('ca'); await clearSelection(); await trimMeasurements(startCount); }
});
await step('Measure all draws every contact in one undo step; Highlight makes what Highlight nearby residues makes, in one undo step', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  const startSelections = await page.evaluate(() => window.__viewerDebug.selectionRecords().length);
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    const [entryId] = target.key.split('|');
    await openCardAt(target);
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
    const rows = await contactRowsNow();
    if (rows.length < 2) throw new Error('only ' + rows.length + ' contacts — Measure all needs a list');
    const wanted = rows.map(row => [entryId, row.chain, row.resi].join('|') + ':CA').sort();
    let steps = await rememberedSteps();
    await page.click('#gpv-residue-contacts-measure-all'); await page.waitForTimeout(400);
    const records = await measuresNow();
    if (records.length !== startCount + rows.length) throw new Error('Measure all made ' + (records.length - startCount) + ' measurements for ' + rows.length + ' contacts');
    const made = records.slice(startCount);
    if (made.some(record => pointKey(record.points[0]) !== target.key + ':CA')) throw new Error('a measurement does not start at ' + target.text + '\'s Cα');
    const reached = made.map(record => pointKey(record.points[1])).sort();
    if (reached.join(',') !== wanted.join(',')) throw new Error('Measure all reached ' + reached.join(', ') + ', the list ' + wanted.join(', '));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('Measure all took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    if (!new RegExp('^' + rows.length + ' measurements from ').test(await statusNow())) throw new Error('Measure all announced: ' + (await statusNow()));
    await undoOnce();
    if ((await measuresNow()).length !== startCount) throw new Error('one undo left ' + ((await measuresNow()).length - startCount) + ' of the ' + rows.length + ' measurements');
    /* Highlight: the selection records Highlight nearby residues makes — one per chain, in the
       highlight colour, together the listed residues — as one undo step. */
    await clearSelection();
    await openCardAt(target);
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
    steps = await rememberedSteps();
    await page.click('#gpv-residue-contacts-highlight'); await page.waitForTimeout(400);
    const added = await page.evaluate(count => JSON.parse(JSON.stringify(window.__viewerDebug.selectionRecords().slice(count))), startSelections);
    const colour = await page.inputValue('#gpv-selection-color');
    const chains = [...new Set(rows.map(row => row.chain))];
    if (added.length !== chains.length) throw new Error('Highlight made ' + added.length + ' selection records for contacts on ' + chains.length + ' chains');
    if (added.some(record => record.action !== 'highlight' || record.color !== colour || String(record.entryId) !== entryId)) throw new Error('Highlight made ' + JSON.stringify(added));
    const highlighted = added.flatMap(record => record.residues.map(resi => record.chain + '|' + resi)).sort();
    const listed = rows.map(row => row.chain + '|' + row.resi).sort();
    if (highlighted.join(',') !== listed.join(',')) throw new Error('Highlight covers ' + highlighted.join(', ') + ', the list ' + listed.join(', '));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('Highlight took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    await undoOnce();
    if ((await page.evaluate(() => window.__viewerDebug.selectionRecords().length)) !== startSelections) throw new Error('undo did not take the highlight away');
    console.log('       ' + target.text + ': ' + rows.length + ' measurements in one step · highlight of ' + listed.length + ' residues on ' + chains.length + ' chain' + (chains.length === 1 ? '' : 's'));
  } finally {
    await clearSelection(); await trimMeasurements(startCount);
    for (let guard = 0; guard < 10 && (await page.evaluate(() => window.__viewerDebug.selectionRecords().length)) > startSelections; guard += 1) {
      await page.locator('#gpv-selection-list .gpv-entry').last().locator('button:has-text("Remove")').click(); await page.waitForTimeout(250);
    }
  }
});
await step('with closest atoms chosen, M measures the closest heavy atoms to the next residue tapped and the status names them', async () => {
  await clearSelection();
  const startCount = (await measuresNow()).length;
  try {
    const first = await canvasResidue();
    if (!first) throw new Error('no residue on screen to tap');
    await openCardAt(first);
    await page.selectOption('#gpv-label-editor-measure-atoms', 'closest'); await page.waitForTimeout(150);
    await letGo();
    if (!(await selectedNow())) throw new Error('closing the card dropped the selected residue');
    const steps = await rememberedSteps();
    await focusStage(); await page.keyboard.press('m'); await page.waitForTimeout(200);
    if (!(await measureArmed())) throw new Error('M armed nothing');
    const second = await canvasResidue([first.key]);
    if (!second) throw new Error('no second residue on screen');
    await tap(second.x, second.y); await page.waitForTimeout(400);
    const records = await measuresNow();
    if (records.length !== startCount + 1) throw new Error('M made ' + (records.length - startCount) + ' measurements, not 1');
    const points = records[records.length - 1].points;
    const keys = points.map(point => [point.entryId, point.chain || '', point.resi].join('|'));
    if (keys[0] !== first.key || keys[1] !== second.key) throw new Error('M measured ' + keys.join(' → ') + ', not ' + first.key + ' → ' + second.key);
    /* The two atoms are the closest pair: as close as any heavy atom of one residue gets to the other. */
    const closest = await page.evaluate(([a, b]) => {
      const d = window.__viewerDebug; const [id, chainA, resiA] = a.split('|'); const [, chainB, resiB] = b.split('|');
      const entry = d.entries().find(item => item.id === Number(id)); const heavy = d.heavyAtoms(entry);
      const of = (chain, resi) => heavy.filter(atom => (atom.chain || '') === chain && atom.resi === Number(resi));
      let best = Infinity; of(chainA, resiA).forEach(x => of(chainB, resiB).forEach(y => { best = Math.min(best, Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z)); }));
      return best;
    }, [first.key, second.key]);
    const drawn = Number(((await newestMeasurementText()).match(/· ([\d.]+) Å$/) || [])[1]);
    if (!(Math.abs(drawn - closest) <= 0.006)) throw new Error('M drew ' + drawn + ' Å, the closest atoms are ' + closest.toFixed(3) + ' Å apart');
    const said = await statusNow();
    const names = points.map(point => (point.atom === 'CA' ? 'Cα' : point.atom)).join('–');
    if (!said.startsWith(first.text + ' — ' + second.text + ': ' + names + ' ' + drawn.toFixed(2) + ' Å')) throw new Error('M announced: ' + said);
    if ((await rememberedSteps()) - steps !== 1) throw new Error('M took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    await undoOnce();
    if ((await measuresNow()).length !== startCount) throw new Error('undo did not take the measurement away');
    console.log('       "' + said + '"');
  } finally { await setMeasureChoice('ca'); await clearSelection(); await trimMeasurements(startCount); }
});
await step('colour by distance from the selected residue: closest heavy-atom bands on the model and the strip, a legend and methods sentence naming the residue, an announcement with nothing selected, and a scene keeps the mode', async () => {
  await clearSelection();
  const startMode = await page.inputValue('#gpv-color-mode');
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  /* The picked residue's colours, and the strip's pixels for the near and far residues. */
  const coloursFor = key => page.evaluate(key => {
    const d = window.__viewerDebug; const [id, chain, resi] = key.split('|');
    const entry = d.entries().find(item => item.id === Number(id));
    const heavy = d.heavyAtoms(entry).filter(atom => !atom.hetflag);
    const own = heavy.filter(atom => (atom.chain || '') === chain && atom.resi === Number(resi));
    const closest = new Map();
    heavy.forEach(atom => {
      if ((atom.chain || '') === chain && atom.resi === Number(resi)) return;
      const k = (atom.chain || '') + '|' + atom.resi; let best = Infinity;
      own.forEach(mine => { best = Math.min(best, Math.hypot(atom.x - mine.x, atom.y - mine.y, atom.z - mine.z)); });
      if (!closest.has(k) || closest.get(k) > best) closest.set(k, best);
    });
    const entries = [...closest.entries()];
    const near = entries.filter(([, value]) => value <= 4).sort((a, b) => a[1] - b[1])[0];
    const far = entries.filter(([, value]) => value > 20).sort((a, b) => b[1] - a[1])[0];
    const fn = d.colorOptions(entry).colorfunc;
    const alpha = k => { const [c, r] = k.split('|'); return entry.atoms.find(atom => atom.atom === 'CA' && (atom.chain || '') === c && atom.resi === Number(r)); };
    const strip = k => {
      const [c, r] = k.split('|');
      const canvas = document.querySelector('#gpv-sequence-rows canvas[data-entry-id="' + entry.id + '"][data-chain="' + c + '"]');
      if (!canvas) return null;
      const residues = [...new Set(entry.atoms.filter(atom => !atom.hetflag && (atom.chain || '') === c).map(atom => atom.resi))].sort((a, b) => a - b);
      const index = residues.indexOf(Number(r)); const ratio = window.devicePixelRatio || 1; const cell = canvas.clientWidth / residues.length;
      const px = canvas.getContext('2d').getImageData(Math.floor((index * cell + Math.min(1.5, cell / 4)) * ratio), Math.floor(5 * ratio), 1, 1).data;
      return '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    };
    return {
      near: near ? { key: near[0], distance: near[1], colour: fn(alpha(near[0])), strip: strip(near[0]) } : null,
      far: far ? { key: far[0], distance: far[1], colour: fn(alpha(far[0])), strip: strip(far[0]) } : null,
      /* `key` carries the entry id too; alpha wants chain|resi. */
      /* The residue itself is orange in either theme (2.52.0): the theme accent was close to the blue bands. */
      self: fn(alpha(chain + '|' + resi)), accent: '#f97316'
    };
  }, key);
  const close = (a, b) => { const rgb = hex => [1, 3, 5].map(i => parseInt(String(hex).slice(i, i + 2), 16)); const x = rgb(a); const y = rgb(b); return x.every((v, i) => Math.abs(v - y[i]) <= 3); };
  try {
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    await letGo();
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'fromresidue'); await page.waitForTimeout(600);
    const seen = await coloursFor(target.key);
    if (!seen.near || !seen.far) throw new Error('the fixture has no residue within 4 Å and beyond 20 Å of ' + target.text);
    if (seen.near.colour !== '#1e3a8a') throw new Error(seen.near.key + ' at ' + seen.near.distance.toFixed(2) + ' Å is ' + seen.near.colour + ', not #1e3a8a');
    if (seen.far.colour !== '#d1d5db') throw new Error(seen.far.key + ' at ' + seen.far.distance.toFixed(2) + ' Å is ' + seen.far.colour + ', not #d1d5db');
    if (seen.self !== seen.accent) throw new Error('the selected residue is ' + seen.self + ', not ' + seen.accent);
    if (!seen.near.strip || !close(seen.near.strip, '#1e3a8a') || !seen.far.strip || !close(seen.far.strip, '#d1d5db')) throw new Error('the strip shows ' + seen.near.strip + ' and ' + seen.far.strip);
    /* The same colours in the dark interface theme: a figure must not depend on the theme. */
    const themeBefore = await page.evaluate(() => document.querySelector('#gpv-theme').dataset.mode || 'system');
    try {
      await page.evaluate(() => { for (let i = 0; i < 3 && document.querySelector('#gpv-theme').dataset.mode !== 'dark'; i += 1) document.querySelector('#gpv-theme').click(); });
      await page.waitForTimeout(300);
      const dark = await coloursFor(target.key);
      if (dark.self !== '#f97316' || dark.far.colour !== '#d1d5db') throw new Error('in the dark theme the residue is ' + dark.self + ' and the far band ' + dark.far.colour);
    } finally { await page.evaluate(mode => { for (let i = 0; i < 3 && (document.querySelector('#gpv-theme').dataset.mode || 'system') !== mode; i += 1) document.querySelector('#gpv-theme').click(); }, themeBefore); await page.waitForTimeout(300); }
    /* Recording a spin video hides the marker but keeps the residue selected, so the video is coloured
       by distance too (before 2.52.0 it deselected the residue and every frame was grey). */
    if (await page.evaluate(() => typeof MediaRecorder !== 'undefined' && Boolean(document.querySelector('#gpv-stage canvas').captureStream))) {
      await tab('publish');
      const video = page.waitForEvent('download', { timeout: 30000 });
      await page.click('#gpv-video'); await page.waitForTimeout(300);
      if (!(await selectedNow())) throw new Error('recording a video deselected the residue');
      if (await markerNow()) throw new Error('the marker is drawn while the video records');
      if ((await coloursFor(target.key)).self !== '#f97316') throw new Error('the video records the model without distance colouring');
      await video; await page.waitForTimeout(300);
      if (!(await selectedNow())) throw new Error('the residue was deselected after the video');
      if (!(await markerNow())) throw new Error('the marker did not come back after the video');
      await tab('appearance');
    }
    const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
    if (!legend.includes('Distance from ' + target.text) || !legend.includes('≤4 Å') || !legend.includes('>20 Å')) throw new Error('legend: ' + legend);
    const title = (await page.locator('#gpv-sequence-title').textContent()) || '';
    if (!title.includes('coloured by distance from ' + target.text)) throw new Error('strip title: ' + title);
    const [, chain, resi] = target.key.split('|');
    const methods = await page.evaluate(() => window.__viewerDebug.methodsText());
    const wanted = 'Residues are coloured by the distance of their closest heavy atom to ' + target.text.split(' · ')[0] + (chain ? ' of chain ' + chain : '');
    if (!methods.includes(wanted)) throw new Error('the methods text lacks "' + wanted + '"');
    /* Another residue recolours; nothing selected is grey and the mode says what it needs. */
    const other = await canvasResidue([target.key]);
    if (other) {
      await tap(other.x, other.y); await page.waitForTimeout(500); await letGo();
      const moved = await coloursFor(other.key);
      if (moved.self !== moved.accent) throw new Error('selecting ' + other.text + ' did not recolour from it');
    }
    await clearSelection(); await page.waitForTimeout(300);
    const grey = await page.evaluate(([key, resi]) => { const d = window.__viewerDebug; const entry = d.entries().find(item => item.id === Number(key.split('|')[0])); const atom = entry.atoms.find(a => a.atom === 'CA' && a.resi === resi); return d.colorOptions(entry).colorfunc(atom); }, [target.key, Number(resi)]);
    if (grey !== '#9ca3af') throw new Error('with nothing selected a residue is ' + grey + ', not grey');
    await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(200);
    await page.selectOption('#gpv-color-mode', 'fromresidue'); await page.waitForTimeout(300);
    if (!/Click a residue first/.test(await statusNow())) throw new Error('with nothing selected the mode announced: ' + (await statusNow()));
    /* A scene carries the mode like any other value of the colour scheme. */
    const scene = await page.evaluate(() => window.__viewerDebug.sceneSettings().colorMode);
    if (scene !== 'fromresidue') throw new Error('the scene records the colour scheme as ' + scene);
    await tab('publish');
    const download = page.waitForEvent('download', { timeout: 20000 });
    await page.click('#gpv-save-scene');
    const file = join(work, 'scene-fromresidue.json'); await (await download).saveAs(file);
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(200);
    await page.setInputFiles('#gpv-load-scene', file); await page.waitForTimeout(2500);
    if ((await page.inputValue('#gpv-color-mode')) !== 'fromresidue') throw new Error('the restored scene has the colour scheme ' + (await page.inputValue('#gpv-color-mode')));
    console.log('       ' + target.text + ': ' + seen.near.key + ' ' + seen.near.distance.toFixed(2) + ' Å ' + seen.near.colour + ' · ' + seen.far.key + ' ' + seen.far.distance.toFixed(2) + ' Å ' + seen.far.colour + ' · strip agrees · scene keeps the mode');
  } finally {
    await clearSelection();
    await tab('appearance'); await page.selectOption('#gpv-color-mode', startMode); await page.waitForTimeout(300);
    await tab(startTab);
  }
});
await step('on α-chymotrypsin (5CHA), His57 of chain B lists Ser195 · C at NE2–OG 3.02 Å and Asp102 · B at ND1–OD1 2.67 Å, tags Ala56 and Cys58 as peptide bonds, and Cys58 tags Cys42 as a disulfide', async () => {
  await clearSelection();
  const file = join(here, 'fixtures', 'experimental', '5cha.cif');
  const startCurrent = await page.inputValue('#gpv-current');
  const startView = await page.evaluate(() => window.__viewerDebug.viewer.getView());
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  /* The list is at the Annotate cutoff; the published pairs are under 3.1 Å, so 4.5 Å is set here
     rather than inherited from whatever an earlier step left. */
  const startCutoff = await page.inputValue('#gpv-near-cutoff');
  let id = null;
  try {
    await tab('annotate'); await page.fill('#gpv-near-cutoff', '4.5');
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(2500);
    id = await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(item => /5cha/i.test(item.name)); return entry ? entry.id : null; });
    if (id === null) throw new Error('5cha.cif did not load');
    await page.evaluate(id => { const select = document.querySelector('#gpv-current'); select.value = String(id); select.dispatchEvent(new Event('change', { bubbles: true })); }, id); await page.waitForTimeout(600);
    await tab('annotate');
    await page.fill('#gpv-goto', 'B:57'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    const picked = await selectedNow();
    if (!picked || picked.entryId !== id || picked.chain !== 'B' || picked.resi !== 57) throw new Error('Go to B:57 selected ' + JSON.stringify(picked));
    await focusStage(); await page.keyboard.press('l'); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('L did not open the card at His57');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(400);
    const rows = await contactRowsNow();
    const expect = [['SER195 · C', 'NE2–OG', 3.02], ['ASP102 · B', 'ND1–OD1', 2.67]];
    for (const [name, atoms, distance] of expect) {
      const row = rows.find(item => item.name === name);
      if (!row) throw new Error('His57\'s contacts do not list ' + name + ': ' + rows.map(item => item.name).join(', '));
      if (row.atoms !== atoms) throw new Error(name + ' is listed with ' + row.atoms + ', not ' + atoms);
      if (!(Math.abs(row.closest - distance) <= 0.01)) throw new Error(name + ' is listed at ' + row.closest + ' Å, published ' + distance + ' Å');
      if (!row.text.includes(distance.toFixed(2) + ' Å')) throw new Error('the row reads "' + row.text + '"');
    }
    /* The peptide neighbours are listed in their place (nearest first) and tagged; the triad is not. */
    const bonds = [['ALA56 · B', 'peptide'], ['CYS58 · B', 'peptide'], ['SER195 · C', ''], ['ASP102 · B', '']];
    for (const [name, bond] of bonds) {
      const row = rows.find(item => item.name === name);
      if (!row) throw new Error('His57\'s contacts do not list ' + name + ': ' + rows.map(item => item.name).join(', '));
      if (row.bond !== bond) throw new Error(name + ' is tagged "' + row.bond + '", not "' + bond + '"');
      if (row.text.includes('peptide bond') !== Boolean(bond)) throw new Error(name + ' reads "' + row.text + '"');
      if (bond && !(/^[CN]–[CN]$/.test(row.atoms) && row.closest <= 1.9)) throw new Error(name + ' is a peptide bond at ' + row.atoms + ' ' + row.closest + ' Å');
    }
    console.log('       HIS57 · B: ' + expect.map(([name]) => { const row = rows.find(item => item.name === name); return name + ' ' + row.atoms + ' ' + row.closest.toFixed(3) + ' Å'; }).join(' · ') + ' · ' + rows.length + ' contacts');
    console.log('       peptide bonds: ' + bonds.filter(([, bond]) => bond).map(([name]) => { const row = rows.find(item => item.name === name); return name + ' ' + row.atoms + ' ' + row.closest.toFixed(2) + ' Å'; }).join(' · ') + ' · tagged, not hidden');
    /* The disulfide: Cys42–Cys58 of chain B (_struct_conn disulf2, SG–SG 2.07 Å), seen from Cys58, whose
       peptide neighbour His57 is tagged the other way. */
    await clearSelection();
    await page.fill('#gpv-goto', 'B:58'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    const cys = await selectedNow();
    if (!cys || cys.entryId !== id || cys.chain !== 'B' || cys.resi !== 58) throw new Error('Go to B:58 selected ' + JSON.stringify(cys));
    await focusStage(); await page.keyboard.press('l'); await page.waitForTimeout(400);
    if (!(await editorShown())) throw new Error('L did not open the card at Cys58');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(400);
    const cysRows = await contactRowsNow();
    const bridge = cysRows.find(item => item.name === 'CYS42 · B');
    if (!bridge) throw new Error('Cys58\'s contacts do not list CYS42 · B: ' + cysRows.map(item => item.name).join(', '));
    if (bridge.bond !== 'disulfide' || bridge.atoms !== 'SG–SG' || !(bridge.closest <= 2.3) || !bridge.text.includes('disulfide')) throw new Error('CYS42 · B is listed as "' + bridge.text + '" with bond "' + bridge.bond + '"');
    const his = cysRows.find(item => item.name === 'HIS57 · B');
    if (!his || his.bond !== 'peptide') throw new Error('from Cys58, His57 is tagged "' + (his ? his.bond : 'missing') + '"');
    if (cysRows.filter(item => item.bond).length !== 3) throw new Error('Cys58 has ' + cysRows.filter(item => item.bond).map(item => item.name + ' ' + item.bond).join(', ') + ' bonded, not three (two peptide, one disulfide)');
    console.log('       CYS58 · B: CYS42 · B ' + bridge.atoms + ' ' + bridge.closest.toFixed(2) + ' Å disulfide · ' + cysRows.filter(item => item.bond === 'peptide').map(item => item.name).join(', ') + ' peptide');
  } finally {
    await clearSelection();
    if (id !== null) {
      await tab('models');
      const remove = page.locator('#gpv-list [data-entry-id="' + id + '"] button:has-text("Remove")');
      if (await remove.count()) { await remove.click(); await page.waitForTimeout(500); }
    }
    await page.evaluate(value => { const select = document.querySelector('#gpv-current'); if ([...select.options].some(option => option.value === value)) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); } }, startCurrent); await page.waitForTimeout(400);
    await page.evaluate(view => { const v = window.__viewerDebug.viewer; v.setView(view); v.render(); }, startView); await page.waitForTimeout(300);
    await tab('annotate'); await page.fill('#gpv-near-cutoff', startCutoff);
    await tab(startTab);
  }
});
/* ---- Measurements you can read, edit, place and export (2.52.0) ----
   A measurement's text is canvas text like a label's: a click on it opens the editor (words before
   the value, Name the atoms, Show value, colour, Dashed, Cα or closest atoms, Remove), a drag or the
   arrow keys move it, and its row in the Annotate list carries the same controls. Every step makes
   its measurement from the card's contacts list, so the label sits between two residues it can be
   found at, and takes back what it made: records, undo steps, the editor, the active text. Still in
   the turned view. */
/* Where a measurement's label is on screen (viewport pixels), and what the hit test finds there. */
const measurementLabelScreen = async id => {
  await page.locator('#gpv-stage').scrollIntoViewIfNeeded(); await page.waitForTimeout(100);
  return page.evaluate(id => {
    const d = window.__viewerDebug; const record = d.measurementRecords().find(item => item.id === id);
    if (!record) return null;
    const anchor = d.measurementAnchor(null, record); if (!anchor) return null;
    const o = record.offset || { x: 0, y: 0, z: 0 };
    const s = d.viewer.modelToScreen({ x: anchor.x + (o.x || 0), y: anchor.y + (o.y || 0), z: anchor.z + (o.z || 0) });
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
    const hit = d.labelHitAt(s.x, s.y);
    return { x: s.x - scrollX, y: s.y - scrollY, hit: hit ? { kind: hit.kind, id: hit.record.id || null } : null };
  }, id);
};
const measurementById = id => page.evaluate(id => { const record = window.__viewerDebug.measurementRecords().find(item => item.id === id); return record ? JSON.parse(JSON.stringify(record)) : null; }, id);
const measurementRow = async id => page.locator('#gpv-measurement-list .gpv-entry').nth(await page.evaluate(id => window.__viewerDebug.measurementRecords().findIndex(item => item.id === id), id));
const valueOf = text => Number((String(text).match(/· ([\d.]+) Å$/) || [])[1]);
/* A Cα–Cα measurement from a residue on screen to its nearest contact, made by a click on the
   card's first contacts row, with the card closed again and the label findable on screen. */
const measureNearestContact = async (avoid = []) => {
  await clearSelection(); await setMeasureChoice('ca');
  const target = await canvasResidue(avoid);
  if (!target) throw new Error('no residue on screen to tap');
  await openCardAt(target);
  await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
  const rows = await contactRowsNow();
  if (!rows.length) throw new Error(target.text + ' has no contacts to measure to');
  await page.locator('#gpv-residue-contacts-rows .gpv-residue-contact').first().click(); await page.waitForTimeout(300);
  await clearSelection();
  const records = await measuresNow();
  const record = records[records.length - 1];
  const spot = await measurementLabelScreen(record.id);
  if (!spot || !spot.hit || spot.hit.kind !== 'measurement' || spot.hit.id !== record.id) throw new Error('the measurement\'s label is not found on screen: ' + JSON.stringify(spot));
  return { target, row: rows[0], record, spot };
};
const openMeasurementEditor = async id => {
  const spot = await measurementLabelScreen(id);
  if (!spot) throw new Error('the measurement has no label on screen');
  await tap(spot.x, spot.y); await page.waitForTimeout(350);
  const editor = await page.evaluate(() => window.__viewerDebug.labelEditor());
  if (!(await editorShown()) || !editor || editor.kind !== 'measurement' || editor.id !== id) throw new Error('a click on the measurement\'s label opened ' + JSON.stringify(editor));
};
const editorHead = async () => ((await page.locator('#gpv-label-editor .gpv-label-editor-residue').textContent()) || '').trim();
await step('a measurement\'s label opens its editor on the canvas; Name the atoms, Enter, and the label and the list read the text before the value', async () => {
  const startCount = (await measuresNow()).length;
  try {
    const { record } = await measureNearestContact();
    const steps = await rememberedSteps();
    await openMeasurementEditor(record.id);
    const head = await editorHead();
    const listed = await newestMeasurementText();
    const value = valueOf(listed);
    if (!head.startsWith('Distance · ') || valueOf(head) !== value || !Number.isFinite(value)) throw new Error('the editor\'s head line reads "' + head + '", the row "' + listed + '"');
    if (!(await page.locator('#gpv-measure-editor').isVisible())) throw new Error('the measurement controls are not shown');
    if (!(await page.locator('#gpv-label-editor-remove').isVisible())) throw new Error('Remove is not offered for a measurement');
    if (await page.locator('#gpv-label-editor-measure').isVisible()) throw new Error('a measurement\'s editor offers Measure to…');
    if ((await page.inputValue('#gpv-label-editor-text')) !== '') throw new Error('the text field starts with "' + (await page.inputValue('#gpv-label-editor-text')) + '"');
    await page.click('#gpv-measure-editor-atoms'); await page.waitForTimeout(150);
    const atoms = await page.evaluate(id => window.__viewerDebug.measurementAtomsText(window.__viewerDebug.measurementRecords().find(item => item.id === id)), record.id);
    if ((await page.inputValue('#gpv-label-editor-text')) !== atoms) throw new Error('Name the atoms put "' + (await page.inputValue('#gpv-label-editor-text')) + '", not "' + atoms + '"');
    if ((await measurementById(record.id)).text) throw new Error('Name the atoms committed the text before Enter');
    await page.focus('#gpv-label-editor-text'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    if (await editorShown()) throw new Error('Enter left the editor open');
    const after = await measurementById(record.id);
    if (after.text !== atoms) throw new Error('the record\'s text is "' + after.text + '", not "' + atoms + '"');
    const row = await measurementRow(record.id);
    if ((await row.locator('.gpv-edit-copy input').inputValue()) !== atoms) throw new Error('the row\'s text field reads "' + (await row.locator('.gpv-edit-copy input').inputValue()) + '"');
    const drawn = await page.evaluate(id => window.__viewerDebug.measurementLabelText(window.__viewerDebug.measurementRecords().find(item => item.id === id)), record.id);
    if (drawn !== atoms + ' · ' + listed.split(' · ').pop()) throw new Error('the label reads "' + drawn + '"');
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the text took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 1');
    const active = await activeTextNow();
    if (!active || active.kind !== 'measurement' || active.id !== record.id) throw new Error('the measurement is not the active text after Enter: ' + JSON.stringify(active));
    await letGo();
    await undoOnce();
    if ((await measurementById(record.id)).text) throw new Error('undo did not take the text away');
    console.log('       "' + drawn + '"');
  } finally { await letGo(); await trimMeasurements(startCount); await clearSelection(); }
});
await step('dragging a measurement\'s label stores an offset, Reset clears it, and the arrow keys nudge the active measurement', async () => {
  const startCount = (await measuresNow()).length;
  try {
    const { record } = await measureNearestContact();
    const steps = await rememberedSteps();
    const view = await page.evaluate(() => window.__viewerDebug.viewer.getView());
    const spot = await measurementLabelScreen(record.id);
    await page.mouse.move(spot.x, spot.y); await page.mouse.down();
    await page.mouse.move(spot.x + 60, spot.y - 40, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(350);
    const dragged = await measurementById(record.id);
    if (!dragged.offset || Math.hypot(dragged.offset.x, dragged.offset.y, dragged.offset.z) < 0.5) throw new Error('the drag left the offset ' + JSON.stringify(dragged.offset));
    const moved = await measurementLabelScreen(record.id);
    if (Math.abs(moved.x - spot.x - 60) > 14 || Math.abs(moved.y - spot.y + 40) > 14) throw new Error('the label moved ' + (moved.x - spot.x).toFixed(0) + ', ' + (moved.y - spot.y).toFixed(0) + ' px for a drag of 60, -40');
    if ((await page.evaluate(() => window.__viewerDebug.viewer.getView())).some((value, index) => Math.abs(value - view[index]) > 1e-6)) throw new Error('the camera moved during the drag');
    if (await editorShown()) throw new Error('a drag opened the editor');
    const row = await measurementRow(record.id);
    if (await row.locator('button:has-text("Reset")').isDisabled()) throw new Error('Reset stayed disabled after the drag');
    await row.locator('button:has-text("Select")').click(); await page.waitForTimeout(200);
    const active = await activeTextNow();
    if (!active || active.kind !== 'measurement' || active.id !== record.id) throw new Error('Select made ' + JSON.stringify(active) + ' active');
    await focusStage(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
    const nudged = await measurementById(record.id);
    if (JSON.stringify(nudged.offset) === JSON.stringify(dragged.offset)) throw new Error('ArrowRight did not move the active measurement');
    const shifted = await measurementLabelScreen(record.id);
    if (Math.abs(shifted.x - moved.x - 8) > 3 || Math.abs(shifted.y - moved.y) > 3) throw new Error('ArrowRight moved the label ' + (shifted.x - moved.x).toFixed(1) + ', ' + (shifted.y - moved.y).toFixed(1) + ' px, not 8, 0');
    await letGo();
    await (await measurementRow(record.id)).locator('button:has-text("Reset")').click(); await page.waitForTimeout(250);
    if ((await measurementById(record.id)).offset) throw new Error('Reset left an offset');
    if (!(await (await measurementRow(record.id)).locator('button:has-text("Reset")').isDisabled())) throw new Error('Reset is still enabled with the text in place');
    if ((await rememberedSteps()) - steps !== 3) throw new Error('drag, arrow and Reset took ' + ((await rememberedSteps()) - steps) + ' undo steps, not 3');
    await undoOnce();
    const back = await measurementById(record.id);
    if (JSON.stringify(back.offset) !== JSON.stringify(nudged.offset)) throw new Error('undoing Reset put back ' + JSON.stringify(back.offset));
    console.log('       dragged ' + (moved.x - spot.x).toFixed(0) + ', ' + (moved.y - spot.y).toFixed(0) + ' px · arrow 8 px · reset · three undo steps');
  } finally { await letGo(); await trimMeasurements(startCount); await clearSelection(); }
});
await step('colour, Dashed and Show value from the row and the editor reach the record and one undo step each', async () => {
  const startCount = (await measuresNow()).length;
  const setColour = (selector, value) => page.evaluate(([selector, value]) => {
    const input = typeof selector === 'string' ? document.querySelector(selector) : null;
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, value]);
  try {
    const { record } = await measureNearestContact();
    const index = (await measuresNow()).findIndex(item => item.id === record.id);
    const rowSelector = '#gpv-measurement-list .gpv-entry:nth-child(' + (index + 1) + ')';
    const one = async (what, action, check) => {
      const before = await rememberedSteps();
      await action(); await page.waitForTimeout(200);
      const now = await measurementById(record.id);
      const problem = check(now);
      if (problem) throw new Error(what + ': ' + problem);
      if ((await rememberedSteps()) - before !== 1) throw new Error(what + ' took ' + ((await rememberedSteps()) - before) + ' undo steps, not 1');
    };
    /* The row. */
    await page.hover(rowSelector); await page.waitForTimeout(150);
    if ((await page.evaluate(() => window.__viewerDebug.measurementHover())) !== record.id) throw new Error('hovering the row does not mark the measurement');
    await one('the row\'s colour', () => setColour(rowSelector + ' input[type="color"]', '#00aa55'), now => (now.color === '#00aa55' ? null : 'colour ' + now.color));
    await one('the row\'s Dashed', () => page.locator(rowSelector + ' label:has-text("Dashed") input').uncheck(), now => (now.dashed === false ? null : 'dashed ' + now.dashed));
    await one('the row\'s text', async () => { await page.fill(rowSelector + ' .gpv-edit-copy input', 'H-bond'); await page.press(rowSelector + ' .gpv-edit-copy input', 'Enter'); }, now => (now.text === 'H-bond' ? null : 'text ' + now.text));
    /* Show value from the keyboard: WebKit, like Safari, gives a checkbox no focus on a mouse click,
       so a click would leave nothing in the row holding the focus for the check below. */
    await one('the row\'s Show value', async () => { await page.locator(rowSelector + ' label:has-text("Show value") input').focus(); await page.keyboard.press('Space'); }, now => (now.showValue === false ? null : 'showValue ' + now.showValue));
    const plain = await page.evaluate(id => window.__viewerDebug.measurementLabelText(window.__viewerDebug.measurementRecords().find(item => item.id === id)), record.id);
    if (plain !== 'H-bond') throw new Error('with Show value off the label reads "' + plain + '"');
    /* The row's own controls keep the keyboard focus after each edit (Show value, toggled from the
       keyboard, still holds it after the list is rebuilt), and a focused row marks its measurement as
       a hovered one does; the mark goes once neither the pointer nor the focus is on it. */
    await page.mouse.move(5, 5); await page.waitForTimeout(150);
    if ((await page.evaluate(() => window.__viewerDebug.measurementHover())) !== record.id) throw new Error('the row holding the focus does not mark its measurement');
    await focusStage(); await page.waitForTimeout(150);
    if ((await page.evaluate(() => window.__viewerDebug.measurementHover())) !== null) throw new Error('leaving the row left the measurement marked');
    /* The editor shows what the row set, and changes it back. */
    await openMeasurementEditor(record.id);
    const shown = await page.evaluate(() => ({ colour: document.querySelector('#gpv-measure-editor-color').value, dashed: document.querySelector('#gpv-measure-editor-dashed').checked, value: document.querySelector('#gpv-measure-editor-value').checked, text: document.querySelector('#gpv-label-editor-text').value }));
    if (shown.colour !== '#00aa55' || shown.dashed || shown.value || shown.text !== 'H-bond') throw new Error('the editor opened on ' + JSON.stringify(shown));
    await one('the editor\'s colour', () => setColour('#gpv-measure-editor-color', '#3355ff'), now => (now.color === '#3355ff' ? null : 'colour ' + now.color));
    await one('the editor\'s Dashed', () => page.check('#gpv-measure-editor-dashed'), now => (now.dashed !== false ? null : 'dashed ' + now.dashed));
    await one('the editor\'s Show value', () => page.check('#gpv-measure-editor-value'), now => (now.showValue !== false ? null : 'showValue ' + now.showValue));
    const full = await page.evaluate(id => window.__viewerDebug.measurementLabelText(window.__viewerDebug.measurementRecords().find(item => item.id === id)), record.id);
    if (!/^H-bond · [\d.]+ Å$/.test(full)) throw new Error('with Show value on the label reads "' + full + '"');
    if ((await page.inputValue(rowSelector + ' input[type="color"]')) !== '#3355ff') throw new Error('the row\'s colour did not follow the editor');
    console.log('       row: colour, dashed, text, value · editor: colour, dashed, value · one undo step each · "' + full + '"');
  } finally { await letGo(); await trimMeasurements(startCount); await clearSelection(); }
});
await step('the editor\'s Atoms select re-points a Cα–Cα measurement to the closest atoms and back', async () => {
  const startCount = (await measuresNow()).length;
  try {
    const { record, row, target } = await measureNearestContact();
    await openMeasurementEditor(record.id);
    if (!(await page.locator('#gpv-measure-editor-pair').isVisible())) throw new Error('no Atoms choice for a two-residue distance');
    if ((await page.inputValue('#gpv-measure-editor-pair')) !== 'ca') throw new Error('a Cα–Cα measurement shows "' + (await page.inputValue('#gpv-measure-editor-pair')) + '"');
    let steps = await rememberedSteps();
    await page.selectOption('#gpv-measure-editor-pair', 'closest'); await page.waitForTimeout(250);
    const closest = await measurementById(record.id);
    const [atomA, atomB] = row.atoms.split('–');
    if (closest.id !== record.id || closest.points[0].atom !== atomA || closest.points[1].atom !== atomB) throw new Error('closest atoms joined ' + closest.points.map(pointKey).join(' → ') + ', the contacts row names ' + row.atoms);
    if (pointKey(closest.points[0]).split(':')[0] !== target.key) throw new Error('the first point left ' + target.text);
    const listed = valueOf(await newestMeasurementText());
    if (!(Math.abs(listed - row.closest) <= 0.006)) throw new Error('the measurement reads ' + listed + ' Å, the contacts row ' + row.closest);
    if (valueOf(await editorHead()) !== listed) throw new Error('the head line did not follow: ' + (await editorHead()));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('re-pointing took ' + ((await rememberedSteps()) - steps) + ' undo steps');
    if ((await page.inputValue('#gpv-measure-editor-pair')) !== 'closest') throw new Error('the select does not show closest atoms');
    steps = await rememberedSteps();
    await page.selectOption('#gpv-measure-editor-pair', 'ca'); await page.waitForTimeout(250);
    const back = await measurementById(record.id);
    if (back.points.map(point => point.atom).join(',') !== 'CA,CA') throw new Error('Cα–Cα joined ' + back.points.map(pointKey).join(' → '));
    if ((await rememberedSteps()) - steps !== 1) throw new Error('re-pointing back took ' + ((await rememberedSteps()) - steps) + ' undo steps');
    console.log('       ' + target.text + ' → ' + row.name + ': Cα–Cα, then ' + row.atoms + ' ' + listed.toFixed(2) + ' Å, then Cα–Cα · same record');
  } finally { await letGo(); await trimMeasurements(startCount); await clearSelection(); }
});
await step('a scene round-trip keeps a measurement\'s text, colour, dashed, Show value and offset', async () => {
  const startCount = (await measuresNow()).length;
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  const fields = record => JSON.stringify({ text: record.text || '', showValue: record.showValue !== false, offset: record.offset ? [record.offset.x, record.offset.y, record.offset.z].map(value => value.toFixed(6)) : null, color: record.color || null, dashed: record.dashed !== false, points: record.points.map(pointKey) });
  try {
    const { record } = await measureNearestContact();
    await page.evaluate(id => {
      const d = window.__viewerDebug; const item = d.measurementRecords().find(entry => entry.id === id);
      Object.assign(item, { text: 'Salt bridge', showValue: false, offset: { x: 1.25, y: -2.5, z: 0.75 }, color: '#7c3aed', dashed: false });
    }, record.id);
    const before = fields(await measurementById(record.id));
    await tab('publish');
    const download = page.waitForEvent('download', { timeout: 20000 });
    await page.click('#gpv-save-scene');
    const file = join(work, 'scene-measurement.json'); await (await download).saveAs(file);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const written = (saved.measurements || (saved.overlays && saved.overlays.measurements) || []).slice(-1)[0] || null;
    await page.evaluate(id => { const d = window.__viewerDebug; const item = d.measurementRecords().find(entry => entry.id === id); delete item.text; delete item.offset; delete item.color; delete item.showValue; delete item.dashed; }, record.id);
    await page.setInputFiles('#gpv-load-scene', file); await page.waitForTimeout(2500);
    const records = await measuresNow();
    if (records.length !== startCount + 1) throw new Error('the restored scene has ' + (records.length - startCount) + ' new measurements, not 1');
    const after = fields(records[records.length - 1]);
    if (after !== before) throw new Error('the scene changed the measurement:\n  before ' + before + '\n  after  ' + after);
    if (written && (written.text !== 'Salt bridge' || written.color !== '#7c3aed' || written.dashed !== false || written.showValue !== false || !written.offset)) throw new Error('the scene wrote ' + JSON.stringify(written));
    console.log('       text, colour, solid line, value hidden and offset survive save and load');
  } finally { await tab('annotate'); await letGo(); await trimMeasurements(startCount); await clearSelection(); await tab(startTab); }
});
await step('the SVG export carries the measurement\'s text, colour and placed position', async () => {
  const startCount = (await measuresNow()).length;
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  try {
    const { record } = await measureNearestContact();
    /* Text, a colour and a hand-placed offset, through the row and a drag as a user would. */
    const row = await measurementRow(record.id);
    await row.locator('.gpv-edit-copy input').fill('Salt bridge'); await row.locator('.gpv-edit-copy input').press('Enter'); await page.waitForTimeout(200);
    await page.evaluate(id => { const index = window.__viewerDebug.measurementRecords().findIndex(item => item.id === id); const input = document.querySelectorAll('#gpv-measurement-list .gpv-entry')[index].querySelector('input[type="color"]'); input.value = '#0a7d4f'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }, record.id);
    const spot = await measurementLabelScreen(record.id);
    await page.mouse.move(spot.x, spot.y); await page.mouse.down(); await page.mouse.move(spot.x + 70, spot.y + 50, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
    const placed = await measurementById(record.id);
    if (!placed.offset || placed.text !== 'Salt bridge' || placed.color !== '#0a7d4f') throw new Error('the measurement was not set up: ' + JSON.stringify(placed));
    await tab('publish');
    const download = page.waitForEvent('download', { timeout: 120000 });
    await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const text = new RegExp('<text x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*fill="#0a7d4f">Salt bridge · ([\\d.]+) Å</text>').exec(svg);
    if (!text) throw new Error('the SVG has no "Salt bridge · … Å" text in #0a7d4f');
    const lines = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke="#0a7d4f"[^>]*\/>/g)].map(match => ({ a: { x: Number(match[1]), y: Number(match[2]) }, b: { x: Number(match[3]), y: Number(match[4]) }, dashed: match[0].includes('stroke-dasharray') }));
    const measured = lines.find(line => line.dashed); const leader = lines.find(line => !line.dashed);
    if (!measured || !leader) throw new Error('the SVG has ' + lines.length + ' lines in the measurement\'s colour; it needs the dashed measurement and a solid leader');
    const middle = { x: (measured.a.x + measured.b.x) / 2, y: (measured.a.y + measured.b.y) / 2 };
    const label = { x: Number(text[1]), y: Number(text[2]) };
    if (Math.hypot(leader.a.x - middle.x, leader.a.y - middle.y) > 3) throw new Error('the leader starts at ' + JSON.stringify(leader.a) + ', not at the middle of the measurement ' + JSON.stringify(middle));
    if (Math.hypot(leader.b.x - label.x, leader.b.y - label.y) > 0.05) throw new Error('the leader ends at ' + JSON.stringify(leader.b) + ', the label is at ' + JSON.stringify(label));
    if (Math.hypot(label.x - middle.x, label.y - middle.y) < 20) throw new Error('the label sits on the measurement: the offset did not reach the SVG');
    console.log('       "Salt bridge · ' + text[3] + ' Å" in #0a7d4f, ' + Math.hypot(label.x - middle.x, label.y - middle.y).toFixed(0) + ' px from the line with a leader back to it');
  } finally { await tab('annotate'); await letGo(); await trimMeasurements(startCount); await clearSelection(); await tab(startTab); }
});
await step('Separate labels moves a measurement label off a residue label it covers, and the per-panel placement does the same at print size', async () => {
  /* A residue label dragged onto a measurement's value: the label is placed by hand and keeps its
     place, so the press has to move the measurement's text — on screen, and again for the print-size
     panel of an exported figure, where nothing on screen may move. */
  const startCount = (await measuresNow()).length;
  const startLabels = await page.evaluate(() => window.__viewerDebug.labelRecords().length);
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  const startPlan = await page.evaluate(() => ({
    mode: document.querySelector('#gpv-export-mode').value, width: document.querySelector('#gpv-print-width').value,
    dpi: document.querySelector('#gpv-print-dpi').value, text: document.querySelector('#gpv-print-text').value
  }));
  const covers = (a, b) => Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
  let target = null;
  try {
    await clearSelection(); await setMeasureChoice('ca');
    target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await openCardAt(target);
    await page.keyboard.type('Site'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await letGo();
    /* The label's own card: a tap on the label opens it, Contacts and the first row measure. */
    const at = await labelScreen(target.key);
    await tap(at.x, at.y); await page.waitForTimeout(350);
    if (!(await editorShown())) throw new Error('a tap on the label did not open its card');
    await page.click('#gpv-label-editor-contacts'); await page.waitForTimeout(250);
    await page.locator('#gpv-residue-contacts-rows .gpv-residue-contact').first().click(); await page.waitForTimeout(300);
    await clearSelection();
    const records = await measuresNow();
    if (records.length !== startCount + 1) throw new Error('the contacts row made ' + (records.length - startCount) + ' measurements');
    const record = records[records.length - 1];
    /* The label dragged onto the measurement's value. */
    const value = await measurementLabelScreen(record.id);
    const from = await labelScreen(target.key);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(value.x, value.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
    const boxes = () => page.evaluate(([key, id]) => {
      const d = window.__viewerDebug;
      const label = d.labelRecords().find(item => item.key === key); const measurement = d.measurementRecords().find(item => item.id === id);
      return { label: d.labelScreenBox(label), measurement: d.measurementScreenBox(measurement), labelOffset: JSON.stringify(label.offset || null), offset: measurement.offset ? JSON.parse(JSON.stringify(measurement.offset)) : null, auto: Boolean(measurement.autoPlaced) };
    }, [target.key, record.id]);
    const piled = await boxes();
    if (!piled.label || !piled.measurement || !covers(piled.label, piled.measurement)) throw new Error('the label does not cover the measurement after the drag: ' + JSON.stringify(piled));
    if (await page.locator('#gpv-labels-separate').isDisabled()) throw new Error('Separate labels is disabled');
    const steps = await rememberedSteps();
    await page.click('#gpv-labels-separate'); await page.waitForTimeout(500);
    const apart = await boxes();
    if (!apart.offset || !apart.auto) throw new Error('the measurement was not moved: ' + JSON.stringify(apart));
    if (apart.labelOffset !== piled.labelOffset) throw new Error('the hand-placed label was moved');
    if (covers(apart.label, apart.measurement)) throw new Error('the label and the measurement still cover each other: ' + JSON.stringify(apart));
    const said = await statusNow();
    if (said !== '1 measurement moved apart') throw new Error('Separate labels said: ' + said);
    if ((await rememberedSteps()) - steps !== 1) throw new Error('the press took ' + ((await rememberedSteps()) - steps) + ' undo steps');
    if (await (await measurementRow(record.id)).locator('button:has-text("Reset")').isDisabled()) throw new Error('the moved measurement\'s Reset is disabled');
    await undoOnce();
    const undone = await boxes();
    if (undone.offset || undone.labelOffset !== piled.labelOffset) throw new Error('undo left ' + JSON.stringify(undone));
    /* Print size: the same pile, exported. The figure's placement must part them in the file while
       the records on screen stay exactly as they are. */
    const before = JSON.stringify(await measurementById(record.id)) + JSON.stringify(await labelByKey(target.key));
    await tab('publish');
    await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85');
    await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '10'); await page.waitForTimeout(400);
    const download = page.waitForEvent('download', { timeout: 180000 });
    await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const after = JSON.stringify(await measurementById(record.id)) + JSON.stringify(await labelByKey(target.key));
    if (after !== before) throw new Error('the export moved the records on screen');
    const words = await page.evaluate(id => window.__viewerDebug.measurementLabelText(window.__viewerDebug.measurementRecords().find(item => item.id === id)), record.id);
    const printed = text => {
      const found = new RegExp('<g><rect [^>]*?width="([\\d.]+)"[^>]*/><text x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*font-size="([\\d.]+)"[^>]*>' + text + '</text></g>').exec(svg);
      if (!found) throw new Error('the exported SVG has no box for ' + text);
      return { x: Number(found[2]), y: Number(found[3]), halfWidth: Number(found[1]) / 2, halfHeight: Number(found[4]) * 0.8 };
    };
    const label = printed('Site'); const measurement = printed(words);
    if (covers(label, measurement)) throw new Error('the exported figure prints "Site" over "' + words + '": ' + JSON.stringify({ label, measurement }));
    console.log('       on screen: moved ' + Math.hypot(apart.measurement.x - piled.measurement.x, apart.measurement.y - piled.measurement.y).toFixed(0) + ' px, "' + said + '", undone · in print: ' + Math.abs(label.y - measurement.y).toFixed(0) + ' px apart for boxes ' + (label.halfHeight * 2).toFixed(0) + ' px tall');
  } finally {
    await tab('publish');
    await page.selectOption('#gpv-print-width', startPlan.width); await page.selectOption('#gpv-print-dpi', startPlan.dpi);
    await page.selectOption('#gpv-print-text', startPlan.text); await page.selectOption('#gpv-export-mode', startPlan.mode);
    await tab('annotate');
    await letGo(); await trimMeasurements(startCount);
    if (target) await removeLabelByKey(target.key);
    if ((await page.evaluate(() => window.__viewerDebug.labelRecords().length)) !== startLabels) throw new Error('the step left ' + ((await page.evaluate(() => window.__viewerDebug.labelRecords().length)) - startLabels) + ' labels behind');
    await clearSelection(); await tab(startTab);
  }
});
await step('Copy measurements writes one TSV row per measurement with both atoms and the value; the CSV has the same rows', async () => {
  const startCount = (await measuresNow()).length;
  const startPaste = await page.inputValue('#gpv-data-text');
  try {
    const first = await measureNearestContact();
    /* Another residue and not the first one's contact, so the two labels are not one on the other. */
    const firstEntry = first.target.key.split('|')[0];
    const second = await measureNearestContact([first.target.key, [firstEntry, first.row.chain, first.row.resi].join('|')]);
    await page.evaluate(id => { const item = window.__viewerDebug.measurementRecords().find(entry => entry.id === id); item.text = 'gap, "quoted"'; }, second.record.id);
    const records = await measuresNow();
    const tsv = await page.evaluate(() => window.__viewerDebug.measurementsText());
    const lines = tsv.split('\n').map(line => line.split('\t'));
    const header = 'type,model_1,chain_1,resi_1,resn_1,atom_1,model_2,chain_2,resi_2,resn_2,atom_2,model_3,chain_3,resi_3,resn_3,atom_3,value,unit,text';
    if (lines[0].join(',') !== header) throw new Error('the header is ' + lines[0].join(','));
    if (lines.length !== records.length + 1) throw new Error(lines.length - 1 + ' rows for ' + records.length + ' measurements');
    for (const [index, record] of records.entries()) {
      const cells = lines[index + 1];
      if (cells.length !== 19) throw new Error('row ' + (index + 1) + ' has ' + cells.length + ' cells');
      const expected = await page.evaluate(id => {
        const d = window.__viewerDebug; const item = d.measurementRecords().find(entry => entry.id === id);
        const atom = point => d.entries().find(entry => entry.id === point.entryId).atoms.find(a => Number.isInteger(point.index) && a.index === point.index) || d.entries().find(entry => entry.id === point.entryId).atoms.find(a => (a.chain || '') === point.chain && a.resi === point.resi && a.atom === point.atom);
        const [a, b] = item.points.map(atom);
        return { distance: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), resn: [a.resn, b.resn] };
      }, record.id);
      const [p, q] = record.points;
      const want = ['distance', null, p.chain, String(p.resi), expected.resn[0], p.atom, null, q.chain, String(q.resi), expected.resn[1], q.atom, '', '', '', '', ''];
      const mismatch = want.findIndex((value, i) => value !== null && cells[i] !== value);
      if (mismatch >= 0) throw new Error('row ' + (index + 1) + ' column ' + lines[0][mismatch] + ' reads "' + cells[mismatch] + '", not "' + want[mismatch] + '"');
      if (!(Math.abs(Number(cells[16]) - expected.distance) <= 0.0005) || cells[17] !== 'Å') throw new Error('row ' + (index + 1) + ' gives ' + cells[16] + ' ' + cells[17] + ', the atoms are ' + expected.distance.toFixed(3) + ' Å apart');
      if (cells[18] !== (record.text || '')) throw new Error('row ' + (index + 1) + ' has the text "' + cells[18] + '"');
    }
    await page.click('#gpv-measurements-copy'); await page.waitForTimeout(300);
    const said = await statusNow();
    if (!/measurements? copied as tab-separated text/.test(said) && (await page.inputValue('#gpv-copy-fallback-text')) !== tsv) throw new Error('Copy measurements neither copied nor filled the copy box: ' + said);
    /* With the clipboard refused, the text goes to a read-only box of its own and the Per-residue data
       paste box keeps what the user put there (before 2.52.0 it was overwritten). */
    await page.fill('#gpv-data-text', 'A,1,0.5');
    await page.evaluate(() => { if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.reject(new Error('refused by the test')); });
    try {
      await page.click('#gpv-measurements-copy'); await page.waitForTimeout(300);
      if ((await page.inputValue('#gpv-data-text')) !== 'A,1,0.5') throw new Error('the clipboard fallback overwrote the Per-residue data paste box');
      if ((await page.inputValue('#gpv-copy-fallback-text')) !== tsv || await page.locator('#gpv-copy-fallback').isHidden()) throw new Error('the refused copy is not in the copy box');
      await page.click('#gpv-copy-fallback-close');
      if (!(await page.locator('#gpv-copy-fallback').isHidden())) throw new Error('Done did not close the copy box');
    } finally { await page.evaluate(() => { if (navigator.clipboard) delete navigator.clipboard.writeText; }); }
    const csv = await downloadText('#gpv-measurements-csv');
    const rows = csv.lines.filter(line => line.length).map(csvCells);
    if (csv.name !== 'measurements.csv') throw new Error('the CSV is named ' + csv.name);
    if (rows.length !== lines.length || rows.some((row, index) => row.join('\t') !== lines[index].join('\t'))) throw new Error('the CSV and the copied rows differ:\n' + rows.map(row => row.join('\t')).join('\n') + '\n---\n' + tsv);
    console.log('       ' + records.length + ' measurements · ' + (said.includes('copied') ? 'copied' : 'copy box') + ' · CSV matches cell for cell');
  } finally {
    await letGo(); await trimMeasurements(startCount); await clearSelection();
    await page.fill('#gpv-data-text', startPaste);
  }
});
await step('the orientation is put back after the canvas steps', async () => {
  await letGo();
  await focusStage(); await page.keyboard.press('Shift+r'); await page.waitForTimeout(500);
});
await step('one position is compared across a wild-type and a mutant model: side chains, a label per model, and the difference stated', async () => {
  /* A point mutant of the fixture: chain A residue 15 becomes glycine, everything else identical —
     which is what a second AlphaFold run of a mutated sequence looks like to the viewer. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const mutated = original.map(line => (/^ATOM/.test(line) && line[21] === 'A' && Number(line.slice(22, 26)) === 15 ? line.slice(0, 17) + 'GLY' + line.slice(20) : line)).join('\n');
  if (mutated === original.join('\n')) throw new Error('the mutant fixture is identical to model_a — check the PDB columns');
  const file = join(work, 'model_mutant.pdb'); await writeFile(file, mutated);
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'models');
  const startMode = await page.inputValue('#gpv-view-mode');
  /* Highlight neighbourhood adds one selection per chain of the neighbourhood; the finally takes
     back exactly those rows so the rest of the suite starts from the selections it left. */
  let neighbourhoodRows = 0;
  /* Make site figure saves its panels and unticks every other one; every press is taken back by
     name and the rest re-ticked, so the later figure builder step still finds six included views. */
  let siteFigureViews = 0;
  let siteFigureNames = [];
  const takeSiteFigureBack = async () => {
    if (!siteFigureViews) return;
    await tab('publish');
    for (const name of [...siteFigureNames].reverse()) {
      /* A string hasText is case-insensitive and 'Site A:15' would match the Overview's caption 'site A:15 marked'. */
      const row = page.locator('#gpv-saved-views .gpv-entry', { hasText: new RegExp('· ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' —') });
      if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(250); }
    }
    const ticks = page.locator('#gpv-builder-rows input[type="checkbox"]');
    for (let index = 0; index < (await ticks.count()); index += 1) { await ticks.nth(index).check(); await page.waitForTimeout(120); }
    siteFigureViews = 0; siteFigureNames = [];
  };
  const startAlignmentMode = await page.inputValue('#gpv-alignment-mode');
  const startColorMode = await page.inputValue('#gpv-color-mode');
  const startColumns = await page.inputValue('#gpv-panel-columns');
  const startDeviationPanel = await page.isChecked('#gpv-position-figure-deviation');
  const cleanup = async () => {
    await takeSiteFigureBack();
    /* The deviation panel press moves the panel columns and the colour mode; both are preferences
       the rest of the suite reads, so they go back whether or not the views were saved. */
    await tab('publish');
    await page.selectOption('#gpv-panel-columns', startColumns); await page.waitForTimeout(150);
    await page.evaluate(mode => { const select = document.querySelector('#gpv-color-mode'); if (select.value !== mode) { select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); } }, startColorMode);
    await tab('compare');
    await page.selectOption('#gpv-alignment-mode', startAlignmentMode); await page.waitForTimeout(200);
    await tab('annotate');
    await page.setChecked('#gpv-position-figure-deviation', startDeviationPanel); await page.waitForTimeout(150);
    if (await page.locator('#gpv-position-clear').count()) { await page.click('#gpv-position-clear'); await page.waitForTimeout(300); }
    while (neighbourhoodRows > 0) {
      const row = page.locator('#gpv-selection-list .gpv-entry').last();
      if (!(await row.count())) break;
      await row.locator('button:has-text("Remove")').click(); await page.waitForTimeout(200);
      neighbourhoodRows -= 1;
    }
    neighbourhoodRows = 0;
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_mutant' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await page.selectOption('#gpv-view-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(300);
    const only = async names => page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, names);
    await only(['model_a.pdb', 'model_mutant.pdb']); await page.waitForTimeout(900);
    await tab('annotate');
    const labelsBefore = await page.locator('#gpv-label-list .gpv-entry').count();
    await page.fill('#gpv-goto', 'A:15'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    if (await page.locator('#gpv-position-compare').isDisabled()) throw new Error('Compare this position stayed disabled with a residue selected and two models shown');
    await page.click('#gpv-position-compare'); await page.waitForTimeout(900);
    const state = (await page.locator('#gpv-position-state').textContent()) || '';
    if (!/A:15 .*Ala.*→.*Gly.*differs/.test(state)) throw new Error('readout: ' + state);
    const spots = await page.evaluate(() => window.__viewerDebug.spotlightResidues());
    if (spots.length !== 1 || spots[0].chain !== 'A' || spots[0].resi !== 15) throw new Error('spotlight list: ' + JSON.stringify(spots));
    const texts = await page.evaluate(() => window.__viewerDebug.labelRecords().filter(label => label.kind === 'position').map(label => label.text).sort());
    if (texts.length !== 2 || texts[0] !== 'Ala15' || texts[1] !== 'Gly15') throw new Error('position labels: ' + JSON.stringify(texts));
    const labelsAfter = await page.locator('#gpv-label-list .gpv-entry').count();
    if (labelsAfter - labelsBefore !== 2) throw new Error('the label list gained ' + (labelsAfter - labelsBefore) + ' rows, not 2');
    await tab('publish');
    const download = page.waitForEvent('download', { timeout: 120000 });
    await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    if (!/>Ala15</.test(svg) || !/>Gly15</.test(svg)) throw new Error('the figure SVG does not carry both residue labels');
    /* Superpose the pair on the wild type, then compare again: the same press now measures what the
       substitution did — how far the site and the residues around it moved. The mutant carries the
       same coordinates as model_a, so every deviation must be finite and near zero.
       The fixture's two chains are identical poly-alanine, so sequence-based chain matching is free
       to pair chain A of one model with chain B of the other (it does, and the fit is then 3.4 Å
       out); identifier mapping is the honest choice for a wild-type/mutant pair that shares its
       numbering, and it is restored afterwards because the mode is a saved preference. */
    await tab('compare');
    await page.selectOption('#gpv-alignment-mode', 'identifier'); await page.waitForTimeout(200);
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_a\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#gpv-align'); await page.waitForTimeout(2500);
    await tab('annotate');
    await page.fill('#gpv-goto', 'A:15'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    await page.click('#gpv-position-compare'); await page.waitForTimeout(900);
    const effect = await page.evaluate(() => window.__viewerDebug.positionEffect());
    if (!effect) throw new Error('no neighbourhood was measured after Align visible');
    if (!effect.rows[0].isSite || effect.rows[0].resi !== 15) throw new Error('the first row is not the site: ' + JSON.stringify(effect.rows[0]));
    if (effect.summary.neighbourCount < 2) throw new Error('only ' + effect.summary.neighbourCount + ' neighbours within ' + effect.cutoff + ' Å');
    effect.summary.siteDeviation.forEach((value, index) => {
      if (!Number.isFinite(value) || value < 0 || value >= 0.5) throw new Error('site deviation against ' + effect.models[index] + ' is ' + value + ', which is not a small finite distance');
    });
    const effectRows = await page.locator('#gpv-position-effect-body tr').count();
    if (effectRows !== effect.rows.length + 1) throw new Error('the effect table has ' + effectRows + ' body rows, not ' + (effect.rows.length + 1) + ' (rows plus the summary)');
    const effectState = (await page.locator('#gpv-position-state').textContent()) || '';
    if (!/site moved [\d.]+ Å/.test(effectState)) throw new Error('the readout does not state what moved: ' + effectState);
    /* Undo takes this press back with its table and buttons (before 2.52.0 they stayed under a state
       line saying nothing was compared), and redo brings them back. */
    await undoOnce();
    if (await page.evaluate(() => window.__viewerDebug.positionEffect())) throw new Error('undo left the neighbourhood of the press it took back');
    if (await page.locator('#gpv-position-highlight').isEnabled()) throw new Error('Highlight neighbourhood stayed enabled after undo');
    await page.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(400);
    if (!(await page.evaluate(() => window.__viewerDebug.positionEffect()))) throw new Error('redo did not bring the neighbourhood back');
    const chains = new Set(effect.rows.filter(row => !row.isSite).map(row => row.chain)).size;
    const selectionsBefore = await page.locator('#gpv-selection-list .gpv-entry').count();
    await page.click('#gpv-position-highlight'); await page.waitForTimeout(700);
    neighbourhoodRows = (await page.locator('#gpv-selection-list .gpv-entry').count()) - selectionsBefore;
    if (neighbourhoodRows !== chains) throw new Error('Highlight neighbourhood added ' + neighbourhoodRows + ' selections, not ' + chains + ' (one per chain of the neighbourhood)');
    const colours = await page.evaluate(count => window.__viewerDebug.selectionRecords().slice(-count).map(record => record.color), neighbourhoodRows);
    if (colours.some(colour => colour !== '#f97316')) throw new Error('the neighbourhood was highlighted in ' + JSON.stringify(colours));
    const effectCsv = page.waitForEvent('download', { timeout: 120000 });
    await page.click('#gpv-position-csv');
    const csv = await readFile(await (await effectCsv).path(), 'utf8');
    const csvLines = csv.split('\n');
    if (!csvLines[0].startsWith('"chain","resi","resn","role"')) throw new Error('effect CSV header: ' + csvLines[0]);
    if (!csvLines.slice(1).some(line => /^"[^"]*","15","[^"]*","site"/.test(line))) throw new Error('the effect CSV has no site row for residue 15');
    /* One press turns the compared position into the finished figure: an overview, a close-up and —
       the models being superposed, with the switch on — a third panel of the same close-up coloured
       by how far each residue moved, the only panels ticked in the builder, with Publish open at it. */
    const viewsBefore = await page.evaluate(() => window.__viewerDebug.savedViews().length);
    if (await page.locator('#gpv-position-figure').isDisabled()) throw new Error('Make site figure stayed disabled with a position compared');
    await page.check('#gpv-position-figure-deviation'); await page.waitForTimeout(150);
    await page.click('#gpv-position-figure'); await page.waitForTimeout(1500);
    const views = await page.evaluate(() => window.__viewerDebug.savedViews().map(view => ({ name: view.name, included: view.inFigure !== false, colorMode: view.colorMode, faded: view.faded })));
    siteFigureViews = views.length - viewsBefore;
    siteFigureNames = views.slice(viewsBefore).map(view => view.name);
    if (siteFigureViews !== 3) throw new Error('Make site figure added ' + siteFigureViews + ' saved views, not 3');
    const added = views.slice(viewsBefore);
    if (added.map(view => view.name).join(', ') !== 'Overview, Site A:15, Deviation') throw new Error('panel names: ' + added.map(view => view.name).join(', '));
    if (!added.every(view => view.included)) throw new Error('the three site figure panels are not all ticked');
    if (views.slice(0, viewsBefore).some(view => view.included)) throw new Error('an earlier saved view is still ticked into the figure');
    /* The deviation panel is the measurement: it is coloured by it, and it fades nothing, because a
       faded model is the one whose movement the reader is being shown. */
    if (added[2].colorMode !== 'deviation') throw new Error('the deviation panel stored colour mode ' + added[2].colorMode);
    if (Object.values(added[2].faded || {}).some(Boolean)) throw new Error('the deviation panel fades a model: ' + JSON.stringify(added[2].faded));
    if ((await page.inputValue('#gpv-color-mode')) !== startColorMode) throw new Error('the press left the viewer coloured by ' + (await page.inputValue('#gpv-color-mode')) + ', not ' + startColorMode);
    /* The close-up frames the site with its neighbourhood, not the lone residue: its camera must be
       wider than the one zoomTo() gives for residue A:15 alone. getView()[3] is the zoom — larger is
       tighter — and the live camera is put back exactly as it was before the measurement. */
    const frames = await page.evaluate(index => {
      const viewer = window.__viewerDebug.viewer;
      const saved = window.__viewerDebug.savedViews()[index].camera;
      const before = viewer.getView();
      let lone = null;
      try {
        const shown = window.__viewerDebug.displayedEntries().filter(entry => entry.model);
        const chosen = Number(document.querySelector('#gpv-reference').value);
        const model = shown.find(entry => entry.id === chosen) || shown[0];
        viewer.zoomTo({ model: model.model.getID(), chain: 'A', resi: 15 });
        lone = viewer.getView()[3];
      } finally { viewer.setView(before); }
      return { closeUp: saved ? saved[3] : null, lone, before, after: viewer.getView() };
    }, viewsBefore + 1);
    if (!Number.isFinite(frames.closeUp) || !Number.isFinite(frames.lone)) throw new Error('camera zooms: ' + JSON.stringify(frames));
    if (!(frames.closeUp < frames.lone)) throw new Error('the site close-up is framed at zoom ' + frames.closeUp + ', no wider than the lone residue at ' + frames.lone);
    if (frames.after.some((value, index) => Math.abs(value - frames.before[index]) > 1e-6)) throw new Error('measuring the lone-residue frame left the camera moved');
    /* The deviation panel is only readable beside the close-up because it frames the same thing. */
    const sameCamera = await page.evaluate(index => {
      const [closeUp, deviation] = [window.__viewerDebug.savedViews()[index].camera, window.__viewerDebug.savedViews()[index + 1].camera];
      return Array.isArray(closeUp) && Array.isArray(deviation) && closeUp.every((value, at) => Math.abs(value - deviation[at]) < 1e-6);
    }, viewsBefore + 1);
    if (!sameCamera) throw new Error('the deviation panel does not keep the close-up camera');
    const builderLetters = await page.locator('#gpv-builder-rows .gpv-builder-letter').allTextContents();
    const expectedLetters = [...Array(viewsBefore).fill('—'), 'A', 'B', 'C'];
    if (builderLetters.join('') !== expectedLetters.join('')) throw new Error('builder letters: ' + builderLetters.join(',') + ' not ' + expectedLetters.join(','));
    /* The saved-views list and the captions file letter the views as the figure prints them (before
       2.52.0 they counted every view, so the list said D for the panel the figure printed as A). */
    const listLetters = (await page.locator('#gpv-saved-views .gpv-entry .gpv-entry-name').allTextContents()).map(text => text.split(' · ')[0]);
    if (listLetters.join('') !== expectedLetters.join('')) throw new Error('saved-views list letters: ' + listLetters.join(',') + ' not ' + expectedLetters.join(','));
    const captions = (await downloadText('#gpv-captions')).lines.filter(line => /^[A-Z—]\. /.test(line));
    if (captions.map(line => line.slice(0, 2)).join(' ') !== 'A. B. C.' || !/^A\. Overview/.test(captions[0])) throw new Error('captions file: ' + JSON.stringify(captions));
    if (!(await page.locator('[data-gpv-panel="publish"]').isVisible())) throw new Error('Make site figure did not open the Publish tab');
    if ((await page.inputValue('#gpv-panel-columns')) !== '3') throw new Error('panel columns: ' + (await page.inputValue('#gpv-panel-columns')) + ', not 3 for three panels');
    const estimate = (await page.locator('#gpv-export-estimate').textContent()) || '';
    const estimateWidth = Number((estimate.match(/^(\d+) ×/) || [])[1]);
    const figureDownload = page.waitForEvent('download', { timeout: 300000 });
    await page.click('#gpv-contact-sheet');
    const figureFile = await figureDownload;
    const figurePng = await readFile(await figureFile.path());
    const figureWidth = figurePng.readUInt32BE(16);
    if (!/3-panels/.test(figureFile.suggestedFilename())) throw new Error('figure file name: ' + figureFile.suggestedFilename());
    if (Number.isFinite(estimateWidth) && estimateWidth > 0) {
      if (figureWidth !== 3 * Math.floor(estimateWidth / 3)) throw new Error('figure PNG is ' + figureWidth + ' px wide, not the three-column ' + (3 * Math.floor(estimateWidth / 3)));
    } else if (figureWidth < 1000) throw new Error('figure PNG is only ' + figureWidth + ' px wide');
    /* The switch off is the two-panel figure exactly as it was before the deviation panel existed. */
    await takeSiteFigureBack();
    await tab('annotate');
    await page.uncheck('#gpv-position-figure-deviation'); await page.waitForTimeout(150);
    const plainBefore = await page.evaluate(() => window.__viewerDebug.savedViews().length);
    await page.click('#gpv-position-figure'); await page.waitForTimeout(1500);
    const plain = await page.evaluate(() => window.__viewerDebug.savedViews().map(view => ({ name: view.name, included: view.inFigure !== false })));
    siteFigureViews = plain.length - plainBefore;
    siteFigureNames = plain.slice(plainBefore).map(view => view.name);
    if (siteFigureViews !== 2) throw new Error('with the deviation panel off Make site figure added ' + siteFigureViews + ' saved views, not 2');
    if (siteFigureNames.join(', ') !== 'Overview, Site A:15') throw new Error('two-panel names: ' + siteFigureNames.join(', '));
    if (!plain.slice(plainBefore).every(view => view.included)) throw new Error('the two site figure panels are not both ticked');
    if (plain.slice(0, plainBefore).some(view => view.included)) throw new Error('an earlier saved view is still ticked into the two-panel figure');
    const plainLetters = await page.locator('#gpv-builder-rows .gpv-builder-letter').allTextContents();
    const plainExpected = [...Array(plainBefore).fill('—'), 'A', 'B'];
    if (plainLetters.join('') !== plainExpected.join('')) throw new Error('two-panel builder letters: ' + plainLetters.join(',') + ' not ' + plainExpected.join(','));
    if ((await page.inputValue('#gpv-panel-columns')) !== '2') throw new Error('two-panel columns: ' + (await page.inputValue('#gpv-panel-columns')));
    await takeSiteFigureBack();
    await tab('annotate');
    await page.click('#gpv-position-clear'); await page.waitForTimeout(600);
    if (!(await page.locator('#gpv-position-figure').isDisabled())) throw new Error('Make site figure stayed enabled with no compared position');
    if (await page.evaluate(() => window.__viewerDebug.positionEffect())) throw new Error('clearing left the measured neighbourhood behind');
    if (!(await page.locator('#gpv-position-effect-wrap').isHidden())) throw new Error('clearing left the effect table on screen');
    if (await page.evaluate(() => window.__viewerDebug.labelRecords().some(label => label.kind === 'position'))) throw new Error('clearing left position labels behind');
    if ((await page.evaluate(() => window.__viewerDebug.spotlightResidues())).length) throw new Error('clearing left compared positions behind');
    if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== labelsBefore) throw new Error('clearing removed labels it did not place');
    console.log('       ' + state.trim() + ' · side chains and both labels in the SVG · ' + effect.summary.neighbourCount + ' neighbours within ' + effect.cutoff + ' Å measured, highlighted and exported · site figure: Overview + Site A:15 + Deviation as panels A, B and C in three columns, PNG ' + figureWidth + ' px wide, colour mode back to ' + startColorMode + ' · two panels again with the deviation panel off · cleared');
  } finally { await cleanup(); }
});
await step('the two labels one press puts at a site do not cover each other, and a label placed by hand is left where it was put', async () => {
  /* The same wild-type/mutant pair: byte-identical coordinates apart from the residue name at A:15,
     so the two models are already perfectly superposed and the two labels that Compare this position
     writes there are anchored to the very same point on screen. That is the pile the press has to
     come out of by itself. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const mutated = original.map(line => (/^ATOM/.test(line) && line[21] === 'A' && Number(line.slice(22, 26)) === 15 ? line.slice(0, 17) + 'GLY' + line.slice(20) : line)).join('\n');
  const file = join(work, 'model_mutant.pdb'); await writeFile(file, mutated);
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'models');
  const startMode = await page.inputValue('#gpv-view-mode');
  const cleanup = async () => {
    await tab('annotate');
    if (await page.locator('#gpv-position-clear').count()) { await page.click('#gpv-position-clear'); await page.waitForTimeout(400); }
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_mutant' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await page.selectOption('#gpv-view-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  };
  /* Two boxes cover each other when they overlap on both axes — the test the viewer itself applies,
     written out here so the assertion does not borrow the code it is checking. */
  const covers = (a, b) => Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
  const read = async () => page.evaluate(() => {
    const d = window.__viewerDebug;
    if (typeof d.labelScreenBox !== 'function') return null;
    return {
      perAngstrom: d.pixelsPerAngstrom(d.viewer), scrollX, scrollY,
      labels: d.labelRecords().filter(label => label.kind === 'position').map(label => ({
        text: label.text,
        offset: label.offset ? Math.hypot(label.offset.x, label.offset.y, label.offset.z) : 0,
        /* The record keeps the residue's own coordinates, so the anchor can be projected without
           the offset and the two labels shown to have started in the same place. */
        anchor: d.viewer.modelToScreen({ x: label.x, y: label.y, z: label.z }),
        box: d.labelScreenBox(label)
      }))
    };
  });
  const labelsBefore = await page.locator('#gpv-label-list .gpv-entry').count();
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(300);
    await page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, ['model_a.pdb', 'model_mutant.pdb']);
    await page.waitForTimeout(900);
    await tab('annotate');
    await page.fill('#gpv-goto', 'A:15'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    await page.click('#gpv-position-compare'); await page.waitForTimeout(1200);
    const placed = await read();
    if (!placed) throw new Error('the debug hook exposes no labelScreenBox, so this build cannot measure whether two labels cover each other');
    if (placed.labels.length !== 2) throw new Error('the press left ' + placed.labels.length + ' position labels, not 2');
    const boxes = placed.labels.map(item => item.box);
    if (boxes.some(box => !box)) throw new Error('a position label does not project to the screen: ' + JSON.stringify(boxes));
    const anchors = placed.labels.map(item => item.anchor);
    const anchorGap = Math.hypot(anchors[0].x - anchors[1].x, anchors[0].y - anchors[1].y);
    if (anchorGap > 4) throw new Error('the two labels are anchored ' + anchorGap.toFixed(1) + ' px apart, so this is not the pile the step is about');
    if (covers(boxes[0], boxes[1])) throw new Error('one press left the two labels at A:15 covering each other: ' + JSON.stringify(boxes));
    /* Separated, not flung: the reference model's label keeps its place on the residue and the other
       one is moved, by no more than the six label heights the viewer allows itself. */
    const capPixels = 6 * 2 * Math.max(...boxes.map(box => box.halfHeight));
    const moved = placed.labels.filter(item => item.offset > 0);
    if (!moved.length) throw new Error('the boxes are clear of each other but no label carries an offset, so nothing was separated');
    if (moved.length !== 1) throw new Error(moved.length + ' labels were moved; one of a colliding pair is meant to keep its place');
    placed.labels.forEach(item => {
      const pixels = item.offset * placed.perAngstrom;
      if (pixels > capPixels + 4) throw new Error(item.text + ' was moved ' + pixels.toFixed(0) + ' px, past the ' + capPixels.toFixed(0) + ' px cap');
    });
    /* A placement of the user's own is never overridden: drag the label that stayed back over the
       one that moved, and the press must move the other one instead and leave the drag alone. */
    const anchored = placed.labels.find(item => item.offset === 0);
    const grab = { x: anchored.box.x - placed.scrollX, y: anchored.box.y - placed.scrollY };
    await page.mouse.move(grab.x, grab.y); await page.waitForTimeout(300);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + Math.round(anchored.box.halfHeight), { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(500);
    const dragged = (await read()).labels.find(item => item.text === anchored.text);
    if (!dragged.offset) throw new Error('the drag left ' + anchored.text + ' without an offset');
    if (await page.locator('#gpv-labels-separate').isDisabled()) throw new Error('Separate labels is disabled with two labels on screen');
    await page.click('#gpv-labels-separate'); await page.waitForTimeout(600);
    const after = await read();
    const kept = after.labels.find(item => item.text === anchored.text);
    if (Math.abs(kept.offset - dragged.offset) > 1e-6) throw new Error(anchored.text + ' was placed by hand at ' + dragged.offset.toFixed(2) + ' Å and the press moved it to ' + kept.offset.toFixed(2) + ' Å');
    const afterBoxes = after.labels.map(item => item.box);
    if (covers(afterBoxes[0], afterBoxes[1])) throw new Error('Separate labels left the two labels covering each other: ' + JSON.stringify(afterBoxes));
    const said = (await page.locator('#gpv-state').textContent()) || '';
    if (!/^(\d+ labels? moved apart|Labels already clear of each other)$/.test(said.trim())) throw new Error('Separate labels said: ' + said);
    await page.click('#gpv-position-clear'); await page.waitForTimeout(500);
    if (labelsBefore === 0 && !(await page.locator('#gpv-labels-separate').isDisabled())) throw new Error('Separate labels stayed enabled with no labels left');
    console.log('       both labels anchored within ' + anchorGap.toFixed(1) + ' px, separated to ' + Math.abs(boxes[0].y - boxes[1].y).toFixed(0) + ' px apart by moving ' + moved[0].text + ' ' + (moved[0].offset * placed.perAngstrom).toFixed(0) + ' px of a ' + capPixels.toFixed(0) + ' px cap · ' + said.trim().toLowerCase() + ' · the hand-placed ' + anchored.text + ' untouched at ' + kept.offset.toFixed(2) + ' Å');
  } finally { await cleanup(); }
});
await step('a figure exported for print separates the labels again at the size they are printed, and leaves the ones on screen where they are', async () => {
  /* The same wild-type/mutant pair, and the same two labels the press above separates on screen. A
     figure is not the stage enlarged: at 85 mm, 300 dpi and 10 pt the label text is drawn 3.5× the
     size it has on screen while the panel is barely wider than the stage, so a pair that clears by a
     pixel on screen prints half on top of each other unless the placement is worked out again at
     print size. The assertion is on the exported file's own geometry — the boxes the SVG draws, read
     out of the markup — and on the labels on screen being exactly where they were before the export,
     because a figure is a rendering and not an edit. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const mutated = original.map(line => (/^ATOM/.test(line) && line[21] === 'A' && Number(line.slice(22, 26)) === 15 ? line.slice(0, 17) + 'GLY' + line.slice(20) : line)).join('\n');
  const file = join(work, 'model_mutant.pdb'); await writeFile(file, mutated);
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'models');
  const startMode = await page.inputValue('#gpv-view-mode');
  const startPlan = await page.evaluate(() => ({
    mode: document.querySelector('#gpv-export-mode').value, width: document.querySelector('#gpv-print-width').value,
    dpi: document.querySelector('#gpv-print-dpi').value, text: document.querySelector('#gpv-print-text').value
  }));
  const cleanup = async () => {
    await tab('publish');
    await page.selectOption('#gpv-print-width', startPlan.width); await page.selectOption('#gpv-print-dpi', startPlan.dpi);
    await page.selectOption('#gpv-print-text', startPlan.text); await page.selectOption('#gpv-export-mode', startPlan.mode);
    await tab('annotate');
    if (await page.locator('#gpv-position-clear').count()) { await page.click('#gpv-position-clear'); await page.waitForTimeout(400); }
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_mutant' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await page.selectOption('#gpv-view-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  };
  const covers = (a, b) => Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
  /* Every label's offset and who put it there, as one string to compare before with after. */
  const placements = async () => page.evaluate(() => window.__viewerDebug.labelRecords().map(label =>
    label.key + '=' + (label.offset ? [label.offset.x, label.offset.y, label.offset.z].map(value => value.toFixed(9)).join(',') : 'none') + (label.autoPlaced ? ' auto' : '')).join(' | '));
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(300);
    await page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, ['model_a.pdb', 'model_mutant.pdb']);
    await page.waitForTimeout(900);
    await tab('annotate');
    await page.fill('#gpv-goto', 'A:15'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
    await page.click('#gpv-position-compare'); await page.waitForTimeout(1200);
    const screen = await page.evaluate(() => window.__viewerDebug.labelRecords().filter(label => label.kind === 'position')
      .map(label => ({ text: label.text, size: label.size || 12, box: window.__viewerDebug.labelScreenBox(label) })));
    if (screen.length !== 2 || screen.some(item => !item.box)) throw new Error('the press did not leave two projectable position labels: ' + JSON.stringify(screen));
    /* The screen is the easy case and it is already right — which is what makes the printed figure
       the question this step is about. */
    if (covers(screen[0].box, screen[1].box)) throw new Error('the two labels cover each other on screen, so this step cannot say anything about the print');
    const before = await placements();
    await tab('publish');
    await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85');
    await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '10'); await page.waitForTimeout(400);
    const download = page.waitForEvent('download', { timeout: 180000 });
    await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const after = await placements();
    if (after !== before) throw new Error('the export moved the labels on screen:\n  before ' + before + '\n  after  ' + after);
    /* Each label is a box and its text in the markup: the text carries its centre and the size it is
       set in, the rect beside it how wide it came out. */
    const boxes = screen.map(item => {
      /* Lazily up to the rect's own width, so the stroke-width further along the tag is not read as
         the width of the box. */
      const found = new RegExp('<g><rect [^>]*?width="([\\d.]+)"[^>]*/><text x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*font-size="([\\d.]+)"[^>]*>' + item.text + '</text></g>').exec(svg);
      if (!found) throw new Error('the exported SVG has no label box for ' + item.text);
      /* text-anchor="middle" with dominant-baseline="central", and the box is 1.6 times the type
         size tall, so that is the half-height either side of the centre the markup gives. */
      return { text: item.text, size: item.size, font: Number(found[4]), x: Number(found[2]), y: Number(found[3]), halfWidth: Number(found[1]) / 2, halfHeight: Number(found[4]) * 0.8 };
    });
    const smallest = Math.min(...boxes.map(box => box.font / box.size));
    if (!(smallest > 2)) throw new Error('the print text is only ' + smallest.toFixed(2) + '× the screen size, so this export is not the print case the step is about');
    if (covers(boxes[0], boxes[1])) {
      const overlap = (boxes[0].halfHeight + boxes[1].halfHeight - Math.abs(boxes[0].y - boxes[1].y)).toFixed(1);
      throw new Error('the exported figure prints ' + boxes[0].text + ' and ' + boxes[1].text + ' over each other by ' + overlap + ' px of a ' + (boxes[0].halfHeight * 2).toFixed(1) + ' px box: ' + JSON.stringify(boxes));
    }
    console.log('       label text printed at ' + smallest.toFixed(1) + '× its screen size, the two boxes ' + Math.abs(boxes[0].y - boxes[1].y).toFixed(0) + ' px apart in the SVG for a box ' + (boxes[0].halfHeight * 2).toFixed(0) + ' px tall · the labels on screen untouched by the export');
  } finally { await cleanup(); }
});
await step('a set of positions is compared in one press: every site is labelled and one neighbourhood table covers them all', async () => {
  /* The same wild-type/mutant pair as the step above — a binding site or an interface is several
     residues, so the set is what the press has to take, not one residue at a time. */
  const original = (await readFile(join(work, 'model_a.pdb'), 'utf8')).split('\n');
  const mutated = original.map(line => (/^ATOM/.test(line) && line[21] === 'A' && Number(line.slice(22, 26)) === 15 ? line.slice(0, 17) + 'GLY' + line.slice(20) : line)).join('\n');
  if (mutated === original.join('\n')) throw new Error('the mutant fixture is identical to model_a — check the PDB columns');
  const file = join(work, 'model_mutant.pdb'); await writeFile(file, mutated);
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'models');
  const startMode = await page.inputValue('#gpv-view-mode');
  const startAlignmentMode = await page.inputValue('#gpv-alignment-mode');
  const cleanup = async () => {
    await tab('compare');
    await page.selectOption('#gpv-alignment-mode', startAlignmentMode); await page.waitForTimeout(200);
    await tab('annotate');
    await page.fill('#gpv-position-set', '');
    if (await page.locator('#gpv-position-clear').count()) { await page.click('#gpv-position-clear'); await page.waitForTimeout(300); }
    await tab('models');
    const row = page.locator('#gpv-list .gpv-entry', { hasText: 'model_mutant' });
    if (await row.count()) { await row.first().locator('button:has-text("Remove")').click(); await page.waitForTimeout(400); }
    await page.click('#gpv-show-all'); await page.waitForTimeout(600);
    await page.selectOption('#gpv-view-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  };
  try {
    await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1800);
    await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(300);
    await page.evaluate(labels => {
      [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => {
        const toggle = entry.querySelector('input[type="checkbox"]');
        const wanted = labels.some(label => entry.textContent.includes(label));
        if (toggle && toggle.checked !== wanted) toggle.click();
      });
    }, ['model_a.pdb', 'model_mutant.pdb']);
    await page.waitForTimeout(900);
    /* Identifier mapping for the same reason as the step above: the fixture's two chains are
       identical poly-alanine, and sequence matching is free to pair A with B. */
    await tab('compare');
    await page.selectOption('#gpv-alignment-mode', 'identifier'); await page.waitForTimeout(200);
    await page.evaluate(() => { const select = document.querySelector('#gpv-reference'); const option = [...select.options].find(item => /model_a\.pdb/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#gpv-align'); await page.waitForTimeout(2500);
    await tab('annotate');
    const labelsBefore = await page.locator('#gpv-label-list .gpv-entry').count();
    /* A range and a single position, mixed case and loose spacing — all of it has to be read. */
    await page.fill('#gpv-position-set', 'a:12-14 , A:20');
    await page.click('#gpv-position-set-run'); await page.waitForTimeout(1500);
    const wanted = [['A', 12], ['A', 13], ['A', 14], ['A', 20]];
    const spots = await page.evaluate(() => window.__viewerDebug.spotlightResidues());
    if (spots.length !== wanted.length || spots.some((spot, index) => spot.chain !== wanted[index][0] || spot.resi !== wanted[index][1])) {
      throw new Error('spotlight list: ' + JSON.stringify(spots));
    }
    /* One label per model per position, and no residue labelled twice. */
    const positionLabels = await page.evaluate(() => window.__viewerDebug.labelRecords().filter(label => label.kind === 'position').map(label => label.entryId + '|' + label.chain + '|' + label.resi));
    if (positionLabels.length !== 8) throw new Error(positionLabels.length + ' position labels, not 8 (4 positions × 2 models)');
    if (new Set(positionLabels).size !== 8) throw new Error('a position was labelled twice: ' + JSON.stringify(positionLabels));
    const perModel = [...positionLabels.reduce((counts, key) => counts.set(key.split('|')[0], (counts.get(key.split('|')[0]) || 0) + 1), new Map()).values()];
    if (perModel.length !== 2 || perModel.some(count => count !== 4)) throw new Error('labels per model: ' + JSON.stringify(perModel));
    if ((await page.locator('#gpv-label-list .gpv-entry').count()) - labelsBefore !== 8) throw new Error('the label list did not gain 8 rows');
    /* One table for the set: four site rows, and neighbour rows that are the union of the four
       neighbourhoods with no site counted as somebody else's neighbour. */
    const effect = await page.evaluate(() => window.__viewerDebug.positionEffect());
    if (!effect) throw new Error('no neighbourhood was measured for the set after Align visible');
    if (effect.summary.siteCount !== wanted.length) throw new Error('summary.siteCount is ' + effect.summary.siteCount + ', not ' + wanted.length);
    const siteRows = effect.rows.filter(row => row.isSite);
    if (siteRows.length !== wanted.length) throw new Error(siteRows.length + ' site rows, not ' + wanted.length);
    if (siteRows.some((row, index) => row.chain !== wanted[index][0] || row.resi !== wanted[index][1])) throw new Error('site rows: ' + JSON.stringify(siteRows.map(row => row.chain + ':' + row.resi)));
    const siteKeys = new Set(siteRows.map(row => row.chain + '|' + row.resi));
    const neighbourRows = effect.rows.filter(row => !row.isSite);
    const both = neighbourRows.filter(row => siteKeys.has(row.chain + '|' + row.resi));
    if (both.length) throw new Error('a compared site is also a neighbour row: ' + JSON.stringify(both.map(row => row.chain + ':' + row.resi)));
    if (new Set(neighbourRows.map(row => row.chain + '|' + row.resi)).size !== neighbourRows.length) throw new Error('the union neighbourhood has duplicate rows');
    if (effect.summary.neighbourCount !== neighbourRows.length) throw new Error('summary.neighbourCount is ' + effect.summary.neighbourCount + ', not the ' + neighbourRows.length + ' neighbour rows');
    if (!effect.summary.neighbourCount) throw new Error('the four sites have no neighbours within ' + effect.cutoff + ' Å');
    const state = (await page.locator('#gpv-position-state').textContent()) || '';
    if (!new RegExp('^' + wanted.length + ' positions compared').test(state.trim())) throw new Error('the readout does not name the set: ' + state);
    await page.click('#gpv-position-clear'); await page.waitForTimeout(600);
    if (await page.evaluate(() => window.__viewerDebug.labelRecords().some(label => label.kind === 'position'))) throw new Error('clearing left position labels behind');
    if ((await page.evaluate(() => window.__viewerDebug.spotlightResidues())).length) throw new Error('clearing left compared positions behind');
    if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== labelsBefore) throw new Error('clearing removed labels it did not place');
    console.log('       ' + state.trim() + ' · ' + siteRows.length + ' site rows + ' + neighbourRows.length + ' union neighbours within ' + effect.cutoff + ' Å, none counted twice · 8 labels cleared');
  } finally { await cleanup(); }
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
await step('insertion codes: 100, 100A and 100B are three residues in the strip, Go to, a label, the card and a scene', async () => {
  /* A Kabat-numbered stretch of a heavy chain H beside a light chain L. Before 2.52.0 the strip
     merged 100, 100A and 100B into one cell, a label on 100A sat on 100's Cα and shared its key, the
     card for 100A read 100's pLDDT, and Go to read "100A" as chain A, residue 100. */
  const numbering = [[98, ' ', 90], [99, ' ', 90], [100, ' ', 92], [100, 'A', 41], [100, 'B', 62], [101, ' ', 90]];
  const lines = []; let serial = 1;
  numbering.forEach(([resi, icode, b], index) => {
    const x = index * 3.8;
    lines.push(pdbAtom('ATOM', serial++, 'N', 'GLY', 'H', resi, [x - 1.2, 0.8, 0], 'N', icode, b));
    lines.push(pdbAtom('ATOM', serial++, 'CA', 'GLY', 'H', resi, [x, 0, 0], 'C', icode, b));
    lines.push(pdbAtom('ATOM', serial++, 'C', 'GLY', 'H', resi, [x + 1.2, 0.8, 0], 'C', icode, b));
  });
  [1, 2, 3, 4].forEach((resi, index) => {
    const x = index * 3.8;
    lines.push(pdbAtom('ATOM', serial++, 'N', 'ALA', 'L', resi, [x - 1.2, 9.8, 0], 'N'));
    lines.push(pdbAtom('ATOM', serial++, 'CA', 'ALA', 'L', resi, [x, 9, 0], 'C'));
    lines.push(pdbAtom('ATOM', serial++, 'C', 'ALA', 'L', resi, [x + 1.2, 9.8, 0], 'C'));
  });
  const file = join(work, 'kabat_insertions.pdb'); await writeFile(file, lines.join('\n') + '\nEND\n');
  const fresh = await freshViewer([file]);
  try {
    const goTo = async where => {
      await fresh.click('[data-gpv-tab="annotate"]'); await fresh.fill('#gpv-goto', where); await fresh.press('#gpv-goto', 'Enter'); await fresh.waitForTimeout(400);
      return fresh.evaluate(() => window.__viewerDebug.selectedResidue());
    };
    let picked = await goTo('100A');
    if (!picked || picked.chain !== 'H' || picked.resi !== 100 || picked.icode !== 'A') throw new Error('Go to 100A selected ' + JSON.stringify(picked && { chain: picked.chain, resi: picked.resi, icode: picked.icode }));
    picked = await goTo('H:100B');
    if (!picked || picked.icode !== 'B') throw new Error('Go to H:100B selected ' + JSON.stringify(picked));
    picked = await goTo('100');
    if (!picked || picked.icode !== '') throw new Error('Go to 100 selected the insertion ' + picked.icode);
    picked = await goTo('L 3');
    if (!picked || picked.chain !== 'L' || picked.resi !== 3) throw new Error('Go to "L 3" selected ' + JSON.stringify(picked));
    /* The strip: one cell per residue, insertions included, in order. */
    const hover = await fresh.evaluate(() => {
      const canvas = document.querySelector('#gpv-sequence-rows canvas[data-chain="H"]'); if (!canvas) return null;
      const box = canvas.getBoundingClientRect(); const texts = [];
      for (let index = 0; index < 6; index += 1) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + (index + 0.5) * box.width / 6, clientY: box.top + 10, bubbles: true }));
        texts.push(document.querySelector('#gpv-sequence-hint').textContent.split(' · ')[0]);
      }
      return texts;
    });
    if (!hover || hover.join(',') !== 'GLY98,GLY99,GLY100,GLY100A,GLY100B,GLY101') throw new Error('the strip reads ' + JSON.stringify(hover));
    /* A label on 100A: its own key, on its own Cα; the card names it and reads its own pLDDT. */
    await goTo('100A');
    await fresh.click('#gpv-add-label'); await fresh.waitForTimeout(300);
    const label = await fresh.evaluate(() => {
      const d = window.__viewerDebug; const record = d.labelRecords()[0]; const entry = d.entries()[0];
      const ca = entry.atoms.find(atom => atom.atom === 'CA' && atom.resi === 100 && String(atom.icode).trim() === 'A');
      const anchor = d.labelPosition(record);
      return { key: record.key, text: record.text, icode: record.icode, off: Math.hypot(anchor.x - ca.x, anchor.y - ca.y, anchor.z - ca.z) };
    });
    if (!/\|H\|100\|A$/.test(label.key) || label.icode !== 'A' || label.text !== 'GLY100A · H' || label.off > 1e-6) throw new Error('the label on 100A: ' + JSON.stringify(label));
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await fresh.keyboard.press('l'); await fresh.waitForTimeout(400);
    const head = (await fresh.locator('#gpv-label-editor .gpv-label-editor-residue').textContent()) || '';
    const facts = (await fresh.locator('#gpv-residue-card-facts').textContent()) || '';
    if (!head.startsWith('GLY100A · chain H')) throw new Error('the card is headed "' + head + '"');
    if (!/^pLDDT 41\.0/.test(facts)) throw new Error('the card for 100A reads "' + facts + '", not its own pLDDT 41.0');
    await fresh.keyboard.press('Escape'); await fresh.waitForTimeout(200);
    /* A scene writes the insertion code and reads it back onto the same residue. */
    await fresh.click('[data-gpv-tab="publish"]');
    const download = fresh.waitForEvent('download', { timeout: 20000 });
    await fresh.click('#gpv-save-scene');
    const sceneFile = join(work, 'scene-insertions.json'); await (await download).saveAs(sceneFile);
    const scene = JSON.parse(await readFile(sceneFile, 'utf8'));
    if (!scene.labels || scene.labels[0].icode !== 'A') throw new Error('the scene label carries ' + JSON.stringify(scene.labels && scene.labels[0]));
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.click('#gpv-clear-labels'); await fresh.waitForTimeout(200);
    await fresh.setInputFiles('#gpv-load-scene', sceneFile); await fresh.waitForTimeout(1500);
    const restored = await fresh.evaluate(() => window.__viewerDebug.labelRecords().map(record => ({ key: record.key, icode: record.icode })));
    if (restored.length !== 1 || !/\|100\|A$/.test(restored[0].key)) throw new Error('the scene restored ' + JSON.stringify(restored));
  } finally { await fresh.close(); }
});
await step('go to residue selects and zooms by chain and number', async () => {
  await page.fill('#gpv-goto', 'B:12'); await page.click('#gpv-goto-run'); await page.waitForTimeout(500);
  const readout = (await page.locator('#gpv-residue').textContent()) || '';
  if (!/ALA12 · chain B/.test(readout)) throw new Error('readout: ' + readout);
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
  if (!/ALA11 · chain B/.test(readout)) throw new Error('readout: ' + readout);
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

/* ---- Stress loop, round 1, batch 2: text on the canvas, the card, measurements, the keyboard ----
   The steps on α-chymotrypsin (5CHA) share a page of their own, opened by the first of them and
   closed after the last: its 3 719 atoms are past the size at which a click is searched coarse
   first, a Go to zooms far enough in perspective for the depth of a label to matter, and its
   catalytic triad gives side-chain atoms with a published distance (His57 NE2–Ser195 OG 3.02 Å).
   Each step puts the page back to nothing open, nothing active and nothing selected. */
let chaPage = null;
const cha = async () => {
  if (chaPage && !chaPage.isClosed()) return chaPage;
  chaPage = await freshViewer([join(here, 'fixtures', 'experimental', '5cha.cif')]);
  await chaPage.waitForTimeout(800);
  return chaPage;
};
const freshTap = async (fresh, x, y) => { await fresh.mouse.move(x, y); await fresh.mouse.down(); await fresh.waitForTimeout(60); await fresh.mouse.up(); };
const freshFocusStage = fresh => fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true }));
const freshSteps = fresh => fresh.evaluate(() => window.__viewerDebug.rememberedSteps());
const freshMeasures = fresh => fresh.evaluate(() => JSON.parse(JSON.stringify(window.__viewerDebug.measurementRecords())));
/* Esc until nothing is armed, open, active or selected, and no mode is on. */
const chaQuiet = async fresh => {
  for (let index = 0; index < 5; index += 1) {
    const busy = await fresh.evaluate(() => { const d = window.__viewerDebug; return Boolean(d.measureFrom() || d.labelEditor() || d.activeText() || d.selectedResidue() || /Stop/.test(document.querySelector('#gpv-measure').textContent) || /Stop/.test(document.querySelector('#gpv-annotate').textContent)); });
    if (!busy) return;
    await freshFocusStage(fresh); await fresh.keyboard.press('Escape'); await fresh.waitForTimeout(150);
  }
};
/* Everything a step made on the 5CHA page, cleared with the panel's own buttons. */
const chaClear = async fresh => {
  await chaQuiet(fresh);
  await fresh.click('[data-gpv-tab="annotate"]'); await fresh.waitForTimeout(100);
  for (const selector of ['#gpv-clear-labels', '#gpv-clear-measurements', '#gpv-clear-annotations', '#gpv-clear-selections']) {
    if (!(await fresh.isDisabled(selector))) { await fresh.click(selector); await fresh.waitForTimeout(150); }
  }
};
/* Viewport coordinates of a named atom of 5CHA where the page projects it now, on the nearest whole
   pixel: Firefox and WebKit deliver a pointer event at a fractional position cut down to a whole
   pixel (500.6 arrives as 500), Chromium as given, so a tap at a fraction lands on different pixels
   in different engines. A whole-pixel tap arrives where it was aimed in all three, and pageX/pageY
   are that same pixel, for a pickAtomAt check of what the tap will pick. */
const chaAtom = async (fresh, chain, resi, name) => {
  await fresh.locator('#gpv-stage').scrollIntoViewIfNeeded(); await fresh.waitForTimeout(100);
  return fresh.evaluate(([chain, resi, name]) => {
    const d = window.__viewerDebug; const entry = d.entries()[0];
    const atom = entry.atoms.find(item => (item.chain || '') === chain && item.resi === resi && item.atom === name);
    if (!atom) return null;
    const s = d.viewer.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
    const x = Math.round(s.x - scrollX); const y = Math.round(s.y - scrollY);
    return { x, y, pageX: x + scrollX, pageY: y + scrollY };
  }, [chain, resi, name]);
};
/* The catalytic triad framed on the stage: His57 and Asp102 of chain B, Ser195 of chain C. 5CHA holds
   two copies of the enzyme (chains A–C and E–G), so the residue numbers alone frame both: the view
   zooms out and the second copy lies over the first, with F45 CB 1.6 px from Ser195 OG. The chains
   keep it to the one triad. Go to one residue zooms so close that the other two leave the view. */
const chaFrameTriad = async fresh => {
  await fresh.evaluate(() => { const v = window.__viewerDebug.viewer; v.zoomTo({ chain: ['B', 'C'], resi: [57, 102, 195] }); v.render(); });
  await fresh.waitForTimeout(300);
};
/* Where on the stage a piece of text with these words is hit, found the way a pointer finds it:
   labelHitAt over a grid of the stage. */
const textOnStage = async (fresh, words) => {
  await fresh.locator('#gpv-stage').scrollIntoViewIfNeeded(); await fresh.waitForTimeout(100);
  return fresh.evaluate(words => {
    const d = window.__viewerDebug; const rect = document.querySelector('#gpv-stage').getBoundingClientRect();
    for (let y = rect.top + 6; y < rect.bottom - 6; y += 5) {
      for (let x = rect.left + 6; x < rect.right - 6; x += 5) {
        const hit = d.labelHitAt(x + scrollX, y + scrollY);
        if (hit && String(hit.record.text || '') === words) return { x, y, kind: hit.kind };
      }
    }
    return null;
  }, words);
};

await step('in perspective after Go to, five arrow presses move a label 40 px and a 100 px drag moves it 100 px; the dragged label becomes the active one, and Delete removes it', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  await fresh.click('[data-gpv-tab="appearance"]');
  const startProjection = await fresh.inputValue('#gpv-projection');
  try {
    if (startProjection !== 'perspective') { await fresh.selectOption('#gpv-projection', 'perspective'); await fresh.waitForTimeout(400); }
    await freshGoTo(fresh, 'B:102');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    await fresh.keyboard.type('Depth'); await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(300);
    await fresh.locator('#gpv-stage').scrollIntoViewIfNeeded(); await fresh.waitForTimeout(150);
    const box = () => fresh.evaluate(() => { const d = window.__viewerDebug; const label = d.labelRecords().find(item => item.text === 'Depth'); const b = label && d.labelScreenBox(label); return b ? { x: b.x - scrollX, y: b.y - scrollY } : null; });
    /* The point of the step: after Go to, the label is not at the depth of the model centre, where
       pixels per ångström used to be measured. Measured here from the projection itself: one ångström
       along the camera's right axis, at the label and at the centre. */
    const scales = await fresh.evaluate(() => {
      const d = window.__viewerDebug; const v = d.viewer; const label = d.labelRecords().find(item => item.text === 'Depth');
      const q = v.getView(); const x = -q[4], y = -q[5], z = -q[6], w = q[7];
      const ix = w, iy = z, iz = -y, iw = -x;
      const right = { x: ix * w - iw * x - iy * z + iz * y, y: iy * w - iw * y - iz * x + ix * z, z: iz * w - iw * z - ix * y + iy * x };
      const at = point => { const a = v.modelToScreen(point); const b = v.modelToScreen({ x: point.x + right.x, y: point.y + right.y, z: point.z + right.z }); return Math.hypot(b.x - a.x, b.y - a.y); };
      return { centre: at(d.sceneCentre()), own: at(d.labelPosition(label)) };
    });
    if (!(scales.own > 0 && Math.abs(scales.own / scales.centre - 1) > 0.15)) throw new Error('the label sits at the depth of the model centre (' + JSON.stringify(scales) + '), so this view cannot tell the two apart');
    const active = await fresh.evaluate(() => window.__viewerDebug.activeText());
    if (!active || active.kind !== 'label') throw new Error('the label just added is not active: ' + JSON.stringify(active));
    const start = await box();
    await freshFocusStage(fresh);
    for (let index = 0; index < 5; index += 1) { await fresh.keyboard.press('ArrowRight'); await fresh.waitForTimeout(80); }
    const pressed = await box();
    const keyed = pressed.x - start.x;
    if (!(Math.abs(keyed - 40) <= 1)) throw new Error('five arrow presses moved the label ' + keyed.toFixed(1) + ' px, not 40 (' + scales.own.toFixed(1) + ' px/Å at the label, ' + scales.centre.toFixed(1) + ' at the centre)');
    await freshFocusStage(fresh); await fresh.keyboard.press('Escape'); await fresh.waitForTimeout(150);
    if (await fresh.evaluate(() => window.__viewerDebug.activeText())) throw new Error('Esc did not let go of the label');
    await fresh.mouse.move(pressed.x, pressed.y); await fresh.mouse.down();
    for (let index = 1; index <= 10; index += 1) { await fresh.mouse.move(pressed.x + index * 10, pressed.y); await fresh.waitForTimeout(30); }
    await fresh.mouse.up(); await fresh.waitForTimeout(300);
    const dragged = await box();
    const pulled = dragged.x - pressed.x;
    if (!(Math.abs(pulled - 100) <= 2)) throw new Error('a 100 px drag moved the label ' + pulled.toFixed(1) + ' px');
    const after = await fresh.evaluate(() => window.__viewerDebug.activeText());
    if (!after || after.kind !== 'label') throw new Error('the dragged label is not the active one: ' + JSON.stringify(after));
    await freshFocusStage(fresh); await fresh.keyboard.press('Delete'); await fresh.waitForTimeout(250);
    if (await fresh.evaluate(() => window.__viewerDebug.labelRecords().some(item => item.text === 'Depth'))) throw new Error('Delete right after the drag left the label');
    console.log('       ' + scales.own.toFixed(1) + ' px/Å at the label, ' + scales.centre.toFixed(1) + ' at the model centre · arrows ' + keyed.toFixed(1) + ' px · drag ' + pulled.toFixed(1) + ' px · Delete took the dragged label');
  } finally {
    await chaClear(fresh);
    await fresh.click('[data-gpv-tab="appearance"]');
    if ((await fresh.inputValue('#gpv-projection')) !== startProjection) { await fresh.selectOption('#gpv-projection', startProjection); await fresh.waitForTimeout(300); }
  }
});
await step('on 5CHA in stick style a click reaches a side-chain atom: His57 NE2 to Ser195 OG measures 3.02 Å, and the editor puts a measurement between other atoms back on them after Cα–Cα', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  await fresh.click('[data-gpv-tab="appearance"]');
  const startStyle = await fresh.inputValue('#gpv-style');
  try {
    await fresh.selectOption('#gpv-style', 'stick'); await fresh.waitForTimeout(600);
    await chaFrameTriad(fresh);
    const picks = [];
    for (const [chain, resi, name] of [['B', 57, 'NE2'], ['C', 195, 'OG'], ['B', 102, 'OD1'], ['B', 102, 'OD2']]) {
      const at = await chaAtom(fresh, chain, resi, name);
      const hit = await fresh.evaluate(([x, y]) => { const h = window.__viewerDebug.pickAtomAt(x, y); return h ? h.atom.chain + h.atom.resi + ' ' + h.atom.atom : null; }, [at.pageX, at.pageY]);
      if (hit !== chain + resi + ' ' + name) throw new Error('a click on ' + chain + resi + ' ' + name + ' picks ' + hit);
      picks.push(hit);
    }
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.click('#gpv-measure'); await fresh.waitForTimeout(200);
    const ne2 = await chaAtom(fresh, 'B', 57, 'NE2'); await freshTap(fresh, ne2.x, ne2.y); await fresh.waitForTimeout(300);
    const og = await chaAtom(fresh, 'C', 195, 'OG'); await freshTap(fresh, og.x, og.y); await fresh.waitForTimeout(400);
    /* A second pair that is neither the residues' closest atoms (ND1–OD1) nor their Cα atoms. */
    await freshTap(fresh, ne2.x, ne2.y); await fresh.waitForTimeout(300);
    const od2 = await chaAtom(fresh, 'B', 102, 'OD2'); await freshTap(fresh, od2.x, od2.y); await fresh.waitForTimeout(400);
    await fresh.click('#gpv-measure'); await fresh.waitForTimeout(200);
    const records = await freshMeasures(fresh);
    if (records.length !== 2) throw new Error('four clicks in measurement mode made ' + records.length + ' measurements');
    const other = records[1].points.map(point => point.chain + point.resi + ' ' + point.atom).join(' ↔ ');
    if (other !== 'B57 NE2 ↔ B102 OD2') throw new Error('the second two clicks measured ' + other);
    const atoms = records[0].points.map(point => point.chain + point.resi + ' ' + point.atom).join(' ↔ ');
    if (atoms !== 'B57 NE2 ↔ C195 OG') throw new Error('the two clicks measured ' + atoms);
    const value = await fresh.evaluate(() => window.__viewerDebug.measurementLabelText(window.__viewerDebug.measurementRecords()[0]));
    if (value !== '3.02 Å') throw new Error('His57 NE2–Ser195 OG reads ' + value + ', published 3.02 Å');
    /* The atoms as measured stay one choice of the editor's Atoms after Cα–Cα is chosen. */
    await fresh.locator('#gpv-stage').scrollIntoViewIfNeeded(); await fresh.waitForTimeout(100);
    const spot = await fresh.evaluate(() => { const d = window.__viewerDebug; const b = d.measurementScreenBox(d.measurementRecords()[1]); return b ? { x: b.x - scrollX, y: b.y - scrollY } : null; });
    await freshTap(fresh, spot.x, spot.y); await fresh.waitForTimeout(350);
    const options = () => fresh.evaluate(() => [...document.querySelectorAll('#gpv-measure-editor-pair option')].map(option => option.value));
    if (!(await options()).includes('measured')) throw new Error('the editor does not offer the atoms as measured: ' + (await options()).join(', '));
    await fresh.selectOption('#gpv-measure-editor-pair', 'ca'); await fresh.waitForTimeout(250);
    const ca = (await freshMeasures(fresh))[1].points.map(point => point.atom).join('–');
    if (ca !== 'CA–CA') throw new Error('Cα–Cα left the atoms at ' + ca);
    if (!(await options()).includes('measured')) throw new Error('after Cα–Cα the atoms as measured are no longer offered: ' + (await options()).join(', '));
    await fresh.selectOption('#gpv-measure-editor-pair', 'measured'); await fresh.waitForTimeout(250);
    const back = (await freshMeasures(fresh))[1].points.map(point => point.chain + point.resi + ' ' + point.atom).join(' ↔ ');
    if (back !== 'B57 NE2 ↔ B102 OD2') throw new Error('as measured put the measurement on ' + back);
    console.log('       picked ' + picks.join(', ') + ' · measured ' + atoms + ' ' + value + ' · ' + other + ': Cα–Cα and back to the atoms as measured');
  } finally {
    await chaClear(fresh);
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-style', startStyle); await fresh.waitForTimeout(400);
  }
});
await step('Go to with the card open closes it, and opening the card drops an armed Measure to… and says so', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  try {
    await freshGoTo(fresh, 'B:57');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    if (!(await fresh.locator('#gpv-label-editor').isVisible())) throw new Error('L did not open the card at His57');
    await freshGoTo(fresh, 'C:195');
    const selected = await fresh.evaluate(() => window.__viewerDebug.selectedResidue());
    if (!selected || selected.chain !== 'C' || selected.resi !== 195) throw new Error('Go to C:195 selected ' + JSON.stringify(selected));
    if (await fresh.locator('#gpv-label-editor').isVisible()) throw new Error('the card stayed open at HIS57 after Go to C:195: ' + (await fresh.locator('#gpv-label-editor .gpv-label-editor-residue').textContent()));
    await freshGoTo(fresh, 'B:57');
    await freshFocusStage(fresh); await fresh.keyboard.press('m'); await fresh.waitForTimeout(200);
    if (!(await fresh.evaluate(() => window.__viewerDebug.measureFrom()))) throw new Error('M did not arm Measure to…');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    const state = await fresh.evaluate(() => ({ armed: window.__viewerDebug.measureFrom(), crosshair: document.querySelector('#gpv-stage').classList.contains('is-measuring-to'), card: Boolean(window.__viewerDebug.labelEditor()) }));
    if (!state.card) throw new Error('L did not open the card');
    if (state.armed || state.crosshair) throw new Error('Measure to… stayed armed behind the card: ' + JSON.stringify(state));
    const said = await freshStatus(fresh);
    if (!/^Measure to… cancelled/.test(said)) throw new Error('opening the card said: ' + said);
    console.log('       Go to closed the card · "' + said + '"');
  } finally { await chaClear(fresh); }
});
await step('loading a file drops an armed Measure to…, so a click on the new model opens its card instead of measuring into it', async () => {
  const fresh = await freshViewer([models[0]]);
  /* The fixture's twin chains overlap at the opening orientation; turn until a residue stands clear. */
  const tappable = async () => {
    for (const axis of [null, 'x', 'y', 'x', 'y', 'x']) {
      if (axis) { await fresh.evaluate(axis => { const v = window.__viewerDebug.viewer; v.rotate(60, axis); v.render(); }, axis); await fresh.waitForTimeout(200); }
      const found = await canvasResidue([], fresh);
      if (found) return found;
    }
    return null;
  };
  try {
    await fresh.selectOption('#gpv-view-mode', 'single'); await fresh.waitForTimeout(300);
    const first = await tappable();
    if (!first) throw new Error('no residue on screen to tap');
    await freshTap(fresh, first.x, first.y); await fresh.waitForTimeout(400);
    if (!(await editorShown(fresh))) throw new Error('the card did not open');
    await fresh.click('#gpv-label-editor-measure'); await fresh.waitForTimeout(200);
    if (!(await fresh.evaluate(() => window.__viewerDebug.measureFrom()))) throw new Error('Measure to… armed nothing');
    const before = (await freshMeasures(fresh)).length;
    await fresh.setInputFiles('#gpv-files', [models[1]]); await fresh.waitForTimeout(2000);
    const state = await fresh.evaluate(() => ({ armed: window.__viewerDebug.measureFrom(), crosshair: document.querySelector('#gpv-stage').classList.contains('is-measuring-to'), shown: window.__viewerDebug.displayedEntries().map(entry => entry.name) }));
    if (state.armed || state.crosshair) throw new Error('still armed after the import: ' + JSON.stringify(state));
    if (state.shown.join() !== 'model_b.pdb') throw new Error('setup: shown ' + state.shown.join());
    const second = await tappable();
    if (!second) throw new Error('no residue of the new model on screen');
    await freshTap(fresh, second.x, second.y); await fresh.waitForTimeout(400);
    const after = (await freshMeasures(fresh)).length;
    if (after !== before) throw new Error('the click on the new model measured into it (' + (after - before) + ' new)');
    if (!(await editorShown(fresh))) throw new Error('the click on the new model did not open its card');
    console.log('       armed on model_a · model_b loaded · its ' + second.text + ' opened the card');
  } finally { await fresh.close(); }
});
await step('Measure all leaves out a contact already measured and says how many, a second press adds nothing, and Highlight pressed twice adds no second set', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  try {
    await freshGoTo(fresh, 'B:57');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    await fresh.click('#gpv-label-editor-contacts'); await fresh.waitForTimeout(300);
    const rows = await fresh.locator('#gpv-residue-contacts-rows .gpv-residue-contact').count();
    if (rows < 3) throw new Error('His57 lists ' + rows + ' contacts');
    await fresh.locator('#gpv-residue-contacts-rows .gpv-residue-contact[data-resi="102"]').click(); await fresh.waitForTimeout(250);
    await fresh.click('#gpv-residue-contacts-measure-all'); await fresh.waitForTimeout(300);
    const records = await freshMeasures(fresh);
    const keys = records.map(record => record.points.map(point => point.chain + point.resi + point.atom).sort().join('|'));
    if (new Set(keys).size !== keys.length) throw new Error('a pair is measured twice: ' + keys.filter((key, index) => keys.indexOf(key) !== index).join(', '));
    if (records.length !== rows) throw new Error(records.length + ' measurements for ' + rows + ' contacts');
    const said = await freshStatus(fresh);
    if (!/1 already measured/.test(said)) throw new Error('Measure all said: ' + said);
    const steps = await freshSteps(fresh);
    await fresh.click('#gpv-residue-contacts-measure-all'); await fresh.waitForTimeout(300);
    if ((await freshMeasures(fresh)).length !== rows) throw new Error('a second Measure all added ' + ((await freshMeasures(fresh)).length - rows));
    if ((await freshSteps(fresh)) !== steps) throw new Error('a second Measure all that added nothing took an undo step');
    if (!/already measured/.test(await freshStatus(fresh))) throw new Error('a second Measure all said: ' + (await freshStatus(fresh)));
    await fresh.click('#gpv-residue-contacts-highlight'); await fresh.waitForTimeout(300);
    const highlighted = await fresh.evaluate(() => window.__viewerDebug.selectionRecords().length);
    const before = await freshSteps(fresh);
    await fresh.click('#gpv-residue-contacts-highlight'); await fresh.waitForTimeout(300);
    const again = await fresh.evaluate(() => window.__viewerDebug.selectionRecords().length);
    if (again !== highlighted) throw new Error('Highlight pressed twice made ' + again + ' selection rows, not ' + highlighted);
    if ((await freshSteps(fresh)) !== before) throw new Error('a Highlight that added nothing took an undo step');
    console.log('       ' + rows + ' contacts · "' + said + '" · Highlight twice: ' + again + ' rows');
  } finally { await chaClear(fresh); }
});
await step('the contacts list shows the peptide bond tag whole and writes Cα (Gly193 · C), Within is held to 2–12 Å in its field, and Go to reads B57', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  const startCutoff = await fresh.inputValue('#gpv-near-cutoff');
  try {
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.fill('#gpv-near-cutoff', '8'); await fresh.press('#gpv-near-cutoff', 'Tab'); await fresh.waitForTimeout(150);
    await freshGoTo(fresh, 'B57');
    const selected = await fresh.evaluate(() => window.__viewerDebug.selectedResidue());
    if (!selected || selected.chain !== 'B' || selected.resi !== 57) throw new Error('Go to B57 selected ' + JSON.stringify(selected) + ' · ' + (await freshStatus(fresh)));
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    await fresh.click('#gpv-label-editor-contacts'); await fresh.waitForTimeout(300);
    const cells = await fresh.evaluate(() => [...document.querySelectorAll('#gpv-residue-contacts-rows .gpv-residue-contact')].map(button => {
      const name = button.querySelector('.gpv-contact-name'); const bond = button.querySelector('.gpv-contact-bond');
      const box = name.getBoundingClientRect(); const tag = bond && bond.getBoundingClientRect();
      return { atoms: button.dataset.atoms, shown: button.querySelector('.gpv-contact-atoms').textContent, bond: bond ? bond.textContent : '', clipped: Boolean(bond) && (tag.right > box.right + 0.5 || name.scrollWidth > name.clientWidth + 0.5) };
    }));
    const tagged = cells.filter(cell => cell.bond === 'peptide bond');
    if (tagged.length < 2) throw new Error('His57 has ' + tagged.length + ' rows tagged "peptide bond"');
    if (tagged.some(cell => cell.clipped)) throw new Error('the peptide bond tag is cut off in its cell');
    await chaQuiet(fresh);
    /* A glycine has no side chain, so its closest approaches run through its Cα. */
    await freshGoTo(fresh, 'C:193');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(300);
    await fresh.click('#gpv-label-editor-contacts'); await fresh.waitForTimeout(300);
    const glycine = await fresh.evaluate(() => [...document.querySelectorAll('#gpv-residue-contacts-rows .gpv-residue-contact')].map(button => ({ atoms: button.dataset.atoms, shown: button.querySelector('.gpv-contact-atoms').textContent })));
    const alpha = glycine.filter(cell => /(^|–)CA(–|$)/.test(cell.atoms));
    if (!alpha.length) throw new Error('no contact of Gly193 is closest at a Cα: ' + glycine.map(cell => cell.atoms).join(', '));
    if (alpha.some(cell => /CA/.test(cell.shown) || !/Cα/.test(cell.shown))) throw new Error('a closest pair through a Cα reads ' + alpha.map(cell => cell.shown).join(', '));
    await chaQuiet(fresh);
    for (const [typed, held] of [['15', '12'], ['1', '2']]) {
      await fresh.fill('#gpv-near-cutoff', typed); await fresh.press('#gpv-near-cutoff', 'Tab'); await fresh.waitForTimeout(150);
      const field = await fresh.inputValue('#gpv-near-cutoff');
      if (field !== held) throw new Error('Within ' + typed + ' Å is left reading ' + field + ' while the count is made at ' + held);
    }
    console.log('       ' + tagged.length + ' peptide bond tags whole · ' + alpha.length + ' Cα pairs written Cα · Within 15 → 12, 1 → 2 · B57 is HIS57 · B');
  } finally {
    await chaClear(fresh);
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.fill('#gpv-near-cutoff', startCutoff); await fresh.press('#gpv-near-cutoff', 'Tab');
  }
});
await step('Separate labels pressed again with nothing to move says so and takes no undo step, and a press that leaves overlaps says how many', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  try {
    for (let resi = 50; resi < 66; resi += 1) {
      await freshGoTo(fresh, 'B:' + resi);
      await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(150);
      await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(120);
    }
    await chaQuiet(fresh);
    await freshFocusStage(fresh); await fresh.keyboard.press('f'); await fresh.waitForTimeout(500);
    const labels = await fresh.evaluate(() => window.__viewerDebug.labelRecords().length);
    if (labels !== 16) throw new Error(labels + ' labels, not 16');
    const offsets = () => fresh.evaluate(() => JSON.stringify(window.__viewerDebug.labelRecords().map(label => label.offset || null)));
    let steps = await freshSteps(fresh);
    await fresh.click('#gpv-labels-separate'); await fresh.waitForTimeout(400);
    const first = await freshStatus(fresh);
    if (!/moved apart/.test(first)) throw new Error('the first press said: ' + first);
    if ((await freshSteps(fresh)) - steps !== 1) throw new Error('the first press took ' + ((await freshSteps(fresh)) - steps) + ' undo steps');
    const placed = await offsets();
    const left = await fresh.evaluate(() => { const r = window.__viewerDebug.separateLabels({ write: false }); return r ? r.remaining : null; });
    if (left && !new RegExp(left + ' pairs? still overlap').test(first)) throw new Error(left + ' pairs still overlap, and the press said: ' + first);
    steps = await freshSteps(fresh);
    await fresh.click('#gpv-labels-separate'); await fresh.waitForTimeout(400);
    const second = await freshStatus(fresh);
    if ((await offsets()) !== placed) throw new Error('the second press moved labels');
    if ((await freshSteps(fresh)) !== steps) throw new Error('a second press that moved nothing took an undo step');
    if (/moved apart/.test(second)) throw new Error('a second press that moved nothing said: ' + second);
    console.log('       16 labels · first press "' + first + '" · second press "' + second + '"');
  } finally { await chaClear(fresh); }
});
await step('while measuring, a click on a label over an atom picks the atom instead of being swallowed', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  try {
    await freshGoTo(fresh, 'B:57');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(250);
    await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(200);
    await chaQuiet(fresh);
    const at = await chaAtom(fresh, 'B', 57, 'CA');
    const covered = await fresh.evaluate(([x, y]) => { const hit = window.__viewerDebug.labelHitAt(x, y); return hit ? hit.kind : null; }, [at.pageX, at.pageY]);
    if (covered !== 'label') throw new Error('His57\'s label does not cover its Cα (' + covered + '), so this step proves nothing');
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.click('#gpv-measure'); await fresh.waitForTimeout(200);
    await freshTap(fresh, at.x, at.y); await fresh.waitForTimeout(300);
    const state = ((await fresh.locator('#gpv-measure-state').textContent()) || '').trim();
    if (!/^Selected 1 of 2 atoms/.test(state)) throw new Error('a click on the label over His57\'s Cα while measuring left: ' + state);
    console.log('       a click on the label counted for the measurement: ' + state);
  } finally { await chaClear(fresh); }
});
await step('the canvas editor empties an arrow\'s text as its row does, and keeps a callout\'s text and says why', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  const startType = await fresh.inputValue('#gpv-annotation-type');
  const startText = await fresh.inputValue('#gpv-annotation-text');
  try {
    await chaFrameTriad(fresh);
    const draw = async (type, text, points) => {
      await fresh.click('[data-gpv-tab="annotate"]');
      await fresh.selectOption('#gpv-annotation-type', type); await fresh.fill('#gpv-annotation-text', text);
      await fresh.click('#gpv-annotate'); await fresh.waitForTimeout(150);
      for (const [chain, resi] of points) { const at = await chaAtom(fresh, chain, resi, 'CA'); await freshTap(fresh, at.x, at.y); await fresh.waitForTimeout(250); }
      await fresh.click('#gpv-annotate'); await fresh.waitForTimeout(150);
    };
    const rowTexts = () => fresh.locator('#gpv-annotation-list .gpv-entry input[type="text"]').evaluateAll(inputs => inputs.map(input => input.value));
    const empty = async words => {
      const spot = await textOnStage(fresh, words);
      if (!spot) throw new Error('"' + words + '" is not on the stage');
      await freshTap(fresh, spot.x, spot.y); await fresh.waitForTimeout(300);
      if (!(await fresh.locator('#gpv-label-editor').isVisible())) throw new Error('a click on "' + words + '" opened no editor');
      await fresh.fill('#gpv-label-editor-text', ''); await fresh.press('#gpv-label-editor-text', 'Enter'); await fresh.waitForTimeout(250);
    };
    await draw('arrow', 'arrow words', [['B', 57], ['C', 195]]);
    await empty('arrow words');
    const arrow = await rowTexts();
    if (arrow[0] !== '') throw new Error('an empty commit left the arrow reading ' + JSON.stringify(arrow));
    const saidArrow = await freshStatus(fresh);
    if (saidArrow !== 'Arrow text removed') throw new Error('the empty commit said: ' + saidArrow);
    await draw('callout', 'callout words', [['B', 102]]);
    await empty('callout words');
    const callout = await rowTexts();
    if (callout[1] !== 'callout words') throw new Error('an empty commit changed the callout to ' + JSON.stringify(callout));
    const saidCallout = await freshStatus(fresh);
    if (!/keeps its text/.test(saidCallout)) throw new Error('the kept callout text was not explained: ' + saidCallout);
    console.log('       arrow: "' + saidArrow + '" · callout: "' + saidCallout + '"');
  } finally {
    await chaClear(fresh);
    await fresh.selectOption('#gpv-annotation-type', startType); await fresh.fill('#gpv-annotation-text', startText);
  }
});
await step('measurement text says what it is in the status and the undo history, its row keeps the focus and names its Remove, and Default takes its colour back in one undo step', async () => {
  const fresh = await cha();
  await chaClear(fresh);
  try {
    await freshGoTo(fresh, 'B:57');
    await freshFocusStage(fresh); await fresh.keyboard.press('l'); await fresh.waitForTimeout(250);
    await fresh.click('#gpv-label-editor-contacts'); await fresh.waitForTimeout(250);
    await fresh.locator('#gpv-residue-contacts-rows .gpv-residue-contact[data-resi="102"]').click(); await fresh.waitForTimeout(250);
    await chaQuiet(fresh);
    const record = (await freshMeasures(fresh))[0];
    const row = fresh.locator('#gpv-measurement-list .gpv-entry').first();
    const remove = (await row.locator('button:has-text("Remove")').getAttribute('aria-label')) || '';
    if (!/^Remove the measurement HIS57 · B CA ↔ ASP102 · B CA/.test(remove)) throw new Error('the row\'s Remove is named "' + remove + '"');
    /* Default: a colour, then back to none, one step. */
    await row.locator('input[type="color"]').evaluate(input => { input.value = '#00aa00'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await fresh.waitForTimeout(150);
    if ((await freshMeasures(fresh))[0].color !== '#00aa00') throw new Error('the row\'s colour did not reach the record');
    let steps = await freshSteps(fresh);
    await fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('button:has-text("Default")').click(); await fresh.waitForTimeout(200);
    if ((await freshMeasures(fresh))[0].color) throw new Error('Default left the colour ' + (await freshMeasures(fresh))[0].color);
    if ((await freshSteps(fresh)) - steps !== 1) throw new Error('Default took ' + ((await freshSteps(fresh)) - steps) + ' undo steps');
    if (!(await fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('button:has-text("Default")').isDisabled())) throw new Error('Default stays enabled with the default colour');
    /* Enter in the row's text and Space on Dashed keep the focus on that control. */
    const text = fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('input[type="text"]');
    await text.fill('H-bond'); await text.press('Enter'); await fresh.waitForTimeout(200);
    const focusText = await fresh.evaluate(() => { const a = document.activeElement; return a && a.matches('#gpv-measurement-list input[type="text"]') ? a.value : a ? a.tagName + '#' + a.id : null; });
    if (focusText !== 'H-bond') throw new Error('after Enter in the row the focus is on ' + focusText);
    const dashed = fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('input[data-control="dashed"]');
    await dashed.focus(); await fresh.keyboard.press('Space'); await fresh.waitForTimeout(200);
    const focusBox = await fresh.evaluate(() => { const a = document.activeElement; return a ? a.dataset.control || a.tagName : null; });
    if (focusBox !== 'dashed') throw new Error('after Space on Dashed the focus is on ' + focusBox);
    /* The text's own words for what happened to it. */
    await fresh.locator('#gpv-stage').scrollIntoViewIfNeeded(); await fresh.waitForTimeout(100);
    const label = await fresh.evaluate(id => { const d = window.__viewerDebug; const b = d.measurementScreenBox(d.measurementRecords().find(item => item.id === id)); return { x: b.x - scrollX, y: b.y - scrollY }; }, record.id);
    await fresh.mouse.move(label.x, label.y); await fresh.mouse.down(); await fresh.mouse.move(label.x + 20, label.y + 10, { steps: 4 }); await fresh.mouse.up(); await fresh.waitForTimeout(250);
    const dragged = await freshStatus(fresh);
    if (!/^Measurement text moved/.test(dragged)) throw new Error('dragging the measurement said: ' + dragged);
    await freshFocusStage(fresh); await fresh.keyboard.press('ArrowRight'); await fresh.waitForTimeout(150);
    const nudged = await freshStatus(fresh);
    if (!/^Measurement text moved/.test(nudged)) throw new Error('an arrow press said: ' + nudged);
    await fresh.keyboard.press('Control+z'); await fresh.waitForTimeout(250);
    const undone = await freshStatus(fresh);
    if (!/^Undid measurement text move/.test(undone)) throw new Error('undoing the arrow press said: ' + undone);
    await fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('button:has-text("Select")').click(); await fresh.waitForTimeout(150);
    await freshFocusStage(fresh); await fresh.keyboard.press('Escape'); await fresh.waitForTimeout(150);
    const letGoSaid = await freshStatus(fresh);
    if (letGoSaid !== 'No measurement selected') throw new Error('Esc on the active measurement said: ' + letGoSaid);
    await fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('button:has-text("Show")').click(); await fresh.waitForTimeout(200);
    if (!/^Centred on /.test(await freshStatus(fresh))) throw new Error('Show said: ' + (await freshStatus(fresh)));
    steps = await freshSteps(fresh);
    await fresh.locator('#gpv-measurement-list .gpv-entry').first().locator('button:has-text("Remove")').click(); await fresh.waitForTimeout(200);
    if ((await freshStatus(fresh)) !== 'Measurement removed') throw new Error('the row\'s Remove said: ' + (await freshStatus(fresh)));
    console.log('       "' + dragged.split(' · ')[0] + '" · "' + undone.split(' · ')[0] + '" · "' + letGoSaid + '" · focus kept on the text and Dashed · Default one step');
  } finally { await chaClear(fresh); }
});
await step('the Annotate readout, the label list and the selection list name the model as renamed and the residue as the card does; a blank chain reads "all chains"', async () => {
  /* The readout said "model_a.pdb · ALA 12 chain B · atom CA" after a rename, the label row "ALA 12 · chain B",
     the selection row "chain —" for a range in every chain, and the contact map "B:ALA 12". */
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.click('#gpv-list [aria-label="Rename model_a.pdb"]'); await fresh.keyboard.type('Wild type'); await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(300);
    await freshGoTo(fresh, 'B:12');
    const readout = await freshText(fresh, '#gpv-residue');
    if (!/^Wild type · ALA12 · chain B · atom CA( · pLDDT [\d.]+)?$/.test(readout)) throw new Error('readout: ' + readout);
    await fresh.click('#gpv-add-label'); await fresh.waitForTimeout(300);
    const where = await freshText(fresh, '#gpv-label-list .gpv-entry .gpv-entry-source');
    if (where !== 'Wild type · ALA12 · chain B') throw new Error('label row: ' + where);
    await fresh.fill('#gpv-selection-chain', ''); await fresh.fill('#gpv-selection-range', '5-7'); await fresh.selectOption('#gpv-selection-action', 'highlight');
    await fresh.click('#gpv-add-selection'); await fresh.waitForTimeout(300);
    const selection = await freshText(fresh, '#gpv-selection-list .gpv-entry .gpv-entry-name');
    if (selection !== 'Wild type · all chains · 5–7 · highlight') throw new Error('selection row: ' + selection);
    console.log('       "' + readout + '" · "' + where + '" · "' + selection + '"');
  } finally { await fresh.close(); }
});
await step('every Remove names its row, and Rename, Emphasise, Reset, the builder\'s tick and arrows and a domain\'s scope keep the keyboard focus', async () => {
  /* Each rebuilt its list and dropped the focus on the page; Remove was read out as just "Remove". */
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    const focused = () => fresh.evaluate(() => { const el = document.activeElement; return el && el !== document.body ? (el.getAttribute('aria-label') || el.textContent || el.tagName).trim() : 'the page'; });
    const pressOn = async (selector, key = 'Enter') => { await fresh.focus(selector); await fresh.keyboard.press(key); await fresh.waitForTimeout(300); };
    const named = await fresh.evaluate(() => [...document.querySelectorAll('#gpv-list .gpv-entry')].flatMap(row => [...row.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label'))));
    for (const label of ['Remove model_a.pdb', 'Colour for model_a.pdb', 'Remove model_b.pdb']) if (!named.includes(label)) throw new Error('model rows lack "' + label + '": ' + JSON.stringify(named));
    /* Models: Rename and Emphasise. */
    await fresh.click('#gpv-list [aria-label="Rename model_b.pdb"]'); await fresh.keyboard.type('Mutant'); await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(300);
    if ((await focused()) !== 'Rename model_b.pdb') throw new Error('after a rename the focus is on ' + (await focused()));
    if (!(await fresh.locator('#gpv-list [aria-label="Remove Mutant"]').count())) throw new Error('Remove does not follow the rename');
    await pressOn('#gpv-list [aria-label="Emphasise model_a.pdb"]');
    if ((await focused()) !== 'Emphasise model_a.pdb') throw new Error('after Emphasise the focus is on ' + (await focused()));
    /* A label row: Remove named, and Reset (which greys itself out) hands the focus to Show. */
    await freshGoTo(fresh, 'B:12'); await fresh.click('#gpv-add-label'); await fresh.waitForTimeout(300);
    const labelRow = '#gpv-label-list .gpv-entry';
    if (!(await fresh.locator(labelRow + ' [aria-label="Remove the label on ALA12 · chain B"]').count())) throw new Error('the label row\'s Remove is not named');
    await fresh.click(labelRow + ' [aria-label="Move label right"]'); await fresh.waitForTimeout(200);
    await pressOn(labelRow + ' button:has-text("Reset")');
    if ((await focused()) !== 'Show' || !(await fresh.evaluate(() => document.activeElement.closest('#gpv-label-list')))) throw new Error('after the label\'s Reset the focus is on ' + (await focused()));
    /* A selection row's Remove. */
    await fresh.fill('#gpv-selection-chain', 'A'); await fresh.fill('#gpv-selection-range', '5-7'); await fresh.click('#gpv-add-selection'); await fresh.waitForTimeout(300);
    const selectionRemove = await fresh.locator('#gpv-selection-list .gpv-entry button:has-text("Remove")').last().getAttribute('aria-label');
    if (!/^Remove the selection .* · chain A · 5–7 · highlight$/.test(selectionRemove || '')) throw new Error('the selection row\'s Remove reads ' + selectionRemove);
    /* A measurement row: Reset hands the focus to Show too. */
    await freshGoTo(fresh, 'A:5'); await freshFocusStage(fresh); await fresh.keyboard.press('m'); await fresh.waitForTimeout(200);
    await freshGoTo(fresh, 'A:9');
    const measurementRow = '#gpv-measurement-list .gpv-entry';
    if (!(await fresh.locator(measurementRow).count())) throw new Error('setup: Measure to… made no measurement');
    await fresh.locator(measurementRow + ' [aria-label="Move the text right"]').last().click(); await fresh.waitForTimeout(200);
    await fresh.locator(measurementRow + ' button:has-text("Reset")').last().focus(); await fresh.keyboard.press('Enter'); await fresh.waitForTimeout(300);
    if ((await focused()) !== 'Show' || !(await fresh.evaluate(() => document.activeElement.closest('#gpv-measurement-list')))) throw new Error('after the measurement\'s Reset the focus is on ' + (await focused()));
    /* A domain's scope. */
    await fresh.fill('#gpv-domain-name', 'N-lobe'); await fresh.fill('#gpv-domain-range', '1-15'); await fresh.selectOption('#gpv-domain-scope', 'source'); await fresh.click('#gpv-add-domain'); await fresh.waitForTimeout(300);
    const scope = fresh.locator('#gpv-domain-list .gpv-entry [aria-label="Where the domain applies"]').first();
    await scope.focus(); await scope.selectOption('model'); await fresh.waitForTimeout(300);
    if ((await focused()) !== 'Where the domain applies') throw new Error('after a scope change the focus is on ' + (await focused()));
    /* The figure builder: the tick, then ↓ on the first view, which moves it last; ↓ is then off, so ↑ takes the focus. */
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.waitForTimeout(200);
    for (const name of ['One', 'Two']) { await fresh.fill('#gpv-view-name', name); await fresh.click('#gpv-save-view'); await fresh.waitForTimeout(300); }
    await pressOn('#gpv-builder-rows [aria-label="Include One in the figure"]', 'Space');
    if ((await focused()) !== 'Include One in the figure') throw new Error('after the tick the focus is on ' + (await focused()));
    await pressOn('#gpv-builder-rows [aria-label="Move down One"]');
    const order = await fresh.evaluate(() => window.__viewerDebug.savedViews().map(view => view.name).join());
    if (order !== 'Two,One') throw new Error('setup: views ordered ' + order);
    if ((await focused()) !== 'Move up One') throw new Error('after moving One down the focus is on ' + (await focused()));
    console.log('       focus kept through Rename, Emphasise, two Resets, a scope change, the tick and ↓');
  } finally { await fresh.close(); }
});
await step('Highlight interface and a ligand site\'s Highlight take Annotate\'s Highlight colour, as every other highlight does', async () => {
  /* Both took the colour beside Confidence → Interfaces, in another tab. */
  const fresh = await freshViewer([experimentalFile('2hhb.cif')]);
  try {
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.locator('#gpv-selection-color').fill('#12ab34'); await fresh.waitForTimeout(100);
    const colours = () => fresh.evaluate(() => window.__viewerDebug.selectionRecords().map(record => record.color));
    await fresh.click('[data-gpv-tab="compare"]');
    await fresh.selectOption('#gpv-contact-a', 'A'); await fresh.selectOption('#gpv-contact-b', 'B'); await fresh.click('#gpv-contact-run'); await fresh.waitForTimeout(800);
    await fresh.click('#gpv-contact-highlight'); await fresh.waitForTimeout(400);
    let seen = await colours();
    if (!seen.length || seen.some(colour => colour !== '#12ab34')) throw new Error('Highlight interface: ' + JSON.stringify(seen));
    const before = seen.length;
    await fresh.click('[data-gpv-tab="confidence"]'); await fresh.click('#gpv-site-run'); await fresh.waitForTimeout(1500);
    await fresh.locator('#gpv-site-rows button:has-text("Highlight"):not([disabled])').first().click(); await fresh.waitForTimeout(400);
    seen = await colours();
    if (seen.length <= before || seen.some(colour => colour !== '#12ab34')) throw new Error('ligand site Highlight: ' + JSON.stringify(seen));
    console.log('       ' + before + ' interface and ' + (seen.length - before) + ' site selections in #12ab34');
  } finally { await fresh.close(); }
});
await step('with nothing loaded, Start measuring and Clear measurements are greyed out, and Start measuring comes on with a model', async () => {
  /* Start measuring answered a click on an empty page with "Load a model first"; it is now off until
     there is something to measure, as Start drawing is. */
  const fresh = await freshViewer();
  try {
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.waitForTimeout(150);
    if (!(await fresh.isDisabled('#gpv-clear-measurements'))) throw new Error('Clear measurements is enabled on an empty page');
    if (!(await fresh.isDisabled('#gpv-measure'))) throw new Error('Start measuring is enabled on an empty page');
    await fresh.setInputFiles('#gpv-files', [models[0]]); await fresh.waitForTimeout(2000);
    if (await fresh.isDisabled('#gpv-measure')) throw new Error('Start measuring stayed off with a model loaded');
  } finally { await fresh.close(); }
});
await step('the 5CHA page closes', async () => { if (chaPage && !chaPage.isClosed()) await chaPage.close(); chaPage = null; });

/* ---- Appearance and the keyboard on the main page ---- */
await step('Sequence spectrum colours each chain blue at its N-terminus to red at its C-terminus, the strip\'s letters the same, the legend naming the ends, with no console warning', async () => {
  const startMode = await page.inputValue('#gpv-color-mode');
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  const warnings = [];
  const listen = message => { if (message.type() === 'warning' && /colorscheme/i.test(message.text())) warnings.push(message.text()); };
  page.on('console', listen);
  const letters = page.locator('#gpv-sequence-text');
  const wasOpen = await letters.evaluate(details => details.open);
  try {
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'spectrum'); await page.waitForTimeout(600);
    if (!wasOpen) { await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(500); }
    const seen = await page.evaluate(() => {
      const d = window.__viewerDebug; const entry = d.activeEntry();
      const options = d.colorOptions(entry);
      if (typeof options.colorfunc !== 'function') return { error: 'no colour function: ' + JSON.stringify(options) };
      const chain = [...new Set(entry.atoms.filter(atom => atom.atom === 'CA').map(atom => atom.chain || ''))].sort()[0];
      const alpha = entry.atoms.filter(atom => atom.atom === 'CA' && (atom.chain || '') === chain).sort((a, b) => a.resi - b.resi);
      const first = options.colorfunc(alpha[0]); const last = options.colorfunc(alpha[alpha.length - 1]);
      const hex = value => { const m = String(value).match(/\d+/g); return m ? '#' + m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') : value; };
      const spans = [...document.querySelectorAll('#gpv-sequence-letters .gpv-seq-block')[0].querySelectorAll('.gpv-aa')];
      return { chain, first, last, letterFirst: hex(spans[0].style.background), letterLast: hex(spans[spans.length - 1].style.background), title: document.querySelector('#gpv-sequence-title').textContent };
    });
    if (seen.error) throw new Error(seen.error);
    const rgb = value => [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16));
    const [r1, , b1] = rgb(seen.first); const [r2, , b2] = rgb(seen.last);
    if (!(b1 > r1 + 100 && r2 > b2 + 100)) throw new Error('chain ' + seen.chain + ' runs ' + seen.first + ' → ' + seen.last + ', not blue to red');
    if (seen.letterFirst !== seen.first || seen.letterLast !== seen.last) throw new Error('the strip letters read ' + seen.letterFirst + ' → ' + seen.letterLast + ', the model ' + seen.first + ' → ' + seen.last);
    if (!/sequence spectrum/.test(seen.title)) throw new Error('the strip title reads ' + seen.title);
    /* The legend under the view says which end is which (it was hidden); an export prints no key for a ramp. */
    const key = await page.evaluate(() => { const host = document.querySelector('#gpv-plddt-legend'); return { text: host.hidden ? null : host.textContent, printed: window.__viewerDebug.legendWanted('figure') }; });
    if (!key.text || !/^Sequence spectrum.*N-terminus.*C-terminus, per chain/.test(key.text)) throw new Error('the legend reads ' + key.text);
    if (key.printed) throw new Error('an export would print a key for the spectrum');
    if (warnings.length) throw new Error(warnings.length + ' console warnings: ' + warnings[0]);
    console.log('       chain ' + seen.chain + ' ' + seen.first + ' → ' + seen.last + ' on the model and the letters · no warnings');
  } finally {
    page.off('console', listen);
    if (!wasOpen && (await letters.evaluate(details => details.open))) { await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(200); }
    await tab('appearance'); await page.selectOption('#gpv-color-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  }
});
/* The fixture's twin chains sit one behind the other at the starting orientation (see the canvas steps
   above): a step that taps a residue turns the view 90° about X first and back after. */
const turnView = async back => { await focusStage(); await page.keyboard.press(back ? 'Shift+x' : 'x'); await page.waitForTimeout(400); };
await step('under distance colouring, selecting a residue replaces "Click a residue first" with the residue the colours are measured from', async () => {
  await clearSelection(); await turnView(false);
  const startMode = await page.inputValue('#gpv-color-mode');
  const startTab = await page.evaluate(() => (document.querySelector('[data-gpv-tab][aria-selected="true"]') || {}).dataset.gpvTab || 'annotate');
  try {
    await tab('appearance'); await page.selectOption('#gpv-color-mode', 'fromresidue'); await page.waitForTimeout(400);
    if (!/^Click a residue first/.test(await statusNow())) throw new Error('choosing the mode said: ' + (await statusNow()));
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(500);
    const said = await statusNow();
    if (said !== 'Coloured by distance from ' + target.text) throw new Error('after a click on ' + target.text + ' the status reads: ' + said);
    console.log('       "' + said + '"');
  } finally {
    await clearSelection(); await turnView(true);
    await tab('appearance'); await page.selectOption('#gpv-color-mode', startMode); await page.waitForTimeout(400);
    await tab(startTab);
  }
});
await step('in the light theme, accent-coloured text reads at 4.5:1: the selected tab, the current model\'s row and the card\'s count of nearby residues', async () => {
  const startTheme = await page.evaluate(() => document.documentElement.dataset.theme || '');
  await turnView(false);
  try {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.waitForTimeout(200);
    const target = await canvasResidue();
    if (!target) throw new Error('no residue on screen to tap');
    await tap(target.x, target.y); await page.waitForTimeout(400);
    const ratios = await page.evaluate(() => {
      const parse = value => { const m = String(value).match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
      const lum = ({ r, g, b }) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const back = element => { for (let e = element; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
      const ratio = element => { if (!element) return null; const a = lum(parse(getComputedStyle(element).color)); const b = lum(back(element)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      return { tab: ratio(document.querySelector('[data-gpv-tab][aria-selected="true"]')), model: ratio(document.querySelector('#gpv-list .gpv-entry.is-active')), near: ratio(document.querySelector('#gpv-residue-card-near')) };
    });
    const low = Object.entries(ratios).filter(([, value]) => value !== null && value < 4.5);
    if (low.length) throw new Error('below 4.5:1 in the light theme: ' + low.map(([name, value]) => name + ' ' + value.toFixed(2)).join(', '));
    if (ratios.tab === null || ratios.near === null) throw new Error('nothing to measure: ' + JSON.stringify(ratios));
    console.log('       ' + Object.entries(ratios).map(([name, value]) => name + ' ' + (value === null ? '—' : value.toFixed(2) + ':1')).join(' · '));
  } finally {
    await letGo(); await clearSelection(); await turnView(true);
    await page.evaluate(theme => { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme; }, startTheme);
  }
});
await step('one spelling of colour, the built figure\'s buttons named apart from the view\'s, and Backspace in the help', async () => {
  const words = await page.evaluate(() => ({
    scheme: document.querySelector('#gpv-color-mode').closest('label').firstChild.textContent.trim(),
    highlight: document.querySelector('#gpv-selection-color').closest('label').firstChild.textContent.trim(),
    builtPng: document.querySelector('#gpv-contact-sheet').textContent.trim(),
    builtSvg: document.querySelector('#gpv-builder-svg').textContent.trim(),
    viewPng: document.querySelector('#gpv-image').textContent.trim(),
    viewSvg: document.querySelector('#gpv-svg').textContent.trim(),
    help: document.querySelector('#gpv-help') ? document.querySelector('#gpv-help').textContent : document.body.textContent
  }));
  if (words.scheme !== 'Colour scheme' || words.highlight !== 'Highlight colour') throw new Error('labels read "' + words.scheme + '" and "' + words.highlight + '"');
  if (words.builtPng === words.viewPng || words.builtSvg === words.viewSvg) throw new Error('two buttons share a name: ' + JSON.stringify(words));
  if (!/Backspace/.test(words.help)) throw new Error('the help does not mention Backspace');
});
await step('the sequence letters are reached from the keyboard: one Tab stop per chain, the arrows walk the letters without changing the model, Enter picks the residue', async () => {
  await clearSelection();
  const startModel = await page.inputValue('#gpv-current');
  const letters = page.locator('#gpv-sequence-text');
  const wasOpen = await letters.evaluate(details => details.open);
  try {
    if (!wasOpen) { await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(500); }
    const stops = await page.evaluate(() => [...document.querySelectorAll('#gpv-sequence-letters .gpv-seq-block')].map(block => block.querySelectorAll('.gpv-aa[tabindex="0"]').length));
    if (!stops.length || stops.some(count => count !== 1)) throw new Error('Tab stops per chain: ' + stops.join(', '));
    const first = page.locator('#gpv-sequence-letters .gpv-seq-block').first().locator('.gpv-aa').first();
    await first.focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    const focused = await page.evaluate(() => { const a = document.activeElement; const all = [...a.closest('.gpv-seq-block').querySelectorAll('.gpv-aa')]; return { index: all.indexOf(a), resi: Number(a.dataset.resi) }; });
    if (focused.index !== 2) throw new Error('two ArrowRight presses put the focus on letter ' + focused.index);
    if ((await page.inputValue('#gpv-current')) !== startModel) throw new Error('the arrows on a letter also changed the model');
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const picked = await selectedNow();
    if (!picked || picked.resi !== focused.resi) throw new Error('Enter on residue ' + focused.resi + ' selected ' + JSON.stringify(picked));
    console.log('       ' + stops.length + ' chains, one Tab stop each · → → then Enter picked residue ' + picked.resi);
  } finally {
    await letGo(); await clearSelection();
    if (!wasOpen && (await letters.evaluate(details => details.open))) { await page.click('#gpv-sequence-text summary'); await page.waitForTimeout(200); }
  }
});
await step('a per-residue table says how many rows it could not read', async () => {
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.waitForTimeout(150);
    await fresh.fill('#gpv-data-text', 'resi,value\n1,0.5\n2,0.7\n10A,0.9\n3,n/a\n4,1.1');
    await fresh.click('#gpv-data-apply'); await fresh.waitForTimeout(400);
    const said = await freshStatus(fresh);
    if (!/^[^·]*: 3 values .* · 2 rows skipped/.test(said)) throw new Error('loading 5 rows with 2 unreadable said: ' + said);
  } finally { await fresh.close(); }
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
  if (!/heuristic/.test(state)) throw new Error('the domain state does not say the segmentation is a heuristic: ' + state);
  const ranges = await page.locator('#gpv-domain-rows tr td').first().textContent();
  if (!/A:1–30/.test(ranges || '')) throw new Error('domain 1 ranges: ' + ranges);
  await page.click('#gpv-domain-color'); await page.waitForTimeout(500);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Domain 1/.test(legend) || !/Domain 2/.test(legend) || !/heuristic/.test(legend)) throw new Error('legend: ' + legend);
  const before = await page.locator('#gpv-selection-list .gpv-entry').count();
  await page.click('#gpv-domain-highlight'); await page.waitForTimeout(500);
  if ((await page.locator('#gpv-selection-list .gpv-entry').count()) !== before + 2) throw new Error('highlight all did not add two selections');
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('confidence');
});
await step('domain labels sit at the domain centroids and the architecture bar exports as SVG and PNG', async () => {
  await tab('confidence');
  const before = await page.locator('#gpv-label-list .gpv-entry').count();
  await page.click('#gpv-pae-domain-labels'); await page.waitForTimeout(500);
  const texts = await page.locator('#gpv-label-list .gpv-entry input[type="text"]').evaluateAll(inputs => inputs.map(input => input.value));
  if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== before + 2 || !texts.includes('D1') || !texts.includes('D2')) throw new Error('domain labels: ' + JSON.stringify(texts));
  const state = (await page.locator('#gpv-state').textContent()) || '';
  if (!/2 domain labels placed at the domain centroids/.test(state)) throw new Error('state: ' + state);
  const model = await page.evaluate(() => { const d = window.__viewerDebug; const m = d.architectureModel(d.activeEntry()); return m && { source: m.source, chains: m.chains.map(row => row.chain + ':' + row.first + '-' + row.last + ':' + row.segments.map(s => s.item.name + s.start + '-' + s.end).join(',')) }; });
  if (!model || model.source !== 'pae' || model.chains.length !== 2 || model.chains[0] !== 'A:1-30:D11-30' || model.chains[1] !== 'B:1-30:D21-30') throw new Error('architecture model: ' + JSON.stringify(model));
  await tab('annotate');
  let download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-architecture-svg');
  const svg = await readFile(await (await download).path(), 'utf8');
  if (!/id="architecture"/.test(svg) || !/>Chain A</.test(svg) || !/>Chain B</.test(svg) || !/>D1</.test(svg) || !/>D2</.test(svg) || !/>30</.test(svg)) throw new Error('architecture SVG lacks rows, names or residue numbers');
  const estimate = (await page.locator('#gpv-export-estimate').textContent()) || ''; const expectedWidth = Number((estimate.match(/^(\d+) ×/) || [])[1]);
  download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-architecture-png');
  const png = await readFile(await (await download).path());
  if (png.readUInt32BE(16) !== expectedWidth || png.readUInt32BE(20) < 60) throw new Error('architecture PNG ' + png.readUInt32BE(16) + ' × ' + png.readUInt32BE(20) + ' for an estimate of ' + estimate);
  await tab('publish');
  if (await page.locator('#gpv-composite-architecture').isDisabled()) throw new Error('the composite figure does not offer the architecture panel although domains exist');
  await page.check('#gpv-builder-architecture'); await page.waitForTimeout(200);
  const builderState = (await page.locator('#gpv-builder-estimate').textContent()) || '';
  if (!/Save a view|architecture row/.test(builderState)) throw new Error('builder estimate: ' + builderState);
  await page.uncheck('#gpv-builder-architecture');
  await tab('annotate'); await page.click('#gpv-domain-labels-clear'); await page.waitForTimeout(300);
  if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== before) throw new Error('clear domain labels left ' + (await page.locator('#gpv-label-list .gpv-entry').count()) + ' labels');
  await tab('confidence');
  console.log('       D1 and D2 labelled at their centroids · architecture bar: 2 chains, SVG rows and numbers, PNG ' + expectedWidth + ' px wide');
});
await step('figure labels rename the legend on screen, in the SVG, in the legend text and in the scene', async () => {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'domain'); await page.waitForTimeout(400);
  await page.click('#gpv-legend-edit'); await page.waitForTimeout(400);
  if (await page.locator('[data-gpv-panel="publish"]').isHidden()) throw new Error('the legend button did not open the Publish tab');
  if (await page.locator('#gpv-labels-wrap').isHidden()) throw new Error('the labels editor is hidden');
  const defaults = await page.locator('#gpv-labels-rows th').allTextContents();
  if (defaults.length !== 3 || !/PAE domains \(heuristic\)/.test(defaults[0]) || defaults[1].trim() !== 'D1' || defaults[2].trim() !== 'D2') throw new Error('rows: ' + JSON.stringify(defaults));
  await page.fill('#gpv-labels-rows input[data-gpv-label-key="domain|title"]', 'Lobes');
  await page.fill('#gpv-labels-rows input[data-gpv-label-key="domain|D1"]', 'N-lobe'); await page.locator('#gpv-labels-rows input[data-gpv-label-key="domain|D1"]').blur(); await page.waitForTimeout(300);
  const legend = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/Lobes/.test(legend) || !/N-lobe · A:1–30/.test(legend) || !/Domain 2 · /.test(legend) || /Domain 1 · /.test(legend)) throw new Error('screen legend: ' + legend);
  const state = (await page.locator('#gpv-labels-state').textContent()) || '';
  if (!/2 custom labels/.test(state)) throw new Error('state: ' + state);
  const scene = await page.evaluate(() => window.__viewerDebug.sceneSettings().figureLabels);
  if (!scene || scene['domain|D1'] !== 'N-lobe' || scene['domain|title'] !== 'Lobes') throw new Error('scene labels: ' + JSON.stringify(scene));
  await page.click('#gpv-figure-legend'); await page.waitForTimeout(300);
  const text = await page.inputValue('#gpv-legend-text');
  if (!/legend: Lobes — N-lobe, D2/.test(text)) throw new Error('legend text lacks the custom names: ' + text.slice(0, 200));
  const download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-svg');
  const svg = await readFile(await (await download).path(), 'utf8');
  if (!/>Lobes</.test(svg) || !/>N-lobe</.test(svg) || />D1</.test(svg)) throw new Error('SVG legend did not use the custom labels');
  await page.click('#gpv-labels-reset'); await page.waitForTimeout(300);
  const restored = (await page.locator('#gpv-plddt-legend').textContent()) || '';
  if (!/PAE domains \(heuristic\)/.test(restored) || !/Domain 1 · A:1–30/.test(restored) || /N-lobe/.test(restored)) throw new Error('reset did not restore the defaults: ' + restored);
  if (await page.evaluate(() => Object.keys(window.__viewerDebug.sceneSettings().figureLabels).length)) throw new Error('scene still carries labels after reset');
  await page.click('#gpv-labels-edit'); await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300); await tab('confidence');
  console.log('       title Lobes · D1 → N-lobe · SVG, legend text and scene followed · reset restored the defaults');
});
await step('an AlphaFold 3 full_data file is scanned byte by byte: PAE kept as Float32 rows, contact matrix skipped', async () => {
  const size = 60;
  const pae = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => Math.round(Math.abs(i - j) * 37) / 100));
  const contact = Array.from({ length: size }, () => Array.from({ length: size }, (_, j) => (j % 7 === 0 ? 0.9 : 0.01)));
  const chains = Array.from({ length: size }, (_, i) => (i < 30 ? 'A' : 'B')); const resi = Array.from({ length: size }, (_, i) => (i % 30) + 1);
  const file = join(work, 'model_b.json');
  await writeFile(file, JSON.stringify({ atom_chain_ids: chains, atom_plddts: resi, contact_probs: contact, pae, token_chain_ids: chains, token_res_ids: resi }));
  await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const entry = window.__viewerDebug.entries().find(item => /model_b/.test(item.name)); const matrix = entry && entry.confidence && entry.confidence.pae;
    return matrix ? { rows: matrix.length, typed: ArrayBuffer.isView(matrix[0]), value: matrix[3][10], max: entry.confidence.paeMaximum, chains: entry.confidence.tokenChainIds.length } : null;
  });
  if (!info) throw new Error('PAE not attached to model_b');
  if (info.rows !== 60 || !info.typed || info.chains !== 60) throw new Error(JSON.stringify(info));
  if (Math.abs(info.value - 2.59) > 1e-5 || Math.abs(info.max - 21.83) > 1e-5) throw new Error('values ' + info.value + ' ' + info.max);
  await page.evaluate(() => { const select = document.querySelector('#gpv-current'); const option = [...select.options].find(item => /model_b/.test(item.textContent)); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600); await tab('confidence');
  if (!(await page.locator('#gpv-pae-plot').isVisible())) throw new Error('PAE heatmap hidden for model_b');
  console.log('       60 × 60 PAE as Float32Array rows · maximum ' + info.max.toFixed(2) + ' Å · heatmap drawn');
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
  if (!/Download figure PNG/.test(label)) throw new Error('label not restored: ' + label);
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
await step('the figure builder composes the ticked views into one lettered figure at the output width, PNG and SVG', async () => {
  await tab('publish');
  const rows = page.locator('#gpv-builder-rows tr');
  if ((await rows.count()) !== 6) throw new Error('builder rows: ' + (await rows.count()));
  /* Whatever happens below, put the export controls back so the next steps find them. */
  const restore = async () => { for (const index of [3, 4, 5]) await rows.nth(index).locator('input[type="checkbox"]').check(); await page.selectOption('#gpv-panel-columns', '2'); await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200); };
  try {
  for (const index of [3, 4, 5]) await rows.nth(index).locator('input[type="checkbox"]').uncheck();
  await rows.nth(2).locator('button[aria-label^="Move up"]').click(); await page.waitForTimeout(200);
  const order = await page.locator('#gpv-builder-rows th').allTextContents();
  if (order.slice(0, 3).join('|') !== 'View 1|View 3|View 2') throw new Error('order after move: ' + order.join('|'));
  const letters = await page.locator('#gpv-builder-rows .gpv-builder-letter').allTextContents();
  if (letters.join('') !== 'ABC———') throw new Error('letters: ' + letters.join(','));
  await page.fill('#gpv-builder-rows tr:nth-child(2) input[type="text"]', 'Interface close-up'); await page.waitForTimeout(200);
  await page.selectOption('#gpv-panel-columns', '3');
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '178'); await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '8'); await page.waitForTimeout(300);
  const estimate = (await page.locator('#gpv-builder-estimate').textContent()) || '';
  if (!/3 panels · 3 columns · 2100 × \d+ px · 178 mm wide at 300 dpi/.test(estimate)) throw new Error('estimate: ' + estimate);
  const scene = await page.evaluate(() => window.__viewerDebug.sceneSettings().figureBuilder);
  if (!scene || scene.columns !== '3' || scene.letters !== true) throw new Error('scene builder options: ' + JSON.stringify(scene));
  const pngDownload = page.waitForEvent('download', { timeout: 300000 }); await page.click('#gpv-contact-sheet');
  const png = await readFile(await (await pngDownload).path());
  const width = png.readUInt32BE(16); const height = png.readUInt32BE(20);
  /* Three 700 px cells in one row at the 3:2 aspect: 466 px of image plus a caption strip of up to
     three lines (about 158 px at 8 pt; captions wrapped onto two lines before 2.52.0). */
  if (width !== 2100 || height < 500 || height > 640 || !png.includes('pHYs')) throw new Error('figure PNG ' + width + ' × ' + height + (png.includes('pHYs') ? '' : ' without dpi'));
  const svgDownload = page.waitForEvent('download', { timeout: 300000 }); await page.click('#gpv-builder-svg');
  const svg = await readFile(await (await svgDownload).path(), 'utf8');
  const images = (svg.match(/<image /g) || []).length;
  if (images !== 3 || !/>A</.test(svg) || !/>B</.test(svg) || !/>C</.test(svg) || !/Interface close-up/.test(svg)) throw new Error('figure SVG: ' + images + ' images · ' + svg.slice(0, 120));
  if (svg.indexOf('View 1') > svg.indexOf('View 3') || svg.indexOf('View 3') > svg.indexOf('View 2')) throw new Error('SVG panel order does not follow the builder');
  console.log('       3 of 6 views · 3 columns · PNG ' + width + ' × ' + height + ' at 300 dpi · SVG with 3 panels and vector captions');
  } finally { await restore(); }
});
await step('a legend too wide for its panel wraps onto more rows instead of running off the edge', async () => {
  await tab('publish');
  const colour = await page.inputValue('#gpv-color-mode');
  /* Whatever happens below, put the colour scheme and the output size back for the next steps. */
  const restore = async () => {
    /* The custom width only exists while it is the chosen width, so put it back first. */
    if (await page.locator('#gpv-print-custom').isVisible()) await page.fill('#gpv-print-custom', '120');
    await page.selectOption('#gpv-print-width', '178');
    await page.selectOption('#gpv-export-mode', 'pixels');
    await tab('appearance'); await page.selectOption('#gpv-color-mode', colour); await page.waitForTimeout(300); await tab('publish');
  };
  try {
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(400); await tab('publish');
  /* A 35 mm figure at 8 pt: the four pLDDT bands and their title need about 450 px on one line
     and the panel gives 279, which the 55 % shrink floor alone cannot close. */
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', 'custom');
  await page.fill('#gpv-print-custom', '35'); await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '8');
  await page.waitForTimeout(400);
  const measured = await page.evaluate(() => {
    const debug = window.__viewerDebug; const requested = debug.exportDimensions();
    const layout = debug.furnitureLayout(requested.width, requested.height, debug.figureScale(requested), null, debug.figurePalette(), true);
    const metrics = debug.legendMetrics(document.createElement('canvas').getContext('2d'), layout.legendScale, 'figure', layout.vertical, layout.legendAvailable);
    return { figure: { width: requested.width, height: requested.height }, available: layout.legendAvailable, left: layout.legendX - metrics.gap, right: layout.legendX + metrics.width,
      top: layout.legendY + metrics.top, bottom: layout.legendY + metrics.top + metrics.height, width: metrics.width, height: metrics.height, oneRow: metrics.swatch * 2,
      rows: metrics.rows.map(row => row.cells.map(cell => cell.text)) };
  });
  if (measured.width > measured.available) throw new Error('the legend is wider than the room it has: ' + measured.width.toFixed(0) + ' px in ' + measured.available);
  if (measured.rows.length < 2 || measured.height <= measured.oneRow) throw new Error('the legend did not wrap: ' + JSON.stringify(measured.rows) + ' · height ' + measured.height);
  if (measured.left < 0 || measured.right > measured.figure.width || measured.top < 0 || measured.bottom > measured.figure.height) throw new Error('the wrapped legend box leaves the panel: ' + JSON.stringify(measured));
  const download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-svg');
  const svg = await readFile(await (await download).path(), 'utf8');
  const group = (svg.match(/<g id="legend">[\s\S]*?<\/g>/) || [''])[0];
  if (!group) throw new Error('the SVG carries no legend group');
  const box = (group.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)"/) || []).slice(1).map(Number);
  const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const labels = [...group.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]), text: unescape(match[3]) }));
  if (box[0] + box[2] > measured.figure.width) throw new Error('the SVG legend box runs past the panel: ' + (box[0] + box[2]).toFixed(0) + ' > ' + measured.figure.width);
  if (labels.some(label => label.x < box[0] || label.x >= box[0] + box[2])) throw new Error('an SVG label starts outside the legend box: ' + JSON.stringify(labels));
  /* The SVG must be the very rows the metrics reported — same wrapping, same ellipses as the PNG. */
  if (labels.map(label => label.text).join('|') !== measured.rows.flat().join('|')) throw new Error('SVG labels ' + JSON.stringify(labels.map(label => label.text)) + ' do not match the measured rows ' + JSON.stringify(measured.rows));
  const drawn = labels.map(label => label.text);
  for (const wanted of ['pLDDT', '<50', '50–70', '70–90', '≥90']) {
    if (!drawn.some(text => text === wanted || (text.endsWith('…') && wanted.startsWith(text.slice(0, -1))))) throw new Error('“' + wanted + '” is missing from the legend: ' + JSON.stringify(drawn));
  }
  if (new Set(labels.map(label => label.y)).size !== measured.rows.length) throw new Error('the SVG legend rows do not match the metrics: ' + JSON.stringify(labels.map(label => label.y)));
  console.log('       ' + measured.figure.width + ' px panel · ' + measured.rows.length + ' rows in ' + measured.width.toFixed(0) + ' of ' + measured.available + ' px · ' + measured.rows.map(row => row.join(' ')).join(' / '));
  } finally { await restore(); }
});
await step('a figure template saves the whole presentation and puts it back over changed controls', async () => {
  await tab('publish');
  const rows = page.locator('#gpv-builder-rows tr');
  /* Whatever happens below, leave the builder and export controls exactly as this step found them:
     six views ticked, two columns, pixel output at 178 mm / 300 dpi / 8 pt behind it. */
  const restore = async () => {
    for (const index of [3, 4, 5]) await rows.nth(index).locator('input[type="checkbox"]').check();
    await page.selectOption('#gpv-panel-columns', '2');
    await page.selectOption('#gpv-builder-captions', 'both');
    await page.check('#gpv-builder-letters'); await page.check('#gpv-builder-legends');
    await page.selectOption('#gpv-export-mode', 'print');
    await page.selectOption('#gpv-print-width', '178'); await page.selectOption('#gpv-print-dpi', '300'); await page.selectOption('#gpv-print-text', '8');
    await page.selectOption('#gpv-export-mode', 'pixels');
    await page.fill('#gpv-template-name', '');
    await page.evaluate(() => { try { localStorage.removeItem('protein-structure-viewer:figure-templates'); } catch (error) { /* private mode */ } });
    await page.waitForTimeout(200);
  };
  try {
  /* A configuration nothing else in the suite uses, so nothing can pass by accident. */
  await page.selectOption('#gpv-export-mode', 'print');
  await page.selectOption('#gpv-panel-columns', '3');
  await page.selectOption('#gpv-builder-captions', 'name');
  await page.uncheck('#gpv-builder-letters'); await page.uncheck('#gpv-builder-legends');
  await page.selectOption('#gpv-print-width', '85'); await page.selectOption('#gpv-print-dpi', '600');
  await page.waitForTimeout(300);
  await page.fill('#gpv-template-name', 'Main figures');
  if (await page.isDisabled('#gpv-template-save')) throw new Error('Save is still disabled with a name typed');
  await page.click('#gpv-template-save'); await page.waitForTimeout(300);
  if ((await page.locator('#gpv-template-list').inputValue()) !== 'Main figures') throw new Error('the saved template is not selected');

  /* Every control the template holds now goes somewhere else — the print fields first, while the
     print mode still shows them. */
  await page.selectOption('#gpv-panel-columns', '1');
  await page.selectOption('#gpv-builder-captions', 'caption');
  await page.check('#gpv-builder-letters'); await page.check('#gpv-builder-legends');
  await page.selectOption('#gpv-print-width', '178'); await page.selectOption('#gpv-print-dpi', '300');
  await page.selectOption('#gpv-export-mode', 'pixels');
  await page.waitForTimeout(300);
  const changed = await page.evaluate(() => ({
    columns: document.querySelector('#gpv-panel-columns').value, captions: document.querySelector('#gpv-builder-captions').value,
    letters: document.querySelector('#gpv-builder-letters').checked, legends: document.querySelector('#gpv-builder-legends').checked,
    mode: document.querySelector('#gpv-export-mode').value, width: document.querySelector('#gpv-print-width').value, dpi: document.querySelector('#gpv-print-dpi').value
  }));
  if (changed.columns !== '1' || changed.captions !== 'caption' || !changed.letters || !changed.legends
    || changed.mode !== 'pixels' || changed.width !== '178' || changed.dpi !== '300') throw new Error('controls did not change: ' + JSON.stringify(changed));

  await page.selectOption('#gpv-template-list', 'Main figures');
  await page.click('#gpv-template-apply'); await page.waitForTimeout(400);
  const applied = await page.evaluate(() => ({
    columns: document.querySelector('#gpv-panel-columns').value, captions: document.querySelector('#gpv-builder-captions').value,
    letters: document.querySelector('#gpv-builder-letters').checked, legends: document.querySelector('#gpv-builder-legends').checked,
    mode: document.querySelector('#gpv-export-mode').value, width: document.querySelector('#gpv-print-width').value, dpi: document.querySelector('#gpv-print-dpi').value,
    scene: window.__viewerDebug.sceneSettings().figureTemplate
  }));
  if (applied.columns !== '3' || applied.captions !== 'name' || applied.letters || applied.legends || applied.mode !== 'print' || applied.width !== '85' || applied.dpi !== '600') throw new Error('applied template: ' + JSON.stringify(applied));
  if (!applied.scene || applied.scene['#gpv-print-width'] !== '85') throw new Error('scene lacks the figure template: ' + JSON.stringify(applied.scene));
  const estimate = (await page.locator('#gpv-builder-estimate').textContent()) || '';
  /* 85 mm at 600 dpi is 2008 px, three cells of 669 px. */
  if (!/3 columns · 2007 × \d+ px · 85 mm wide at 600 dpi · text 8 pt/.test(estimate)) throw new Error('estimate after apply: ' + estimate);

  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('protein-structure-viewer:figure-templates') || 'null'); } catch (error) { return null; } });
  if (!Array.isArray(stored) || stored.length !== 1 || stored[0].name !== 'Main figures' || !stored[0].created) throw new Error('stored templates: ' + JSON.stringify(stored));
  const saved = stored[0].settings;
  if (saved['#gpv-panel-columns'] !== '3' || saved['#gpv-builder-captions'] !== 'name' || saved['#gpv-builder-letters'] !== false || saved['#gpv-builder-legends'] !== false
    || saved['#gpv-export-mode'] !== 'print' || saved['#gpv-print-width'] !== '85' || saved['#gpv-print-dpi'] !== '600') throw new Error('stored settings: ' + JSON.stringify(saved));
  /* A template is presentation only: nothing about the data may be in the stored record. */
  if (/camera|savedViews|models|View 1/.test(JSON.stringify(stored))) throw new Error('the stored template carries data: ' + JSON.stringify(stored));

  /* Delete asks first: a template is not in the undo history. No keeps it, Yes deletes it. */
  let asked = '';
  page.once('dialog', dialog => { asked = dialog.message(); dialog.dismiss(); });
  await page.click('#gpv-template-delete'); await page.waitForTimeout(300);
  if (!/Delete the figure template "Main figures"/.test(asked)) throw new Error('Delete did not ask first: ' + JSON.stringify(asked));
  if ((await page.locator('#gpv-template-list option').allTextContents()).join('|') === 'No templates yet') throw new Error('answering No deleted the template anyway');
  page.once('dialog', dialog => dialog.accept());
  await page.click('#gpv-template-delete'); await page.waitForTimeout(300);
  const options = await page.locator('#gpv-template-list option').allTextContents();
  if (options.length !== 1 || options[0] !== 'No templates yet') throw new Error('template list after delete: ' + options.join('|'));
  if (!(await page.isDisabled('#gpv-template-apply')) || !(await page.isDisabled('#gpv-template-delete'))) throw new Error('Apply or Delete is still enabled with nothing selected');
  console.log('       saved 3 columns · captions name · no letters or legends · 85 mm at 600 dpi · applied over changed controls · stored and deleted');
  } finally { await restore(); }
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
  /* Give the report something to carry: outline, depth cueing, a faded chain and a contact map. */
  await tab('appearance'); await page.selectOption('#gpv-outline', 'bold'); await page.check('#gpv-fog');
  await tab('models'); await page.locator('#gpv-chain-rows input[aria-label="Fade chain B"]').check(); await page.waitForTimeout(300);
  await tab('compare'); await page.fill('#gpv-contact-cutoff', '6'); await page.click('#gpv-contact-run'); await page.waitForTimeout(500);
  await tab('publish');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-report');
  reportPath = join(work, 'report.html');
  await (await download).saveAs(reportPath);
  const html = await readFile(reportPath, 'utf8');
  if (!/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol/.test(html)) throw new Error('report lost its 3Dmol tag');
  await writeFile(join(work, 'report-local.html'), html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol\/[^']+/, 'vendor/3Dmol-min.js'));

  await tab('appearance'); await page.selectOption('#gpv-outline', 'none'); await page.uncheck('#gpv-fog');
  await tab('models'); await page.locator('#gpv-chain-rows input[aria-label="Fade chain B"]').uncheck(); await page.waitForTimeout(300);
});

/* ---- Stress loop, round 1, batch 2: exports, publish and scenes (2.52.0) ----
   Each on a page of its own, so nothing here depends on, or leaves anything for, the main page. */
for (const deviceScaleFactor of [1, 2]) {
  await step('with no legend or scale bar a print PNG is the planned size, not twice it (device pixel ratio ' + deviceScaleFactor + ')', async () => {
    /* 3Dmol draws its canvas at twice the page's pixel ratio below 2, and before this fix only a figure
       with a legend or a scale bar was drawn back to the plan: an 85 mm, 300 dpi PNG came out
       2008 × 1338 px with 300 dpi written in it, so it printed 170 mm wide. */
    const fresh = await freshViewer([experimentalFile('5cha.cif')], { deviceScaleFactor });
    try {
      await printPlan(fresh, '85', '300');
      await fresh.uncheck('#gpv-export-legend'); await fresh.selectOption('#gpv-scale-bar', '0'); await fresh.waitForTimeout(200);
      const ratio = await fresh.evaluate(() => window.devicePixelRatio);
      if (ratio !== deviceScaleFactor) throw new Error('setup: devicePixelRatio ' + ratio);
      const png = pngSize(await freshDownload(fresh, '#gpv-image'));
      if (png.width !== 1004 || png.height !== 669 || png.dpi !== 300) throw new Error('PNG ' + png.width + ' × ' + png.height + ' at ' + png.dpi + ' dpi for an 85 mm, 300 dpi plan of 1004 × 669');
      if (deviceScaleFactor === 1) {
        /* The PDF page is the image at the plan's dpi, so it doubled too — and its status contradicted itself. */
        await fresh.selectOption('#gpv-image-format', 'pdf'); await fresh.waitForTimeout(200);
        const pdf = (await freshDownload(fresh, '#gpv-image', 180000)).toString('latin1');
        const box = (pdf.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []).slice(1).map(Number);
        if (Math.abs(box[0] / 72 * 25.4 - 85) > 0.5) throw new Error('PDF page ' + (box[0] / 72 * 25.4).toFixed(1) + ' mm wide for an 85 mm figure');
        if (!/page 85 × 57 mm/.test(await freshStatus(fresh))) throw new Error('PDF status: ' + await freshStatus(fresh));
      }
      console.log('       ' + png.width + ' × ' + png.height + ' at ' + png.dpi + ' dpi, device pixel ratio ' + ratio);
    } finally { await fresh.close(); }
  });
}
await step('a print figure past the GPU’s canvas limit is rendered at the most it allows, at the stated width, and says so', async () => {
  /* 178 mm at 600 dpi is a 4205 px plan and an 8410 px canvas: past the 8192 px a software renderer
     or an integrated GPU allows, the PNG came out black with only the labels, and the status said
     "downloaded". The limit is lowered through the debug hook so CI never asks for an 8 000 px render. */
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    await fresh.evaluate(() => window.__viewerDebug.setExportGpuLimit(2000));
    await printPlan(fresh, '178', '600');
    const plan = await fresh.evaluate(() => window.__viewerDebug.exportDimensions());
    const ratio = await fresh.evaluate(() => (window.devicePixelRatio < 2 ? window.devicePixelRatio * 2 : window.devicePixelRatio));
    if (!plan.gpuLimited || Math.max(plan.width, plan.height) * ratio > 2000) throw new Error('plan not fitted to the limit: ' + JSON.stringify(plan));
    const estimate = (await fresh.locator('#gpv-export-estimate').textContent()) || '';
    if (!new RegExp('at ' + plan.dpi + ' dpi.*600 dpi asked · rendered at ' + plan.dpi + ' dpi, the most this GPU allows for 178 mm').test(estimate)) throw new Error('estimate: ' + estimate);
    const png = pngSize(await freshDownload(fresh, '#gpv-image'));
    const status = await freshStatus(fresh);
    if (png.width !== plan.width || png.height !== plan.height || png.dpi !== plan.dpi) throw new Error('PNG ' + JSON.stringify(png) + ' for plan ' + plan.width + ' × ' + plan.height + ' at ' + plan.dpi + ' dpi');
    /* The physical width is kept: the dpi written is the one the pixels have. */
    if (Math.abs(png.width / png.dpi * 25.4 - 178) > 1) throw new Error('prints ' + (png.width / png.dpi * 25.4).toFixed(1) + ' mm wide, not 178');
    if (!new RegExp('Figure PNG downloaded · ' + plan.width + ' × ' + plan.height + ' at ' + plan.dpi + ' dpi \\(178 mm wide\\) · rendered at ' + plan.dpi + ' dpi, the most this GPU allows for 178 mm').test(status)) throw new Error('status: ' + status);
    console.log('       limit 2000 px · ' + png.width + ' × ' + png.height + ' at ' + png.dpi + ' dpi · ' + status.replace(/^.*· rendered/, 'rendered'));
  } finally { await fresh.close(); }
});
await step('Copy PNG renders the way the download does and states the size it copied, capped by the GPU', async () => {
  /* It rendered without the retry the downloads have and stated the size asked for, not the size made. */
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    await fresh.evaluate(() => {
      const sink = { write: async items => { const blob = await items[0].getType('image/png'); const bytes = new Uint8Array(await blob.arrayBuffer()); let text = ''; for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]); window.__copiedPng = btoa(text); } };
      if (typeof ClipboardItem === 'undefined') window.ClipboardItem = class { constructor(items) { this.items = items; } getType(type) { return this.items[type]; } };
      try { Object.defineProperty(navigator, 'clipboard', { value: sink, configurable: true }); } catch (error) { navigator.clipboard.write = sink.write; }
      window.__viewerDebug.setExportGpuLimit(2000);
    });
    await printPlan(fresh, '178', '600');
    const plan = await fresh.evaluate(() => window.__viewerDebug.exportDimensions());
    if (!plan.gpuLimited) throw new Error('setup: plan not limited by the GPU: ' + JSON.stringify(plan));
    await fresh.click('#gpv-copy-image');
    await fresh.waitForFunction(() => window.__copiedPng || /Could not copy/.test(document.querySelector('#gpv-state').textContent), null, { timeout: 120000 });
    await fresh.waitForTimeout(300);
    const status = await freshStatus(fresh);
    const copied = await fresh.evaluate(() => window.__copiedPng || null);
    if (!copied) throw new Error('nothing copied: ' + status);
    const png = pngSize(Buffer.from(copied, 'base64'));
    if (png.width !== plan.width || png.height !== plan.height) throw new Error('copied ' + png.width + ' × ' + png.height + ' for a plan of ' + plan.width + ' × ' + plan.height);
    if (status !== 'Figure copied to the clipboard · ' + plan.width + ' × ' + plan.height + ' at ' + plan.dpi + ' dpi (178 mm wide) · rendered at ' + plan.dpi + ' dpi, the most this GPU allows for 178 mm') throw new Error('status: ' + status);
    console.log('       ' + status);
  } finally { await fresh.close(); }
});
await step('the builder and the views ZIP leave their result on the status line, and a caption past three lines is reported cut', async () => {
  /* Both put the on-screen view back after rendering, and that restyle reset the status to "Ready". */
  const fresh = await freshViewer([models[0]]);
  try {
    await printPlan(fresh, '85', '300');
    await fresh.fill('#gpv-view-name', 'Overview'); await fresh.fill('#gpv-view-caption', 'A caption written the way Make site figure writes them, long enough that three lines of the caption strip cannot hold it at this width, so the end of it has to be cut with an ellipsis and the figure has to say so');
    await fresh.click('#gpv-save-view'); await fresh.waitForTimeout(300);
    const estimate = (await fresh.locator('#gpv-builder-estimate').textContent()) || '';
    if (!/caption of panel A shortened to fit three lines/.test(estimate)) throw new Error('builder estimate: ' + estimate);
    const svg = (await freshDownload(fresh, '#gpv-builder-svg')).toString('utf8');
    const captionLines = [...svg.matchAll(/<text [^>]*font-weight="500"[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
    if (captionLines.length !== 3 || !captionLines[2].endsWith('…')) throw new Error('caption lines: ' + JSON.stringify(captionLines));
    let status = await freshStatus(fresh);
    if (!/^Figure SVG downloaded · 1 panel · .* · caption of panel A shortened to fit three lines$/.test(status)) throw new Error('builder SVG status: ' + status);
    await freshDownload(fresh, '#gpv-contact-sheet'); status = await freshStatus(fresh);
    if (!/^Figure PNG downloaded · 1 panel/.test(status)) throw new Error('builder PNG status: ' + status);
    await freshDownload(fresh, '#gpv-views-zip'); status = await freshStatus(fresh);
    if (!/^1 view exported · .* · 1004 × 669 at 300 dpi$/.test(status)) throw new Error('views ZIP status: ' + status);
    console.log('       ' + captionLines.length + ' caption lines · ' + status);
  } finally { await fresh.close(); }
});
await step('restoring a scene is one undo step that gives back the work it replaced', async () => {
  /* It used to empty the undo history: the views, labels and measurements it wrote over were gone. */
  const fresh = await freshViewer([models[0]]);
  try {
    const name = basename(models[0]);
    const scene = { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name }], settings: {}, labels: [{ model: name, chain: 'A', resi: 5, atom: 'CA', text: 'From the scene' }] };
    await fresh.click('[data-gpv-tab="publish"]');
    await fresh.fill('#gpv-view-name', 'Before the restore'); await fresh.click('#gpv-save-view'); await fresh.waitForTimeout(300);
    const before = await fresh.evaluate(() => ({ depth: window.__viewerDebug.undoDepth(), views: window.__viewerDebug.savedViews().length }));
    await fresh.setInputFiles('#gpv-load-scene', { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) }); await fresh.waitForTimeout(1200);
    const after = await fresh.evaluate(() => ({ depth: window.__viewerDebug.undoDepth(), views: window.__viewerDebug.savedViews().length, labels: window.__viewerDebug.labelRecords().map(label => label.text) }));
    if (!/Scene restored/.test(await freshStatus(fresh)) || after.views !== 0 || after.labels.join() !== 'From the scene') throw new Error('setup: the scene did not replace the records: ' + JSON.stringify(after));
    if (after.depth !== before.depth + 1) throw new Error('undo depth ' + before.depth + ' → ' + after.depth + ' after a restore');
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await fresh.keyboard.press('Control+z'); await fresh.waitForTimeout(400);
    const undone = await fresh.evaluate(() => ({ views: window.__viewerDebug.savedViews().map(view => view.name), labels: window.__viewerDebug.labelRecords().length }));
    if (!/^Undid scene restore/.test(await freshStatus(fresh)) || undone.views.join() !== 'Before the restore' || undone.labels !== 0) throw new Error('after ⌘Z: ' + await freshStatus(fresh) + ' · ' + JSON.stringify(undone));
  } finally { await fresh.close(); }
});
await step('the methods text calls a crystal structure experimental and says how distances were measured; the legend names a renamed label’s residue', async () => {
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    const methods = await fresh.evaluate(() => window.__viewerDebug.methodsText());
    if (!/^Experimental structure \(PDB 5CHA\) was inspected in Protein Structure Viewer/.test(methods)) throw new Error('5CHA methods: ' + methods.slice(0, 120));
  } finally { await fresh.close(); }
  const predicted = await freshViewer([models[0]]);
  try {
    const name = basename(models[0]);
    if (!/^Predicted structure was inspected/.test(await predicted.evaluate(() => window.__viewerDebug.methodsText()))) throw new Error('synthetic model methods: ' + (await predicted.evaluate(() => window.__viewerDebug.methodsText())).slice(0, 80));
    const scene = { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name }], settings: {},
      labels: [{ model: name, chain: 'A', resi: 5, atom: 'CA', text: 'Loop tip' }, { model: name, chain: 'A', resi: 9, atom: 'CA', text: 'ALA9 · A' }],
      measurements: [{ type: 'distance', points: [{ model: name, chain: 'A', resi: 5, atom: 'CA' }, { model: name, chain: 'B', resi: 5, atom: 'CA' }] }, { type: 'distance', points: [{ model: name, chain: 'A', resi: 7, atom: 'O' }, { model: name, chain: 'B', resi: 7, atom: 'N' }] }] };
    await predicted.setInputFiles('#gpv-load-scene', { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) }); await predicted.waitForTimeout(1200);
    await predicted.click('[data-gpv-tab="publish"]'); await predicted.click('#gpv-figure-legend'); await predicted.waitForTimeout(300);
    const legend = await predicted.inputValue('#gpv-legend-text');
    if (!/Labelled residues: Loop tip \(ALA5 · A\), ALA9 · A\./.test(legend)) throw new Error('legend: ' + (legend.match(/Labelled residues:[^.]*\./) || [legend.slice(0, 160)])[0]);
    const text = await predicted.evaluate(() => window.__viewerDebug.methodsText());
    if (!/Of the 2 distances shown, 1 was measured between Cα atoms and 1 between the specific atoms named in the figure legend .*, in Å, from the model coordinates/.test(text)) throw new Error('methods: ' + text);
  } finally { await predicted.close(); }
});
await step('the publication checklist follows the legend switch and the scale bar at once', async () => {
  /* The rules read the controls live, but nothing re-rendered the list when these two changed: it kept
     "The colour legend is drawn on exports" after the legend was switched off. */
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'chain'); await fresh.waitForTimeout(300);
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.waitForTimeout(300);
    if ((await fresh.inputValue('#gpv-projection')) !== 'perspective') throw new Error('setup: projection ' + await fresh.inputValue('#gpv-projection'));
    const items = () => fresh.evaluate(() => [...document.querySelectorAll('#gpv-check-list li')].map(li => li.className + ' ' + li.textContent));
    if (!(await items()).some(text => /is-ok ✓The colour legend is drawn/.test(text))) throw new Error('setup: ' + JSON.stringify(await items()));
    await fresh.uncheck('#gpv-export-legend');
    if (!(await items()).some(text => /is-warn !The colours need a key/.test(text))) throw new Error('after unticking the legend: ' + JSON.stringify(await items()));
    await fresh.selectOption('#gpv-scale-bar', '10');
    if (!(await items()).some(text => /is-warn !A scale bar is only exact in orthographic/.test(text))) throw new Error('after choosing a scale bar: ' + JSON.stringify(await items()));
  } finally { await fresh.close(); }
});
await step('the keys that say why colours are missing are screen-only: no legend on the export, and the checklist asks for none', async () => {
  /* "No pLDDT in 5cha.cif (experimental) — drawn in the model colour" and "Grey until models are
     aligned" were printed on figures as legends, and the checklist warned that the colours needed a key. */
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    const items = () => fresh.evaluate(() => [...document.querySelectorAll('#gpv-check-list li')].map(li => li.className + ' ' + li.textContent));
    const legendLines = list => list.filter(text => /colour legend is drawn|colours need a key/.test(text));
    for (const [mode, note] of [['plddt', /No pLDDT in 5cha\.cif \(experimental\) — drawn in the model colour/], ['agreement', /Grey until models are aligned/]]) {
      await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', mode); await fresh.waitForTimeout(300);
      if (!note.test(await freshText(fresh, '#gpv-plddt-legend'))) throw new Error(mode + ': the screen lost its note: ' + await freshText(fresh, '#gpv-plddt-legend'));
      await fresh.click('[data-gpv-tab="publish"]'); await fresh.check('#gpv-export-legend'); await fresh.waitForTimeout(300);
      if (await fresh.evaluate(() => window.__viewerDebug.legendWanted('figure'))) throw new Error(mode + ': an export would draw a legend');
      if (legendLines(await items()).length) throw new Error(mode + ', legend on: ' + JSON.stringify(legendLines(await items())));
      await fresh.uncheck('#gpv-export-legend'); await fresh.waitForTimeout(200);
      if (legendLines(await items()).length) throw new Error(mode + ', legend off: ' + JSON.stringify(legendLines(await items())));
      await fresh.check('#gpv-export-legend'); await fresh.waitForTimeout(200);
    }
    const svg = (await freshDownload(fresh, '#gpv-svg')).toString('utf8');
    if (/No pLDDT|Grey until|Align visible|Cα RMSF|align first/.test(svg)) throw new Error('the SVG carries the screen note');
    /* A scheme with a key still asks for one. */
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'chain'); await fresh.waitForTimeout(300);
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.uncheck('#gpv-export-legend'); await fresh.waitForTimeout(200);
    if (!(await items()).some(text => /is-warn !The colours need a key/.test(text))) throw new Error('chain colours, legend off: ' + JSON.stringify(await items()));
  } finally { await fresh.close(); }
});
await step('the composite lays the pLDDT profile out in its cell at the chosen text size, keys the PAE panel and keeps “pLDDT” capitalised', async () => {
  /* The profile was a 1200-unit chart shrunk into a 500 px cell: a strip with 1 pt tick labels. */
  const fresh = await freshViewer([join(here, 'fixtures', 'alphafold-db', 'AF-P69905-F1-model_v6.cif'), join(here, 'fixtures', 'alphafold-db', 'AF-P69905-F1-predicted_aligned_error_v6.json')]);
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'plddt'); await fresh.waitForTimeout(300);
    await printPlan(fresh, '85', '300', '8');
    /* Record what the composite draws: the profile goes in as an SVG image, the text through fillText. */
    await fresh.evaluate(() => {
      window.__svgImages = []; window.__drawnText = [];
      const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get() { return source.get.call(this); }, set(value) { if (String(value).startsWith('data:image/svg+xml')) window.__svgImages.push(decodeURIComponent(String(value).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))); source.set.call(this, value); } });
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { window.__drawnText.push([String(text), this.font]); return fillText.call(this, text, ...rest); };
    });
    const png = pngSize(await freshDownload(fresh, '#gpv-composite', 180000));
    const drawn = await fresh.evaluate(() => ({ svgs: window.__svgImages, text: window.__drawnText }));
    const profile = drawn.svgs.find(svg => /pLDDT/.test(svg));
    if (!profile) throw new Error('no profile SVG was drawn');
    const size = (profile.match(/<svg [^>]*width="([\d.]+)" height="([\d.]+)"/) || []).slice(1).map(Number);
    const cell = Math.floor(1004 / 2); const pad = Math.round(cell * 0.03);
    if (size[0] !== cell - 2 * pad) throw new Error('profile laid out ' + size.join(' × ') + ' for a ' + (cell - 2 * pad) + ' px box');
    const tick = Math.min(...[...profile.matchAll(/font-size="([\d.]+)"[^>]*>(?:0|50|100)</g)].map(match => Number(match[1])));
    const wanted = 8 / 72 * 300;
    if (!(tick >= wanted * 0.95)) throw new Error('tick labels ' + tick + ' px; 8 pt at 300 dpi is ' + wanted.toFixed(1) + ' px');
    if (!drawn.text.some(([text]) => text === 'Å') || !drawn.text.some(([text]) => text === '28')) throw new Error('no PAE colour bar labels: ' + JSON.stringify(drawn.text.map(([text]) => text)));
    /* The caption wraps at the figure's text size (2.52.0), so read it across its lines. */
    if (!/coloured by pLDDT confidence/.test(drawn.text.map(([text]) => text).join(' '))) throw new Error('caption: ' + JSON.stringify(drawn.text.filter(([text]) => /coloured/.test(text))));
    console.log('       composite ' + png.width + ' × ' + png.height + ' · profile ' + size.join(' × ') + ' px with ' + tick + ' px ticks · PAE bar 0–28 Å');
  } finally { await fresh.close(); }
});

/* ---- Stress loop, round 2: publish, exports, scenes and sessions (2.52.0) ----
   Each on a page of its own. Helpers here are prefixed c2 (round 2, area C). */
const c2Items = fresh => fresh.evaluate(() => [...document.querySelectorAll('#gpv-check-list li')].map(li => li.className + ' ' + li.textContent));
const c2Px = font => Number((String(font).match(/(\d+(?:\.\d+)?)px/) || [])[1]);
const c2Scene = (fresh, scene) => fresh.setInputFiles('#gpv-load-scene', { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) });
/* What a figure draws: the text it writes with its font, and the SVG charts it draws as images. */
const c2Record = fresh => fresh.evaluate(() => {
  window.__svgImages = []; window.__drawnText = [];
  const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get() { return source.get.call(this); }, set(value) { if (String(value).startsWith('data:image/svg+xml')) window.__svgImages.push(decodeURIComponent(String(value).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))); source.set.call(this, value); } });
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) { window.__drawnText.push([String(text), this.font]); return fillText.call(this, text, ...rest); };
});
const c2Drawn = fresh => fresh.evaluate(() => ({ svgs: window.__svgImages, text: window.__drawnText }));
/* A predicted-style PDB (pLDDT 80 on the polymer) with residues 10A and 10B, and a calcium ion whose
   atom name is CA and whose B-factor is 0. */
const c2Pdb = ({ insertion = true, ion = false } = {}) => {
  const lines = []; let serial = 1;
  const residues = insertion ? [[9, ' '], [10, 'A'], [10, 'B'], [11, ' '], [12, ' '], [13, ' ']] : [[1, ' '], [2, ' '], [3, ' '], [4, ' '], [5, ' '], [6, ' ']];
  residues.forEach(([resi, icode], index) => {
    const x = index * 3.8;
    [['N', -1.2, 0.4, 'N'], ['CA', 0, 0, 'C'], ['C', 1.2, 0.4, 'C'], ['O', 1.4, 1.6, 'O']].forEach(([name, dx, dy, element]) => lines.push(pdbAtom('ATOM', serial++, name, 'ALA', 'A', resi, [x + dx, dy, 0], element, icode, 80)));
  });
  if (ion) lines.push(pdbAtom('HETATM', serial++, 'CA', ' CA', 'A', 101, [4, 6, 0], 'CA', ' ', 0));
  return lines.join('\n') + '\nEND\n';
};
const c2Report = async (fresh, name) => {
  const html = (await freshDownload(fresh, '#gpv-report')).toString('utf8');
  /* Served from the suite's own copy of 3Dmol; the integrity attribute named the CDN file. */
  await writeFile(join(work, name), html.replace(/<script src='https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/3Dmol\/[^']+'[^>]*>/, "<script src='vendor/3Dmol-min.js'>"));
  const report = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  report.on('pageerror', error => noteError('C2 REPORT PAGEERROR: ' + error.message));
  await report.goto(base + '/' + name); await report.waitForTimeout(2500);
  return { html, report };
};

await step('a session opened over a page asks first and replaces it, so its labels land on its own model, not on one with the same file name', async () => {
  /* It added its models beside the page's as "model_a.pdb (2)" and matched its records by name — to the
     page's own model_a.pdb, a different structure — and the status said "1 model" of 2. */
  const name = basename(models[0]);
  const file = join(work, 'c2-session.zip'); let runA = null;
  const source = await freshViewer([models[0]]);
  try {
    await c2Scene(source, { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name, label: 'Run A' }], settings: {}, labels: [{ model: name, chain: 'A', resi: 5, atom: 'CA', text: 'Run A site' }] }); await source.waitForTimeout(1200);
    runA = await source.evaluate(() => { const atom = window.__viewerDebug.entries()[0].atoms.find(item => item.atom === 'CA' && item.chain === 'A' && item.resi === 5); return [atom.x, atom.y, atom.z]; });
    await source.click('[data-gpv-tab="publish"]');
    const download = source.waitForEvent('download', { timeout: 60000 }); await source.click('#gpv-save-session'); await (await download).saveAs(file);
  } finally { await source.close(); }
  /* A different structure under the same file name. */
  const fresh = await freshViewer([{ name, mimeType: 'chemical/x-pdb', buffer: await readFile(models[2]) }]);
  try {
    await fresh.click('[data-gpv-tab="publish"]');
    let asked = null;
    fresh.once('dialog', dialog => { asked = dialog.message(); dialog.dismiss(); });
    await fresh.setInputFiles('#gpv-open-session', file); await fresh.waitForTimeout(2500);
    if (asked !== 'Replace the model and the work on this page with the session? Cancel keeps the page.') throw new Error('asked: ' + asked);
    const kept = await fresh.evaluate(() => ({ entries: window.__viewerDebug.entries().length, labels: window.__viewerDebug.labelRecords().length }));
    if (kept.entries !== 1 || kept.labels || await freshStatus(fresh) !== 'Session not opened · the page is kept as it was') throw new Error('after Cancel: ' + JSON.stringify(kept) + ' · ' + await freshStatus(fresh));
    fresh.once('dialog', dialog => dialog.accept());
    await fresh.setInputFiles('#gpv-open-session', file); await fresh.waitForTimeout(3000);
    const state = await fresh.evaluate(() => {
      const debug = window.__viewerDebug;
      return { entries: debug.entries().map(entry => { const atom = entry.atoms.find(item => item.atom === 'CA' && item.chain === 'A' && item.resi === 5); return { id: entry.id, name: entry.name, label: entry.label, ca: [atom.x, atom.y, atom.z] }; }), labels: debug.labelRecords().map(label => ({ text: label.text, entryId: label.entryId })), count: document.querySelector('#gpv-count').textContent };
    });
    const status = await freshStatus(fresh);
    if (state.entries.length !== 1 || state.entries[0].name !== name || state.entries[0].label !== 'Run A') throw new Error('models after the session: ' + JSON.stringify(state.entries.map(entry => entry.name + ' / ' + entry.label)));
    if (state.entries[0].ca.some((value, index) => Math.abs(value - runA[index]) > 0.01)) throw new Error('the model on the page is not the session’s: Cα A5 at ' + state.entries[0].ca + ', saved at ' + runA);
    if (state.labels.length !== 1 || state.labels[0].text !== 'Run A site' || state.labels[0].entryId !== state.entries[0].id) throw new Error('labels: ' + JSON.stringify(state.labels));
    if (!/^Session restored · 1 model from .* · replaced the model that was open$/.test(status) || state.count !== '1 displayed / 1 loaded') throw new Error('status: ' + status + ' · ' + state.count);
    console.log('       ' + status);
  } finally { await fresh.close(); }
});
await step('a scene says how many of its records matched no model on the page', async () => {
  const fresh = await freshViewer([models[0]]);
  try {
    const name = basename(models[0]);
    await c2Scene(fresh, { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name }], settings: {},
      labels: [{ model: name, chain: 'A', resi: 5, atom: 'CA', text: 'Here' }, { model: 'absent.pdb', chain: 'A', resi: 5, atom: 'CA', text: 'Elsewhere' }],
      measurements: [{ type: 'distance', points: [{ model: name, chain: 'A', resi: 5, atom: 'CA' }, { model: 'absent.pdb', chain: 'B', resi: 5, atom: 'CA' }] }] });
    await fresh.waitForTimeout(1200);
    const status = await freshStatus(fresh);
    if (status !== 'Scene restored · 2 records matched no model on this page') throw new Error('status: ' + status);
  } finally { await fresh.close(); }
});
await step('undoing a scene restore puts back the colour scheme, representation, background and title it replaced; redo puts the scene’s back', async () => {
  /* Undo brought back the records but kept the scene's display: the old labels in the scene's style. */
  const fresh = await freshViewer([models[0]]);
  try {
    const name = basename(models[0]);
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'chain'); await fresh.selectOption('#gpv-style', 'cartoon'); await fresh.selectOption('#gpv-background', 'dark'); await fresh.waitForTimeout(300);
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.fill('#gpv-project-title', 'Other title');
    await fresh.fill('#gpv-view-name', 'Before'); await fresh.click('#gpv-save-view'); await fresh.waitForTimeout(300);
    const read = () => fresh.evaluate(() => ['#gpv-color-mode', '#gpv-style', '#gpv-background', '#gpv-project-title'].map(selector => document.querySelector(selector).value).join(' / '));
    const before = await read();
    await c2Scene(fresh, { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name }], settings: { colorMode: 'ss', representation: 'stick', background: 'white' }, provenance: { title: 'Saved title' }, labels: [{ model: name, chain: 'A', resi: 5, atom: 'CA', text: 'Saved' }] });
    await fresh.waitForTimeout(1200);
    const restored = await read();
    if (restored !== 'ss / stick / white / Saved title') throw new Error('setup: the scene set ' + restored);
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await fresh.keyboard.press('Control+z'); await fresh.waitForTimeout(500);
    const undone = await read(); const views = await fresh.evaluate(() => window.__viewerDebug.savedViews().map(view => view.name).join());
    if (!/^Undid scene restore/.test(await freshStatus(fresh)) || undone !== before || views !== 'Before') throw new Error('after ⌘Z: ' + undone + ' (was ' + before + ') · views ' + views + ' · ' + await freshStatus(fresh));
    await fresh.evaluate(() => document.querySelector('#gpv-stage').focus({ preventScroll: true })); await fresh.keyboard.press('Control+Shift+z'); await fresh.waitForTimeout(500);
    const redone = await read();
    if (redone !== restored) throw new Error('after redo: ' + redone);
  } finally { await fresh.close(); }
});
await step('a measurement between insertion-code residues names them, in the row and in the CSV’s resi column', async () => {
  /* "ALA10 · A CA ↔ ALA10 · A CA": a distance from 10A to 10B read as a residue measured to itself. */
  const fresh = await freshViewer([{ name: 'icode.pdb', mimeType: 'chemical/x-pdb', buffer: Buffer.from(c2Pdb()) }]);
  try {
    await c2Scene(fresh, { type: 'protein-viewer-scene', schemaVersion: 1, models: [{ name: 'icode.pdb' }], settings: {}, measurements: [{ type: 'distance', points: [{ model: 'icode.pdb', chain: 'A', resi: 10, icode: 'A', atom: 'CA' }, { model: 'icode.pdb', chain: 'A', resi: 10, icode: 'B', atom: 'CA' }] }] });
    await fresh.waitForTimeout(1200);
    await fresh.click('[data-gpv-tab="annotate"]'); await fresh.waitForTimeout(200);
    const row = await freshText(fresh, '#gpv-measurement-list');
    if (!/ALA10A · A CA ↔ ALA10B · A CA · 3\.80 Å/.test(row)) throw new Error('row: ' + row.slice(0, 120));
    const csv = (await freshDownload(fresh, '#gpv-measurements-csv')).toString('utf8');
    if (!csv.includes('"distance","icode.pdb","A","10A","ALA","CA","icode.pdb","A","10B","ALA","CA"')) throw new Error('CSV: ' + csv.split('\n')[1]);
  } finally { await fresh.close(); }
});
await step('the composite writes its captions, letters and panel A’s legend at the chosen text size', async () => {
  /* Captions were 0.36 × a strip sized from the cell (3.4 pt at 85 mm), and panel A's legend was scaled
     by the cell's share of the width. 8 pt at 300 dpi is 33.3 px. */
  const fresh = await freshViewer([join(here, 'fixtures', 'alphafold-db', 'AF-P69905-F1-model_v6.cif'), join(here, 'fixtures', 'alphafold-db', 'AF-P69905-F1-predicted_aligned_error_v6.json')]);
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'plddt'); await fresh.waitForTimeout(300);
    await printPlan(fresh, '85', '300', '8');
    await c2Record(fresh);
    await freshDownload(fresh, '#gpv-composite', 180000);
    const { text } = await c2Drawn(fresh);
    const caption = text.find(([value]) => /coloured by pLDDT/.test(value)); const letter = text.find(([value, font]) => value === 'B' && /^(700|bold) /.test(font));
    const legend = text.find(([value]) => value === 'pLDDT');
    if (!caption || Math.abs(c2Px(caption[1]) - 33) > 2) throw new Error('caption font ' + (caption && caption[1]));
    if (!letter || Math.abs(c2Px(letter[1]) - 43) > 2) throw new Error('panel letter font ' + (letter && letter[1]));
    if (!legend || c2Px(legend[1]) < 33) throw new Error('panel A legend font ' + (legend && legend[1]));
    console.log('       caption ' + caption[1] + ' · letter ' + letter[1] + ' · legend ' + legend[1] + ' · ' + await freshStatus(fresh));
  } finally { await fresh.close(); }
});
await step('one panel per model is the chosen width overall; it and the comparison caption at the chosen text size and state the real width', async () => {
  /* At 85 mm two models made a 2008 px (170 mm) figure named "…-85mm-300dpi.png", captioned at 4.9 pt. */
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    await printPlan(fresh, '85', '300', '8');
    await c2Record(fresh);
    const png = pngSize(await freshDownload(fresh, '#gpv-model-panels', 180000));
    const status = await freshStatus(fresh);
    if (png.width !== 1004 || png.dpi !== 300) throw new Error('per-model PNG ' + JSON.stringify(png) + ' for an 85 mm, 300 dpi figure');
    if (!/^Per-model figure downloaded · 2 panels · 1004 × \d+ at 300 dpi \(85 mm wide\)$/.test(status)) throw new Error('status: ' + status);
    const caption = (await c2Drawn(fresh)).text.find(([value]) => /^model_a\.pdb/.test(value));
    if (!caption || Math.abs(c2Px(caption[1]) - 33) > 2) throw new Error('per-model caption font ' + (caption && caption[1]));
    await fresh.click('[data-gpv-tab="compare"]'); await fresh.check('#gpv-side-by-side'); await fresh.waitForTimeout(1500);
    await fresh.click('[data-gpv-tab="publish"]');
    const svg = (await freshDownload(fresh, '#gpv-compare-svg', 180000)).toString('utf8');
    const size = (svg.match(/<text [^>]*font-size="([\d.]+)" font-weight="500"[^>]*>model_a\.pdb/) || [])[1];
    if (Math.abs(Number(size) - 33) > 2) throw new Error('comparison SVG caption font-size ' + size);
    if (!/^Comparison SVG downloaded · 2 panels · 2008 × \d+ at 300 dpi \(170 mm wide\) · vector captions$/.test(await freshStatus(fresh))) throw new Error('comparison status: ' + await freshStatus(fresh));
    console.log('       ' + status + ' · comparison captions ' + size + ' px');
  } finally { await fresh.close(); }
});
await step('Cα deviation before an alignment is a screen-only note: nothing printed, no key asked for', async () => {
  /* The export printed the full band key, "unmatched" included, over a uniformly grey model. */
  const fresh = await freshViewer([models[0], models[1]]);
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'deviation'); await fresh.waitForTimeout(300);
    if (!/Grey until models are aligned/.test(await freshText(fresh, '#gpv-plddt-legend'))) throw new Error('screen note: ' + await freshText(fresh, '#gpv-plddt-legend'));
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.check('#gpv-export-legend'); await fresh.waitForTimeout(300);
    if (await fresh.evaluate(() => window.__viewerDebug.legendWanted('figure'))) throw new Error('an export would draw the deviation key');
    if ((await c2Items(fresh)).some(text => /colour legend is drawn|colours need a key/.test(text))) throw new Error('checklist: ' + JSON.stringify(await c2Items(fresh)));
    const svg = (await freshDownload(fresh, '#gpv-svg')).toString('utf8');
    if (/Cα deviation|unmatched|align first/.test(svg)) throw new Error('the SVG carries the deviation key');
  } finally { await fresh.close(); }
});
await step('under a GPU cap the builder’s estimate and status and the composite’s status say what dpi was asked; the composite says “1 panel”', async () => {
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  try {
    await fresh.evaluate(() => window.__viewerDebug.setExportGpuLimit(2000));
    await printPlan(fresh, '178', '600', '8');
    const dpi = (await fresh.evaluate(() => window.__viewerDebug.exportDimensions())).dpi;
    const note = '600 dpi asked · rendered at ' + dpi + ' dpi, the most this GPU allows for 178 mm';
    await fresh.fill('#gpv-view-name', 'One'); await fresh.click('#gpv-save-view'); await fresh.waitForTimeout(300);
    const estimate = await freshText(fresh, '#gpv-builder-estimate');
    if (!estimate.includes('178 mm wide at ' + dpi + ' dpi · text 8 pt · ' + note)) throw new Error('builder estimate: ' + estimate);
    await freshDownload(fresh, '#gpv-contact-sheet', 180000);
    if (!(await freshStatus(fresh)).includes('178 mm wide at ' + dpi + ' dpi · ' + note)) throw new Error('builder status: ' + await freshStatus(fresh));
    await freshDownload(fresh, '#gpv-composite', 180000);
    const status = await freshStatus(fresh);
    if (!new RegExp('^Composite figure downloaded · 1 panel · \\d+ × \\d+ at ' + dpi + ' dpi · ' + note + '$').test(status)) throw new Error('composite status: ' + status);
    console.log('       ' + status);
  } finally { await fresh.close(); }
});
await step('the composite’s pLDDT profile key names the models by what tells them apart and stays inside its cell', async () => {
  /* Two long names at 8 pt ran off the cell's left edge, cutting the first swatch and name. */
  const stems = ['a_rather_long_prediction_run_name_model_0.pdb', 'a_rather_long_prediction_run_name_model_1.pdb'];
  const fresh = await freshViewer(await Promise.all(stems.map(async (name, index) => ({ name, mimeType: 'chemical/x-pdb', buffer: await readFile(models[index]) }))));
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'plddt'); await fresh.waitForTimeout(300);
    await printPlan(fresh, '178', '300', '8');
    await c2Record(fresh);
    await freshDownload(fresh, '#gpv-composite', 180000);
    const profile = (await c2Drawn(fresh)).svgs.find(svg => /id="models"/.test(svg));
    if (!profile) throw new Error('no profile with a model key was drawn');
    const key = profile.slice(profile.indexOf('<g id="models">'), profile.indexOf('</g>', profile.indexOf('<g id="models">')));
    const xs = [...key.matchAll(/ x="(-?[\d.]+)"/g)].map(match => Number(match[1])); const names = [...key.matchAll(/>([^<]+)<\/text>/g)].map(match => match[1]);
    if (xs.length !== 4 || Math.min(...xs) < 0) throw new Error('key positions ' + JSON.stringify(xs));
    if ([...names].sort().join() !== 'model_0,model_1') throw new Error('key names ' + JSON.stringify(names));
  } finally { await fresh.close(); }
});
await step('the report states a prediction only when it holds one, loads 3Dmol with the viewer’s integrity hash, and estimates its size', async () => {
  /* A crystal structure's report said "Predicted structures are predictions"; the online tag had no
     integrity hash; the estimate added 1.5 MB for a 513 KB library. */
  const fresh = await freshViewer([experimentalFile('5cha.cif')]);
  let report = null;
  try {
    await fresh.click('[data-gpv-tab="publish"]');
    const kilobytes = text => { const match = text.match(/roughly ([\d.]+) (KB|MB)/); return match ? Number(match[1]) * (match[2] === 'MB' ? 1024 : 1) : NaN; };
    await fresh.check('#gpv-report-offline'); await fresh.waitForTimeout(200);
    const offlineEstimate = kilobytes(await freshText(fresh, '#gpv-report-size'));
    const offline = await freshDownload(fresh, '#gpv-report');
    if (Math.abs(offlineEstimate - offline.length / 1024) > offline.length / 1024 * 0.15) throw new Error('offline estimate ' + offlineEstimate + ' KB for a ' + (offline.length / 1024).toFixed(0) + ' KB file');
    await fresh.uncheck('#gpv-report-offline'); await fresh.waitForTimeout(200);
    const onlineEstimate = kilobytes(await freshText(fresh, '#gpv-report-size'));
    await fresh.evaluate(() => { const tag = document.querySelector('script[src*="3Dmol"]'); tag.setAttribute('integrity', 'sha512-c2Test+Hash/0='); tag.setAttribute('crossorigin', 'anonymous'); });
    const opened = await c2Report(fresh, 'c2-report-5cha.html'); report = opened.report;
    if (Math.abs(onlineEstimate - opened.html.length / 1024) > opened.html.length / 1024 * 0.15) throw new Error('online estimate ' + onlineEstimate + ' KB for a ' + (opened.html.length / 1024).toFixed(0) + ' KB file');
    if (!opened.html.includes("3Dmol-min.js' integrity='sha512-c2Test+Hash/0=' crossorigin='anonymous'>")) throw new Error('online tag: ' + (opened.html.match(/<script src='https:[^>]*>/) || ['none'])[0]);
    const generated = await report.locator('#generated').textContent();
    if (/Predicted structures/.test(generated)) throw new Error('5CHA report: ' + generated);
    console.log('       estimates ' + onlineEstimate + ' / ' + offlineEstimate + ' KB for ' + (opened.html.length / 1024).toFixed(0) + ' / ' + (offline.length / 1024).toFixed(0) + ' KB');
  } finally { if (report) await report.close(); await fresh.close(); }
});
await step('the report’s mean pLDDT leaves out a calcium ion named CA', async () => {
  const fresh = await freshViewer([{ name: 'ion.pdb', mimeType: 'chemical/x-pdb', buffer: Buffer.from(c2Pdb({ insertion: false, ion: true })) }]);
  let report = null;
  try {
    await fresh.click('[data-gpv-tab="publish"]');
    ({ report } = await c2Report(fresh, 'c2-report-ion.html'));
    const state = await report.evaluate(() => ({ plddt: panes[0].plddt, generated: document.querySelector('#generated').textContent }));
    if (state.plddt !== 80) throw new Error('report mean pLDDT ' + state.plddt + ' (the polymer is 80, the ion 0)');
    if (!/Predicted structures are predictions/.test(state.generated)) throw new Error('a prediction’s report lost the sentence: ' + state.generated);
  } finally { if (report) await report.close(); await fresh.close(); }
});
await step('the checklist follows the title field, and its one-click fixes say what they set', async () => {
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.click('[data-gpv-tab="appearance"]'); await fresh.selectOption('#gpv-color-mode', 'chain'); await fresh.waitForTimeout(200);
    await fresh.click('[data-gpv-tab="publish"]'); await fresh.waitForTimeout(300);
    await fresh.fill('#gpv-project-title', 'My fig'); await fresh.waitForTimeout(200);
    if (!(await c2Items(fresh)).some(text => /Figure title set: My fig\./.test(text))) throw new Error('title: ' + JSON.stringify(await c2Items(fresh)));
    await fresh.selectOption('#gpv-export-mode', 'pixels'); await fresh.uncheck('#gpv-export-legend'); await fresh.selectOption('#gpv-scale-bar', '10'); await fresh.waitForTimeout(300);
    for (const [label, said] of [['Use print size', /^Exports set to print size · \d+ mm wide at \d+ dpi, text \d+ pt$/], ['Draw legend', /^The colour legend is now drawn on exports$/], ['Switch to orthographic', /^Projection set to orthographic/]]) {
      await fresh.locator('#gpv-check-list button', { hasText: label }).click(); await fresh.waitForTimeout(300);
      if (!said.test(await freshStatus(fresh))) throw new Error(label + ' said: ' + await freshStatus(fresh));
    }
  } finally { await fresh.close(); }
});
await step('a predictor archive reads "Loading" until it is in, never "Ready" half way', async () => {
  const fresh = await freshViewer();
  try {
    await fresh.evaluate(() => { window.__states = []; const state = document.querySelector('#gpv-state'); new MutationObserver(() => window.__states.push(state.textContent)).observe(state, { childList: true, characterData: true, subtree: true }); });
    await fresh.setInputFiles('#gpv-files', [join(here, 'fixtures', 'predictors', 'boltz_results_hbdimer.zip')]);
    await fresh.waitForFunction(() => /^Loaded/.test(document.querySelector('#gpv-state').textContent), null, { timeout: 60000 });
    const states = await fresh.evaluate(() => window.__states);
    const during = states.slice(0, states.findIndex(text => /^Loaded/.test(text)));
    if (during.includes('Ready')) throw new Error('states: ' + JSON.stringify(states));
  } finally { await fresh.close(); }
});
await page.bringToFront();

group('interface');
await step('"?" opens help and Escape closes it', async () => {
  /* As in the navigation group: a stage click on a residue opens the label editor, and on a label
     also makes it active; Esc closes the one and lets go of the other, leaving the focus on the stage. */
  await page.click('#gpv-stage');
  if (await page.locator('#gpv-label-editor').isVisible()) await page.keyboard.press('Escape');
  if (await page.evaluate(() => Boolean(window.__viewerDebug && window.__viewerDebug.activeText()))) await page.keyboard.press('Escape');
  await page.keyboard.press('?'); await page.waitForTimeout(500);
  if (!(await page.locator('#gpv-help').isVisible())) throw new Error('did not open');
  /* The site-figure tip names the builder's buttons as they read, not the single view's. */
  const help = (await page.locator('#gpv-help').textContent()) || '';
  if (!/ready for Download built figure PNG or SVG/.test(help)) throw new Error('the site-figure tip names the wrong download');
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
await step('Esc in the help dialog or a rename field does only that, leaving full screen and drawing on', async () => {
  /* Before 2.52.0 the same Esc also fell through to the page's shortcut: closing help left full
     screen, and cancelling a rename stopped drawing. */
  try {
    await page.click('#gpv-fullscreen'); await page.waitForTimeout(600);
    await page.keyboard.press('?'); await page.waitForTimeout(400);
    if (!(await page.locator('#gpv-help').isVisible())) throw new Error('help did not open in full screen');
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    if (await page.locator('#gpv-help').isVisible()) throw new Error('Esc did not close help');
    if (!(await page.locator('#gpv-view-grid.is-fullscreen').count())) throw new Error('closing help also left full screen');
  } finally {
    /* In full screen the view covers the header's button; press it through the DOM. */
    if (await page.locator('#gpv-view-grid.is-fullscreen').count()) { await page.evaluate(() => document.querySelector('#gpv-fullscreen').click()); await page.waitForTimeout(600); }
  }
  await tab('annotate'); await page.click('#gpv-annotate'); await page.waitForTimeout(200);
  try {
    await tab('models'); await page.locator('#gpv-list .gpv-entry').first().locator('button:has-text("Rename")').click(); await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    if (await page.locator('#gpv-list .gpv-entry input[type="text"]').count()) throw new Error('Esc did not cancel the rename');
    if (!(await page.locator('#gpv-stage.is-drawing').count())) throw new Error('cancelling the rename also stopped drawing');
  } finally { await tab('annotate'); if (await page.locator('#gpv-stage.is-drawing').count()) await page.click('#gpv-annotate'); await page.waitForTimeout(200); await tab('models'); }
});
await step('the shortcuts still work after a click on a switch, and a slider keeps its own arrows', async () => {
  /* Every <input> used to count as typing, so after a click on Depth cueing "?" did nothing. */
  await tab('appearance');
  const fog = await page.isChecked('#gpv-fog');
  try {
    await page.click('#gpv-fog'); await page.waitForTimeout(200);
    await page.keyboard.press('?'); await page.waitForTimeout(400);
    if (!(await page.locator('#gpv-help').isVisible())) throw new Error('"?" after a click on a switch did not open help');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await tab('models');
    const before = await page.evaluate(() => ({ active: (window.__viewerDebug.activeEntry() || {}).id, value: document.querySelector('#gpv-cycle-speed').value }));
    await page.focus('#gpv-cycle-speed'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ active: (window.__viewerDebug.activeEntry() || {}).id, value: document.querySelector('#gpv-cycle-speed').value }));
    if (after.active !== before.active) throw new Error('→ on the interval slider also stepped the model');
    if (after.value === before.value) throw new Error('→ did not move the slider');
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
  } finally {
    if (await page.locator('#gpv-help').isVisible()) await page.keyboard.press('Escape');
    await tab('appearance'); if ((await page.isChecked('#gpv-fog')) !== fog) await page.click('#gpv-fog'); await page.waitForTimeout(200); await tab('models');
  }
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
  await step('the report states pLDDT only for models that carry confidence', async () => {
    /* The fixtures are predictions, so each must say so; then one is marked experimental to check
       that the report neither colours it on the pLDDT scale nor prints a mean pLDDT for it. */
    const flags = await report.evaluate(() => structures.map(s => s.hasConfidence));
    if (!flags.length || flags.some(flag => flag !== true)) throw new Error('hasConfidence flags: ' + JSON.stringify(flags));
    const originalColors = await report.evaluate(() => el('colors').value);
    await report.evaluate(() => { el('colors').value = 'plddt'; structures[panes[0].index].hasConfidence = false; refreshAll(); });
    await report.waitForTimeout(800);
    const state = await report.evaluate(() => {
      const s = structures[panes[0].index];
      return { plddt: panes[0].plddt, strip: stripColor(s, { b: 90, atom: 'CA', chain: 'A', resi: 1 }), own: s.color, stats: panes[0].stats.textContent };
    });
    await report.evaluate(value => { structures[panes[0].index].hasConfidence = true; el('colors').value = value; refreshAll(); }, originalColors);
    await report.waitForTimeout(500);
    if (state.plddt !== null) throw new Error('an experimental model still reports mean pLDDT ' + state.plddt);
    if (state.strip !== state.own) throw new Error('its strip is painted ' + state.strip + ', not its model colour ' + state.own);
    if (!/pLDDT —/.test(state.stats)) throw new Error('panel stats read: ' + state.stats);
  });
  await step('the report carries the outline, depth cueing, the faded chain and the contact map', async () => {
    const state = await report.evaluate(() => ({ outline: initial.outline, fog: initial.fog, faded: structures.some(s => (s.fadedChains || []).includes('B')), contacts: initial.contacts ? initial.contacts.pairs.length : 0, wrapHidden: document.querySelector('#contacts-wrap').hidden, detail: document.querySelector('#contacts-detail').textContent }));
    if (state.outline !== 'bold' || !state.fog || !state.faded || state.contacts < 1 || state.wrapHidden || !/residue pairs/.test(state.detail)) throw new Error(JSON.stringify(state));
    await report.selectOption('#background', 'white'); await report.waitForTimeout(600);
    if (await report.evaluate(() => document.querySelector('#contacts-wrap').hidden)) throw new Error('contact panel vanished on background change');
    console.log('       ' + state.contacts + ' pairs · outline ' + state.outline + ' · fog · chain B faded');
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
  await step('the report paints Sequence spectrum as the viewer does: each chain blue to red, its strip the same', async () => {
    /* The report asked 3Dmol for a colour scheme called "spectrum", which it does not have: grey. */
    const startColors = await report.evaluate(() => el('colors').value);
    try {
      await report.selectOption('#colors', 'spectrum'); await report.waitForTimeout(800);
      const seen = await report.evaluate(() => {
        const pane = panes[0]; const s = structures[pane.index];
        const spec = styleSpec(s); const options = spec[Object.keys(spec)[0]];
        if (typeof options.colorfunc !== 'function') return { error: 'no colour function: ' + JSON.stringify(options) };
        const row = pane.rows.find(item => !(s.fadedChains || []).includes(item.chain)) || pane.rows[0];
        const first = row.atoms[0]; const last = row.atoms[row.atoms.length - 1];
        return { chain: row.chain, first: options.colorfunc(first), last: options.colorfunc(last), stripFirst: stripColor(s, first), stripLast: stripColor(s, last) };
      });
      if (seen.error) throw new Error(seen.error);
      /* The viewer's ramp at its two ends (03, spectrumRampColor): hue 240° and 0° at 85 % saturation. */
      if (seen.first !== '#1313ec' || seen.last !== '#ec1313') throw new Error('chain ' + seen.chain + ' runs ' + seen.first + ' → ' + seen.last);
      if (seen.stripFirst !== seen.first || seen.stripLast !== seen.last) throw new Error('the strip runs ' + seen.stripFirst + ' → ' + seen.stripLast);
      console.log('       chain ' + seen.chain + ' ' + seen.first + ' → ' + seen.last + ' in the view and the strip');
    } finally { await report.selectOption('#colors', startColors); await report.waitForTimeout(400); }
  });
  await step('each report panel carries a sequence strip that zooms on click', async () => {
    const strips = await report.locator('#view .strip').count(); const paneCount = await report.locator('#view .pane').count();
    if (!strips || strips !== paneCount) throw new Error('strips=' + strips + ' panes=' + paneCount);
    await report.bringToFront();
    /* On the Linux runner the report's fonts make the page a little taller and the first strip
       lands just below the 1000 px viewport; pointer events never reach it there. */
    await report.locator('#view .strip').first().scrollIntoViewIfNeeded(); await report.waitForTimeout(200);
    const box = await report.locator('#view .strip').first().boundingBox();
    await report.evaluate(() => { const strip = document.querySelector('#view .strip'); window.__stripMoves = 0; strip.addEventListener('pointermove', () => { window.__stripMoves += 1; }); });
    /* The strip only answers a hover once its rows are drawn; on a slow runner that can be a
       moment after the panel appears, so hover repeatedly for up to 4 s. */
    let readout = '';
    const target = [box.x + box.width * 0.4, box.y + Math.min(6, box.height / 2)];
    for (let attempt = 0; attempt < 16 && !/ALA\d+/.test(readout); attempt++) {
      await report.mouse.move(target[0] + (attempt % 2), target[1]); await report.waitForTimeout(250);
      readout = (await report.locator('#view .readout').first().textContent()) || '';
    }
    if (!/ALA\d+/.test(readout)) {
      const diag = await report.evaluate(([x, y]) => { const strip = document.querySelector('#view .strip'); const under = document.elementFromPoint(x, y); return { moves: window.__stripMoves, hidden: strip.hidden, width: strip.width, height: strip.height, styleHeight: strip.style.height, box: strip.getBoundingClientRect().toJSON(), under: under ? under.tagName + '.' + under.className : null, scroll: [scrollX, scrollY] }; }, target);
      throw new Error('readout: ' + readout + ' · ' + JSON.stringify(diag));
    }
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

/* The report opened a second tab. In a headed engine (Firefox under Xvfb on CI) that tab stays in
   front and clicks on the viewer page hang until it is fronted again. */
await page.bringToFront();
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
await step('the figure saves as PDF, JPEG and WebP beside PNG, and the checklist flags the lossy ones', async () => {
  await tab('publish');
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85'); await page.selectOption('#gpv-print-dpi', '300'); await page.waitForTimeout(200);
  try {
    await page.selectOption('#gpv-image-format', 'pdf'); await page.waitForTimeout(200);
    if (!/Download figure PDF/.test((await page.locator('#gpv-image').textContent()) || '')) throw new Error('the button does not follow the format: ' + await page.locator('#gpv-image').textContent());
    let download = page.waitForEvent('download', { timeout: 180000 }); await page.click('#gpv-image');
    const pdfPath = await (await download).path(); const pdf = await readFile(pdfPath);
    if (!/\.pdf$/.test((await download).suggestedFilename())) throw new Error('PDF name: ' + (await download).suggestedFilename());
    const head = pdf.toString('latin1', 0, 9); if (!head.startsWith('%PDF-1.4')) throw new Error('not a PDF: ' + head);
    const text = pdf.toString('latin1');
    /* 85 mm at 300 dpi is 1004 px, which is 240.96 pt; the page box must say so. */
    const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/); if (!box || Math.abs(Number(box[1]) - 1004 / 300 * 72) > 0.5) throw new Error('MediaBox: ' + (box && box[0]));
    if (!/\/Subtype \/Image/.test(text) || !/\/FlateDecode|\/DCTDecode/.test(text)) throw new Error('the PDF carries no image');
    if (!/startxref\n\d+\n%%EOF/.test(text)) throw new Error('the PDF has no valid trailer');
    if (pdf.length < 20000) throw new Error('PDF is only ' + pdf.length + ' bytes — likely blank');
    await page.selectOption('#gpv-image-format', 'jpeg'); await page.waitForTimeout(300);
    const flagged = (await page.locator('#gpv-check-list').textContent()) || '';
    if (!/JPEG is lossy/.test(flagged)) throw new Error('the checklist does not flag the lossy format');
    download = page.waitForEvent('download', { timeout: 180000 }); await page.click('#gpv-image');
    const jpegName = (await download).suggestedFilename(); const jpeg = await readFile(await (await download).path());
    if (!/\.(jpg|png)$/.test(jpegName)) throw new Error('JPEG name: ' + jpegName);
    if (/\.jpg$/.test(jpegName) && !(jpeg[0] === 0xff && jpeg[1] === 0xd8)) throw new Error('not a JPEG');
    await page.selectOption('#gpv-image-format', 'webp'); await page.waitForTimeout(200);
    download = page.waitForEvent('download', { timeout: 180000 }); await page.click('#gpv-image');
    const webpName = (await download).suggestedFilename(); const webp = await readFile(await (await download).path());
    if (/\.webp$/.test(webpName) && webp.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP');
    console.log('       PDF ' + (pdf.length / 1024).toFixed(0) + ' KB, page ' + box[1] + ' × ' + box[2] + ' pt · ' + jpegName.replace(/^.*-/, '') + ' ' + (jpeg.length / 1024).toFixed(0) + ' KB · ' + webpName.replace(/^.*-/, '') + ' ' + (webp.length / 1024).toFixed(0) + ' KB');
  } finally { await page.selectOption('#gpv-image-format', 'png'); await page.waitForTimeout(200); }
});
await step('the TIFF export is a baseline RGB TIFF with the resolution set', async () => {
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.selectOption('#gpv-image-format', 'tiff'); await page.waitForTimeout(200); await page.click('#gpv-image');
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
await step('the legend sits where the figure asks: a bottom row, or a stack down one side', async () => {
  await tab('appearance'); const mode = await page.inputValue('#gpv-color-mode');
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(400);
  await tab('publish');
  const legendOf = async () => {
    const download = page.waitForEvent('download', { timeout: 120000 }); await page.click('#gpv-svg');
    const svg = await readFile(await (await download).path(), 'utf8');
    const group = (svg.match(/<g id="legend">[\s\S]*?<\/g>/) || [''])[0];
    if (!group) throw new Error('the SVG carries no legend group');
    const rows = [...new Set([...group.matchAll(/<text[^>]*\sy="([-\d.]+)"/g)].map(match => Number(match[1])))];
    return { rows, x: Number((group.match(/<rect x="([-\d.]+)"/) || [])[1]) };
  };
  await page.selectOption('#gpv-legend-position', 'bottom-left'); await page.waitForTimeout(200);
  const bottom = await legendOf();
  if (bottom.rows.length !== 1) throw new Error('the bottom legend is not a single row: ' + JSON.stringify(bottom.rows));
  await page.selectOption('#gpv-legend-position', 'right'); await page.waitForTimeout(200);
  const side = await legendOf();
  if (side.rows.length < 3) throw new Error('the side legend did not stack: ' + JSON.stringify(side.rows));
  if (!(side.x > bottom.x + 100)) throw new Error('the right-hand legend is not on the right: x ' + side.x + ' against ' + bottom.x);
  const scene = await page.evaluate(() => window.__viewerDebug.sceneSettings().legendPosition);
  if (scene !== 'right') throw new Error('the scene does not carry the legend position: ' + scene);
  await page.selectOption('#gpv-legend-position', 'bottom-left'); await page.waitForTimeout(200);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', mode); await page.waitForTimeout(300); await tab('publish');
  console.log('       one row at y ' + bottom.rows[0].toFixed(0) + ' · stacked over ' + side.rows.length + ' rows on the right');
});
await step('a scale bar of known length appears in the figure SVG', async () => {
  await page.selectOption('#gpv-image-format', 'png'); await page.waitForTimeout(150);
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
await step('the methods text states the superposition, RMSD and dimension definitions', async () => {
  await tab('compare'); await page.click('#gpv-align'); await page.waitForTimeout(2500);
  await tab('publish'); await page.click('#gpv-methods-text'); await page.waitForTimeout(500);
  const text = await page.inputValue('#gpv-methods-field');
  if (!/Kabsch/.test(text) || !/RMSD is reported over all paired Cα atoms/.test(text)) throw new Error('no superposition sentence: ' + text.slice(0, 160));
  if (!/maximum Cα–Cα distance/.test(text) || !/radius of gyration/.test(text)) throw new Error('no dimensions sentence');
  if (!/3Dmol\.js 2\.4\.2/.test(text) || !/VALIDATION\.md/.test(text)) throw new Error('no software sentence');
  console.log('       ' + text.length + ' characters · ' + text.split('. ').length + ' sentences');
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
await step('Not now keeps the autosaved session for the next visit, and Forget it discards it', async () => {
  /* Before 2.52.0 the empty page saved itself 1.5 s after loading and deleted the stored session the
     banner was offering, so Not now behaved as Forget it. */
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.waitForTimeout(2500);
    await fresh.reload(); await fresh.waitForTimeout(2500);
    if (await fresh.locator('#gpv-session-banner').isHidden()) throw new Error('no restore banner after the first reload');
    await fresh.click('#gpv-session-no'); await fresh.waitForTimeout(2500);
    await fresh.reload(); await fresh.waitForTimeout(2500);
    if (await fresh.locator('#gpv-session-banner').isHidden()) throw new Error('Not now threw the session away: no banner on the next visit');
    await fresh.click('#gpv-session-forget'); await fresh.waitForTimeout(800);
    await fresh.reload(); await fresh.waitForTimeout(2500);
    if (!(await fresh.locator('#gpv-session-banner').isHidden())) throw new Error('Forget it kept the session');
  } finally { await fresh.close(); }
});
await step('loading other work takes the restore banner down, so Restore cannot overwrite it', async () => {
  const fresh = await freshViewer([models[0]]);
  try {
    await fresh.waitForTimeout(2500);
    await fresh.reload(); await fresh.waitForTimeout(2500);
    if (await fresh.locator('#gpv-session-banner').isHidden()) throw new Error('setup: no restore banner');
    await fresh.setInputFiles('#gpv-files', [models[1]]); await fresh.waitForTimeout(2000);
    if (!(await fresh.locator('#gpv-session-banner').isHidden())) throw new Error('the banner stayed up over the model just loaded');
  } finally { await fresh.close(); }
});
await step('a session file saves everything and reopens it, by the picker and by drop', async () => {
  const models = await page.locator('#gpv-list [data-entry-id]').count();
  const labels = await page.locator('#gpv-label-list .gpv-entry').count();
  const withPae = await page.evaluate(() => window.__viewerDebug.entries().filter(entry => entry.confidence && entry.confidence.pae && entry.confidence.pae.length).length);
  await tab('publish');
  const download = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#gpv-save-session');
  const file = join(work, 'session.zip'); await (await download).saveAs(file);
  const bytes = await readFile(file);
  if (bytes.toString('latin1', 0, 2) !== 'PK' || !bytes.includes('session.json')) throw new Error('not a session ZIP');
  const reopen = async open => {
    await page.reload(); await page.waitForTimeout(2500);
    if (!(await page.locator('#gpv-session-banner').isHidden())) await page.click('#gpv-session-no');
    await open(); await page.waitForTimeout(4000);
    const restored = await page.locator('#gpv-list [data-entry-id]').count();
    if (restored !== models) throw new Error('restored ' + restored + ' of ' + models + ' models');
    if ((await page.locator('#gpv-label-list .gpv-entry').count()) !== labels) throw new Error('labels not restored');
    const pae = await page.evaluate(() => window.__viewerDebug.entries().filter(entry => entry.confidence && entry.confidence.pae && entry.confidence.pae.length).length);
    if (pae !== withPae) throw new Error('PAE matrices: ' + pae + ' of ' + withPae);
  };
  await reopen(async () => { await tab('publish'); await page.setInputFiles('#gpv-open-session', [file]); });
  await reopen(async () => { await page.setInputFiles('#gpv-files', [file]); });
  console.log('       ' + (bytes.length / 1024).toFixed(0) + ' KB · ' + models + ' models, ' + labels + ' labels, ' + withPae + ' PAE matrices restored twice');
});

group('AlphaFold DB entry');
/* A real, committed download from the AlphaFold Protein Structure Database (EMBL-EBI /
   DeepMind, CC-BY-4.0): human haemoglobin subunit alpha, UniProt P69905 — 142 residues
   including the initiator methionine that AlphaFold's UniProt-based model retains (not
   141, the length of the mature, Met-cleaved chain). See fixtures/alphafold-db/README.md
   for the source URLs, licence, and download date. */
const afdbDir = join(here, 'fixtures', 'alphafold-db');
const afdbCif = join(afdbDir, 'AF-P69905-F1-model_v6.cif');
const afdbPae = join(afdbDir, 'AF-P69905-F1-predicted_aligned_error_v6.json');

await step('the downloaded model and PAE file load from disk as a new entry with a Cα score per residue', async () => {
  const before = await page.locator('#gpv-list [data-entry-id]').count();
  await tab('models');
  await page.setInputFiles('#gpv-files', [afdbCif, afdbPae]); await page.waitForTimeout(2000);
  const after = await page.locator('#gpv-list [data-entry-id]').count();
  if (after !== before + 1) throw new Error('model count ' + before + ' -> ' + after);
  const info = await page.evaluate(() => {
    const entry = window.__viewerDebug.entries().find(e => /P69905/.test(e.name));
    return entry ? { name: entry.name, atoms: entry.atoms.length, scores: entry.scores.length, hasPae: Boolean(entry.confidence && entry.confidence.pae) } : null;
  });
  if (!info) throw new Error('no entry named for P69905 after loading the fixture files');
  if (info.atoms <= 1000) throw new Error('atoms=' + info.atoms);
  if (info.scores !== 142) throw new Error('scores=' + info.scores + ' (P69905 is 142 residues, including the initiator Met)');
  if (!info.hasPae) throw new Error('the PAE file was not paired with the model on drop (AlphaFold DB -model_vN / -predicted_aligned_error_vN names)');
  console.log('       ' + info.name + ' · ' + info.atoms + ' atoms · ' + info.scores + ' Cα scores · PAE attached on drop');
});
await step('that entry is removed again so later steps see the same models as before', async () => {
  const id = await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(e => /P69905/.test(e.name)); return entry ? entry.id : null; });
  if (id === null) throw new Error('no P69905 entry to remove');
  await page.click('#gpv-list [data-entry-id="' + id + '"] button:has-text("Remove")'); await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__viewerDebug.entries().some(e => /P69905/.test(e.name)))) throw new Error('entry still present after Remove');
});

/* AlphaFold DB attaches PAE for a *fetched* entry directly (see fetchIdentifier /
   resolveAlphafold in index.html) rather than through the local file-name heuristic
   above. Route the same two real, committed fixture files as the network responses,
   so the Fetch workflow — and the domain / colour / geometry checks that need a real
   PAE matrix — run against the genuine AlphaFold DB payload with no network access. */
const afdbCifBytes = await readFile(afdbCif, 'utf8');
const afdbPaeBytes = await readFile(afdbPae, 'utf8');
const afdbListing = JSON.stringify([{
  modelEntityId: 'AF-P69905-F1',
  cifUrl: 'https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif',
  paeDocUrl: 'https://alphafold.ebi.ac.uk/files/AF-P69905-F1-predicted_aligned_error_v6.json'
}]);
await page.route('https://alphafold.ebi.ac.uk/api/prediction/P69905', route => route.fulfill({ status: 200, contentType: 'application/json', body: afdbListing }));
await page.route('https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif', route => route.fulfill({ status: 200, contentType: 'chemical/x-mmcif', body: afdbCifBytes }));
await page.route('https://alphafold.ebi.ac.uk/files/AF-P69905-F1-predicted_aligned_error_v6.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: afdbPaeBytes }));

await step('an unavailable AlphaFold fragment is rejected without loading a different structure', async () => {
  const before = await page.locator('#gpv-list [data-entry-id]').count();
  await page.fill('#gpv-fetch-id', 'AF-P69905-F999'); await page.click('#gpv-fetch');
  await page.waitForFunction(() => !document.querySelector('#gpv-fetch').disabled);
  const state = await page.locator('#gpv-state').textContent();
  if (!/no AlphaFold DB model for AF-P69905-F999/.test(state)) throw new Error('state: ' + state);
  if (await page.locator('#gpv-list [data-entry-id]').count() !== before) throw new Error('an unavailable fragment loaded another model');
});

await step('fetching P69905 from AlphaFold DB attaches the real 142×142 PAE matrix', async () => {
  await page.fill('#gpv-fetch-id', 'P69905'); await page.click('#gpv-fetch'); await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const entry = window.__viewerDebug.entries().find(e => /P69905/.test(e.name));
    return entry ? { atoms: entry.atoms.length, scores: entry.scores.length, pae: entry.confidence && entry.confidence.pae ? entry.confidence.pae.length : null } : null;
  });
  if (!info) throw new Error('no P69905 entry after fetch');
  if (info.atoms <= 1000) throw new Error('atoms=' + info.atoms);
  if (info.scores !== 142) throw new Error('scores=' + info.scores);
  if (info.pae !== 142) throw new Error('pae rows=' + info.pae);
});
await step('#gpv-current selects it and the mean pLDDT is reported', async () => {
  await page.evaluate(() => {
    const select = document.querySelector('#gpv-current');
    const option = [...select.options].find(item => /P69905/.test(item.textContent));
    select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  const text = await page.locator('#gpv-confidence').textContent();
  if (!/Mean pLDDT \d/.test(text)) throw new Error(text);
  const mean = Number(/Mean pLDDT ([\d.]+)/.exec(text)[1]);
  if (!(mean >= 60 && mean <= 100)) throw new Error('mean=' + mean);
  console.log('       ' + text.trim());
});
await step('PAE domains at 6 Å and assembly dimensions run without error on the real matrix', async () => {
  const result = await page.evaluate(() => {
    const d = window.__viewerDebug;
    const entry = d.entries().find(e => /P69905/.test(e.name));
    const domains = d.paeDomains(entry, 6);
    const size = d.assemblyDimensions(entry);
    return { domains: domains ? domains.domains.length : null, size };
  });
  if (!result.domains || result.domains < 1) throw new Error('domains=' + JSON.stringify(result));
  if (!result.size || result.size.extent < 20 || result.size.extent > 80 || result.size.exact !== true) throw new Error('size=' + JSON.stringify(result.size));
  console.log('       ' + result.domains + ' domain(s) · extent ' + result.size.extent.toFixed(1) + ' Å (exact)');
});
await step('in the workspace panel the confidence tab stacks the MSA controls above the PAE map instead of collapsing them', async () => {
  await tab('confidence'); await page.waitForTimeout(300);
  const boxes = await page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const paint = r(document.querySelector('#gpv-msa-paint')); const pae = r(document.querySelector('#gpv-pae')); const msa = r(document.querySelector('.gpv-msa'));
    const panel = document.querySelector('.gpv-side-panel');
    return { workspace: document.querySelector('#generic-protein-viewer').classList.contains('is-workspace'), msaWidth: Math.round(msa.width), paeWidth: Math.round(pae.width), panelWidth: panel.clientWidth, overlap: overlap(paint, pae) };
  });
  if (!boxes.workspace || boxes.msaWidth < 200 || boxes.paeWidth < 100 || boxes.paeWidth > boxes.panelWidth || boxes.overlap) throw new Error(JSON.stringify(boxes));
  console.log('       controls ' + boxes.msaWidth + ' px wide · PAE map ' + boxes.paeWidth + ' px in a ' + boxes.panelWidth + ' px panel');
});
await step('plddt colour mode paints a CA atom', async () => {
  await tab('appearance');
  await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
  const colour = await page.evaluate(() => {
    const d = window.__viewerDebug; const entry = d.entries().find(e => /P69905/.test(e.name));
    const atom = entry.atoms.find(a => a.atom === 'CA');
    return d.colorOptions(entry).colorfunc(atom);
  });
  if (!colour) throw new Error('no colour returned');
  await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(200);
});
await step('the fetched entry is removed so later groups see the same models as before', async () => {
  await tab('models');
  const id = await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(e => /P69905/.test(e.name)); return entry ? entry.id : null; });
  if (id === null) throw new Error('no P69905 entry to remove');
  await page.click('#gpv-list [data-entry-id="' + id + '"] button:has-text("Remove")'); await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__viewerDebug.entries().some(e => /P69905/.test(e.name)))) throw new Error('entry still present after Remove');
  await page.unroute('https://alphafold.ebi.ac.uk/api/prediction/P69905');
  await page.unroute('https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif');
  await page.unroute('https://alphafold.ebi.ac.uk/files/AF-P69905-F1-predicted_aligned_error_v6.json');
});

group('other predictors');
/* One two-chain complex written the way ColabFold, Boltz, Chai-1 and the AlphaFold Server write
   their results — file names, keys, NumPy .npz files and ModelCIF from each tool's own writer.
   See fixtures/predictors/README.md and make_fixtures.py, which regenerates them. */
const predictorDir = join(here, 'fixtures', 'predictors');
const colabfoldFiles = ['rank_001_alphafold2_multimer_v3_model_2_seed_000', 'rank_002_alphafold2_multimer_v3_model_4_seed_000']
  .flatMap(tag => [join(predictorDir, 'colabfold', 'hbdimer_unrelaxed_' + tag + '.pdb'), join(predictorDir, 'colabfold', 'hbdimer_scores_' + tag + '.json')]);
const predictorEntries = () => page.evaluate(() => window.__viewerDebug.entries().filter(e => /hbdimer|model_idx|mismatch_model/.test(e.name)).map(e => {
  const c = e.confidence || {}; const layout = window.__viewerDebug.paeTokenLayout(e);
  const counts = {}; (layout && !layout.mismatch ? layout.chainIds : []).forEach(chain => { counts[chain] = (counts[chain] || 0) + 1; });
  return { id: e.id, name: e.name, collection: e.collection, rank: e.rank, pae: c.pae ? c.pae.length : null, ptm: c.ptm, iptm: c.iptm, ranking: c.rankingScore, pairs: c.chainPairIptm || null, clash: c.hasClash, reported: c.reportedInterface || null, layout: layout ? (layout.mismatch || counts) : null, derived: layout ? layout.derived : null };
}));
const showEntry = async id => { await page.evaluate(id => { const select = document.querySelector('#gpv-current'); select.value = String(id); select.dispatchEvent(new Event('change', { bubbles: true })); }, id); await page.waitForTimeout(500); };
const removePredictorEntries = async () => {
  await tab('models');
  for (const entry of await predictorEntries()) { await page.click('#gpv-list [data-entry-id="' + entry.id + '"] button:has-text("Remove")'); await page.waitForTimeout(150); }
};

await step('ColabFold: each ranked model pairs with its scores file, keeps its rank and ColabFold’s own interface scores', async () => {
  try {
    await tab('models');
    const relaxed = join(work, 'hbdimer_relaxed_rank_001_alphafold2_multimer_v3_model_2_seed_000.pdb');
    await writeFile(relaxed, await readFile(colabfoldFiles[0], 'utf8'));
    await page.setInputFiles('#gpv-files', [...colabfoldFiles, relaxed, join(predictorDir, 'colabfold', 'config.json')]); await page.waitForTimeout(2500);
    const entries = await predictorEntries();
    if (entries.length !== 3) throw new Error('expected rank 1 unrelaxed, rank 1 relaxed and rank 2: ' + entries.map(e => e.name).join(', '));
    entries.forEach(entry => {
      const first = /rank_001/.test(entry.name);
      if (entry.pae !== 128) throw new Error(entry.name + ': PAE rows ' + entry.pae + ' (the scores file has a 128 × 128 matrix)');
      if (entry.rank !== (first ? 1 : 2)) throw new Error(entry.name + ': rank ' + entry.rank);
      if (entry.iptm !== (first ? 0.71 : 0.48) || entry.ptm !== (first ? 0.74 : 0.66)) throw new Error(entry.name + ': pTM/ipTM ' + entry.ptm + '/' + entry.iptm);
      if (!entry.reported || !entry.reported.ipsae || !('A-B' in entry.reported.ipsae)) throw new Error(entry.name + ': ColabFold’s ipsae scores were dropped');
      if (JSON.stringify(entry.layout) !== JSON.stringify({ A: 64, B: 64 }) || !entry.derived) throw new Error(entry.name + ': token layout ' + JSON.stringify(entry.layout));
    });
    console.log('       ' + entries.length + ' ColabFold models · ranks ' + entries.map(e => e.rank).join(', ') + ' · PAE 128 × 128, rows matched to chains A and B');
  } finally { await removePredictorEntries(); }
});

await step('Boltz: a zipped output folder reads its .npz PAE, ranks model 0 first and counts the ligand’s atoms as tokens', async () => {
  try {
    await tab('models');
    await page.setInputFiles('#gpv-files', [join(predictorDir, 'boltz_results_hbdimer.zip')]); await page.waitForTimeout(3000);
    let entries = await predictorEntries();
    if (entries.length !== 2) throw new Error('models: ' + entries.map(e => e.name).join(', '));
    for (const entry of entries) await showEntry(entry.id);
    entries = await predictorEntries();
    entries.forEach(entry => {
      const first = /model_0/.test(entry.name);
      if (entry.pae !== 134) throw new Error(entry.name + ': PAE rows ' + entry.pae + ' (128 residues and 6 ligand atoms)');
      if (entry.rank !== (first ? 1 : 2) || entry.ranking !== (first ? 0.83 : 0.69)) throw new Error(entry.name + ': rank ' + entry.rank + ', confidence_score ' + entry.ranking);
      if (JSON.stringify(entry.layout) !== JSON.stringify({ A: 64, B: 64, C: 6 })) throw new Error(entry.name + ': token layout ' + JSON.stringify(entry.layout));
      if (!entry.pairs || entry.pairs.length !== 3 || entry.pairs[0][1] !== (first ? 0.74 : 0.51)) throw new Error(entry.name + ': pair_chains_iptm ' + JSON.stringify(entry.pairs));
    });
    await showEntry(entries.find(e => /model_0/.test(e.name)).id);
    await tab('confidence');
    const pairs = await page.locator('#gpv-interface-metrics tr th').allTextContents();
    if (pairs.join(' ') !== 'A–B A–C B–C') throw new Error('chain-pair rows are not labelled by the model’s chains: ' + pairs.join(' '));
    if (await page.locator('#gpv-pae-plot').isHidden()) throw new Error('the PAE map is hidden for a Boltz model with a PAE file');
    console.log('       2 Boltz models · PAE 134 × 134 = A 64 + B 64 + ligand C 6 · chain pairs ' + pairs.join(', '));
  } finally { await removePredictorEntries(); }
});

await step('Boltz: the same files dropped loose pair too, and plddt_/pde_ files are read without being reported as skipped', async () => {
  try {
    await tab('models');
    const names = ['hbdimer_model_0.cif', 'confidence_hbdimer_model_0.json', 'pae_hbdimer_model_0.npz', 'plddt_hbdimer_model_0.npz', 'pde_hbdimer_model_0.npz'];
    await page.setInputFiles('#gpv-files', names.map(name => join(predictorDir, 'boltz', name))); await page.waitForTimeout(2500);
    const entries = await predictorEntries();
    if (entries.length !== 1 || entries[0].pae !== 134 || entries[0].rank !== 1) throw new Error(JSON.stringify(entries.map(e => [e.name, e.pae, e.rank])));
    const status = (await page.locator('#gpv-state').textContent()) || '';
    if (/skipped/.test(status)) throw new Error('status reports skipped files: ' + status);
    if (!(await page.locator('#gpv-import-errors').isHidden())) throw new Error('import errors shown: ' + await page.locator('#gpv-import-errors').textContent());
  } finally { await removePredictorEntries(); }
});

await step('Chai-1: samples rank by aggregate score, float32 scores read back clean, and the missing PAE is explained', async () => {
  try {
    await tab('models');
    await page.setInputFiles('#gpv-files', [join(predictorDir, 'chai_hbdimer.zip')]); await page.waitForTimeout(3000);
    const entries = await predictorEntries();
    if (entries.length !== 2) throw new Error('models: ' + entries.map(e => e.name).join(', '));
    const zero = entries.find(e => /model_idx_0/.test(e.name)); const one = entries.find(e => /model_idx_1/.test(e.name));
    if (one.rank !== 1 || zero.rank !== 2) throw new Error('sample 1 (aggregate 0.71) should rank above sample 0 (0.52): ranks ' + one.rank + ', ' + zero.rank);
    if (zero.ptm !== 0.52 || zero.iptm !== 0.44 || zero.ranking !== 0.52) throw new Error('float32 scores not cleaned: ' + zero.ptm + ', ' + zero.iptm + ', ' + zero.ranking);
    if (zero.pae !== null) throw new Error('Chai-1 writes no PAE, yet one was attached');
    if (zero.clash !== false) throw new Error('has_inter_chain_clashes: ' + zero.clash);
    if (!zero.pairs || zero.pairs[0][1] !== 0.44) throw new Error('per_chain_pair_iptm: ' + JSON.stringify(zero.pairs));
    await showEntry(zero.id); await tab('confidence');
    const note = (await page.locator('#gpv-interface-note').textContent()) || '';
    if (await page.locator('#gpv-interface-note').isHidden() || !/does not save its PAE/.test(note)) throw new Error('no note on the missing PAE: ' + note);
    const row = await page.locator('#gpv-interface-metrics tr').first().locator('th,td').allTextContents();
    if (row[0] !== 'A–B' || row[1] !== '0.440') throw new Error('chain-pair ipTM row: ' + JSON.stringify(row));
    console.log('       2 Chai-1 samples · rank from aggregate score · A–B ipTM ' + row[1] + ' · PAE note shown');
  } finally { await removePredictorEntries(); }
});

await step('a PAE whose size matches neither the residues nor the tokens is not guessed at, and says why', async () => {
  try {
    await tab('models');
    const cif = (await readFile(join(predictorDir, 'boltz', 'hbdimer_model_0.cif'), 'utf8')).split('\n').filter(line => !line.startsWith('HETATM')).join('\n');
    const structure = join(work, 'mismatch_model_0.cif'); await writeFile(structure, cif);
    const pae = join(work, 'pae_mismatch_model_0.npz'); await writeFile(pae, await readFile(join(predictorDir, 'boltz', 'pae_hbdimer_model_0.npz')));
    await page.setInputFiles('#gpv-files', [structure, pae]); await page.waitForTimeout(2500);
    const entry = (await predictorEntries()).find(e => /mismatch_model/.test(e.name));
    if (!entry || entry.pae !== 134) throw new Error('the PAE did not attach: ' + JSON.stringify(entry));
    if (typeof entry.layout !== 'string' || !/134 rows but the model has 128 residues/.test(entry.layout)) throw new Error('layout: ' + JSON.stringify(entry.layout));
    await showEntry(entry.id); await tab('confidence');
    const detail = (await page.locator('#gpv-pae-detail').textContent()) || '';
    if (!/residues not matched to rows/.test(detail)) throw new Error('the PAE detail line does not say the rows were not matched: ' + detail);
  } finally { await removePredictorEntries(); }
});

await step('the .npy reader handles a Fortran-ordered big-endian float64 array and a version 2 header', async () => {
  const result = await page.evaluate(() => {
    const make = (major, descr, fortran, shape, values, width, write) => {
      let header = "{'descr': '" + descr + "', 'fortran_order': " + (fortran ? 'True' : 'False') + ", 'shape': (" + shape.join(', ') + (shape.length === 1 ? ',' : '') + "), }";
      const prefix = major === 1 ? 10 : 12; while ((prefix + header.length + 1) % 64) header += ' '; header += '\n';
      const bytes = new Uint8Array(prefix + header.length + values.length * width); const view = new DataView(bytes.buffer);
      bytes.set([0x93, 78, 85, 77, 80, 89, major, 0]);
      if (major === 1) view.setUint16(8, header.length, true); else view.setUint32(8, header.length, true);
      for (let i = 0; i < header.length; i += 1) bytes[prefix + i] = header.charCodeAt(i);
      values.forEach((value, i) => write(view, prefix + header.length + i * width, value));
      return bytes;
    };
    /* [[1, 2, 3], [4, 5, 6]] stored column by column. */
    const fortran = window.__viewerDebug.readNpy(make(1, '>f8', true, [2, 3], [1, 4, 2, 5, 3, 6], 8, (v, at, x) => v.setFloat64(at, x, false)));
    const wide = window.__viewerDebug.readNpy(make(2, '<i8', false, [3], [7, -2, 9], 8, (v, at, x) => v.setBigInt64(at, BigInt(x), true)));
    return { fortran: Array.from(fortran.values), shape: fortran.shape, wide: Array.from(wide.values) };
  });
  if (JSON.stringify(result.fortran) !== '[1,2,3,4,5,6]' || JSON.stringify(result.shape) !== '[2,3]') throw new Error('Fortran order: ' + JSON.stringify(result));
  if (JSON.stringify(result.wide) !== '[7,-2,9]') throw new Error('version 2 int64: ' + JSON.stringify(result.wide));
});

group('interaction confidence');
/* expected-ipsae.json is the output of the reference implementation, DunbrackLab/IPSAE ipsae.py,
   on the same fixture files (make_fixtures.py records its SHA-256). ipSAE-family values are printed
   to 6 decimals and pDockQ, pDockQ2, LIS to 4, so the tolerance is half a unit in that place;
   residue counts must match exactly. tests/validate-ipsae.mjs runs the same comparison on real
   AlphaFold 3 archives. */
const expectedIpsae = JSON.parse(await readFile(join(predictorDir, 'expected-ipsae.json'), 'utf8'));
const ipsaeColumns = { ipSAE: ['ipsae', 6e-7], ipSAE_d0chn: ['ipsaeD0chn', 6e-7], ipSAE_d0dom: ['ipsaeD0dom', 6e-7], ipTM_d0chn: ['iptmD0chn', 6e-7], pDockQ: ['pdockq', 5.1e-5], pDockQ2: ['pdockq2', 5.1e-5], LIS: ['lis', 5.1e-5], ipTM_af: ['iptmModel', 5.1e-4], n0res: ['n0res', 0], n0chn: ['n0chn', 0], n0dom: ['n0dom', 0], nres1: ['nres1', 0], nres2: ['nres2', 0], dist1: ['dist1', 0], dist2: ['dist2', 0] };
const viewerIpsae = (pattern, pae, dist) => page.evaluate(({ pattern, pae, dist }) => {
  const debug = window.__viewerDebug; const entry = debug.entries().find(e => new RegExp(pattern).test(e.name));
  debug.materializeEntry(entry);
  const scores = debug.interactionScores(entry, pae, dist);
  const reported = row => ({ ...row, iptmModel: debug.reportedPairIptm(entry, row.chain1, row.chain2) });
  return { asym: scores.asym.map(reported), pairs: scores.pairs.map(pair => ({ ...pair, iptmModel: debug.reportedPairIptmMax(entry, pair.chain1, pair.chain2) })), reason: scores.reason, chains: scores.chains };
}, { pattern, pae, dist });
const compareIpsae = async (label, pattern) => {
  let count = 0; const problems = [];
  for (const [run, rows] of Object.entries(expectedIpsae.cases[label].runs)) {
    const [pae, dist] = run.split('_').map(Number);
    const mine = await viewerIpsae(pattern, pae, dist);
    if (mine.reason) throw new Error(label + ': ' + mine.reason);
    rows.forEach(row => {
      const match = row.type === 'asym' ? mine.asym.find(a => a.chain1 === row.chain1 && a.chain2 === row.chain2) : mine.pairs.find(a => a.chain1 === row.chain1 && a.chain2 === row.chain2);
      if (!match) { problems.push(run + ' ' + row.type + ' ' + row.chain1 + row.chain2 + ': no viewer row'); return; }
      Object.entries(ipsaeColumns).forEach(([column, [key, tolerance]]) => {
        count += 1;
        if (!(Math.abs(Number(match[key]) - row[column]) <= tolerance)) problems.push(run + ' ' + row.type + ' ' + row.chain1 + '→' + row.chain2 + ' ' + column + ': viewer ' + match[key] + ', ipsae.py ' + row[column]);
      });
    });
  }
  if (problems.length) throw new Error(problems.length + ' of ' + count + ' disagree: ' + problems.slice(0, 4).join('; '));
  return count;
};
const loadPredictor = async files => { await tab('models'); await page.setInputFiles('#gpv-files', files); await page.waitForTimeout(2500); };

await step('ColabFold: every score of both directions and the combined row agrees with ipsae.py at 10 Å and 15 Å', async () => {
  try {
    await loadPredictor(colabfoldFiles);
    const count = await compareIpsae('colabfold', 'rank_001');
    /* ColabFold scores its own complexes at a 15 Å cutoff, with its own reimplementation. */
    const own = await page.evaluate(() => window.__viewerDebug.entries().find(e => /rank_001/.test(e.name)).confidence.reportedInterface.ipsae);
    const at15 = await viewerIpsae('rank_001', 15, 15);
    ['A-B', 'B-A'].forEach(key => { const [a, b] = key.split('-'); const mine = at15.asym.find(row => row.chain1 === a && row.chain2 === b).ipsae; if (Math.abs(mine - own[key]) > 6e-7) throw new Error('ColabFold reports ' + key + ' ' + own[key] + ', the viewer ' + mine); });
    console.log('       ' + count + ' values against ipsae.py, and ColabFold’s own ipSAE (' + own['A-B'] + ', ' + own['B-A'] + ') reproduced at 15 Å');
  } finally { await removePredictorEntries(); }
});

await step('Boltz: the ligand is left out of the chain pairs and the scores still agree with ipsae.py', async () => {
  try {
    await loadPredictor(['hbdimer_model_0.cif', 'confidence_hbdimer_model_0.json', 'pae_hbdimer_model_0.npz'].map(name => join(predictorDir, 'boltz', name)));
    const mine = await viewerIpsae('hbdimer_model_0', 10, 10);
    if (JSON.stringify(mine.chains) !== '["A","B"]') throw new Error('chains scored: ' + JSON.stringify(mine.chains) + ' (the ligand chain C is not a partner)');
    const count = await compareIpsae('boltz', 'hbdimer_model_0');
    console.log('       ' + count + ' values against ipsae.py on a 134-token PAE with a six-atom ligand');
  } finally { await removePredictorEntries(); }
});

await step('AlphaFold 3: pDockQ uses the Cβ atom’s own pLDDT from full_data, as ipsae.py does, every score agrees, and the pair is labelled by chain', async () => {
  try {
    await loadPredictor(['fold_hbdimer_model_0.cif', 'fold_hbdimer_full_data_0.json', 'fold_hbdimer_summary_confidences_0.json'].map(name => join(predictorDir, 'af3', name)));
    const count = await compareIpsae('af3', 'fold_hbdimer_model_0');
    const source = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(e => /fold_hbdimer_model_0/.test(e.name)); return d.interactionScores(entry, 10, 10).plddtSource; });
    if (source !== 'atom_plddts') throw new Error('pLDDT read from ' + source + ', not full_data atom_plddts (the fixture’s B-factors are 0.09 off, as the server’s can be)');
    /* The server's summary lists chain_ids per token; before 2.48.0 the chain-pair table took the
       first two entries of that list as the chain names and labelled the pair "A–A". */
    const entryId = (await predictorEntries()).find(e => /fold_hbdimer_model_0/.test(e.name)).id;
    await showEntry(entryId); await tab('confidence');
    const label = await page.locator('#gpv-interface-metrics tr th').first().textContent();
    if (label !== 'A–B') throw new Error('chain-pair row labelled ' + label);
    const colabfold = expectedIpsae.cases.colabfold.runs['10_10'][0].pDockQ; const af3 = expectedIpsae.cases.af3.runs['10_10'][0].pDockQ;
    console.log('       ' + count + ' values against ipsae.py · pDockQ ' + af3 + ' from Cβ pLDDT against ' + colabfold + ' with per-residue pLDDT');
  } finally { await removePredictorEntries(); }
});

await step('the table, the cutoff switch, and scoring all shown models with a summary per chain pair', async () => {
  try {
    await loadPredictor(colabfoldFiles);
    const first = (await predictorEntries()).find(e => /rank_001/.test(e.name));
    await showEntry(first.id); await tab('confidence');
    await page.selectOption('#gpv-ipsae-pae', '10'); await page.waitForTimeout(200);
    if (await page.locator('#gpv-ipsae-run').isDisabled()) throw new Error('Score chain pairs is disabled: ' + await page.locator('#gpv-ipsae-state').textContent());
    await page.click('#gpv-ipsae-run'); await page.waitForTimeout(600);
    const cells = await page.locator('#gpv-ipsae-rows tr').first().locator('th,td').allTextContents();
    const max10 = expectedIpsae.cases.colabfold.runs['10_10'].find(row => row.type === 'max');
    const eachWay = await page.locator('#gpv-ipsae-rows tr').first().locator('td').nth(1).getAttribute('title');
    if (cells[0] !== 'A–B' || cells[1] !== max10.ipSAE.toFixed(3) || cells[2] !== '0.086 / 0.110' || eachWay !== 'A→B 0.086 · B→A 0.110' || cells[3] !== '0.710') throw new Error('row: ' + JSON.stringify(cells) + ' · ' + eachWay);
    await page.selectOption('#gpv-ipsae-pae', '15'); await page.waitForTimeout(600);
    const max15 = expectedIpsae.cases.colabfold.runs['15_15'].find(row => row.type === 'max');
    const at15 = await page.locator('#gpv-ipsae-rows tr').first().locator('td').first().textContent();
    if (at15 !== max15.ipSAE.toFixed(3)) throw new Error('after switching to 15 Å the table reads ' + at15 + ', ipsae.py ' + max15.ipSAE);
    if (!/ColabFold’s own ipSAE/.test(await page.locator('#gpv-ipsae-state').textContent())) throw new Error('ColabFold’s own ipSAE is not shown beside the viewer’s');
    await page.selectOption('#gpv-ipsae-pae', '10'); await page.waitForTimeout(300);
    await tab('models');
    await page.evaluate(labels => { [...document.querySelectorAll('#gpv-list .gpv-entry')].forEach(entry => { const toggle = entry.querySelector('input[type="checkbox"]'); const wanted = labels.some(label => entry.textContent.includes(label)); if (toggle && toggle.checked !== wanted) toggle.click(); }); }, ['rank_001', 'rank_002']);
    await page.waitForTimeout(600); await tab('confidence');
    await page.click('#gpv-ipsae-all'); await page.waitForTimeout(1200);
    const summary = await page.locator('#gpv-ipsae-ensemble-rows tr').first().locator('th,td').allTextContents();
    if (summary[0] !== 'A–B' || summary[1] !== 'ipSAE' || summary[2] !== '2' || !/rank_001/.test(summary[5])) throw new Error('summary: ' + JSON.stringify(summary));
    const download = page.waitForEvent('download', { timeout: 20000 });
    await page.click('#gpv-ipsae-csv');
    const file = join(work, 'interaction.csv'); await (await download).saveAs(file);
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    if (!/^"model","chain1","chain2","type","pae_cutoff","dist_cutoff","ipsae"/.test(lines[0])) throw new Error('CSV header: ' + lines[0]);
    if (lines.length !== 1 + 2 * 3) throw new Error('CSV rows ' + (lines.length - 1) + ', expected two models × (two directions + the combined row)');
    const methods = await page.evaluate(() => window.__viewerDebug.methodsText());
    if (!/ipSAE \(Dunbrack, 2025; PAE cutoff 10 Å/.test(methods) || !/pDockQ2 \(Zhu et al\., 2023\)/.test(methods)) throw new Error('methods text: ' + methods.slice(-500));
    const report = await page.evaluate(id => window.__viewerDebug.reportConfidence(window.__viewerDebug.entries().find(e => e.id === id)).interaction, first.id);
    if (!report || report.paeCutoff !== 10 || report.pairs[0].pair !== 'A–B' || Math.abs(report.pairs[0].ipsae - max10.ipSAE) > 0.0006) throw new Error('report carries: ' + JSON.stringify(report));
    console.log('       table A–B ipSAE ' + cells[1] + ' → ' + at15 + ' at 15 Å · summary over ' + summary[2] + ' models · CSV ' + (lines.length - 1) + ' rows · methods and report carry it');
  } finally { await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(300); await removePredictorEntries(); }
});

await step('Chai-1: with no PAE only pDockQ is scored, and the state line says why', async () => {
  try {
    await loadPredictor([join(predictorDir, 'chai_hbdimer.zip')]);
    const entry = (await predictorEntries()).find(e => /model_idx_1/.test(e.name));
    await showEntry(entry.id); await tab('confidence');
    await page.click('#gpv-ipsae-run'); await page.waitForTimeout(600);
    const cells = await page.locator('#gpv-ipsae-rows tr').first().locator('th,td').allTextContents();
    if (cells[1] !== '—' || cells[5] !== '—' || cells[6] !== '—' || !/^0\.\d{3}$/.test(cells[4]) || cells[3] !== '0.660') throw new Error('row: ' + JSON.stringify(cells));
    const state = await page.locator('#gpv-ipsae-state').textContent();
    if (!/Chai-1 does not save its PAE, so only pDockQ is available/.test(state)) throw new Error('state: ' + state);
  } finally { await removePredictorEntries(); }
});

await step('a model with one chain cannot be scored, and says so', async () => {
  await loadPredictor([afdbCif]);
  const single = await page.evaluate(() => { const entry = window.__viewerDebug.entries().find(e => /P69905/.test(e.name)); return entry ? entry.id : null; });
  try {
    if (single === null) throw new Error('the single-chain AlphaFold DB model did not load');
    await showEntry(single); await tab('confidence');
    if (!(await page.locator('#gpv-ipsae-run').isDisabled())) throw new Error('Score chain pairs is enabled on a one-chain model');
    if (!/has one protein or nucleic-acid chain; interaction scores need two/.test(await page.locator('#gpv-ipsae-state').textContent())) throw new Error('state: ' + await page.locator('#gpv-ipsae-state').textContent());
  } finally {
    if (single !== null) { await tab('models'); await page.click('#gpv-list [data-entry-id="' + single + '"] button:has-text("Remove")'); await page.waitForTimeout(300); }
  }
});

group('published predictor outputs');
/* Real files as the tools wrote them, published by others (fixtures/published/README.md): one
   barnase–barstar complex from six tools, a ligand-bound AlphaFold 3 run, and the ipSAE authors'
   Aurora A–TPX2 example with a phosphothreonine, ATP and Mg²⁺. expected-ipsae.json is ipsae.py's
   output on them. */
const publishedDir = join(here, 'fixtures', 'published');
const expectedPublished = JSON.parse(await readFile(join(publishedDir, 'expected-ipsae.json'), 'utf8'));
const publishedFiles = async folder => (await readdir(join(publishedDir, folder))).filter(name => name !== 'LICENSE').map(name => join(publishedDir, folder, name));
const allEntries = () => page.evaluate(() => window.__viewerDebug.entries().map(e => ({ id: e.id, name: e.name })));
const loadPublished = async folder => {
  const before = new Set((await allEntries()).map(e => e.id));
  await tab('models'); await page.setInputFiles('#gpv-files', await publishedFiles(folder)); await page.waitForTimeout(2500);
  const added = (await allEntries()).filter(e => !before.has(e.id));
  for (const entry of added) await showEntry(entry.id);
  return added;
};
const removeEntries = async entries => { await tab('models'); for (const entry of entries) { await page.click('#gpv-list [data-entry-id="' + entry.id + '"] button:has-text("Remove")'); await page.waitForTimeout(150); } };
const describePublished = ids => page.evaluate(ids => window.__viewerDebug.entries().filter(e => ids.includes(e.id)).map(e => {
  const d = window.__viewerDebug; const c = e.confidence || {}; const layout = d.paeTokenLayout(e); const counts = {};
  (layout && !layout.mismatch ? layout.chainIds : []).forEach(chain => { counts[chain] = (counts[chain] || 0) + 1; });
  return { name: e.name, scores: e.scores.length, rank: e.rank, pae: c.pae ? c.pae.length : null, layout: layout ? (layout.mismatch || counts) : null, ranking: c.rankingScore ?? null };
}), ids);
const importClean = async () => { if (!(await page.locator('#gpv-import-errors').isHidden())) throw new Error('import errors: ' + await page.locator('#gpv-import-errors').textContent()); };

await step('each tool’s published files load, pair with their confidence data and match PAE rows to residues', async () => {
  const cases = [
    ['foldmetrics/colabfold', { pae: 199, rank: 1, layout: { A: 110, B: 89 } }],
    ['foldmetrics/af2_multimer', { pae: 199, rank: 2, layout: { B: 110, C: 89 } }],
    ['foldmetrics/af3_server', { pae: 199, layout: { A: 110, B: 89 } }],
    ['foldmetrics/af3_mpro_ligand', { pae: 341, layout: { A: 306, B: 35 } }],
    ['foldmetrics/boltz2', { pae: 199, rank: 1, layout: { A: 110, D: 89 } }],
    ['foldmetrics/chai1', { pae: 199, rank: 1, layout: { A: 110, B: 89 } }],
    ['ipsae-aurka-tpx2', { pae: 372, layout: { A: 296, B: 43, C: 31, D: 1, E: 1 } }]
  ];
  const lines = [];
  for (const [folder, want] of cases) {
    const added = await loadPublished(folder);
    try {
      await importClean();
      const [info] = await describePublished(added.map(e => e.id));
      if (!info) throw new Error(folder + ': no model loaded');
      if (info.pae !== want.pae) throw new Error(folder + ': PAE rows ' + info.pae + ', expected ' + want.pae);
      if (want.rank !== undefined && info.rank !== want.rank) throw new Error(folder + ': rank ' + info.rank + ', expected ' + want.rank);
      if (JSON.stringify(info.layout) !== JSON.stringify(want.layout)) throw new Error(folder + ': rows matched as ' + JSON.stringify(info.layout) + ', expected ' + JSON.stringify(want.layout));
      if (!info.scores) throw new Error(folder + ': no pLDDT read');
      lines.push(folder.split('/').pop() + ' ' + info.pae);
    } finally { await removeEntries(added); }
  }
  console.log('       PAE rows matched: ' + lines.join(' · '));
});

await step('interface scores on the published files agree with ipsae.py, ligands left out as there', async () => {
  let count = 0;
  for (const [label, item] of Object.entries(expectedPublished.cases)) {
    const added = await loadPublished(item.folder);
    try {
      for (const [run, rows] of Object.entries(item.runs)) {
        const [pae, dist] = run.split('_').map(Number);
        const mine = await page.evaluate(({ name, pae, dist }) => {
          const d = window.__viewerDebug; const entry = d.entries().find(e => e.name === name);
          const scores = d.interactionScores(entry, pae, dist);
          return { asym: scores.asym.map(row => ({ ...row, iptmModel: d.reportedPairIptm(entry, row.chain1, row.chain2) })), pairs: scores.pairs.map(pair => ({ ...pair, iptmModel: d.reportedPairIptmMax(entry, pair.chain1, pair.chain2) })), reason: scores.reason };
        }, { name: item.structure, pae, dist });
        if (mine.reason) throw new Error(label + ': ' + mine.reason);
        if (!rows.length && mine.pairs.length) throw new Error(label + ': ipsae.py scores no chain pair (protein and ligand only), the viewer ' + mine.pairs.length);
        rows.forEach(row => {
          const match = row.type === 'asym' ? mine.asym.find(a => a.chain1 === row.chain1 && a.chain2 === row.chain2) : mine.pairs.find(a => a.chain1 === row.chain1 && a.chain2 === row.chain2);
          if (!match) throw new Error(label + ' ' + run + ': no viewer row for ' + row.type + ' ' + row.chain1 + row.chain2);
          Object.entries(ipsaeColumns).forEach(([column, [key, tolerance]]) => {
            if (column === 'ipTM_af' && row.ipTM_af === 0 && match[key] === null) return; /* no summary file was published */
            count += 1;
            if (!(Math.abs(Number(match[key]) - row[column]) <= tolerance)) throw new Error(label + ' ' + run + ' ' + row.type + ' ' + row.chain1 + '→' + row.chain2 + ' ' + column + ': viewer ' + match[key] + ', ipsae.py ' + row[column]);
          });
        });
      }
      if (label === 'af3_local_ligand') {
        await tab('confidence');
        const state = await page.locator('#gpv-ipsae-state').textContent();
        if (!/one protein or nucleic-acid chain and 1 ligand or ion chain; ligands are not scored as partners/.test(state)) throw new Error('state for a protein–ligand model: ' + state);
        if (!(await page.locator('#gpv-ipsae-run').isDisabled())) throw new Error('Score chain pairs is enabled with one polymer chain');
      }
    } finally { await removeEntries(added); }
  }
  console.log('       ' + count + ' values against ipsae.py on five published predictions, one with a modified residue and ligands');
});

await step('Chai-1: a PAE saved beside the run pairs with its model, and the pair ipTM is the larger of Chai’s two directions', async () => {
  const added = await loadPublished('foldmetrics/chai1');
  try {
    const result = await page.evaluate(() => { const d = window.__viewerDebug; const entry = d.entries().find(e => e.name === 'pred.model_idx_0.cif'); const m = entry.confidence.chainPairIptm; return { forward: m[0][1], reverse: m[1][0], pair: d.reportedPairIptmMax(entry, 'A', 'B'), iptm: entry.confidence.iptm }; });
    if (!(result.forward < result.reverse)) throw new Error('the published per-chain-pair ipTM was expected to be asymmetric: ' + JSON.stringify(result));
    if (result.pair !== result.reverse || Math.abs(result.pair - result.iptm) > 1e-6) throw new Error('pair ipTM ' + result.pair + ' is not the larger direction ' + result.reverse + ' (Chai’s own interface ipTM ' + result.iptm + ')');
    await tab('confidence'); await page.click('#gpv-ipsae-run'); await page.waitForTimeout(600);
    const cells = await page.locator('#gpv-ipsae-rows tr').first().locator('th,td').allTextContents();
    if (cells[1] === '—' || cells[3] !== result.pair.toFixed(3)) throw new Error('row: ' + JSON.stringify(cells));
    console.log('       A→B ' + result.forward.toFixed(3) + ', B→A ' + result.reverse.toFixed(3) + ' → pair ipTM ' + cells[3] + ' · ipSAE ' + cells[1]);
  } finally { await removeEntries(added); }
});

await step('an experimental structure fetched from the PDB is not offered prediction-confidence scores, and says why', async () => {
  /* A PDB entry has B-factors, not pLDDT, and no PAE: every score would be blank. */
  const body = await readFile(join(predictorDir, 'af3', 'fold_hbdimer_model_0.cif'), 'utf8');
  await page.route('https://files.rcsb.org/download/9zzz.cif', route => route.fulfill({ status: 200, contentType: 'chemical/x-mmcif', body }));
  const before = new Set((await allEntries()).map(e => e.id));
  try {
    await tab('models'); await page.fill('#gpv-fetch-id', '9zzz'); await page.click('#gpv-fetch'); await page.waitForTimeout(2500);
    const entry = (await allEntries()).find(e => !before.has(e.id));
    if (!entry) throw new Error('the stubbed PDB entry did not load');
    try {
      await showEntry(entry.id); await tab('confidence');
      if (!(await page.locator('#gpv-ipsae-run').isDisabled())) throw new Error('Score chain pairs is enabled on an experimental structure');
      const state = await page.locator('#gpv-ipsae-state').textContent();
      if (!/carries no pLDDT or PAE .* do not apply/.test(state)) throw new Error('state: ' + state);
    } finally { await removeEntries([entry]); }
  } finally { await page.unroute('https://files.rcsb.org/download/9zzz.cif'); }
});

await step('an RNA chain carries pLDDT through its C1′ atoms, so a nucleic-acid prediction is coloured by confidence', async () => {
  /* Before 2.48.0 pLDDT was read from Cα atoms only, and an RNA or DNA prediction had none. */
  const lines = []; let serial = 1;
  ['G', 'G', 'A', 'C', 'U', 'U', 'C', 'G'].forEach((base, i) => {
    [["P", 0], ["C4'", 1.5], ["C1'", 3.0]].forEach(([name, dx]) => {
      const b = (60 + i * 4).toFixed(2);
      lines.push('ATOM  ' + String(serial++).padStart(5) + ' ' + name.padEnd(4) + ' ' + base.padStart(3) + ' R' + String(i + 1).padStart(4) + '    ' + (i * 6 + dx).toFixed(3).padStart(8) + (0).toFixed(3).padStart(8) + (i * 0.5).toFixed(3).padStart(8) + '  1.00' + b.padStart(6) + '           ' + name[0]);
    });
  });
  const file = join(work, 'rna_model.pdb'); await writeFile(file, lines.join('\n') + '\nEND\n');
  const before = new Set((await allEntries()).map(e => e.id));
  await tab('models'); await page.setInputFiles('#gpv-files', [file]); await page.waitForTimeout(1500);
  const entry = (await allEntries()).find(e => !before.has(e.id));
  try {
    const info = await page.evaluate(id => { const e = window.__viewerDebug.entries().find(x => x.id === id); return { scores: e.scores.length, mean: e.scores.reduce((a, b) => a + b, 0) / e.scores.length }; }, entry.id);
    if (info.scores !== 8 || Math.abs(info.mean - 74) > 1e-9) throw new Error('RNA pLDDT: ' + JSON.stringify(info));
  } finally { await removeEntries([entry]); }
});

group('interaction confidence: review fixes');
/* Each step here reproduced a defect found reviewing 2.47.0–2.48.0 before it was fixed. */
const max10 = expectedIpsae.cases.colabfold.runs['10_10'].find(row => row.type === 'max');
const loadFiles = async files => { const before = new Set((await allEntries()).map(e => e.id)); await tab('models'); await page.setInputFiles('#gpv-files', files); await page.waitForTimeout(2500); return (await allEntries()).filter(e => !before.has(e.id)); };

await step('scores computed before the PAE arrived are recomputed when it attaches', async () => {
  /* Fresh names: confidence files already dropped stay registered and would pair at once. */
  const structure = join(work, 'stale_unrelaxed_rank_001_alphafold2_multimer_v3_model_2_seed_000.pdb'); await writeFile(structure, await readFile(colabfoldFiles[0], 'utf8'));
  const scoresFile = join(work, 'stale_scores_rank_001_alphafold2_multimer_v3_model_2_seed_000.json'); await writeFile(scoresFile, await readFile(colabfoldFiles[1], 'utf8'));
  const added = await loadFiles([structure]);
  try {
    await showEntry(added[0].id); await tab('confidence'); await page.click('#gpv-ipsae-run'); await page.waitForTimeout(500);
    const before = await page.locator('#gpv-ipsae-rows tr td').first().textContent();
    if (before !== '—') throw new Error('without a PAE ipSAE should be blank, read ' + before);
    await loadFiles([scoresFile]); await showEntry(added[0].id); await tab('confidence'); await page.waitForTimeout(400);
    const after = await page.locator('#gpv-ipsae-rows tr td').first().textContent();
    if (after !== max10.ipSAE.toFixed(3)) throw new Error('after the scores file attached the table still reads ' + after + ' (ipsae.py ' + max10.ipSAE + ')');
  } finally { await removeEntries(added); }
});

await step('an experimental structure opened from disk has no pLDDT and is not offered interface scores', async () => {
  const cif = await readFile(join(predictorDir, 'af3', 'fold_hbdimer_model_0.cif'), 'utf8');
  const crystal = join(work, 'crystal_from_disk.cif'); await writeFile(crystal, cif.replace(/^data_.*$/m, line => line + "\n_exptl.entry_id XTAL\n_exptl.method 'X-RAY DIFFRACTION'"));
  const pdbText = await readFile(colabfoldFiles[0], 'utf8');
  const nmr = join(work, 'nmr_from_disk.pdb'); await writeFile(nmr, 'EXPDTA    SOLUTION NMR\n' + pdbText);
  const added = await loadFiles([crystal, nmr]);
  try {
    for (const entry of added) {
      await showEntry(entry.id); await tab('confidence');
      const info = await page.evaluate(id => { const d = window.__viewerDebug; const e = d.entries().find(x => x.id === id); return { scores: e.scores.length, method: e.experimentalMethod, colour: typeof (d.colorOptions(e).colorfunc) }; }, entry.id);
      if (info.scores !== 0 || !info.method) throw new Error(entry.name + ': B-factors read as pLDDT (' + JSON.stringify(info) + ')');
      if (!(await page.locator('#gpv-ipsae-run').isDisabled())) throw new Error(entry.name + ': Score chain pairs is enabled');
      const state = await page.locator('#gpv-ipsae-state').textContent();
      if (!/is an experimental structure \((x-ray diffraction|solution nmr)\): its B-factors are not pLDDT/.test(state)) throw new Error(entry.name + ': ' + state);
    }
  } finally { await removeEntries(added); }
});

await step('the summary across models pools only models of the same complex, and Score all is not held back by a monomer', async () => {
  const af3Barnase = ['fold_barnase_barstar_s318_model_0.cif', 'fold_barnase_barstar_s318_full_data_0.json', 'fold_barnase_barstar_s318_summary_confidences_0.json'].map(f => join(publishedDir, 'foldmetrics', 'af3_server', f));
  const added = await loadFiles([...colabfoldFiles, ...af3Barnase, afdbCif]);
  try {
    await tab('models'); await page.click('#gpv-show-all'); await page.waitForTimeout(400);
    const monomer = added.find(e => /P69905/.test(e.name)); await showEntry(monomer.id); await tab('confidence');
    if (await page.locator('#gpv-ipsae-all').isDisabled()) throw new Error('Score all shown models is disabled because the current model is a monomer');
    await page.click('#gpv-ipsae-all'); await page.waitForTimeout(1500);
    const hbdimer = added.find(e => /rank_001/.test(e.name)); await showEntry(hbdimer.id); await tab('confidence');
    const rows = await page.locator('#gpv-ipsae-ensemble-rows tr').evaluateAll(list => list.map(row => [...row.querySelectorAll('th,td')].map(cell => cell.textContent)));
    /* The suite's own model_a/b/c share one sequence and form a third, correctly pooled, row. */
    const pooled = rows.filter(cells => /^A–B/.test(cells[0]) && !/model_[abc]\.pdb/.test(cells[0]));
    if (pooled.length !== 2) throw new Error('two different A–B complexes should give two summary rows: ' + JSON.stringify(rows));
    const synthetic = pooled.find(cells => cells[2] === '2'); const barnase = pooled.find(cells => cells[2] === '1');
    if (!synthetic || !barnase || synthetic[0] === barnase[0]) throw new Error('rows not told apart: ' + JSON.stringify(pooled));
  } finally { await removeEntries(added); }
});

await step('residues told apart only by an insertion code keep their own PAE rows', async () => {
  /* Residue A:11 relabelled 10A: only the label changes, so every score must stay as it was. */
  const edited = (await readFile(colabfoldFiles[0], 'utf8')).split('\n').map(line => line.startsWith('ATOM') && line[21] === 'A' && Number(line.slice(22, 26)) === 11 ? line.slice(0, 17) + 'SER' + line.slice(20, 22) + '  10A' + line.slice(27) : line).join('\n');
  const dir = join(work, 'insertion'); await mkdir(dir, { recursive: true });
  const structure = join(dir, basename(colabfoldFiles[0])); await writeFile(structure, edited);
  const added = await loadFiles([structure, colabfoldFiles[1]]);
  try {
    await showEntry(added[0].id);
    const ipsae = await page.evaluate(id => { const d = window.__viewerDebug; const e = d.entries().find(x => x.id === id); return d.interactionScores(e, 10, 10).pairs[0].ipsae; }, added[0].id);
    if (Math.abs(ipsae - max10.ipSAE) > 6e-7) throw new Error('ipSAE ' + ipsae + ' after relabelling a residue 10A, ' + max10.ipSAE + ' before');
  } finally { await removeEntries(added); }
});

await step('the PAE layout is built once per model, float32 arrays stay float32, and chain_ids is stored once per chain', async () => {
  const added = await loadFiles(['fold_hbdimer_model_0.cif', 'fold_hbdimer_full_data_0.json', 'fold_hbdimer_summary_confidences_0.json'].map(name => join(predictorDir, 'af3', name)).concat(['barnase_barstar_model_0.cif', 'confidence_barnase_barstar_model_0.json', 'pae_barnase_barstar_model_0.npz'].map(f => join(publishedDir, 'foldmetrics', 'boltz2', f))));
  try {
    for (const entry of added) await showEntry(entry.id);
    const info = await page.evaluate(() => {
      const d = window.__viewerDebug; const boltz = d.entries().find(e => /barnase_barstar_model_0/.test(e.name)); const af3 = d.entries().find(e => /fold_hbdimer_model_0/.test(e.name));
      const bytes = new Uint8Array(96); const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2,), }"; bytes.set([0x93, 78, 85, 77, 80, 89, 1, 0]); new DataView(bytes.buffer).setUint16(8, 86, true); for (let i = 0; i < 86; i += 1) bytes[10 + i] = i < header.length ? header.charCodeAt(i) : (i === 85 ? 10 : 32);
      const withData = new Uint8Array(104); withData.set(bytes); new DataView(withData.buffer).setFloat32(96, 1.5, true); new DataView(withData.buffer).setFloat32(100, -2.25, true);
      const array = d.readNpy(withData);
      return { cached: d.paeTokenLayout(boltz) === d.paeTokenLayout(boltz), float32: array.values instanceof Float32Array, values: Array.from(array.values), chainIds: af3.confidence.chainIds };
    });
    if (!info.cached) throw new Error('the PAE layout is rebuilt on every call');
    if (!info.float32 || JSON.stringify(info.values) !== '[1.5,-2.25]') throw new Error('float32 npy read as ' + JSON.stringify(info));
    if (JSON.stringify(info.chainIds) !== '["A","B"]') throw new Error('per-token chain_ids stored as ' + JSON.stringify(info.chainIds).slice(0, 80));
  } finally { await removeEntries(added); }
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
await step('a model fetched by ID enables the share link, and joins an overlay without switching it to one at a time', async () => {
  const before = await page.locator('#gpv-list [data-entry-id]').count();
  const modeBefore = await page.inputValue('#gpv-view-mode');
  try {
    await tab('models'); await page.selectOption('#gpv-view-mode', 'overlay'); await page.waitForTimeout(300);
    await page.fill('#gpv-fetch-id', '1tst'); await page.click('#gpv-fetch'); await page.waitForTimeout(2500);
    const after = await page.locator('#gpv-list [data-entry-id]').count();
    if (after !== before + 1) throw new Error('model count ' + before + ' → ' + after + ' · ' + (await page.locator('#gpv-state').textContent()));
    if (await page.locator('#gpv-share-link').isDisabled()) throw new Error('share link still disabled');
    const mode = await page.inputValue('#gpv-view-mode');
    if (mode !== 'overlay') throw new Error('the fetch switched View mode to ' + mode);
  } finally { await page.selectOption('#gpv-view-mode', modeBefore); await page.waitForTimeout(300); }
});
await step('an .a3m dropped on its own colours a fetched model, and the import says it was added', async () => {
  /* Before 2.52.0 a loose alignment only matched models opened as individual files: with a fetched
     model Colour by MSA stayed disabled and the import said "No supported structures found". */
  const query = 'A'.repeat(30); const lines = ['>query', query];
  for (let k = 0; k < 4; k += 1) { const letters = query.split(''); letters[4] = 'CDEF'[k]; lines.push('>seq' + k, letters.join('')); }
  const a3m = join(work, 'loose_alignment.a3m'); await writeFile(a3m, lines.join('\n') + '\n');
  const schemeBefore = await page.inputValue('#gpv-color-mode');
  try {
    const active = await page.evaluate(() => (window.__viewerDebug.activeEntry() || {}).collection);
    if (active !== 'RCSB PDB') throw new Error('setup: the active model is from ' + active + ', not the fetched entry');
    await page.setInputFiles('#gpv-files', [a3m]); await page.waitForTimeout(800);
    const status = (await page.locator('#gpv-state').textContent()) || '';
    if (!/Alignment added: loose_alignment\.a3m/.test(status)) throw new Error('import status: ' + status);
    await tab('confidence');
    if (await page.locator('#gpv-msa-paint').isDisabled()) throw new Error('Colour by MSA stayed disabled: ' + await page.locator('#gpv-msa-state').textContent());
    await page.click('#gpv-msa-paint'); await page.waitForTimeout(500);
    const count = await page.evaluate(() => (window.__viewerDebug.residueData() || {}).count || 0);
    if (count < 30) throw new Error('MSA colouring painted ' + count + ' residues of the fetched model');
  } finally {
    await tab('annotate'); await page.click('#gpv-data-clear'); await page.waitForTimeout(200);
    await tab('appearance'); await page.selectOption('#gpv-color-mode', schemeBefore); await page.waitForTimeout(300);
  }
});
await step('a structure fetched from the PDB is not painted on the pLDDT scale', async () => {
  /* An RCSB entry carries crystallographic B-factors, not confidence, so it has no scores. The
     stubbed file's B-factors are pLDDT-like on purpose: before 2.46.1 the view painted them on the
     pLDDT scale anyway while the sequence strip did not, so a crystal structure read as a
     prediction. It must take its model colour, as the strip does. */
  await tab('appearance'); await page.selectOption('#gpv-color-mode', 'plddt'); await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const d = window.__viewerDebug; const entry = d.entries().find(e => e.collection === 'RCSB PDB');
    if (!entry) return null;
    const atom = entry.atoms.find(a => a.atom === 'CA'); const options = d.colorOptions(entry);
    return { scores: entry.scores.length, colour: options.colorfunc ? options.colorfunc(atom) : options.color, own: entry.color, b: Number(atom.b) };
  });
  if (!state) throw new Error('no entry from the RCSB fetch');
  if (state.scores) throw new Error('the PDB entry carries ' + state.scores + ' confidence scores');
  if (state.colour !== state.own) throw new Error('pLDDT mode painted the PDB entry ' + state.colour + ' (B-factor ' + state.b + ') instead of its model colour ' + state.own);
  await page.selectOption('#gpv-color-mode', 'structure'); await page.waitForTimeout(200);
});
await step('the share link reopens the fetched model with its annotations', async () => {
  await tab('annotate');
  await page.fill('#gpv-screen-text', 'Shared panel'); await page.click('#gpv-add-screen-text'); await page.waitForTimeout(300);
  /* Before 2.46.2 a chain colour lived only in memory: it was lost on reload, in session files and
     in share links. Chain colours are global by chain id, so setting A here colours 1tst's chain A. */
  await tab('appearance'); const modeBefore = await page.inputValue('#gpv-color-mode');
  await tab('models'); await page.locator('#gpv-chain-rows input[aria-label="Colour for chain A"]').fill('#123456'); await page.waitForTimeout(300);
  await tab('publish');
  await page.click('#gpv-share-link'); await page.waitForTimeout(1000);
  await tab('models'); await page.click('#gpv-chain-colors-reset'); await page.waitForTimeout(200);
  await tab('appearance'); await page.selectOption('#gpv-color-mode', modeBefore); await page.waitForTimeout(200);
  await tab('publish');
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
  await shared.click('[data-gpv-tab="models"]'); await shared.waitForTimeout(300);
  const sharedA = await shared.locator('#gpv-chain-rows input[aria-label="Colour for chain A"]').inputValue();
  if (sharedA !== '#123456') throw new Error('the shared page gives chain A ' + sharedA + ', not the colour it was shared with');
  const sharedB = await shared.locator('#gpv-chain-rows input[aria-label="Colour for chain B"]').inputValue();
  if (sharedB === '#123456') throw new Error('chain B took chain A’s override');
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
console.log('steps retried after a timeout: ' + retries);
/* What the safety net cost and what it had to do. A step named on the `failed steps` line and
   not on the `suspect` one failed on its own; a suspect step ran on a page recovery could not
   put back, so its failure says as much about the recovery as about the viewer. */
console.log('safety net: baseline ' + baselineMs + ' ms · marks ' + (markMs / 1000).toFixed(1) + ' s over ' + steps + ' steps · recoveries ' + recoveries + (recoveries ? ' in ' + (recoveryMs / 1000).toFixed(1) + ' s' : '') + ' · incomplete ' + incompleteRecoveries);
console.log('failed steps: ' + (failures.length ? failures.join(', ') : 'none'));
console.log('failed on their own: ' + (failures.filter(name => !suspect.includes(name)).length ? failures.filter(name => !suspect.includes(name)).join(', ') : 'none'));
console.log('failed after an incomplete recovery (suspect): ' + (suspect.length ? suspect.join(', ') : 'none'));
process.exit(failures.length || consoleErrors.length || reportErrors.length ? 1 : 0);
