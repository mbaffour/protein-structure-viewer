  /* ---------- Presets ---------- */

  const presets = {
    thesis: { '#gpv-style': 'cartoon', '#gpv-background': 'white', '#gpv-projection': 'orthographic', '#gpv-export-size': '1800x1200', '#gpv-export-scale': '2', '#gpv-hetero': 'stick' },
    slide: { '#gpv-style': 'cartoon', '#gpv-background': 'dark', '#gpv-projection': 'perspective', '#gpv-color-mode': 'chain', '#gpv-hetero': 'stick' },
    review: { '#gpv-style': 'cartoon', '#gpv-color-mode': 'plddt', '#gpv-hide-below': '0', '#gpv-hetero': 'stick', '#gpv-background': 'white' }
  };
  const presetNames = { thesis: 'Thesis figure', slide: 'Dark slide', review: 'Confidence review' };

  function applyPreset(name) {
    Object.entries(presets[name] || {}).forEach(([selector, value]) => {
      const control = root.querySelector(selector);
      if (!control || ![...control.options].some(option => option.value === value)) return;
      control.value = value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (name !== 'slide') root.querySelector('#gpv-export-legend').checked = true;
    updateStatus('Preset applied: ' + presetNames[name]);
  }

