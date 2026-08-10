import assert from 'node:assert/strict';
import test from 'node:test';

import { stripExif } from './strip-exif.js';

const segment = (marker: number, payload: Buffer): Buffer => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};

test('removes metadata-bearing APP and comment segments while preserving image data', () => {
  const app0 = segment(0xe0, Buffer.from('JFIF\0'));
  const app1 = segment(0xe1, Buffer.from('Exif\0\0GPS coordinates'));
  const app2 = segment(0xe2, Buffer.from('XMP private metadata'));
  const app13 = segment(0xed, Buffer.from('IPTC location metadata'));
  const comment = segment(0xfe, Buffer.from('owner identity'));
  const startOfScan = segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
  const scanData = Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    app1,
    app2,
    app13,
    comment,
    startOfScan,
    scanData,
    Buffer.from([0xff, 0xd9]),
  ]);

  const stripped = stripExif(jpeg);

  assert.equal(stripped.includes(Buffer.from('Exif')), false);
  assert.equal(stripped.includes(Buffer.from('XMP private metadata')), false);
  assert.equal(stripped.includes(Buffer.from('IPTC location metadata')), false);
  assert.equal(stripped.includes(Buffer.from('owner identity')), false);
  assert.equal(stripped.includes(Buffer.from('JFIF')), true);
  assert.equal(stripped.includes(scanData), true);
  assert.deepEqual(stripped.subarray(-2), Buffer.from([0xff, 0xd9]));
});

test('rejects malformed data instead of writing an unsafe pseudo-JPEG', () => {
  assert.throws(() => stripExif(Buffer.from('not a jpeg')), /JPEG/);
});
