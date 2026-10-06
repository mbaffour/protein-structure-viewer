/* Optional network-dependent release check. Exercise the actual hosted page and services.
   PSV_URL can point at a local HTTP server for testing a release candidate. */
import { chromium, firefox, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = new URL(process.env.PSV_URL || 'https://mbaffour.github.io/protein-structure-viewer/');
url.searchParams.set('debug', '1');
const engine = process.env.PSV_BROWSER || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const browser = await ({ chromium, firefox, webkit }[engine]).launch({
  ...(engine === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] } : {})
});
const errors = [];
const output = process.env.PSV_ARTIFACTS || '/tmp/psv-release-smoke';
await mkdir(output, { recursive: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__viewerDebug));
    for (const identifier of ['1ubq', 'P69905']) {
      await page.click('[data-gpv-tab="models"]');
      await page.fill('#gpv-fetch-id', identifier);
      await page.click('#gpv-fetch');
      await page.waitForFunction(() => !document.querySelector('#gpv-fetch').disabled, { }, { timeout: 60000 });
      const entries = await page.evaluate(() => window.__viewerDebug.entries().map(e => ({
        name: e.name, atoms: e.atoms.length, scores: e.scores.length,
        pae: e.confidence?.pae?.length || 0
      })));
      const entry = entries.find(e => e.name.toLowerCase().includes(identifier.toLowerCase()));
      assert.ok(entry?.atoms > 500, JSON.stringify({ identifier, entries, state: await page.locator('#gpv-state').textContent() }));
      if (identifier === 'P69905') { assert.equal(entry.scores, 142); assert.equal(entry.pae, 142); }
      console.log(`PASS ${engine} ${viewport.width}px fetch ${identifier}: ${JSON.stringify(entry)}`);
    }
    for (const tab of ['appearance', 'annotate', 'compare', 'confidence', 'publish', 'models']) {
      await page.click(`[data-gpv-tab="${tab}"]`);
      assert.equal(await page.locator(`[data-gpv-tab="${tab}"]`).getAttribute('aria-selected'), 'true');
    }
    const dimensions = await page.evaluate(() => ({
      width: innerWidth, document: document.documentElement.scrollWidth,
      canvas: document.querySelector('#gpv-stage canvas').getBoundingClientRect().toJSON()
    }));
    assert.ok(dimensions.document <= dimensions.width + 1, 'horizontal page overflow: ' + JSON.stringify(dimensions));
    assert.ok(dimensions.canvas.width > 100 && dimensions.canvas.height > 100, 'collapsed 3D canvas');
    if (viewport.width <= 520) assert.ok(dimensions.canvas.height <= 380, 'phone viewport lost its compact height: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: `${output}/${engine}-${viewport.width}.png`, fullPage: true });
    console.log(`PASS ${engine} ${viewport.width}px tabs, layout and canvas`);
    const before = await page.locator('#gpv-list [data-entry-id]').count();
    await page.fill('#gpv-fetch-id', 'AF-P69905-F999');
    await page.click('#gpv-fetch');
    await page.waitForFunction(() => !document.querySelector('#gpv-fetch').disabled, {}, { timeout: 60000 });
    assert.match(await page.locator('#gpv-state').textContent(), /no AlphaFold DB model for AF-P69905-F999/);
    assert.equal(await page.locator('#gpv-list [data-entry-id]').count(), before, 'wrong AlphaFold fragment loaded');
    console.log(`PASS ${engine} ${viewport.width}px unavailable fragment rejected`);
    await page.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  console.log('PASS live release smoke: no browser errors');
} finally { await browser.close(); }
