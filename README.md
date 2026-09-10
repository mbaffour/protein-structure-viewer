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

- Multiple PDB, CIF, and mmCIF files—or an AlphaFold ZIP—in one view
- Drag-and-drop loading, automatic ZIP extraction, and show-all/hide-all controls
- Independent visibility and colors per structure
- Cartoon, stick, sphere, and line representations
- Per-structure, per-chain, pLDDT, sequence-spectrum, and element color schemes
- Standard AlphaFold pLDDT legend and mean pLDDT calculation from Cα B-factor values
- Spin and rocking animations with adjustable speed
- PNG export
- Downloadable HTML reports with every selected model embedded
- Previous/next navigation, automatic cycling, arrow-key navigation, pLDDT colors, and PNG export inside generated reports
- No build step, account, backend, or bundled example data

## Create a shareable model report

1. Load all model files that should appear in the report.
2. Select **Download HTML report**.
3. Open the resulting `protein-model-report.html` in a browser.

The report embeds the loaded coordinate data and lets the reader choose models, move forward or backward, or automatically cycle through them. Like the main viewer, it loads 3Dmol.js from a CDN when opened.

## GitHub Pages

Because the application is a single `index.html`, it can be hosted directly with GitHub Pages. In repository settings, choose **Pages**, deploy from the `main` branch, and select the repository root.

## Privacy

Structure files remain in browser memory and are not transmitted by this application.

## License

MIT
