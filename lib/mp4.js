'use strict';

/**
 * Splits a fragmented MP4 byte stream (ffmpeg stdout) into HKSV packets:
 * the first packet is the initialization segment (ftyp + moov), then one packet per fragment (moof + mdat).
 */
class Mp4PacketSplitter {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.pending = [];
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets = [];
    for (;;) {
      const box = this.#nextBox();
      if (!box) break;
      this.pending.push(box.data);
      if (box.type === 'moov' || box.type === 'mdat') {
        packets.push(Buffer.concat(this.pending));
        this.pending = [];
      }
    }
    return packets;
  }

  #nextBox() {
    if (this.buffer.length < 8) return null;
    let size = this.buffer.readUInt32BE(0);
    const type = this.buffer.toString('latin1', 4, 8);
    if (size === 1) {
      if (this.buffer.length < 16) return null;
      size = Number(this.buffer.readBigUInt64BE(8));
    }
    if (size < 8 || size > 0x7fffffff) {
      throw new Error(`Invalid MP4 box "${type}" with size ${size}`);
    }
    if (this.buffer.length < size) return null;
    const data = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return { type, data };
  }
}

module.exports = { Mp4PacketSplitter };
