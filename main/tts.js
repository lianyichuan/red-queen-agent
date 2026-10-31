'use strict';

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { resolveVoiceSettings } = require('./voice-settings');

const APP_ROOT = path.join(__dirname, '..');
const VENV_DIR = path.join(APP_ROOT, '.venv');
const EDGE_BIN = path.join(VENV_DIR, 'bin', 'edge-tts');
const TMP_DIR = path.join(APP_ROOT, 'tmp');

let ensuring = null;

/** 首次使用时自动创建 venv 并安装 edge-tts */
function ensureEdgeTts() {
  if (fs.existsSync(EDGE_BIN)) return Promise.resolve();
  if (!ensuring) {
    ensuring = new Promise((resolve, reject) => {
      const py = spawnSync('python3', ['-m', 'venv', VENV_DIR], { encoding: 'utf8' });
      if (py.status !== 0) return reject(new Error(`Python environment creation failed: ${py.stderr}`));
      const pip = spawnSync(path.join(VENV_DIR, 'bin', 'pip'), ['install', '-q', 'edge-tts'], {
        encoding: 'utf8',
      });
      if (pip.status !== 0) return reject(new Error(`Voice engine installation failed: ${pip.stderr}`));
      resolve();
    }).finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
}

/**
 * 合成语音。
 * @param {string} text 播报文本
 * @param {object} ttsCfg { voice, rate, pitch, redqueen }
 * @returns {Promise<{file: string}>}
 */
async function synth(text, ttsCfg) {
  await ensureEdgeTts();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const { voice, rate, pitch } = resolveVoiceSettings(ttsCfg);

  const file = path.join(TMP_DIR, `tts-${Date.now()}-${process.pid}.mp3`);
  const args = ['--voice', voice, '--rate=' + rate, '--pitch=' + pitch, '--text', text.slice(0, 1200), '--write-media', file];
  return new Promise((resolve, reject) => {
    const child = spawn(EDGE_BIN, args, { env: config.envForSpawn(), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      reject(new Error('Speech synthesis timed out'));
    }, 30000);
    timer.unref();
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(file) && fs.statSync(file).size > 200) return resolve({ file });
      reject(new Error(`Speech synthesis failed: ${err.trim().slice(-300) || 'exit ' + code}`));
    });
  });
}

/** 清理旧的合成文件 */
function cleanup() {
  try {
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (f.startsWith('tts-')) {
        const p = path.join(TMP_DIR, f);
        if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.unlinkSync(p);
      }
    }
  } catch {}
}

module.exports = { synth, cleanup, ensureEdgeTts, EDGE_BIN, TMP_DIR, APP_ROOT, os };
