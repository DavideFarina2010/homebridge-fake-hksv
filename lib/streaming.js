'use strict';

const dgram = require('node:dgram');
const { spawn: nodeSpawn } = require('node:child_process');
const { snapshotArgs, streamArgs } = require('./ffmpeg');

const SNAPSHOT_TIMEOUT_MS = 10000;

// Asks the OS for a free UDP port (used as local RTCP port).
function freeUdpPort(ipVersion) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(ipVersion === 'ipv6' ? 'udp6' : 'udp4');
    socket.once('error', reject);
    socket.bind(0, () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

/** Live view and snapshots: the static image is looped by ffmpeg and sent over SRTP. */
class StreamingDelegate {
  constructor({ hap, log, imagePath, ffmpegPath, spawn = nodeSpawn, getPort = freeUdpPort }) {
    this.hap = hap;
    this.log = log;
    this.imagePath = imagePath;
    this.ffmpegPath = ffmpegPath;
    this.spawn = spawn;
    this.getPort = getPort;
    this.pending = new Map();
    this.sessions = new Map();
    this.controller = undefined; // set by the platform after the CameraController is created
  }

  handleSnapshotRequest(request, callback) {
    const args = snapshotArgs({ image: this.imagePath, width: request.width, height: request.height });
    const proc = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let done = false;
    const finish = (err, buffer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback(err, buffer);
    };
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish(new Error('Snapshot timed out'));
    }, SNAPSHOT_TIMEOUT_MS);
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => this.log.debug(`ffmpeg snapshot: ${chunk.toString().trim()}`));
    proc.on('error', (err) => {
      this.log.error(`Cannot run ffmpeg ("${this.ffmpegPath}"): ${err.message}`);
      finish(err);
    });
    proc.on('close', (code) => {
      const buffer = Buffer.concat(chunks);
      if (code === 0 && buffer.length > 0) finish(undefined, buffer);
      else finish(new Error(`ffmpeg snapshot failed (exit code ${code})`));
    });
  }

  async prepareStream(request, callback) {
    try {
      const ssrc = this.hap.CameraController.generateSynchronisationSource();
      const localRtcpPort = await this.getPort(request.addressVersion);
      this.pending.set(request.sessionID, {
        address: request.targetAddress,
        ipVersion: request.addressVersion,
        port: request.video.port,
        srtpKey: request.video.srtp_key,
        srtpSalt: request.video.srtp_salt,
        ssrc,
        localRtcpPort,
      });
      callback(undefined, {
        video: {
          port: localRtcpPort,
          ssrc,
          srtp_key: request.video.srtp_key,
          srtp_salt: request.video.srtp_salt,
        },
      });
    } catch (err) {
      this.log.error(`Cannot prepare stream: ${err.message}`);
      callback(err);
    }
  }

  handleStreamRequest(request, callback) {
    const { StreamRequestTypes } = this.hap;
    switch (request.type) {
      case StreamRequestTypes.START:
        this.#start(request, callback);
        break;
      case StreamRequestTypes.STOP:
        this.stopSession(request.sessionID);
        callback();
        break;
      default:
        // RECONFIGURE: the image is static, the running stream is good as it is.
        callback();
    }
  }

  #start(request, callback) {
    const info = this.pending.get(request.sessionID);
    if (!info) {
      callback(new Error('Unknown stream session'));
      return;
    }
    this.pending.delete(request.sessionID);
    const { video } = request;
    const args = streamArgs({
      image: this.imagePath,
      width: video.width,
      height: video.height,
      fps: video.fps,
      bitrate: video.max_bit_rate,
      profile: video.profile,
      level: video.level,
      payloadType: video.pt,
      ssrc: info.ssrc,
      mtu: video.mtu,
      address: info.address,
      ipVersion: info.ipVersion,
      port: info.port,
      localRtcpPort: info.localRtcpPort,
      srtpKey: info.srtpKey,
      srtpSalt: info.srtpSalt,
    });
    this.log.info(`Live view started (${video.width}x${video.height}@${video.fps})`);
    const proc = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.sessions.set(request.sessionID, proc);
    proc.stderr.on('data', (chunk) => this.log.debug(`ffmpeg stream: ${chunk.toString().trim()}`));
    proc.on('error', (err) => {
      this.log.error(`Cannot run ffmpeg ("${this.ffmpegPath}"): ${err.message}`);
      this.#ended(request.sessionID, proc);
    });
    proc.on('close', (code, signal) => {
      if (this.sessions.get(request.sessionID) === proc && !signal) {
        this.log.warn(`ffmpeg stream exited unexpectedly (code ${code})`);
      }
      this.#ended(request.sessionID, proc);
    });
    callback();
  }

  #ended(sessionID, proc) {
    if (this.sessions.get(sessionID) !== proc) return;
    this.sessions.delete(sessionID);
    this.controller?.forceStopStreamingSession(sessionID);
  }

  stopSession(sessionID) {
    this.pending.delete(sessionID);
    const proc = this.sessions.get(sessionID);
    if (proc) {
      this.sessions.delete(sessionID);
      proc.kill('SIGKILL');
      this.log.info('Live view stopped');
    }
  }

  shutdown() {
    for (const id of [...this.sessions.keys()]) this.stopSession(id);
  }
}

module.exports = { StreamingDelegate, freeUdpPort };
