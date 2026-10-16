import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sniffMedia } from "../../../../cod-shared/reviews/media";
import { audioDurationMs } from "./audio-duration";

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(Array.from(type, (c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

function mvhd(timescale: number, duration: number, version: 0 | 1 = 0): Uint8Array {
  const body = new Uint8Array(version === 1 ? 108 : 96);
  const view = new DataView(body.buffer);
  body[0] = version;
  if (version === 1) {
    view.setUint32(20, timescale);
    view.setBigUint64(24, BigInt(duration));
  } else {
    view.setUint32(12, timescale);
    view.setUint32(16, duration);
  }
  return box("mvhd", body);
}

describe("a voice note's length", () => {
  it("reads an M4A (iPhone), whatever comes before its movie header", () => {
    const file = concat(box("ftyp", new Uint8Array(16)), box("mdat", new Uint8Array(500)), box("moov", mvhd(44_100, 44_100 * 21)));
    expect(audioDurationMs(file, "audio/mp4")).toBe(21_000);
    expect(audioDurationMs(concat(box("ftyp", new Uint8Array(8)), box("moov", mvhd(1000, 75_500, 1))), "audio/mp4")).toBe(75_500);
  });

  it("reads a WebM's duration, in its own time scale", () => {
    const duration = new Uint8Array(8);
    new DataView(duration.buffer).setFloat64(0, 31_250);
    const file = concat(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x88]), duration);
    expect(audioDurationMs(file, "audio/webm")).toBe(31_250);
  });

  it("reads an Ogg Opus from its last page, less the pre-skip", () => {
    const head = new Uint8Array(19);
    head.set(Array.from("OpusHead", (c) => c.charCodeAt(0)));
    new DataView(head.buffer).setUint16(10, 312, true);
    const lastPage = new Uint8Array(27);
    lastPage.set(Array.from("OggS", (c) => c.charCodeAt(0)));
    new DataView(lastPage.buffer).setBigInt64(6, BigInt(48_000 * 12 + 312), true);
    const file = concat(Uint8Array.from(Array.from("OggS", (c) => c.charCodeAt(0))), new Uint8Array(24), head, new Uint8Array(100), lastPage);
    expect(audioDurationMs(file, "audio/ogg")).toBe(12_000);
  });

  it("says nothing when the file does not say, or is damaged", () => {
    expect(audioDurationMs(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0]), "audio/webm")).toBeNull();
    expect(audioDurationMs(box("ftyp", new Uint8Array(8)), "audio/mp4")).toBeNull();
    expect(audioDurationMs(Uint8Array.from([0, 0, 0, 3, 0x6d]), "audio/mp4")).toBeNull();
    expect(audioDurationMs(Uint8Array.from([0x49, 0x44, 0x33]), "audio/mpeg")).toBeNull();
    expect(audioDurationMs(new Uint8Array(0), "audio/ogg")).toBeNull();
  });
});

describe("real recordings (ffmpeg, 3.2 s: what phones and people send)", () => {
  const file = (name: string) => new Uint8Array(readFileSync(resolve(__dirname, "__fixtures__", name)));
  const near = (ms: number | null, expected: number) => expect(ms !== null && Math.abs(ms - expected) <= 60, `${ms} ≈ ${expected}`).toBe(true);

  it("are recognised by their bytes", () => {
    expect(["voice.m4a", "voice-fragmented.m4a", "voice.webm", "voice.ogg", "voice.mp3"].map((name) => sniffMedia(file(name).subarray(0, 16))?.contentType)).toEqual([
      "audio/mp4", "audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg",
    ]);
  });

  it("give their length where the container says it", () => {
    near(audioDurationMs(file("voice.m4a"), "audio/mp4"), 3200);
    near(audioDurationMs(file("voice.webm"), "audio/webm"), 3208);
    near(audioDurationMs(file("voice.ogg"), "audio/ogg"), 3200);
  });

  it("say nothing rather than a wrong length when the container does not say", () => {
    const fragmented = audioDurationMs(file("voice-fragmented.m4a"), "audio/mp4");
    expect(fragmented === null || Math.abs(fragmented - 3223) <= 60).toBe(true);
    expect(audioDurationMs(file("voice.mp3"), "audio/mpeg")).toBeNull();
  });
});
