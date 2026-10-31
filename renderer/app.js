const $ = (id) => document.getElementById(id);
const panel = $('panel');
const chat = $('chat');
const bridge = window.javis;
let openingRex = false;
async function showRex() {
  if (openingRex) return;
  openingRex = true;
  $('rex-status').textContent = 'REX / CONNECTING…';
  try { await bridge.openRex(); }
  catch (e) { $('rex-status').textContent = `REX / OFFLINE: ${e.message}`; }
  finally { openingRex = false; }
}
$('rex-console').addEventListener('click', showRex);
$('rex-status').addEventListener('click', showRex);
bridge.on('javis:rex', ({ ready, visible, reason }) => {
  $('rex-status').textContent = ready && visible ? 'REX / LIVE OPERATIONS ↗' : `REX / ${reason || 'OPEN OPERATIONS CONSOLE'}`;
});
const labels = {
  idle: ['STANDBY', 'STANDING BY', 'AWAITING ORDERS'],
  listening: ['UPLINK', 'DIRECTIVE RECEIVED', 'RECEIVING ORDERS'],
  working: ['EXECUTE', 'OPERATION ACTIVE', 'MISSION IN PROGRESS'],
  speaking: ['REPORT', 'MISSION REPORT', 'MISSION REPORT'],
  error: ['ALERT', 'CHANNEL FAULT', 'CHANNEL ALERT'],
};
let backendState = 'idle';
let viewState = 'idle';
let compact = localStorage.getItem('javis:mode') === 'island';
let dictationStatus = { enabled: false, ready: false, reason: 'CHECKING SPEECH RECOGNITION' };
const pendingDictations = [];
let lastSize = '';
let autoSendDelayMs = 1200;
let workStart = 0;
let composing = false;
let debounce = null;
let lastReply = '';
let lastError = '';
let lastOutline = '';
let audioFrame = 0;
let level = 0;
let audioContext = null;
let analyser = null;
let timeData = null;
let frequencyData = null;
let workTimer = null;
let playbackEpoch = 0;
const audio = new Audio();
audio.preload = 'auto';
const bars = Array.from({ length: 37 }, () => {
  const el = document.createElement('i');
  $('waveform').append(el);
  return el;
});

function visual() { return window.javisOrb; }
function refreshState(next) {
  viewState = labels[next] ? next : 'idle';
  Object.keys(labels).forEach(name => panel.classList.toggle(`state-${name}`, name === viewState));
  const [connection, label, code] = labels[viewState];
  $('connection-label').textContent = connection;
  $('state-label').textContent = viewState === 'idle' && lastReply ? 'MISSION COMPLETE' : label;
  $('state-code').textContent = code;
  $('stop').hidden = !['working', 'speaking'].includes(backendState);
  $('stop').firstChild.textContent = backendState === 'speaking' ? 'STOP REPORT ' : 'ABORT ';
  $('send').disabled = backendState !== 'idle';
  visual()?.setState({ idle: 0, listening: 1, working: 2, speaking: 3, error: 4 }[viewState]);
  if (viewState !== 'speaking') setLevel(0);
  syncIsland();
  updateModeSize();
}
function syncIsland() {
  bridge.islandStatus?.({ held: pendingDictations.length > 0 });
  const voiceState = dictationStatus.ready ? 'VOICE LINK ACTIVE' : 'VOICE LINK OFFLINE';
  $('island-state').textContent = `RQ / ${viewState === 'idle' && dictationStatus.enabled ? voiceState : labels[viewState][1]}`;
  $('island-line').textContent = dictationStatus.enabled && !dictationStatus.ready ? dictationStatus.reason : pendingDictations.length ? `${pendingDictations.length} HELD / ${pendingDictations[0]}` : $('line').textContent;
  $('island-stop').hidden = !['working', 'speaking'].includes(backendState);
}
function updateModeSize() {
  const active = backendState !== 'idle' || viewState === 'listening' || pendingDictations.length > 0;
  panel.classList.toggle('island-active', active);
  const dimensions = compact ? (active ? [380, 116] : [348, 84]) : [760, 700];
  const key = dimensions.join(':');
  if (lastSize !== key) { lastSize = key; bridge.resize(...dimensions); }
}
new MutationObserver(syncIsland).observe($('line'), { childList: true, subtree: true, characterData: true });
function setLevel(value) {
  level = Math.max(0, Math.min(1, value));
  panel.style.setProperty('--level', level.toFixed(3));
  visual()?.setLevel(level);
  bridge.audioLevel?.(level);
}
function setDetail(text) {
  $('detail').textContent = text || '';
  $('detail').hidden = true;
  $('detail-toggle').hidden = !text;
  $('detail-toggle').setAttribute('aria-expanded', 'false');
  $('detail-toggle').innerHTML = 'MISSION REPORT <span>↗</span>';
}
function stopAudio(notify = false) {
  ++playbackEpoch;
  audio.pause();
  audio.onended = audio.onerror = null;
  audio.removeAttribute('src');
  audio.load();
  clearTimeout(audioFrame);
  setLevel(0);
  visual()?.setMouth({ vol: 0 });
  if (notify) bridge.audioEnded();
}
function updateElapsed() {
  $('elapsed').textContent = backendState === 'working' ? `${Math.floor((Date.now() - workStart) / 1000)}s` : '';
}
bridge.on('javis:state', ({ state }) => {
  backendState = state;
  if (state === 'working') {
    clearTimeout(debounce);
    workStart = Date.now();
    lastError = '';
    lastOutline = '';
    $('line').textContent = 'Directive received. Operation in progress.';
    setDetail('');
    clearInterval(workTimer);
    workTimer = setInterval(updateElapsed, 1000);
  } else {
    clearInterval(workTimer);
    workTimer = null;
  }
  if (state === 'idle') {
    stopAudio();
    $('line').textContent = lastError || lastReply || 'Command link established. Awaiting directive.';
  }
  refreshState(state);
  updateElapsed();
});
bridge.on('javis:outline', ({ label }) => {
  if (!label) return;
  lastOutline = label.replace(/^[▸\s]+/, '');
  if (backendState === 'working') $('line').textContent = lastOutline;
});
bridge.on('javis:busy', () => { $('input-hint').textContent = 'OPERATION ACTIVE / INPUT RETAINED'; });
bridge.on('javis:error', ({ message }) => {
  lastError = message;
  $('line').textContent = message;
  stopAudio();
});
function applyConfig(cfg) {
  if (Number.isFinite(cfg?.autoSendDelayMs)) autoSendDelayMs = Math.max(300, cfg.autoSendDelayMs);
}
bridge.on('javis:config', applyConfig);
function applyDictationStatus(status) {
  if (!status) return;
  dictationStatus = status;
  panel.classList.toggle('voice-armed', Boolean(status.enabled));
  for (const id of ['island-voice', 'dictation-toggle', 'voice-focus']) {
    $(id).setAttribute('aria-pressed', String(status.enabled));
    $(id).setAttribute('aria-label', status.enabled ? 'Pause speech recognition' : 'Enable speech recognition');
    $(id).title = status.ready ? (status.enabled ? 'Pause speech recognition' : 'Enable speech recognition. No input focus required.') : status.reason;
  }
  $('dictation-toggle').textContent = status.enabled ? '● SPEECH RECOGNITION / ACTIVE' : '○ Enable speech recognition';
  $('input-hint').textContent = status.ready ? 'SPEECH RECOGNITION / LINKED' : status.reason;
  syncIsland();
}
bridge.on('javis:dictationStatus', applyDictationStatus);
bridge.on('javis:dictation', ({ text, disposition }) => {
  if (disposition === 'submitted' || disposition === 'duplicate') {
    if (chat.value.trim() === text.trim()) { clearTimeout(debounce); chat.value = ''; }
  } else if (disposition === 'held') {
    pendingDictations.push(text);
    renderDictationDraft();
    $('input-hint').textContent = 'DIRECTIVES HELD / LOAD WHEN READY';
  }
  syncIsland(); updateModeSize();
});
function renderDictationDraft() {
  $('dictation-draft').hidden = !pendingDictations.length;
  $('dictation-draft').textContent = `${pendingDictations.length} HELD / LOAD NEXT: ${pendingDictations[0] || ''}`;
}
$('dictation-draft').addEventListener('click', () => {
  if (chat.value.trim()) { $('input-hint').textContent = 'TRANSMIT OR CLEAR CURRENT INPUT'; return; }
  chat.value = pendingDictations.shift() || '';
  renderDictationDraft();
  chat.focus(); syncIsland(); updateModeSize();
});
async function toggleDictation() {
  try { applyDictationStatus(await bridge.setDictationEnabled(!dictationStatus.enabled)); }
  catch { $('input-hint').textContent = 'SPEECH RECOGNITION / RETRY CONNECTION'; }
}
for (const id of ['dictation-toggle', 'island-voice', 'voice-focus']) $(id).addEventListener('click', toggleDictation);
bridge.on('javis:reply', async ({ text, detail, audioFile }) => {
  stopAudio();
  const activePlayback = playbackEpoch;
  lastReply = text || detail || 'Operation complete.';
  lastError = '';
  $('line').textContent = lastReply;
  setDetail(detail);
  if (!audioFile) { bridge.audioEnded(); return; }
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .78;
      audioContext.createMediaElementSource(audio).connect(analyser);
      analyser.connect(audioContext.destination);
      timeData = new Uint8Array(analyser.fftSize);
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (activePlayback !== playbackEpoch) return;
    audio.src = new URL(`file://${audioFile}`).href;
    audio.onended = audio.onerror = () => { if (activePlayback === playbackEpoch) stopAudio(true); };
    await audio.play();
    const track = () => {
      if (activePlayback !== playbackEpoch) return;
      analyser.getByteTimeDomainData(timeData);
      analyser.getByteFrequencyData(frequencyData);
      const rms = Math.sqrt(timeData.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / timeData.length);
      setLevel(rms * 3.6);
      visual()?.setMouth({ vol: rms });
      audioFrame = setTimeout(track, 40);
    };
    track();
  } catch { if (activePlayback === playbackEpoch) stopAudio(true); }
});

function sendNow() {
  clearTimeout(debounce);
  const text = chat.value.trim();
  if (!text || composing) return;
  if (backendState !== 'idle') {
    $('input-hint').textContent = 'OPERATION ACTIVE / INPUT RETAINED';
    return;
  }
  chat.value = '';
  $('input-hint').textContent = 'SPEECH RECOGNITION';
  bridge.send(text);
}
function scheduleSend() {
  clearTimeout(debounce);
  if (composing || backendState !== 'idle') return;
  refreshState(chat.value.trim() ? 'listening' : 'idle');
  if (chat.value.trim()) debounce = setTimeout(sendNow, autoSendDelayMs);
}
chat.addEventListener('compositionstart', () => { composing = true; clearTimeout(debounce); });
chat.addEventListener('compositionend', () => { composing = false; scheduleSend(); });
chat.addEventListener('input', scheduleSend);
chat.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendNow(); }
  if (event.key === 'Escape') {
    clearTimeout(debounce);
    chat.value = '';
    if (backendState === 'idle') refreshState('idle');
  }
});
$('composer').addEventListener('submit', (event) => { event.preventDefault(); sendNow(); });
$('settings').addEventListener('click', () => bridge.openSettings());
$('hide').addEventListener('click', () => { clearTimeout(debounce); bridge.hide(); });
$('stop').addEventListener('click', () => {
  clearTimeout(debounce);
  stopAudio();
  lastReply = 'Operation aborted. Standing by.';
  lastError = '';
  bridge.stop();
});
$('island-stop').addEventListener('click', () => $('stop').click());
$('detail-toggle').addEventListener('click', () => {
  const open = $('detail').hidden;
  $('detail').hidden = !open;
  $('detail-toggle').setAttribute('aria-expanded', String(open));
  $('detail-toggle').innerHTML = open ? 'CLOSE REPORT <span>↙</span>' : 'MISSION REPORT <span>↗</span>';
});
function applyCompact() {
  panel.classList.toggle('is-island', compact);
  $('compact').setAttribute('aria-pressed', String(compact));
  $('compact').title = compact ? 'Expand command interface' : 'Switch to compact interface';
  localStorage.setItem('javis:mode', compact ? 'island' : 'full');
  updateModeSize(); syncIsland();
}
$('compact').addEventListener('click', () => {
  compact = !compact;
  applyCompact();
});
bridge.on('javis:mode', ({ mode }) => { compact = mode === 'island'; lastSize = ''; applyCompact(); });
$('island-expand').addEventListener('click', () => { compact = false; applyCompact(); });
document.addEventListener('contextmenu', (event) => { event.preventDefault(); bridge.menu(); });

// Start dragging only from the projection/header, so input and control clicks never move the window.
let press = null;
let dragging = false;
for (const handle of [$('stage'), $('drag-handle'), $('island-drag')]) {
  handle.addEventListener('pointerenter', () => visual()?.setHover(true));
  handle.addEventListener('pointerleave', () => visual()?.setHover(false));
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    press = { x: event.screenX, y: event.screenY };
  });
}
window.addEventListener('pointermove', (event) => {
  if (!press || dragging) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) > 6) { dragging = true; bridge.dragStart(); }
});
function endDrag() { if (dragging) bridge.dragEnd(); press = null; dragging = false; }
window.addEventListener('pointerup', () => {
    if (press && !dragging && !compact) { bridge.focusWin(); chat.focus(); }
  endDrag();
});
window.addEventListener('blur', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('mouseleave', endDrag);
window.addEventListener('focus', () => { if (!compact && !document.body.classList.contains('preview-mode')) chat.focus(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(debounce); endDrag(); }
});
window.addEventListener('javis:visual-ready', () => refreshState(viewState));

let lastWaveTime = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function animateWave(now) {
  requestAnimationFrame(animateWave);
  if (document.hidden || now - lastWaveTime < 50) return;
  lastWaveTime = now;
  bars.forEach((bar, index) => {
    const center = 1 - Math.abs(index - 18) / 20;
    const frequency = frequencyData && backendState === 'speaking' ? frequencyData[2 + index] / 255 : 0;
    const activity = reducedMotion.matches ? 0 : frequency || (viewState === 'working' ? .18 * (1 + Math.sin(now / 300 - index / 3)) : viewState === 'listening' ? .15 : 0);
    bar.style.height = `${2 + center * activity * 17}px`;
    bar.style.opacity = String(.4 + center * .6);
  });
}
requestAnimationFrame(animateWave);
if (!bridge) throw new Error('Red Queen bridge is unavailable. Open this page in Red Queen or use ?preview=1.');
(async () => {
  try { applyConfig((await bridge.getConfig()).config); } catch { /* Local input still works without settings. */ }
  try { applyDictationStatus(await bridge.getDictationStatus()); } catch { /* Manual input remains available. */ }
  refreshState('idle');
  applyCompact();
  bridge.boot({ v: 7, renderer: 'redqueen-projection-v2', reducedMotion: reducedMotion.matches, ts: Date.now() });
})();
