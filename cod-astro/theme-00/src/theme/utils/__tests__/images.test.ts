// @vitest-environment node
/**
 * The theme's image bindings: the helpers (`utils/images.ts`) at this theme's
 * sizes, and the image service (`utils/image-service.ts`), which reads the
 * delivery the store context keeps.
 */
import { describe, expect, it } from "vitest";
import type { ImageTransform } from "astro";
import type { MediaDelivery } from "@wocart/storefront";
import { pickedPicture, thumbnailImage } from "../images";

const IMAGEKIT: MediaDelivery = { kind: "imagekit", origin: "https://ik.imagekit.io/wocart/stores/maysa" };
const DIRECT: MediaDelivery = { kind: "direct", origin: "http://localhost:8787/media" };
const PHOTO = `${IMAGEKIT.origin}/products/watch-1.jpg`;
const config = { service: { entrypoint: "", config: {} }, domains: [], remotePatterns: [] } as never;
const logger = {} as never;

describe("theme image binding", () => {
  it("gives the cart thumbnail at the size it renders", () => {
    expect(thumbnailImage(PHOTO, IMAGEKIT)).toBe(`${PHOTO}?tr=w-80,h-80,c-maintain_ratio,q-80,f-auto`);
  });

  it("keeps a photo's URL when its delivery does not resize", () => {
    expect(thumbnailImage(`${DIRECT.origin}/products/a.png`, DIRECT)).toBe(`${DIRECT.origin}/products/a.png`);
  });

  it("draws a picked image from its key, at the store's delivery", () => {
    expect(pickedPicture({ key: "products/hero.webp", alt: "Robe", focal: { x: 0.3, y: 0.7 } }, IMAGEKIT)).toEqual({
      src: `${IMAGEKIT.origin}/products/hero.webp`,
      alt: "Robe",
      width: undefined,
      height: undefined,
      position: "30% 70%",
    });
    expect(pickedPicture(null, IMAGEKIT)).toBeNull();
  });
});

describe("theme image service", () => {
  it("passes every image through until a store's delivery is kept, then resizes with it", async () => {
    const { default: service, keepStoreMedia } = await import("../image-service");
    const url = () => service.getURL({ src: PHOTO, width: 480 } as ImageTransform, config, logger);

    expect(await url()).toBe(PHOTO);
    keepStoreMedia(IMAGEKIT);
    expect(await url()).toBe(`${PHOTO}?tr=w-480`);
  });
});
