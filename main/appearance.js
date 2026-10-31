'use strict';
function normalizeAppearance(value = {}) {
  return {
    theme: value?.theme === 'day' ? 'day' : 'night',
    opacity: Number.isFinite(value?.opacity) ? Math.max(.3, Math.min(1, value.opacity)) : .94,
    nativeIsland: value?.nativeIsland !== false,
  };
}
module.exports = { normalizeAppearance };
