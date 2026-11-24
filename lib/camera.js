'use strict';

const RESOLUTIONS = [
  [320, 180, 30],
  [320, 240, 15],
  [320, 240, 30],
  [480, 270, 30],
  [480, 360, 30],
  [640, 360, 30],
  [640, 480, 30],
  [1280, 720, 30],
  [1280, 960, 30],
  [1920, 1080, 30],
];

/** Options for hap.CameraController: live view over SRTP (video only) + HomeKit Secure Video enabled. */
function buildControllerOptions(hap, { streamingDelegate, recordingDelegate }) {
  const codec = {
    profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
    levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
  };
  return {
    cameraStreamCount: 1,
    delegate: streamingDelegate,
    streamingOptions: {
      supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
      video: { codec, resolutions: RESOLUTIONS },
    },
    recording: {
      options: {
        prebufferLength: 4000,
        mediaContainerConfiguration: [
          { type: hap.MediaContainerType.FRAGMENTED_MP4, fragmentLength: 4000 },
        ],
        video: {
          type: hap.VideoCodecType.H264,
          parameters: codec,
          resolutions: RESOLUTIONS,
        },
        audio: {
          codecs: [
            {
              type: hap.AudioRecordingCodecType.AAC_LC,
              audioChannels: 1,
              samplerate: [
                hap.AudioRecordingSamplerate.KHZ_24,
                hap.AudioRecordingSamplerate.KHZ_32,
                hap.AudioRecordingSamplerate.KHZ_48,
              ],
            },
          ],
        },
      },
      delegate: recordingDelegate,
    },
    // HKSV requires a motion sensor service. It exists but is never triggered: no motion simulation.
    sensors: { motion: true },
  };
}

module.exports = { buildControllerOptions, RESOLUTIONS };
