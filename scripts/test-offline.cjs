'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const tests = ['persona', 'voice-settings', 'dictation', 'rex', 'executor-events', 'lifecycle', 'native-island'];
for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'test', `${test}.test.cjs`)], {stdio:'inherit'});
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
