import { describe, expect, it } from "vitest";
import { ATTRIBUTION_PLATFORMS } from "./model";
import { ORDER_SOURCES, ORDER_SOURCE_LABELS, merchantAttributionRow, orderSourceOf } from "./source";

const NOW = "2026-11-11T12:00:00.000Z";

describe("merchantAttributionRow", () => {
  it("records the source the merchant named, with the campaign and ad when known", () => {
    expect(merchantAttributionRow("o1", { source: "instagram", campaignId: "120200000000000001", adId: "120200000000000003" }, NOW)).toEqual({
      orderId: "o1",
      method: "merchant",
      capturedAt: null,
      platform: "meta",
      siteSource: "ig",
      campaignId: "120200000000000001",
      adId: "120200000000000003",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("gives every source its platform", () => {
    const platforms = Object.fromEntries(ORDER_SOURCES.map((source) => [source, [merchantAttributionRow("o", { source }, NOW).platform, merchantAttributionRow("o", { source }, NOW).siteSource]]));
    expect(platforms).toEqual({
      facebook: ["meta", "fb"],
      instagram: ["meta", "ig"],
      messenger: ["meta", "msg"],
      whatsapp: ["meta", "wa"],
      tiktok: ["tiktok", null],
      phone: ["phone", null],
      other: ["other", null],
    });
    expect(merchantAttributionRow("o", { source: "phone" }, NOW)).toMatchObject({ campaignId: null, adId: null });
  });
});

describe("orderSourceOf", () => {
  it("reads back every source a merchant names", () => {
    for (const source of ORDER_SOURCES) expect(orderSourceOf(merchantAttributionRow("o", { source }, NOW)), source).toBe(source);
  });

  it("names a captured Meta visit by Meta's site source, Facebook otherwise", () => {
    expect(orderSourceOf({ platform: "meta", siteSource: "ig" })).toBe("instagram");
    expect(orderSourceOf({ platform: "meta", siteSource: "msg" })).toBe("messenger");
    for (const siteSource of ["fb", "an", "th", null, undefined]) expect(orderSourceOf({ platform: "meta", siteSource }), String(siteSource)).toBe("facebook");
  });

  it("has a label for every platform", () => {
    for (const platform of ATTRIBUTION_PLATFORMS) expect(ORDER_SOURCE_LABELS, platform).toContain(orderSourceOf({ platform, siteSource: null }));
  });
});
