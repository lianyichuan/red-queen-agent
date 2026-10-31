'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRexConsole, clean } = require('../main/rex');
const { activityFor } = require('../main/executor');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'javis-rex-'));
  try {
    const calls = [];
    let creations = 0, denySwitch = false, dead = false;
    const invoke = async args => {
      calls.push(args);
      if (args[0] === 'new') { creations++; return { session_id: `s${creations}`, initial_windows: [{ block_ids: [`b${creations}`] }] }; }
      if (args[0] === 'block') return { child: { pid: 123 }, last_exit: dead ? { code: 0 } : null };
      if (args[0] === 'client') return { clients: [{ client_id: 'local', connection_state: 'connected', info: { kind: 'app', platform: 'macos' }, principal: { transport: 'unix' } }] };
      if (denySwitch) throw new Error('Turn on Remote Control');
      return null;
    };
    const terminal = createRexConsole({ appRoot: path.join(__dirname, '..'), directory, invoke });
    const pair = await Promise.all([terminal.connect(), terminal.connect()]);
    assert.equal(creations, 1, 'concurrent connects create one session');
    assert.equal(pair[0].sessionId, pair[1].sessionId);
    assert.equal((await terminal.open()).visible, true);
    assert.equal(creations, 1, 'reuse running observation pane');
    denySwitch = true;
    const ready = await terminal.open();
    assert.equal(ready.sessionId, 's1', 'disabled app remote control does not disable execution/logging');
    assert.equal(ready.visible, false);
    assert.match(ready.reason, /Rex/);
    dead = true;
    await terminal.connect();
    assert.equal(creations, 2, 'recreate exited viewer without touching unrelated sessions');
    terminal.append('命令结果', '中文结果\nBearer abc-secret\napi_key=xyz-secret\x1b]52;c;ignored\x07');
    const log = fs.readFileSync(terminal.file, 'utf8');
    assert.match(log, /中文结果/);
    assert.ok(!log.includes('abc-secret') && !log.includes('xyz-secret'));
    assert.ok(!log.includes('\x1b') && !log.includes('\x07'));
    assert.equal(fs.statSync(terminal.file).mode & 0o777, 0o600);
    assert.ok(!calls.some(args => /kill|close|settings|permission/.test(args.join(' '))));
    assert.equal(clean('sk-abcdefghijklmnop'), '[REDACTED]');
    assert.equal(activityFor({ type: 'item.completed', item: { type: 'reasoning', text: 'private' } }), null);
    const result = activityFor({ type: 'item.completed', item: { type: 'command_execution', command: 'pwd', exit_code: 1, aggregated_output: 'denied' } });
    assert.match(result.text, /exit=1\ndenied/);
    assert.equal(activityFor({ type: 'item.completed', item: { type: 'agent_message', text: 'intermediate' } }), null);
    const tool = activityFor({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'x', tool: 'read', result: { ok: true } } });
    assert.match(tool.text, /"ok":true/);
    console.log('✓ Rex: session reuse, concurrent connect, remote-control fallback, exited viewer recovery, private log, real tool results only');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
