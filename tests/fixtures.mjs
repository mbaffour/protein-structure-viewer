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

export function pdb({ seed = 1, residues = 30, twist = 0, jitter = 0, chains = 'AB' } = {}) {
  const random = mulberry32(seed);
  const lines = [];
  let serial = 1;
  for (const [chainIndex, chain] of [...chains].entries()) {
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

/* ---------- AlphaFold2 WebGPU result archive ----------
   The shape martin-steinegger.github.io/alphafold2-webgpu downloads: a ColabFold-style folder whose
   scores file writes predicted_aligned_error as one flat run of L² numbers, beside a nested
   AlphaFold-DB-shaped PAE file, the alignment it used and the config that records the run. */

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/* Stored entries only — no deflate, so this needs no dependency and JSZip reads it the same. */
function storedZip(entries) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const file = Buffer.from(name, 'utf8'); const data = Buffer.from(text, 'utf8');
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); common.writeUInt16LE(0x0800, 2); common.writeUInt16LE(0, 4);
    common.writeUInt16LE(0, 6); common.writeUInt16LE(33, 8);
    common.writeUInt32LE(crc32(data), 10); common.writeUInt32LE(data.length, 14);
    common.writeUInt32LE(data.length, 18); common.writeUInt16LE(file.length, 22);
    common.writeUInt16LE(0, 24);
    const local = Buffer.alloc(4); local.writeUInt32LE(0x04034b50, 0);
    parts.push(local, common, file, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4);
    common.copy(head, 6, 0, 24); head.writeUInt32LE(offset, 42);
    central.push(head, file);
    offset += 30 + file.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

export function alphafoldWebgpuFiles({ job = 'demo', residues = 30 } = {}) {
  const structure = pdb({ seed: 3, residues, chains: 'A' });
  const random = mulberry32(11);
  const plddt = Array.from({ length: residues }, (_, i) => Number((55 + 40 * Math.sin(i / 6)).toFixed(2)));
  const flat = [];
  const rows = [];
  for (let i = 0; i < residues; i += 1) {
    const row = [];
    for (let j = 0; j < residues; j += 1) {
      const value = Number((Math.abs(i - j) * 0.4 + random() * 0.2).toFixed(2));
      row.push(value); flat.push(value);
    }
    rows.push(row);
  }
  const maximum = Math.max(...flat);
  return {
    [`${job}_unrelaxed_model_1.pdb`]: structure,
    [`${job}_scores.json`]: JSON.stringify({
      sequence: 'A'.repeat(residues),
      plddt,
      mean_plddt: plddt.reduce((sum, value) => sum + value, 0) / residues,
      ptm: 0.812,
      predicted_aligned_error: flat,
      max_predicted_aligned_error: maximum
    }, null, 2),
    [`${job}_predicted_aligned_error_v1.json`]:
      JSON.stringify([{ predicted_aligned_error: rows, max_predicted_aligned_error: maximum }]),
    [`${job}.a3m`]: `>${job}\n${'A'.repeat(residues)}\n>related\n${'A'.repeat(residues - 3)}CCC\n`,
    'config.json': JSON.stringify({
      job_name: job,
      implementation: 'alphafold2-webgpu',
      model_type: 'alphafold2_ptm',
      model_number: 1,
      num_recycles: 3,
      msa_mode: 'mmseqs2_uniref_env',
      msa_depth: 42,
      random_seed: 0,
      length: residues,
      chain_lengths: [residues],
      adapter: 'test adapter'
    }, null, 2)
  };
}

/* Writes the archive both ways: loose files, and zipped under a job folder as the site downloads it. */
export async function writeAlphafoldWebgpuFixtures(dir, { job = 'demo' } = {}) {
  const files = alphafoldWebgpuFiles({ job });
  const loose = [];
  for (const [name, text] of Object.entries(files)) {
    const target = join(dir, `af2wg_${name}`);
    await writeFile(target, text);
    loose.push(target);
  }
  const archive = join(dir, `${job}_af2webgpu.zip`);
  await writeFile(archive, storedZip(Object.fromEntries(
    Object.entries(files).map(([name, text]) => [`${job}/${name}`, text])
  )));
  return { loose, archive };
}
