'use strict';

// Pure builders of ffmpeg argument lists: no process is spawned here.

const PROFILES = ['baseline', 'main', 'high'];
const LEVELS = ['3.1', '3.2', '4.0'];
const SAMPLE_RATES_HZ = [8000, 16000, 24000, 32000, 44100, 48000];

const BASE = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

// Fits the image inside width x height keeping the aspect ratio (black bars).
function fitFilter(width, height, pixFmt = 'yuv420p') {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=${pixFmt}`;
}

function snapshotArgs({ image, width, height }) {
  return [
    ...BASE,
    '-i', image,
    '-vf', fitFilter(width, height, 'yuvj420p'),
    '-frames:v', '1',
    '-c:v', 'mjpeg',
    '-q:v', '3',
    '-f', 'mjpeg',
    'pipe:1',
  ];
}

function liveVideoArgs({ image, width, height, fps, bitrate, profile, level, gopSeconds = 2 }) {
  return [
    ...BASE,
    '-re',
    '-loop', '1',
    '-framerate', String(fps),
    '-i', image,
    '-vf', fitFilter(width, height),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'stillimage',
    '-profile:v', PROFILES[profile] ?? 'main',
    '-level:v', LEVELS[level] ?? '3.1',
    '-r', String(fps),
    '-g', String(Math.max(1, Math.round(fps * gopSeconds))),
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-an',
  ];
}

function streamArgs({ address, ipVersion, port, localRtcpPort, mtu, payloadType, ssrc, srtpKey, srtpSalt, ...video }) {
  const host = ipVersion === 'ipv6' ? `[${address}]` : address;
  const params = Buffer.concat([srtpKey, srtpSalt]).toString('base64');
  return [
    ...liveVideoArgs(video),
    '-payload_type', String(payloadType),
    '-ssrc', String(ssrc),
    '-f', 'rtp',
    '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
    '-srtp_out_params', params,
    `srtp://${host}:${port}?rtcpport=${port}&localrtcpport=${localRtcpPort}&pkt_size=${mtu}`,
  ];
}

/**
 * Fragmented MP4 on stdout for HKSV recording. `iFrameIntervalMs` is the fragment length requested by the hub:
 * every fragment must start with a key frame.
 */
function recordingArgs({ image, width, height, fps, bitrate, profile, level, iFrameIntervalMs, audio }) {
  const args = [...BASE, '-re', '-loop', '1', '-framerate', String(fps), '-i', image];
  if (audio) {
    const layout = audio.channels > 1 ? 'stereo' : 'mono';
    args.push('-f', 'lavfi', '-i', `anullsrc=r=${audio.sampleRate}:cl=${layout}`);
  }
  const gop = Math.max(1, Math.round((fps * iFrameIntervalMs) / 1000));
  args.push(
    '-map', '0:v',
    ...(audio ? ['-map', '1:a'] : []),
    '-vf', fitFilter(width, height),
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'stillimage',
    '-profile:v', PROFILES[profile] ?? 'main',
    '-level:v', LEVELS[level] ?? '3.1',
    '-r', String(fps),
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-b:v', `${bitrate}k`,
  );
  if (audio) {
    args.push('-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', `${audio.bitrate}k`, '-ar', String(audio.sampleRate), '-ac', String(audio.channels));
  } else {
    args.push('-an');
  }
  args.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
  return args;
}

module.exports = { snapshotArgs, streamArgs, recordingArgs, fitFilter, SAMPLE_RATES_HZ };
