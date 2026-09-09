# Protein Structure Viewer

A lightweight, single-file browser viewer for protein structures. Nothing is uploaded to a server: selected structure files are read locally by the browser.

## Launch locally

- macOS: double-click `Launch Protein Viewer.command`.
- Any platform: open `index.html` in a modern browser.

An internet connection is required when the page starts because it loads the [3Dmol.js](https://3dmol.org/) rendering library from a CDN.

## Load AlphaFold models

1. Download and unzip the result from AlphaFold Server or another prediction tool.
2. Open the viewer.
3. Select one or more model files ending in `.pdb`, `.cif`, or `.mmcif`.

Multiple structures can be displayed together. Each loaded structure has its own visibility switch, color picker, mean pLDDT readout, and remove button.

## Features

- Multiple PDB, CIF, and mmCIF files in one view
- Independent visibility and colors per structure
- Cartoon, stick, sphere, and line representations
- Per-structure, per-chain, pLDDT, sequence-spectrum, and element color schemes
- Standard AlphaFold pLDDT legend and mean pLDDT calculation from Cα B-factor values
- Spin and rocking animations with adjustable speed
- PNG export
- No build step, account, backend, or bundled example data

## GitHub Pages

Because the application is a single `index.html`, it can be hosted directly with GitHub Pages. In repository settings, choose **Pages**, deploy from the `main` branch, and select the repository root.

## Privacy

Structure files remain in browser memory and are not transmitted by this application.

## License

MIT

