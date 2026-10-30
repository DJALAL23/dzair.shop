import { describe, expect, it } from "vitest";
import { photoKeys, uploadKey, voiceKey } from "./media";

describe("where review media lives", () => {
  it("keeps uploads apart from kept media", () => {
    expect(uploadKey("g".repeat(32), "u".repeat(32))).toBe(`staging/reviews/${"g".repeat(32)}/${"u".repeat(32)}`);
    expect(photoKeys("r1", "m1")).toEqual({ key: "reviews/r1/m1.webp", thumbKey: "reviews/r1/m1-t.webp" });
    expect(voiceKey("r1", "m2", "audio/mp4")).toBe("reviews/r1/m2.m4a");
    expect(voiceKey("r1", "m2", "audio/webm")).toBe("reviews/r1/m2.webm");
  });
});
