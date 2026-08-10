const APP1 = 0xe1;
const APP15 = 0xef;
const COMMENT = 0xfe;
const END_OF_IMAGE = 0xd9;
const START_OF_SCAN = 0xda;

function fail(): never {
  throw new Error('Invalid JPEG');
}

/** Removes metadata-bearing APP1..APP15 and COM segments without decoding pixels. */
export function stripExif(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) fail();

  const output: Buffer[] = [jpeg.subarray(0, 2)];
  let offset = 2;

  while (offset < jpeg.length) {
    const markerStart = offset;
    if (jpeg[offset] !== 0xff) fail();
    while (jpeg[offset] === 0xff) offset += 1;
    if (offset >= jpeg.length) fail();

    const marker = jpeg[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd8) fail();
    offset += 1;

    if (marker === END_OF_IMAGE) {
      output.push(jpeg.subarray(markerStart, offset));
      return Buffer.concat(output);
    }

    const standalone = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
    if (standalone) {
      output.push(jpeg.subarray(markerStart, offset));
      continue;
    }

    if (offset + 2 > jpeg.length) fail();
    const length = jpeg.readUInt16BE(offset);
    if (length < 2) fail();
    const segmentEnd = offset + length;
    if (segmentEnd > jpeg.length) fail();

    if (!((marker >= APP1 && marker <= APP15) || marker === COMMENT)) {
      output.push(jpeg.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;

    if (marker !== START_OF_SCAN) continue;

    const scanStart = offset;
    while (offset < jpeg.length - 1) {
      if (jpeg[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = jpeg[offset + 1];
      if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      output.push(jpeg.subarray(scanStart, offset));
      break;
    }
    if (offset >= jpeg.length - 1) fail();
  }

  fail();
}
