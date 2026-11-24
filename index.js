'use strict';

const { parseConfig } = require('./lib/config');
const { buildControllerOptions } = require('./lib/camera');
const { StreamingDelegate } = require('./lib/streaming');
const { RecordingDelegate } = require('./lib/recording');

const { version: PLUGIN_VERSION } = require('./package.json');

const PLUGIN_NAME = 'homebridge-fake-hksv';
const PLATFORM_NAME = 'FakeHKSV';

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, FakeHksvPlatform);
};

class FakeHksvPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.delegates = [];

    // Without a valid config nothing is published.
    api.on('didFinishLaunching', () => this.publish());
    api.on('shutdown', () => this.delegates.forEach((d) => d.shutdown()));
  }

  // Published as an "external" accessory: nothing to restore from the cache.
  configureAccessory() {}

  publish() {
    const settings = parseConfig(this.config);
    if (settings.error) {
      this.log.warn(`Camera not published: ${settings.error}`);
      return;
    }

    const { Service, Characteristic, Categories, uuid } = this.api.hap;
    const { name, imagePath, ffmpegPath, serialNumber } = settings;

    const accessory = new this.api.platformAccessory(
      name,
      uuid.generate(`${PLUGIN_NAME}:${name}`),
      Categories.IP_CAMERA,
    );
    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(Characteristic.Model, 'Fake HKSV Camera')
      .setCharacteristic(Characteristic.SerialNumber, serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    const streamingDelegate = new StreamingDelegate({ hap: this.api.hap, log: this.log, imagePath, ffmpegPath });
    let controller;
    const recordingDelegate = new RecordingDelegate({
      log: this.log,
      imagePath,
      ffmpegPath,
      isAudioActive: () =>
        Boolean(
          controller?.recordingManagement?.operatingModeService.getCharacteristic(Characteristic.RecordingAudioActive).value,
        ),
    });
    controller = new this.api.hap.CameraController(
      buildControllerOptions(this.api.hap, { streamingDelegate, recordingDelegate }),
    );
    streamingDelegate.controller = controller;
    accessory.configureController(controller);
    this.delegates.push(streamingDelegate, recordingDelegate);

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
    this.log.info(`Camera "${name}" published (image: ${imagePath}). Add it in the Home app with the setup code printed below (it is paired separately from the bridge).`);
  }
}
