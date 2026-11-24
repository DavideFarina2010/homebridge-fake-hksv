# homebridge-fake-hksv

Homebridge plugin that publishes a **fake HomeKit Secure Video camera**. It shows a static image of your choice as the camera feed and exposes the HomeKit Secure Video (HKSV) services, so the Home app offers the recording options.

It does not talk to any real camera and it never detects motion by itself.

## Requirements

- Homebridge 1.8+ or 2.x, Node.js 20.15+.
- [`ffmpeg`](https://ffmpeg.org/) with `libx264` (and `aac` for recording audio) installed on the Homebridge host. Set `ffmpegPath` if it is not in the `PATH`.
- A home hub (Apple TV or HomePod) and an iCloud+ plan to actually use HomeKit Secure Video.

## Configuration

```json
{
  "platform": "FakeHKSV",
  "name": "Fake Camera"
}
```

The camera shows the image bundled with the plugin (`assets/feed.jpg`), so every user sees the same feed.

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | yes | `Fake Camera` | Accessory name. |
| `imagePath` | no | bundled image | Absolute path of your own JPEG or PNG to show instead. It is read on every snapshot/stream, so you can replace the file without restarting. |
| `ffmpegPath` | no | `ffmpeg` | Path of the ffmpeg executable. |
| `serialNumber` | no | `FHKSV-0001` | Serial number shown in the Home app. |

If you set an `imagePath` that cannot be read, the camera is not published and a warning is logged.

## Pairing

The camera is published as an external accessory: it is **not** part of the bridge. In the Home app choose *Add Accessory* and use the setup code printed in the Homebridge log (or the QR code shown there).

## How it works

- **Snapshots and live view:** ffmpeg scales the image to the requested size and, for the live view, loops it as an H.264 stream sent to the device over SRTP (video only).
- **HomeKit Secure Video:** the camera declares the recording services and a motion sensor, so the Home app offers recording. The motion sensor is never triggered. If the hub asks for a clip, the image is encoded as fragmented MP4 on the fly.

## Status

Early version. The unit tests cover configuration, ffmpeg arguments, the MP4 splitter and the streaming/recording delegates with a fake ffmpeg, and Homebridge publishes the camera correctly. Streaming and recording have not yet been verified end to end with ffmpeg and a real iPhone/home hub.

## License

MIT
