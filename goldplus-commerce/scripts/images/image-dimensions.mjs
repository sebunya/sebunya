// Reads the pixel size of a PNG, JPEG, WebP or GIF from its header bytes.
// No native dependency, so the budget check runs in CI and in unit tests
// without sharp. Returns null for anything it does not recognise.
import { openSync, readSync, closeSync } from 'node:fs';

const HEAD_BYTES = 64 * 1024; // JPEG SOF markers can sit behind EXIF/ICC segments

function readHead(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

function png(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' };
}

function gif(b) {
  if (b.length < 10 || b.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: 'gif' };
}

function webp(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), format: 'webp' };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), format: 'webp' };
  }
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: 'webp' };
  return null;
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), format: 'jpeg' };
    }
    i += 2 + len;
  }
  return null;
}

export function imageDimensions(file) {
  const b = readHead(file);
  return png(b) ?? webp(b) ?? jpeg(b) ?? gif(b);
}
