'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { setImmediate: tick } = require('node:timers/promises');
const { createNativeIsland } = require('../main/native-island');
const { normalizeAppearance } = require('../main/appearance');
function processMock() {
  const process = new EventEmitter();
  process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  process.messages = [];
  process.stdin.on('data', data => process.messages.push(...String(data).trim().split('\n').map(JSON.parse)));
  process.kill = () => { process.killed = true; process.emit('exit', 0); };
  return process;
}
(async () => {
  assert.deepEqual(normalizeAppearance(null), {theme:'night',opacity:.94,nativeIsland:true});
  assert.equal(normalizeAppearance({opacity:Infinity}).opacity,.94);
  assert.equal(normalizeAppearance({opacity:-1}).opacity,.3);
  assert.equal(normalizeAppearance({opacity:9}).opacity,1);
  assert.equal(normalizeAppearance({theme:'unexpected'}).theme,'night');
  {
    let resolveBuild, launches = 0;
    const child = processMock(), actions = [], failures = [];
    const bridge = createNativeIsland({build: () => new Promise(resolve => {resolveBuild=resolve;}),launch:()=>{launches++;return child;},onAction:action=>actions.push(action),onFailure:e=>failures.push(e.message)});
    bridge.update({state:'working',theme:'day',opacity:.6});
    let requested = true;
    const show = bridge.show(()=>requested);
    requested = false;
    resolveBuild('/test/Island');
    await tick();
    child.stdout.write('{"event":"ready"}\n');
    assert.equal(await show,false,'expanding full interface during build must cancel stale native show');
    assert.equal(bridge.isVisible(),false);
    assert.deepEqual(child.messages[0],{state:'working',theme:'day',opacity:.6},'latest snapshot reaches helper before display');
    assert.equal(await bridge.show(),true);
    assert.equal(launches,1,'reuse helper across mode changes');
    assert.equal(bridge.isVisible(),true);
    child.stdout.write('non JSON\n{"action":"expand"}\n');
    assert.deepEqual(actions,['expand']);
    bridge.hide(); assert.equal(bridge.isVisible(),false);
    await bridge.show();
    child.emit('exit',1);
    assert.equal(bridge.isVisible(),false);
    assert.equal(failures.length,1,'crash must notify host to reveal fallback');
    bridge.stop();
  }
  {
    const child = processMock();
    const bridge = createNativeIsland({build:async()=>'/test/Island',launch:()=>child,readyTimeout:15});
    await assert.rejects(bridge.show(),/readiness timeout/);
    assert.equal(child.killed,true);
  }
  {
    let resolveBuild, launches=0;
    const bridge = createNativeIsland({build:()=>new Promise(resolve=>{resolveBuild=resolve;}),launch:()=>{launches++;return processMock();}});
    const show=bridge.show(); bridge.stop(); resolveBuild('/test/Island');
    await assert.rejects(show,/stopped/); assert.equal(launches,0,'quit during compile must not orphan a helper');
  }
  console.log('✓ appearance bounds; native readiness, stale show, snapshot, actions, reuse, crash, timeout and shutdown');
})();
