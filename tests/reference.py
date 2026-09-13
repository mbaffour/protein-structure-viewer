"""Independent reference values for an AlphaFold 3 run, computed with Biopython + numpy.
Mirrors the viewer's definitions: Cα pairs matched by chain|resi, Kabsch superposition
onto model 0, RMSF around the mean Cα position across all superposed models, Rg over Cα,
exact maximum Cα–Cα distance, heavy-atom residue contacts within a cutoff of one chain."""
import sys, json, glob, re, warnings
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
json.dump(out, open(f'{folder}/reference.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in out.items() if k != 'contacts'}, indent=1)); print('contacts', out['contacts']['count'], out['contacts']['residues'][:6])
