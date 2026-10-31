'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const OUTLINE_MAP = {
  // codex item 类型
  command_execution: 'EXECUTING COMMAND…',
  file_change: 'UPDATING FILES…',
  web_search: 'SEARCHING NETWORK…',
  todo_list: 'PLANNING OPERATION…',
  // claude 工具名
  Bash: 'EXECUTING COMMAND…',
  Read: 'READING FILES…',
  Write: 'UPDATING FILES…',
  Edit: 'UPDATING FILES…',
  Grep: 'SCANNING CONTENT…',
  Glob: 'LOCATING FILES…',
  WebSearch: 'SEARCHING NETWORK…',
  WebFetch: 'RETRIEVING SOURCE…',
  Task: 'DISPATCHING TASK…',
  TodoWrite: 'PLANNING OPERATION…',
};

function outlineFor(name) {
  if (!name) return null;
  if (OUTLINE_MAP[name]) return OUTLINE_MAP[name];
  if (name.startsWith('mcp__outlook')) return 'REVIEWING SCHEDULE AND MESSAGES…';
  if (name.startsWith('mcp__')) return 'ACCESSING TOOL…';
  if (/calendar|event/i.test(name)) return 'REVIEWING SCHEDULE…';
  if (/mail|email/i.test(name)) return 'REVIEWING MESSAGES…';
  return `RUNNING ${name}…`;
}

function personaText(appRoot) {
  let persona;
  try {
    persona = fs.readFileSync(path.join(appRoot, 'prompt', 'persona.md'), 'utf8').trim();
  } catch {
    persona = 'You are Red Queen, a concise and reliable personal assistant. Respond in Simplified Chinese with verified conclusions in one or two sentences, using [SAY] and optional [MORE] sections.';
  }
  // 项目专用人设：直接注入每轮请求，Codex / Claude 和 resume 均会收到。
  // 不依赖 CLI 的全局 skill 自动发现，避免改变其他项目的助手风格。
  try {
    const skill = fs.readFileSync(path.join(appRoot, 'prompt', 'skills', 'redqueen', 'SKILL.md'), 'utf8');
    const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
    if (body) persona += '\n\n' + body;
  } catch {
    // 人设扩展缺失时仍保留基础输出协议与操作约定。
  }
  return persona;
}

/** 把历史压成备用上下文（resume 失败时用） */
function historyBlock(history, maxTurns) {
  const recent = (history || []).slice(-maxTurns);
  if (!recent.length) return '';
  return (
    '\n\n# Conversation history\n' +
    recent.map((t) => `User: ${t.user}\nRed Queen: ${t.assistant}`).join('\n') +
    '\n'
  );
}

/**
 * 跑一轮对话。
 * opts: { text, sessionId, history, cfg, appRoot, workDir, onOutline, onChild }
 * 返回 { reply, sessionId }
 */
function runTurn(opts) {
  const { cfg } = opts;
  return cfg.executor === 'claude' ? runClaude(opts) : runCodex(opts);
}

function buildPrompt(opts, { withHistory }) {
  const head = personaText(opts.appRoot);
  const hist = withHistory ? historyBlock(opts.history, opts.cfg.maxHistoryFallback || 12) : '';
  const runtime = opts.runtimeContext ? `\n\n# Runtime context\n${opts.runtimeContext}` : '';
  return `${head}${hist}${runtime}\n\n# User directive\n${opts.text}`;
}

// Only surface observable work, not reasoning events or internal prompts.
function activityFor(ev) {
  const it = ev.item;
  if (!it || !['item.started', 'item.updated', 'item.completed'].includes(ev.type)) return null;
  const done = ev.type === 'item.completed';
  if (it.type === 'command_execution') {
    return { kind: done ? 'COMMAND RESULT' : 'COMMAND DISPATCH', text: done ? `${it.command || ''}\nexit=${it.exit_code ?? '?'}\n${it.aggregated_output || ''}` : it.command || '' };
  }
  if (it.type === 'file_change' && done) return { kind: 'FILE UPDATE', text: JSON.stringify(it.changes || []) };
  if (it.type === 'web_search') return { kind: done ? 'SEARCH COMPLETE' : 'NETWORK SEARCH', text: it.query || JSON.stringify(it.action || {}) };
  if (it.type === 'mcp_tool_call' || it.type === 'tool_call') {
    return { kind: done ? 'TOOL RESULT' : 'TOOL DISPATCH', text: `${it.server || ''}/${it.tool || it.name || ''}\n${JSON.stringify(done ? (it.result || it.error || it.output || {}) : (it.arguments || {}))}` };
  }
  return null;
}

function killAfter(child, ms, reject, tag) {
  const t = setTimeout(() => {
    try {
      child.kill('SIGTERM');
    } catch {}
    reject(new Error(`${tag} timed out (${Math.round(ms / 1000)}s)`));
  }, ms);
  t.unref();
  return t;
}

function missingSession(message) {
  return /(?:session|thread|conversation).{0,60}(?:not found|does not exist|unknown)|no rollout found|unable to resume|could not (?:find|load).{0,30}(?:session|thread)/i.test(message);
}

/* ---------------- codex exec ---------------- */

function runCodex(opts) {
  return new Promise((resolve, reject) => {
    const bin = config.resolveBin('codex');
    if (!bin) return reject(new Error('Codex executable not found'));

    const c = opts.cfg.codex || {};
    const resume = opts.sessionId ? ['resume', opts.sessionId] : [];
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', opts.workDir, '-s', c.sandbox || 'workspace-write'];
    if ((c.sandbox || 'workspace-write') === 'workspace-write') {
      // workspace-write 沙箱默认断网，开网络让她能查资料
      args.push('-c', 'sandbox_workspace_write.network_access=true');
    }
    if (c.model) args.push('-m', c.model);
    if (c.effort && c.effort !== 'default') args.push('-c', `model_reasoning_effort="${c.effort}"`);
    args.push(...resume, buildPrompt(opts, { withHistory: !opts.sessionId }));

    const child = spawn(bin, args, { cwd: opts.workDir, env: config.envForSpawn(), stdio: ['ignore', 'pipe', 'pipe'] });
    if (opts.onChild) opts.onChild(child);

    let out = '';
    let stderr = '';
    let reply = '';
    let threadId = opts.sessionId || null;
    let lastLabel = '';
    const outline = (label) => {
      if (label && label !== lastLabel) {
        lastLabel = label;
        opts.onOutline && opts.onOutline(label);
      }
    };

    let failed = false;
    const timer = killAfter(child, c.timeoutMs || 180000, (error) => { failed = true; reject(error); }, 'codex');

    child.stdout.on('data', (d) => {
      out += d.toString();
      let idx;
      while ((idx = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, idx).trim();
        out = out.slice(idx + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const activity = activityFor(ev);
        if (activity) opts.onActivity?.(activity);
        if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
        if (ev.type === 'item.started' && ev.item && ev.item.type === 'command_execution') outline('EXECUTING COMMAND…');
        if (ev.type === 'item.completed' && ev.item) {
          const it = ev.item;
          if (it.type === 'agent_message' && it.text) reply = it.text;
          else if (it.type === 'error') {
            // codex 的配置警告等 error 事件：真失败由 turn.failed/退出码兜底，这里不进 outline
          } else outline(outlineFor(it.type));
        }
        if (ev.type === 'turn.failed') {
          failed = true;
          const msg = (ev.error && ev.error.message) || 'Codex execution failed';
          clearTimeout(timer);
          child.kill('SIGTERM');
          return reject(new Error(msg));
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on('error', (e) => {
      failed = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (child.signalCode) return reject(new Error(`Codex terminated (${child.signalCode})`));
      if (code !== 0 && reply) return reject(new Error(stderr.trim().slice(-400) || `Codex exited with code ${code}`));
      if (reply) return resolve({ reply, sessionId: threadId });
      if (code === 0) return resolve({ reply: '', sessionId: threadId });
      // Only retry a missing conversation. A failed task may already have
      // changed the machine, so generic failures must never replay it.
      if (opts.sessionId && missingSession(stderr)) {
        opts.onOutline && opts.onOutline('RESTORING SESSION…');
        return resolve(runCodex({ ...opts, sessionId: null }));
      }
      reject(new Error(stderr.trim().slice(-400) || `Codex exited with code ${code}`));
    });
  });
}

/* ---------------- claude -p ---------------- */

function runClaude(opts) {
  return new Promise((resolve, reject) => {
    const bin = config.resolveBin('claude');
    if (!bin) return reject(new Error('Claude executable not found'));

    const c = opts.cfg.claude || {};
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', c.permissionMode || 'acceptEdits'];
    if (c.model) args.push('--model', c.model);
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    args.push(buildPrompt(opts, { withHistory: !opts.sessionId }));

    const child = spawn(bin, args, { cwd: opts.workDir, env: config.envForSpawn(), stdio: ['ignore', 'pipe', 'pipe'] });
    if (opts.onChild) opts.onChild(child);

    let out = '';
    let stderr = '';
    let reply = '';
    let sessionId = opts.sessionId || null;
    let lastLabel = '';
    const outline = (label) => {
      if (label && label !== lastLabel) {
        lastLabel = label;
        opts.onOutline && opts.onOutline(label);
      }
    };

    let failed = false;
    const timer = killAfter(child, c.timeoutMs || 180000, (error) => { failed = true; reject(error); }, 'claude');

    child.stdout.on('data', (d) => {
      out += d.toString();
      let idx;
      while ((idx = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, idx).trim();
        out = out.slice(idx + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) sessionId = ev.session_id;
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const block of ev.message.content) {
            if (block.type === 'tool_use') {
              outline(outlineFor(block.name));
              opts.onActivity?.({ kind: 'TOOL DISPATCH', text: `${block.name}\n${JSON.stringify(block.input || {})}` });
            }
            if (block.type === 'text' && block.text) reply = block.text;
          }
        }
        if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
          for (const block of ev.message.content) {
            if (block.type === 'tool_result') opts.onActivity?.({ kind: 'TOOL RESULT', text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '') });
          }
        }
        if (ev.type === 'result') {
          failed = true; // The result event settles this attempt; close must not retry it.
          clearTimeout(timer);
          if (ev.is_error) return reject(new Error(ev.result || 'Claude execution failed'));
          reply = ev.result || reply;
          return resolve({ reply, sessionId: ev.session_id || sessionId });
        }
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on('error', (e) => {
      failed = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (child.signalCode) return reject(new Error(`Claude terminated (${child.signalCode})`));
      if (code === 0 && reply) return resolve({ reply, sessionId });
      if (opts.sessionId && missingSession(stderr)) {
        opts.onOutline && opts.onOutline('RESTORING SESSION…');
        return resolve(runClaude({ ...opts, sessionId: null }));
      }
      reject(new Error(stderr.trim().slice(-400) || `Claude exited with code ${code}`));
    });
  });
}

module.exports = { runTurn, outlineFor, personaText, activityFor };
