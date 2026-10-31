'use strict';

// 本地验证提示词装配与 skill 缺失回退；不调用付费模型或 TTS。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { personaText } = require('../main/executor');

const root = path.join(__dirname, '..');
const prompt = personaText(root);
assert.ok(prompt.includes('[SAY]') && prompt.includes('[MORE]'), '保留语音分区协议');
const skill = fs.readFileSync(path.join(root, 'prompt/skills/redqueen/SKILL.md'), 'utf8');
const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
assert.ok(prompt.endsWith(body), '完整注入项目人设');
assert.ok(!prompt.includes('description:'), '不把 skill 元数据发送给模型');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'javis-persona-test-'));
try {
  fs.mkdirSync(path.join(tmp, 'prompt'));
  fs.writeFileSync(path.join(tmp, 'prompt/persona.md'), '基础协议 [SAY]');
  assert.equal(personaText(tmp), '基础协议 [SAY]', 'skill 缺失不破坏基础提示');
  assert.ok(personaText(path.join(tmp, 'missing')).includes('Red Queen'), '完整缺失仍能回退');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('✓ persona：协议、人设装配、元数据剥离及缺失回退通过');
