// Explicit, offline visual preview. Never loaded as a bridge in the desktop app.
(() => {
  if (window.javis || new URLSearchParams(location.search).get('preview') !== '1') return;
  document.body.classList.add('preview-mode');
  const listeners = new Map();
  const emit = (channel, data) => (listeners.get(channel) || []).forEach(fn => fn(data));
  let replyTimer;
  let endingTimer;
  let currentState = 'idle';
  let voiceEnabled = false;
  let previewConfig = {autoSendDelayMs:1800, appearance:JSON.parse(localStorage.getItem('javis:previewAppearance') || 'null') || {theme:'night',opacity:.94}};
  const state = (next) => {
    currentState = next;
    clearTimeout(replyTimer);
    clearTimeout(endingTimer);
    emit('javis:state', { state: next });
    document.querySelectorAll('.preview-poses button').forEach(button => button.setAttribute('aria-pressed', 'false'));
    document.querySelectorAll('.preview-controls button[data-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === next)));
    if (next === 'working') emit('javis:outline', { label: 'DIRECTIVE RECEIVED / Planning operation…' });
    if (next === 'speaking') emit('javis:reply', { text: '任务已完成。执行结果已呈报，等待后续指令。', detail: '这是离线报告示例，不调用模型或执行命令。\n\n完整回复会保留在这里，支持滚动与复制。', audioFile: null });
    if (next === 'error') emit('javis:error', { message: 'Execution channel interrupted. Review engine configuration.' });
  };
  window.javis = {
    on(channel, callback) { if (!listeners.has(channel)) listeners.set(channel, []); listeners.get(channel).push(callback); },
    getConfig: async () => ({ config: previewConfig }),
    openRex: async () => { emit('javis:rex', { ready: false, reason: 'OFFLINE PREVIEW / USE DESKTOP APP' }); return null; },
    getDictationStatus: async () => ({ enabled: voiceEnabled, ready: true, reason: 'SIMULATED SPEECH RECOGNITION' }),
    setDictationEnabled: async (value) => {
      voiceEnabled = value;
      const status = { enabled: value, ready: true, reason: 'SIMULATED SPEECH RECOGNITION' };
      emit('javis:dictationStatus', status);
      return status;
    },
    saveConfig: async (patch) => { previewConfig = {...previewConfig, ...patch}; localStorage.setItem('javis:previewAppearance', JSON.stringify(previewConfig.appearance)); emit('javis:config', previewConfig); return previewConfig; },
    send(text) {
      state('working');
      emit('javis:outline', { label: `DIRECTIVE RECEIVED: ${text}` });
      replyTimer = setTimeout(() => state('speaking'), 1700);
    },
    stop: () => state('idle'),
    audioEnded() { endingTimer = setTimeout(() => state('idle'), 5000); },
    resize() {}, dragStart() {}, dragEnd() {}, focusWin() {}, boot() {},
    hide() { document.getElementById('panel').animate([{ opacity: 1 }, { opacity: .2 }, { opacity: 1 }], 600); },
    openSettings() { alert('Offline preview. Configuration is available in the desktop app.'); },
    menu() {},
  };
  const note = document.createElement('div');
  note.className = 'preview-note';
  note.innerHTML = 'RED QUEEN<br>HOLOGRAPHIC INTERFACE<br><span style="letter-spacing:0;color:#665e69">OFFLINE PREVIEW / NO EXECUTION</span>';
  document.body.append(note);
  const controls = document.createElement('nav');
  controls.className = 'preview-controls';
  controls.setAttribute('aria-label', 'Preview operational states');
  [['idle','STANDBY'],['listening','UPLINK'],['working','EXECUTE'],['speaking','REPORT'],['error','ALERT']].forEach(([key,label]) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.dataset.state = key;
    button.setAttribute('aria-pressed', String(key === 'idle'));
    button.onclick = () => state(key);
    controls.append(button);
  });
  document.body.append(controls);
  const longReply = document.createElement('button');
  longReply.textContent = 'LONG REPORT';
  longReply.onclick = () => {
    state('speaking');
    emit('javis:reply', {
      text: '任务已完成。以下是执行结果，请审阅。'.repeat(8),
      detail: Array.from({ length: 24 }, (_, i) => `${i + 1}. 这是用于验证报告滚动、文本保留和输入区域可用性的离线示例。`).join('\n'),
      audioFile: null,
    });
  };
  controls.append(longReply);
  const dictate = document.createElement('button');
  dictate.textContent = 'VOICE TEST';
  dictate.onclick = () => {
    if (!voiceEnabled) { alert('Enable speech recognition first. This preview uses simulated input.'); return; }
    const text = 'Review current directives and prepare a brief mission report.';
    emit('javis:dictation', { text, disposition: currentState === 'idle' ? 'submitted' : 'held' });
    if (currentState === 'idle') window.javis.send(text);
  };
  controls.append(dictate);
  const poses = document.createElement('nav');
  poses.className = 'preview-poses';
  poses.setAttribute('aria-label', 'Projection pose preview');
  [['idle','STANDBY'],['scrutiny','ASSESS'],['command','COMMAND'],['takeover','TAKEOVER'],['speaking','REPORT']].forEach(([key,label]) => {
    const button = document.createElement('button');
    button.textContent = `${label}`;
    button.onclick = () => {
      window.javisOrb?.setPose(key);
      poses.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    };
    poses.append(button);
  });
  document.body.append(poses);
  window.javisPreview = { state, emit };
})();
