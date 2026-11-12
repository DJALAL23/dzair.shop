import { describe, expect, it } from "vitest";
import type { orderAttribution } from "../db/schema";
import { capturedAttributionRow, enteredAttributionRow } from "./resolve";
import { orderAttributionView } from "./view";

type Row = typeof orderAttribution.$inferSelect;

const NOW = "2026-11-12T06:18:00.000Z";

const EMPTY: Row = {
  orderId: "o1",
  method: "captured",
  channel: null,
  capturedAt: null,
  platform: "direct",
  clickId: null,
  clickIdType: null,
  campaignId: null,
  adsetId: null,
  adId: null,
  placement: null,
  siteSource: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  namesJson: null,
  landingPath: null,
  landingPageType: null,
  referrerHost: null,
  firstTouchAt: null,
  firstTouchJson: null,
  createdAt: NOW,
  updatedAt: NOW,
  visitAt: null,
  visitChannel: null,
  visitPlatform: null,
  visitSiteSource: null,
  visitReferrerHost: null,
  visitLandingPath: null,
  visitLandingPageType: null,
  visitUtmSource: null,
  visitUtmMedium: null,
  visitUtmCampaign: null,
};

const stored = (row: ReturnType<typeof capturedAttributionRow>): Row => ({ ...EMPTY, ...row });

const AD = {
  at: "2026-11-12T06:10:00.000Z",
  params: { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "120200000000000001", utm_content: "120200000000000003", wc_cn: "TEST2-campaign", wc_an: "TEST2-ad", wc_pl: "Facebook_Mobile_Feed", wc_ss: "fb", fbclid: "IwAR2" },
  path: "/products/insulated-bottle",
  ref: null,
};
const DIRECT = { at: "2026-11-12T06:17:00.000Z", params: {}, path: "/", ref: null };

describe("orderAttributionView", () => {
  it("shows an order that came back directly after an ad as the ad, with this visit apart", () => {
    const view = orderAttributionView(stored(capturedAttributionRow("o1", { first: AD, last: AD, visit: DIRECT }, { now: NOW })));
    expect(view).toMatchObject({
      method: "captured",
      channel: "paid_social",
      platform: "meta",
      app: "fb",
      legacy: false,
      ad: { clickedAt: AD.at, campaignId: "120200000000000001", campaignName: "TEST2-campaign", adId: "120200000000000003", adName: "TEST2-ad", placement: "Facebook_Mobile_Feed", landingPath: "/products/insulated-bottle", landingPageType: "product" },
      visit: { at: DIRECT.at, channel: "direct", platform: "direct", landingPath: "/", landingPageType: "home", referrerHost: null },
    });
  });

  it("shows a direct order with no ad", () => {
    const view = orderAttributionView(stored(capturedAttributionRow("o1", { first: null, last: null, visit: DIRECT }, { now: NOW })));
    expect(view).toMatchObject({ channel: "direct", ad: null, visit: { channel: "direct" }, legacy: false });
  });

  it("shows an order staff entered by who entered it", () => {
    const view = orderAttributionView(stored(enteredAttributionRow("o1", "agent", NOW)));
    expect(view).toMatchObject({ method: "entered", channel: "agent", ad: null, visit: null });
  });

  it("reads a row written before v2 by today's rules: an _fbc-only click is Facebook, not an ad", () => {
    const view = orderAttributionView({ ...EMPTY, capturedAt: "2026-11-10T03:30:00.000Z", platform: "meta", clickId: "IwAR2F4", clickIdType: "fbclid" });
    expect(view).toMatchObject({ channel: "organic_social", platform: "meta", ad: null, visit: null, legacy: true });
  });

  it("reads a pre-v2 ad click as the ad it was", () => {
    const view = orderAttributionView({ ...EMPTY, capturedAt: NOW, platform: "meta", utmSource: "facebook", utmMedium: "paid_social", adId: "120200000000000003", utmContent: "120200000000000003" });
    expect(view).toMatchObject({ channel: "paid_social", ad: { adId: "120200000000000003" }, legacy: true });
  });

  it("reads a source a merchant chose before v2 as entered in the dashboard", () => {
    expect(orderAttributionView({ ...EMPTY, method: "merchant", platform: "meta", siteSource: "wa" })).toMatchObject({ channel: "dashboard", ad: null });
  });

  it("says nothing is known when the row stored nothing to read", () => {
    expect(orderAttributionView({ ...EMPTY, landingPath: "/" })).toMatchObject({ channel: null, ad: null, visit: null, legacy: true });
    expect(orderAttributionView(stored(capturedAttributionRow("o1", { first: { ...DIRECT, ref: "google.com" }, last: null, visit: null }, { now: NOW })))).toMatchObject({ channel: null, ad: null, legacy: true });
  });

  it("survives names that are not JSON", () => {
    expect(orderAttributionView({ ...EMPTY, utmMedium: "cpc", namesJson: "{oops" })).toMatchObject({ channel: "paid_other", ad: { campaignName: null, adName: null } });
  });
});
