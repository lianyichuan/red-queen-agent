'use strict';
// Tone changes must not silently replace the operator's voice or speed.
function resolveVoiceSettings(cfg = {}) {
  const match = typeof cfg.rate === 'string' && cfg.rate.match(/^([+-]?\d+)%$/);
  const speed = match ? Math.max(-50, Math.min(100, Number(match[1]))) : 15;
  const validPitch = typeof cfg.pitch === 'string' && /^[+-]?\d+Hz$/.test(cfg.pitch);
  let pitch = validPitch ? cfg.pitch : '+0Hz';
  if (cfg.redqueen && (!validPitch || Number.parseInt(pitch, 10) === 0)) pitch = '-6Hz';
  return {
    voice: typeof cfg.voice === 'string' && cfg.voice.trim() ? cfg.voice.trim() : 'zh-CN-XiaoyiNeural',
    rate: `${speed >= 0 ? '+' : ''}${speed}%`,
    pitch,
  };
}
module.exports = { resolveVoiceSettings };
