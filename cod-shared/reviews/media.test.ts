import { describe, expect, it } from "vitest";
import { photoKeys, sniffMedia, uploadKey, voiceKey } from "./media";

const bytes = (...values: Array<number | string>) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === "string" ? Array.from(v, (c) => c.charCodeAt(0)) : [v])));

describe("what a received file is", () => {
  it("reads photos from their first bytes", () => {
    expect(sniffMedia(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ kind: "image", contentType: "image/jpeg" });
    expect(sniffMedia(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ kind: "image", contentType: "image/png" });
    expect(sniffMedia(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toEqual({ kind: "image", contentType: "image/webp" });
    expect(sniffMedia(bytes("GIF89a"))).toEqual({ kind: "image", contentType: "image/gif" });
  });

  it("reads voice notes as phones record them and as people send them", () => {
    expect(sniffMedia(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f))).toEqual({ kind: "audio", contentType: "audio/webm" });
    expect(sniffMedia(bytes("OggS", 0))).toEqual({ kind: "audio", contentType: "audio/ogg" });
    expect(sniffMedia(bytes(0, 0, 0, 0x20, "ftypM4A "))).toEqual({ kind: "audio", contentType: "audio/mp4" });
    expect(sniffMedia(bytes("ID3", 4, 0))).toEqual({ kind: "audio", contentType: "audio/mpeg" });
    expect(sniffMedia(bytes(0xff, 0xfb, 0x90, 0x64))).toEqual({ kind: "audio", contentType: "audio/mpeg" });
  });

  it("refuses anything else, whatever it claims to be", () => {
    for (const head of [bytes("<svg xmlns"), bytes("%PDF-1.7"), bytes("PK", 3, 4), bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "), bytes(0xff, 0xf1, 0x50), bytes(), bytes("MZ")]) {
      expect(sniffMedia(head)).toBeNull();
    }
  });
});

describe("where review media lives", () => {
  it("keeps uploads apart from kept media", () => {
    expect(uploadKey("g".repeat(32), "u".repeat(32))).toBe(`review-uploads/${"g".repeat(32)}/${"u".repeat(32)}`);
    expect(photoKeys("r1", "m1")).toEqual({ key: "reviews/r1/m1.webp", thumbKey: "reviews/r1/m1-t.webp" });
    expect(voiceKey("r1", "m2", "audio/mp4")).toBe("reviews/r1/m2.m4a");
    expect(voiceKey("r1", "m2", "audio/webm")).toBe("reviews/r1/m2.webm");
  });
});
