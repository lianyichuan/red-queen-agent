'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), '.javis');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CODEX_DIR = path.join(os.homedir(), '.codex');

const { normalizeAppearance } = require('./appearance');

const DEFAULTS = {
  appearance: normalizeAppearance(),
  executor: 'codex', // 'codex' | 'claude'
  codex: {
    model: '', // 空 = 跟随 ~/.codex/config.toml（即 cc-switch 当前选择）
    effort: 'low', // low | medium | high
    // danger-full-access 是默认：Red Queen 的核心价值就是操作这台电脑，
    // workspace-write 沙箱会拦截开应用/Apple Events（实测 ls /Applications 都会被中止）
    sandbox: 'danger-full-access',
    timeoutMs: 180000,
  },
  claude: {
    model: '',
    permissionMode: 'acceptEdits',
    timeoutMs: 180000,
  },
  tts: {
    engine: 'edge-tts',
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+15%',
    pitch: '+0Hz',
    redqueen: true, // 冷感音调；保留用户所选音色与语速
  },
  autoSendDelayMs: 1200,
  maxHistoryFallback: 12,
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    /* 首次运行无配置 */
  }
  const merged = deepMerge(DEFAULTS, stored);
  merged.appearance = normalizeAppearance(merged.appearance);
  return merged;
}

function save(patch) {
  const merged = deepMerge(load(), patch || {});
  merged.appearance = normalizeAppearance(merged.appearance);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

/** 解析可执行文件路径：PATH → 常见目录，找不到返回 null */
function resolveBin(name) {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  try {
    const p = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* which 未命中 */
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * GUI 启动（Dock/双击）时 PATH 只有系统最小集，node/codex 等会找不到。
 * 这里强制补全常见目录，所有子进程统一用它。
 */
function envForSpawn() {
  const nodeBin = resolveBin('node');
  const extra = [
    nodeBin ? path.dirname(nodeBin) : null,
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.local', 'node', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean);
  const PATH = [...new Set([...extra, process.env.PATH || ''])].join(':');
  return { ...process.env, PATH };
}

/** 读取 ~/.codex/config.toml 的关键信息（轻量正则，仅供设置界面展示） */
function codexInfo() {
  const info = { model: '', baseUrl: '', effort: '', catalogModels: [] };
  try {
    const toml = fs.readFileSync(path.join(CODEX_DIR, 'config.toml'), 'utf8');
    info.model = (toml.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || '';
    info.baseUrl = (toml.match(/^base_url\s*=\s*"([^"]+)"/m) || [])[1] || '';
    info.effort = (toml.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || '';
    const catalogFile = (toml.match(/^model_catalog_json\s*=\s*"([^"]+)"/m) || [])[1];
    if (catalogFile) {
      const catalog = JSON.parse(fs.readFileSync(path.join(CODEX_DIR, catalogFile), 'utf8'));
      info.catalogModels = (catalog.models || []).map((m) => m.slug).filter(Boolean);
    }
  } catch {
    /* 配置缺失时静默 */
  }
  return info;
}

function environment() {
  return {
    configPath: CONFIG_FILE,
    codexBin: resolveBin('codex'),
    claudeBin: resolveBin('claude'),
    codexInfo: codexInfo(),
  };
}

module.exports = { load, save, environment, resolveBin, envForSpawn, codexInfo, CONFIG_FILE };
