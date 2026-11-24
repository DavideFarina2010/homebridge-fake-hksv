'use strict';

const fs = require('node:fs');

const DEFAULT_NAME = 'Fake Camera';
const DEFAULT_FFMPEG = 'ffmpeg';
const DEFAULT_SERIAL = 'FHKSV-0001';

/**
 * Validates the plugin config. Never throws: returns `{ error }` when the plugin must not publish.
 * `fsImpl` is injectable for tests.
 */
function parseConfig(config, fsImpl = fs) {
  const cfg = config ?? {};
  const imagePath = typeof cfg.imagePath === 'string' ? cfg.imagePath.trim() : '';
  if (!imagePath) {
    return { error: 'imagePath is not set: configure the path of the static image to show.' };
  }
  let stat;
  try {
    stat = fsImpl.statSync(imagePath);
  } catch (err) {
    return { error: `imagePath "${imagePath}" cannot be read (${err.code ?? err.message}).` };
  }
  if (!stat.isFile()) {
    return { error: `imagePath "${imagePath}" is not a file.` };
  }
  const str = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
  return {
    name: str(cfg.name, DEFAULT_NAME),
    imagePath,
    ffmpegPath: str(cfg.ffmpegPath, DEFAULT_FFMPEG),
    serialNumber: str(cfg.serialNumber, DEFAULT_SERIAL),
  };
}

module.exports = { parseConfig, DEFAULT_NAME, DEFAULT_FFMPEG, DEFAULT_SERIAL };
