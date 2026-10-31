const $ = (id) => document.getElementById(id);

(async () => {
  const { config, env } = await window.javis.getConfig();

  // Environment status
  $('env').textContent =
    `GATEWAY  ${env.codexInfo.baseUrl || '—'}\n` +
    `ACTIVE MODEL  ${env.codexInfo.model || '—'}\n` +
    `Codex CLI  ${env.codexBin || 'NOT FOUND'}\n` +
    `Claude CLI  ${env.claudeBin || 'NOT FOUND'}\n` +
    `CONFIGURATION  ${env.configPath}`;
  $('st-codex').textContent = env.codexBin ? '' : '(NOT INSTALLED)';
  $('st-claude').textContent = env.claudeBin ? '' : '(NOT INSTALLED)';

  for (const slug of env.codexInfo.catalogModels || []) {
    const o = document.createElement('option');
    o.value = slug;
    $('codex-models').appendChild(o);
  }
  if (env.codexInfo.model) {
    const o = document.createElement('option');
    o.value = env.codexInfo.model;
    $('codex-models').appendChild(o);
  }

  // Form values
  document.querySelector(`input[name=executor][value=${config.executor}]`).checked = true;
  $('codex-model').value = config.codex.model || '';
  $('codex-effort').value = config.codex.effort || 'low';
  $('codex-sandbox').value = config.codex.sandbox || 'workspace-write';
  $('claude-model').value = config.claude.model || '';
  $('claude-perm').value = config.claude.permissionMode || 'acceptEdits';
  $('tts-voice').value = config.tts.voice || 'zh-CN-XiaoyiNeural';
  $('tts-redqueen').checked = !!config.tts.redqueen;
  const storedRate = /^([+-]?\d+)%$/.exec(config.tts.rate || '');
  $('tts-rate').value = storedRate ? Math.max(-50, Math.min(100, Number(storedRate[1]))) : 15;
  const updateRateLabel = () => { $('tts-rate-value').textContent = `${100 + Number($('tts-rate').value)}%`; };
  $('tts-rate').addEventListener('input', updateRateLabel);
  updateRateLabel();
  $('auto-send').value = config.autoSendDelayMs ?? 1200;

  $('save').addEventListener('click', async () => {
    await window.javis.saveConfig({
      executor: document.querySelector('input[name=executor]:checked').value,
      codex: {
        model: $('codex-model').value.trim(),
        effort: $('codex-effort').value,
        sandbox: $('codex-sandbox').value,
      },
      claude: {
        model: $('claude-model').value.trim(),
        permissionMode: $('claude-perm').value,
      },
      tts: {
        voice: $('tts-voice').value,
        rate: `${Number($('tts-rate').value) >= 0 ? '+' : ''}${$('tts-rate').value}%`,
        redqueen: $('tts-redqueen').checked,
      },
      autoSendDelayMs: parseInt($('auto-send').value, 10) || 1200,
    });
    $('toast').classList.add('show');
    setTimeout(() => window.close(), 700);
  });
})();
