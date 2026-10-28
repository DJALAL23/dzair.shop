import { describe, expect, it } from "vitest";
import { isMediaKey, newMediaKey, sniffMedia } from "./keys";

const bytes = (...values: Array<number | string>) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === "string" ? Array.from(v, (c) => c.charCodeAt(0)) : [v])));

describe("a Media Key", () => {
  it("is every shape the store writes", () => {
    for (const key of [
      "products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp",
      "products/starter-dress.webp",
      "landing/0123456789abcdef0123456789abcdef.webp",
      "reviews/r1/m1.webp",
      "reviews/r1/m1-t.webp",
      "reviews/r1/m2.m4a",
    ]) {
      expect(isMediaKey(key), key).toBe(true);
    }
  });

  it("names no other folder, no empty or relative segment, and nothing a URL would read twice", () => {
    for (const value of [
      "",
      "products",
      "products/",
      "staging/reviews/a.webp",
      "review-uploads/g/u",
      "/products/a.webp",
      "products//a.webp",
      "products/./a.webp",
      "products/../landing/a.webp",
      "products/.hidden",
      "products/a b.webp",
      "products/a.webp?x=1",
      "products/a.webp#x",
      "products/a%2F.webp",
      "products\\a.webp",
      "products/a\u0000.webp",
      "products/é.webp",
      `products/${"a".repeat(512)}`,
      "https://media.example.com/products/a.webp",
      "media:products/a.webp",
      42,
      null,
    ]) {
      expect(isMediaKey(value), String(value)).toBe(false);
    }
  });

  it("is fresh for each browser upload, in its folder, with the type's extension", () => {
    const one = newMediaKey("products", "image/jpeg");
    const two = newMediaKey("products", "image/jpeg");
    expect(one).toMatch(/^products\/[0-9a-f]{32}\.jpg$/);
    expect(two).not.toBe(one);
    expect(newMediaKey("landing", "image/webp")).toMatch(/^landing\/[0-9a-f]{32}\.webp$/);
    expect(isMediaKey(one)).toBe(true);
  });
});

describe("what a file is", () => {
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
