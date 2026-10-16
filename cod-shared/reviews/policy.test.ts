import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_POLICY, reviewPolicy, statusOnArrival, voiceMaxBytes } from "./policy";

const settings = { reviewsEnabled: true, reviewMaxPhotos: 3, reviewVoiceMaxSeconds: null, reviewAutoPublish: "text_only" };

describe("a store's review policy", () => {
  it("is read from the store's settings", () => {
    expect(reviewPolicy(settings)).toEqual(DEFAULT_REVIEW_POLICY);
    expect(reviewPolicy({ ...settings, reviewsEnabled: false, reviewMaxPhotos: 0, reviewVoiceMaxSeconds: 90, reviewAutoPublish: "all" })).toEqual({
      enabled: false, maxPhotos: 0, voiceMaxSeconds: 90, autoPublish: "all",
    });
  });

  it("never goes past the hard limits, and fails safe on anything it does not know", () => {
    expect(reviewPolicy({ ...settings, reviewMaxPhotos: 40 }).maxPhotos).toBe(6);
    expect(reviewPolicy({ ...settings, reviewMaxPhotos: -2 }).maxPhotos).toBe(0);
    expect(reviewPolicy({ ...settings, reviewMaxPhotos: Number.NaN }).maxPhotos).toBe(3);
    expect(reviewPolicy({ ...settings, reviewVoiceMaxSeconds: 45 }).voiceMaxSeconds).toBeNull();
    expect(reviewPolicy({ ...settings, reviewAutoPublish: "everything" }).autoPublish).toBe("off");
  });
});

describe("where a shopper's review lands", () => {
  const policy = (autoPublish: "off" | "text_only" | "all") => ({ ...DEFAULT_REVIEW_POLICY, autoPublish });

  it("waits for the merchant when nothing publishes on its own", () => {
    expect(statusOnArrival(policy("off"), { hasMedia: false })).toBe("pending");
    expect(statusOnArrival(policy("off"), { hasMedia: true })).toBe("pending");
  });

  it("publishes text at once, but a photo or a voice note waits", () => {
    expect(statusOnArrival(policy("text_only"), { hasMedia: false })).toBe("approved");
    expect(statusOnArrival(policy("text_only"), { hasMedia: true })).toBe("pending");
  });

  it("publishes everything when the merchant chose so", () => {
    expect(statusOnArrival(policy("all"), { hasMedia: true })).toBe("approved");
  });
});

describe("what a voice note may weigh", () => {
  it("grows with its length and covers speech recorded by a phone", () => {
    expect(voiceMaxBytes(30)).toBe(30 * 24 * 1024 + 64 * 1024);
    expect(voiceMaxBytes(120)).toBeLessThan(3 * 1024 * 1024);
    // 60 s of Opus at 32 kb/s, and of AAC at 48 kb/s, both fit.
    expect(60 * 32_000 / 8).toBeLessThan(voiceMaxBytes(60));
    expect(60 * 48_000 / 8).toBeLessThan(voiceMaxBytes(60));
  });
});
