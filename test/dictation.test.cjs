'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDictationReader } = require('../main/dictation');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'javis-dictation-'));
  const file = path.join(dir, 'store.json');
  let revision = 0;
  const received = [];
  const store = { settings: { keepHistory: true }, login: { userId: 'fixture' }, history: [] };
  const row = (id, extra = {}) => ({ id, utteranceId: id, mode: 'dictate', result: `fixture ${id}`, createdAt: new Date().toISOString(), durationMs: 100, ...extra });
  async function save() { store.revision = ++revision; await fs.writeFile(file, JSON.stringify(store)); }
  const reader = createDictationReader({ file, onTranscript: item => received.push(item) });
  try {
    store.history = [row('old')]; await save(); await reader.poll();
    await reader.setEnabled(true);
    assert.equal(received.length, 0, 'arming must not replay old history');
    store.history.unshift(row('new')); await save(); await reader.poll(); await reader.poll();
    assert.deepEqual(received.map(x => x.id), ['new']);
    store.history.unshift(row('translate', { mode: 'translate' }), row('imported', { createdAt: '2020-01-01T00:00:00Z' }));
    await save(); await reader.poll(); assert.equal(received.length, 1);
    await reader.setEnabled(false);
    store.history.unshift(row('paused')); await save();
    await reader.setEnabled(true); assert.equal(received.length, 1, 'rearming must skip paused results');
    await fs.writeFile(file, '{'); await reader.poll();
    store.history.unshift(row('after-partial')); await save(); await reader.poll();
    assert.equal(received.at(-1).id, 'after-partial', 'partial writes must not consume future results');
    store.login.userId = 'different-account'; store.history = [row('account-old')];
    await save(); await reader.poll(); assert.equal(received.length, 2, 'account switch must establish a fresh baseline');
    store.history.unshift(row('account-new')); await save(); await reader.poll();
    assert.equal(received.at(-1).id, 'account-new');
    store.settings.keepHistory = false; store.history.unshift(row('disabled-history'));
    await save(); await reader.poll(); assert.equal(reader.status().ready, false); assert.equal(received.length, 3);
    console.log('✓ dictation: no history replay, exactly-once, pause baseline, partial writes, account switch, stale imports, dictate-only');
  } finally { reader.stop(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
