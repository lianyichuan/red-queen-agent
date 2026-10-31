'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
function harness() {
  const children = [], timers = [];
  const context = vm.createContext({
    module: { exports: {} },
    require(name) {
      if (name === './config') return { resolveBin: () => '/mock/agent', envForSpawn: () => ({}) };
      if (name === 'child_process') return { spawn() {
        const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
        c.kill = signal => { c.signalCode = signal; };
        children.push(c); return c;
      } };
      return require(name);
    },
    setTimeout(fn) { timers.push(fn); return { unref() {} }; }, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main/executor.js'), 'utf8'), context);
  const run = executor => context.module.exports.runTurn({ cfg: { executor }, text: 'test', sessionId: 'prior', appRoot: '/missing', workDir: '/mock' });
  return { children, timers, run };
}
function event(c, data) { c.stdout.emit('data', Buffer.from(JSON.stringify(data) + '\n')); }
(async () => {
  {
    const h = harness(), p = h.run('codex'), c = h.children[0];
    event(c, { type: 'turn.failed', error: { message: 'network failed' } });
    c.emit('close', 1);
    await assert.rejects(p, /network failed/);
    assert.equal(h.children.length, 1, 'turn.failed never replays side effects');
  }
  for (const engine of ['codex', 'claude']) {
    const h = harness(), p = h.run(engine), c = h.children[0];
    c.kill('SIGTERM'); c.emit('close', null);
    await assert.rejects(p, /SIGTERM/);
    assert.equal(h.children.length, 1, 'cancelled resumed task never restarts');
    const t = harness(), q = t.run(engine);
    t.timers[0](); t.children[0].emit('close', 1);
    await assert.rejects(q, /timed out/);
    assert.equal(t.children.length, 1, 'timeout never restarts');
    const f = harness(), r = f.run(engine);
    f.children[0].stderr.emit('data', Buffer.from('permission denied'));
    f.children[0].emit('close', 1);
    await assert.rejects(r, /permission denied/);
    assert.equal(f.children.length, 1, 'generic failure never repeats a task');
  }
  {
    const h = harness(), p = h.run('codex');
    h.children[0].stderr.emit('data', Buffer.from('thread not found'));
    h.children[0].emit('close', 1);
    assert.equal(h.children.length, 2, 'missing session alone permits fresh context fallback');
    event(h.children[1], { type: 'item.completed', item: { type: 'agent_message', text: '[SAY] done' } });
    h.children[1].emit('close', 0);
    assert.equal((await p).reply, '[SAY] done');
  }
  console.log('✓ executor events: cancellation, timeout and failed tasks cannot replay; missing conversation fallback retained');
})().catch(e => { console.error(e); process.exitCode = 1; });
