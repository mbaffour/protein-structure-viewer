#!/usr/bin/env node
/*
 * scripts/build.mjs — regenerate index.html from src/.
 *
 * The product promise is "one HTML file": index.html is the shipped artefact
 * and is committed. src/ holds the same bytes cut into readable pieces, and
 * this script concatenates them back, in order, with nothing added and nothing
 * reformatted.
 *
 *   node scripts/build.mjs          write index.html from src/
 *   node scripts/build.mjs --check  compare only; exit 1 if they differ
 *
 * --check is the drift guard: it fails if index.html was edited directly, or if
 * src/ was edited without rebuilding. CI runs it on every change.
 *
 * Order is lexical: src/00-head.html, then src/js/*.js sorted by filename
 * (their two-digit prefixes give the order), then src/99-tail.html. No
 * dependencies; Node 16 or newer.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const jsDir = join(srcDir, 'js');
const indexPath = join(root, 'index.html');
const check = process.argv.includes('--check');

if (!existsSync(srcDir)) {
  console.error(`build: ${srcDir} does not exist. Run "node scripts/split.mjs" to derive it from index.html.`);
  process.exit(1);
}

const jsParts = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
if (!jsParts.length) {
  console.error(`build: no .js parts found in ${jsDir}`);
  process.exit(1);
}

const parts = [
  join(srcDir, '00-head.html'),
  ...jsParts.map(f => join(jsDir, f)),
  join(srcDir, '99-tail.html')
];

for (const p of parts) {
  if (!existsSync(p)) { console.error(`build: missing part ${p}`); process.exit(1); }
}

/* Every part shares one IIFE scope, so two parts declaring a function of the same name do not
 * clash — the later declaration silently replaces the earlier one everywhere. That has bitten
 * twice (highlightInterface, matrixMaximum). Refuse to build when it happens. */
const declared = new Map();
for (const f of jsParts) {
  const text = readFileSync(join(jsDir, f), 'utf8');
  for (const match of text.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[1];
    if (declared.has(name)) { console.error(`build: function ${name} is declared in both ${declared.get(name)} and ${f}; the later one would silently replace the earlier`); process.exit(1); }
    declared.set(name, f);
  }
}

/* Read as bytes, not text: nothing here needs decoding, and Buffer.concat
 * cannot silently normalise a newline or drop a byte-order mark. */
const output = Buffer.concat(parts.map(p => readFileSync(p)));

/* The parts share one script, so a syntax error in any of them — an unescaped apostrophe in a tip,
 * say — stops the whole viewer from starting, and the browser suite then reports it as a hundred
 * timeouts. Parse every inline classic script before writing anything; nothing is executed. */
{
  const html = output.toString('utf8');
  const scripts = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let match; let index = 0;
  while ((match = scripts.exec(html))) {
    index += 1;
    if (/\btype\s*=\s*["'](?!text\/javascript)/i.test(match[1])) continue;
    try { new Function(match[2]); }
    catch (error) {
      const line = html.slice(0, match.index).split('\n').length;
      console.error(`build: inline script ${index} (starting on line ${line} of index.html) does not parse: ${error.message}`);
      process.exit(1);
    }
  }
}

if (!check) {
  writeFileSync(indexPath, output);
  console.log(`build: wrote index.html from ${parts.length} parts (${output.length} bytes)`);
  process.exit(0);
}

const current = existsSync(indexPath) ? readFileSync(indexPath) : Buffer.alloc(0);
if (output.equals(current)) {
  console.log(`build --check: index.html matches src/ (${parts.length} parts, ${output.length} bytes)`);
  process.exit(0);
}

/* Differ. Point at the first line that disagrees, in unified-diff shape, so the
 * failure says what to look at rather than just "they differ". */
const a = current.toString('utf8').split('\n');
const b = output.toString('utf8').split('\n');
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i += 1;

const clip = s => (s === undefined ? '(end of file)' : s.length > 200 ? `${s.slice(0, 200)}…` : s);
console.error('build --check: index.html does not match src/.');
console.error(`--- index.html (${current.length} bytes)`);
console.error(`+++ built from src/ (${output.length} bytes)`);
console.error(`@@ line ${i + 1} @@`);
console.error(`-${clip(a[i])}`);
console.error(`+${clip(b[i])}`);
console.error('\nEdits belong in src/. Run "node scripts/build.mjs" to regenerate index.html.');
process.exit(1);
