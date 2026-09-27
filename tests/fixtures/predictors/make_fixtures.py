"""Regenerate the predictor-output fixtures in this folder.

One small two-chain complex is written out the way four structure predictors write their
results, so the viewer's readers can be tested against each format without committing anyone's
real prediction:

  colabfold/  ColabFold 1.5+ batch output: *_unrelaxed_rank_NNN_*.pdb + *_scores_rank_NNN_*.json
  boltz/      Boltz-2 output folder: *_model_N.cif, confidence_*.json, pae_/plddt_/pde_*.npz
  chai/       Chai-1 output folder: pred.model_idx_N.cif + scores.model_idx_N.npz
  af3/        AlphaFold 3 server output: fold_*_model_0.cif, *_full_data_0.json, *_summary_confidences_0.json

The coordinates are residues 1-64 of the real AlphaFold DB model of human haemoglobin alpha
(../alphafold-db/AF-P69905-F1-model_v6.cif, CC-BY-4.0), with a second copy placed by a
two-fold rotation so the two chains pack against each other. pLDDT is that model's own
per-residue pLDDT. The PAE is synthetic: the real intra-chain block of the AlphaFold DB PAE,
and an inter-chain block that grows with the Cβ–Cβ distance, so an interface has low PAE and
the far side high. These are format fixtures, not predictions of anything.

The file layouts follow each tool's own writer, read from source:
  ColabFold  colabfold/batch.py (file_manager, scores dict, rank renaming) and
             colabfold/alphafold/ipsae.py (the ipsae / pdockq / pdockq2 keys it adds)
  Boltz      boltz/data/write/writer.py (file names, confidence keys, np.savez_compressed)
             and boltz/data/write/mmcif.py (python-modelcif, pLDDT x 100 in B_iso)
  Chai-1     chai_lab/chai1.py (pred.model_idx_N.cif, np.savez of get_scores) and
             chai_lab/data/io/cif_utils.py (python-modelcif, per-atom pLDDT x 100 in B_iso)
  AF3        the AlphaFold Server's fold_<job>_* names and full_data / summary_confidences keys

expected-ipsae.json holds the interface scores computed by the reference implementation,
DunbrackLab/IPSAE ipsae.py, on these files — the viewer's own numbers are checked against it.

Usage:  python make_fixtures.py <path to ipsae.py>
Needs numpy, biopython and python-modelcif (pip install numpy biopython modelcif).
"""
import hashlib
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import ihm
import modelcif
import modelcif.dumper
import modelcif.model
import modelcif.qa_metric
import numpy as np
from Bio.PDB import MMCIFParser

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "alphafold-db" / "AF-P69905-F1-model_v6.cif"
SOURCE_PAE = HERE.parent / "alphafold-db" / "AF-P69905-F1-predicted_aligned_error_v6.json"
RESIDUES = 64
JOB = "hbdimer"

# ---------- the complex ----------

structure = MMCIFParser(QUIET=True).get_structure("P69905", str(SOURCE))
chain = next(structure[0].get_chains())
residues = [residue for residue in chain if residue.id[0] == " "][:RESIDUES]
atoms_a = [(residue.get_resname(), residue.id[1], atom.get_id(), atom.element, atom.coord.astype(float)) for residue in residues for atom in residue if atom.element != "H"]
plddt_residue = np.array([residue["CA"].get_bfactor() for residue in residues])

coords = np.array([atom[4] for atom in atoms_a])
centre = coords.mean(axis=0)
# Two-fold about an axis parallel to z through centre + d*u, u at 135° in the xy plane: the copy
# lands 2d along u. That direction gave the widest contact of the orientations tried.
DIRECTION = np.array([math.cos(3 * math.pi / 4), math.sin(3 * math.pi / 4), 0.0])
def copy_at(d):
    pivot = centre + d * DIRECTION
    rotated = coords - pivot
    rotated[:, 0] *= -1.0
    rotated[:, 1] *= -1.0
    return rotated + pivot
def closest(d):
    other = copy_at(d)
    return np.sqrt(((coords[:, None, :] - other[None, :, :]) ** 2).sum(-1)).min()
d = 2.0
while closest(d) < 3.2:
    d += 0.1
coords_b = copy_at(d)
atoms_b = [(name, number, atom_name, element, coords_b[index]) for index, (name, number, atom_name, element, _) in enumerate(atoms_a)]
chains = [("A", atoms_a), ("B", atoms_b)]

def representative(atoms):
    """Cβ per residue, Cα for glycine, in residue order."""
    out = []
    for number in range(1, RESIDUES + 1):
        here = {atom[2]: atom[4] for atom in atoms if atom[1] == number}
        name = next(atom[0] for atom in atoms if atom[1] == number)
        out.append(here["CA"] if name == "GLY" or "CB" not in here else here["CB"])
    return np.array(out)

cb = np.vstack([representative(atoms_a), representative(atoms_b)])
n = 2 * RESIDUES
chain_of = np.array(["A"] * RESIDUES + ["B"] * RESIDUES)
distance = np.sqrt(((cb[:, None, :] - cb[None, :, :]) ** 2).sum(-1))

with open(SOURCE_PAE) as handle:
    real = np.array(json.load(handle)[0]["predicted_aligned_error"], dtype=float)[:RESIDUES, :RESIDUES]

def pae_matrix(extra=0.0):
    pae = np.zeros((n, n))
    pae[:RESIDUES, :RESIDUES] = real
    pae[RESIDUES:, RESIDUES:] = real
    inter = np.clip(0.8 + 0.22 * distance + 0.9 * np.maximum(0.0, distance - 15.0) + extra, 1.0, 31.75)
    block = inter[:RESIDUES, RESIDUES:] + 0.4          # A rows aligned on B: a little worse
    pae[:RESIDUES, RESIDUES:] = np.clip(block, 1.0, 31.75)
    pae[RESIDUES:, :RESIDUES] = inter[RESIDUES:, :RESIDUES]
    return np.round(pae, 2)

plddt = np.concatenate([plddt_residue, plddt_residue])

# ---------- ColabFold ----------

def colabfold_interface(pae, plddt, cutoff=15.0):
    """colabfold/alphafold/ipsae.py get_interface_scores, on the same inputs."""
    def ptm(x, d0): return 1.0 / (1.0 + (x / d0) ** 2.0)
    def d0_array(values): return np.maximum(1.0, 1.24 * (np.maximum(26.0, np.asarray(values, dtype=float)) - 15.0) ** (1.0 / 3.0) - 1.8)
    asym = np.array([0] * RESIDUES + [1] * RESIDUES)
    out = {"ipsae": {}, "pdockq": {}, "pdockq2": {}}
    labels = {0: "A", 1: "B"}
    for c1 in (0, 1):
        for c2 in (0, 1):
            if c1 == c2: continue
            key = labels[c1] + "-" + labels[c2]
            mask = np.outer(asym == c1, asym == c2)
            valid = mask & (pae < cutoff)
            n0 = valid.sum(axis=1)
            sums = (ptm(pae, d0_array(n0)[:, None]) * valid).sum(axis=1)
            by_res = np.divide(sums, n0, out=np.zeros_like(sums), where=n0 > 0)
            out["ipsae"][key] = round(float(by_res.max()), 6)
            contacts = mask & (distance <= 8.0)
            count = contacts.sum()
            interface = contacts.any(axis=1) | contacts.any(axis=0)
            mean_plddt = plddt[interface].mean()
            pdockq = 0.724 / (1.0 + np.exp(-0.052 * (mean_plddt * np.log10(count) - 152.611))) + 0.018
            pdockq2 = 1.31 / (1.0 + np.exp(-0.075 * (mean_plddt * ptm(pae[contacts], 10.0).mean() - 84.733))) + 0.005
            if c1 < c2: out["pdockq"][key] = round(float(pdockq), 4)
            out["pdockq2"][key] = round(float(pdockq2), 4)
    return out

def af2_pdb(plddt_values):
    """AlphaFold's protein.to_pdb layout: one MODEL, chains A and B numbered from 1, B = pLDDT."""
    lines = ["MODEL     1"]
    serial = 1
    for chain_index, (chain_id, atoms) in enumerate(chains):
        for name, number, atom_name, element, xyz in atoms:
            b = plddt_values[chain_index * RESIDUES + number - 1]
            label = atom_name if len(atom_name) == 4 else " " + atom_name
            lines.append(f"ATOM  {serial:>5} {label:<4} {name:>3} {chain_id}{number:>4}    {xyz[0]:>8.3f}{xyz[1]:>8.3f}{xyz[2]:>8.3f}{1.0:>6.2f}{b:>6.2f}          {element:>2}")
            serial += 1
        last = atoms[-1]
        lines.append(f"TER   {serial:>5}      {last[0]:>3} {chain_id}{last[1]:>4}")
        serial += 1
    lines += ["ENDMDL", "END", ""]
    return "\n".join(lines)

colabfold = HERE / "colabfold"
shutil.rmtree(colabfold, ignore_errors=True); colabfold.mkdir()
for rank, (model, extra, iptm, ptm_value) in enumerate([("model_2", 0.0, 0.71, 0.74), ("model_4", 6.0, 0.48, 0.66)], start=1):
    tag = f"rank_{rank:03d}_alphafold2_multimer_v3_{model}_seed_000"
    pae = pae_matrix(extra)
    scores = {"plddt": np.round(plddt, 2).tolist(), "max_pae": float(pae.max()), "pae": pae.tolist(), "ptm": ptm_value, "iptm": iptm}
    scores.update(colabfold_interface(pae, plddt))
    (colabfold / f"{JOB}_scores_{tag}.json").write_text(json.dumps(scores))
    (colabfold / f"{JOB}_unrelaxed_{tag}.pdb").write_text(af2_pdb(plddt))
(colabfold / "config.json").write_text(json.dumps({"model_type": "alphafold2_multimer_v3", "num_models": 2, "version": "1.5.5"}, indent=2))

# ---------- python-modelcif writers (Boltz and Chai-1) ----------

def modelcif_text(chain_specs, biso_for):
    """chain_specs: [(chain_id, kind, atoms)], kind 'protein' or 'ligand'. biso_for(chain_index, atom_index)."""
    system = modelcif.System()
    asyms = []
    entities = {}   # one entity per distinct sequence, shared by identical chains, as Boltz does
    for chain_id, kind, atoms in chain_specs:
        if kind == "protein":
            sequence = []
            for number in range(1, max(atom[1] for atom in atoms) + 1):
                name = next(atom[0] for atom in atoms if atom[1] == number)
                # As Boltz does: three-letter names are not keys of the one-letter alphabet,
                # so every residue becomes LPeptideChemComp(id=name, code=name, code_canonical="X").
                alphabet = ihm.LPeptideAlphabet()
                sequence.append(alphabet[name] if name in alphabet else ihm.LPeptideChemComp(id=name, code=name, code_canonical="X"))
            key = ("protein",) + tuple(comp.id for comp in sequence)
            entity = entities.get(key) or entities.setdefault(key, modelcif.Entity(sequence))
        else:
            entity = entities.get(("LIG",)) or entities.setdefault(("LIG",), modelcif.Entity([ihm.NonPolymerChemComp(id="LIG")]))
        asyms.append(modelcif.AsymUnit(entity, details="Model subunit " + chain_id, id=chain_id))
    assembly = modelcif.Assembly(asyms, name="Modeled assembly")
    class Model(modelcif.model.AbInitioModel):
        def get_atoms(self):
            for chain_index, (chain_id, kind, atoms) in enumerate(chain_specs):
                for atom_index, (name, number, atom_name, element, xyz) in enumerate(atoms):
                    yield modelcif.model.Atom(asym_unit=asyms[chain_index], type_symbol=element.upper(), seq_id=number, atom_id=atom_name,
                                              x=f"{xyz[0]:.5f}", y=f"{xyz[1]:.5f}", z=f"{xyz[2]:.5f}", het=kind == "ligand",
                                              biso=biso_for(chain_index, atom_index), occupancy=1)
    model = Model(assembly=assembly, name="Model")
    system.model_groups.append(modelcif.model.ModelGroup([model], name="All models"))
    ihm.dumper.set_line_wrap(False)
    handle = io.StringIO(); modelcif.dumper.write(handle, [system]); return handle.getvalue()

# A six-atom ligand for Boltz, placed 4-6 Å off chain A so the token count differs from the residue count.
anchor = cb[10]
ligand = [("LIG", 1, f"C{k + 1}", "C", anchor + np.array([4.5 + 1.4 * math.cos(k * math.pi / 3), 1.4 * math.sin(k * math.pi / 3), 0.0])) for k in range(6)]

def boltz_pae(extra):
    tokens = n + len(ligand)
    pae = np.full((tokens, tokens), 12.0)
    pae[:n, :n] = pae_matrix(extra)
    to_a = np.linspace(3.0, 6.0, RESIDUES)
    pae[n:, :RESIDUES] = to_a; pae[:RESIDUES, n:] = to_a[:, None]
    pae[n:, RESIDUES:n] = 18.0; pae[RESIDUES:n, n:] = 18.0
    pae[n:, n:] = 1.5
    return pae.astype(np.float32)

boltz = HERE / "boltz"
shutil.rmtree(boltz, ignore_errors=True); boltz.mkdir()
token_plddt = np.concatenate([plddt, np.full(len(ligand), 72.0)]) / 100.0
for index, (extra, score, iptm) in enumerate([(0.0, 0.83, 0.74), (5.0, 0.69, 0.51)]):
    stem = f"{JOB}_model_{index}"
    specs = [("A", "protein", atoms_a), ("B", "protein", atoms_b), ("C", "ligand", ligand)]
    def biso(chain_index, atom_index, specs=specs):
        if chain_index == 2: return round(float(token_plddt[n + atom_index]) * 100, 3)
        number = specs[chain_index][2][atom_index][1]
        return round(float(token_plddt[chain_index * RESIDUES + number - 1]) * 100, 3)
    (boltz / f"{stem}.cif").write_text(modelcif_text(specs, biso))
    pair = {str(i): {str(j): round(iptm if i != j else 0.8, 4) for j in range(3)} for i in range(3)}
    confidence = {"confidence_score": score, "ptm": round(iptm + 0.05, 4), "iptm": iptm, "ligand_iptm": 0.6, "protein_iptm": iptm,
                  "complex_plddt": float(token_plddt.mean()), "complex_iplddt": 0.8, "complex_pde": 1.2, "complex_ipde": 2.4,
                  "chains_ptm": {str(i): pair[str(i)][str(i)] for i in range(3)}, "pair_chains_iptm": pair}
    (boltz / f"confidence_{stem}.json").write_text(json.dumps(confidence, indent=4))
    np.savez_compressed(boltz / f"pae_{stem}.npz", pae=boltz_pae(extra))
    np.savez_compressed(boltz / f"plddt_{stem}.npz", plddt=token_plddt.astype(np.float32))
    np.savez_compressed(boltz / f"pde_{stem}.npz", pde=(boltz_pae(extra) * 0.5).astype(np.float32))
with zipfile.ZipFile(HERE / f"boltz_results_{JOB}.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(boltz.iterdir()):
        archive.write(path, f"boltz_results_{JOB}/predictions/{JOB}/{path.name}")

# ---------- Chai-1 ----------

chai = HERE / "chai"
shutil.rmtree(chai, ignore_errors=True); chai.mkdir()
for index, (aggregate, iptm) in enumerate([(0.52, 0.44), (0.71, 0.66)]):   # sample 1 ranks first
    specs = [("A", "protein", atoms_a), ("B", "protein", atoms_b)]
    def biso(chain_index, atom_index, specs=specs):
        number = specs[chain_index][2][atom_index][1]
        return float(plddt[chain_index * RESIDUES + number - 1])
    (chai / f"pred.model_idx_{index}.cif").write_text(modelcif_text(specs, biso))
    scores = {
        "aggregate_score": np.array([aggregate], dtype=np.float32),
        "ptm": np.array([iptm + 0.08], dtype=np.float32),
        "iptm": np.array([iptm], dtype=np.float32),
        "per_chain_ptm": np.array([[0.81, 0.79]], dtype=np.float32),
        "per_chain_pair_iptm": np.array([[[0.81, iptm], [iptm, 0.79]]], dtype=np.float32),
        "has_inter_chain_clashes": np.array([False]),
        "chain_chain_clashes": np.zeros((1, 2, 2), dtype=np.int64),
    }
    np.savez(chai / f"scores.model_idx_{index}.npz", allow_pickle=False, **scores)
with zipfile.ZipFile(HERE / f"chai_{JOB}.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(chai.iterdir()):
        archive.write(path, f"chai_{JOB}/{path.name}")

# ---------- AlphaFold 3 (server names), per-atom pLDDT so Cβ and Cα differ ----------

af3 = HERE / "af3"
shutil.rmtree(af3, ignore_errors=True); af3.mkdir()
atom_rows, atom_plddts, atom_chain_ids = [], [], []
serial = 1
for chain_index, (chain_id, atoms) in enumerate(chains):
    for name, number, atom_name, element, xyz in atoms:
        base = plddt[chain_index * RESIDUES + number - 1]
        value = round(float(base - (3.0 if atom_name == "CB" else 0.0) - (1.5 if atom_name not in ("N", "CA", "C", "O", "CB") else 0.0)), 2)
        atom_plddts.append(value); atom_chain_ids.append(chain_id)
        atom_rows.append(f"ATOM {serial} {element} {atom_name} . {name} {chain_id} {chain_index + 1} {number} ? {xyz[0]:.3f} {xyz[1]:.3f} {xyz[2]:.3f} 1.00 {value:.2f} {number} {chain_id} 1")
        serial += 1
header = ["data_" + JOB, "#", "loop_"] + ["_atom_site." + field for field in ["group_PDB", "id", "type_symbol", "label_atom_id", "label_alt_id", "label_comp_id", "label_asym_id", "label_entity_id", "label_seq_id", "pdbx_PDB_ins_code", "Cartn_x", "Cartn_y", "Cartn_z", "occupancy", "B_iso_or_equiv", "auth_seq_id", "auth_asym_id", "pdbx_PDB_model_num"]]
(af3 / f"fold_{JOB}_model_0.cif").write_text("\n".join(header + atom_rows + ["#", ""]))
full = {"atom_chain_ids": atom_chain_ids, "atom_plddts": atom_plddts, "contact_probs": np.round(np.exp(-distance / 8.0), 2).tolist(),
        "pae": pae_matrix().tolist(), "token_chain_ids": chain_of.tolist(), "token_res_ids": [i % RESIDUES + 1 for i in range(n)]}
(af3 / f"fold_{JOB}_full_data_0.json").write_text(json.dumps(full))
summary = {"chain_iptm": [0.69, 0.69], "chain_pair_iptm": [[0.84, 0.69], [0.69, 0.84]], "chain_pair_pae_min": [[0.76, 2.1], [2.3, 0.76]],
           "chain_ptm": [0.84, 0.84], "fraction_disordered": 0.0, "has_clash": 0.0, "iptm": 0.69, "num_recycles": 10.0, "ptm": 0.76, "ranking_score": 0.72}
(af3 / f"fold_{JOB}_summary_confidences_0.json").write_text(json.dumps(summary))

# ---------- expected interface scores from the reference implementation ----------

def run_reference(ipsae, pae_file, structure_file, pae_cutoff, dist_cutoff):
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        for path in [pae_file, structure_file] + [p for p in pae_file.parent.iterdir() if p.name.startswith(("plddt_", "confidence_")) or "summary_confidences" in p.name]:
            shutil.copy(path, folder / path.name)
        subprocess.run([sys.executable, str(ipsae), pae_file.name, structure_file.name, str(pae_cutoff), str(dist_cutoff)], cwd=folder, check=True, capture_output=True)
        stem = structure_file.name.rsplit(".", 1)[0]
        text = (folder / f"{stem}_{int(pae_cutoff):02d}_{int(dist_cutoff):02d}.txt").read_text()
    names = ["chain1", "chain2", "pae", "dist", "type", "ipSAE", "ipSAE_d0chn", "ipSAE_d0dom", "ipTM_af", "ipTM_d0chn", "pDockQ", "pDockQ2", "LIS", "n0res", "n0chn", "n0dom", "d0res", "d0chn", "d0dom", "nres1", "nres2", "dist1", "dist2"]
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 24 or parts[0] == "Chn1": continue
        row = dict(zip(names, parts))
        for key in names[5:]: row[key] = float(row[key])
        rows.append(row)
    return rows

if len(sys.argv) > 1:
    ipsae = Path(sys.argv[1]).resolve()
    expected = {"reference": "DunbrackLab/IPSAE ipsae.py", "sha256": hashlib.sha256(ipsae.read_bytes()).hexdigest(), "cases": {}}
    cases = {
        "colabfold": (colabfold / f"{JOB}_scores_rank_001_alphafold2_multimer_v3_model_2_seed_000.json", colabfold / f"{JOB}_unrelaxed_rank_001_alphafold2_multimer_v3_model_2_seed_000.pdb"),
        "boltz": (boltz / f"pae_{JOB}_model_0.npz", boltz / f"{JOB}_model_0.cif"),
        "af3": (af3 / f"fold_{JOB}_full_data_0.json", af3 / f"fold_{JOB}_model_0.cif"),
    }
    for name, (pae_file, structure_file) in cases.items():
        expected["cases"][name] = {"structure": structure_file.name, "runs": {f"{p}_{q}": run_reference(ipsae, pae_file, structure_file, p, q) for p, q in [(10, 10), (15, 15)]}}
    (HERE / "expected-ipsae.json").write_text(json.dumps(expected, indent=1) + "\n")
    print("expected-ipsae.json written from", ipsae)

print("closest approach between the chains:", round(float(closest(d)), 2), "Å · interface Cβ pairs within 8 Å:", int(((distance <= 8.0) & (chain_of[:, None] != chain_of[None, :])).sum() // 2))
