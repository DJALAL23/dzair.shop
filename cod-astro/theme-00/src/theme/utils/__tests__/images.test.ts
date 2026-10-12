// @vitest-environment node
/**
 * The theme's image binding (`src/theme/utils/images.ts`).
 *
 * `@vitest-environment node` is required for the same reason as
 * `src/theme/sdk.test.ts`: the module reads `astro:env/server`, which refuses
 * to load under the suite's default happy-dom environment.
 *
 * This is the file that replaced `src/core/utils/image-optimizer.ts`. The
 * legacy helper embedded the media domain at module scope and did its own
 * string surgery; the theme now binds the SDK's `createImageHelpers` once, and
 * these tests pin the two states a store actually runs in — a configured media
 * domain (Cloudflare Image Resizing URL) and no domain (original R2 URL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  MEDIA_DOMAIN: undefined as string | undefined,
}));

vi.mock("astro:env/server", () => ({
  get MEDIA_DOMAIN() {
    return env.MEDIA_DOMAIN;
  },
}));

const MEDIA_DOMAIN = "media.example.test";
const IMAGE_URL = `https://${MEDIA_DOMAIN}/stores/store_01/products/watch-1.jpg`;

describe("theme image binding", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    env.MEDIA_DOMAIN = undefined;
  });

  it("renders the cart thumbnail through the bound SDK helper", async () => {
    env.MEDIA_DOMAIN = MEDIA_DOMAIN;

    const { getThumbnailImage } = await import("@/theme/utils/images");

    expect(getThumbnailImage(IMAGE_URL)).toBe(
      `https://${MEDIA_DOMAIN}/cdn-cgi/image/width=80,height=80,format=webp,quality=80,fit=cover/stores/store_01/products/watch-1.jpg`
    );
  });

  it("passes product images through untouched when MEDIA_DOMAIN is unset", async () => {
    const { getThumbnailImage, getCardImage, generateSrcSet } = await import(
      "@/theme/utils/images"
    );

    expect(getThumbnailImage(IMAGE_URL)).toBe(IMAGE_URL);
    expect(getCardImage(IMAGE_URL)).toBe(IMAGE_URL);
    expect(generateSrcSet(IMAGE_URL, 400, 400)).toBe(
      `${IMAGE_URL} 1x, ${IMAGE_URL} 1.5x, ${IMAGE_URL} 2x`
    );
  });

  it("leaves a URL from another origin alone", async () => {
    env.MEDIA_DOMAIN = MEDIA_DOMAIN;

    const { getCardImage } = await import("@/theme/utils/images");

    expect(getCardImage("https://external.example.test/watch.jpg")).toBe(
      "https://external.example.test/watch.jpg"
    );
  });

  it("re-exports the whole toolkit — a missing helper is a binding bug", async () => {
    env.MEDIA_DOMAIN = MEDIA_DOMAIN;

    const images = await import("@/theme/utils/images");
    const helperNames = [
      "optimizeImage",
      "generateSrcSet",
      "getCardImage",
      "getGalleryImage",
      "getThumbnailImage",
      "getHeroImage",
      "getCategoryImage",
      "getLogoImage",
    ] as const;

    for (const name of helperNames) {
      expect(typeof images[name], `helper: ${name}`).toBe("function");
    }
    expect(images.IMAGE_SIZES.GALLERY_THUMB).toEqual({
      width: 80,
      height: 80,
      quality: 80,
    });
  });
});
