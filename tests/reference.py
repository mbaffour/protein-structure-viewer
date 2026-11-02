"""Independent reference values for an AlphaFold 3 run, computed with Biopython + numpy.
Mirrors the viewer's definitions: Cα pairs matched by chain|resi, Kabsch superposition
onto model 0, RMSF around the mean Cα position across all superposed models, Rg over Cα,
exact maximum Cα–Cα distance, heavy-atom residue contacts within a cutoff of one chain, the
inter-chain residue contact map (pairs with closest heavy-atom distance) for two chains, the full
Cα–Cα distance matrix of those two chains and of the first chain against itself, and the
buried surface area of every contacting chain pair by Shrake-Rupley (Bio.PDB.SASA), and for every residue
of the first contact-map chain its contacts within the cutoff with their closest atom pairs (2.51.0)."""
import sys, json, glob, re, warnings
import Bio
import numpy as np
from Bio.PDB.MMCIFParser import MMCIFParser
from Bio.SVDSuperimposer import SVDSuperimposer
from Bio.PDB import NeighborSearch
warnings.simplefilter('ignore')
folder, chain_for_contacts, cutoff = sys.argv[1], sys.argv[2], float(sys.argv[3])
files = sorted(glob.glob(f'{folder}/*_model_*.cif'), key=lambda f: int(re.search(r'_model_(\d+)\.cif$', f).group(1)))
parser = MMCIFParser(QUIET=True)
structs = [parser.get_structure(str(i), f)[0] for i, f in enumerate(files)]
def ca_map(model):
    return {(c.id, r.id[1]): r['CA'] for c in model for r in c if 'CA' in r and r.id[0] == ' '}
maps = [ca_map(m) for m in structs]
ref = maps[0]
out = {'models': [f.split('/')[-1] for f in files], 'rmsd': [], 'plddt_mean_ca': []}
coords = {k: [a.coord.copy()] for k, a in ref.items()}
for i, m in enumerate(maps):
    out['plddt_mean_ca'].append(round(float(np.mean([a.get_bfactor() for a in m.values()])), 3))
    if i == 0: continue
    keys = [k for k in ref if k in m]
    x = np.array([ref[k].coord for k in keys]); y = np.array([m[k].coord for k in keys])
    sup = SVDSuperimposer(); sup.set(x, y); sup.run()
    rot, tran = sup.get_rotran()
    moved = y @ rot + tran
    out['rmsd'].append({'model': i, 'pairs': len(keys), 'rmsd': round(float(sup.get_rms()), 4)})
    for k, c in zip(keys, moved): coords[k].append(c)
rmsf = {}
for k, pts in coords.items():
    if len(pts) < 2: continue
    p = np.array(pts); rmsf[f'{k[0]}|{k[1]}'] = float(np.sqrt(((p - p.mean(0)) ** 2).sum(1).mean()))
out['rmsf'] = {'count': len(rmsf), 'max': round(max(rmsf.values()), 4), 'mean': round(float(np.mean(list(rmsf.values()))), 4), 'sample': {k: round(v, 4) for k, v in list(rmsf.items())[:5]}}
ca0 = np.array([a.coord for a in ref.values()])
centre = ca0.mean(0)
out['rg_ca'] = round(float(np.sqrt(((ca0 - centre) ** 2).sum(1).mean())), 4)
d = np.sqrt(((ca0[:, None, :] - ca0[None, :, :]) ** 2).sum(-1))
out['extent_exact'] = round(float(d.max()), 4)
far = ca0[np.argmax(((ca0 - centre) ** 2).sum(1))]
out['extent_two_pass'] = round(float(np.sqrt(((ca0 - far) ** 2).sum(1)).max()), 4)
model0 = structs[0]
heavy = [a for a in model0.get_atoms() if a.element not in ('H', 'D')]
targets = [a for a in heavy if a.get_parent().get_parent().id == chain_for_contacts]
others = [a for a in heavy if a.get_parent().get_parent().id != chain_for_contacts and a.get_parent().id[0] == ' ']
ns = NeighborSearch(others)
found = set()
for t in targets:
    for a in ns.search(t.coord, cutoff):
        r = a.get_parent(); found.add((r.get_parent().id, r.id[1], r.get_resname()))
out['contacts'] = {'chain': chain_for_contacts, 'cutoff': cutoff, 'count': len(found), 'residues': sorted(found)}

# Inter-chain contact map on model 0: residue pairs of two chains with any heavy-atom pair within
# the cutoff, recorded with the closest such distance (mirrors the viewer's Compare → contact map).
def chain_atoms(chain_id):
    return [a for a in heavy if a.get_parent().get_parent().id == chain_id and a.get_parent().id[0] == ' ']
chain_ids = [c.id for c in model0]
pair_counts = {}
for ia, ca_id in enumerate(chain_ids):
    for cb_id in chain_ids[ia + 1:]:
        nsb = NeighborSearch(chain_atoms(cb_id)); seen = set()
        for a in chain_atoms(ca_id):
            for b in nsb.search(a.coord, cutoff): seen.add((a.get_parent().id[1], b.get_parent().id[1]))
        if seen: pair_counts[f'{ca_id}|{cb_id}'] = len(seen)
map_a = sys.argv[4] if len(sys.argv) > 4 else chain_for_contacts
map_b = sys.argv[5] if len(sys.argv) > 5 else max((k for k in pair_counts if k.startswith(map_a + '|') or k.endswith('|' + map_a)), key=lambda k: pair_counts[k], default=chain_ids[0] + '|' + chain_ids[1]).replace(map_a, '').replace('|', '')
nsb = NeighborSearch(chain_atoms(map_b)); pairs = {}
for a in chain_atoms(map_a):
    for b in nsb.search(a.coord, cutoff):
        key = (a.get_parent().id[1], b.get_parent().id[1]); d = float(np.linalg.norm(a.coord - b.coord))
        if key not in pairs or pairs[key] > d: pairs[key] = d
out['contact_map'] = {'chains': [map_a, map_b], 'cutoff': cutoff, 'pairs': len(pairs), 'residues_a': len({k[0] for k in pairs}), 'residues_b': len({k[1] for k in pairs}),
    'all_pairs': [[k[0], k[1], round(v, 4)] for k, v in sorted(pairs.items())], 'chain_pair_counts': pair_counts}

# Distance map on model 0 (added 2.50.0): the full Calpha-Calpha matrix of the contact-map chain pair
# (every residue of map_a against every residue of map_b) and the intra-chain matrix of map_a alone
# (diagonal included), from the CA atom of every standard residue, as numpy does it. Mirrors the
# viewer's Compare -> Contact and distance map, All distances view.
def ca_axis(chain_id):
    found = [(r.id[1], r['CA'].coord.astype(float)) for r in model0[chain_id] if r.id[0] == ' ' and 'CA' in r] if chain_id in model0 else []
    return [k for k, _ in found], np.array([c for _, c in found], dtype=float).reshape(-1, 3)
def ca_matrix(xa, xb):
    return np.sqrt(((xa[:, None, :] - xb[None, :, :]) ** 2).sum(-1))
ids_a, xyz_a = ca_axis(map_a); ids_b, xyz_b = ca_axis(map_b)
out['distance_map'] = {'chains': [map_a, map_b], 'residues_a': ids_a, 'residues_b': ids_b,
    'ca': [[round(float(v), 4) for v in row] for row in ca_matrix(xyz_a, xyz_b)],
    'intra': {'chain': map_a, 'residues': ids_a, 'ca': [[round(float(v), 4) for v in row] for row in ca_matrix(xyz_a, xyz_a)]}}
print('distance map', [map_a, map_b], len(ids_a), 'x', len(ids_b), '; intra', map_a, len(ids_a), 'x', len(ids_a))

# Residue contacts on model 0 (added 2.51.0): for every standard residue of map_a, the polymer residues of
# any chain with a heavy atom within the cutoff of any of its heavy atoms -- the viewer's rule for one
# residue (Annotate -> Nearby residues, the residue card's Contacts): hydrogens excluded, water and hetero
# groups never a neighbour, the residue itself left out -- each with its closest heavy-atom distance, the
# two atom names (this residue's atom first; on a tie the first pair in atom order, outer loop over this
# residue's atoms, as the viewer searches) and the Calpha-Calpha distance (CA, else P, else the residue's
# first atom, the viewer's stand-in). Then, for the first three residues of map_a, the closest heavy-atom
# distance to every other polymer residue of the model -- the values Colour by distance from the selected
# residue bands. Coordinates in float64 and values to six decimals, since the comparison is at 5e-5 A.
def residue_heavy(res):
    return [a for a in res if a.element not in ('H', 'D')]
def stand_in(res):
    atoms = list(res)
    if 'CA' in res and res.id[0] == ' ': return res['CA']
    return next((a for a in atoms if a.get_id() == 'P'), atoms[0])
def xyz(atom):
    return atom.coord.astype(float)
poly_heavy = [a for a in heavy if a.get_parent().id[0] == ' ']
ns_poly = NeighborSearch(poly_heavy)
contact_rows = []
map_residues = [r for r in model0[map_a] if r.id[0] == ' '] if map_a in model0 else []
for res in map_residues:
    own = residue_heavy(res); own_xyz = np.array([xyz(a) for a in own]).reshape(-1, 3)
    near = {}
    for a in own:
        for b in ns_poly.search(a.coord, cutoff):
            other = b.get_parent()
            if other is not res: near[(other.get_parent().id, other.id[1])] = other
    rows = []
    for key in sorted(near, key=lambda k: (k[0], k[1])):
        other = near[key]; theirs = residue_heavy(other)
        d = np.sqrt(((own_xyz[:, None, :] - np.array([xyz(b) for b in theirs])[None, :, :]) ** 2).sum(-1))
        i, j = np.unravel_index(int(np.argmin(d)), d.shape)  # argmin takes the first minimum in row-major order
        rows.append([key[0], key[1], other.get_resname(), round(float(d[i, j]), 6), own[i].get_id(), theirs[j].get_id(),
                     round(float(np.linalg.norm(xyz(stand_in(res)) - xyz(stand_in(other)))), 6)])
    contact_rows.append({'resi': res.id[1], 'resn': res.get_resname(), 'contacts': rows})
poly_residues = [r for c in model0 for r in c if r.id[0] == ' ']
poly_index = np.array([k for k, r in enumerate(poly_residues) for a in residue_heavy(r)])
poly_xyz = np.array([xyz(a) for r in poly_residues for a in residue_heavy(r)]).reshape(-1, 3)
distance_rows = []
for res in map_residues[:3]:
    own_xyz = np.array([xyz(a) for a in residue_heavy(res)]).reshape(-1, 3)
    per_atom = np.sqrt(((poly_xyz[None, :, :] - own_xyz[:, None, :]) ** 2).sum(-1).min(0))
    best = np.full(len(poly_residues), np.inf); np.minimum.at(best, poly_index, per_atom)
    distance_rows.append({'chain': map_a, 'resi': res.id[1], 'resn': res.get_resname(),
        'rows': [[r.get_parent().id, r.id[1], r.get_resname(), round(float(best[k]), 6)] for k, r in enumerate(poly_residues) if r is not res and np.isfinite(best[k])]})
out['residue_contacts'] = {'chain': map_a, 'cutoff': cutoff, 'residues': contact_rows, 'distances': distance_rows}
print('residue contacts', map_a, len(contact_rows), 'residues,', sum(len(r['contacts']) for r in contact_rows), 'contacts at', cutoff, 'A; distance rows for', [r['resi'] for r in distance_rows])

# Buried surface area of every chain pair in contact, on model 0, with Biopython's Shrake–Rupley
# (Bio.PDB.SASA) configured to the viewer's parameters: probe 1.4 Å, 92 sphere points, Bondi radii
# (C 1.70, N 1.55, O 1.52, S 1.80 … — identical to Biopython's defaults for every element present),
# every non-hydrogen atom of the chain included (the viewer excludes only H and D, not hetero or
# water). BSA = SASA(A alone) + SASA(B alone) − SASA(A+B together), not halved, floored at zero.
# Shrake–Rupley is a sampling method: Biopython's 92 points and the viewer's 92 points are different
# quasi-uniform sets, so the two agree only to the sampling error of the point count (see VALIDATION.md).
from Bio.PDB.SASA import ShrakeRupley
SASA_PROBE, SASA_POINTS = 1.4, 92
sasa_engine = ShrakeRupley(probe_radius=SASA_PROBE, n_points=SASA_POINTS)
def sasa_of(chain_ids):
    model = parser.get_structure('sasa', files[0])[0]
    for cid in [c.id for c in model]:
        if cid not in chain_ids: model.detach_child(cid)
    for ch in model:
        for res in ch:
            for aid in [a.get_id() for a in res if a.element in ('H', 'D')]: res.detach_child(aid)
    sasa_engine.compute(model, level='M')
    return float(model.sasa)
solo_sasa = {}
def solo(chain_id):
    if chain_id not in solo_sasa: solo_sasa[chain_id] = sasa_of([chain_id])
    return solo_sasa[chain_id]
bsa_pairs = []
for key in sorted(pair_counts):
    a, b = key.split('|')
    together = sasa_of([a, b])
    bsa_pairs.append({'chains': [a, b], 'sasa_a': round(solo(a), 4), 'sasa_b': round(solo(b), 4),
                      'sasa_ab': round(together, 4), 'bsa': round(max(0.0, solo(a) + solo(b) - together), 4)})
primary = next((p for p in bsa_pairs if sorted(p['chains']) == sorted([map_a, map_b])), None)
if primary is not None:  # report the primary pair in the order [map_a, map_b], whichever way it was stored
    primary = {'chains': [map_a, map_b], 'sasa_a': round(solo(map_a), 4), 'sasa_b': round(solo(map_b), 4),
               'sasa_ab': primary['sasa_ab'], 'bsa': primary['bsa']}
out['bsa'] = {'chains': [map_a, map_b], 'probe_radius': SASA_PROBE, 'n_points': SASA_POINTS,
    'cutoff': cutoff, 'implementation': 'Bio.PDB.SASA.ShrakeRupley ' + Bio.__version__,
    'radii': 'Biopython Bondi defaults (C 1.70, N 1.55, O 1.52, S 1.80, P 1.80, SE 1.90, F 1.47, CL 1.75, BR 1.85, I 1.98)',
    'definition': 'BSA(A,B) = SASA(A) + SASA(B) - SASA(A+B), Shrake-Rupley, probe 1.4 A, 92 points, all non-hydrogen atoms, not halved, floored at 0',
    'sasa_a': primary['sasa_a'] if primary else None, 'sasa_b': primary['sasa_b'] if primary else None,
    'sasa_ab': primary['sasa_ab'] if primary else None, 'bsa': primary['bsa'] if primary else None,
    'pairs': len(bsa_pairs), 'total_bsa': round(sum(p['bsa'] for p in bsa_pairs), 4),
    'chain_sasa': {k: round(v, 4) for k, v in sorted(solo_sasa.items())}, 'all_pairs': bsa_pairs}
print('bsa', out['bsa']['chains'], out['bsa']['bsa'], 'A^2 over', out['bsa']['pairs'], 'contacting pairs; total', out['bsa']['total_bsa'])

# MSA statistics per unpaired .a3m in the folder: conservation = 1 - H/log2(20) over the twenty amino
# acids (gaps and X excluded), identity to the query, coverage; lowercase insertions dropped.
# 'conservation' uses Henikoff & Henikoff (1994) position-based sequence weights (1/(r*n) per column,
# summed over the columns where the sequence has a residue, scaled to a mean weight of 1);
# 'conservation_unweighted' is the plain column entropy.
import math, os
out['msa'] = []
for a3m in sorted(glob.glob(f'{folder}/*unpaired*.a3m')):
    records = []; current = None
    for line in open(a3m, encoding='utf-8', errors='ignore'):
        line = line.rstrip('\n')
        if line.startswith('>'): current = []; records.append(current)
        elif current is not None and line.strip() and not line.startswith('#'): current.append(line.strip())
    seqs = [''.join(ch for ch in ''.join(r) if not (ch.islower() or ch == '.')) for r in records]
    if not seqs: continue
    query = seqs[0]; L = len(query)
    rows = [q for q in seqs if len(q) == L]
    depth = [0] * L; ident = [0] * L; cons = [0.0] * L; cons_raw = [0.0] * L
    weights = [0.0] * len(rows)
    for i in range(L):
        freq = {}
        for r in rows:
            if r[i] not in '-Xx': freq[r[i]] = freq.get(r[i], 0) + 1
        if not freq: continue
        for s, r in enumerate(rows):
            if r[i] not in '-Xx': weights[s] += 1.0 / (len(freq) * freq[r[i]])
    total = sum(weights)
    if total > 0: weights = [w * len(rows) / total for w in weights]
    def normalised(H): return max(0.0, min(1.0, 1 - H / math.log2(20)))
    for i in range(L):
        column = [(r[i], weights[s]) for s, r in enumerate(rows) if r[i] not in '-Xx']
        depth[i] = len(column)
        if not column: continue
        ident[i] = sum(1 for c, _ in column if c == query[i]) / len(column)
        freq = {}; wfreq = {}
        for c, w in column: freq[c] = freq.get(c, 0) + 1; wfreq[c] = wfreq.get(c, 0.0) + w
        cons_raw[i] = normalised(-sum((n / len(column)) * math.log2(n / len(column)) for n in freq.values()))
        wtotal = sum(wfreq.values())
        cons[i] = normalised(-sum((w / wtotal) * math.log2(w / wtotal) for w in wfreq.values() if w > 0))
    out['msa'].append({'file': os.path.basename(a3m), 'query': query, 'sequences': len(rows), 'depth': depth, 'identity': [round(v, 6) for v in ident], 'conservation': [round(v, 6) for v in cons], 'conservation_unweighted': [round(v, 6) for v in cons_raw]})
print('msa', [(m['file'][-30:], m['sequences'], len(m['query'])) for m in out['msa']])
json.dump(out, open(f'{folder}/reference.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ('contacts', 'distance_map', 'residue_contacts')}, indent=1)); print('contacts', out['contacts']['count'], out['contacts']['residues'][:6]); print('contact map', out['contact_map']['chains'], out['contact_map']['pairs'], 'pairs; chain pairs with contacts:', out['contact_map']['chain_pair_counts'])
