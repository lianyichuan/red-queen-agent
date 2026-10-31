'use strict';

// Exercise the actual orchestration with delayed executors/TTS, without network,
// subprocesses, credentials, or writes to the user's Javis configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setImmediate: nextTick } = require('node:timers/promises');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

async function harness(rexError = false) {
  const events = [], runs = [], voices = [], windows = [];
  const handlers = new Map();
  const fakeFS = { appendFileSync() {}, existsSync: () => false };
  class Window {
    constructor(options) {
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      windows.push(this);
      this.webContents = {
        on() {},
        send(channel, data) {
          events.push({ channel, data });
          // A renderer can acknowledge a reply immediately when TTS is absent.
          if (channel === 'javis:reply') handlers.get('javis:audioEnded')();
        },
      };
    }
    isDestroyed() { return false; }
    isVisible() { return true; }
    setMinimumSize() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    loadFile() {} on() {} once() {} getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    setResizable(value) { this.resizable = value; }
  }
  const electron = {
    app: { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, setName() {}, getPath: () => '/mock-home' },
    BrowserWindow: Window,
    ipcMain: { on: (name, fn) => handlers.set(name, fn), handle: (name, fn) => handlers.set(name, fn) },
    globalShortcut: { register() {}, unregisterAll() {} },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    },
  };
  const modules = {
    electron,
    './config': { load: () => ({ executor: 'mock', tts: {}, appearance: {nativeIsland:false} }) },
    './appearance': require('../main/appearance'),
    './native-island': { createNativeIsland: () => ({update(){}, hide(){}, stop(){}, isVisible(){return false;}, async show(){return false;}}) },
    './executor': { runTurn(options) { const d = deferred(); runs.push({ ...d, options }); return d.promise; } },
    './tts': { synth() { const d = deferred(); voices.push(d); return d.promise; }, cleanup() {} },
    './dictation': { createDictationReader: () => ({ start() {}, stop() {}, status: () => ({ enabled: false }) }) },
    './rex': { createRexConsole: () => ({ append() {}, open: async () => { if (rexError) throw new Error('Rex unavailable'); return { sessionId: 'mock-rex', visible: true }; } }) },
    fs: fakeFS,
    os: { homedir: () => '/mock-home' },
  };
  const context = vm.createContext({
    require(name) { return modules[name] || require(name); },
    __dirname: path.join(__dirname, '../main'),
    process: { env: {}, platform: 'darwin' },
    console,
    setTimeout() { return 1; },
    setInterval() { return { unref() {} }; },
    clearInterval() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8'), context);
  await nextTick();
  return { context, events, runs, voices, handlers, windows };
}

(async () => {
  {
    const h = await harness(true);
    const turn = h.context.handleSend('work without Rex');
    await nextTick();
    assert.equal(h.runs.length, 1, 'unavailable Rex must not disable actual executor');
    assert.equal(h.events.find(x => x.channel === 'javis:rex').data.ready, false);
    h.runs[0].resolve({ reply: '' });
    await turn;
  }
  {
    const h = await harness();
    const turn = h.context.handleSend('cancel while connecting Rex');
    h.handlers.get('javis:stop')();
    await turn;
    assert.equal(h.runs.length, 0, 'stop while connecting Rex must not launch a delayed task');
  }
  {
    const h = await harness();
    const win = h.windows[0], original = { ...win.bounds };
    h.handlers.get('javis:resize')(null, 348, 84);
    assert.equal(win.bounds.height, 84, 'island must not retain the full window minimum height');
    assert.equal(win.resizable, false);
    assert.equal(win.bounds.x, 546);
    h.handlers.get('javis:resize')(null, 380, 116);
    assert.equal(win.bounds.x + win.bounds.width / 2, 720, 'active island should grow around its centre');
    h.handlers.get('javis:resize')(null, 760, 700);
    assert.equal(win.resizable, true);
    assert.deepEqual({ ...win.bounds }, original, 'expanding must restore the full command window position');
  }
  {
    const h = await harness();
    h.context.submitInstruction('same utterance', 'dictation');
    h.context.submitInstruction('same utterance', 'manual');
    await nextTick();
    assert.equal(h.runs.length, 1, 'paste and direct history must not launch two tasks');
    h.context.submitInstruction('next utterance', 'dictation');
    assert.equal(h.runs.length, 1, 'new dictation while busy must be held for review');
    assert.equal(h.events.filter(x => x.channel === 'javis:dictation').at(-1).data.disposition, 'held');
    h.handlers.get('javis:stop')();
    h.runs[0].resolve({ reply: 'cancelled' });
    await nextTick();
  }
  {
    const h = await harness();
    const turn = h.context.handleSend('cancel executor');
    await nextTick();
    h.handlers.get('javis:stop')();
    h.runs[0].resolve({ reply: '[SAY] late answer', sessionId: 'late' });
    await turn;
    assert.equal(h.voices.length, 0, 'cancelled executor must not start TTS');
    assert.deepEqual(h.events.filter(x => x.channel === 'javis:state').map(x => x.data.state), ['working', 'idle']);
    const count = h.events.length;
    h.runs[0].options.onOutline('late progress');
    assert.equal(h.events.length, count, 'late progress must not overwrite a newer turn');
  }
  {
    const h = await harness();
    const turn = h.context.handleSend('cancel TTS');
    await nextTick();
    h.runs[0].resolve({ reply: '[SAY] hello' });
    await nextTick();
    assert.equal(h.voices.length, 1);
    h.handlers.get('javis:stop')();
    h.voices[0].resolve({ file: '/mock-audio.mp3' });
    await turn;
    assert.equal(h.events.filter(x => x.channel === 'javis:reply').length, 0, 'stopped TTS must not resume speaking');
  }
  {
    const h = await harness();
    const turn = h.context.handleSend('text only');
    await nextTick();
    h.runs[0].resolve({ reply: '[SAY] 已完成。[MORE] **完整内容**。17*23=391，file_name。' });
    await nextTick();
    h.voices[0].reject(new Error('offline TTS'));
    await turn;
    const reply = h.events.find(x => x.channel === 'javis:reply');
    assert.equal(reply.data.audioFile, null);
    assert.equal(reply.data.detail, '完整内容。17*23=391，file_name。');
    assert.equal(h.events.filter(x => x.channel === 'javis:state').at(-1).data.state, 'idle', 'immediate audio-ended acknowledgement must return to idle');
  }
  console.log('✓ lifecycle: cancel executor, cancel TTS, stale progress, full reply and immediate audio acknowledgement');
})().catch(error => { console.error(error); process.exitCode = 1; });
