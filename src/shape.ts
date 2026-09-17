/**
 * An image's pixel size from its header, without decoding it: enough to tell
 * which slot a folder of captures serves by their shape. PNG, JPEG and WebP,
 * which is what a simulator or a capture flow writes and what a page can show.
 */
import { closeSync, openSync, readSync } from "node:fs";

/** Width and height in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Reads `length` bytes of an open file at `position`, or fewer at its end. */
function bytes(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, read);
}

/** The size of a JPEG: the first start-of-frame segment, after whatever metadata precedes it. */
function jpegSize(fd: number): Size | null {
  let at = 2;
  for (;;) {
    const head = bytes(fd, at, 4);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    // Standalone markers carry no length; skip them.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = head.readUInt16BE(2);
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (startOfFrame) {
      const frame = bytes(fd, at + 5, 4);
      if (frame.length < 4) return null;
      return { height: frame.readUInt16BE(0), width: frame.readUInt16BE(2) };
    }
    at += 2 + length;
  }
}

/** The size of a WebP, from whichever of its three bitstream chunks comes first. */
function webpSize(fd: number): Size | null {
  const head = bytes(fd, 12, 18);
  if (head.length < 18) return null;
  const chunk = head.toString("latin1", 0, 4);
  if (chunk === "VP8X") {
    return { width: 1 + head.readUIntLE(12, 3), height: 1 + head.readUIntLE(15, 3) };
  }
  if (chunk === "VP8L") {
    const bits = head.readUInt32LE(9);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    return { width: head.readUInt16LE(14) & 0x3fff, height: head.readUInt16LE(16) & 0x3fff };
  }
  return null;
}

/**
 * The pixel size of the image at `file`, or null when it is not a PNG, JPEG or
 * WebP, or cannot be read. Only the header is read.
 */
export function imageSize(file: string): Size | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const head = bytes(fd, 0, 24);
    if (head.length >= 24 && head.toString("latin1", 1, 4) === "PNG") {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }
    if (head.length >= 4 && head[0] === 0xff && head[1] === 0xd8) return jpegSize(fd);
    if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") {
      return webpSize(fd);
    }
    return null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
