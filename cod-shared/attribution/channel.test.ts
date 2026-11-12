import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classifyTouch, isPaidTouch, siteOfHost } from "./channel";
import { ORDER_CHANNELS, TOUCH_PARAMS } from "./model";

const t = (params: Record<string, string>, ref: string | null = null) => ({ params, ref });

/** Wocart's ad URL template, as Meta fills it on a click (report 02 §5.1). */
const META_TEMPLATE = {
  utm_source: "facebook",
  utm_medium: "paid_social",
  utm_campaign: "120200000000000001",
  utm_term: "120200000000000002",
  utm_content: "120200000000000003",
  wc_cn: "Robe été",
  wc_an: "Vidéo 1",
  wc_pl: "Instagram_Stories",
  wc_ss: "ig",
  fbclid: "IwAR2F4",
};

describe("isPaidTouch", () => {
  it("is an ad click when the medium matches Google Analytics' paid rule", () => {
    for (const medium of ["cpc", "CPC", "ppc", "cpm", "retargeting", "paid", "paid_social", "paid-social", "Paid Search", " cpc "]) {
      expect(isPaidTouch(t({ utm_medium: medium })), medium).toBe(true);
    }
    for (const medium of ["social", "organic", "email", "referral", "unpaid", "pai", "retarget", "p"]) {
      expect(isPaidTouch(t({ utm_medium: medium })), medium).toBe(false);
    }
  });

  it("is an ad click with a click id only ads carry: TikTok's, or Google's on any device", () => {
    for (const id of ["ttclid", "gclid", "gbraid", "wbraid"]) expect(isPaidTouch(t({ [id]: "x1" })), id).toBe(true);
  });

  it("is an ad click with Wocart's ad template names", () => {
    expect(isPaidTouch(t({ wc_cn: "Robe" }))).toBe(true);
    expect(isPaidTouch(t({ wc_an: "Vidéo 1" }))).toBe(true);
  });

  it("is not an ad click for a bare fbclid: Meta adds it to every link leaving Facebook and Instagram", () => {
    expect(isPaidTouch(t({ fbclid: "IwAR2F4" }, "l.facebook.com"))).toBe(false);
    expect(isPaidTouch(t({ fbclid: "IwAR2F4", utm_source: "facebook" }))).toBe(false);
    expect(isPaidTouch(t({ wc_ss: "fb", wc_pl: "Facebook_Mobile_Feed" }))).toBe(false);
    expect(isPaidTouch(t({}, "google.com"))).toBe(false);
  });
});

describe("classifyTouch", () => {
  it("reads Meta's template click as a paid social Meta ad, in the app Meta named", () => {
    expect(classifyTouch(t(META_TEMPLATE, "l.instagram.com"))).toEqual({ channel: "paid_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({ ...META_TEMPLATE, wc_ss: "fb" }))).toEqual({ channel: "paid_social", platform: "meta", app: "fb" });
  });

  it("reads TikTok's and Google's ad clicks", () => {
    expect(classifyTouch(t({ ttclid: "E.C.P.x" }))).toEqual({ channel: "paid_social", platform: "tiktok", app: null });
    for (const id of ["gclid", "gbraid", "wbraid"]) expect(classifyTouch(t({ [id]: "x" })), id).toEqual({ channel: "paid_search", platform: "google", app: null });
    expect(classifyTouch(t({ utm_source: "bing", utm_medium: "cpc" }))).toEqual({ channel: "paid_search", platform: "bing", app: null });
  });

  it("reads a paid link from an unknown network as paid other", () => {
    expect(classifyTouch(t({ utm_source: "ouedkniss", utm_medium: "cpc" }))).toEqual({ channel: "paid_other", platform: "other", app: null });
  });

  it("reads a Facebook or Instagram link that is not an ad as organic social", () => {
    expect(classifyTouch(t({ fbclid: "IwAR2F4" }))).toEqual({ channel: "organic_social", platform: "meta", app: null });
    expect(classifyTouch(t({ fbclid: "IwAR2F4" }, "l.facebook.com"))).toEqual({ channel: "organic_social", platform: "meta", app: "fb" });
    expect(classifyTouch(t({}, "l.instagram.com"))).toEqual({ channel: "organic_social", platform: "meta", app: "ig" });
    expect(classifyTouch(t({}, "wa.me"))).toEqual({ channel: "organic_social", platform: "meta", app: "wa" });
    expect(classifyTouch(t({}, "www.tiktok.com"))).toEqual({ channel: "organic_social", platform: "tiktok", app: null });
    expect(classifyTouch(t({ utm_source: "newsletter", utm_medium: "social" }))).toMatchObject({ channel: "organic_social" });
  });

  it("reads search engines, in every country, as organic search", () => {
    for (const host of ["www.google.com", "google.dz", "www.google.co.uk", "google.fr"]) {
      expect(classifyTouch(t({}, host)), host).toEqual({ channel: "organic_search", platform: "google", app: null });
    }
    expect(classifyTouch(t({}, "www.bing.com"))).toEqual({ channel: "organic_search", platform: "bing", app: null });
    expect(classifyTouch(t({}, "duckduckgo.com"))).toMatchObject({ channel: "organic_search" });
    expect(classifyTouch(t({ utm_medium: "organic" }))).toMatchObject({ channel: "organic_search" });
  });

  it("reads email, other sites and tagged links", () => {
    expect(classifyTouch(t({ utm_source: "brevo", utm_medium: "email" }))).toMatchObject({ channel: "email" });
    expect(classifyTouch(t({}, "blog.example.dz"))).toEqual({ channel: "referral", platform: "referral", app: null });
    expect(classifyTouch(t({ utm_source: "partner", utm_medium: "referral" }))).toMatchObject({ channel: "referral" });
    expect(classifyTouch(t({ utm_source: "flyer" }))).toEqual({ channel: "tagged", platform: "other", app: null });
  });

  it("reads nothing at all as direct", () => {
    expect(classifyTouch(t({}))).toEqual({ channel: "direct", platform: "direct", app: null });
    expect(classifyTouch(null)).toEqual({ channel: "direct", platform: "direct", app: null });
  });

  it("matches a site by its domain, never by a look-alike", () => {
    expect(siteOfHost("evilfacebook.com")).toBeNull();
    expect(siteOfHost("facebook.com.evil.dz")).toBeNull();
    expect(siteOfHost("notgoogle.com")).toBeNull();
    expect(siteOfHost("M.Facebook.COM")).toMatchObject({ platform: "meta", app: "fb" });
    expect(classifyTouch(t({}, "evilfacebook.com"))).toMatchObject({ channel: "referral" });
  });

  it("gives every touch one known channel, never throwing", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...TOUCH_PARAMS), fc.string()), fc.option(fc.domain()), (params, ref) => {
        expect(ORDER_CHANNELS).toContain(classifyTouch({ params, ref }).channel);
      }),
    );
  });
});
