'use strict';

// Rex is an observable execution console. The existing agent still owns its
// tools; only public tool actions/results are mirrored here, never reasoning.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('./config');
const runFile = promisify(execFile);

function clean(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/\bsk-[\w-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]');
}

function createRexConsole({ appRoot, directory = path.join(os.homedir(), '.javis'), invoke } = {}) {
  const file = path.join(directory, 'execution.log');
  const stateFile = path.join(directory, 'rex-console.json');
  let connection = null;
  let pending = null;
  const call = invoke || (async (args) => {
    const bin = config.resolveBin('rex');
    if (!bin) throw new Error('Rex CLI not found');
    const { stdout } = await runFile(bin, args, { env: config.envForSpawn(), timeout: 12000, maxBuffer: 1024 * 1024 });
    return stdout.trim() ? JSON.parse(stdout) : null;
  });

  function append(kind, text) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) fs.writeFileSync(file, '', { mode: 0o600 });
    fs.appendFileSync(file, `\n[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${kind}\n${clean(text).slice(0, 24000)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }

  async function connect() {
    if (pending) return pending;
    pending = (async () => {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(file)) append('SYSTEM', 'RED QUEEN / LIVE OPERATIONS\nActual tool activity and results. Read-only console; issue directives through Red Queen.');
      if (!connection) {
        try { connection = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
      }
      if (connection) {
        try {
          const process = await call(['block', 'call', '-s', connection.sessionId, '-b', connection.blockId, 'process']);
          if (!process || process.last_exit != null) connection = null;
        } catch { connection = null; }
      }
      if (!connection) {
        const node = config.resolveBin('node');
        if (!node) throw new Error('Node.js not found');
        const made = await call(['new', 'RED QUEEN / OPERATIONS', '-c', appRoot, '--window', 'Live Operations', '--keep-open', '--shell=none', '--json', '--', node, path.join(appRoot, 'scripts/rex-console.cjs'), file]);
        connection = { sessionId: made.session_id, blockId: made.initial_windows[0].block_ids[0] };
        fs.writeFileSync(stateFile, JSON.stringify(connection), { mode: 0o600 });
      }
      return connection;
    })();
    try { return await pending; } finally { pending = null; }
  }

  async function open() {
    const c = await connect();
    const { clients = [] } = await call(['client', 'ls', '--json']) || {};
    const apps = clients.filter(x => x.info?.kind === 'app' && x.connection_state === 'connected');
    const local = apps.filter(x => x.info?.platform === 'macos' && x.principal?.transport === 'unix');
    const targets = local.length ? local : apps;
    if (targets.length === 1) {
      try {
        await call(['-C', targets[0].client_id, 'do', 'session.select', `session_id=${c.sessionId}`]);
        return { ...c, visible: true };
      } catch (e) {
        return { ...c, visible: false, reason: /Remote Control|not accepting actions/i.test(e.message) ? 'Linked. Select RED QUEEN / OPERATIONS in Rex.' : 'Linked. Open the Rex operations session manually.' };
      }
    }
    return { ...c, visible: false, reason: targets.length ? 'Multiple Rex clients. Select the operations session manually.' : 'Open Rex to view live operations.' };
  }

  return { append, connect, open, file };
}

module.exports = { createRexConsole, clean };
