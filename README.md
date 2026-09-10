# Protein Structure Viewer

A lightweight, single-file browser viewer for protein structures. Nothing is uploaded to a server: selected structure files are read locally by the browser.

## Launch locally

- macOS: double-click `Launch Protein Viewer.command`.
- Any platform: open `index.html` in a modern browser.

An internet connection is required when the page starts because it loads the [3Dmol.js](https://3dmol.org/) rendering library from a CDN.

## Load AlphaFold models

1. Download the result from AlphaFold Server or another prediction tool.
2. Open the viewer.
3. Drop the AlphaFold `.zip` directly onto the viewer, or select one or more `.pdb`, `.cif`, or `.mmcif` model files.

When an AlphaFold ZIP is loaded, model structures are extracted automatically and template-hit files are ignored.

Multiple structures can be displayed together. Each loaded structure has its own visibility switch, color picker, mean pLDDT readout, and remove button.

## Features

- Multiple PDB, CIF, and mmCIF files—or a complete AlphaFold result ZIP—in one view
- Drag-and-drop loading, automatic ZIP extraction, and show-all/hide-all controls
- Automatic AlphaFold 2/3 confidence JSON and ranking CSV association when filenames match their models
- Independent visibility and colors per structure
- Full model names in the model list and navigator
- Overlay mode or one-model-at-a-time mode, with previous/next controls, keyboard navigation, adjustable automatic cycling, and sorting by ranking score or mean pLDDT
- Cartoon, stick, sphere, and line representations
- Per-structure, per-chain, pLDDT, sequence-spectrum, and element color schemes
- Standard AlphaFold pLDDT legend and mean pLDDT calculation from Cα B-factor values
- Interactive PAE heatmaps with residue/token inspection and PNG export
- Model-level pTM, ipTM, ranking score, rank, and clash indicators, plus chain-pair ipTM and minimum PAE when available
- Downloadable confidence-metrics CSV
- Click any atom to inspect its model, residue, chain, atom name, and pLDDT
- Add or edit custom residue labels, or label every residue in the current model
- Sequence-aware Cα alignment or strict chain/residue-ID alignment, with a one-click coordinate restore
- Per-model aligned-residue count, sequence identity, chain mapping, Cα RMSD, and downloadable alignment CSV
- Spin and rocking animations with adjustable speed
- PNG image export and 5-, 10-, or 15-second WebM spin-video export
- Downloadable HTML reports with every selected model embedded
- Previous/next navigation, automatic cycling, arrow-key navigation, saved custom labels, pLDDT/PAE confidence, provenance, PNG export, and WebM spin-video recording inside generated reports
- Reproducible scene manifests with SHA-256 structure-file hashes, camera, model state, colors, labels, alignment settings, and scientific provenance
- No build step, account, backend, or bundled example data

## Create a shareable model report

1. Load all model files that should appear in the report.
2. Select **Download HTML report**.
3. Open the resulting `protein-model-report.html` in a browser.

The report embeds the loaded coordinate data and lets the reader choose models, move forward or backward, or automatically cycle through them. Like the main viewer, it loads 3Dmol.js from a CDN when opened.

## Scientific-use notes

- pLDDT is a per-residue confidence measure. It does not by itself establish that a multimeric interface or relative chain placement is correct.
- Alignment is intended for visual comparison of related models. Sequence-aware mode globally aligns amino-acid sequences and reports its chain mapping, identity, aligned Cα count, and RMSD; inspect those values before interpreting an overlay.
- The generated report is a presentation artifact, not a replacement for the original coordinate files, AlphaFold confidence JSON, PAE plots, or experimental validation.

See [`SCIENTIFIC-AUDIT.md`](SCIENTIFIC-AUDIT.md) for the publication/reviewer-readiness audit and remaining roadmap.

## GitHub Pages

Because the application is a single `index.html`, it can be hosted directly with GitHub Pages. In repository settings, choose **Pages**, deploy from the `main` branch, and select the repository root.

## Privacy

Structure files remain in browser memory and are not transmitted by this application.

## License

MIT
