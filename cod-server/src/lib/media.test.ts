/**
 * The store's media from its configuration: each host needs only what it
 * uses. An ImageKit store has no bucket and works; an R2 store without its
 * bucket is not configured, never a crash on first upload.
 */
import { describe, expect, it } from "vitest";
import { configuredMedia, mediaHostOf } from "./media";
import { TEST_IMAGEKIT_VARS, TEST_MEDIA_VARS } from "@/test-utils/media";

const DB = {} as D1Database;
const bucket = {} as R2Bucket;

describe("the store's Media Host", () => {
  it("is ImageKit with no bucket at all", () => {
    const env = { DB, ...TEST_IMAGEKIT_VARS } as never;
    expect(mediaHostOf(env).kind).toBe("imagekit");
    expect(configuredMedia(env)?.hostKind).toBe("imagekit");
  });

  it("is R2 with the Worker's bucket", () => {
    const env = { DB, ...TEST_MEDIA_VARS, MEDIA_BUCKET: bucket } as never;
    expect(mediaHostOf(env).kind).toBe("r2");
    expect(configuredMedia(env)?.hostKind).toBe("r2");
  });

  it("is not configured for R2 without a bucket, nor without a host", () => {
    const noBucket = { DB, ...TEST_MEDIA_VARS } as never;
    expect(() => mediaHostOf(noBucket)).toThrow(expect.objectContaining({ reason: "not_configured", message: expect.stringMatching(/no MEDIA_BUCKET binding/) }));
    expect(configuredMedia(noBucket)).toBeNull();
    expect(configuredMedia({ DB } as never)).toBeNull();
  });
});
