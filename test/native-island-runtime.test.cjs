'use strict';
// Exercise the compiled macOS helper over its real JSONL pipe without displaying
// a window, executing an agent command, or touching the user's configuration.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { buildNativeIsland } = require('../scripts/build-native-island.cjs');
(async () => {
  const binary = await buildNativeIsland();
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const messages = [], waiters = [];
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    const value = JSON.parse(line); messages.push(value);
    for (const waiter of [...waiters]) if (waiter.predicate(value)) { waiters.splice(waiters.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(value); }
  });
  const exited = new Promise((resolve, reject) => { child.once('exit', code => resolve(code)); child.once('error', reject); });
  child.stderr.resume();
  const wait = predicate => {
    const found = messages.find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = {predicate,resolve,timer:setTimeout(()=>reject(new Error('Native helper timeout')),10000)}; waiters.push(waiter);
    });
  };
  try {
    assert.equal((await wait(value=>value.event==='ready')).engine,'SwiftUI/AppKit');
    child.stdin.write(JSON.stringify({state:'working',theme:'day',opacity:.55,text:'Runtime verification'})+'\n');
    const active = await wait(value=>value.event==='layout' && value.width===406);
    assert.equal(active.height,132);
    child.stdin.write(JSON.stringify({state:'idle',held:false})+'\n');
    const idle = await wait(value=>value.event==='layout' && value.width===292);
    assert.equal(idle.height,72);
    child.stdin.end();
    const exitTimeout=setTimeout(()=>child.kill(),5000);
    assert.equal(await exited,0,'stdin EOF should terminate the helper cleanly');
    clearTimeout(exitTimeout);
    console.log('✓ compiled SwiftUI helper: real JSONL readiness, 406×132 active / 292×72 standby bounds, EOF shutdown');
  } finally { child.kill(); for(const waiter of waiters) clearTimeout(waiter.timer); }
})().catch(error=>{ console.error(error);process.exitCode=1; });
