  /* ---------- Other predictors: ColabFold, Boltz, Chai-1 ----------
     Each tool writes the same three things — a model, per-residue pLDDT, a PAE matrix and
     a few summary scores — under its own names. The layouts below were read from each
     tool's own writer:
       ColabFold 1.5+  <job>_unrelaxed_rank_001_<model>_seed_000.pdb (or _relaxed_) with
                       <job>_scores_rank_001_<model>_seed_000.json: plddt, pae, max_pae, ptm,
                       iptm, and for complexes ColabFold's own ipsae / pdockq / pdockq2.
       Boltz           <name>_model_0.cif with confidence_<name>_model_0.json and
                       pae_ / plddt_ / pde_<name>_model_0.npz. Model 0 is the best ranked.
       Chai-1          pred.model_idx_0.cif with scores.model_idx_0.npz (aggregate_score, ptm,
                       iptm, per-chain-pair ipTM, clashes). Sample index is not rank. Chai-1
                       keeps its PAE in memory and never writes it to disk.
     All three put pLDDT × 100 in the B-factor column, which the viewer already reads. What
     they need here is the pairing of scores to models, a reader for NumPy's .npz files, and
     — because only AlphaFold 3 lists which residue each PAE row belongs to — a token layout
     derived from the model itself. */

  const npyTypes = {
    f2: [2, (view, at, little) => halfToFloat(view.getUint16(at, little))], f4: [4, (view, at, little) => view.getFloat32(at, little)],
    f8: [8, (view, at, little) => view.getFloat64(at, little)], i1: [1, (view, at) => view.getInt8(at)], u1: [1, (view, at) => view.getUint8(at)],
    b1: [1, (view, at) => view.getUint8(at)], i2: [2, (view, at, little) => view.getInt16(at, little)], u2: [2, (view, at, little) => view.getUint16(at, little)],
    i4: [4, (view, at, little) => view.getInt32(at, little)], u4: [4, (view, at, little) => view.getUint32(at, little)],
    i8: [8, (view, at, little) => Number(view.getBigInt64(at, little))], u8: [8, (view, at, little) => Number(view.getBigUint64(at, little))]
  };

  function halfToFloat(bits) {
    const sign = bits & 0x8000 ? -1 : 1; const exponent = (bits >> 10) & 0x1f; const fraction = bits & 0x3ff;
    if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
    if (exponent === 31) return fraction ? NaN : sign * Infinity;
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
  }

  /* One .npy array: the magic string, a version, a header that is a Python dict literal
     ('descr', 'fortran_order', 'shape'), then the values. Returned flat, in C order. */
  function readNpy(bytes) {
    if (bytes.length < 10 || bytes[0] !== 0x93 || String.fromCharCode(bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]) !== 'NUMPY') throw new Error('not a NumPy array');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const major = bytes[6];
    const headerStart = major === 1 ? 10 : 12;
    const headerLength = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const header = String.fromCharCode(...bytes.subarray(headerStart, headerStart + headerLength));
    const descr = (header.match(/'descr'\s*:\s*'([^']+)'/) || [])[1] || '';
    const fortran = /'fortran_order'\s*:\s*True/.test(header);
    const shape = ((header.match(/'shape'\s*:\s*\(([^)]*)\)/) || [])[1] || '').split(',').map(value => value.trim()).filter(Boolean).map(Number);
    const type = npyTypes[descr.slice(1)];
    if (!type || !shape.every(Number.isFinite)) throw new Error('unsupported NumPy array type ' + descr);
    const little = descr[0] !== '>';
    const count = shape.reduce((product, value) => product * value, 1);
    const [width, read] = type; const start = headerStart + headerLength;
    if (start + count * width > bytes.length) throw new Error('NumPy array shorter than its header says');
    /* float32 stays float32: a 4 400-token PAE is 77 MB that way and would be 155 MB as float64. */
    const Store = descr.slice(1) === 'f4' ? Float32Array : Float64Array;
    const values = Store === Float32Array && little && (bytes.byteOffset + start) % 4 === 0
      ? new Float32Array(bytes.buffer, bytes.byteOffset + start, count).slice()
      : Store.from({ length: count }, (_, i) => read(view, start + i * width, little));
    if (fortran && shape.length === 2) {
      const [rows, columns] = shape; const ordered = new Store(count);
      for (let r = 0; r < rows; r += 1) for (let c = 0; c < columns; c += 1) ordered[r * columns + c] = values[c * rows + r];
      return { shape, values: ordered, dtype: descr };
    }
    return { shape, values, dtype: descr };
  }

  /* An .npz is a ZIP of .npy files (np.savez stores them, np.savez_compressed deflates them). */
  async function readNpz(data) {
    if (typeof JSZip === 'undefined') throw new Error('The ZIP reader did not load. Refresh the page and try again.');
    const zip = await JSZip.loadAsync(data);
    const arrays = {};
    for (const member of Object.values(zip.files)) {
      if (member.dir || !/\.npy$/i.test(member.name)) continue;
      arrays[member.name.split('/').pop().replace(/\.npy$/i, '')] = readNpy(await member.async('uint8array'));
    }
    return arrays;
  }

  /* Chai-1 keeps a leading batch dimension of one on every score: (1,), (1, n), (1, n, n). */
  function squeezeLeading(array) {
    let shape = array.shape.slice();
    while (shape.length > 1 && shape[0] === 1) shape = shape.slice(1);
    return { ...array, shape };
  }

  function npyRows(array) {
    const { shape, values } = squeezeLeading(array);
    if (shape.length !== 2) return null;
    const [rows, columns] = shape;
    return Array.from({ length: rows }, (_, r) => Float32Array.from(values.subarray(r * columns, (r + 1) * columns)));
  }

  /* A float32 score of 0.52 reads back as 0.5199999809; seven significant digits is all it holds. */
  function npyNested(array) {
    const { shape, values, dtype } = squeezeLeading(array);
    const single = /f[24]$/.test(dtype || '');
    const clean = value => single && Number.isFinite(value) ? Number(value.toPrecision(7)) : value;
    if (shape.length === 1 && shape[0] === 1) return clean(values[0]);
    if (shape.length === 1) return Array.from(values, clean);
    if (shape.length === 2) return Array.from({ length: shape[0] }, (_, r) => Array.from(values.subarray(r * shape[1], (r + 1) * shape[1]), clean));
    return null;
  }

  function npyScalar(array) {
    const value = array ? npyNested(array) : null;
    return typeof value === 'number' ? finiteNumber(value) : null;
  }

  /* What an .npz carries, as confidence the rest of the viewer already understands.
     Boltz writes pae_ (the matrix), plddt_ and pde_ files; Chai-1 writes scores.
     'ignored' means the file was recognised but carries nothing the viewer draws. */
  function confidenceFromNpz(name, arrays) {
    if (arrays.pae) {
      const pae = npyRows(arrays.pae);
      if (!pae || !pae.length || pae.length !== pae[0].length) return null;
      return { confidence: { pae, paeMaximum: matrixMaximum(pae), paeSource: 'Boltz' } };
    }
    if (arrays.aggregate_score || arrays.per_chain_pair_iptm) {
      const pairs = arrays.per_chain_pair_iptm ? npyNested(arrays.per_chain_pair_iptm) : null;
      const clashes = arrays.has_inter_chain_clashes ? npyNested(arrays.has_inter_chain_clashes) : null;
      return {
        scoreRanked: true,
        confidence: {
          rankingScore: npyScalar(arrays.aggregate_score), ptm: npyScalar(arrays.ptm), iptm: npyScalar(arrays.iptm),
          chainPairIptm: Array.isArray(pairs) && Array.isArray(pairs[0]) ? pairs : null,
          hasClash: clashes === null ? null : Boolean(clashes),
          predictor: 'Chai-1'
        }
      };
    }
    if (arrays.plddt || arrays.pde) return 'ignored';
    return null;
  }

  async function registerNpz(name, bytes, collection = null) {
    let arrays;
    try { arrays = await readNpz(bytes); } catch (error) { return false; }
    const found = confidenceFromNpz(name, arrays);
    if (found === 'ignored') return true;
    if (!found) return false;
    confidenceAssets.push({ name, confidence: found.confidence, rank: predictorRank(name), collection, scoreRanked: Boolean(found.scoreRanked) });
    return true;
  }

  /* Rank carried in a file name: ColabFold's rank_001, Boltz's model_0 (written in rank order). */
  function predictorRank(path) {
    const stem = fileStem(path).toLowerCase();
    const colabfold = stem.match(/_(?:unrelaxed|relaxed|scores)_rank_(\d+)_/);
    if (colabfold) return Number(colabfold[1]);
    const boltz = stem.match(/^(?:confidence|pae|plddt|pde)_.+_model_(\d+)$/);
    if (boltz) return Number(boltz[1]) + 1;
    return null;
  }

  /* Boltz's confidence file keys chains by index ("0", "1", …) in the model's chain order. */
  function indexedPairMatrix(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value).filter(key => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return null;
    return keys.map(row => keys.map(column => finiteNumber(value[row] && value[row][column])));
  }

  /* AlphaFold 3's chain_ids is one entry per chain in some files and one per token in others
     (the AlphaFold Server's summary files list every token: "A", "A", …, "B", …); the chain
     order is the same either way once repeats are removed. */
  function chainOrderFromIds(ids) {
    return Array.isArray(ids) ? [...new Set(ids.map(id => String(id)))] : [];
  }

  /* A chain is a polymer if any of its atoms is an ATOM record; ligand and ion chains are all
     HETATM (AlphaFold 3, Boltz, Chai-1), while a modified residue inside a protein chain is not. */
  function polymerChainSet(atoms) {
    return new Set((atoms || []).filter(atom => !atom.hetflag).map(atom => String(atom.chain ?? '')));
  }

  const insertionCode = atom => String(atom.icode ?? atom.inscode ?? '').trim();

  /* Chains in the order the model lists them — the order Boltz and Chai-1 index their
     per-chain scores by. */
  function modelChainOrder(entry) {
    const seen = [];
    (entry && entry.atoms || []).forEach(atom => { const chain = String(atom.chain ?? ''); if (!seen.includes(chain)) seen.push(chain); });
    return seen;
  }

  /* Which residue each PAE row belongs to. AlphaFold 3 says so in the file. For the others it
     follows from how the models tokenise: one token per polymer residue, one per heavy atom of
     a ligand (AlphaFold 3 and Boltz-2), or — ColabFold, protein only — one per residue. The
     layout is used only when its length is exactly the matrix size; otherwise nothing is
     guessed and the reason is returned. */
  /* The layout is asked for on every hover over the PAE map; it is rebuilt only when the matrix or
     the model's atoms change. */
  const paeLayoutCache = new WeakMap();
  function paeTokenLayout(entry) {
    const confidence = entry && entry.confidence || {}; const matrix = confidence.pae;
    if (!Array.isArray(matrix) || !matrix.length) return null;
    const cached = paeLayoutCache.get(confidence);
    if (cached && cached.matrix === matrix && cached.atoms === entry.atoms) return cached.layout;
    const layout = derivePaeTokenLayout(entry, confidence, matrix);
    paeLayoutCache.set(confidence, { matrix, atoms: entry.atoms, layout });
    return layout;
  }

  function derivePaeTokenLayout(entry, confidence, matrix) {
    const size = matrix.length;
    if (Array.isArray(confidence.tokenChainIds) && confidence.tokenChainIds.length === size) {
      const residueIds = Array.isArray(confidence.tokenResidueIds) ? confidence.tokenResidueIds : [];
      return { chainIds: confidence.tokenChainIds, residueIds, residueKeys: confidence.tokenChainIds.map((chain, index) => String(chain) + '|' + Number(residueIds[index]) + '|'), derived: false, size };
    }
    const atoms = entry.atoms || [];
    if (!atoms.length) return { chainIds: [], residueIds: [], residueKeys: [], derived: true, size, mismatch: 'the model is not loaded yet' };
    const polymerChains = polymerChainSet(atoms);
    const groups = []; const byKey = new Map();
    atoms.forEach(atom => {
      if (/^(HOH|WAT|DOD)$/i.test(String(atom.resn || ''))) return;
      /* Insertion codes keep 52 and 52A apart, as antibody numbering needs. */
      const chain = String(atom.chain ?? ''); const residueKey = chain + '|' + Number(atom.resi) + '|' + insertionCode(atom); const key = residueKey + '|' + atom.resn;
      if (!byKey.has(key)) { const group = { chain, resi: Number(atom.resi), residueKey, polymer: polymerChains.has(chain), heavy: 0 }; byKey.set(key, group); groups.push(group); }
      if (String(atom.elem || '').toUpperCase() !== 'H') byKey.get(key).heavy += 1;
    });
    const layouts = [
      groups.flatMap(group => group.polymer ? [group] : Array.from({ length: group.heavy }, () => group)),
      groups.filter(group => group.polymer)
    ];
    const layout = layouts.find(candidate => candidate.length === size);
    if (!layout) {
      const residues = groups.filter(group => group.polymer).length; const tokens = layouts[0].length;
      return { chainIds: [], residueIds: [], residueKeys: [], derived: true, size, mismatch: 'the PAE has ' + size + ' rows but the model has ' + residues + ' residues' + (tokens !== residues ? ' (' + tokens + ' tokens counting ligand atoms)' : '') };
    }
    return { chainIds: layout.map(group => group.chain), residueIds: layout.map(group => group.resi), residueKeys: layout.map(group => group.residueKey), derived: true, size };
  }

  function paeTokenIds(entry) {
    const layout = paeTokenLayout(entry);
    return layout && !layout.mismatch ? layout : { chainIds: [], residueIds: [], residueKeys: [], derived: true, size: 0 };
  }

  /* Chai-1 files carry no job name, so ranks come from the aggregate score, within one archive. */
  function rankScoreRankedAssets() {
    const groups = new Map();
    confidenceAssets.filter(asset => asset.scoreRanked).forEach(asset => {
      const key = asset.collection || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(asset);
    });
    groups.forEach(assets => {
      assets.sort((a, b) => (b.confidence.rankingScore ?? -Infinity) - (a.confidence.rankingScore ?? -Infinity));
      assets.forEach((asset, index) => { asset.rank = index + 1; });
    });
  }
