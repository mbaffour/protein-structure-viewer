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
  await page.selectOption('#gpv-export-mode', 'pixels'); await page.waitForTimeout(200);
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
await step('one panel per model downloads a lettered PNG three panels wide with resolution metadata', async () => {
  await page.selectOption('#gpv-export-mode', 'print'); await page.selectOption('#gpv-print-width', '85'); await page.waitForTimeout(200);
  if (await page.locator('#gpv-model-panels').isDisabled()) throw new Error('button disabled with three models loaded');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#gpv-model-panels');
  const file = join(work, 'model-panels.png'); await (await download).saveAs(file);
  const bytes = await readFile(file);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (Math.abs(width - 3 * 1004) > 6 || !bytes.includes('pHYs')) throw new Error(width + 'x' + height + ' pHYs=' + bytes.includes('pHYs'));
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
  await page.mouse.move(before.x - before.scrollX, before.y - before.scrollY); await page.waitForTimeout(300);
  const hint = (await page.locator('#gpv-hover').textContent()) || '';
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
  /* Three 700 px cells in one row at the 3:2 aspect: 466 px of image plus a caption strip of about 79 px. */
  if (width !== 2100 || height < 500 || height > 620 || !png.includes('pHYs')) throw new Error('figure PNG ' + width + ' × ' + height + (png.includes('pHYs') ? '' : ' without dpi'));
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
console.log('steps retried after a timeout: ' + retries);
/* What the safety net cost and what it had to do. A step named on the `failed steps` line and
   not on the `suspect` one failed on its own; a suspect step ran on a page recovery could not
   put back, so its failure says as much about the recovery as about the viewer. */
console.log('safety net: baseline ' + baselineMs + ' ms · marks ' + (markMs / 1000).toFixed(1) + ' s over ' + steps + ' steps · recoveries ' + recoveries + (recoveries ? ' in ' + (recoveryMs / 1000).toFixed(1) + ' s' : '') + ' · incomplete ' + incompleteRecoveries);
console.log('failed steps: ' + (failures.length ? failures.join(', ') : 'none'));
console.log('failed on their own: ' + (failures.filter(name => !suspect.includes(name)).length ? failures.filter(name => !suspect.includes(name)).join(', ') : 'none'));
console.log('failed after an incomplete recovery (suspect): ' + (suspect.length ? suspect.join(', ') : 'none'));
process.exit(failures.length || consoleErrors.length || reportErrors.length ? 1 : 0);
