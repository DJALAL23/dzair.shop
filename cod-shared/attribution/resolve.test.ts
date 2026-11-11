import { describe, expect, it } from "vitest";
import type { CapturedTouches, Touch } from "./model";
import { capturedAttributionRow, creditedTouch, landingOf } from "./resolve";

const NOW = "2026-11-11T12:00:00.000Z";

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

function row(touches: CapturedTouches | null, fbc?: string | null) {
  return capturedAttributionRow("o1", touches, { fbc, now: NOW });
}

describe("capturedAttributionRow", () => {
  it("credits the last ad touch, with every value Meta's URL template carried", () => {
    expect(row({ first: FIRST, last: TEMPLATE })).toEqual({
      orderId: "o1",
      method: "captured",
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
      firstTouchAt: "2026-11-01T08:00:00.000Z",
      firstTouchJson: JSON.stringify(FIRST),
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("credits the first touch when the visit had no ad touch", () => {
    expect(row({ first: FIRST, last: null })).toMatchObject({ capturedAt: FIRST.at, platform: "google", landingPath: "/", landingPageType: "home", referrerHost: "google.com", clickId: null, adId: null, firstTouchAt: FIRST.at });
  });

  it("keeps an id that is not digits in its utm value, never as an ad id", () => {
    const named = touch({ utm_source: "facebook", utm_campaign: "soldes-ete", utm_term: "{{adset.id}}", utm_content: "1".repeat(33) });
    expect(row({ first: null, last: named })).toMatchObject({ campaignId: null, adsetId: null, adId: null, utmCampaign: "soldes-ete", utmTerm: "{{adset.id}}", utmContent: "1".repeat(33) });
    expect(row({ first: null, last: touch({ utm_content: "1".repeat(32) }) })?.adId).toBe("1".repeat(32));
  });

  it("names the platform by the click id first, then Meta's site source, then utm_source", () => {
    const platform = (params: Touch["params"]) => row({ first: null, last: touch(params) })?.platform;
    expect(platform({ ttclid: "E.C.P.abc", utm_source: "facebook" })).toBe("tiktok");
    expect(platform({ gclid: "Cj0KCQ" })).toBe("google");
    expect(platform({ fbclid: "IwAR", ttclid: "x" })).toBe("meta");
    expect(platform({ wc_ss: "IG", utm_source: "newsletter" })).toBe("meta");
    for (const source of ["facebook", "FB", "instagram", "ig", "messenger", "meta", "whatsapp", "threads"]) expect(platform({ utm_source: source }), source).toBe("meta");
    expect(platform({ utm_source: "TikTok" })).toBe("tiktok");
    expect(platform({ utm_source: "google" })).toBe("google");
    expect(platform({ utm_source: "newsletter" })).toBe("other");
    expect(platform({ wc_ss: "xx" })).toBe("other");
    expect(platform({ utm_medium: "email" })).toBe("other");
  });

  it("names the platform of a visit with no parameter by its referrer", () => {
    const platform = (ref: string | null) => row({ first: touch({}, { ref, path: "/" }), last: null })?.platform;
    for (const ref of ["facebook.com", "m.facebook.com", "lm.facebook.com", "l.instagram.com", "fb.com", "messenger.com", "web.whatsapp.com", "threads.net"]) expect(platform(ref), ref).toBe("meta");
    expect(platform("www.tiktok.com")).toBe("tiktok");
    for (const ref of ["google.com", "www.google.com", "google.dz", "www.google.co.uk"]) expect(platform(ref), ref).toBe("google");
    for (const ref of ["notfacebook.com", "facebook.com.evil.dz", "ouedkniss.com", "googlex.com", "notgoogle.com"]) expect(platform(ref), ref).toBe("referral");
    expect(platform(null)).toBe("direct");
  });

  it("keeps a placement and a site source only within their bounds", () => {
    expect(row({ first: null, last: touch({ wc_pl: "x".repeat(64), wc_ss: "Audience_Network" }) })).toMatchObject({ placement: "x".repeat(64), siteSource: "audience_network" });
    expect(row({ first: null, last: touch({ wc_pl: "x".repeat(65), wc_ss: "a".repeat(17) }) })).toMatchObject({ placement: null, siteSource: null });
    expect(row({ first: null, last: touch({ wc_ss: "f b" }) })?.siteSource).toBeNull();
  });

  it("keeps the readable names only when the URL carried one", () => {
    expect(row({ first: null, last: touch({ wc_an: "Vidéo 1" }) })?.namesJson).toBe(JSON.stringify({ ad: "Vidéo 1" }));
    expect(row({ first: null, last: touch({ utm_source: "facebook" }) })?.namesJson).toBeNull();
  });

  it("names the Meta click of an _fbc when the visit left no touch", () => {
    expect(row(null, "fb.1.1709136167115.IwAR2F4-dbP.ABcDEFGh")).toEqual({
      orderId: "o1",
      method: "captured",
      capturedAt: new Date(1709136167115).toISOString(),
      platform: "meta",
      clickId: "IwAR2F4-dbP",
      clickIdType: "fbclid",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("prefers the visit's own touch to its _fbc", () => {
    expect(row({ first: FIRST, last: null }, "fb.1.1709136167115.IwAR2F4")?.platform).toBe("google");
  });

  it("attributes nothing when the visit left no touch and no well-formed _fbc", () => {
    for (const fbc of [undefined, null, "", "IwAR2F4", "fb.1.17.IwAR"]) expect(row(null, fbc), String(fbc)).toBeNull();
    expect(row({ first: null, last: null })).toBeNull();
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

describe("creditedTouch", () => {
  it("is the last ad touch, else the first touch", () => {
    expect(creditedTouch({ first: FIRST, last: TEMPLATE })).toBe(TEMPLATE);
    expect(creditedTouch({ first: FIRST, last: null })).toBe(FIRST);
    expect(creditedTouch(null)).toBeNull();
  });
});
