// TTS 冒烟测试：自动建 venv → 装 edge-tts → 合成一段话
const fs = require('fs');
const tts = require('../main/tts');
const config = require('../main/config');

(async () => {
  const cfg = config.load();
  console.log('合成中（首次运行会自动安装 edge-tts，请稍候）…');
  const { file } = await tts.synth('贾维斯系统上线，随时听候差遣。', cfg.tts);
  const size = fs.statSync(file).size;
  console.log('输出:', file, `${(size / 1024).toFixed(1)} KB`);
  if (size > 2000) console.log('✓ TTS 测试通过');
  else throw new Error('文件过小');
  process.exit(0);
})().catch((e) => {
  console.error('✗ TTS 测试失败:', e.message);
  process.exit(1);
});
