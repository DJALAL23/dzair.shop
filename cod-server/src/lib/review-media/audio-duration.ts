/**
 * A voice note's length, read from its own container when it says so:
 * MP4/M4A (`mvhd`), WebM (Segment Info `Duration`), Ogg (Opus or Vorbis, from
 * the last page's granule position). Null when the file does not say —
 * Chrome's recorder writes WebM without a duration, and MP3 is not read; the
 * size cap is what bounds those.
 */
import type { VoiceContentType } from "../../../../cod-shared/reviews/media";

const text = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const u32 = (view: DataView, at: number) => view.getUint32(at);

function indexOf(bytes: Uint8Array, pattern: number[], from = 0, to = bytes.length): number {
  outer: for (let i = from; i <= Math.min(to, bytes.length) - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

function lastIndexOf(bytes: Uint8Array, pattern: number[]): number {
  outer: for (let i = bytes.length - pattern.length; i >= 0; i--) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

function mp4Duration(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findBox = (type: string, from: number, to: number): number => {
    for (let at = from; at + 8 <= to; ) {
      let size = u32(view, at);
      if (size === 1 && at + 16 <= to) size = Number(view.getBigUint64(at + 8));
      if (size === 0) size = to - at;
      if (size < 8) return -1;
      if (text(bytes, at + 4, 4) === type) return at;
      at += size;
    }
    return -1;
  };
  const moov = findBox("moov", 0, bytes.length);
  if (moov < 0) return null;
  const mvhd = findBox("mvhd", moov + 8, Math.min(bytes.length, moov + u32(view, moov)));
  if (mvhd < 0 || mvhd + 32 > bytes.length) return null;
  const version = bytes[mvhd + 8];
  const timescale = version === 1 ? u32(view, mvhd + 28) : u32(view, mvhd + 20);
  const duration = version === 1 ? Number(view.getBigUint64(mvhd + 32)) : u32(view, mvhd + 24);
  if (!timescale || !duration || duration === 0xffffffff) return null;
  return Math.round((duration / timescale) * 1000);
}

/** An EBML variable-length size: its value and how many bytes it took. */
function vint(bytes: Uint8Array, at: number): { value: number; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + (bytes[at + i] ?? 0);
  return { value, length };
}

function webmDuration(bytes: Uint8Array): number | null {
  const head = Math.min(bytes.length, 64 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let scale = 1_000_000;
  const scaleAt = indexOf(bytes, [0x2a, 0xd7, 0xb1], 0, head);
  if (scaleAt >= 0) {
    const size = vint(bytes, scaleAt + 3);
    if (size && size.value <= 8) {
      let value = 0;
      for (let i = 0; i < size.value; i++) value = value * 256 + bytes[scaleAt + 3 + size.length + i];
      if (value > 0) scale = value;
    }
  }
  const at = indexOf(bytes, [0x44, 0x89], 0, head);
  if (at < 0) return null;
  const size = vint(bytes, at + 2);
  if (!size) return null;
  const start = at + 2 + size.length;
  if (start + size.value > bytes.length) return null;
  const ticks = size.value === 4 ? view.getFloat32(start) : size.value === 8 ? view.getFloat64(start) : NaN;
  if (!Number.isFinite(ticks) || ticks <= 0) return null;
  return Math.round((ticks * scale) / 1_000_000);
}

function oggDuration(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0;
  let preSkip = 0;
  const opus = indexOf(bytes, Array.from("OpusHead", (c) => c.charCodeAt(0)), 0, 512);
  if (opus >= 0) {
    rate = 48_000;
    preSkip = view.getUint16(opus + 10, true);
  } else {
    const vorbis = indexOf(bytes, [0x01, ...Array.from("vorbis", (c) => c.charCodeAt(0))], 0, 512);
    if (vorbis < 0) return null;
    rate = view.getUint32(vorbis + 12, true);
  }
  const last = lastIndexOf(bytes, Array.from("OggS", (c) => c.charCodeAt(0)));
  if (last < 0 || last + 14 > bytes.length || !rate) return null;
  const granule = Number(view.getBigInt64(last + 6, true));
  if (granule <= preSkip) return null;
  return Math.round(((granule - preSkip) / rate) * 1000);
}

export function audioDurationMs(bytes: Uint8Array, contentType: VoiceContentType): number | null {
  try {
    if (contentType === "audio/mp4") return mp4Duration(bytes);
    if (contentType === "audio/webm") return webmDuration(bytes);
    if (contentType === "audio/ogg") return oggDuration(bytes);
    return null;
  } catch {
    return null;
  }
}
