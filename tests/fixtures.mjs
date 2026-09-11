/* Synthetic two-chain structures with pLDDT-like B-factors.
   model_a and model_b share a backbone; model_c is genuinely different, so a
   superposition of c onto a has a non-zero RMSD to assert on. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pdb({ seed = 1, residues = 30, twist = 0, jitter = 0 } = {}) {
  const random = mulberry32(seed);
  const lines = [];
  let serial = 1;
  for (const [chainIndex, chain] of [...'AB'].entries()) {
    for (let r = 1; r <= residues; r += 1) {
      const angle = (r * (100 + twist) * Math.PI) / 180;
      const radius = 2.3 + (twist ? 0.4 * Math.sin(r / 4) : 0);
      const base = [radius * Math.cos(angle), radius * Math.sin(angle), 1.5 * r + chainIndex * 3];
      for (const [atom, dx] of [['N', -0.6], ['CA', 0], ['C', 0.6], ['O', 1.0]]) {
        const jit = () => (random() - 0.5) * 2 * jitter;
        const x = base[0] + dx + jit();
        const y = base[1] + jit();
        const z = base[2] + chainIndex * 0.4 + jit();
        const b = Math.max(20, Math.min(98, 55 + 40 * Math.sin(r / 6) + (random() - 0.5) * 6));
        lines.push(
          'ATOM  ' + String(serial).padStart(5) + '  ' + atom.padEnd(3) + ' ALA ' + chain +
          String(r).padStart(4) + '    ' +
          x.toFixed(3).padStart(8) + y.toFixed(3).padStart(8) + z.toFixed(3).padStart(8) +
          '  1.00' + b.toFixed(2).padStart(6) + '           ' + atom[0]
        );
        serial += 1;
      }
    }
    lines.push('TER');
  }
  lines.push('END');
  return lines.join('\n') + '\n';
}

export async function writeFixtures(dir) {
  const files = {
    'model_a.pdb': pdb({ seed: 1 }),
    'model_b.pdb': pdb({ seed: 2 }),
    'model_c.pdb': pdb({ seed: 7, twist: 6, jitter: 0.25 })
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return Object.keys(files);
}
