// 执行器冒烟测试：codex 真跑一轮 + resume 续一轮
process.env.NODE_ENV = 'test';
const config = require('../main/config');
const executor = require('../main/executor');
const path = require('path');
const os = require('os');

(async () => {
  const cfg = config.load();
  cfg.executor = 'codex';
  console.log('[1] 新会话...');
  const t0 = Date.now();
  const r1 = await executor.runTurn({
    text: '用一句话回答：你是谁？',
    sessionId: null,
    history: [],
    cfg,
    appRoot: path.join(__dirname, '..'),
    workDir: os.homedir(),
    onOutline: (l) => console.log('  outline:', l),
  });
  console.log(`  回复(${Math.round((Date.now() - t0) / 1000)}s):`, r1.reply);
  console.log('  sessionId:', r1.sessionId);

  if (!r1.sessionId) return console.log('无 sessionId，跳过 resume 测试');

  console.log('[2] resume 续聊...');
  const t1 = Date.now();
  const r2 = await executor.runTurn({
    text: '我上一句问你什么？',
    sessionId: r1.sessionId,
    history: [],
    cfg,
    appRoot: path.join(__dirname, '..'),
    workDir: os.homedir(),
    onOutline: (l) => console.log('  outline:', l),
  });
  console.log(`  回复(${Math.round((Date.now() - t1) / 1000)}s):`, r2.reply);
  console.log(r2.reply ? '✓ 执行器测试通过' : '✗ resume 无回复');
  process.exit(0);
})().catch((e) => {
  console.error('✗ 测试失败:', e.message);
  process.exit(1);
});
