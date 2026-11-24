'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const hap = require('@homebridge/hap-nodejs');

const fs = require('node:fs');
const { parseConfig, DEFAULT_IMAGE } = require('../lib/config');
const { snapshotArgs, streamArgs, recordingArgs } = require('../lib/ffmpeg');
const { Mp4PacketSplitter } = require('../lib/mp4');
const { buildControllerOptions } = require('../lib/camera');
const { StreamingDelegate } = require('../lib/streaming');
const { RecordingDelegate } = require('../lib/recording');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const log = { debug() {}, info() {}, warn() {}, error() {} };

function box(type, size) {
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0);
  b.write(type, 4, 'latin1');
  return b;
}

function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.killed = false;
  proc.kill = (sig) => {
    proc.killed = sig;
    proc.stdout.end();
    proc.emit('close', null, sig);
  };
  return proc;
}

const okFs = { statSync: () => ({ isFile: () => true }) };

test('plugin entry registers the platform', () => {
  let registered;
  require('../index.js')({ registerPlatform: (...a) => (registered = a) });
  assert.strictEqual(registered[0], 'FakeHKSV');
});

test('bundled default image exists and is a JPEG', () => {
  const head = fs.readFileSync(DEFAULT_IMAGE).subarray(0, 3);
  assert.deepStrictEqual([...head], [0xff, 0xd8, 0xff]);
  assert.strictEqual(parseConfig({}).imagePath, DEFAULT_IMAGE);
  assert.strictEqual(parseConfig(undefined).imagePath, DEFAULT_IMAGE);
});

test('parseConfig: unreadable and non-file image paths give an error', () => {
  const missing = { statSync: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } };
  assert.match(parseConfig({ imagePath: '/nope.jpg' }, missing).error, /ENOENT/);
  assert.match(parseConfig({ imagePath: '/dir' }, { statSync: () => ({ isFile: () => false }) }).error, /not a file/);
});

test('parseConfig: applies defaults', () => {
  const c = parseConfig({ imagePath: ' /a.jpg ', name: '  ', ffmpegPath: '/opt/ffmpeg' }, okFs);
  assert.deepStrictEqual(c, { name: 'Fake Camera', imagePath: '/a.jpg', ffmpegPath: '/opt/ffmpeg', serialNumber: 'FHKSV-0001' });
  assert.strictEqual(parseConfig({ imagePath: '  ' }, okFs).imagePath, DEFAULT_IMAGE);
});

test('snapshotArgs outputs one jpeg frame on stdout', () => {
  const a = snapshotArgs({ image: '/a.jpg', width: 640, height: 360 });
  assert.ok(a.includes('pipe:1') && a.includes('mjpeg'));
  assert.strictEqual(a[a.indexOf('-i') + 1], '/a.jpg');
  assert.match(a[a.indexOf('-vf') + 1], /scale=640:360/);
});

test('streamArgs builds an SRTP target (ipv4 and ipv6)', () => {
  const base = {
    image: '/a.jpg', width: 1280, height: 720, fps: 30, bitrate: 299, profile: 1, level: 0,
    payloadType: 99, ssrc: 123, mtu: 1316, port: 5000, localRtcpPort: 6000,
    srtpKey: Buffer.alloc(16, 1), srtpSalt: Buffer.alloc(14, 2),
  };
  const v4 = streamArgs({ ...base, address: '192.168.1.5', ipVersion: 'ipv4' });
  assert.strictEqual(v4.at(-1), 'srtp://192.168.1.5:5000?rtcpport=5000&localrtcpport=6000&pkt_size=1316');
  assert.strictEqual(v4[v4.indexOf('-srtp_out_params') + 1], Buffer.concat([base.srtpKey, base.srtpSalt]).toString('base64'));
  assert.strictEqual(v4[v4.indexOf('-profile:v') + 1], 'main');
  assert.ok(v4.includes('-loop') && v4.includes('-an'));
  const v6 = streamArgs({ ...base, address: 'fe80::1', ipVersion: 'ipv6' });
  assert.ok(v6.at(-1).startsWith('srtp://[fe80::1]:5000?'));
});

test('recordingArgs: key frames follow the fragment length, audio only when requested', () => {
  const base = { image: '/a.jpg', width: 1280, height: 720, fps: 30, bitrate: 800, profile: 2, level: 2, iFrameIntervalMs: 4000 };
  const noAudio = recordingArgs(base);
  assert.strictEqual(noAudio[noAudio.indexOf('-g') + 1], '120');
  assert.ok(noAudio.includes('-an') && !noAudio.includes('aac'));
  assert.ok(noAudio.includes('frag_keyframe+empty_moov+default_base_moof'));
  const withAudio = recordingArgs({ ...base, audio: { sampleRate: 32000, channels: 1, bitrate: 32 } });
  assert.ok(withAudio.includes('aac') && withAudio.some((x) => x.startsWith('anullsrc=r=32000')));
  assert.ok(!withAudio.includes('-an'));
});

test('Mp4PacketSplitter: init segment first, then one packet per fragment, even with split chunks', () => {
  const stream = Buffer.concat([box('ftyp', 20), box('moov', 100), box('moof', 30), box('mdat', 500), box('moof', 30), box('mdat', 40)]);
  const splitter = new Mp4PacketSplitter();
  const out = [];
  for (let i = 0; i < stream.length; i += 7) out.push(...splitter.push(stream.subarray(i, i + 7)));
  assert.deepStrictEqual(out.map((p) => p.length), [120, 530, 70]);
});

test('Mp4PacketSplitter rejects corrupt boxes', () => {
  assert.throws(() => new Mp4PacketSplitter().push(Buffer.alloc(16)), /Invalid MP4 box/);
});

test('CameraController accepts the options and exposes HKSV services', () => {
  const streamingDelegate = new StreamingDelegate({ hap, log, imagePath: '/a.jpg', ffmpegPath: 'ffmpeg' });
  const recordingDelegate = new RecordingDelegate({ log, imagePath: '/a.jpg', ffmpegPath: 'ffmpeg' });
  const controller = new hap.CameraController(buildControllerOptions(hap, { streamingDelegate, recordingDelegate }));
  const accessory = new hap.Accessory('Cam', hap.uuid.generate('cam'));
  accessory.configureController(controller);
  const names = accessory.services.map((s) => s.UUID);
  for (const svc of ['CameraRecordingManagement', 'CameraOperatingMode', 'DataStreamTransportManagement', 'MotionSensor']) {
    assert.ok(names.includes(hap.Service[svc].UUID), `missing ${svc}`);
  }
});

test('snapshot: returns ffmpeg stdout, errors on failure', async () => {
  let proc;
  const delegate = new StreamingDelegate({ hap, log, imagePath: '/a.jpg', ffmpegPath: 'ff', spawn: () => (proc = fakeProc()) });
  const ok = new Promise((res) => delegate.handleSnapshotRequest({ width: 320, height: 180 }, (e, b) => res([e, b])));
  proc.stdout.write(Buffer.from('JPEG'));
  proc.emit('close', 0);
  const [e1, b1] = await ok;
  assert.strictEqual(e1, undefined);
  assert.strictEqual(b1.toString(), 'JPEG');
  const bad = new Promise((res) => delegate.handleSnapshotRequest({ width: 320, height: 180 }, (e) => res(e)));
  proc.emit('close', 1);
  assert.match((await bad).message, /failed/);
});

test('stream: prepare, start spawns ffmpeg, stop kills it', async () => {
  const spawned = [];
  const stopped = [];
  const delegate = new StreamingDelegate({
    hap, log, imagePath: '/a.jpg', ffmpegPath: 'ff',
    spawn: (cmd, args) => { const p = fakeProc(); spawned.push({ cmd, args, p }); return p; },
    getPort: async () => 6000,
  });
  delegate.controller = { forceStopStreamingSession: (id) => stopped.push(id) };
  const prepared = await new Promise((res, rej) => delegate.prepareStream({
    sessionID: 's1', targetAddress: '10.0.0.2', addressVersion: 'ipv4',
    video: { port: 5000, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) },
  }, (e, r) => (e ? rej(e) : res(r))));
  assert.strictEqual(prepared.video.port, 6000);
  await new Promise((res) => delegate.handleStreamRequest({
    sessionID: 's1', type: 'start',
    video: { width: 640, height: 360, fps: 30, max_bit_rate: 300, profile: 0, level: 0, pt: 99, mtu: 1316 },
  }, res));
  assert.strictEqual(spawned.length, 1);
  assert.ok(spawned[0].args.at(-1).startsWith('srtp://10.0.0.2:5000'));
  await new Promise((res) => delegate.handleStreamRequest({ sessionID: 's1', type: 'stop' }, res));
  assert.strictEqual(spawned[0].p.killed, 'SIGKILL');
  assert.deepStrictEqual(stopped, []); // a stop requested by HomeKit must not be echoed back
});

test('stream: ffmpeg dying on its own stops the HomeKit session', async () => {
  let proc;
  const stopped = [];
  const delegate = new StreamingDelegate({ hap, log, imagePath: '/a.jpg', ffmpegPath: 'ff', spawn: () => (proc = fakeProc()), getPort: async () => 6000 });
  delegate.controller = { forceStopStreamingSession: (id) => stopped.push(id) };
  await new Promise((res) => delegate.prepareStream({ sessionID: 's2', targetAddress: '::1', addressVersion: 'ipv6', video: { port: 1, srtp_key: Buffer.alloc(16), srtp_salt: Buffer.alloc(14) } }, res));
  await new Promise((res) => delegate.handleStreamRequest({ sessionID: 's2', type: 'start', video: { width: 320, height: 180, fps: 15, max_bit_rate: 100, profile: 0, level: 0, pt: 99, mtu: 1316 } }, res));
  proc.emit('error', Object.assign(new Error('spawn ff ENOENT'), { code: 'ENOENT' }));
  assert.deepStrictEqual(stopped, ['s2']);
});

test('stream: unknown session is refused', async () => {
  const delegate = new StreamingDelegate({ hap, log, imagePath: '/a.jpg', ffmpegPath: 'ff', spawn: () => fakeProc() });
  const err = await new Promise((res) => delegate.handleStreamRequest({ sessionID: 'nope', type: 'start', video: {} }, res));
  assert.match(err.message, /Unknown stream session/);
});

test('recording: yields init + fragments from ffmpeg and cleans up', async () => {
  let proc;
  const delegate = new RecordingDelegate({ log, imagePath: '/a.jpg', ffmpegPath: 'ff', spawn: () => (proc = fakeProc()) });
  delegate.updateRecordingConfiguration({
    mediaContainerConfiguration: { fragmentLength: 4000 },
    videoCodec: { resolution: [1280, 720, 30], parameters: { profile: 1, level: 0, bitRate: 800, iFrameInterval: 4000 } },
    audioCodec: { samplerate: 3, bitrate: 32, audioChannels: 1 },
  });
  const packets = [];
  const run = (async () => {
    for await (const p of delegate.handleRecordingStreamRequest(1)) packets.push(p);
  })();
  await new Promise((r) => setImmediate(r));
  proc.stdout.write(Buffer.concat([box('ftyp', 20), box('moov', 50), box('moof', 20), box('mdat', 60)]));
  await new Promise((r) => setImmediate(r));
  delegate.closeRecordingStream(1);
  await run;
  assert.deepStrictEqual(packets.map((p) => p.data.length), [70, 80]);
  assert.ok(packets.every((p) => p.isLast === false));
  assert.strictEqual(proc.killed, 'SIGKILL');
  assert.strictEqual(delegate.streams.size, 0);
});

test('recording: refuses to start without a configuration', async () => {
  const delegate = new RecordingDelegate({ log, imagePath: '/a.jpg', ffmpegPath: 'ff', spawn: () => fakeProc() });
  await assert.rejects(async () => { for await (const _ of delegate.handleRecordingStreamRequest(1)) { void _; } }, /No recording configuration/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failed++;
      console.log(`not ok - ${name}\n${err.stack}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
