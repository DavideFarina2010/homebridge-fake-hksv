'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const { recordingArgs, SAMPLE_RATES_HZ } = require('./ffmpeg');
const { Mp4PacketSplitter } = require('./mp4');

/**
 * HKSV recording delegate. There is no motion trigger and no prebuffer: the hub only asks for a clip
 * if it decides to record, and the clip is the static image encoded on the fly.
 */
class RecordingDelegate {
  constructor({ log, imagePath, ffmpegPath, isAudioActive = () => false, spawn = nodeSpawn }) {
    this.log = log;
    this.imagePath = imagePath;
    this.ffmpegPath = ffmpegPath;
    this.isAudioActive = isAudioActive;
    this.spawn = spawn;
    this.configuration = undefined;
    this.active = false;
    this.streams = new Map();
  }

  updateRecordingActive(active) {
    this.active = active;
    this.log.info(`HomeKit Secure Video recording ${active ? 'enabled' : 'disabled'}`);
  }

  updateRecordingConfiguration(configuration) {
    this.configuration = configuration;
  }

  buildArgs() {
    const { videoCodec, audioCodec, mediaContainerConfiguration } = this.configuration;
    const [width, height, fps] = videoCodec.resolution;
    const audio = this.isAudioActive()
      ? {
          sampleRate: SAMPLE_RATES_HZ[audioCodec.samplerate] ?? 32000,
          channels: audioCodec.audioChannels ?? 1,
          bitrate: audioCodec.bitrate || 32, // kbps
        }
      : undefined;
    return recordingArgs({
      image: this.imagePath,
      width,
      height,
      fps,
      bitrate: videoCodec.parameters.bitRate,
      profile: videoCodec.parameters.profile,
      level: videoCodec.parameters.level,
      iFrameIntervalMs: videoCodec.parameters.iFrameInterval || mediaContainerConfiguration.fragmentLength,
      audio,
    });
  }

  async *handleRecordingStreamRequest(streamId, signal) {
    if (!this.configuration) throw new Error('No recording configuration selected');
    const proc = this.spawn(this.ffmpegPath, this.buildArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
    this.streams.set(streamId, proc);
    proc.stderr.on('data', (chunk) => this.log.debug(`ffmpeg recording: ${chunk.toString().trim()}`));
    proc.on('error', (err) => {
      this.log.error(`Cannot run ffmpeg ("${this.ffmpegPath}"): ${err.message}`);
      proc.stdout.destroy();
    });
    const onAbort = () => proc.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    const splitter = new Mp4PacketSplitter();
    try {
      for await (const chunk of proc.stdout) {
        for (const data of splitter.push(chunk)) yield { data, isLast: false };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      proc.kill('SIGKILL');
      this.streams.delete(streamId);
    }
  }

  closeRecordingStream(streamId) {
    this.streams.get(streamId)?.kill('SIGKILL');
    this.streams.delete(streamId);
  }

  shutdown() {
    for (const id of [...this.streams.keys()]) this.closeRecordingStream(id);
  }
}

module.exports = { RecordingDelegate };
