import { mediaDelivery } from "../../../cod-shared/media/delivery";
import { r2Host } from "../../../cod-shared/media/hosts/r2";
import type { FakeImageKit } from "../../../cod-shared/media/hosts/testing/fake-imagekit";
import { mediaLibrary, type MediaLibrary } from "../../../cod-shared/media/library";
import type { AppDb } from "@/db";
import { relayPath } from "@/lib/media";

/** The store server's media in local development: its own bucket, relayed uploads, files served by `GET /media/:key`. */
export const TEST_MEDIA_VARS = { MEDIA_HOST: "r2", MEDIA_DELIVERY: "direct", MEDIA_ORIGIN: "http://localhost:8787/media" } as const;

/** The delivery tests read images through. */
export const TEST_DELIVERY = mediaDelivery(TEST_MEDIA_VARS.MEDIA_DELIVERY, TEST_MEDIA_VARS.MEDIA_ORIGIN);

/** The library a test worker's `mediaOf(env)` builds, over the same database and bucket. */
export function testMedia(test: { db: AppDb; bucket: R2Bucket }): MediaLibrary {
  return mediaLibrary({ db: test.db, host: r2Host({ binding: test.bucket }), delivery: TEST_DELIVERY, relayUrl: relayPath });
}

/** An ImageKit store's media: no bucket at all, files kept in its folder of the account and served by ImageKit. */
export const TEST_IMAGEKIT = { publicKey: "public_test", privateKey: "private_test" } as const;
export const TEST_IMAGEKIT_VARS = {
  MEDIA_HOST: "imagekit",
  MEDIA_DELIVERY: "imagekit",
  MEDIA_ORIGIN: "https://ik.imagekit.io/wocart/stores/maysa",
  IMAGEKIT_PUBLIC_KEY: TEST_IMAGEKIT.publicKey,
  IMAGEKIT_PRIVATE_KEY: TEST_IMAGEKIT.privateKey,
  IMAGEKIT_FOLDER: "/stores/maysa",
} as const;

/** Send the worker's calls to ImageKit's upload and API hosts to `fake`; anything else is refused. Undo with `vi.unstubAllGlobals()`. */
export function routeImageKit(fake: FakeImageKit, stub: (name: "fetch", value: typeof fetch) => void): void {
  stub("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.host !== "upload.imagekit.io" && url.host !== "api.imagekit.io") throw new Error(`unexpected fetch to ${url.host}`);
    const origin = url.host === "upload.imagekit.io" ? fake.uploadOrigin : fake.apiOrigin;
    return fake.fetch(new Request(`${origin}${url.pathname}${url.search}`, request));
  }) as typeof fetch);
}
