import { describe, expect, it } from "vitest";
import { reviewMediaRules, shopperReviewMedia } from "./model";

describe("what shoppers can send with a review", () => {
  it("is read from the rules for photos and voice notes", () => {
    expect(shopperReviewMedia({ maxPhotos: 0, voiceMaxSeconds: null })).toBe("text");
    expect(shopperReviewMedia({ maxPhotos: 3, voiceMaxSeconds: null })).toBe("photos");
    expect(shopperReviewMedia({ maxPhotos: 0, voiceMaxSeconds: 60 })).toBe("voice");
    expect(shopperReviewMedia({ maxPhotos: 2, voiceMaxSeconds: 30 })).toBe("photos_voice");
  });

  it("saves only what the choice takes, within the limits", () => {
    expect(reviewMediaRules("text", 4, 90)).toEqual({ maxPhotos: 0, voiceMaxSeconds: null });
    expect(reviewMediaRules("photos", 4, 90)).toEqual({ maxPhotos: 4, voiceMaxSeconds: null });
    expect(reviewMediaRules("voice", 4, 90)).toEqual({ maxPhotos: 0, voiceMaxSeconds: 90 });
    expect(reviewMediaRules("photos_voice", 9, 120)).toEqual({ maxPhotos: 6, voiceMaxSeconds: 120 });
    expect(reviewMediaRules("photos", 0, 30)).toEqual({ maxPhotos: 1, voiceMaxSeconds: null });
  });
});
