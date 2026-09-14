  /* ---------- Appearance theme ---------- */

  const themeModes = [
    { value: 'system', icon: 'monitor', label: 'System' },
    { value: 'light', icon: 'sun', label: 'Light' },
    { value: 'dark', icon: 'moon', label: 'Dark' }
  ];

  function applyTheme(value) {
    const mode = themeModes.find(item => item.value === value) || themeModes[0];
    if (mode.value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode.value);
    const button = root.querySelector('#gpv-theme');
    button.dataset.mode = mode.value;
    button.querySelector('.gpv-theme-text').textContent = mode.label;
    const host = button.querySelector('[data-icon]');
    host.setAttribute('data-icon', mode.icon);
    host.replaceChildren();
    if (typeof gpvRenderIcons === 'function') gpvRenderIcons(button);
    button.setAttribute('aria-label', 'Appearance: ' + (mode.value === 'system' ? 'follow system' : mode.label.toLowerCase()));
    writeJson(themeKey, mode.value);
    /* The 3D canvas background follows the resolved theme, so repaint it. */
    applyAppearance();
  }

