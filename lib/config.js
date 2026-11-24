'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Image shipped with the plugin: the same feed for every user unless imagePath overrides it.
const DEFAULT_IMAGE = path.join(__dirname, '..', 'assets', 'feed.jpg');
const DEFAULT_NAME = 'Fake Camera';
const DEFAULT_FFMPEG = 'ffmpeg';
const DEFAULT_SERIAL = 'FHKSV-0001';

/**
 * Validates the plugin config. Never throws: returns `{ error }` when the plugin must not publish.
 * `fsImpl` is injectable for tests.
 */
function parseConfig(config, fsImpl = fs) {
  const cfg = config ?? {};
  const custom = typeof cfg.imagePath === 'string' ? cfg.imagePath.trim() : '';
  const imagePath = custom || DEFAULT_IMAGE;
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

module.exports = { parseConfig, DEFAULT_IMAGE, DEFAULT_NAME, DEFAULT_FFMPEG, DEFAULT_SERIAL };
