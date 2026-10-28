import { describe, expect, it } from "vitest";
import { mediaDelivery, mediaImage, mediaKeyOf, mediaUrl } from "./delivery";
import { MediaError } from "./errors";

const imagekit = mediaDelivery("imagekit", "https://ik.imagekit.io/wocart/stores/maysa/");

describe("a store's Media Delivery", () => {
  it("is a kind and an origin with no trailing slash", () => {
    expect(imagekit).toEqual({ kind: "imagekit", origin: "https://ik.imagekit.io/wocart/stores/maysa" });
    expect(mediaDelivery("cloudflare", "https://media.boutique.dz")).toEqual({ kind: "cloudflare", origin: "https://media.boutique.dz" });
    expect(mediaDelivery("direct", "http://localhost:8787/media")).toEqual({ kind: "direct", origin: "http://localhost:8787/media" });
  });

  it("refuses a configuration that would serve broken or unsafe URLs", () => {
    for (const [kind, origin] of [
      [undefined, "https://x.dz"],
      ["s3", "https://x.dz"],
      ["imagekit", undefined],
      ["imagekit", "ik.imagekit.io/wocart"],
      ["imagekit", "http://ik.imagekit.io/wocart"],
      ["cloudflare", "https://media.x.dz/?v=1"],
      ["cloudflare", "https://media.x.dz/#a"],
      ["cloudflare", "https://user:pass@media.x.dz"],
      ["direct", "ftp://x.dz"],
    ] as const) {
      expect(() => mediaDelivery(kind, origin), `${kind} ${origin}`).toThrow(MediaError);
    }
  });
});

describe("a key's URL", () => {
  it("is the origin, a slash and the key", () => {
    expect(mediaUrl("products/a.webp", imagekit)).toBe("https://ik.imagekit.io/wocart/stores/maysa/products/a.webp");
    expect(mediaImage({ key: "landing/b.webp", width: 1080, height: 1920 }, imagekit)).toEqual({
      key: "landing/b.webp",
      url: "https://ik.imagekit.io/wocart/stores/maysa/landing/b.webp",
      width: 1080,
      height: 1920,
    });
  });

  it("is refused for anything that is not a key", () => {
    expect(() => mediaUrl("../secrets", imagekit)).toThrow(expect.objectContaining({ reason: "key_invalid" }));
  });

  it("reads back to its key, resized or not; another URL reads to none", () => {
    expect(mediaKeyOf("https://ik.imagekit.io/wocart/stores/maysa/products/a.webp", imagekit)).toBe("products/a.webp");
    expect(mediaKeyOf("https://ik.imagekit.io/wocart/stores/maysa/products/a.webp?tr=w-400", imagekit)).toBe("products/a.webp");
    expect(mediaKeyOf("https://ik.imagekit.io/wocart/stores/other/products/a.webp", imagekit)).toBeNull();
    expect(mediaKeyOf("https://ik.imagekit.io/wocart/stores/maysa-old/products/a.webp", imagekit)).toBeNull();
    expect(mediaKeyOf("https://ik.imagekit.io/wocart/stores/maysa/../x", imagekit)).toBeNull();
    expect(mediaKeyOf("https://cdn.example.com/products/a.webp", imagekit)).toBeNull();
  });
});
