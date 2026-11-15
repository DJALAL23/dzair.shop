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

  it("shows the earlier visit an order's source comes from when the shopper came back directly", () => {
    const SEARCH = { at: "2026-11-10T09:00:00.000Z", params: {}, path: "/products/insulated-bottle", ref: "www.google.com" };
    const view = orderAttributionView(stored(capturedAttributionRow("o1", { first: SEARCH, last: null, source: SEARCH, visit: DIRECT }, { now: NOW })));
    expect(view).toMatchObject({
      channel: "organic_search",
      ad: null,
      earlier: { at: SEARCH.at, channel: "organic_search", platform: "google", referrerHost: "www.google.com", landingPath: "/products/insulated-bottle", landingPageType: "product" },
      visit: { at: DIRECT.at, channel: "direct" },
    });
  });

  it("shows no earlier visit when this visit is the source, or the source is the ad", () => {
    const SEARCH = { at: "2026-11-12T06:16:00.000Z", params: {}, path: "/", ref: "www.google.com" };
    expect(orderAttributionView(stored(capturedAttributionRow("o1", { first: null, last: null, source: SEARCH, visit: SEARCH }, { now: NOW }))).earlier).toBeNull();
    expect(orderAttributionView(stored(capturedAttributionRow("o1", { first: AD, last: AD, visit: DIRECT }, { now: NOW }))).earlier).toBeNull();
    expect(orderAttributionView(stored(capturedAttributionRow("o1", { first: null, last: null, visit: DIRECT }, { now: NOW }))).earlier).toBeNull();
  });

  it("shows the first visit, read back as it was kept", () => {
    const FIRST = { at: "2026-10-20T08:00:00.000Z", params: { utm_source: "ig", utm_medium: "social", utm_content: "link_in_bio" }, path: "/", ref: "l.instagram.com" };
    const view = orderAttributionView(stored(capturedAttributionRow("o1", { first: FIRST, last: null, visit: DIRECT }, { now: NOW })));
    expect(view.first).toEqual({ at: FIRST.at, channel: "organic_social", platform: "meta", app: "ig", referrerHost: "l.instagram.com", landingPath: "/", landingPageType: "home", utmSource: "ig", utmMedium: "social", utmCampaign: null });
    expect(orderAttributionView({ ...EMPTY, firstTouchJson: "{not json" }).first).toBeNull();
    expect(orderAttributionView({ ...EMPTY, firstTouchJson: JSON.stringify({ params: {} }) }).first).toBeNull();
    expect(orderAttributionView(stored(enteredAttributionRow("o1", "dashboard", NOW))).first).toBeNull();
  });

  it("shows a direct order with no ad", () => {
    const view = orderAttributionView(stored(capturedAttributionRow("o1", { first: null, last: null, visit: DIRECT }, { now: NOW })));
    expect(view).toMatchObject({ channel: "direct", ad: null, visit: { channel: "direct" }, legacy: false });
  });

  it("shows an order staff entered by who entered it", () => {
    const view = orderAttributionView(stored(enteredAttributionRow("o1", "agent", NOW)));
    expect(view).toMatchObject({ method: "entered", channel: "agent", ad: null, visit: null });
  });

  it("says a row written before v2 has an unknown source: an _fbc-only click is not read again as Facebook", () => {
    const view = orderAttributionView({ ...EMPTY, capturedAt: "2026-11-10T03:30:00.000Z", platform: "meta", clickId: "IwAR2F4", clickIdType: "fbclid" });
    expect(view).toMatchObject({ channel: null, ad: null, visit: null, legacy: true });
  });

  it("does not credit an ad from a row written before v2, whatever it stored", () => {
    const view = orderAttributionView({ ...EMPTY, capturedAt: NOW, platform: "meta", utmSource: "facebook", utmMedium: "paid_social", adId: "120200000000000003", utmContent: "120200000000000003" });
    expect(view).toMatchObject({ channel: null, ad: null, legacy: true });
  });

  it("reads a source a merchant chose before v2 as entered in the dashboard", () => {
    expect(orderAttributionView({ ...EMPTY, method: "merchant", platform: "meta", siteSource: "wa" })).toMatchObject({ channel: "dashboard", ad: null });
  });

  it("says nothing is known when the row stored nothing to read", () => {
    expect(orderAttributionView({ ...EMPTY, landingPath: "/" })).toMatchObject({ channel: null, ad: null, visit: null, legacy: true });
    expect(orderAttributionView(stored(capturedAttributionRow("o1", { first: { ...DIRECT, ref: "google.com" }, last: null, visit: null }, { now: NOW })))).toMatchObject({ channel: null, ad: null, legacy: true });
  });

  it("survives names that are not JSON", () => {
    expect(orderAttributionView({ ...EMPTY, channel: "paid_other", utmMedium: "cpc", namesJson: "{oops" })).toMatchObject({ channel: "paid_other", ad: { campaignName: null, adName: null } });
  });
});
