import { describe, expect, it } from "vitest";
import type { CapturedTouches, Touch } from "./model";
import { capturedAttributionRow, creditedTouch, enteredAttributionRow, landingOf, landingTouch, orderSource } from "./resolve";

const NOW = "2026-11-11T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

function touch(params: Touch["params"], extra: Partial<Touch> = {}): Touch {
  return { at: "2026-11-10T09:30:00.000Z", params, path: null, ref: null, ...extra };
}

const TEMPLATE = touch(
  {
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "120200000000000001",
    utm_term: "120200000000000002",
    utm_content: "120200000000000003",
    wc_cn: "Robe été",
    wc_an: "Vidéo 1",
    wc_pl: "Facebook_Mobile_Feed",
    wc_ss: "fb",
    fbclid: "IwAR2F4-dbP0l7Mn1",
  },
  { path: "/lp/robe-ete", ref: "l.facebook.com" },
);

const FIRST = touch({}, { at: "2026-11-01T08:00:00.000Z", path: "/", ref: "google.com" });
const DIRECT = touch({}, { at: "2026-11-11T11:50:00.000Z", path: "/products/robe" });

const touches = (t: Partial<CapturedTouches>): CapturedTouches => ({ first: null, last: null, visit: null, ...t });
const row = (t: CapturedTouches | null) => capturedAttributionRow("o1", t, { now: NOW });

describe("capturedAttributionRow", () => {
  it("credits the ad click, with every value Meta's template carried, and keeps this visit apart", () => {
    expect(row(touches({ first: FIRST, last: TEMPLATE, visit: DIRECT }))).toEqual({
      orderId: "o1",
      method: "captured",
      channel: "paid_social",
      capturedAt: "2026-11-10T09:30:00.000Z",
      platform: "meta",
      clickId: "IwAR2F4-dbP0l7Mn1",
      clickIdType: "fbclid",
      campaignId: "120200000000000001",
      adsetId: "120200000000000002",
      adId: "120200000000000003",
      placement: "Facebook_Mobile_Feed",
      siteSource: "fb",
      utmSource: "facebook",
      utmMedium: "paid_social",
      utmCampaign: "120200000000000001",
      utmTerm: "120200000000000002",
      utmContent: "120200000000000003",
      namesJson: JSON.stringify({ campaign: "Robe été", ad: "Vidéo 1" }),
      landingPath: "/lp/robe-ete",
      landingPageType: "landing",
      referrerHost: "l.facebook.com",
      visitAt: DIRECT.at,
      visitChannel: "direct",
      visitPlatform: "direct",
      visitSiteSource: null,
      visitReferrerHost: null,
      visitLandingPath: "/products/robe",
      visitLandingPageType: "product",
      visitUtmSource: null,
      visitUtmMedium: null,
      visitUtmCampaign: null,
      firstTouchAt: FIRST.at,
      firstTouchJson: JSON.stringify(FIRST),
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("credits an ad clicked up to seven days before the order, and none clicked earlier", () => {
    expect(row(touches({ last: { ...TEMPLATE, at: ago(7 * DAY) }, visit: DIRECT }))).toMatchObject({ channel: "paid_social", adId: "120200000000000003" });
    const stale = row(touches({ last: { ...TEMPLATE, at: ago(7 * DAY + 1) }, visit: DIRECT }));
    expect(stale).toMatchObject({ channel: "direct", platform: "direct", adId: null, clickId: null, landingPath: "/products/robe", capturedAt: DIRECT.at });
  });

  it("credits the latest of two ad clicks: the last one, or this visit when it is the newer ad", () => {
    const tiktok = touch({ ttclid: "E.C.P.abc" }, { at: ago(DAY), path: "/" });
    expect(row(touches({ last: TEMPLATE, visit: tiktok }))).toMatchObject({ channel: "paid_social", platform: "tiktok", clickIdType: "ttclid" });
    const older = touch({ ttclid: "E.C.P.old" }, { at: ago(3 * DAY) });
    expect(row(touches({ last: { ...TEMPLATE, at: ago(DAY) }, visit: older }))).toMatchObject({ platform: "meta" });
  });

  it("never credits an ad clicked after the order, beyond five minutes of clock skew", () => {
    expect(row(touches({ last: { ...TEMPLATE, at: ago(-4 * 60 * 1000) } }))?.channel).toBe("paid_social");
    expect(row(touches({ last: { ...TEMPLATE, at: ago(-6 * 60 * 1000) } }))?.channel).toBeNull();
  });

  it("names a Facebook link that is not an ad as organic social, never an ad", () => {
    const facebookLink = touch({ fbclid: "IwAR2F4" }, { at: ago(60_000), path: "/", ref: "l.facebook.com" });
    expect(row(touches({ visit: facebookLink }))).toMatchObject({ channel: "organic_social", platform: "meta", siteSource: "fb", clickIdType: "fbclid", visitChannel: "organic_social" });
  });

  it("says direct for a visit with nothing, and unknown when the storefront sent no visit", () => {
    expect(row(touches({ visit: DIRECT }))).toMatchObject({ channel: "direct", platform: "direct", visitChannel: "direct" });
    expect(row(touches({ first: FIRST }))).toMatchObject({ channel: null, platform: "direct", capturedAt: null, firstTouchAt: FIRST.at });
    expect(row(touches({ first: FIRST }))).not.toHaveProperty("visitChannel");
    expect(row(null)).toBeNull();
  });

  it("keeps an id that is not digits in its utm value, never as an ad id", () => {
    const named = touch({ utm_source: "facebook", utm_medium: "cpc", utm_campaign: "soldes-ete", utm_term: "{{adset.id}}", utm_content: "1".repeat(33) }, { at: ago(DAY) });
    expect(row(touches({ last: named }))).toMatchObject({ campaignId: null, adsetId: null, adId: null, utmCampaign: "soldes-ete", utmTerm: "{{adset.id}}", utmContent: "1".repeat(33) });
    expect(row(touches({ last: touch({ utm_medium: "cpc", utm_content: "1".repeat(32) }, { at: ago(DAY) }) }))?.adId).toBe("1".repeat(32));
  });

  it("keeps a placement within its bound, and a Meta app only when Meta names one", () => {
    const paid = (params: Touch["params"]) => row(touches({ last: touch({ utm_medium: "paid_social", ...params }, { at: ago(DAY) }) }));
    expect(paid({ wc_pl: "x".repeat(64), wc_ss: "IG" })).toMatchObject({ placement: "x".repeat(64), siteSource: "ig" });
    expect(paid({ wc_pl: "x".repeat(65), wc_ss: "audience_network" })).toMatchObject({ placement: null, siteSource: null });
  });

  it("keeps the readable names only when the URL carried one", () => {
    expect(row(touches({ last: touch({ wc_an: "Vidéo 1" }, { at: ago(DAY) }) }))?.namesJson).toBe(JSON.stringify({ ad: "Vidéo 1" }));
    expect(row(touches({ visit: touch({ utm_source: "facebook" }, { at: ago(DAY) }) }))?.namesJson).toBeNull();
  });
});

describe("enteredAttributionRow", () => {
  it("says who entered an order staff created", () => {
    expect(enteredAttributionRow("o1", "dashboard", NOW)).toEqual({ orderId: "o1", method: "entered", channel: "dashboard", platform: "none", capturedAt: null, createdAt: NOW, updatedAt: NOW });
    expect(enteredAttributionRow("o1", "api", NOW)?.channel).toBe("api");
    expect(enteredAttributionRow("o1", "agent", NOW)?.channel).toBe("agent");
  });

  it("writes nothing for an order no staff surface created", () => {
    for (const origin of ["storefront", "carrier_webhook", "carrier_sync", "schedule"] as const) expect(enteredAttributionRow("o1", origin, NOW), origin).toBeNull();
  });
});

describe("landingOf", () => {
  it("names the page type a landing path is, past a language prefix", () => {
    expect(landingOf("/products/robe")).toEqual({ type: "product", landingSlug: null });
    expect(landingOf("/fr/products/robe")).toEqual({ type: "product", landingSlug: null });
    expect(landingOf("/en")).toEqual({ type: "home", landingSlug: null });
    expect(landingOf("/lp/robe-ete")).toEqual({ type: "landing", landingSlug: "robe-ete" });
    expect(landingOf("/category/robes")).toEqual({ type: "category", landingSlug: null });
    expect(landingOf("/pages/terms")).toEqual({ type: "page", landingSlug: null });
  });

  it("leaves a path no page type has unnamed", () => {
    expect(landingOf("/about")).toEqual({ type: null, landingSlug: null });
    expect(landingOf("/de/products/robe")).toEqual({ type: null, landingSlug: null });
    expect(landingOf(null)).toEqual({ type: null, landingSlug: null });
  });
});

describe("creditedTouch and landingTouch", () => {
  it("credit the recent ad click, and land on its page, else this visit's", () => {
    const recent = { ...TEMPLATE, at: ago(DAY) };
    expect(creditedTouch(touches({ first: FIRST, last: recent, visit: DIRECT }), NOW)).toBe(recent);
    expect(creditedTouch(touches({ first: FIRST, visit: DIRECT }), NOW)).toBeNull();
    expect(creditedTouch(null, NOW)).toBeNull();
    expect(landingTouch(touches({ last: recent, visit: DIRECT }), NOW)).toBe(recent);
    expect(landingTouch(touches({ visit: DIRECT }), NOW)).toBe(DIRECT);
    expect(landingTouch(null, NOW)).toBeNull();
  });
});

describe("orderSource: a direct return never erases where the shopper came from", () => {
  const search = (daysAgo: number) => touch({}, { at: ago(daysAgo * DAY), path: "/", ref: "www.google.com" });
  const ad = (daysAgo: number) => ({ ...TEMPLATE, at: ago(daysAgo * DAY) });
  const typed = touch({}, { at: ago(60_000), path: "/products/robe" });
  const source = (t: Partial<CapturedTouches>) => orderSource(touches(t), NOW);
  const channel = (t: Partial<CapturedTouches>) => row(touches(t))!.channel;

  it("keeps a Google search the source when the shopper comes back typing the address, up to 30 days later", () => {
    expect(source({ source: search(2), visit: typed })).toEqual({ touch: search(2), ad: false });
    expect(channel({ source: search(2), visit: typed })).toBe("organic_search");
    expect(channel({ source: search(30), visit: typed })).toBe("organic_search");
    expect(channel({ source: search(31), visit: typed })).toBe("direct");
  });

  it("takes this visit when it came from somewhere, over an older source", () => {
    const facebook = touch({ fbclid: "IwAR" }, { at: ago(60_000), ref: "l.facebook.com" });
    expect(source({ source: search(2), visit: facebook })).toEqual({ touch: facebook, ad: false });
    expect(channel({ source: search(2), visit: facebook })).toBe("organic_social");
  });

  it("credits an ad within seven days over any later visit, the way ad credit works", () => {
    expect(source({ last: ad(3), source: search(1), visit: typed })).toEqual({ touch: ad(3), ad: true });
    expect(channel({ last: ad(3), source: search(1), visit: search(1) })).toBe("paid_social");
  });

  it("never lets an ad clicked more than seven days ago be the source, as an ad or as a visit", () => {
    expect(channel({ last: ad(8), visit: typed })).toBe("direct");
    expect(channel({ last: ad(8), source: search(20), visit: typed })).toBe("organic_search");
    expect(channel({ last: ad(8), visit: ad(8) })).toBe("organic_social");
    expect(row(touches({ last: ad(8), visit: ad(8) }))!.channel).not.toMatch(/^paid_/);
  });

  it("reads a storefront that sends no last source as before: this visit decides", () => {
    expect(channel({ visit: typed })).toBe("direct");
    expect(channel({ visit: search(0) })).toBe("organic_search");
  });

  it("describes the source in the row's touch columns and this visit in its visit columns", () => {
    const written = row(touches({ source: search(2), visit: typed }))!;
    expect(written).toMatchObject({ channel: "organic_search", platform: "google", referrerHost: "www.google.com", capturedAt: search(2).at, visitChannel: "direct", visitAt: typed.at });
  });

  it("is paid only for the ad it credits, whatever touches it is sent", () => {
    for (const t of [{ last: ad(8), visit: ad(8) }, { source: search(2), visit: typed }, { visit: typed }, { last: ad(9), source: search(3), visit: ad(9) }]) {
      const written = row(touches(t))!;
      expect(written.channel?.startsWith("paid_") ?? false).toBe(creditedTouch(touches(t), NOW) !== null);
    }
  });
});

describe("the click id a row keeps", () => {
  it("keeps the click id of the platform the touch is credited to", () => {
    expect(row(touches({ visit: touch({ fbclid: "IwAR", ttclid: "E.C" }, { at: ago(60_000) }) }))).toMatchObject({ platform: "tiktok", clickIdType: "ttclid", clickId: "E.C" });
    expect(row(touches({ visit: touch({ fbclid: "IwAR", gclid: "Cj0" }, { at: ago(60_000) }) }))).toMatchObject({ platform: "google", clickIdType: "gclid", clickId: "Cj0" });
    expect(row(touches({ visit: touch({ msclkid: "ms1" }, { at: ago(60_000) }) }))).toMatchObject({ platform: "bing", channel: "paid_search", clickIdType: "msclkid" });
  });

  it("takes a Google ad's campaign id from gad_campaignid when the campaign is not an id", () => {
    expect(row(touches({ visit: touch({ gad_source: "1", gad_campaignid: "21000000001", utm_campaign: "spring" }, { at: ago(60_000) }) }))).toMatchObject({ channel: "paid_search", campaignId: "21000000001", utmCampaign: "spring" });
  });
});
