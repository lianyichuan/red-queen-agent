'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const config = require('./config');
const executor = require('./executor');
const tts = require('./tts');
const { createDictationReader } = require('./dictation');
const { createRexConsole } = require('./rex');
const { createNativeIsland } = require('./native-island');
const { normalizeAppearance } = require('./appearance');

const APP_ROOT = path.join(__dirname, '..');
const rexConsole = createRexConsole({ appRoot: APP_ROOT });
let rexTurn = null;

function recordActivity(kind, text) {
  try { rexConsole.append(kind, text); } catch (e) { healthLog('REX', { error: e.message }); }
}

async function openRexConsole() {
  try {
    const result = await rexConsole.open();
    emitToOverlay('javis:rex', { ready: true, ...result });
    return result;
  } catch (e) {
    emitToOverlay('javis:rex', { ready: false, reason: e.message });
    return null;
  }
}

let overlayWin = null;
let settingsWin = null;
let child = null; // 当前执行器子进程
let state = 'idle'; // idle | working | speaking | error
let pendingAudioEnd = false;
let lastSessionId = null;
let history = []; // [{user, assistant}] 兜底上下文
let turnEpoch = 0; // 停止后丢弃旧执行器或 TTS 的延迟结果。
let dictationReader = null;
let fullBounds = null;
let lastDispatch = null;
let compactMode = false;
let interfaceHidden = false;
let nativeEpoch = 0;
const nativeIsland = createNativeIsland({
  onAction(action) {
    if (action === 'expand') showFullInterface();
    else if (action === 'stop') handleStop();
    else if (action === 'voice') dictationReader?.setEnabled(!dictationReader.status().enabled);
    else if (action === 'settings') createSettings();
    else if (action === 'hide') hideInterface();
    else if (action === 'theme') saveConfiguration({ appearance: { theme: config.load().appearance?.theme === 'day' ? 'night' : 'day' } });
  },
  onFailure(error) {
    healthLog('NATIVE_ISLAND', { error: error.message });
    if (compactMode && !interfaceHidden) overlayWin?.showInactive();
  },
});
function hideInterface() {
  interfaceHidden = true;
  ++nativeEpoch;
  nativeIsland.hide();
  overlayWin?.hide();
}
function showFullInterface() {
  interfaceHidden = false;
  compactMode = false;
  ++nativeEpoch;
  nativeIsland.hide();
  emitToOverlay('javis:mode', { mode: 'full' });
  overlayWin?.show();
  overlayWin?.focus();
}
async function showNativeIsland() {
  const appearance = normalizeAppearance(config.load().appearance);
  if (!appearance.nativeIsland || process.platform !== 'darwin' || interfaceHidden) return;
  const epoch = ++nativeEpoch;
  nativeIsland.update(appearance);
  try {
    const shown = await nativeIsland.show(() => epoch === nativeEpoch && compactMode && !interfaceHidden);
    if (shown) overlayWin?.hide();
  } catch (error) {
    healthLog('NATIVE_ISLAND', { error: error.message });
    if (compactMode && !interfaceHidden) overlayWin?.showInactive();
  }
}
function saveConfiguration(patch) {
  const merged = config.save(patch);
  emitToOverlay('javis:config', merged);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('javis:config', merged);
  return merged;
}

function emitToOverlay(channel, data) {
  if (channel === 'javis:state') nativeIsland.update({ state: data.state, ...(data.state === 'idle' ? { level: 0, text: 'Command link established.' } : {}) });
  else if (channel === 'javis:outline') nativeIsland.update({ text: data.label });
  else if (channel === 'javis:reply') nativeIsland.update({ text: data.text });
  else if (channel === 'javis:error') nativeIsland.update({ text: data.message });
  else if (channel === 'javis:dictationStatus') nativeIsland.update({ voice: data.enabled === true });
  else if (channel === 'javis:dictation' && data.disposition === 'held') nativeIsland.update({ held: true });
  else if (channel === 'javis:config') nativeIsland.update(normalizeAppearance(data.appearance));
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(channel, data);
}

function submitInstruction(text, source = 'manual') {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return;
  // Bageshuo may also paste into the focused composer. Cross-source deduplication
  // prevents the same utterance reaching the executor through both routes.
  if (lastDispatch && lastDispatch.text === value && lastDispatch.source !== source && Date.now() - lastDispatch.at < 6000) {
    if (source === 'dictation') emitToOverlay('javis:dictation', { text: value, disposition: 'duplicate' });
    return;
  }
  if (state !== 'idle') {
    if (source === 'dictation') emitToOverlay('javis:dictation', { text: value, disposition: 'held' });
    else emitToOverlay('javis:busy', {});
    return;
  }
  lastDispatch = { text: value, source, at: Date.now() };
  if (source === 'dictation') {
    emitToOverlay('javis:dictation', { text: value, disposition: 'submitted' });
    if (!compactMode && !interfaceHidden && overlayWin && !overlayWin.isVisible()) overlayWin.showInactive();
  }
  handleSend(value);
}

function setState(next) {
  state = next;
  if (process.env.JAVIS_E2E) console.log('[E2E] state →', next);
  emitToOverlay('javis:state', { state });
}

function sendOutline(label) {
  emitToOverlay('javis:outline', { label });
}

function createOverlay() {
  const wa = screen.getPrimaryDisplay().workArea;
  // 固定投影面板；状态切换只改变内部反馈，不再跳动窗口尺寸。
  const W = Math.min(760, wa.width - 32);
  const H = Math.min(700, wa.height - 32);

  overlayWin = new BrowserWindow({
    width: W,
    height: H,
    x: wa.x + wa.width - W - 20,
    y: wa.y + wa.height - H - 12,
    frame: false,
    show: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  overlayWin.setMinimumSize(280, 64);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
  overlayWin.once('ready-to-show', () => { if (overlayWin && !interfaceHidden && !nativeIsland.isVisible()) overlayWin.showInactive(); });
  overlayWin.webContents.on('render-process-gone', (_e, details) => {
    try {
      require('fs').appendFileSync(
        require('os').homedir() + '/.javis/health.log',
        `${new Date().toISOString()} CRASH ${details.reason}\n`
      );
    } catch {}
  });
  overlayWin.on('closed', () => {
    dictationReader?.setEnabled(false);
    nativeIsland.hide();
    overlayWin = null;
  });
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 640,
    title: 'Red Queen Configuration',
    show: false,
    backgroundColor: '#101115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(APP_ROOT, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

/* ---------------- 一轮对话的编排 ---------------- */

/** 播报净化：剥离链接/路径/markdown/引用括号，语音和字幕都用它 */
function speechText(s) {
  return (s || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\[([^\]]*)\]\s*\([^)]*\)/g, '$1')
    .replace(/[(\[{]\s*[)\]}]/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 解析 [SAY]/[MORE] 两段式输出：SAY 朗读，MORE 只显示 */
function splitReply(raw) {
  const m = (raw || '').match(/\[SAY\]([\s\S]*?)(?:\[MORE\]([\s\S]*))?$/i);
  if (!m) return { say: (raw || '').trim(), detail: '' };
  return { say: (m[1] || '').trim(), detail: (m[2] || '').trim() };
}

/** 健康日志：对话轮次留痕（start/end/error + 执行器 + 耗时），排障有据可查 */
function healthLog(kind, extra) {
  try {
    require('fs').appendFileSync(
      require('os').homedir() + '/.javis/health.log',
      `${new Date().toISOString()} ${kind} ${JSON.stringify(extra || {})}\n`
    );
  } catch {}
}

async function handleSend(text) {
  if (state !== 'idle') {
    overlayWin && overlayWin.webContents.send('javis:busy', {});
    return;
  }
  const cfg = config.load();
  const activeTurn = ++turnEpoch;
  setState('working');
  sendOutline('ESTABLISHING EXECUTION LINK…');
  const turnStart = Date.now();
  healthLog('TURN', { start: cfg.executor, text: text.slice(0, 60) });
  recordActivity('DIRECTIVE RECEIVED', text);
  rexTurn = activeTurn;

  try {
    const terminal = await openRexConsole();
    if (activeTurn !== turnEpoch) return;
    const { reply, sessionId } = await executor.runTurn({
      text,
      sessionId: lastSessionId,
      history,
      cfg,
      appRoot: APP_ROOT,
      workDir: app.getPath('home'),
      runtimeContext: terminal ? `Rex observation console is connected to session ${terminal.sessionId}. Actual tool activity and results are visible to the operator. Execute authorized directives and verify outcomes. Use the local rex CLI for visible working terminals when needed. Use rex --help to confirm commands before operating it. Keep the Live Operations observation pane open. Use English labels for new terminals and sessions.` : 'Rex observation console is unavailable. Existing execution tools remain available; do not claim a terminal is visible.',
      onOutline: (label) => { if (activeTurn === turnEpoch) sendOutline(label); },
      onActivity: ({ kind, text: activity }) => { if (activeTurn === turnEpoch) recordActivity(kind, activity); },
      onChild: (c) => {
        if (activeTurn === turnEpoch) child = c;
        else c.kill('SIGTERM');
      },
    });
    if (activeTurn !== turnEpoch) return;
    child = null;
    lastSessionId = sessionId || lastSessionId;
    rexTurn = null;
    recordActivity('EXECUTION COMPLETE', reply || 'No final response received. Verify the operation result.');
    if (reply) history.push({ user: text, assistant: reply });

    if (!reply) {
      setState('idle');
      sendOutline('…');
      return;
    }

    const { say, detail } = splitReply(reply);
    const spoken =
      speechText(say) || speechText(detail).split(/[。！？\n]/)[0] || 'Operation complete.';
    // Strip paired Markdown decoration without corrupting formulas, paths or
    // identifiers (for example 17*23 and file_name must retain their symbols).
    const shownDetail = (detail || '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '').trim();
    if (process.env.JAVIS_E2E) console.log('[E2E] executor 回复 say=', JSON.stringify(spoken));
    healthLog('TURN', { end: cfg.executor, sec: Math.round((Date.now() - turnStart) / 1000), say: spoken.slice(0, 60) });
    setState('speaking');
    nativeIsland.update({ text: spoken });
    try {
      const { file } = await tts.synth(spoken, cfg.tts || {});
      if (activeTurn !== turnEpoch) return;
      if (process.env.JAVIS_E2E) console.log('[E2E] TTS 文件', file);
      pendingAudioEnd = true;
      if (overlayWin && !overlayWin.isDestroyed()) {
        emitToOverlay('javis:reply', { text: spoken, detail: shownDetail, audioFile: file });
      }
    } catch (e) {
      if (activeTurn !== turnEpoch) return;
      // TTS 失败也把文字给出去
      pendingAudioEnd = true;
      if (overlayWin && !overlayWin.isDestroyed()) {
        emitToOverlay('javis:reply', { text: spoken, detail: shownDetail, audioFile: null });
      }
    }
  } catch (e) {
    if (activeTurn !== turnEpoch) return;
    rexTurn = null;
    recordActivity('OPERATION FAILED', e.message || String(e));
    child = null;
    setState('error');
    let msg = String((e && e.message) || e);
    // 报错翻译 + 诊断信息（错误码/路径），方便定位
    if (/^spawn .*ENOENT/i.test(msg)) msg = 'Engine executable unavailable (ENOENT): ' + msg.replace(/^spawn /i, '') + ' — Verify installation';
    else if (/^spawn /i.test(msg)) msg = 'Engine startup failed (' + (e.code || '?') + '): ' + msg.replace(/^spawn /i, '');
    else if (/Model .* is not supported/i.test(msg)) msg = 'Model unavailable on this gateway. Select another model or engine in Configuration.';
    if (process.env.JAVIS_E2E) console.log('[E2E] error:', msg);
    healthLog('TURN', { error: cfg.executor, sec: Math.round((Date.now() - turnStart) / 1000), msg: msg.slice(0, 120) });
    if (overlayWin && !overlayWin.isDestroyed()) {
      emitToOverlay('javis:error', { message: msg });
    }
    setTimeout(() => {
      if (activeTurn === turnEpoch && state === 'error') setState('idle');
    }, 4000);
  }
}

function handleStop() {
  if (rexTurn != null) { recordActivity('OPERATION ABORTED', 'Operator aborted the current operation. Completed external actions are not automatically reversed.'); rexTurn = null; }
  ++turnEpoch;
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {}
    child = null;
  }
  pendingAudioEnd = false;
  setState('idle');
}

/* ---------------- IPC ---------------- */

ipcMain.on('javis:send', (_e, text) => {
  submitInstruction(text);
});
ipcMain.handle('javis:openRex', () => openRexConsole());
ipcMain.handle('javis:getDictationStatus', () => dictationReader?.status() || { enabled: false, ready: false, reason: 'CHECKING SPEECH RECOGNITION' });
ipcMain.handle('javis:setDictationEnabled', (_e, enabled) => dictationReader?.setEnabled(enabled === true));
ipcMain.on('javis:stop', handleStop);
ipcMain.on('javis:islandStatus', (_e, status) => nativeIsland.update({ held: status?.held === true }));
ipcMain.on('javis:audioLevel', (_e, level) => { if (Number.isFinite(level) && state === 'speaking') nativeIsland.update({ level: Math.max(0, Math.min(1, level)) }); });
ipcMain.on('javis:audioEnded', () => {
  if (pendingAudioEnd) {
    pendingAudioEnd = false;
    setState('idle');
  }
});
ipcMain.on('javis:openSettings', () => createSettings());
ipcMain.on('javis:hide', hideInterface);
ipcMain.on('javis:quit', () => app.quit());
ipcMain.on('javis:menu', () => {
  if (!overlayWin) return;
  const { Menu } = require('electron');
  Menu.buildFromTemplate([
    { label: 'Configuration', click: () => createSettings() },
    { type: 'separator' },
    { label: 'Issue directive', click: () => { overlayWin.focus(); overlayWin.webContents.executeJavaScript('document.getElementById("chat").focus()'); } },
    { type: 'separator' },
    { label: 'Hide interface · ⌥Space to recall', click: hideInterface },
    { label: 'Exit Red Queen', click: () => app.quit() },
  ]).popup({ window: overlayWin });
});
ipcMain.on('javis:resize', (_e, w, h) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  const b = overlayWin.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const W = Math.min(wa.width - 16, Math.max(280, Math.round(w)));
  const H = Math.min(wa.height - 16, Math.max(64, Math.round(h)));
  const island = H < 180;
  compactMode = island;
  if (island) showNativeIsland();
  else { ++nativeEpoch; nativeIsland.hide(); }
  overlayWin.setResizable(!island);
  if (island && b.height >= 180) fullBounds = b;
  if (island) {
    overlayWin.setBounds({
      x: Math.max(wa.x + 8, Math.min(b.height >= 180 ? wa.x + Math.round((wa.width - W) / 2) : Math.round(b.x + (b.width - W) / 2), wa.x + wa.width - W - 8)),
      y: Math.max(wa.y + 8, Math.min(b.height >= 180 ? wa.y + 12 : b.y, wa.y + wa.height - H - 8)),
      width: W, height: H,
    });
    return;
  }
  const anchor = b.height < 180 && fullBounds ? fullBounds : b;
  // 以当前位置的右下角为锚点缩放，保留用户拖放的位置
  overlayWin.setBounds({
    x: Math.max(wa.x + 8, Math.min(anchor.x + anchor.width - W, wa.x + wa.width - W - 8)),
    y: Math.max(wa.y + 8, Math.min(anchor.y + anchor.height - H, wa.y + wa.height - H - 8)),
    width: W,
    height: H,
  });
});

/* 按住拖动：主进程跟踪光标移动窗口；带看门狗——光标 1.2 秒没动就自动结束
   （兜底"松开鼠标发生在窗口外"导致收不到 mouseup 的粘连场景） */
let dragTimer = null;
let dragOffset = null;
let lastCursor = null;
let lastCursorAt = 0;
ipcMain.on('javis:dragStart', () => {
  if (!overlayWin || dragTimer) return;
  const p = screen.getCursorScreenPoint();
  const b = overlayWin.getBounds();
  dragOffset = { x: p.x - b.x, y: p.y - b.y };
  lastCursor = p;
  lastCursorAt = Date.now();
  dragTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    const p2 = screen.getCursorScreenPoint();
    if (p2.x !== lastCursor.x || p2.y !== lastCursor.y) {
      lastCursor = p2;
      lastCursorAt = Date.now();
    } else if (Date.now() - lastCursorAt > 1200) {
      // 光标长时间没动：视为已松手但事件丢失，自动结束拖动
      clearInterval(dragTimer);
      dragTimer = null;
      return;
    }
    overlayWin.setPosition(p2.x - dragOffset.x, p2.y - dragOffset.y);
  }, 16);
});
ipcMain.on('javis:dragEnd', () => {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
});
ipcMain.on('javis:focusWin', () => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.show();
  overlayWin.focus();
});

/* 启动心跳：渲染层就绪即上报，崩溃即落盘 —— 健康状态随时可查（~/.javis/health.log） */
ipcMain.on('javis:boot', (_e, info) => {
  try {
    const fs = require('fs');
    const line = `${new Date().toISOString()} BOOT ${JSON.stringify(info || {})}\n`;
    fs.appendFileSync(require('os').homedir() + '/.javis/health.log', line);
  } catch {}
});
ipcMain.handle('javis:getConfig', () => ({
  config: config.load(),
  env: config.environment(),
}));
ipcMain.handle('javis:saveConfig', (_e, patch) => saveConfiguration(patch));

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showFullInterface);

  app.whenReady().then(() => {
    app.setName('Red Queen');
    try {
      const iconPath = path.join(APP_ROOT, 'build', 'icon.png');
      if (process.platform === 'darwin' && app.dock && require('fs').existsSync(iconPath)) {
        app.dock.setIcon(iconPath);
      }
    } catch {}

    createOverlay();
    dictationReader = createDictationReader({
      onTranscript: ({ text }) => submitInstruction(text, 'dictation'),
      onStatus: (status) => emitToOverlay('javis:dictationStatus', status),
    });
    dictationReader.start();
    globalShortcut.register('Alt+Space', () => {
      if (!overlayWin) { interfaceHidden = false; return createOverlay(); }
      if (nativeIsland.isVisible() || overlayWin.isVisible()) hideInterface();
      else {
        interfaceHidden = false;
        if (compactMode) { overlayWin.showInactive(); showNativeIsland(); }
        else { overlayWin.show(); overlayWin.focus(); }
      }
    });
    setInterval(() => tts.cleanup(), 30 * 60 * 1000).unref();

    // E2E 全链路自测：JAVIS_E2E=1 只记日志；JAVIS_E2E_FULL=1 额外自动发一句话
    if (process.env.JAVIS_E2E_FULL) {
      setTimeout(() => {
        console.log('[E2E] 自动发送测试指令');
        handleSend('Confirm readiness and the current local time in one sentence.');
      }, 6000);
    }
  });

  app.on('window-all-closed', () => {
    // 常驻应用：关窗不退出（可从菜单/重启唤起）
  });

  app.on('before-quit', () => {
    dictationReader?.stop();
    globalShortcut.unregisterAll();
    handleStop();
    ++nativeEpoch;
    interfaceHidden = true;
    nativeIsland.stop();
  });
}
