"""Write expected-ipsae.json: DunbrackLab/IPSAE ipsae.py run on the published examples here.

Usage:  python make_expected.py <path to ipsae.py>      (needs numpy)
The script itself is not committed; its SHA-256 is recorded in the output.
"""
import hashlib, json, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CASES = {
    "colabfold": ("foldmetrics/colabfold", "barnase_barstar_scores_rank_001_alphafold2_multimer_v3_model_3_seed_000.json", "barnase_barstar_unrelaxed_rank_001_alphafold2_multimer_v3_model_3_seed_000.pdb"),
    "af3_server": ("foldmetrics/af3_server", "fold_barnase_barstar_s318_full_data_0.json", "fold_barnase_barstar_s318_model_0.cif"),
    "af3_local_ligand": ("foldmetrics/af3_mpro_ligand", "mpro_nirmatrelvir_confidences.json", "mpro_nirmatrelvir_model.cif"),
    "boltz2": ("foldmetrics/boltz2", "pae_barnase_barstar_model_0.npz", "barnase_barstar_model_0.cif"),
    "af3_modified_residue_ligands": ("ipsae-aurka-tpx2", "fold_aurka_0_tpx2_0_full_data_0.json", "fold_aurka_0_tpx2_0_model_0.cif"),
}
FIELDS = ["chain1", "chain2", "pae", "dist", "type", "ipSAE", "ipSAE_d0chn", "ipSAE_d0dom", "ipTM_af", "ipTM_d0chn", "pDockQ", "pDockQ2", "LIS", "n0res", "n0chn", "n0dom", "d0res", "d0chn", "d0dom", "nres1", "nres2", "dist1", "dist2"]

def run(ipsae, folder, pae_file, structure, cutoff, dist):
    with tempfile.TemporaryDirectory() as temporary:
        for path in (HERE / folder).iterdir():
            if path.is_file(): shutil.copy(path, Path(temporary) / path.name)
        subprocess.run([sys.executable, str(ipsae), pae_file, structure, str(cutoff), str(dist)], cwd=temporary, check=True, capture_output=True)
        text = (Path(temporary) / f"{structure.rsplit('.', 1)[0]}_{cutoff:02d}_{dist:02d}.txt").read_text()
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 24 or parts[0] == "Chn1": continue
        row = dict(zip(FIELDS, parts))
        for key in FIELDS[5:]: row[key] = float(row[key])
        rows.append(row)
    return rows

ipsae = Path(sys.argv[1]).resolve()
out = {"reference": "DunbrackLab/IPSAE ipsae.py", "sha256": hashlib.sha256(ipsae.read_bytes()).hexdigest(), "cases": {}}
for name, (folder, pae_file, structure) in CASES.items():
    out["cases"][name] = {"folder": folder, "structure": structure, "runs": {f"{p}_{d}": run(ipsae, folder, pae_file, structure, p, d) for p, d in [(10, 10), (15, 15)]}}
(HERE / "expected-ipsae.json").write_text(json.dumps(out, indent=1) + "\n")
print({name: len(case["runs"]["10_10"]) for name, case in out["cases"].items()})
