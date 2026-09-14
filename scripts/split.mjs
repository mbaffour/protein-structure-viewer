#!/usr/bin/env node
/*
 * scripts/split.mjs — the one-off that carved index.html into src/.
 *
 * index.html is the shipped artefact: one HTML file, no build required to use
 * it. This script exists so that the *source* layout under src/ can be
 * regenerated from a known-good index.html, which makes the split reproducible
 * and auditable rather than a hand edit nobody can check.
 *
 * It is idempotent: running it again over an unchanged index.html writes the
 * same bytes into the same files. Run it only when you need to re-derive src/
 * from index.html (normally the flow is the other way round — edit src/, then
 * `node scripts/build.mjs`).
 *
 *   node scripts/split.mjs            rewrite src/ from index.html
 *   node scripts/split.mjs --dry-run  report the plan, write nothing
 *
 * The layout it produces (see scripts/build.mjs, which concatenates it back):
 *
 *   src/00-head.html   everything up to and including the `<script>` line and
 *                      the `(() => {` line that open the viewer's main IIFE
 *   src/js/00-preamble.js
 *                      the IIFE body before the first section marker
 *   src/js/NN-<slug>.js
 *                      one file per `  /* ---------- Section name ---------- *\/`
 *                      marker, the marker line included at the top
 *   src/99-tail.html   the `})();` line that closes the IIFE and everything
 *                      after it
 *
 * Every byte is preserved. Lines are kept with their own newline attached, so
 * concatenating the parts in order is exactly the original file.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'index.html');
const srcDir = join(root, 'src');
const jsDir = join(srcDir, 'js');
const dryRun = process.argv.includes('--dry-run');

/* Split keeping each line's trailing newline, so lines.join('') === text. */
const text = readFileSync(indexPath, 'utf8');
const lines = text.split(/(?<=\n)/);
const at = n => lines[n - 1]; // 1-based, like an editor
const trimEol = s => s.replace(/\r?\n$/, '');

/* ---- Locate the viewer's main IIFE -------------------------------------
 * The page holds several `<script>` blocks. The one we care about is the sole
 * block that opens with a bare `<script>` line immediately followed by a bare
 * `(() => {` line. (The CDN-fallback block and the icon block both put a
 * comment between the two, and the `<script>` inside the report template is a
 * string, not a real tag.) */
const opens = [];
for (let n = 2; n <= lines.length; n += 1) {
  if (trimEol(at(n)) === '(() => {' && trimEol(at(n - 1)) === '<script>') opens.push(n);
}
if (opens.length !== 1) {
  throw new Error(`expected exactly one "<script>" + "(() => {" pair, found ${opens.length}: lines ${opens.join(', ')}`);
}
const iifeOpen = opens[0];

/* The IIFE closes at the first bare `})();` line that is followed by a bare
 * `</script>` line. */
let iifeClose = -1;
for (let n = iifeOpen + 1; n < lines.length; n += 1) {
  if (trimEol(at(n)) === '})();' && trimEol(at(n + 1)) === '</script>') { iifeClose = n; break; }
}
if (iifeClose < 0) throw new Error('could not find the "})();" line closing the main IIFE');

/* ---- Find the section markers -----------------------------------------
 * A marker is a line that is exactly two spaces, then `/* ----------`, i.e. a
 * comment at the top level of the IIFE body. The same shape appears in the CSS
 * above the script, so only markers strictly inside the IIFE count. */
const MARKER = /^ {2}\/\* -{10} (.*?)\s*(?:-{10}.*)?$/;
const isMarker = line => / {2}\/\* -{10} /.test(line) && line.startsWith('  /* ----------');

const allMarkers = [];
for (let n = 1; n <= lines.length; n += 1) if (isMarker(at(n))) allMarkers.push(n);

const outside = allMarkers.filter(n => n < iifeOpen || n > iifeClose);

/* The report template is a long template literal that emits a second HTML page.
 * Its text could in principle contain a line shaped like a marker; if it does,
 * that line is data, not a section boundary, so it must not become a split
 * point. Work out the literal's extent and exclude anything inside it. */
let templateStart = -1;
let templateEnd = -1;
for (let n = iifeOpen; n <= iifeClose; n += 1) {
  if (trimEol(at(n)) === '  function reportTemplate(data) {') {
    for (let m = n + 1; m <= iifeClose; m += 1) {
      if (/^\s*return `/.test(at(m))) { templateStart = m; break; }
    }
    if (templateStart > 0) {
      for (let m = templateStart + 1; m <= iifeClose; m += 1) {
        if (/`;\s*$/.test(trimEol(at(m)))) { templateEnd = m; break; }
      }
    }
    break;
  }
}

const inTemplate = templateStart > 0 && templateEnd > 0
  ? allMarkers.filter(n => n >= templateStart && n <= templateEnd)
  : [];

const markers = allMarkers.filter(n => n > iifeOpen && n < iifeClose && !inTemplate.includes(n));

const slug = title => title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'section';

/* ---- Assemble the part list -------------------------------------------- */
const width = String(markers.length).length > 2 ? 3 : 2;
const pad = n => String(n).padStart(width, '0');

const parts = [];
parts.push({ path: join(srcDir, '00-head.html'), from: 1, to: iifeOpen });
parts.push({ path: join(jsDir, `${pad(0)}-preamble.js`), from: iifeOpen + 1, to: (markers[0] ?? iifeClose) - 1 });
markers.forEach((start, i) => {
  const end = (markers[i + 1] ?? iifeClose) - 1;
  const title = (at(start).match(MARKER) || [, `section ${i + 1}`])[1];
  parts.push({ path: join(jsDir, `${pad(i + 1)}-${slug(title)}.js`), from: start, to: end, title });
});
parts.push({ path: join(srcDir, '99-tail.html'), from: iifeClose, to: lines.length });

/* ---- Report ------------------------------------------------------------- */
console.log(`index.html: ${lines.length} lines`);
console.log(`main IIFE: opens line ${iifeOpen} ("(() => {"), closes line ${iifeClose} ("})();")`);
if (templateStart > 0) console.log(`reportTemplate literal: lines ${templateStart}-${templateEnd}`);
console.log(`marker lines in file: ${allMarkers.length}`);
if (outside.length) console.log(`  outside the IIFE (not split points): ${outside.join(', ')}`);
if (inTemplate.length) console.log(`  inside the report template literal (skipped): ${inTemplate.join(', ')}`);
console.log(`split points: ${markers.length}`);
console.log(`parts: ${parts.length}`);

/* ---- Write -------------------------------------------------------------- */
if (dryRun) {
  for (const p of parts) console.log(`  ${p.path.slice(root.length + 1)}  lines ${p.from}-${p.to}`);
  process.exit(0);
}

/* Rewrite src/ from scratch so a re-run never leaves an orphan from an earlier
 * split behind; that is what makes the script idempotent. */
if (existsSync(jsDir)) for (const f of readdirSync(jsDir)) if (f.endsWith('.js')) rmSync(join(jsDir, f));
mkdirSync(jsDir, { recursive: true });

let written = 0;
for (const p of parts) {
  const body = lines.slice(p.from - 1, p.to).join('');
  writeFileSync(p.path, body);
  written += body.length;
  console.log(`  wrote ${p.path.slice(root.length + 1)}  (lines ${p.from}-${p.to})`);
}

if (written !== text.length) throw new Error(`byte total mismatch: parts ${written}, index.html ${text.length}`);
console.log(`\n${written} bytes written, matching index.html exactly.`);
console.log('Now run: node scripts/build.mjs --check');
