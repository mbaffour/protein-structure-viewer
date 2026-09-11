/* Downloads the three pinned libraries the viewer loads from cdnjs and verifies
   each against the Subresource Integrity hash in index.html. The test harness
   serves them locally so the suite does not depend on CDN reachability, and the
   verification means a compromised download cannot silently pass the tests. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendorDir = join(here, 'vendor');

const html = await readFile(join(here, '..', 'index.html'), 'utf8');
const tags = [...html.matchAll(/<script src="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)"[^>]*integrity="([^"]+)"/g)];
if (tags.length !== 3) {
  throw new Error(`expected 3 integrity-pinned CDN scripts in index.html, found ${tags.length}`);
}

await mkdir(vendorDir, { recursive: true });
for (const [, url, integrity] of tags) {
  const name = url.split('/').pop();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expected] = integrity.split('-');
  const actual = createHash(algorithm).update(bytes).digest('base64');
  if (actual !== expected) {
    throw new Error(`integrity mismatch for ${name}\n  expected ${algorithm}-${expected}\n  actual   ${algorithm}-${actual}`);
  }
  await writeFile(join(vendorDir, name), bytes);
  console.log(`ok  ${name}  (${algorithm} verified, ${bytes.length} bytes)`);
}
