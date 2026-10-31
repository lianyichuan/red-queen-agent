(() => {
  let current = { theme: 'night', opacity: .94 };
  let timer;
  const apply = (cfg) => {
    current = { ...current, ...cfg?.appearance };
    document.documentElement.dataset.theme = current.theme;
    document.documentElement.style.setProperty('--surface-opacity', current.opacity);
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current.theme)));
    document.querySelectorAll('[data-opacity]').forEach(input => { input.value = Math.round(current.opacity * 100); });
    document.querySelectorAll('[data-opacity-value]').forEach(output => { output.textContent = `${Math.round(current.opacity * 100)}%`; });
  };
  const save = (patch, immediate = false) => {
    apply({ appearance: { ...current, ...patch } });
    clearTimeout(timer);
    const persist = () => window.javis.saveConfig({ appearance: current });
    if (immediate) persist(); else timer = setTimeout(persist, 120);
  };
  const controls = `<div class="appearance-title">DISPLAY CONTROL</div><div class="theme-switch"><button type="button" data-theme-choice="day">☀ DAY</button><button type="button" data-theme-choice="night">☾ NIGHT</button></div><label class="opacity-label">SURFACE OPACITY <output data-opacity-value>94%</output></label><input data-opacity aria-label="Surface opacity" type="range" min="30" max="100" value="94"><p class="appearance-note">Background only · Live across both interfaces</p>`;
  const host = document.getElementById('appearance-controls');
  if (host) host.innerHTML = controls;
  const display = document.getElementById('display');
  if (display) {
    const popover = document.createElement('div');
    popover.id = 'display-controls'; popover.popover = 'auto';
    popover.innerHTML = controls;
    document.body.append(popover);
    display.setAttribute('popovertarget', popover.id);
  }
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = () => save({ theme: button.dataset.themeChoice }, true));
  document.querySelectorAll('[data-opacity]').forEach(input => {
    input.oninput = () => save({ opacity: Number(input.value) / 100 });
    input.onchange = () => save({ opacity: Number(input.value) / 100 }, true);
  });
  window.javis.on('javis:config', apply);
  window.javis.getConfig().then(result => apply(result.config));
})();
