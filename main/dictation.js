'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_FILE = path.join(os.homedir(), 'Library/Application Support/com.bageshuo/bageshuo-store.json');

// Extract only committed dictation records from this local store. Account tokens
// never leave the reader; audio, clipboard and archived account history are unused.
function createDictationReader({ file = DEFAULT_FILE, onTranscript = () => {}, onStatus = () => {}, intervalMs = 600 } = {}) {
  let enabled = false, ready = false, reason = 'CHECKING SPEECH RECOGNITION', timer, pollPromise;
  let armedAt = 0, armEpoch = 0;
  let signature = '', account = null, initialized = false;
  const seen = new Set();
  const status = () => ({ enabled, ready, reason, source: 'Speech recognition' });
  const publish = () => onStatus(status());
  async function readStore() {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 8 * 1024 * 1024) throw new Error('oversize');
      const nextSignature = `${stat.mtimeMs}:${stat.size}`;
      if (nextSignature === signature && ready) return;
      const store = JSON.parse(await fs.readFile(file, 'utf8'));
      const currentAccount = String(store.login?.userId || store.login?.account || 'guest');
      if (!Array.isArray(store.history)) throw new Error('schema');
      const baseline = !initialized || currentAccount !== account;
      if (baseline) seen.clear();
      account = currentAccount;
      const rows = [...store.history].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const wasReady = ready;
      ready = store.settings?.keepHistory !== false;
      reason = ready ? 'SPEECH RECOGNITION / LINKED' : 'Enable history in your speech recognition service';
      for (const row of rows) {
        const key = row.utteranceId || row.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (baseline || !enabled || !ready || row.mode !== 'dictate') continue;
        // Ignore old history imported/synchronized after arming. createdAt may
        // represent recording start, so account for the utterance duration.
        const created = Date.parse(row.createdAt);
        const end = created + Math.max(0, Number(row.durationMs) || 0);
        if (!Number.isFinite(created) || end < armedAt - 2000 || created > Date.now() + 60000) continue;
        if (typeof row.result !== 'string' || !row.result.trim()) continue;
        onTranscript({ id: key, text: row.result.trim(), createdAt: row.createdAt });
      }
      initialized = true;
      signature = nextSignature;
      if (wasReady !== ready || baseline) publish();
    } catch (error) {
      const nextReason = error.code === 'ENOENT' ? 'Speech recognition history unavailable' : 'Awaiting speech recognition transcript';
      if (reason !== nextReason || ready) { ready = false; reason = nextReason; publish(); }
      // Do not advance the signature on partial JSON / atomic file replacement.
    }
  }
  function poll() {
    if (!pollPromise) pollPromise = readStore().finally(() => { pollPromise = null; });
    return pollPromise;
  }
  return {
    status,
    poll,
    async setEnabled(value) {
      // Establish a fresh baseline before arming; never replay paused dictation.
      enabled = false;
      const epoch = ++armEpoch;
      await poll();
      if (epoch !== armEpoch) return status();
      enabled = Boolean(value);
      armedAt = Date.now();
      publish();
      return status();
    },
    async start() { await poll(); timer = setInterval(poll, intervalMs); timer.unref?.(); return status(); },
    stop() { clearInterval(timer); enabled = false; },
  };
}
module.exports = { createDictationReader, DEFAULT_FILE };
