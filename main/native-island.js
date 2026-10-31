'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { buildNativeIsland } = require('../scripts/build-native-island.cjs');
function createNativeIsland({ onAction, onFailure, build = buildNativeIsland, launch = spawn, readyTimeout = 10000 } = {}) {
  let child = null, starting = null, visible = false, stopped = false, ready = false;
  let snapshot = {};
  const write = value => {
    if (ready && child?.stdin.writable) child.stdin.write(JSON.stringify(value) + '\n');
  };
  async function start() {
    if (ready && child) return;
    if (starting) return starting;
    stopped = false;
    starting = (async () => {
      const binary = await build();
      if (stopped) throw new Error('Native island stopped');
      await new Promise((resolve, reject) => {
        const process = launch(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        child = process;
        let settled = false, closed = false;
        const timer = setTimeout(() => { reject(new Error('Native island readiness timeout')); process.kill(); }, readyTimeout);
        const fail = error => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          const wasCurrent = child === process;
          if (wasCurrent) { child = null; ready = false; visible = false; }
          if (!settled) { settled = true; reject(error); }
          else if (!stopped && wasCurrent) onFailure?.(error);
        };
        process.once('error', fail);
        process.once('exit', () => fail(new Error('Native island disconnected')));
        process.stdin.on('error', () => {});
        process.stderr.on('data', () => {});
        readline.createInterface({ input: process.stdout }).on('line', line => {
          let data;
          try { data = JSON.parse(line); } catch { return; }
          if (data.event === 'ready' && !settled) {
            clearTimeout(timer); settled = true; ready = true;
            write(snapshot); resolve();
          } else if (typeof data.action === 'string') onAction?.(data.action);
        });
      });
    })();
    try { await starting; } finally { starting = null; }
  }
  return {
    async show(shouldShow = () => true) {
      await start();
      if (stopped || !shouldShow()) return false;
      write(snapshot); write({ command: 'show' }); visible = true; return true;
    },
    hide() { visible = false; write({ command: 'hide' }); },
    isVisible() { return visible; },
    update(patch) { snapshot = { ...snapshot, ...patch }; write(patch); },
    stop() { stopped = true; visible = false; write({ command: 'quit' }); child?.stdin.end(); child?.kill(); child = null; ready = false; },
  };
}
module.exports = { createNativeIsland };
