import { mediaDelivery } from "../../../cod-shared/media/delivery";
import { r2Host } from "../../../cod-shared/media/hosts/r2";
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
